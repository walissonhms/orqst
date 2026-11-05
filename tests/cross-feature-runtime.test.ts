// SYNTHETIC trusted authority and in-process transport only.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import test from 'node:test';
import {
  CrossFeatureCommunication,
  crossFeatureIntentDigest,
  type CrossFeatureTransport,
} from '../packages/core/src/communication/cross-feature-communication.js';
import { PaneCommunication } from '../packages/core/src/communication/service.js';
import { fixture } from './helpers/cross-feature-fixture.js';

const ref = (id: string, value: string) => ({
  id,
  bytes: Buffer.byteLength(value),
  sha256: createHash('sha256').update(value).digest('hex'),
});
function configured() {
  const f = fixture();
  const outbound = f.policy('outbound');
  outbound.rules.push(...f.policy('outbound', true).rules);
  const inbound = f.policy('inbound');
  inbound.rules.push(...f.policy('inbound', true).rules);
  f.save('source', 0, outbound);
  f.save('target', 0, inbound);
  const request = {
    ...f.request,
    correlationId: randomUUID(),
    payload: ref('request', 'SYNTHETIC request'),
  };
  const grant = { ...f.grant, intentDigest: crossFeatureIntentDigest(request) };
  return { f, request, grant };
}

test('synthetic structured dispatch persists only correlated provider receipts and outcome', async () => {
  const { f, request, grant } = configured();
  const result = ref('result', 'SYNTHETIC result');
  const transport: CrossFeatureTransport = {
    resolve: (_grant, _purpose, id) =>
      Buffer.from(id === 'request' ? 'SYNTHETIC request' : 'SYNTHETIC result'),
    adapter: () => ({
      ready: () => true,
      submit: async (message, content, evidence) => {
        assert.equal(Buffer.from(content).toString(), 'SYNTHETIC request');
        const base = {
          messageId: message.request.messageId,
          taskId: message.request.taskId,
          correlationId: message.request.correlationId,
          targetPaneId: grant.target.paneId,
          attemptId: message.attemptId!,
          instanceId: grant.target.binding.instanceId,
          terminalEpoch: grant.target.binding.terminalEpoch,
        };
        for (const event of ['accepted', 'delivered', 'started'] as const)
          evidence({ ...base, evidenceId: randomUUID(), event });
        evidence({ ...base, evidenceId: randomUUID(), event: 'completed', result });
      },
    }),
  };
  try {
    const service = new CrossFeatureCommunication(
      f.journal,
      f.config.crossFeatureSnapshot,
      { verify: () => true },
      Date.now,
      transport,
    );
    service.configureRoute(grant, request, 'SYNTHETIC');
    service.admit(grant, request, 'SYNTHETIC');
    const received: string[] = [];
    service.subscribe(request.messageId, grant, 'SYNTHETIC', (m) => received.push(m.state));
    const outcome = await service.dispatch(request.messageId);
    assert.equal(outcome?.state, 'completed');
    assert.deepEqual(outcome?.result, result);
    await Promise.resolve();
    assert.ok(received.includes('completed'));
    assert.deepEqual(
      f.journal.transaction((tx) => tx.crossEvents().map((e) => e.outcome)),
      [
        'admitted',
        'dispatch_claimed',
        'provider_evidence',
        'provider_evidence',
        'provider_evidence',
        'provider_evidence',
      ],
    );
  } finally {
    f.close();
  }
});
test('missing receipt is unknown and a mismatched receipt cannot create evidence', async () => {
  const { f, request, grant } = configured();
  const transport: CrossFeatureTransport = {
    resolve: () => Buffer.from('SYNTHETIC request'),
    adapter: () => ({
      ready: () => true,
      submit: async (message, _content, evidence) => {
        evidence({
          messageId: message.request.messageId,
          taskId: message.request.taskId,
          correlationId: randomUUID(),
          targetPaneId: grant.target.paneId,
          attemptId: message.attemptId!,
          instanceId: grant.target.binding.instanceId,
          terminalEpoch: grant.target.binding.terminalEpoch,
          evidenceId: randomUUID(),
          event: 'accepted',
        });
      },
    }),
  };
  try {
    const service = new CrossFeatureCommunication(
      f.journal,
      f.config.crossFeatureSnapshot,
      { verify: () => true },
      Date.now,
      transport,
    );
    service.configureRoute(grant, request, 'SYNTHETIC');
    service.admit(grant, request, 'SYNTHETIC');
    assert.equal((await service.dispatch(request.messageId))?.state, 'outcome_unknown');
    assert.equal(await service.dispatch(request.messageId), undefined);
    assert.equal(
      f.journal.transaction((tx) =>
        tx.crossEvents().some((e) => e.outcome === 'provider_evidence'),
      ),
      false,
    );
  } finally {
    f.close();
  }
});
test('microtask rechecks bilateral view after revocation', async () => {
  const { f, request, grant } = configured();
  try {
    const service = new CrossFeatureCommunication(f.journal, f.config.crossFeatureSnapshot, {
      verify: () => true,
    });
    service.configureRoute(grant, request, 'SYNTHETIC');
    service.admit(grant, request, 'SYNTHETIC');
    const seen: string[] = [];
    service.subscribe(request.messageId, grant, 'SYNTHETIC', (m) => seen.push(m.state));
    assert.equal(service.claim(request.messageId)?.state, 'dispatching');
    f.save('target', 1, { schemaVersion: 1, rules: [] });
    await Promise.resolve();
    assert.deepEqual(seen, []);
    assert.equal(service.view(request.messageId, grant, 'SYNTHETIC'), undefined);
  } finally {
    f.close();
  }
});
test('verified issuance, admission denial and revocation have separate administrative audits', () => {
  const f = fixture();
  try {
    const service = new CrossFeatureCommunication(f.journal, f.config.crossFeatureSnapshot, {
      verify: () => true,
    });
    assert.throws(() => service.admit(f.grant, f.request, 'SYNTHETIC'));
    f.save('source', 0, f.policy('outbound'));
    f.save('target', 0, f.policy('inbound'));
    service.admit(f.grant, f.request, 'SYNTHETIC');
    service.revoke(f.request.messageId, f.grant, 'SYNTHETIC');
    assert.deepEqual(
      f.journal.transaction((tx) => tx.crossAuthorityEvents().map((e) => e.outcome)),
      ['denied', 'grant_issued', 'revoked'],
    );
    assert.equal(service.claim(f.request.messageId), undefined);
  } finally {
    f.close();
  }
});
test('exact Feature handles reject missing and ambiguous results', () => {
  const f = fixture();
  const db = new DatabaseSync(join(f.dir, 'journal.sqlite'));
  try {
    assert.equal(
      f.service.resolveTarget('synthetic', f.target.featureId, 'test2').paneId,
      f.grant.target.paneId,
    );
    assert.throws(() => f.service.resolveTarget('synthetic', f.target.featureId, 'absent'));
    const pane = f.journal.transaction((tx) =>
      tx.panes().find((p) => p.paneId === f.grant.target.paneId)!,
    );
    const clone = {
      ...pane,
      paneId: randomUUID(),
      displayId: 'T-999',
      terminalId: randomUUID(),
      binding: { ...pane.binding!, instanceId: randomUUID() },
    };
    db.prepare('INSERT INTO communication_panes VALUES (?,?,?,?)').run(
      clone.paneId,
      clone.workspaceId,
      clone.displayId,
      JSON.stringify(clone),
    );
    assert.throws(
      () => f.service.resolveTarget('synthetic', f.target.featureId, 'test2'),
      /ambiguous/,
    );
    assert.throws(() => f.service.resolveTarget('foreign', f.target.featureId, 'test2'));
  } finally {
    db.close();
    f.close();
  }
});

test('a cross request accepts an exact active local parent and rejects mismatched correlation', () => {
  const { f, request: base, grant: baseGrant } = configured();
  try {
    const terminalId = randomUUID();
    f.config.assignTerminal(f.source.featureId, terminalId, f.source.revision);
    const target = f.journal.transaction((tx) =>
      tx.panes().find((p) => p.paneId === baseGrant.source.paneId)!,
    );
    const local = new PaneCommunication(
      f.journal,
      () => Buffer.from('SYNTHETIC local'),
      Date.now,
      f.config.permissionReader,
    );
    const source = local.registerPane({
      workspaceId: 'synthetic',
      featureId: f.source.featureId,
      terminalId,
      name: 'SYNTHETIC parent',
      routing: { handle: 'parent', role: 'worker', allowedTargetPaneIds: [] },
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
    local.configureRouting(source.paneId, {
      name: source.name,
      ...source.routing!,
      allowedTargetPaneIds: [target.paneId],
    });
    const client = local.authorize({
      actorId: 'SYNTHETIC_parent',
      workspaceId: 'synthetic',
      featureId: f.source.featureId,
      sourcePaneId: source.paneId,
      targetPaneIds: [target.paneId],
      expiresAt: Date.now() + 300000,
    });
    const correlationId = randomUUID();
    const parent = client.send({
      schemaVersion: 1,
      messageId: randomUUID(),
      taskId: randomUUID(),
      correlationId,
      workspaceId: 'synthetic',
      featureId: f.source.featureId,
      sourcePaneId: source.paneId,
      targetPaneId: target.paneId,
      parentTaskId: null,
      kind: 'task.request',
      payload: ref('local', 'SYNTHETIC local'),
      deliveryPolicy: 'queue-if-busy',
      idempotencyKey: randomUUID(),
      deadline: Date.now() + 240000,
    });
    const service = new CrossFeatureCommunication(f.journal, f.config.crossFeatureSnapshot, {
      verify: () => true,
    });
    const bad = { ...base, parentTaskId: parent.taskId, correlationId: randomUUID() };
    const badGrant = { ...baseGrant, intentDigest: crossFeatureIntentDigest(bad) };
    service.configureRoute(badGrant, bad, 'SYNTHETIC');
    assert.throws(() => service.admit(badGrant, bad, 'SYNTHETIC'), /parent/);
    const request = { ...base, parentTaskId: parent.taskId, correlationId };
    const grant = { ...baseGrant, intentDigest: crossFeatureIntentDigest(request) };
    service.configureRoute(grant, request, 'SYNTHETIC');
    assert.equal(service.admit(grant, request, 'SYNTHETIC').depth, 1);
  } finally {
    f.close();
  }
});

test('provider evidence remains durable after view permission revocation', async () => {
  const { f, request, grant } = configured();
  let resume!: () => void;
  const barrier = new Promise<void>((resolve) => {
    resume = resolve;
  });
  const transport: CrossFeatureTransport = {
    resolve: () => Buffer.from('SYNTHETIC request'),
    adapter: () => ({
      ready: () => true,
      submit: async (message, _content, evidence) => {
        const base = {
          messageId: message.request.messageId,
          taskId: message.request.taskId,
          correlationId: message.request.correlationId,
          targetPaneId: grant.target.paneId,
          attemptId: message.attemptId!,
          instanceId: grant.target.binding.instanceId,
          terminalEpoch: grant.target.binding.terminalEpoch,
        };
        evidence({ ...base, evidenceId: randomUUID(), event: 'accepted' });
        await barrier;
        evidence({ ...base, evidenceId: randomUUID(), event: 'started' });
        evidence({ ...base, evidenceId: randomUUID(), event: 'failed' });
      },
    }),
  };
  try {
    const service = new CrossFeatureCommunication(
      f.journal,
      f.config.crossFeatureSnapshot,
      { verify: () => true },
      Date.now,
      transport,
    );
    service.configureRoute(grant, request, 'SYNTHETIC');
    service.admit(grant, request, 'SYNTHETIC');
    const pending = service.dispatch(request.messageId);
    f.save('target', 1, { schemaVersion: 1, rules: [] });
    resume();
    assert.equal((await pending)?.state, 'failed');
    assert.equal(service.view(request.messageId, grant, 'SYNTHETIC'), undefined);
  } finally {
    resume();
    f.close();
  }
});

test('cross child rejects a parent chain exceeding the shared depth bound', () => {
  const { f, request: base, grant: baseGrant } = configured();
  try {
    const local = new PaneCommunication(
      f.journal,
      () => Buffer.from('SYNTHETIC local'),
      Date.now,
      f.config.permissionReader,
    );
    let feature = f.source;
    const target = f.journal.transaction((tx) =>
      tx.panes().find((p) => p.paneId === baseGrant.source.paneId)!,
    );
    const panes = [];
    for (let i = 0; i < 4; i++) {
      const terminalId = randomUUID();
      feature = f.config.assignTerminal(feature.featureId, terminalId, feature.revision);
      panes.push(
        local.registerPane({
          workspaceId: 'synthetic',
          featureId: feature.featureId,
          terminalId,
          name: `SYNTHETIC depth ${i}`,
          routing: { handle: `depth${i}`, role: 'worker', allowedTargetPaneIds: [] },
          provider: 'synthetic',
          cliVersion: null,
          model: null,
          ownership: 'managed',
          ownerId: 'synthetic',
          creationReason: 'SYNTHETIC',
          binding: {
            instanceId: randomUUID(),
            projectId: 'synthetic',
            terminalEpoch: randomUUID(),
          },
          capabilities: target.capabilities,
          state: 'ready',
        }),
      );
    }
    const correlationId = randomUUID();
    let parentTaskId: string | null = null;
    for (let i = 0; i < panes.length; i++) {
      const source = panes[i]!,
        next = panes[i + 1] ?? target;
      local.configureRouting(source.paneId, {
        name: source.name,
        ...source.routing!,
        allowedTargetPaneIds: [next.paneId],
      });
      const client = local.authorize({
        actorId: 'SYNTHETIC_parent',
        workspaceId: 'synthetic',
        featureId: feature.featureId,
        sourcePaneId: source.paneId,
        targetPaneIds: [next.paneId],
        expiresAt: Date.now() + 300000,
      });
      const parent = client.send({
        schemaVersion: 1,
        messageId: randomUUID(),
        taskId: randomUUID(),
        correlationId,
        workspaceId: 'synthetic',
        featureId: feature.featureId,
        sourcePaneId: source.paneId,
        targetPaneId: next.paneId,
        parentTaskId,
        kind: 'task.request',
        payload: ref('local', 'SYNTHETIC local'),
        deliveryPolicy: 'queue-if-busy',
        idempotencyKey: randomUUID(),
        deadline: Date.now() + 240000,
      });
      parentTaskId = parent.taskId;
    }
    const request = { ...base, parentTaskId, correlationId };
    const grant = { ...baseGrant, intentDigest: crossFeatureIntentDigest(request) };
    const service = new CrossFeatureCommunication(f.journal, f.config.crossFeatureSnapshot, {
      verify: () => true,
    });
    service.configureRoute(grant, request, 'SYNTHETIC');
    assert.throws(() => service.admit(grant, request, 'SYNTHETIC'), /depth/);
  } finally {
    f.close();
  }
});
