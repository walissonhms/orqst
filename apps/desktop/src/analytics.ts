import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  analyticsExportLimits,
  analyticsNativeRequestSchema,
  type AnalyticsReading,
  type AnalyticsNativeResult,
  type AnalyticsSaveRequest,
  type ModelAnalyticsSummary,
} from '@orqst/protocol';
import {
  canonicalModelAnalytics,
  readAnalyticsJSON,
  serializeModelAnalytics,
} from '../../analytics-export.js';
import { ReportDestination } from './artifact-files.js';

export const nativeAnalyticsTimeoutMs = 15000;
class AnalyticsReadError extends Error {
  constructor(readonly status: 'stale' | 'unavailable' | 'busy') {
    super(status);
  }
}
const cursorSchema = z
  .object({
    events: z.array(z.never()).max(0),
    cursor: z.number().int().nonnegative().safe(),
  })
  .strict();

/** No source records requested: after is fixed at the largest admissible sequence. */
export async function readNativeAnalytics(
  fetcher: typeof fetch,
  origin: string,
  reading: AnalyticsReading,
  authorized: () => boolean,
): Promise<ModelAnalyticsSummary> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), nativeAnalyticsTimeoutMs);
  const check = () => {
    if (!authorized()) throw new AnalyticsReadError('stale');
  };
  const get = async (path: string, limit: number) => {
    check();
    const response = await fetcher(origin + path, {
      credentials: 'include',
      redirect: 'error',
      headers: { Origin: origin },
      signal: controller.signal,
    });
    check();
    if (!response.ok) {
      // Only this fixed error code can cross the seam. No diagnostics/body is retained.
      if (response.status === 503) {
        const error = await readAnalyticsJSON(response, 4096, authorized);
        check();
        if (
          z
            .object({ error: z.literal('analytics_busy') })
            .strict()
            .safeParse(error).success
        )
          throw new AnalyticsReadError('busy');
      } else await response.body?.cancel();
      check();
      throw new AnalyticsReadError('unavailable');
    }
    const body = await readAnalyticsJSON(response, limit, authorized);
    check();
    return body;
  };
  const cursor = async () => {
    const value = cursorSchema.parse(await get('/api/events?after=9007199254740991&limit=1', 4096));
    check();
    if (value.cursor !== reading.cursor) throw new AnalyticsReadError('stale');
  };
  try {
    // Re-parse callers too; tests and main share the same bounded contract.
    const parsed = analyticsNativeRequestSchema.parse({
      contractVersion: 1,
      action: 'save',
      generation: 1,
      reading,
      format: 'csv',
    });
    if (parsed.action !== 'save') throw new AnalyticsReadError('unavailable');
    const params = new URLSearchParams();
    for (const key of ['from', 'to', 'workspaceId', 'agentId', 'adapter', 'model'] as const) {
      const value = parsed.reading.query[key];
      if (value === null) params.set('unidentified', 'true');
      else if (value !== undefined) params.set(key, value);
    }
    if (('?' + params).length > 2048) throw new AnalyticsReadError('unavailable');
    await cursor();
    check();
    const canonical = canonicalModelAnalytics(
      await get(`/api/analytics/models?${params}`, analyticsExportLimits.responseBytes),
    );
    check();
    if (createHash('sha256').update(canonical).digest('hex') !== reading.digest)
      throw new AnalyticsReadError('stale');
    const report = JSON.parse(canonical) as ModelAnalyticsSummary;
    // Checks the exact query in addition to the digest, without exporting filter identities.
    serializeModelAnalytics(report, { ...reading, format: 'csv' });
    await cursor();
    check();
    return report;
  } catch (error) {
    check();
    if (error instanceof AnalyticsReadError) throw error;
    throw new AnalyticsReadError('unavailable');
  } finally {
    controller.abort();
    clearTimeout(timer);
  }
}

export interface AnalyticsSaveDependencies {
  document: number;
  authorized(): boolean;
  read(reading: AnalyticsReading, authorized: () => boolean): Promise<ModelAnalyticsSummary>;
  choose(request: AnalyticsSaveRequest, report: ModelAnalyticsSummary): Promise<string | undefined>;
  confirm(path: string): Promise<boolean>;
  claim?(): (() => void) | undefined;
}

/** Context is revocation state, never permission; every save consumes it before any await. */
export class AnalyticsSaver {
  private document = -1;
  private generation = 0;
  private reading: AnalyticsReading | null = null;
  private busy = false;
  private consumedReadingId: string | undefined;

  context(input: unknown, document: number): AnalyticsNativeResult {
    const parsed = analyticsNativeRequestSchema.safeParse(input);
    if (!parsed.success || parsed.data.action !== 'context') return { status: 'failed' };
    if (document < this.document) return { status: 'failed' };
    if (this.document !== document) {
      this.document = document;
      this.generation = 0;
      this.consumedReadingId = undefined;
      this.reading = null;
    }
    if (parsed.data.generation <= this.generation) return { status: 'failed' };
    this.generation = parsed.data.generation;
    this.reading = null;
    if (parsed.data.reading && parsed.data.reading.readingId === this.consumedReadingId)
      return { status: 'failed' };
    this.reading = parsed.data.reading;
    return { status: 'acknowledged' };
  }

  async save(input: unknown, deps: AnalyticsSaveDependencies): Promise<AnalyticsNativeResult> {
    const parsed = analyticsNativeRequestSchema.safeParse(input);
    if (!deps.authorized() || !parsed.success || parsed.data.action !== 'save')
      return { status: 'failed' };
    const request = parsed.data;
    const matches =
      this.document === deps.document &&
      this.generation === request.generation &&
      JSON.stringify(this.reading) === JSON.stringify(request.reading);
    this.reading = null;
    if (!matches) return { status: 'stale' };
    this.consumedReadingId = request.reading.readingId;
    if (this.busy) return { status: 'busy' };
    const release = deps.claim?.();
    if (deps.claim && !release) return { status: 'busy' };
    this.busy = true;
    let destination: ReportDestination | undefined;
    const authorized = () =>
      deps.authorized() &&
      this.document === deps.document &&
      this.generation === request.generation;
    const check = () => {
      if (!authorized()) throw new AnalyticsReadError('stale');
    };
    try {
      const report = await deps.read(request.reading, authorized);
      check();
      if (
        createHash('sha256').update(canonicalModelAnalytics(report)).digest('hex') !==
        request.reading.digest
      )
        throw new AnalyticsReadError('stale');
      const file = serializeModelAnalytics(report, { ...request.reading, format: request.format });
      const selected = await deps.choose(request, report);
      check();
      if (selected === undefined) return { status: 'cancelled' };
      destination = new ReportDestination(
        selected,
        request.format === 'csv' ? '.csv' : '.md',
        analyticsExportLimits.outputBytes,
      );
      if (destination.exists) {
        const confirmed = await deps.confirm(destination.path);
        check();
        if (!confirmed) return { status: 'cancelled' };
      }
      // Reobtain after human dialogs; no stale cached report or hidden worker retry.
      const current = await deps.read(request.reading, authorized);
      check();
      if (
        createHash('sha256').update(canonicalModelAnalytics(current)).digest('hex') !==
        request.reading.digest
      )
        throw new AnalyticsReadError('stale');
      destination.write(file.text);
      return { status: 'saved' };
    } catch (error) {
      return {
        status: destination?.touched
          ? 'write_failed'
          : error instanceof AnalyticsReadError
            ? error.status
            : 'failed',
      };
    } finally {
      try {
        destination?.close();
      } catch {
        /* Never disclose filesystem diagnostics. */
      }
      this.busy = false;
      release?.();
    }
  }
}
