import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  desktopNotificationAlertSchema,
  desktopNotificationFrameSchema,
  desktopNotificationSessionIdSchema,
} from '../packages/protocol/src/desktop-notifications.js';
import { desktopNotificationFrame } from '../packages/core/src/desktop-monitor.js';
import { NativeSessionNavigation } from '../apps/dashboard/src/native-session-navigation.js';
import type { Snapshot } from '@orqst/protocol';

test('private notification frame permits only bounded category and source identity metadata', () => {
  const frame = desktopNotificationFrame({
    pending: 2,
    alerts: [
      { category: 'completed', silent: true, sessionId: 'synthetic-source-session' },
      { category: 'failed', silent: false, sessionId: '/private/not-a-navigation-id' },
    ],
  });
  assert.deepEqual(frame, {
    connected: true,
    pending: 2,
    alerts: [
      { category: 'completed', silent: true, sessionId: 'synthetic-source-session' },
      { category: 'failed', silent: false },
    ],
  });
  for (const id of [
    '',
    '../session',
    'session/name',
    'choose session',
    'a\n',
    'a%20b',
    'x'.repeat(201),
  ])
    assert.equal(desktopNotificationSessionIdSchema.safeParse(id).success, false);
  for (const extra of ['body', 'title', 'path', 'token', 'source'])
    assert.equal(
      desktopNotificationAlertSchema.safeParse({ ...frame.alerts[0], [extra]: 'PRIVATE' }).success,
      false,
    );
  assert.equal(desktopNotificationFrameSchema.safeParse({ ...frame, pending: 201 }).success, false);
  assert.equal(
    desktopNotificationFrameSchema.safeParse({ ...frame, alerts: Array(4).fill(frame.alerts[0]) })
      .success,
    false,
  );
  const maximum = desktopNotificationFrame({
    pending: 200,
    alerts: Array.from({ length: 3 }, () => ({
      category: 'intervention',
      silent: false,
      sessionId: 'x'.repeat(200),
    })),
  });
  assert.ok(Buffer.byteLength(`ORQST_DESKTOP_STATE ${JSON.stringify(maximum)}\n`) <= 1024);
});

function sourceSnapshot(ids = ['synthetic-new-session']): Snapshot {
  // Synthetic minimal membership; navigation never reads transcript or runtime fields.
  return {
    sessions: ids.map((id) => ({ id, adapter: 'codex', workspaceId: 'synthetic-workspace' })),
  } as Snapshot;
}

test('notification selection uses refreshed membership for a session absent from the old snapshot', async () => {
  const old = sourceSnapshot([]);
  const fresh = sourceSnapshot();
  const selected: string[] = [];
  let refreshes = 0;
  const navigation = new NativeSessionNavigation({
    context: () => old,
    refresh: async () => {
      refreshes++;
      return fresh;
    },
    open: (id, snapshot, current) => {
      assert.equal(snapshot, fresh);
      assert.ok(current());
      assert.equal(old.sessions.length, 0);
      selected.push(id);
    },
  });
  await navigation.request({ sessionId: 'synthetic-new-session' });
  assert.equal(refreshes, 1);
  assert.deepEqual(selected, ['synthetic-new-session']);
});

test('invalid, missing, duplicated, unsupported and failed-refresh targets never select cached sessions', async () => {
  let refreshes = 0;
  let fresh = sourceSnapshot();
  const navigation = new NativeSessionNavigation({
    context: () => 'synthetic-context',
    refresh: async () => {
      refreshes++;
      return fresh;
    },
    open: () => assert.fail('Invalid target must not navigate'),
  });
  for (const detail of [
    null,
    {},
    { sessionId: '' },
    { sessionId: '/private/path' },
    { sessionId: 'choose session' },
    { sessionId: 'valid', path: '/overview' },
  ])
    await navigation.request(detail);
  assert.equal(refreshes, 0);
  await navigation.request({ sessionId: 'missing-session' });
  fresh = sourceSnapshot(['synthetic-new-session', 'synthetic-new-session']);
  await navigation.request({ sessionId: 'synthetic-new-session' });
  fresh = sourceSnapshot();
  fresh.sessions[0]!.adapter = 'claude';
  await navigation.request({ sessionId: 'synthetic-new-session' });
  const failed = new NativeSessionNavigation({
    context: () => 'synthetic-context',
    refresh: () => Promise.reject(new Error('Synthetic unavailable snapshot')),
    open: () => assert.fail('Failed refresh must not navigate'),
  });
  await failed.request({ sessionId: 'synthetic-new-session' });
});

test('draft guard cancellation preserves selection and invalidation fences a delayed affirmative', async () => {
  let selected = 'synthetic-old-session';
  let guarded: (() => void) | undefined;
  const navigation = new NativeSessionNavigation({
    context: () => 'synthetic-context',
    refresh: async () => sourceSnapshot(),
    open: (id, _snapshot, current) => {
      // The existing requestNavigation guard owns whether/when this transition runs.
      guarded = () => {
        if (current()) selected = id;
      };
    },
  });
  await navigation.request({ sessionId: 'synthetic-new-session' });
  assert.equal(selected, 'synthetic-old-session'); // Cancel does not call the guarded action.
  navigation.cancel(); // Native disconnect/off/stop or component disposal.
  guarded?.();
  assert.equal(selected, 'synthetic-old-session');
  await navigation.request({ sessionId: 'synthetic-new-session' });
  guarded?.(); // A current affirmative can select.
  assert.equal(selected, 'synthetic-new-session');
  selected = 'synthetic-old-session';
  await navigation.request({ sessionId: 'synthetic-new-session' });
  navigation.observe(sourceSnapshot([])); // Source disappears while draft review stays open.
  guarded?.();
  assert.equal(selected, 'synthetic-old-session');
});

test('context changes and newer clicks discard stale asynchronous selections', async () => {
  let context = {};
  let resolve: ((snapshot: Snapshot) => void) | undefined;
  const opened: string[] = [];
  const navigation = new NativeSessionNavigation({
    context: () => context,
    refresh: () =>
      new Promise<Snapshot>((accept) => {
        resolve = accept;
      }),
    open: (id) => opened.push(id),
  });
  const pending = navigation.request({ sessionId: 'synthetic-new-session' });
  context = {}; // Workspace/view/selection/connection changed while refreshing.
  resolve?.(sourceSnapshot());
  await pending;
  assert.deepEqual(opened, []);
  const older = navigation.request({ sessionId: 'synthetic-old-session' });
  const completeOlder = resolve;
  const newer = navigation.request({ sessionId: 'synthetic-new-session' });
  resolve?.(sourceSnapshot());
  await newer;
  completeOlder?.(sourceSnapshot(['synthetic-old-session']));
  await older;
  assert.deepEqual(opened, ['synthetic-new-session']);
});
