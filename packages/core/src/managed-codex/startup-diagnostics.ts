import { z } from 'zod';

/** Fixed-size metadata only. Saturation is explicit; these are observations, never ownership. */
export const startupDiagnosticLimits = Object.freeze({
  counter: 16 * 1024 * 1024,
  elapsedMs: 60000,
  hostSnapshots: 128,
  intervalMs: 250,
});
const counter = z.number().int().min(0).max(startupDiagnosticLimits.counter);
export const hostCountersSchema = z.strictObject({
  commands: counter,
  accepted: counter,
  rejected: counter,
  stdinBytes: counter,
  stdinCallbacks: counter,
  stdinErrors: counter,
  stdinBackpressure: counter,
  stdinDrains: counter,
  stdoutBytes: counter,
  stdoutChunks: counter,
  stdoutNewlines: counter,
  stderrBytes: counter,
  ipcQueued: counter,
  ipcDataQueued: counter,
  ipcDataCallbacks: counter,
  ipcDataErrors: counter,
  ipcCallbacks: counter,
  ipcErrors: counter,
  ipcBackpressure: counter,
  receiptQueued: counter,
  receiptCompleted: counter,
  receiptErrors: counter,
  exits: counter,
});
export const hostDiagnosticSchema = z.strictObject({
  type: z.literal('startup_diagnostic'),
  version: z.literal(1),
  sequence: z.number().int().min(1).max(startupDiagnosticLimits.hostSnapshots),
  elapsedMs: z.number().int().min(0).max(startupDiagnosticLimits.elapsedMs),
  saturated: z.boolean(),
  counters: hostCountersSchema,
});
export type HostDiagnostic = z.infer<typeof hostDiagnosticSchema>;
export type HostCounter = keyof z.infer<typeof hostCountersSchema>;
export const hostCounterNames = Object.keys(hostCountersSchema.shape) as HostCounter[];

export class StartupCounters<K extends string> {
  private readonly started = performance.now();
  private readonly values: Record<K, number>;
  private saturated = false;
  private frozen = false;
  private elapsed = 0;

  constructor(keys: readonly K[]) {
    this.values = Object.fromEntries(keys.map((key) => [key, 0])) as Record<K, number>;
  }
  add(key: K, amount = 1): void {
    if (this.frozen || !Object.hasOwn(this.values, key)) return;
    if (!Number.isSafeInteger(amount) || amount < 0) return;
    const next = this.values[key] + amount;
    this.saturated ||= next > startupDiagnosticLimits.counter;
    this.values[key] = Math.min(next, startupDiagnosticLimits.counter);
  }
  freeze(): void {
    this.elapsed = this.snapshot().elapsedMs;
    this.frozen = true;
  }
  snapshot() {
    return {
      elapsedMs: this.frozen
        ? this.elapsed
        : Math.min(startupDiagnosticLimits.elapsedMs, Math.floor(performance.now() - this.started)),
      saturated: this.saturated,
      counters: { ...this.values },
    };
  }
}

/** At most one metadata frame in flight, bounded lifetime and count, no retry on backpressure. */
export function reportHostStartup(
  counters: StartupCounters<HostCounter>,
  send: (value: HostDiagnostic, done: (error?: Error | null) => void) => void,
) {
  let sequence = 0;
  let stopped = false;
  let pending = false;
  const timer = setInterval(() => {
    if (pending || stopped) return;
    pending = true;
    const frame: HostDiagnostic = {
      type: 'startup_diagnostic',
      version: 1,
      sequence: ++sequence,
      ...counters.snapshot(),
    };
    if (sequence >= startupDiagnosticLimits.hostSnapshots) stop();
    try {
      send(frame, (error) => {
        pending = false;
        if (error) stop();
      });
    } catch {
      stop();
    }
  }, startupDiagnosticLimits.intervalMs);
  const deadline = setTimeout(stop, startupDiagnosticLimits.elapsedMs);
  timer.unref();
  deadline.unref();
  function stop() {
    stopped = true;
    clearInterval(timer);
    clearTimeout(deadline);
    counters.freeze();
  }
  return stop;
}
