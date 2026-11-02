import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '@orqst/database';
import { meta, normalized, record, token } from './fixtures.js';

test('cumulative and mirror records never double count input, output or cache', () => {
  const store = new Store(':memory:');
  try {
    const events = normalized([
      meta(),
      record('token_usage_record', {
        response_id: 'r1',
        thread_token_usage: token(100, 20, 40),
        turn_token_usage: token(100, 20, 40),
        usage: token(100, 20, 40),
      }),
      record('event_msg', { type: 'token_count', info: { total_token_usage: token(100, 20, 40) } }),
      record('token_usage_record', {
        response_id: 'r2',
        thread_token_usage: token(250, 40, 100),
        usage: token(150, 20, 60),
      }),
      record('event_msg', {
        type: 'token_count',
        info: { total_token_usage: token(250, 40, 100) },
      }),
    ]);
    for (const event of [...events, ...events]) store.ingest(event);
    assert.deepEqual(store.totals(), { input: 250, output: 40, cached: 100, total: 290 });
    assert.equal(store.cursor(), events.length);
  } finally {
    store.close();
  }
});
test('restart preserves usage, source checkpoints, settings, notifications and workspace overrides', () => {
  const dir = mkdtempSync(join(tmpdir(), 'orqst-store-'));
  const file = join(dir, 'db');
  let store = new Store(file);
  const [event] = normalized([meta()]);
  assert.ok(event);
  store.ingest(event);
  store.saveCheckpoint('source', { offset: 100, line: 2, identity: 'i', anchor: 'h', state: '{}' });
  store.ingest(
    { ...event, id: 'done', type: 'agent.completed', payload: { status: 'completed' } },
    true,
  );
  const custom = store.workspace('/synthetic/manual', 'Manual');
  store.associate(event.sessionId, custom);
  store.setSetting('test', 42);
  const machine = store.machineId;
  store.close();
  store = new Store(file);
  try {
    assert.equal(store.machineId, machine);
    assert.equal(store.checkpoint('source')?.offset, 100);
    assert.equal(store.setting('test', 0), 42);
    assert.equal(store.sessions()[0]?.workspaceId, custom);
    assert.equal(store.notifications().length, 1);
    assert.equal(store.ingest(event), undefined);
    assert.equal(statSync(file).mode & 0o777, 0o600);
    store.readNotifications();
    assert.equal(store.notifications()[0]?.read, true);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('transaction rollback leaves no partial event or session', () => {
  const store = new Store(':memory:');
  try {
    const [event] = normalized([meta()]);
    assert.ok(event);
    assert.throws(() =>
      store.transaction(() => {
        store.ingest(event);
        throw new Error('Synthetic rollback');
      }),
    );
    assert.equal(store.sessions().length, 0);
    assert.equal(store.cursor(), 0);
  } finally {
    store.close();
  }
});
test('out-of-order status events cannot overwrite later lifecycle evidence', () => {
  const store = new Store(':memory:');
  try {
    const [base] = normalized([meta()]);
    assert.ok(base);
    store.ingest(base);
    store.ingest({
      ...base,
      id: 'done',
      timestamp: '2026-11-02T17:00:00.000Z',
      payload: { status: 'completed' },
    });
    store.ingest({
      ...base,
      id: 'old',
      timestamp: '2026-11-02T16:00:00.000Z',
      payload: { status: 'running' },
    });
    assert.equal(store.sessions()[0]?.status, 'completed');
  } finally {
    store.close();
  }
});
test('retention purges detail and notifications, preserving totals and monotonically increasing cursors', () => {
  const store = new Store(':memory:', 1);
  try {
    const events = normalized([
      meta(),
      record('token_usage_record', { response_id: 'r', thread_token_usage: token(10, 2) }),
    ]);
    events.forEach((event) => store.ingest(event, true));
    const before = store.cursor();
    assert.equal(store.retain(Date.parse('2026-11-05T00:00:00Z')), 2);
    assert.equal(store.events().length, 0);
    assert.equal(store.cursor(), before);
    assert.equal(store.totals().total, 12);
    assert.equal(store.sessions().length, 1);
  } finally {
    store.close();
  }
});

test('notification category preferences suppress notification delivery without changing observed status', () => {
  const store = new Store(':memory:');
  try {
    store.setSetting('notifications', {
      sound: false,
      completed: false,
      failed: true,
      intervention: true,
    });
    const [base] = normalized([meta()]);
    assert.ok(base);
    store.ingest(base);
    store.ingest(
      {
        ...base,
        id: 'disabled-completion',
        type: 'agent.completed',
        payload: { status: 'completed' },
      },
      true,
    );
    assert.equal(store.notifications().length, 0);
    assert.equal(store.sessions()[0]?.status, 'completed');
  } finally {
    store.close();
  }
});
