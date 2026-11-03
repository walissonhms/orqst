import { Worker, type WorkerOptions } from 'node:worker_threads';
import type {
  ModelAnalyticsQuery,
  ModelAnalyticsSummary,
  ModelAnalyticsEvolution,
} from '@orqst/protocol';

export const ANALYTICS_WORKER_LIMITS = Object.freeze({ concurrency: 1, timeoutMs: 10000 });
export type AnalyticsErrorCode =
  | 'analytics_capacity_exceeded'
  | 'analytics_busy'
  | 'analytics_timeout'
  | 'analytics_cancelled'
  | 'analytics_unavailable';
export class AnalyticsQueryError extends Error {
  constructor(readonly code: AnalyticsErrorCode) {
    super(code);
  }
}
type AnalyticsResult = ModelAnalyticsSummary | ModelAnalyticsEvolution;
interface WorkerReply {
  report?: AnalyticsResult;
  error?: string;
}
/** Small worker seam for deterministic lifecycle tests, never supplied by runtime configuration. */
export interface AnalyticsWorker {
  once(event: 'message', listener: (reply: WorkerReply) => void): unknown;
  once(event: 'error', listener: (error: Error) => void): unknown;
  once(event: 'exit', listener: (code: number) => void): unknown;
  terminate(): Promise<number>;
}

/** One disposable reader per query; no queue, cached snapshots or second writer. */
export class AnalyticsQueries {
  private active?: { cancel: () => void; cleanup: Promise<void> };
  private closed = false;
  private closing?: Promise<void>;
  constructor(
    private readonly file: string | null,
    private readonly options: {
      timeoutMs?: number;
      workerFactory?: (entry: URL, options: WorkerOptions) => AnalyticsWorker;
    } = {},
  ) {}

  query(query: ModelAnalyticsQuery, signal?: AbortSignal): Promise<ModelAnalyticsSummary> {
    return this.run(query, signal, 'summary') as Promise<ModelAnalyticsSummary>;
  }

  evolution(query: ModelAnalyticsQuery, signal?: AbortSignal): Promise<ModelAnalyticsEvolution> {
    return this.run(query, signal, 'evolution') as Promise<ModelAnalyticsEvolution>;
  }

  private run(
    query: ModelAnalyticsQuery,
    signal: AbortSignal | undefined,
    projection: 'summary' | 'evolution',
  ): Promise<AnalyticsResult> {
    // The deadline includes synchronous setup, worker startup, reading and cleanup.
    const deadline =
      performance.now() + (this.options.timeoutMs ?? ANALYTICS_WORKER_LIMITS.timeoutMs);
    if (this.closed || signal?.aborted)
      return Promise.reject(new AnalyticsQueryError('analytics_cancelled'));
    if (this.active) return Promise.reject(new AnalyticsQueryError('analytics_busy'));
    if (!this.file) return Promise.reject(new AnalyticsQueryError('analytics_unavailable'));
    let worker: AnalyticsWorker;
    try {
      // tsx registration must happen INSIDE a development worker. Native TypeScript
      // stripping does not resolve workspace imports; tests never need dist first.
      // Production uses the separately bundled, colocated .mjs entry without tsx.
      const development = import.meta.url.endsWith('.ts');
      const entry = development
        ? new URL(
            `data:text/javascript,${encodeURIComponent(
              `import { register } from ${JSON.stringify(import.meta.resolve('tsx/esm/api'))};\n` +
                `register();\nawait import(${JSON.stringify(new URL('./analytics-worker.ts', import.meta.url).href)});`,
            )}`,
          )
        : new URL('./analytics-worker.mjs', import.meta.url);
      worker = (this.options.workerFactory ?? ((entry, options) => new Worker(entry, options)))(
        entry,
        {
          workerData: { file: this.file, query, projection },
          execArgv: [],
          resourceLimits: { maxOldGenerationSizeMb: 256, maxYoungGenerationSizeMb: 16 },
        },
      );
    } catch {
      return Promise.reject(
        new AnalyticsQueryError(
          performance.now() >= deadline ? 'analytics_timeout' : 'analytics_unavailable',
        ),
      );
    }
    let cleaned = false;
    let terminating = false;
    let settled = false;
    let report: AnalyticsResult | undefined;
    let cancel = () => {};
    let release = () => {};
    const cleanup = new Promise<void>((resolve) => {
      release = resolve;
    });
    const result = new Promise<AnalyticsResult>((resolve, reject) => {
      const fail = (code: AnalyticsErrorCode) => {
        if (!settled) {
          settled = true;
          reject(new AnalyticsQueryError(code));
        }
      };
      const confirmCleanup = () => {
        if (cleaned) return;
        cleaned = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        this.active = undefined;
        release();
        if (settled) return;
        // A message received within budget is not success until termination is confirmed.
        if (performance.now() >= deadline) fail('analytics_timeout');
        else if (report) {
          settled = true;
          resolve(report);
        } else fail('analytics_unavailable');
      };
      const terminate = () => {
        if (terminating || cleaned) return;
        terminating = true;
        void worker.terminate().then(confirmCleanup, () => {
          // A rejected terminate call is not proof that the thread exited. Keep
          // its slot and cleanup promise until the exit event confirms it.
          fail(performance.now() >= deadline ? 'analytics_timeout' : 'analytics_unavailable');
        });
      };
      const timeout = () => {
        fail('analytics_timeout');
        terminate();
      };
      const abort = () => {
        fail(performance.now() >= deadline ? 'analytics_timeout' : 'analytics_cancelled');
        terminate();
      };
      cancel = abort;
      const timer = setTimeout(timeout, Math.max(0, Math.ceil(deadline - performance.now())));
      signal?.addEventListener('abort', abort, { once: true });
      worker.once('error', () => {
        fail(performance.now() >= deadline ? 'analytics_timeout' : 'analytics_unavailable');
        terminate();
      });
      worker.once('exit', confirmCleanup);
      worker.once('message', (reply) => {
        if (settled) return;
        if (performance.now() >= deadline) timeout();
        else if (reply.report) {
          report = reply.report;
          terminate();
        } else {
          fail(
            reply.error === 'analytics_capacity_exceeded'
              ? 'analytics_capacity_exceeded'
              : 'analytics_unavailable',
          );
          terminate();
        }
      });
    });
    // Rejected requests may already have responded, but their workers still own
    // this slot. Only confirmed cleanup can release it; close awaits cleanup too.
    this.active = { cancel, cleanup };
    return result;
  }

  close(): Promise<void> {
    this.closed = true;
    this.closing ??= (async () => {
      const active = this.active;
      active?.cancel();
      await active?.cleanup;
    })();
    return this.closing;
  }
}
