// SYNTHETIC adapters/metadata only; never executes providers, PTYs or the application.
import assert from 'node:assert/strict';
import { createHash, randomUUID, generateKeyPairSync, sign } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Store } from '@orqst/database';
import type {
  CommunicationMessage,
  CommunicationPane,
  FeaturePermissionOperation,
} from '@orqst/protocol';
import { PaneCommunication } from '../packages/core/src/communication/service.js';
import {
  featurePermissionRevision,
  type FeaturePermissionReader,
} from '../packages/core/src/communication/feature-permissions.js';
import { featureConfigurationDatabase } from '../packages/core/src/terminal/feature-configuration.js';
import {
  CodexStructuredRuntime,
  type CodexRuntimeBackend,
} from '../packages/core/src/managed-codex/runtime.js';
import { type CodexTransport } from '../packages/core/src/managed-codex/channel.js';
import {
  TerminalAuthority,
  terminalChallengeBytes,
  type TerminalChallenge,
} from '../packages/core/src/terminal/authority.js';
import {
  managedCodexSettings,
  terminalExecutableSha256,
  type ManagedCodexConfig,
} from '../packages/core/src/terminal/codex-profile.js';
import { teamRoutingProposal } from '../packages/core/src/communication/team-configuration.js';
import type { FeatureConfigurationDatabase } from '../packages/core/src/terminal/feature-configuration.js';

function fixture(file = ':memory:') {
  const store = new Store(file);
  const features = store.features();
  let feature = features.create({ workspaceId: 'synthetic', name: 'SYNTHETIC Feature' });
  const journal = store.communicationJournal(randomUUID(), { recover: false });
  const bytes = Buffer.from('SYNTHETIC bounded task');
  let reads = 0,
    submits = 0;
  let closed = false;
  let report: ((event: import('@orqst/protocol').PaneProviderEvidence) => void) | undefined;
  let dispatched: Readonly<CommunicationMessage> | undefined;
  const reader: FeaturePermissionReader = (scope) =>
    store.transaction(() => ({
      feature: features.read(scope),
      permissions: store.featurePermissions().read(scope),
    }));
  const service = new PaneCommunication(
    journal,
    () => {
      reads++;
      return bytes;
    },
    Date.now,
    reader,
  );
  const register = (scope: string | undefined = feature.featureId, workspaceId = 'synthetic') => {
    const pane = service.registerPane(
      {
        workspaceId,
        ...(scope === undefined ? {} : { featureId: scope }),
        terminalId: randomUUID(),
        name: 'SYNTHETIC terminal',
        provider: 'SYNTHETIC',
        cliVersion: null,
        model: null,
        routing: {
          handle: `s-${randomUUID().slice(0, 20)}`,
          role: 'worker',
          allowedTargetPaneIds: [],
        },
        ownership: 'managed',
        ownerId: 'native-owner',
        creationReason: 'synthetic fixture',
        binding: { instanceId: randomUUID(), projectId: 'synthetic', terminalEpoch: randomUUID() },
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
        submit: async (message, _content, evidence) => {
          submits++;
          report = evidence;
          dispatched = message;
          for (const event of ['accepted', 'started'] as const)
            evidence({
              messageId: message.messageId,
              taskId: message.taskId,
              correlationId: message.correlationId,
              targetPaneId: pane.paneId,
              attemptId: message.attemptId!,
              instanceId: pane.binding!.instanceId,
              terminalEpoch: pane.binding!.terminalEpoch,
              evidenceId: randomUUID(),
              event,
            });
        },
      },
    );
    if (scope === feature.featureId && workspaceId === feature.workspaceId)
      feature = features.assignTerminal(
        { workspaceId: feature.workspaceId, featureId: feature.featureId },
        pane.terminalId!,
        feature.revision,
      );
    return pane;
  };
  const a = register(),
    b = register(),
    c = register();
  const routing = (
    targets: CommunicationPane[] = [b],
    role: 'worker' | 'orchestrator' = 'worker',
  ) =>
    service.configureRouting(a.paneId, {
      name: a.name,
      ...a.routing!,
      role,
      allowedTargetPaneIds: targets.map((p) => p.paneId),
    });
  routing();
  const authorize = (source = a, target = b) =>
    service.authorize({
      actorId: 'native-owner',
      workspaceId: source.workspaceId,
      ...(source.featureId === undefined ? {} : { featureId: source.featureId }),
      sourcePaneId: source.paneId,
      targetPaneIds: [target.paneId],
      expiresAt: Date.now() + 60000,
    });
  const request = () => ({
    schemaVersion: 1,
    workspaceId: feature.workspaceId,
    featureId: feature.featureId,
    sourcePaneId: a.paneId,
    targetPaneId: b.paneId,
    messageId: randomUUID(),
    taskId: randomUUID(),
    correlationId: randomUUID(),
    parentTaskId: null,
    kind: 'task.request',
    payload: {
      id: 'synthetic-content',
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    },
    deliveryPolicy: 'queue-if-busy',
    idempotencyKey: randomUUID(),
    deadline: Date.now() + 30000,
  });
  const save = (operations: FeaturePermissionOperation[] = ['delegate', 'execute', 'view']) => {
    const permissions = store.featurePermissions();
    return permissions.save(
      { workspaceId: feature.workspaceId, featureId: feature.featureId },
      'native-owner',
      {
        expectedRevision: permissions.read({
          workspaceId: feature.workspaceId,
          featureId: feature.featureId,
        }).revision,
        configuration: {
          schemaVersion: 1,
          rules: [{ sourceTerminalId: a.terminalId!, targetTerminalId: b.terminalId!, operations }],
        },
      },
    );
  };
  const complete = () => {
    assert.ok(report && dispatched);
    report({
      messageId: dispatched.messageId,
      taskId: dispatched.taskId,
      correlationId: dispatched.correlationId,
      targetPaneId: b.paneId,
      attemptId: dispatched.attemptId!,
      instanceId: b.binding!.instanceId,
      terminalEpoch: b.binding!.terminalEpoch,
      evidenceId: randomUUID(),
      event: 'completed',
      result: request().payload,
    });
  };
  return {
    store,
    journal,
    features,
    feature: () => feature,
    reader,
    service,
    register,
    a,
    b,
    c,
    routing,
    authorize,
    request,
    save,
    complete,
    counts: () => ({ reads, submits }),
    messages: () => journal.transaction((tx) => tx.messages()),
    close: () => {
      if (!closed) store.close();
      closed = true;
    },
  };
}
const withFixture = (run: (f: ReturnType<typeof fixture>) => void | Promise<void>) => async () => {
  const f = fixture();
  try {
    await run(f);
  } finally {
    f.close();
  }
};

for (const role of ['worker', 'orchestrator'] as const) {
  test(
    `absent policy: ${role} has exactly reviewed-route/native-grant access`,
    withFixture(async (f) => {
      f.routing([f.b], role);
      const client = f.authorize();
      const message = client.send(f.request());
      assert.equal(client.status(message.messageId).taskState, 'pending');
      await f.service.dispatchNext(f.b.paneId);
      f.complete();
      assert.equal(client.inbox()[0]?.taskState, 'completed');
      assert.equal(f.counts().submits, 1);
      assert.ok(client.events(0).length);
      assert.throws(() => f.authorize(f.a, f.c), /permission/);
    }),
  );

  test(
    `saved restrictive policy denies ${role} despite reviewed routing`,
    withFixture(async (f) => {
      f.save([]);
      f.routing([f.b], role);
      assert.throws(() => f.authorize(), /permission/);
      assert.throws(() => f.service.delegationRevision(f.a.paneId, f.b.paneId), /permission/);
      assert.equal(await f.service.dispatchNext(f.b.paneId), undefined);
      assert.deepEqual(f.counts(), { reads: 0, submits: 0 });
      assert.equal(f.messages().length, 0);
      assert.ok(
        f.journal.transaction((tx) => tx.events(0)).some((event) => event.action === 'denied'),
      );
    }),
  );

  test(
    `policy allow never replaces a route or expired/revoked native grant for ${role}`,
    withFixture(async (f) => {
      f.save();
      f.routing([], role);
      assert.throws(() => f.authorize(), /Routing/);
      f.routing([f.b], role);
      assert.throws(
        () =>
          f.service.authorize({
            actorId: 'native-owner',
            workspaceId: 'synthetic',
            featureId: f.feature().featureId,
            sourcePaneId: f.a.paneId,
            targetPaneIds: [f.b.paneId],
            expiresAt: 1,
          }),
        /expiry/,
      );
      const client = f.authorize();
      f.service.revoke(client);
      assert.throws(() => client.send(f.request()), /revoked/);
      assert.equal(await f.service.dispatchNext(f.b.paneId), undefined);
      assert.deepEqual(f.counts(), { reads: 0, submits: 0 });
    }),
  );

  test(
    `explicit policy plus route/grant lets ${role} dispatch the same bounded task`,
    withFixture(async (f) => {
      f.save();
      f.routing([f.b], role);
      const client = f.authorize();
      const message = client.send(f.request());
      await f.service.dispatchNext(f.b.paneId);
      f.complete();
      assert.equal(client.status(message.messageId).taskState, 'completed');
      assert.equal(f.counts().submits, 1);
    }),
  );
}

for (const operations of [['delegate'], ['execute'], ['view']] as FeaturePermissionOperation[][])
  test(
    `only ${operations.join(',')} cannot authorize delegated execution`,
    withFixture((f) => {
      f.save(operations);
      assert.throws(() => f.authorize(), /permission/);
      assert.deepEqual(f.counts(), { reads: 0, submits: 0 });
    }),
  );

test(
  'changing only role after grant never adds targets/actions, with absent or restrictive policy',
  withFixture((f) => {
    for (const explicit of [false, true]) {
      if (explicit) f.save(['delegate', 'execute']);
      const client = f.authorize();
      f.routing([f.b], 'orchestrator');
      assert.throws(() => client.send({ ...f.request(), targetPaneId: f.c.paneId }), /denied/);
      assert.throws(() => f.authorize(f.a, f.c), /permission/);
      const message = client.send(f.request());
      if (explicit) assert.throws(() => client.status(message.messageId), /unavailable/);
      else assert.equal(client.status(message.messageId).taskState, 'pending');
    }
  }),
);

test(
  'revocation after authorize denies admission before resolver/idempotency; reallow cannot resurrect grant',
  withFixture((f) => {
    const client = f.authorize();
    const request = f.request();
    f.save([]);
    assert.throws(() => client.send(request), /permission/);
    f.save();
    assert.throws(() => client.send(request), /revision/);
    assert.deepEqual(f.counts(), { reads: 0, submits: 0 });
    assert.equal(f.messages().length, 0);
    f.authorize().send(request);
    assert.equal(f.messages().length, 1);
  }),
);

test(
  'revocation after admission preserves pending queue; reallow needs fresh grant and explicit reauthorization',
  withFixture(async (f) => {
    const client = f.authorize();
    const message = client.send(f.request());
    f.save([]);
    assert.equal(await f.service.dispatchNext(f.b.paneId), undefined);
    f.save();
    assert.equal(await f.service.dispatchNext(f.b.paneId), undefined);
    assert.equal(f.messages()[0]?.deliveryState, 'queued');
    assert.deepEqual(f.counts(), { reads: 1, submits: 0 });
    const fresh = f.authorize();
    f.service.reauthorize(fresh, message.messageId);
    await f.service.dispatchNext(f.b.paneId);
    assert.equal(f.counts().submits, 1);
    assert.throws(() => client.status(message.messageId), /unavailable/);
  }),
);

test(
  'view revoked inside dispatch notification race blocks microtask, events, status and inbox',
  withFixture(async (f) => {
    f.save();
    const client = f.authorize();
    const message = client.send(f.request());
    const notifications: CommunicationMessage[] = [];
    client.subscribe((value) => notifications.push(value));
    const dispatch = f.service.dispatchNext(f.b.paneId);
    // dispatch synchronously schedules notification; revoke before its microtask can run.
    f.save(['delegate', 'execute']);
    await dispatch;
    f.complete(); // Already-dispatched evidence must survive revocation.
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    assert.equal(notifications.length, 0);
    assert.equal(f.messages()[0]?.taskState, 'completed');
    assert.throws(() => client.status(message.messageId), /unavailable/);
    assert.deepEqual(client.events(0), []);
    assert.deepEqual(client.inbox(), []);
    const fresh = f.authorize();
    assert.deepEqual(fresh.events(0), []);
    assert.deepEqual(fresh.inbox(), []);
    assert.throws(() => fresh.status(message.messageId), /unavailable/);
  }),
);

test(
  'delegate/execute without view can dispatch but cannot read results or replay completed result via send',
  withFixture(async (f) => {
    f.save(['delegate', 'execute']);
    const client = f.authorize();
    const request = f.request();
    const message = client.send(request);
    await f.service.dispatchNext(f.b.paneId);
    f.complete();
    assert.equal(f.counts().submits, 1);
    assert.throws(() => client.status(message.messageId), /unavailable/);
    assert.throws(() => client.send(request), /conflict/);
    assert.deepEqual(client.inbox(), []);
  }),
);

test(
  'unknown/archived/wrong-workspace/foreign-terminal and unavailable reader fail closed',
  withFixture((f) => {
    const snapshot = f.reader({
      workspaceId: f.feature().workspaceId,
      featureId: f.feature().featureId,
    });
    const source = f.service.resolvePane('synthetic', f.a.paneId);
    for (const read of [
      undefined,
      () => {
        throw new Error('synthetic unavailable');
      },
      () => ({ ...snapshot, feature: { ...snapshot.feature, status: 'archived' as const } }),
      () => ({ ...snapshot, feature: { ...snapshot.feature, workspaceId: 'foreign' } }),
      () => ({ ...snapshot, permissions: { ...snapshot.permissions, featureId: randomUUID() } }),
      () => ({ ...snapshot, feature: { ...snapshot.feature, terminalIds: [f.a.terminalId!] } }),
    ])
      assert.throws(() => featurePermissionRevision(source, f.b, ['delegate', 'execute'], read));
    const unknown = f.register(randomUUID());
    assert.throws(() => f.authorize(unknown, unknown));
    assert.throws(() =>
      featurePermissionRevision(source, { ...f.b, terminalId: undefined }, ['view'], f.reader),
    );
    assert.throws(() =>
      featurePermissionRevision(source, { ...f.b, workspaceId: 'foreign' }, ['view'], f.reader),
    );
  }),
);

test(
  'legacy panes never reach Feature panes even when policy is absent',
  withFixture((f) => {
    // register uses a default argument; construct an explicitly unscoped identity separately.
    const legacy = f.service.registerPane({
      ...f.a,
      terminalId: randomUUID(),
      featureId: undefined,
      binding: { ...f.a.binding!, instanceId: randomUUID() },
      routing: { ...f.a.routing!, handle: 'legacy' },
    });
    assert.throws(
      () =>
        f.service.configureRouting(legacy.paneId, {
          name: legacy.name,
          ...legacy.routing!,
          allowedTargetPaneIds: [f.b.paneId],
        }),
      /denied/,
    );
    assert.throws(() => f.authorize(legacy, f.b), /scope/);
    assert.throws(() => featurePermissionRevision(legacy, f.b, ['delegate'], f.reader), /scope/);
  }),
);

test('reopened SQLite with orchestrator and allowing policy restores no grant, adapter or dispatch authority', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'orqst-SYNTHETIC-permission-reopen-'));
  const file = join(directory, 'synthetic.sqlite');
  const first = fixture(file);
  try {
    first.save();
    first.routing([first.b], 'orchestrator');
    first.authorize().send(first.request());
    first.close();
    const reopened = new Store(file);
    try {
      const journal = reopened.communicationJournal(randomUUID(), { recover: true });
      const service = new PaneCommunication(
        journal,
        () => {
          throw new Error('No restored content');
        },
        Date.now,
        (scope) => ({
          feature: reopened.features().read(scope),
          permissions: reopened.featurePermissions().read(scope),
        }),
      );
      assert.equal(
        reopened
          .featurePermissions()
          .read({ workspaceId: first.feature().workspaceId, featureId: first.feature().featureId })
          .revision,
        1,
      );
      assert.equal(await service.dispatchNext(first.b.paneId), undefined);
      assert.equal(
        journal.transaction((tx) => tx.messages()[0]?.deliveryState),
        'queued',
      );
      assert.equal(first.counts().submits, 0);
    } finally {
      reopened.close();
    }
  } finally {
    first.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('routing proposals filter policy-denied edges and never configure routing or grants', () => {
  const directory = mkdtempSync(join(tmpdir(), 'orqst-SYNTHETIC-permission-proposal-'));
  const f = fixture();
  try {
    const core = featureConfigurationDatabase(directory, 'synthetic');
    let feature = core.create({ name: 'SYNTHETIC proposal' });
    for (const pane of [f.a, f.b])
      feature = core.assignTerminal(feature.featureId, pane.terminalId!, feature.revision);
    const panes = [f.a, f.b].map((p) => ({ ...p, featureId: feature.featureId }));
    const team = {
      version: 1 as const,
      name: 'SYNTHETIC team',
      members: panes.map((p, index) => ({
        terminalId: p.terminalId!,
        name: p.name,
        handle: p.routing!.handle,
        role: p.routing!.role,
        allowedTargetTerminalIds: index === 0 ? [f.b.terminalId!] : [],
      })),
    };
    core.saveTeam(feature.featureId, { expectedRevision: 0, configuration: team });
    assert.deepEqual(
      core.routingProposal(feature.featureId, f.a.terminalId!, panes, 1).allowedTargetPaneIds,
      [f.b.paneId],
    );
    core.savePermissions(feature.featureId, 'native-owner', {
      expectedRevision: 0,
      configuration: { schemaVersion: 1, rules: [] },
    });
    assert.deepEqual(
      core.routingProposal(feature.featureId, f.a.terminalId!, panes, 1).allowedTargetPaneIds,
      [],
    );
    assert.throws(
      () => teamRoutingProposal(team, f.a.terminalId!, 'synthetic', panes, feature.featureId),
      /reader/,
    );
    assert.equal(f.messages().length, 0);
    assert.equal(f.counts().submits, 0);
  } finally {
    f.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

// Public runtime preparation/launch with an in-process synthetic protocol backend.
// /usr/bin/true is pinned as metadata and is never executed.
async function rootFixture() {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'orqst-SYNTHETIC-policy-root-')));
  const project = join(directory, 'project');
  mkdirSync(project, { mode: 0o700 });
  const store = new Store(':memory:');
  const keys = generateKeyPairSync('ed25519');
  const authority = new TerminalAuthority(
    new Map([['synthetic-native', keys.publicKey]]),
    Date.now,
  );
  const proof = (challenge: TerminalChallenge) => ({
    challengeId: challenge.challengeId,
    signature: sign(null, terminalChallengeBytes(challenge), keys.privateKey).toString('base64url'),
  });
  let feature = store.features().create({ workspaceId: 'synthetic', name: 'SYNTHETIC root gate' });
  const reader: FeaturePermissionReader = (scope) =>
    store.transaction(() => ({
      feature: store.features().read(scope),
      permissions: store.featurePermissions().read(scope),
    }));
  const journal = store.communicationJournal(randomUUID(), { recover: false });
  const communication = new PaneCommunication(
    journal,
    () => {
      throw new Error('Root gate must precede content resolution');
    },
    Date.now,
    reader,
  );
  let turns = 0;
  const backend: CodexRuntimeBackend = {
    open: (_file, _config, events) => {
      let data: (bytes: Uint8Array) => void = () => {};
      const threadId = randomUUID();
      const transport: CodexTransport = {
        listen: (listener) => {
          data = listener;
          return () => {
            data = () => {};
          };
        },
        send: (line) => {
          const request = JSON.parse(line) as { id?: string; method: string };
          if (request.id === undefined) return;
          let result: object = {};
          if (request.method === 'initialize') result = { userAgent: 'SYNTHETIC' };
          if (request.method === 'account/read')
            result = { account: { type: 'chatgpt' }, requiresOpenaiAuth: true };
          if (request.method === 'thread/start')
            result = {
              thread: { id: threadId, ephemeral: true },
              model: 'synthetic-model',
              sandbox: { type: 'readOnly' },
              approvalPolicy: 'on-request',
            };
          if (request.method === 'turn/start') turns++;
          queueMicrotask(() =>
            data(Buffer.from(JSON.stringify({ id: request.id, result }) + '\n')),
          );
        },
        signal: () => {
          throw new Error('No signals in policy fixture');
        },
        detach: () => {},
      };
      queueMicrotask(events.started);
      return transport;
    },
  };
  const runtime = new CodexStructuredRuntime(
    authority,
    communication,
    () => {
      throw new Error('No provider result expected');
    },
    backend,
    () => {
      throw new Error('No content before root turn');
    },
  );
  const executable = realpathSync('/usr/bin/true');
  const pin = { path: executable, sha256: terminalExecutableSha256(executable) };
  const launch = async (name: string) => {
    const state = join(directory, name);
    mkdirSync(state, { mode: 0o700 });
    for (const child of ['home', 'codex', 'tmp']) mkdirSync(join(state, child), { mode: 0o700 });
    const config: ManagedCodexConfig = {
      version: 1,
      trust: 'native-same-user',
      executable: pin,
      executableVersion: 'SYNTHETIC',
      node: pin,
      project,
      state,
    };
    writeFileSync(join(state, 'codex/config.toml'), managedCodexSettings(config), { mode: 0o600 });
    const file = join(state, 'terminal.json');
    writeFileSync(file, JSON.stringify(config), { mode: 0o600 });
    const prepared = runtime.prepare('synthetic-native', file, {
      workspaceId: 'synthetic',
      featureId: feature.featureId,
      name,
      ownerId: 'native-owner',
      model: 'synthetic-model',
      dynamicTools: true,
      mentionHandle: name,
    });
    const pane = await runtime.launch(prepared.instanceId, proof(prepared.challenge));
    feature = store
      .features()
      .assignTerminal(
        { workspaceId: 'synthetic', featureId: feature.featureId },
        pane.terminalId!,
        feature.revision,
      );
    return { pane, instanceId: prepared.instanceId };
  };
  try {
    const source = await launch('source'),
      target = await launch('target');
    const scope = { workspaceId: 'synthetic', featureId: feature.featureId };
    const route = (role: 'worker' | 'orchestrator') =>
      communication.configureRouting(source.pane.paneId, {
        name: source.pane.name,
        ...source.pane.routing!,
        role,
        allowedTargetPaneIds: [target.pane.paneId],
      });
    route('worker');
    const prepare = () =>
      runtime.prepareRootTask('synthetic-native', source.instanceId, {
        targetPaneId: target.pane.paneId,
        text: 'SYNTHETIC root',
        delegatedTask: 'SYNTHETIC bounded task',
        deadline: Date.now() + 60000,
      });
    const save = (operations: FeaturePermissionOperation[]) =>
      store.featurePermissions().save(scope, 'native-owner', {
        expectedRevision: store.featurePermissions().read(scope).revision,
        configuration: {
          schemaVersion: 1,
          rules: [
            {
              sourceTerminalId: source.pane.terminalId!,
              targetTerminalId: target.pane.terminalId!,
              operations,
            },
          ],
        },
      });
    return {
      runtime,
      prepare,
      save,
      route,
      proof,
      turns: () => turns,
      withdrawCapability: () =>
        journal.transaction((tx) => {
          const pane = tx.panes().find((p) => p.paneId === target.pane.paneId)!;
          tx.savePane({ ...pane, capabilities: { ...pane.capabilities, canSend: false } });
        }),
      close: () => {
        runtime.shutdown();
        store.close();
        rmSync(directory, { recursive: true, force: true });
      },
    };
  } catch (error) {
    runtime.shutdown();
    store.close();
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

for (const role of ['worker', 'orchestrator'] as const)
  test(`root turn ${role} binds absent-policy revision and denies revoked/stale plans before turn/start`, async () => {
    const f = await rootFixture();
    try {
      f.route(role);
      const neutral = f.prepare();
      assert.equal(neutral.plan.policyRevision, 0);
      f.save([]);
      assert.throws(() => f.prepare(), /permission/);
      await assert.rejects(
        () => f.runtime.runRootTask(neutral.plan.taskId, f.proof(neutral.challenge)),
        /permission/,
      );
      f.save(['delegate', 'execute', 'view']);
      await assert.rejects(
        () => f.runtime.runRootTask(neutral.plan.taskId, f.proof(neutral.challenge)),
        /revision/,
      );
      const fresh = f.prepare();
      assert.equal(fresh.plan.policyRevision, 2);
      f.save(['delegate', 'execute', 'view']);
      await assert.rejects(
        () => f.runtime.runRootTask(fresh.plan.taskId, f.proof(fresh.challenge)),
        /revision/,
      );
      f.withdrawCapability();
      assert.throws(() => f.prepare(), /permission/);
      assert.equal(f.turns(), 0);
    } finally {
      f.close();
    }
  });

// Multi-destination decisions reuse the shared withPermissionSnapshot preferences
// lock under the journal transaction; the snapshot reader itself is SYNTHETIC data.
function multiTargetFixture() {
  const directory = mkdtempSync(join(tmpdir(), 'orqst-SYNTHETIC-policy-snapshot-'));
  try {
    const config = featureConfigurationDatabase(directory, 'synthetic');
    let feature = config.create({ name: 'SYNTHETIC snapshot' });
    const store = new Store(':memory:');
    const journal = store.communicationJournal(randomUUID(), { recover: false });
    const state: {
      snapshotOpens: number;
      liveReads: number;
      liveWrite?: () => void;
      onSnapshotRead?: () => void;
    } = {
      snapshotOpens: 0,
      liveReads: 0,
    };
    const lock: FeatureConfigurationDatabase['withPermissionSnapshot'] = (action) => {
      state.snapshotOpens++;
      return config.withPermissionSnapshot((local, cross) =>
        action((scope) => {
          const result = local(scope);
          state.onSnapshotRead?.();
          return result;
        }, cross),
      );
    };
    const liveReader: FeaturePermissionReader = (scope) => {
      state.liveReads++;
      if (state.liveReads === 2 && state.liveWrite) {
        const write = state.liveWrite;
        state.liveWrite = undefined;
        write();
      }
      return config.permissionReader(scope);
    };
    const resolver = (): Uint8Array => {
      throw new Error('SYNTHETIC unused resolver');
    };
    const service = new PaneCommunication(journal, resolver, Date.now, liveReader, undefined, lock);
    const fallback = new PaneCommunication(journal, resolver, Date.now, liveReader);
    const legacy = new PaneCommunication(journal, resolver);
    const register = (scope: string | undefined): CommunicationPane => {
      const pane = service.registerPane({
        workspaceId: 'synthetic',
        ...(scope === undefined ? {} : { featureId: scope }),
        terminalId: randomUUID(),
        name: 'SYNTHETIC terminal',
        provider: 'SYNTHETIC',
        cliVersion: null,
        model: null,
        routing: {
          handle: `s-${randomUUID().slice(0, 20)}`,
          role: 'worker',
          allowedTargetPaneIds: [],
        },
        ownership: 'managed',
        ownerId: 'native-owner',
        creationReason: 'synthetic fixture',
        binding: { instanceId: randomUUID(), projectId: 'synthetic', terminalEpoch: randomUUID() },
        capabilities: {
          canSend: true,
          canQueueWhileBusy: true,
          canAcknowledge: true,
          canReportTaskCompletion: true,
          canCancel: true,
        },
        state: 'ready',
      });
      if (scope === feature.featureId)
        feature = config.assignTerminal(feature.featureId, pane.terminalId!, feature.revision);
      return pane;
    };
    const a = register(feature.featureId),
      b = register(feature.featureId),
      c = register(feature.featureId);
    const legacyTargets: CommunicationPane[] = [];
    for (let n = 0; n < 2; n++) legacyTargets.push(register(undefined));
    const grantTargets = (targets: CommunicationPane[]) =>
      config.savePermissions(feature.featureId, 'native-owner', {
        expectedRevision: config.readPermissions(feature.featureId).revision,
        configuration: {
          schemaVersion: 1,
          rules: targets.map((target) => ({
            sourceTerminalId: a.terminalId!,
            targetTerminalId: target.terminalId!,
            operations: ['view', 'delegate', 'execute'],
          })),
        },
      });
    const route = (source: CommunicationPane, targets: CommunicationPane[]) =>
      service.configureRouting(source.paneId, {
        name: source.name,
        ...source.routing!,
        allowedTargetPaneIds: targets.map((p) => p.paneId),
      });
    const authorize = (
      override: PaneCommunication,
      source: CommunicationPane,
      targets: CommunicationPane[],
    ) =>
      override.authorize({
        actorId: 'native-owner',
        workspaceId: 'synthetic',
        ...(source.featureId === undefined ? {} : { featureId: source.featureId }),
        sourcePaneId: source.paneId,
        targetPaneIds: targets.map((p) => p.paneId),
        expiresAt: Date.now() + 60000,
      });
    return {
      state,
      directory,
      featureId: feature.featureId,
      a,
      b,
      c,
      grantTargets,
      legacyTargets,
      route,
      authorize: (source: CommunicationPane, targets: CommunicationPane[]) =>
        authorize(service, source, targets),
      fallbackAuthorize: (source: CommunicationPane, targets: CommunicationPane[]) =>
        authorize(fallback, source, targets),
      legacyAuthorize: (source: CommunicationPane, targets: CommunicationPane[]) =>
        authorize(legacy, source, targets),
      policyRevision: () => config.readPermissions(feature.featureId).revision,
      close: () => {
        store.close();
        rmSync(directory, { recursive: true, force: true });
      },
    };
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

test('multi-destination authorization reads one policy snapshot for every target', () => {
  const f = multiTargetFixture();
  try {
    f.route(f.a, [f.b, f.c]);
    assert.deepEqual(f.state, { snapshotOpens: 0, liveReads: 0 });
    const client = f.authorize(f.a, [f.b, f.c]);
    assert.equal(f.state.snapshotOpens, 1);
    assert.equal(f.state.liveReads, 0);
    void client.inbox();
    void client.events(0);
    assert.equal(f.state.snapshotOpens, 3);
    assert.equal(f.state.liveReads, 0);
    // Single-destination regression under the same snapshot-backed decision.
    void f.authorize(f.a, [f.c]);
    assert.equal(f.state.snapshotOpens, 4);
    assert.equal(f.state.liveReads, 0);
    // Legacy panes without a Feature keep the exact-grant contract and read no policy.
    f.route(f.legacyTargets[0]!, [f.legacyTargets[1]!]);
    assert.equal(f.legacyTargets[0]!.featureId, undefined);
    assert.equal(f.legacyTargets[1]!.featureId, undefined);
    void f.legacyAuthorize(f.legacyTargets[0]!, [f.legacyTargets[1]!]);
    assert.equal(f.state.snapshotOpens, 4);
    assert.equal(f.state.liveReads, 0);
  } finally {
    f.close();
  }
});

test('a policy writer between per-target reads cannot mix a snapshotted decision', () => {
  const f = multiTargetFixture();
  try {
    f.route(f.a, [f.b, f.c]);
    // The live reader simulates a concurrent policy writer that commits between
    // the two per-target reads of one decision by rewriting the same permissive
    // rules under a new revision.
    f.state.liveWrite = () => f.grantTargets([f.b, f.c]);
    // The snapshotted decision never consults the mutable live read path, so the
    // between-reads write cannot land inside it and every target sees revision 0.
    void f.authorize(f.a, [f.b, f.c]);
    assert.equal(f.state.snapshotOpens, 1);
    assert.equal(f.state.liveReads, 0);
    assert.equal(f.policyRevision(), 0);
    // Without the snapshot lock the same read path observes a policy revision
    // change between its two per-target reads and rejects the mixed decision.
    assert.throws(() => f.fallbackAuthorize(f.a, [f.b, f.c]), /revision changed/);
    assert.equal(f.state.liveReads, 2);
    assert.equal(f.policyRevision(), 1);
    // A later snapshot-backed decision reads the committed revision consistently.
    void f.authorize(f.a, [f.c]);
    assert.equal(f.state.snapshotOpens, 2);
    assert.equal(f.state.liveReads, 2);
  } finally {
    f.close();
  }
});

test(
  'a competing policy writer is excluded between both reads of one local decision',
  { timeout: 15000 },
  () => {
    const f = multiTargetFixture();
    try {
      f.route(f.a, [f.b, f.c]);
      const script = `
      import { featureConfigurationDatabase } from './packages/core/src/terminal/feature-configuration.ts';
      const [directory, featureId, source, first, second] = process.argv.slice(1);
      const config = featureConfigurationDatabase(directory, 'synthetic');
      const current = config.readPermissions(featureId);
      config.savePermissions(featureId, 'native-owner', {
        expectedRevision: current.revision,
        configuration: { schemaVersion: 1, rules: [first, second].map(targetTerminalId => ({
          sourceTerminalId: source, targetTerminalId, operations: ['view', 'delegate', 'execute'],
        })) },
      });
    `;
      const write = () =>
        spawnSync(
          process.execPath,
          [
            '--import',
            'tsx',
            '--input-type=module',
            '-e',
            script,
            f.directory,
            f.featureId,
            f.a.terminalId!,
            f.b.terminalId!,
            f.c.terminalId!,
          ],
          { encoding: 'utf8', timeout: 9000 },
        );
      let reads = 0;
      f.state.onSnapshotRead = () => {
        reads++;
        if (reads === 1) {
          const attempt = write();
          assert.equal(attempt.error, undefined);
          assert.notEqual(attempt.status, 0);
          assert.match(attempt.stderr, /locked|busy/i);
        }
      };
      void f.authorize(f.a, [f.b, f.c]);
      assert.equal(reads, 2);
      assert.equal(f.policyRevision(), 0);
      const retry = write();
      assert.equal(retry.status, 0, retry.stderr);
      assert.equal(f.policyRevision(), 1);
    } finally {
      f.close();
    }
  },
);
