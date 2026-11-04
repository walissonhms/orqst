import type { Preferences, Snapshot, StoredEvent } from '@orqst/protocol';

/** Only the fields used by the source-gated native monitor. */
export interface DesktopMonitorSnapshot {
  cursor: number;
  sessions: Pick<Snapshot['sessions'][number], 'id' | 'adapter'>[];
  notifications: Snapshot['notifications'];
  events: (Omit<StoredEvent, 'payload'> & {
    payload: Pick<StoredEvent['payload'], 'status' | 'name'>;
  })[];
  preferences: Preferences;
}

export type NativeAlert = {
  sessionId: string;
  category: 'completed' | 'failed' | 'intervention';
  silent: boolean;
};

function category(type: string): NativeAlert['category'] {
  return type === 'agent.completed'
    ? 'completed'
    : type === 'agent.failed'
      ? 'failed'
      : 'intervention';
}

/** Only persisted live notifications joined to supported source evidence may alert. */
export class DesktopMonitor {
  private cursor = 0;
  private attached = false;

  disconnect(): void {
    this.attached = false;
  }

  accept(snapshot: DesktopMonitorSnapshot): { pending: number; alerts: NativeAlert[] } {
    const previous = this.cursor;
    const baseline = !this.attached || snapshot.cursor < previous;
    this.attached = true;
    // Keep the high-water mark across disconnects/rollback to suppress old sequences.
    this.cursor = Math.max(previous, snapshot.cursor);
    const sessions = new Set(
      snapshot.sessions.filter((value) => value.adapter === 'codex').map((value) => value.id),
    );
    const notifications = snapshot.notifications.filter((value) => sessions.has(value.sessionId));
    const pending = notifications.filter((value) => !value.read).length;
    if (baseline) return { pending, alerts: [] };
    const alerts: NativeAlert[] = [];
    for (const item of notifications) {
      const key = category(item.type);
      const event = snapshot.events.find((value) => value.id === item.id);
      if (
        item.read ||
        !snapshot.preferences[key] ||
        !event ||
        event.sequence <= previous ||
        event.sessionId !== item.sessionId ||
        event.type !== item.type ||
        event.timestamp !== item.timestamp ||
        event.adapter !== 'codex' ||
        !event.source.file ||
        !event.source.hash ||
        event.source.line < 1
      )
        continue;
      const record = event.source.recordType;
      const supported =
        (key === 'completed' &&
          event.payload.status === 'completed' &&
          record === 'event_msg:task_complete') ||
        (key === 'failed' &&
          event.payload.status === 'failed' &&
          ['event_msg:error', 'event_msg:task_failed'].includes(record)) ||
        (key === 'intervention' &&
          event.payload.status === 'waiting_for_user' &&
          ['response_item:function_call', 'response_item:custom_tool_call'].includes(record) &&
          ['request_user_input', 'functions.request_user_input'].includes(
            event.payload.name ?? '',
          ));
      if (supported)
        alerts.push({
          sessionId: item.sessionId,
          category: key,
          silent: !snapshot.preferences.sound,
        });
    }
    // A busy source cannot flood the OS; omitted alerts remain in dashboard history.
    return { pending, alerts: alerts.slice(0, 3) };
  }
}
