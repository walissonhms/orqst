import { preferencesSchema } from '@orqst/protocol';
import { OwnedTurnMonitor } from './owned-turn-monitor.js';

type Entry = {
  terminalId: string;
  turnId?: string;
  agentState?: 'running' | 'completed' | 'failed' | 'unknown';
};

/** One in-flight passive sample. Shutdown and stale samples cannot emit alerts. */
export class OwnedTurnPoller {
  private readonly monitor = new OwnedTurnMonitor();
  private busy = false;
  private stopped = false;
  private lastSample?: number;

  constructor(
    private readonly sample: () => Promise<Entry[]>,
    private readonly preferences: () => unknown,
    private readonly emit: (alert: {
      terminalId: string;
      turnId: string;
      category: 'completed' | 'failed';
      silent: boolean;
    }) => void,
    private readonly now: () => number = Date.now,
  ) {}

  async poll(): Promise<void> {
    if (this.busy || this.stopped) return;
    this.busy = true;
    const started = this.now();
    try {
      if (
        this.lastSample === undefined ||
        started < this.lastSample ||
        started - this.lastSample > 10_000
      )
        this.monitor.disconnect();
      const entries = await this.sample();
      const finished = this.now();
      if (this.stopped) return;
      if (finished < started || finished - started > 10_000)
        throw new Error('Stale owned turn sample');
      const preferences = preferencesSchema.parse(this.preferences());
      for (const alert of this.monitor.accept(
        entries.map((entry) => ({
          terminalId: entry.terminalId,
          ...(entry.turnId ? { turnId: entry.turnId } : {}),
          agentState: entry.agentState ?? 'unknown',
        })),
        preferences,
      ))
        this.emit(alert);
      this.lastSample = finished;
    } catch {
      this.monitor.disconnect();
      this.lastSample = undefined;
    } finally {
      this.busy = false;
    }
  }

  stop(): void {
    this.stopped = true;
    this.monitor.disconnect();
  }
}
