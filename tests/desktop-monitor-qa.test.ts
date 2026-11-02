// Independent monitor QA. Synthetic snapshots only; no Bridge, DB or native UI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DesktopMonitor, monitorSnapshotSchema } from '../apps/desktop/src/monitor.js';

const stamp = '2026-11-02T12:00:00.000Z';
function snapshot(
  cursor: number,
  sequence: number,
  id: string,
  options: { read?: boolean; adapter?: string; status?: string } = {},
) {
  return monitorSnapshotSchema.parse({
    cursor,
    sessions: [{ id: 'synthetic-session', adapter: 'codex' }],
    notifications: [
      {
        id,
        sessionId: 'synthetic-session',
        type: 'agent.completed',
        timestamp: stamp,
        read: options.read ?? false,
      },
    ],
    events: [
      {
        schemaVersion: 1,
        id,
        sessionId: 'synthetic-session',
        sequence,
        type: 'agent.completed',
        timestamp: stamp,
        adapter: options.adapter ?? 'codex',
        machineId: 'synthetic-machine',
        workspaceId: 'synthetic-workspace',
        agentId: 'synthetic-agent',
        correlation: {},
        source: {
          file: '/synthetic/private.jsonl',
          offset: 1,
          line: 1,
          hash: 'synthetic-hash',
          recordType: 'event_msg:task_complete',
        },
        payload: { status: options.status ?? 'completed' },
      },
    ],
    preferences: { completed: true, failed: true, intervention: true, sound: true },
  });
}

test('cursor regression must not lower the high-water mark and replay old alerts', () => {
  const monitor = new DesktopMonitor();
  assert.deepEqual(monitor.accept(snapshot(5, 5, 'event-5')), {
    pending: 1,
    alerts: [],
  });
  // A restored/rolled-back Bridge snapshot must be treated as a reset baseline,
  // not as a new alert opportunity for the already-seen event.
  assert.deepEqual(monitor.accept(snapshot(2, 2, 'event-2')), {
    pending: 1,
    alerts: [],
  });
  assert.deepEqual(monitor.accept(snapshot(5, 5, 'event-5')), {
    pending: 1,
    alerts: [],
  });
});

test('monitor emits at most three alerts per cycle and counts bounded unread notifications', () => {
  const monitor = new DesktopMonitor();
  monitor.accept(snapshot(1, 1, 'baseline'));
  const base = snapshot(4, 4, 'event-4');
  base.notifications = [
    { ...base.notifications[0]!, id: 'event-1', sessionId: 'synthetic-session' },
    { ...base.notifications[0]!, id: 'event-2', sessionId: 'synthetic-session' },
    { ...base.notifications[0]!, id: 'event-3', sessionId: 'synthetic-session' },
    { ...base.notifications[0]!, id: 'event-4', sessionId: 'synthetic-session' },
  ];
  base.events = [
    { ...base.events[0]!, id: 'event-1', sequence: 1 },
    { ...base.events[0]!, id: 'event-2', sequence: 2 },
    { ...base.events[0]!, id: 'event-3', sequence: 3 },
    { ...base.events[0]!, id: 'event-4', sequence: 4 },
  ];
  const first = monitor.accept(base);
  assert.equal(first.pending, 4);
  assert.equal(first.alerts.length, 3);
  assert.deepEqual(
    monitor.accept(base).alerts,
    [],
    'the same persisted notifications must not alert twice',
  );
});

test('desktop main requests a single instance lock to avoid duplicate trays/pollers', () => {
  const main = readFileSync(join(process.cwd(), 'apps/desktop/src/main.ts'), 'utf8');
  assert.match(main, /requestSingleInstanceLock\(/);
  assert.match(main, /second-instance/);
});
