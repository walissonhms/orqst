import { desktopNotificationSelectionSchema, type Snapshot } from '@orqst/protocol';

/** View selection only. Native provenance never grants execution or process ownership. */
export class NativeSessionNavigation {
  private generation = 0;
  private target: string | undefined;

  constructor(
    private readonly actions: {
      context: () => unknown;
      refresh: () => Promise<Snapshot>;
      open: (id: string, snapshot: Snapshot, current: () => boolean) => void;
    },
  ) {}

  cancel(): void {
    this.generation++;
    this.target = undefined;
  }

  observe(snapshot: Snapshot | undefined): void {
    if (!snapshot || !this.target) return;
    const matches = snapshot.sessions.filter((session) => session.id === this.target);
    if (matches.length !== 1 || matches[0]?.adapter !== 'codex') this.cancel();
  }

  async request(detail: unknown): Promise<void> {
    this.cancel();
    const request = desktopNotificationSelectionSchema.safeParse(detail);
    if (!request.success) return;
    const generation = this.generation;
    const context = this.actions.context();
    const current = () => this.generation === generation && this.actions.context() === context;
    try {
      const snapshot = await this.actions.refresh();
      if (!current() || !Array.isArray(snapshot.sessions) || snapshot.sessions.length > 10000)
        return;
      const matches = snapshot.sessions.filter((session) => session.id === request.data.sessionId);
      if (matches.length !== 1 || matches[0]?.adapter !== 'codex') return;
      this.target = request.data.sessionId;
      this.actions.open(request.data.sessionId, snapshot, current);
    } catch {
      // A failed authenticated refresh cannot select from cached membership.
    }
  }
}
