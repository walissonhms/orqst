// SYNTHETIC in-process adapters and disposable SQLite only.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import {
  PaneCommunication,
  type CommunicationAdapter,
} from '../packages/core/src/communication/service.js';
import {
  CrossFeatureCommunication,
  crossFeatureIntentDigest,
} from '../packages/core/src/communication/cross-feature-communication.js';
import { fixture } from './helpers/cross-feature-fixture.js';

function localPeer(f: ReturnType<typeof fixture>, adapter: CommunicationAdapter) {
  const terminalId = randomUUID();
  f.config.assignTerminal(f.target.featureId, terminalId, f.target.revision);
  const target = f.journal.transaction((tx) =>
    tx.panes().find((p) => p.paneId === f.grant.target.paneId)!,
  );
  const service = new PaneCommunication(
    f.journal,
    () => Buffer.from('SYNTHETIC local'),
    Date.now,
    f.config.permissionReader,
  );
  const source = service.registerPane({
    workspaceId: 'synthetic',
    featureId: f.target.featureId,
    terminalId,
    name: 'SYNTHETIC local source',
    routing: { handle: 'localpeer', role: 'worker', allowedTargetPaneIds: [] },
    provider: 'synthetic',
    cliVersion: null,
    model: null,
    ownership: 'managed',
    ownerId: 'synthetic',
    creationReason: 'SYNTHETIC',
    binding: { instanceId: randomUUID(), projectId: 'synthetic', terminalEpoch: randomUUID() },
    capabilities: target.capabilities,
    state: 'ready',
  });
  service.configureRouting(source.paneId, {
    name: source.name,
    ...source.routing!,
    allowedTargetPaneIds: [target.paneId],
  });
  service.enrollAdapter(target.paneId, target.binding!, adapter);
  const authorize = (actorId = 'SYNTHETIC_actor') =>
    service.authorize({
      actorId,
      workspaceId: 'synthetic',
      featureId: f.target.featureId,
      sourcePaneId: source.paneId,
      targetPaneIds: [target.paneId],
      expiresAt: Date.now() + 300000,
    });
  const request = () => ({
    schemaVersion: 1 as const,
    messageId: randomUUID(),
    taskId: randomUUID(),
    correlationId: randomUUID(),
    workspaceId: 'synthetic',
    featureId: f.target.featureId,
    sourcePaneId: source.paneId,
    targetPaneId: target.paneId,
    parentTaskId: null,
    kind: 'task.request' as const,
    payload: {
      id: 'synthetic',
      bytes: 15,
      sha256: createHash('sha256').update('SYNTHETIC local').digest('hex'),
    },
    deliveryPolicy: 'queue-if-busy' as const,
    idempotencyKey: randomUUID(),
    deadline: Date.now() + 240000,
  });
  return { service, target, authorize, request };
}
function allowed(f: ReturnType<typeof fixture>) {
  f.save('source', 0, f.policy('outbound'));
  f.save('target', 0, f.policy('inbound'));
}
const inactive: CommunicationAdapter = { ready: () => true, submit: async () => {} };

test('cross claim blocks local dispatch to the same target', async () => {
  const f = fixture();
  try {
    allowed(f);
    const local = localPeer(f, inactive);
    const client = local.authorize();
    f.service.admit(f.grant, f.request, 'SYNTHETIC-proof');
    assert.equal(f.service.claim(f.request.messageId)?.state, 'dispatching');
    client.send(local.request());
    assert.equal(await local.service.dispatchNext(local.target.paneId), undefined);
  } finally {
    f.close();
  }
});
test('local dispatch blocks a cross claim to the same target', async () => {
  const f = fixture();
  let finish!: () => void;
  const release = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const adapter: CommunicationAdapter = {
    ready: () => true,
    submit: async (m, _bytes, evidence) => {
      evidence({
        messageId: m.messageId,
        taskId: m.taskId,
        correlationId: m.correlationId,
        targetPaneId: m.targetPaneId,
        attemptId: m.attemptId!,
        instanceId: f.grant.target.binding.instanceId,
        terminalEpoch: f.grant.target.binding.terminalEpoch,
        evidenceId: randomUUID(),
        event: 'accepted',
      });
      await release;
    },
  };
  try {
    allowed(f);
    const local = localPeer(f, adapter);
    const client = local.authorize();
    client.send(local.request());
    const dispatch = local.service.dispatchNext(local.target.paneId);
    f.service.admit(f.grant, f.request, 'SYNTHETIC-proof');
    assert.equal(f.service.claim(f.request.messageId), undefined);
    finish();
    await dispatch;
  } finally {
    finish();
    f.close();
  }
});
test('local admissions count toward cross rate; cross admissions count toward local rate', () => {
  const f = fixture();
  try {
    allowed(f);
    const local = localPeer(f, inactive);
    const client = local.authorize();
    for (let i = 0; i < 30; i++) client.send(local.request());
    assert.throws(() => f.service.admit(f.grant, f.request, 'SYNTHETIC-proof'), /rate/);
  } finally {
    f.close();
  }
  const g = fixture();
  try {
    allowed(g);
    const local = localPeer(g, inactive);
    const client = local.authorize();
    const service = new CrossFeatureCommunication(g.journal, g.config.crossFeatureSnapshot, {
      verify: () => true,
    });
    for (let i = 0; i < 30; i++) {
      const request = {
        ...g.request,
        messageId: randomUUID(),
        taskId: randomUUID(),
        idempotencyKey: randomUUID(),
      };
      const grant = {
        ...g.grant,
        grantId: randomUUID(),
        intentId: randomUUID(),
        nonce: randomUUID(),
        intentDigest: crossFeatureIntentDigest(request),
      };
      service.admit(grant, request, 'SYNTHETIC');
    }
    assert.throws(() => client.send(local.request()), /rate/);
  } finally {
    g.close();
  }
});
test('failure in shared usage bookkeeping rolls back cross admission', () => {
  const f = fixture();
  const db = new DatabaseSync(join(f.dir, 'journal.sqlite'));
  try {
    allowed(f);
    db.exec(
      "CREATE TRIGGER synthetic_usage_failure BEFORE INSERT ON cross_feature_usage BEGIN SELECT RAISE(ABORT,'SYNTHETIC usage failure'); END",
    );
    assert.throws(() => f.service.admit(f.grant, f.request, 'SYNTHETIC-proof'), /usage failure/);
    assert.equal(
      f.journal.transaction((tx) => tx.crossMessages().length),
      0,
    );
    assert.equal(
      f.journal.transaction((tx) => tx.crossEvents().length),
      0,
    );
  } finally {
    db.close();
    f.close();
  }
});

test('local and cross queues share the per-target limit in both directions', () => {
  const f = fixture();
  try {
    allowed(f);
    const local = localPeer(f, inactive);
    const first = local.authorize('SYNTHETIC_first');
    const second = local.authorize('SYNTHETIC_second');
    for (let i = 0; i < 32; i++) (i < 16 ? first : second).send(local.request());
    assert.throws(() => f.service.admit(f.grant, f.request, 'SYNTHETIC-proof'), /queue/);
    assert.equal(
      f.journal.transaction((tx) => tx.crossMessages().length),
      0,
    );
  } finally {
    f.close();
  }
  const g = fixture();
  try {
    allowed(g);
    const local = localPeer(g, inactive);
    const client = local.authorize('SYNTHETIC_third');
    const service = new CrossFeatureCommunication(g.journal, g.config.crossFeatureSnapshot, {
      verify: () => true,
    });
    for (let i = 0; i < 32; i++) {
      const request = {
        ...g.request,
        messageId: randomUUID(),
        taskId: randomUUID(),
        idempotencyKey: randomUUID(),
      };
      const grant = {
        ...g.grant,
        actorId: i < 16 ? 'SYNTHETIC_first' : 'SYNTHETIC_second',
        grantId: randomUUID(),
        intentId: randomUUID(),
        nonce: randomUUID(),
        intentDigest: crossFeatureIntentDigest(request),
      };
      service.admit(grant, request, 'SYNTHETIC');
    }
    assert.throws(() => client.send(local.request()), /Queue/);
    assert.equal(
      g.journal.transaction((tx) => tx.messages().length),
      0,
    );
  } finally {
    g.close();
  }
});
