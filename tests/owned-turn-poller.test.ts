// Synthetic owned samples and private preference database only. No provider or OS notification.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { ownedTurnAlertSchema } from '@orqst/protocol';
import { OwnedTurnPoller } from '../packages/core/src/terminal/owned-turn-poller.js';
import { ownedNotificationPreferences } from '../packages/core/src/terminal/owned-notification-preferences.js';

const preferences = { sound: false, completed: true, failed: true, intervention: true };

test('owned polling serializes samples, deduplicates turns and fences stale/shutdown results', async () => {
  const terminalId = randomUUID();
  let turnId = randomUUID();
  let agentState: 'running' | 'completed' | 'failed' | 'unknown' = 'running';
  let at = 1000;
  let calls = 0;
  let resolve: (() => void) | undefined;
  let gate: Promise<void> | undefined;
  let invalidPreferences = false;
  const alerts: unknown[] = [];
  const poller = new OwnedTurnPoller(
    async () => {
      calls++;
      await gate;
      return [{ terminalId, turnId, agentState }];
    },
    () => (invalidPreferences ? {} : preferences),
    (alert) => alerts.push(alert),
    () => at,
  );
  await poller.poll();
  agentState = 'completed';
  await poller.poll();
  await poller.poll();
  assert.deepEqual(alerts, [{ terminalId, turnId, category: 'completed', silent: true }]);
  turnId = randomUUID();
  agentState = 'running';
  await poller.poll();
  invalidPreferences = true;
  agentState = 'failed';
  await poller.poll();
  invalidPreferences = false;
  await poller.poll();
  assert.equal(alerts.length, 1);
  turnId = randomUUID();
  agentState = 'running';
  await poller.poll();
  at += 10_001;
  agentState = 'completed';
  await poller.poll();
  assert.equal(alerts.length, 1);
  turnId = randomUUID();
  agentState = 'running';
  await poller.poll();
  agentState = 'failed';
  gate = new Promise<void>((done) => (resolve = done));
  const pending = poller.poll();
  const before = calls;
  await poller.poll();
  assert.equal(calls, before);
  at += 10_001;
  resolve!();
  await pending;
  assert.equal(alerts.length, 1);
  gate = undefined;
  turnId = randomUUID();
  agentState = 'running';
  await poller.poll();
  agentState = 'completed';
  gate = new Promise<void>((done) => (resolve = done));
  const stopping = poller.poll();
  poller.stop();
  resolve!();
  await stopping;
  await poller.poll();
  assert.equal(alerts.length, 1);
});

test('notification preferences reread the existing private DB read-only and fail closed', () => {
  const root = mkdtempSync(join(tmpdir(), 'orqst-owned-notification-prefs-'));
  const admission = join(root, 'managed-agents');
  const core = join(root, 'core');
  mkdirSync(admission, { mode: 0o700 });
  mkdirSync(core, { mode: 0o700 });
  const file = join(core, 'orqst.db');
  const db = new DatabaseSync(file);
  chmodSync(file, 0o600);
  const read = ownedNotificationPreferences(admission);
  try {
    db.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    assert.throws(read, /Missing/);
    db.prepare('INSERT INTO settings VALUES (?,?)').run(
      'notifications',
      JSON.stringify(preferences),
    );
    assert.deepEqual(read(), preferences);
    db.prepare('UPDATE settings SET value=?').run(
      JSON.stringify({ ...preferences, completed: false }),
    );
    assert.equal(read().completed, false);
    db.prepare('UPDATE settings SET value=?').run('{}');
    assert.throws(read);
    chmodSync(file, 0o644);
    assert.throws(read, /Unsafe/);
    chmodSync(file, 0o600);
    symlinkSync(file, `${file}-wal`);
    assert.throws(read, /Unsafe/);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('private native turn alert allows only fixed categories and bounded owned identities', () => {
  const alert = {
    contractVersion: 1,
    kind: 'owned-turn-alert',
    epoch: randomUUID(),
    slot: 0,
    terminalId: randomUUID(),
    turnId: randomUUID(),
    category: 'completed',
    silent: true,
    observedAt: 1000,
  };
  assert.equal(ownedTurnAlertSchema.safeParse(alert).success, true);
  assert.equal(
    ownedTurnAlertSchema.safeParse({ ...alert, category: 'waiting_for_user' }).success,
    true,
  );
  for (const patch of [
    { slot: 8 },
    { terminalId: 'nearby' },
    { category: 'SYNTHETIC-unsupported' },
    { body: 'captured secret content' },
  ])
    assert.equal(ownedTurnAlertSchema.safeParse({ ...alert, ...patch }).success, false);
});
