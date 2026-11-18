import { desktopNotificationSelectionSchema, type Snapshot } from '@orqst/protocol';

/** An ambiguous or missing snapshot member cannot be a notification source. */
export function findNotificationSource(snapshot: Snapshot, id: string) {
  const index = snapshot.sessions.findIndex((session) => session.id === id);
  if (index < 0 || snapshot.sessions.findLastIndex((session) => session.id === id) !== index)
    return undefined;
  return snapshot.sessions[index];
}

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
    if (findNotificationSource(snapshot, this.target)?.adapter !== 'codex') this.cancel();
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
      if (findNotificationSource(snapshot, request.data.sessionId)?.adapter !== 'codex') return;
      this.target = request.data.sessionId;
      this.actions.open(request.data.sessionId, snapshot, current);
    } catch {
      // A failed authenticated refresh cannot select from cached membership.
    }
  }
}
