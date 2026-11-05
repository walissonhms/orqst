// SYNTHETIC Feature metadata and structured adapters only; no provider, credentials or owned process.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { Store } from '@orqst/database';
import {
  terminalTeamSchema,
  terminalLayoutRecordSchema,
  type CommunicationPane,
} from '@orqst/protocol';
import { featureConfigurationDatabase } from '../packages/core/src/terminal/feature-configuration.js';
import { terminalTeamDatabase } from '../packages/core/src/terminal/team-database.js';
import { terminalDigest } from '../packages/core/src/terminal/authority.js';
import { terminalPairRPCSchema } from '../packages/core/src/terminal/rpc.js';
import { PaneCommunication } from '../packages/core/src/communication/service.js';
import { mentionedHandles } from '../packages/core/src/communication/mentions.js';

const workspace = terminalDigest('SYNTHETIC project');
function fixture() {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'orqst-synthetic-features-')));
  chmodSync(directory, 0o700);
  return {
    directory,
    core: featureConfigurationDatabase(directory, workspace),
    close: () => rmSync(directory, { recursive: true, force: true }),
  };
}
function team(ids: string[], name = 'SYNTHETIC team') {
  return terminalTeamSchema.parse({
    version: 1,
    name,
    members: ids.map((terminalId, index) => ({
      terminalId,
      name: `SYNTHETIC ${index}`,
      handle: index === 0 ? 'backend' : `member-${index}`,
      role: index === 0 ? 'orchestrator' : 'worker',
      allowedTargetTerminalIds: ids.slice(index + 1, index + 2),
    })),
  });
}
const layout = (ids: string[], columns = 2) =>
  terminalLayoutRecordSchema.parse({
    version: 1,
    order: ids,
    shown: ids,
    active: ids[0],
    maximized: null,
    axis: 'columns',
    columns,
    percent: 50,
    names: [],
  });

test('orchestrator label is a revisioned, persisted Feature member and grants nothing', () => {
  const f = fixture();
  try {
    let feature = f.core.create({ name: 'SYNTHETIC label' });
    const member = randomUUID();
    const foreign = randomUUID();
    feature = f.core.assignTerminal(feature.featureId, member, feature.revision);
    assert.throws(
      () =>
        f.core.update(feature.featureId, {
          expectedRevision: feature.revision,
          orchestratorTerminalId: foreign,
        }),
      /member/,
    );
    assert.equal(f.core.read(feature.featureId).revision, feature.revision);
    feature = f.core.update(feature.featureId, {
      expectedRevision: feature.revision,
      orchestratorTerminalId: member,
    });
    assert.equal(feature.orchestratorTerminalId, member);
    assert.equal(
      featureConfigurationDatabase(f.directory, workspace).read(feature.featureId)
        .orchestratorTerminalId,
      member,
    );
    assert.deepEqual(f.core.readTeam(feature.featureId), { revision: 0, configuration: null });
    assert.throws(
      () =>
        f.core.update(feature.featureId, {
          expectedRevision: feature.revision - 1,
          orchestratorTerminalId: null,
        }),
      /Stale/,
    );
    feature = f.core.update(feature.featureId, {
      expectedRevision: feature.revision,
      orchestratorTerminalId: null,
    });
    assert.equal(feature.orchestratorTerminalId, null);
  } finally {
    f.close();
  }
});

test('V6 Features survive reopen with independent teams/aliases/layouts and actual metadata audit', () => {
  const f = fixture();
  try {
    const features = [3, 2, 1].map((count, index) => {
      let feature = f.core.create({
        name: `SYNTHETIC Feature ${index}`,
        description: 'SYNTHETIC description',
      });
      assert.deepEqual(f.core.readTeam(feature.featureId), { revision: 0, configuration: null });
      assert.equal(f.core.readLayout(feature.featureId), null);
      for (let i = 0; i < count; i++)
        feature = f.core.assignTerminal(feature.featureId, randomUUID(), feature.revision);
      f.core.saveTeam(feature.featureId, {
        expectedRevision: 0,
        configuration: team(feature.terminalIds, feature.name),
      });
      f.core.saveLayout(feature.featureId, layout(feature.terminalIds, index + 1));
      return feature;
    });
    const reopened = featureConfigurationDatabase(f.directory, workspace);
    assert.deepEqual(reopened.list(), features);
    for (const [index, feature] of features.entries()) {
      assert.equal(
        reopened.readTeam(feature.featureId).configuration?.members[0]?.handle,
        'backend',
      );
      assert.equal(reopened.readLayout(feature.featureId)?.columns, index + 1);
      assert.deepEqual(
        reopened.events(feature.featureId).map((event) => event.action),
        ['feature.created', ...feature.terminalIds.map(() => 'feature.terminal_added')],
      );
      const revision = reopened.readTeam(feature.featureId).revision;
      assert.throws(
        () =>
          reopened.saveTeam(feature.featureId, {
            expectedRevision: revision - 1,
            configuration: team(feature.terminalIds),
          }),
        /Stale/,
      );
    }
    assert.throws(
      () =>
        reopened.saveTeam(features[0]!.featureId, {
          expectedRevision: 1,
          configuration: team(features[1]!.terminalIds),
        }),
      /selection/,
    );
    assert.throws(
      () => reopened.saveLayout(features[0]!.featureId, layout(features[1]!.terminalIds)),
      /selection/,
    );
    const other = featureConfigurationDatabase(
      f.directory,
      terminalDigest('SYNTHETIC another project'),
    );
    assert.deepEqual(other.list(), []);
    assert.throws(() => other.read(features[0]!.featureId), /workspace/);
    assert.throws(() => other.readTeam(features[0]!.featureId), /workspace/);
    const raw = new DatabaseSync(join(f.directory, 'terminal-layouts/preferences.sqlite'));
    try {
      assert.equal(
        raw
          .prepare(
            "SELECT COUNT(*) AS n FROM sqlite_master WHERE name IN ('terminal_owner','terminal_attempts','communication_owner','communication_messages')",
          )
          .get()?.n,
        0,
      );
    } finally {
      raw.close();
    }
  } finally {
    f.close();
  }
});

test('Feature assignment/revision/archive safeguards preserve legacy JSON, layouts and execution evidence', () => {
  const f = fixture();
  try {
    mkdirSync(join(f.directory, 'terminal-layouts'), { mode: 0o700 });
    const original = join(f.directory, 'terminal-layouts', 'SYNTHETIC-original.json');
    writeFileSync(original, 'SYNTHETIC ORIGINAL\n', { mode: 0o600 });
    const first = f.core.create({ name: 'SYNTHETIC first' });
    const second = f.core.create({ name: 'SYNTHETIC second' });
    const terminalId = randomUUID();
    const assigned = f.core.assignTerminal(first.featureId, terminalId, first.revision);
    assert.throws(
      () => f.core.assignTerminal(second.featureId, terminalId, second.revision),
      /already assigned/,
    );
    assert.throws(
      () => f.core.assignTerminal(first.featureId, randomUUID(), first.revision),
      /Stale/,
    );
    assert.throws(
      () =>
        f.core.update(first.featureId, {
          expectedRevision: assigned.revision,
          name: assigned.name,
          status: 'archived',
        }),
      /lifecycle/,
    );
    const renamed = f.core.update(first.featureId, {
      expectedRevision: assigned.revision,
      name: 'SYNTHETIC renamed',
      status: 'blocked',
    });
    assert.equal(renamed.featureId, first.featureId);
    assert.equal(renamed.status, 'blocked');
    const nameOnly = f.core.update(first.featureId, {
      expectedRevision: renamed.revision,
      name: 'SYNTHETIC name only',
    });
    assert.equal(nameOnly.status, 'blocked');
    assert.equal(nameOnly.description, renamed.description);
    assert.deepEqual(renamed.terminalIds, [terminalId]);
    const archived = f.core.update(second.featureId, {
      expectedRevision: second.revision,
      name: second.name,
      status: 'archived',
    });
    assert.throws(
      () => f.core.assignTerminal(second.featureId, randomUUID(), archived.revision),
      /Archived/,
    );
    const legacy = terminalTeamDatabase(f.directory, [terminalId], workspace);
    legacy.save({ expectedRevision: 0, configuration: team([terminalId]) });
    assert.deepEqual(f.core.readTeam(first.featureId), { revision: 0, configuration: null });
    f.core.saveTeam(first.featureId, {
      expectedRevision: 0,
      configuration: team([terminalId], 'SYNTHETIC Feature proposal'),
    });
    assert.equal(legacy.read().configuration?.name, 'SYNTHETIC team');
    assert.equal(readFileSync(original, 'utf8'), 'SYNTHETIC ORIGINAL\n');
    assert.throws(() => f.core.create({ name: 'SYNTHETIC', pid: 12 } as { name: string }));
    assert.throws(() =>
      f.core.update(first.featureId, {
        expectedRevision: renamed.revision,
        name: 'SYNTHETIC',
        status: 'unknown',
      }),
    );
  } finally {
    f.close();
  }
});

test('private Feature command schema fixes workspace externally and assigns only reviewed numeric slots', () => {
  const id = randomUUID();
  assert.equal(
    terminalPairRPCSchema.safeParse({ kind: 'featureCreate', id, input: { name: 'SYNTHETIC' } })
      .success,
    true,
  );
  assert.equal(
    terminalPairRPCSchema.safeParse({
      kind: 'featureCreate',
      id,
      input: { name: 'SYNTHETIC', workspaceId: 'foreign' },
    }).success,
    false,
  );
  assert.equal(
    terminalPairRPCSchema.safeParse({
      kind: 'featureAssign',
      id,
      featureId: randomUUID(),
      terminalId: randomUUID(),
      expectedRevision: 1,
    }).success,
    false,
  );
  assert.equal(
    terminalPairRPCSchema.safeParse({
      kind: 'featureAssign',
      id,
      featureId: randomUUID(),
      slot: 8,
      expectedRevision: 1,
    }).success,
    false,
  );
  assert.equal(
    terminalPairRPCSchema.safeParse({
      kind: 'featureTeamSave',
      id,
      featureId: randomUUID(),
      input: { expectedRevision: 0, configuration: { ...team([randomUUID()]), grant: 'forged' } },
    }).success,
    false,
  );
});

function communicationFixture(file = ':memory:') {
  const store = new Store(file);
  const journal = store.communicationJournal(randomUUID(), { recover: false });
  const bytes = Buffer.from('SYNTHETIC Feature task');
  const service = new PaneCommunication(
    journal,
    () => bytes,
    Date.now,
    (scope) =>
      store.transaction(() => ({
        feature: store.features().read(scope),
        permissions: store.featurePermissions().read(scope),
      })),
  );
  let dispatched = 0;
  const register = (featureId: string | undefined, handle: string) => {
    const pane = service.registerPane(
      {
        workspaceId: workspace,
        ...(featureId ? { featureId } : {}),
        terminalId: randomUUID(),
        name: `SYNTHETIC ${handle}`,
        routing: { handle, role: 'worker', allowedTargetPaneIds: [] },
        provider: 'SYNTHETIC',
        cliVersion: null,
        model: null,
        ownership: 'managed',
        ownerId: 'synthetic',
        creationReason: 'synthetic',
        binding: { instanceId: randomUUID(), projectId: workspace, terminalEpoch: randomUUID() },
        capabilities: {
          canSend: true,
          canQueueWhileBusy: true,
          canAcknowledge: true,
          canReportTaskCompletion: true,
          canCancel: true,
        },
        state: 'ready',
      },
      {
        ready: () => true,
        submit: async () => {
          dispatched++;
        },
      },
    );
    const feature = store
      .features()
      .list(workspace)
      .find((item) => item.featureId === featureId);
    if (feature)
      store
        .features()
        .assignTerminal(
          { workspaceId: feature.workspaceId, featureId: feature.featureId },
          pane.terminalId!,
          feature.revision,
        );
    return pane;
  };
  const createFeature = () =>
    store.features().create({ workspaceId: workspace, name: 'SYNTHETIC scope' }).featureId;
  const allow = (source: CommunicationPane, target: CommunicationPane) =>
    service.configureRouting(source.paneId, {
      name: source.name,
      ...source.routing!,
      allowedTargetPaneIds: [target.paneId],
    });
  const grant = (source: CommunicationPane, target: CommunicationPane) =>
    service.authorize({
      actorId: 'synthetic',
      workspaceId: workspace,
      ...(source.featureId ? { featureId: source.featureId } : {}),
      sourcePaneId: source.paneId,
      targetPaneIds: [target.paneId],
      expiresAt: Date.now() + 60000,
    });
  const request = (source: CommunicationPane, target: CommunicationPane) => ({
    schemaVersion: 1,
    messageId: randomUUID(),
    taskId: randomUUID(),
    correlationId: randomUUID(),
    workspaceId: workspace,
    ...(source.featureId ? { featureId: source.featureId } : {}),
    sourcePaneId: source.paneId,
    targetPaneId: target.paneId,
    parentTaskId: null,
    kind: 'task.request',
    payload: { id: 'synthetic', sha256: terminalDigest(bytes), bytes: bytes.length },
    deliveryPolicy: 'queue-if-busy',
    idempotencyKey: randomUUID(),
    deadline: Date.now() + 30000,
  });
  return {
    store,
    journal,
    service,
    register,
    createFeature,
    allow,
    grant,
    request,
    dispatched: () => dispatched,
  };
}

test('same alias in two Features resolves locally; legacy and explicit scopes never share routing/grants', async () => {
  const f = communicationFixture();
  try {
    const featureA = f.createFeature(),
      featureB = f.createFeature();
    const a = f.register(featureA, 'source'),
      b = f.register(featureA, 'backend');
    const c = f.register(featureB, 'source'),
      d = f.register(featureB, 'backend');
    const legacy = f.register(undefined, 'backend');
    assert.equal(
      f.service.resolveMention(workspace, '@backend SYNTHETIC', featureA).paneId,
      b.paneId,
    );
    assert.equal(
      f.service.resolveMention(workspace, '@backend SYNTHETIC', featureB).paneId,
      d.paneId,
    );
    assert.equal(f.service.resolveMention(workspace, '@backend SYNTHETIC').paneId, legacy.paneId);
    assert.throws(() => f.register(featureA, 'backend'), /handle/);
    assert.deepEqual(mentionedHandles('@auth/backend SYNTHETIC'), ['auth/backend']);
    assert.throws(
      () => f.service.resolveMention(workspace, '@auth/backend SYNTHETIC', featureA),
      /unavailable/,
    );
    assert.throws(
      () => f.service.resolveMention(workspace, '@backend SYNTHETIC', randomUUID()),
      /unavailable/,
    );
    assert.throws(() => f.allow(a, d), /denied/);
    assert.throws(() => f.allow(a, legacy), /denied/);
    assert.throws(() => f.grant(a, b), /permission/);
    f.allow(a, b);
    f.allow(c, d);
    assert.throws(() => f.grant(a, d), /scope/);
    assert.throws(() => f.grant(a, legacy), /scope/);
    assert.throws(
      () =>
        f.service.authorize({
          actorId: 'synthetic',
          workspaceId: workspace,
          sourcePaneId: a.paneId,
          targetPaneIds: [b.paneId],
          expiresAt: Date.now() + 60000,
        }),
      /scope/,
    );
    const client = f.grant(a, b);
    const other = f.grant(c, d);
    assert.throws(() => client.send({ ...f.request(a, b), featureId: featureB }), /denied/);
    const queued = client.send(f.request(a, b));
    assert.equal(queued.featureId, featureA);
    assert.throws(() => other.status(queued.messageId), /unavailable/);
    assert.throws(
      () =>
        f.journal.transaction((tx) =>
          tx.savePane({
            ...a,
            featureId: featureB,
            routing: { ...a.routing!, handle: 'tampered-identity' },
          }),
        ),
      /Immutable/,
    );
    assert.throws(
      () => f.journal.transaction((tx) => tx.savePane({ ...a, terminalId: randomUUID() })),
      /Immutable/,
    );
    const renamed = f.service.configureRouting(b.paneId, {
      name: b.name,
      ...b.routing!,
      handle: 'reviewer',
    });
    assert.equal(renamed.paneId, queued.targetPaneId);
    await f.service.dispatchNext(b.paneId);
    assert.equal(f.dispatched(), 1);
    const audits = client.events(0);
    assert.ok(audits.some((event) => event.action === 'denied' && event.featureId === featureA));
    assert.ok(audits.every((event) => event.featureId === featureA));
  } finally {
    f.store.close();
  }
});

test('Feature journal recovery preserves scope but restores no grants or adapters', async () => {
  const f = fixture();
  const file = join(f.directory, 'SYNTHETIC-communication.sqlite');
  const first = communicationFixture(file);
  const featureId = first.createFeature();
  const a = first.register(featureId, 'source'),
    b = first.register(featureId, 'backend');
  first.allow(a, b);
  const client = first.grant(a, b);
  const queued = client.send(first.request(a, b));
  first.store.close();
  const reopened = new Store(file);
  try {
    const journal = reopened.communicationJournal(randomUUID(), { recover: true });
    const service = new PaneCommunication(journal, () => {
      throw new Error('No restored content');
    });
    const restored = journal.transaction((tx) => tx.messages()[0]!);
    assert.equal(restored.featureId, featureId);
    assert.equal(restored.messageId, queued.messageId);
    await service.dispatchNext(b.paneId);
    assert.equal(first.dispatched(), 0);
    assert.equal(
      journal.transaction((tx) => tx.messages()[0]!.taskState),
      'pending',
    );
    assert.equal(
      journal.transaction((tx) => tx.messages()[0]!.deliveryState),
      'queued',
    );
    assert.equal(
      journal.transaction((tx) => tx.panes().find((p) => p.paneId === b.paneId)?.featureId),
      featureId,
    );
  } finally {
    reopened.close();
    f.close();
  }
});

test('saved Feature policy only becomes a proposal after exact fresh live identity validation', () => {
  const f = fixture();
  const live = communicationFixture();
  try {
    let feature = f.core.create({ name: 'SYNTHETIC live proposal' });
    const source = live.register(feature.featureId, 'source');
    const target = live.register(feature.featureId, 'backend');
    for (const pane of [source, target])
      feature = f.core.assignTerminal(feature.featureId, pane.terminalId!, feature.revision);
    const configuration = team(feature.terminalIds);
    f.core.saveTeam(feature.featureId, { expectedRevision: 0, configuration });
    const proposal = f.core.routingProposal(
      feature.featureId,
      source.terminalId!,
      [source, target],
      1,
    );
    assert.deepEqual(proposal.allowedTargetPaneIds, [target.paneId]);
    assert.deepEqual(
      live.service.resolvePane(workspace, source.paneId).routing!.allowedTargetPaneIds,
      [],
    );
    assert.throws(
      () => f.core.routingProposal(feature.featureId, source.terminalId!, [source, target], 0),
      /Stale/,
    );
    assert.throws(
      () =>
        f.core.routingProposal(
          feature.featureId,
          source.terminalId!,
          [source, { ...target, featureId: randomUUID() }],
          1,
        ),
      /identity/,
    );
    assert.throws(
      () =>
        f.core.routingProposal(
          feature.featureId,
          source.terminalId!,
          [source, { ...target, state: 'unavailable' }],
          1,
        ),
      /identity/,
    );
    assert.throws(
      () =>
        f.core.routingProposal(feature.featureId, source.terminalId!, [source, target, target], 1),
      /identity/,
    );
    assert.equal(live.dispatched(), 0);
  } finally {
    live.store.close();
    f.close();
  }
});
