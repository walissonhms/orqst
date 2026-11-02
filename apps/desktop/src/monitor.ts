import { z } from 'zod';
import { eventSchema, preferencesSchema } from '@orqst/protocol';

const identity = z.string().min(1).max(200);
const notificationType = z.enum(['agent.completed', 'agent.failed', 'agent.intervention.required']);
const sessionSchema = z.object({ id: identity, adapter: z.string().max(100) });
const notificationSchema = z.object({
  id: identity,
  sessionId: identity,
  type: notificationType,
  timestamp: z.iso.datetime({ offset: true }),
  read: z.boolean(),
});
// Strip captured bodies at the HTTP boundary; none is used for native UI.
const evidenceSchema = eventSchema.extend({
  id: identity,
  sessionId: identity,
  sequence: z.number().int().positive().safe(),
  payload: z.object({
    status: eventSchema.shape.payload.shape.status,
    name: z.string().optional(),
  }),
});
export const monitorSnapshotSchema = z
  .object({
    cursor: z.number().int().nonnegative().safe(),
    sessions: z.array(sessionSchema).max(10000),
    notifications: z.array(notificationSchema).max(200),
    events: z.array(evidenceSchema).max(150),
    preferences: preferencesSchema,
  })
  .superRefine((snapshot, context) => {
    for (const values of [snapshot.sessions, snapshot.notifications, snapshot.events]) {
      if (new Set(values.map((value) => value.id)).size !== values.length)
        context.addIssue({ code: 'custom', message: 'Duplicate identity' });
    }
    if (snapshot.events.some((event) => event.sequence > snapshot.cursor))
      context.addIssue({ code: 'custom', message: 'Invalid cursor' });
  });
export type MonitorSnapshot = z.infer<typeof monitorSnapshotSchema>;
export type NativeAlert = {
  sessionId: string;
  category: 'completed' | 'failed' | 'intervention';
  silent: boolean;
};

function category(type: z.infer<typeof notificationType>): NativeAlert['category'] {
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

  accept(snapshot: MonitorSnapshot): { pending: number; alerts: NativeAlert[] } {
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

/** Same authenticated session as the window; fixed route, no redirects, bounded body/time. */
export async function readMonitorSnapshot(
  fetcher: typeof fetch,
  origin: string,
): Promise<MonitorSnapshot> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetcher(`${origin}/api/snapshot`, {
      credentials: 'include',
      redirect: 'error',
      signal: controller.signal,
    });
    if (
      !response.ok ||
      !response.headers.get('content-type')?.startsWith('application/json') ||
      !response.body
    ) {
      await response.body?.cancel();
      throw new Error('Monitor unavailable');
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.byteLength;
        if (size > 8 * 1024 * 1024) throw new Error('Monitor response exceeds limit');
        chunks.push(next.value);
      }
    } finally {
      await reader.cancel();
    }
    return monitorSnapshotSchema.parse(
      JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown,
    );
  } finally {
    clearTimeout(timer);
  }
}
