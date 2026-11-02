import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DesktopMonitor,
  monitorSnapshotSchema,
  readMonitorSnapshot,
} from '../apps/desktop/src/monitor.js';
import { sessionFromHash } from '../apps/dashboard/src/session-link.js';

const stamp = '2026-11-02T12:00:00.000Z';
function snapshot(
  sequence: number,
  options: {
    read?: boolean;
    type?: string;
    record?: string;
    status?: string;
    adapter?: string;
    name?: string;
  } = {},
) {
  const type = options.type ?? 'agent.completed';
  return monitorSnapshotSchema.parse({
    cursor: sequence,
    sessions: [{ id: 'synthetic-session', adapter: 'codex' }],
    notifications: sequence
      ? [
          {
            id: `synthetic-${sequence}`,
            sessionId: 'synthetic-session',
            type,
            timestamp: stamp,
            read: options.read ?? false,
          },
        ]
      : [],
    preferences: { completed: true, failed: true, intervention: true, sound: false },
    events: sequence
      ? [
          {
            schemaVersion: 1,
            id: `synthetic-${sequence}`,
            sessionId: 'synthetic-session',
            sequence,
            type,
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
              recordType: options.record ?? 'event_msg:task_complete',
            },
            payload: {
              status: options.status ?? 'completed',
              name: options.name,
              text: 'PRIVATE CONVERSATION',
              agentName: 'PRIVATE NAME',
            },
          },
        ]
      : [],
  });
}

test('native monitor baselines history/start/reconnect and consumes new evidence only once', () => {
  const monitor = new DesktopMonitor();
  assert.deepEqual(monitor.accept(snapshot(1)), { pending: 1, alerts: [] });
  assert.deepEqual(monitor.accept(snapshot(2)).alerts, [
    { sessionId: 'synthetic-session', category: 'completed', silent: true },
  ]);
  assert.equal(monitor.accept(snapshot(2)).alerts.length, 0);
  monitor.disconnect();
  assert.equal(monitor.accept(snapshot(3)).alerts.length, 0);
  assert.equal(monitor.accept(snapshot(1)).alerts.length, 0);
  // A replayed old notification cannot alert at a newer cursor.
  const replay = snapshot(2);
  replay.cursor = 10;
  replay.events[0]!.sequence = 1;
  assert.equal(monitor.accept(replay).alerts.length, 0);
});

test('native monitor requires supported source/status, preference and identity joins', () => {
  for (const mutate of [
    (value: ReturnType<typeof snapshot>) => {
      value.preferences.completed = false;
    },
    (value: ReturnType<typeof snapshot>) => {
      value.notifications[0]!.read = true;
    },
    (value: ReturnType<typeof snapshot>) => {
      value.notifications = [];
    },
    (value: ReturnType<typeof snapshot>) => {
      value.events = [];
    },
    (value: ReturnType<typeof snapshot>) => {
      value.sessions = [];
    },
    (value: ReturnType<typeof snapshot>) => {
      value.events[0]!.sessionId = 'wrong';
    },
    (value: ReturnType<typeof snapshot>) => {
      value.events[0]!.adapter = 'claude';
    },
    (value: ReturnType<typeof snapshot>) => {
      value.events[0]!.payload.status = 'interrupted';
    },
    (value: ReturnType<typeof snapshot>) => {
      value.events[0]!.source.recordType = 'response_item:message';
    },
    (value: ReturnType<typeof snapshot>) => {
      value.events[0]!.source.hash = '';
    },
    (value: ReturnType<typeof snapshot>) => {
      value.events[0]!.timestamp = '2026-11-01T12:00:00.000Z';
    },
  ]) {
    const monitor = new DesktopMonitor();
    monitor.accept(snapshot(0));
    const value = snapshot(1);
    mutate(value);
    assert.equal(monitor.accept(value).alerts.length, 0);
    assert.equal(
      monitor.accept(snapshot(1)).alerts.length,
      0,
      'disabled/missing evidence is never replayed later',
    );
  }
  for (const options of [
    { type: 'agent.failed', record: 'event_msg:error', status: 'failed' },
    { type: 'agent.failed', record: 'event_msg:task_failed', status: 'failed' },
    {
      type: 'agent.intervention.required',
      record: 'response_item:function_call',
      status: 'waiting_for_user',
      name: 'request_user_input',
    },
  ]) {
    const monitor = new DesktopMonitor();
    monitor.accept(snapshot(0));
    const value = snapshot(1, options);
    value.preferences.sound = true;
    assert.equal(monitor.accept(value).alerts[0]?.silent, false);
  }
  const monitor = new DesktopMonitor();
  monitor.accept(snapshot(0));
  assert.equal(
    monitor.accept(
      snapshot(1, {
        type: 'agent.intervention.required',
        record: 'response_item:function_call',
        status: 'waiting_for_user',
        name: 'arbitrary_tool',
      }),
    ).alerts.length,
    0,
  );
});

test('projection strips captured payload and rejects malformed/duplicate identity', () => {
  assert.equal(JSON.stringify(snapshot(1)).includes('PRIVATE'), false);
  const value = snapshot(1);
  value.sessions.push(value.sessions[0]!);
  assert.throws(() => monitorSnapshotSchema.parse(value));
  assert.throws(() => monitorSnapshotSchema.parse({ ...snapshot(1), cursor: 0 }));
  assert.throws(() =>
    monitorSnapshotSchema.parse({
      ...snapshot(1),
      notifications: [{ ...snapshot(1).notifications[0], type: 'agent.updated' }],
    }),
  );
});

test('bounded HTTP snapshot fails closed on errors, invalid content and oversize bodies', async () => {
  const origin = 'http://127.0.0.1:4322';
  const response =
    (body: string, status = 200, contentType = 'application/json') =>
    async () =>
      new Response(body, { status, headers: { 'content-type': contentType } });
  assert.equal(
    (await readMonitorSnapshot(response(JSON.stringify(snapshot(1))), origin)).cursor,
    1,
  );
  for (const fetcher of [
    response('{}', 401),
    response('{}', 200, 'text/html'),
    response('bad'),
    response(' '.repeat(8 * 1024 * 1024 + 1)),
  ])
    await assert.rejects(readMonitorSnapshot(fetcher, origin));
});

test('session hash selection decodes only bounded identities present in the snapshot', () => {
  const id = 'synthetic /#? sessão';
  assert.equal(sessionFromHash(`#session=${encodeURIComponent(id)}`, [id]), id);
  for (const hash of [
    '#models',
    '#session=missing',
    '#session=%',
    '#session=',
    '#session=' + 'a'.repeat(201),
  ])
    assert.equal(sessionFromHash(hash, [id]), undefined);
});

test('burst overflow is consumed without queueing and reconnect keeps the sequence high-water mark', () => {
  const monitor = new DesktopMonitor();
  monitor.accept(snapshot(0));
  const value = snapshot(5);
  value.notifications = Array.from({ length: 5 }, (_, index) => ({
    ...value.notifications[0]!,
    id: `burst-${5 - index}`,
  }));
  value.events = Array.from({ length: 5 }, (_, index) => ({
    ...value.events[0]!,
    id: `burst-${5 - index}`,
    sequence: 5 - index,
  }));
  assert.deepEqual(monitor.accept(value), {
    pending: 5,
    alerts: Array.from({ length: 3 }, () => ({
      sessionId: 'synthetic-session',
      category: 'completed',
      silent: true,
    })),
  });
  assert.deepEqual(monitor.accept(value).alerts, []);
  monitor.disconnect();
  monitor.accept(snapshot(2));
  assert.deepEqual(monitor.accept(value).alerts, []);
});
