import assert from 'node:assert/strict';
import test from 'node:test';
import { featureNativeSnapshotSchema, type FeatureNativeReply } from '@orqst/protocol';
import {
  addAlerts,
  communicationNotification,
  confirmedResults,
  focusTarget,
  limitThresholds,
  ownedTurnNotification,
  parseAlertHistory,
} from '../apps/dashboard/src/studio-notifications-model.js';

const terminalId = '00000000-0000-4000-8000-000000000001';
const otherId = '00000000-0000-4000-8000-000000000002';
const featureId = '10000000-0000-4000-8000-000000000001';
const epoch = '10000000-0000-4000-8000-000000000002';
const turnId = '10000000-0000-4000-8000-000000000003';
const messageId = '10000000-0000-4000-8000-000000000004';
const workspaceId = 'synthetic-studio';
const now = 200_000;

const snapshot = featureNativeSnapshotSchema.parse({
  contractVersion: 1,
  storage: 'core',
  generation: 1,
  workspace: { id: workspaceId, name: 'Synthetic workspace' },
  activeFeatureId: featureId,
  features: [
    {
      schemaVersion: 1,
      featureId,
      workspaceId,
      name: 'Synthetic Feature',
      description: '',
      status: 'active',
      terminalIds: [terminalId, otherId],
      revision: 1,
      createdAt: 1,
      updatedAt: 1,
    },
  ],
  view: { contractVersion: 1, storage: 'core', workspaceId, featureId, revision: 1 },
  slots: [
    { slot: 0, terminalId, provider: 'codex' },
    { slot: 1, terminalId: otherId, provider: 'opencode' },
  ],
  layoutSaved: true,
});

const turn = {
  kind: 'owned-turn-alert',
  contractVersion: 1,
  epoch,
  slot: 0,
  terminalId,
  turnId,
  observedAt: now - 1,
  category: 'waiting_for_user',
  silent: true,
};

test('live owned alerts require the same UUID and slot, and exclude completed turns', () => {
  const alert = ownedTurnNotification(turn, snapshot, now);
  assert.equal(alert?.kind, 'waiting_for_user');
  assert.equal(alert?.target?.label, 'T-001');
  assert.equal(alert?.target?.featureId, featureId);
  assert.equal(
    ownedTurnNotification({ ...turn, category: 'failed' }, snapshot, now)?.kind,
    'failed',
  );
  for (const item of [
    { ...turn, category: 'completed' },
    { ...turn, category: 'token_usage' },
    { ...turn, slot: 1 },
    { ...turn, observedAt: now - 10_001 },
    { ...turn, observedAt: now + 1 },
  ])
    assert.equal(ownedTurnNotification(item, snapshot, now), undefined);
});

test('completion requires a fresh, confirmed result beyond the first live snapshot', () => {
  const result = { id: messageId, from: terminalId, to: otherId, kind: 'result', at: now };
  assert.equal(
    confirmedResults({ events: [{ ...result, kind: 'delegation' }] }, snapshot, now - 1, now)
      .length,
    0,
  );
  assert.equal(
    confirmedResults({ events: [{ ...result, kind: 'result' }] }, snapshot, now, now).length,
    0,
  );
  const alerts = confirmedResults(
    { events: [{ ...result, kind: 'result' }] },
    snapshot,
    now - 1,
    now,
  );
  assert.equal(alerts[0]?.kind, 'completed');
  assert.equal(alerts[0]?.target?.terminalId, terminalId);
});

test('delivery and recipient alerts require explicit, scoped communication transitions', () => {
  const audit = {
    sequence: 1,
    action: 'state_changed',
    timestamp: now,
    actorId: null,
    workspaceId,
    featureId,
    paneId: terminalId,
    messageId,
    taskState: 'pending',
  };
  assert.equal(
    communicationNotification({ ...audit, deliveryState: 'delivery_failed' }, snapshot, now)?.kind,
    'delivery_failed',
  );
  assert.equal(
    communicationNotification({ ...audit, deliveryState: 'target_closed' }, snapshot, now)?.kind,
    'recipient_ended',
  );
  assert.equal(
    communicationNotification({ ...audit, deliveryState: 'delivery_unknown' }, snapshot, now),
    undefined,
  );
  assert.equal(
    communicationNotification(
      { ...audit, action: 'pane_state', deliveryState: 'target_closed' },
      snapshot,
      now,
    ),
    undefined,
  );
  assert.equal(
    communicationNotification(
      { ...audit, featureId: epoch, deliveryState: 'target_closed' },
      snapshot,
      now,
    ),
    undefined,
  );
});

test('history survives read and clear without replay, with focus constrained by Feature and UUID', () => {
  const alert = ownedTurnNotification(turn, snapshot, now)!;
  const history = addAlerts(parseAlertHistory(null), [alert, alert], now);
  assert.equal(history.items.length, 1);
  const cleared = { ...history, items: [] };
  assert.equal(addAlerts(cleared, [alert], now), cleared);
  assert.equal(addAlerts(cleared, [alert], now + 10_001), cleared);
  assert.equal(addAlerts(cleared, [{ ...alert, at: now + 10_001 }], now + 10_001), cleared);
  assert.deepEqual(parseAlertHistory(JSON.parse(JSON.stringify(history))), history);
  assert.equal(focusTarget(snapshot, featureId, terminalId)?.slot, 0);
  assert.equal(focusTarget(snapshot, epoch, terminalId), undefined);
  const closed = structuredClone(snapshot);
  closed.slots[0]!.closed = true;
  assert.equal(focusTarget(closed, featureId, terminalId), undefined);
});

test('account alerts require a new report crossing a threshold in the same unexpired window', () => {
  function limits(
    percent: number,
    stamp: number,
    renewal = now + 100,
  ): NonNullable<FeatureNativeReply['accountLimits']> {
    return {
      readAt: stamp,
      accounts: [
        {
          id: 'codex-default',
          provider: 'codex',
          index: 1,
          locked: false,
          updatedAt: stamp,
          windows: [{ id: '5h', label: '5h', usedPercent: percent, resetsAt: renewal }],
        },
      ],
    };
  }
  const caps = { warn: 60, critical: 85 };
  const old = limits(55, now - 1);
  const crossing = limitThresholds(old, limits(62, now), caps, now);
  assert.equal(crossing[0]?.kind, 'limit_threshold');
  assert.equal(crossing[0]?.provider, 'codex');
  assert.deepEqual(limitThresholds(limits(61, now - 1), limits(62, now), caps, now), []);
  assert.deepEqual(limitThresholds(old, limits(62, now, now + 500), caps, now), []);
  assert.deepEqual(limitThresholds(old, limits(62, now - 1), caps, now), []);
  assert.deepEqual(limitThresholds(old, limits(62, now), caps, now + 10_001), []);
});
