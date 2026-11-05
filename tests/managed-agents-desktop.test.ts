// SYNTHETIC fixtures only: no provider executable, account or external source access.
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  copyFileSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '@orqst/database';
import { stableId } from '@orqst/shared';
import { terminalTeamDatabase } from '../packages/core/src/terminal/team-database.js';
import { terminalIdentity } from '../packages/core/src/terminal/identity.js';
import { terminalDigest } from '../packages/core/src/terminal/authority.js';
import { featureConfigurationDatabase } from '../packages/core/src/terminal/feature-configuration.js';
import { resolveTerminalPreparationContext } from '../packages/core/src/terminal/preparation-context.js';
import {
  managedAgentsHostComposition,
  nativeManagedAgentsFeatureContext,
} from '../apps/desktop/src/managed-agents-context.js';
import { agentsHostRequestSchema } from '../apps/desktop/src/managed-agents-wire.js';
import { managedAgentsRequestSchema } from '@orqst/protocol';
import { DesktopManagedAgents } from '../packages/core/src/managed-codex/desktop.js';
import { desktopAgentsAdmission } from '../packages/core/src/managed-codex/desktop-admission.js';
import { readManagedAgentsPair } from '../packages/core/src/managed-codex/feature-context.js';
import { createLifecycleReceipt } from '../packages/core/src/managed-codex/lifecycle-receipt.js';
import { prepareNativeHost } from '../packages/core/src/managed-codex/native-host-preparation.js';
import type { CodexTransport } from '../packages/core/src/managed-codex/channel.js';
import {
  managedCodexSettings,
  terminalExecutableSha256,
  type ManagedCodexConfig,
} from '../packages/core/src/terminal/codex-profile.js';
import {
  terminalChallengeBytes,
  type TerminalChallenge,
} from '../packages/core/src/terminal/authority.js';

class SyntheticDesktopTransport implements CodexTransport {
  data: (bytes: Uint8Array) => void = () => {};
  lost: () => void = () => {};
  thread = randomUUID();
  turn = randomUUID();
  turns = 0;
  replies: unknown[] = [];
  signals: string[] = [];
  listen(data: (bytes: Uint8Array) => void, lost: () => void) {
    this.data = data;
    this.lost = lost;
    return () => {};
  }
  emit(value: object) {
    this.data(Buffer.from(JSON.stringify(value) + '\n'));
  }
  send(line: string) {
    const r = JSON.parse(line) as { id: string; method?: string };
    if (!r.method) {
      this.replies.push(JSON.parse(line));
      return;
    }
    queueMicrotask(() => {
      if (r.method === 'initialize') this.emit({ id: r.id, result: {} });
      if (r.method === 'account/read')
        this.emit({
          id: r.id,
          result: { account: { type: 'chatgpt', email: 'SYNTHETIC-PRIVATE' } },
        });
      if (r.method === 'thread/start')
        this.emit({
          id: r.id,
          result: {
            thread: { id: this.thread, ephemeral: true },
            model: 'synthetic-model',
            sandbox: { type: 'readOnly' },
            approvalPolicy: 'on-request',
          },
        });
      if (r.method === 'turn/start') {
        this.turns++;
        this.emit({ id: r.id, result: { turn: { id: this.turn, status: 'inProgress' } } });
        this.emit({
          method: 'turn/started',
          params: { threadId: this.thread, turn: { id: this.turn, status: 'inProgress' } },
        });
      }
    });
  }
  item(item: object) {
    this.emit({
      method: 'item/completed',
      params: { threadId: this.thread, turnId: this.turn, item },
    });
  }
  complete(text: string) {
    this.item({ id: randomUUID(), type: 'agentMessage', phase: 'final_answer', text });
    this.emit({
      method: 'turn/completed',
      params: { threadId: this.thread, turn: { id: this.turn, status: 'completed' } },
    });
  }
  delegate(targetPaneId: string, task: string) {
    const callId = randomUUID();
    this.emit({
      id: randomUUID(),
      method: 'item/tool/call',
      params: {
        threadId: this.thread,
        turnId: this.turn,
        callId,
        namespace: null,
        tool: 'orqst_delegate_task',
        arguments: { targetPaneId, task },
      },
    });
    return callId;
  }
  signal(signal: 'SIGTERM' | 'SIGKILL') {
    this.signals.push(signal);
  }
  detach() {}
}
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
function fixture(
  wrapAdmission = (admission: ReturnType<typeof desktopAgentsAdmission>) => admission,
  scoped: boolean | 'null' = false,
) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'orqst-synthetic-desktop-agents-')));
  const project = join(root, 'project');
  mkdirSync(project, { mode: 0o700 });
  const executable = realpathSync('/usr/bin/true');
  const binary = { path: executable, sha256: terminalExecutableSha256(executable) };
  const files = ['a', 'b'].map((name) => {
    const state = join(root, name);
    mkdirSync(state, { mode: 0o700 });
    for (const directory of ['home', 'codex', 'tmp'])
      mkdirSync(join(state, directory), { mode: 0o700 });
    const config: ManagedCodexConfig = {
      version: 1,
      trust: 'native-same-user',
      executable: binary,
      node: binary,
      executableVersion: 'SYNTHETIC',
      project,
      state,
      authentication: {
        mode: 'reuse-existing',
        home: root,
        codexHome: root,
        sharedNativeConfiguration: true,
      },
    };
    writeFileSync(join(state, 'codex/config.toml'), managedCodexSettings(config), { mode: 0o600 });
    const file = join(state, 'terminal.json');
    writeFileSync(file, JSON.stringify(config), { mode: 0o600 });
    return file;
  }) as [string, string];
  const preferencesDirectory = join(root, 'preferences');
  mkdirSync(preferencesDirectory, { mode: 0o700 });
  const native = { observerDatabase: join(root, 'observer.sqlite'), preferencesDirectory };
  const workspaceId = stableId('workspace', project);
  const features = featureConfigurationDatabase(preferencesDirectory, workspaceId);
  let featureId: string | undefined;
  if (scoped) {
    const observer = new Store(native.observerDatabase);
    assert.equal(observer.workspace(project, 'SYNTHETIC project'), workspaceId);
    observer.close();
    if (scoped === true) {
      let feature = features.create({ name: 'SYNTHETIC Feature' });
      for (const file of files) {
        const config = JSON.parse(readFileSync(file, 'utf8')) as ManagedCodexConfig;
        feature = features.assignTerminal(
          feature.featureId,
          terminalIdentity(config).terminalId,
          feature.revision,
        );
      }
      featureId = feature.featureId;
      features.saveView({ expectedRevision: 0, featureId });
    }
    const selectedFeature = featureId ?? null;
    const { fence } = resolveTerminalPreparationContext(native, workspaceId, selectedFeature);
    for (const file of files) {
      const config = JSON.parse(readFileSync(file, 'utf8')) as ManagedCodexConfig;
      config.preparation = { ...native, workspaceId, featureId: selectedFeature, fence };
      writeFileSync(file, JSON.stringify(config), { mode: 0o600 });
    }
  }
  const keys = generateKeyPairSync('ed25519');
  const transports: SyntheticDesktopTransport[] = [];
  const admissionDirectory = join(root, 'admission');
  const exits: Array<(code: number | null, signal: string | null) => void> = [];
  const backend = {
    open: (
      _f: string,
      _c: ManagedCodexConfig,
      events: Parameters<
        import('../packages/core/src/managed-codex/runtime.js').CodexRuntimeBackend['open']
      >[2],
    ) => {
      exits.push(events.exit);
      const transport = new SyntheticDesktopTransport();
      transports.push(transport);
      queueMicrotask(() => events.started(123));
      return transport;
    },
  };
  const hostContext = scoped ? nativeManagedAgentsFeatureContext(files, native) : undefined;
  const hostArgs = [
    ...files,
    keys.publicKey.export({ type: 'spki', format: 'der' }).toString('base64url'),
    admissionDirectory,
    ...(hostContext ? [JSON.stringify(hostContext)] : []),
  ];
  const service = scoped
    ? managedAgentsHostComposition(
        hostArgs,
        backend,
        wrapAdmission(desktopAgentsAdmission(admissionDirectory)),
      )
    : new DesktopManagedAgents(
        files,
        keys.publicKey,
        backend,
        wrapAdmission(desktopAgentsAdmission(admissionDirectory)),
        admissionDirectory,
      );
  const proof = (challenge: TerminalChallenge) => ({
    challengeId: challenge.challengeId,
    signature: sign(null, terminalChallengeBytes(challenge), keys.privateKey).toString('base64url'),
  });
  return {
    service,
    native,
    features,
    featureId,
    workspaceId,
    hostArgs,
    backend,
    files,
    keys,
    transports,
    admissionDirectory,
    exits,
    proof,
    allowRoute(
      sourceSlot = 0,
      targetSlot = 1,
      extra: Partial<import('@orqst/protocol').PaneRoutingUpdate> = {},
    ) {
      const source = service.snapshot().slots[sourceSlot]!.pane!;
      const target = service.snapshot().slots[targetSlot]!.pane!;
      const prepared = service.prepareRouting(sourceSlot, {
        name: source.name,
        ...source.routing!,
        allowedTargetPaneIds: [target.paneId],
        ...extra,
      });
      service.applyRouting(prepared.changeId, proof(prepared.challenge));
      return service.snapshot().slots[sourceSlot]!.pane!;
    },
    close() {
      service.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

test('Desktop composition needs signed starts and task; exposes correlated A/B results without invented delivery', async () => {
  const f = fixture();
  try {
    assert.deepEqual(f.service.snapshot().slots, [null, null]);
    const abandoned = f.service.prepareStart(0, 'synthetic-model');
    assert.equal(f.transports.length, 0);
    const a = f.service.prepareStart(0, 'synthetic-model'); // Cancelled, never-launched preparation is safe to replace.
    await assert.rejects(f.service.launch(0, f.proof(abandoned.challenge)), /authorization/);
    await f.service.launch(0, f.proof(a.challenge));
    const b = f.service.prepareStart(1, 'synthetic-model');
    await f.service.launch(1, f.proof(b.challenge));
    assert.equal(f.transports.length, 2);
    assert.equal(new Set(f.service.snapshot().slots.map((s) => s!.pane!.displayId)).size, 2);
    assert.equal(new Set(f.service.snapshot().slots.map((s) => s!.nativeThreadId)).size, 2);
    assert.throws(() => f.service.prepareStart(0, 'synthetic-model'), /No retry/);
    f.allowRoute();
    const task = f.service.prepareTask('SYNTHETIC A instructions', '@terminal-b SYNTHETIC B task');
    assert.equal(f.transports[0]!.turns, 0);
    assert.throws(
      () => f.service.runTask(task.plan.taskId, randomUUID(), f.proof(task.challenge)),
      /identity/,
    );
    f.service.runTask(task.plan.taskId, task.plan.correlationId, f.proof(task.challenge));
    assert.throws(
      () => f.service.runTask(task.plan.taskId, task.plan.correlationId, f.proof(task.challenge)),
      /identity/,
    );
    await tick();
    const call = f.transports[0]!.delegate(task.plan.target.paneId, '@terminal-b SYNTHETIC B task');
    await tick();
    assert.equal(f.service.snapshot().messages[0]!.taskState, 'running');
    assert.equal(f.service.snapshot().root!.resultText, null);
    f.transports[1]!.complete('<script>SYNTHETIC UNTRUSTED</script>');
    await tick();
    assert.equal(f.transports[0]!.replies.length, 1);
    f.transports[0]!.item({
      id: call,
      type: 'dynamicToolCall',
      tool: 'orqst_delegate_task',
      status: 'completed',
      success: true,
    });
    f.transports[0]!.complete('SYNTHETIC A RECEIVED');
    await tick();
    const snapshot = f.service.snapshot();
    assert.equal(snapshot.root!.state, 'completed');
    assert.equal(snapshot.root!.correlationId, snapshot.messages[0]!.correlationId);
    assert.equal(snapshot.messages[0]!.deliveryState, 'accepted');
    assert.equal(snapshot.messages[0]!.resultText, '<script>SYNTHETIC UNTRUSTED</script>');
    assert.equal(snapshot.root!.resultText, 'SYNTHETIC A RECEIVED');
    assert.equal(JSON.stringify(snapshot).includes('SYNTHETIC-PRIVATE'), false);
    const stop = f.service.prepareStop(1);
    assert.deepEqual(f.transports[1]!.signals, []);
    f.service.stop(1, f.proof(stop));
    assert.deepEqual(f.transports[1]!.signals, ['SIGTERM']);
  } finally {
    f.close();
  }
});

test('native routing review is signed, one-use, collision-safe and invalidates prepared task identities', async () => {
  const f = fixture();
  try {
    for (const slot of [0, 1]) {
      const start = f.service.prepareStart(slot, 'synthetic-model');
      await f.service.launch(slot, f.proof(start.challenge));
    }
    const [a, b] = f.service.snapshot().slots.map((s) => s!.pane!);
    assert.throws(() => f.service.prepareTask('SYNTHETIC', '@terminal-b SYNTHETIC'), /permission/);
    assert.throws(() => f.service.prepareTask('SYNTHETIC', '@unknown SYNTHETIC'), /unavailable/);
    assert.throws(
      () => f.service.prepareTask('SYNTHETIC', '@terminal-a @terminal-b'),
      /one explicit/,
    );
    const update = {
      name: 'SYNTHETIC coordinator',
      ...a!.routing!,
      role: 'orchestrator' as const,
      allowedTargetPaneIds: [b!.paneId],
    };
    const prepared = f.service.prepareRouting(0, update);
    assert.deepEqual(f.service.snapshot().slots[0]!.pane!.routing?.allowedTargetPaneIds, []);
    assert.throws(() => f.service.applyRouting(prepared.changeId, {}), /proof/);
    f.service.applyRouting(prepared.changeId, f.proof(prepared.challenge));
    assert.throws(
      () => f.service.applyRouting(prepared.changeId, f.proof(prepared.challenge)),
      /stale/,
    );
    assert.equal(f.service.snapshot().slots[0]!.pane!.paneId, a!.paneId);
    assert.equal(f.service.snapshot().slots[0]!.pane!.routing?.role, 'orchestrator');
    const stale = f.service.prepareTask('SYNTHETIC', '@terminal-b SYNTHETIC');
    const rename = f.service.prepareRouting(1, {
      name: 'SYNTHETIC reviewer',
      ...b!.routing!,
      handle: 'reviewer',
    });
    const concurrent = f.service.prepareRouting(0, update);
    f.service.applyRouting(rename.changeId, f.proof(rename.challenge));
    assert.throws(
      () => f.service.applyRouting(concurrent.changeId, f.proof(concurrent.challenge)),
      /stale/,
    );
    assert.throws(
      () =>
        f.service.runTask(stale.plan.taskId, stale.plan.correlationId, f.proof(stale.challenge)),
      /identity/,
    );
    assert.throws(() => f.service.prepareTask('SYNTHETIC', '@terminal-b SYNTHETIC'), /unavailable/);
    assert.doesNotThrow(() => f.service.prepareTask('SYNTHETIC', '@reviewer SYNTHETIC'));
    const collision = f.service.prepareRouting(1, {
      name: 'SYNTHETIC',
      ...b!.routing!,
      handle: 'terminal-a',
    });
    assert.throws(
      () => f.service.applyRouting(collision.changeId, f.proof(collision.challenge)),
      /already registered/,
    );
    assert.deepEqual(
      f.transports.map((t) => t.turns),
      [0, 0],
    );
  } finally {
    f.close();
  }
});

test('either native terminal may be source; matrix cycles are denied and result follows source identity', async () => {
  const f = fixture();
  try {
    for (const slot of [0, 1]) {
      const start = f.service.prepareStart(slot, 'synthetic-model');
      await f.service.launch(slot, f.proof(start.challenge));
    }
    f.allowRoute(1, 0, { role: 'orchestrator' });
    assert.throws(() => f.allowRoute(), /cycle/);
    const task = f.service.prepareTask('SYNTHETIC reverse source', '@terminal-a SYNTHETIC task', 1);
    assert.equal(task.plan.source.paneId, f.service.snapshot().slots[1]!.pane!.paneId);
    f.service.runTask(task.plan.taskId, task.plan.correlationId, f.proof(task.challenge));
    await tick();
    assert.throws(() => f.allowRoute(1, 0), /active/);
    const call = f.transports[1]!.delegate(task.plan.target.paneId, '@terminal-a SYNTHETIC task');
    await tick();
    f.transports[0]!.complete('SYNTHETIC reverse worker');
    await tick();
    f.transports[1]!.item({
      id: call,
      type: 'dynamicToolCall',
      tool: 'orqst_delegate_task',
      status: 'completed',
      success: true,
    });
    f.transports[1]!.complete('SYNTHETIC reverse root received');
    await tick();
    const snapshot = f.service.snapshot();
    assert.equal(snapshot.root?.state, 'completed');
    assert.equal(snapshot.root?.resultText, 'SYNTHETIC reverse root received');
    assert.equal(snapshot.messages[0]?.sourcePaneId, task.plan.source.paneId);
    assert.equal(snapshot.messages[0]?.targetPaneId, task.plan.target.paneId);
    assert.equal(snapshot.messages[0]?.correlationId, task.plan.correlationId);
    assert.equal(snapshot.messages[0]?.resultText, 'SYNTHETIC reverse worker');
    assert.equal(snapshot.messages[0]?.deliveryState, 'accepted');
  } finally {
    f.close();
  }
});

test('Desktop source loss blocks uncertain task retries; reopening cannot migrate or adopt journals', async () => {
  const f = fixture();
  try {
    for (const slot of [0, 1]) {
      const p = f.service.prepareStart(slot, 'synthetic-model');
      await f.service.launch(slot, f.proof(p.challenge));
    }
    f.allowRoute();
    const task = f.service.prepareTask('SYNTHETIC', '@terminal-b SYNTHETIC');
    f.service.runTask(task.plan.taskId, task.plan.correlationId, f.proof(task.challenge));
    await tick();
    f.transports[0]!.lost();
    await tick();
    assert.equal(f.service.snapshot().root!.state, 'outcome_unknown');
    assert.throws(() => f.service.prepareTask('SYNTHETIC', '@terminal-b SYNTHETIC'), /uncertain/);
    const file = join(f.service.project, '..', 'a', 'desktop-communication.sqlite');
    const before = readFileSync(file);
    assert.throws(
      () =>
        new DesktopManagedAgents(
          f.files,
          f.keys.publicKey,
          {
            open: () => {
              throw new Error('Never execute');
            },
          },
          {
            claim() {},
            assertOwner() {},
            prepareRelease() {
              return () => {};
            },
          },
        ),
      /Fresh private slots/,
    );
    assert.deepEqual(readFileSync(file), before);
    assert.throws(() => desktopAgentsAdmission(f.admissionDirectory), /reconciliation/);
    assert.deepEqual(
      f.transports.flatMap((t) => t.signals),
      [],
    );
  } finally {
    f.close();
  }
});

test('cross-restart admission requires signed retirement after confirmed native exits', async () => {
  const f = fixture();
  try {
    const a = f.service.prepareStart(0, 'synthetic-model');
    // No launch: preparing and canceling cannot occupy the durable global process admission.
    assert.doesNotThrow(() => desktopAgentsAdmission(f.admissionDirectory));
    await f.service.launch(0, f.proof(a.challenge));
    assert.throws(() => desktopAgentsAdmission(f.admissionDirectory), /reconciliation/);
    f.exits[0]!(0, null);
    assert.equal(f.service.snapshot().slots[0]!.state, 'exited');
    assert.throws(() => desktopAgentsAdmission(f.admissionDirectory), /reconciliation/);
    const retirement = f.service.prepareRetire();
    f.service.retire(f.proof(retirement.challenge));
    assert.equal(f.service.snapshot().admission, 'retired');
    assert.doesNotThrow(() => desktopAgentsAdmission(f.admissionDirectory));
  } finally {
    f.close();
  }
});

test('public Desktop requests cannot choose paths, proofs, target identities or provider approvals', () => {
  for (const request of [
    { version: 1, action: 'start', slot: 2, model: 'synthetic' },
    { version: 1, action: 'start', slot: 0, model: 'synthetic', file: '/untrusted' },
    {
      version: 1,
      action: 'delegate',
      text: 'synthetic',
      task: 'synthetic',
      targetPaneId: randomUUID(),
    },
    { version: 1, action: 'retire', owner: randomUUID() },
    { version: 1, action: 'retire', proof: {} },
    { version: 1, action: 'approve' },
  ])
    assert.equal(managedAgentsRequestSchema.safeParse(request).success, false);
});

test('uncertain task retirement preserves outcomes and evidence, requires every owned exit and fences old starts', async () => {
  const f = fixture();
  try {
    for (const slot of [0, 1]) {
      const start = f.service.prepareStart(slot, 'synthetic-model');
      await f.service.launch(slot, f.proof(start.challenge));
    }
    f.allowRoute();
    const task = f.service.prepareTask('SYNTHETIC', '@terminal-b SYNTHETIC');
    f.service.runTask(task.plan.taskId, task.plan.correlationId, f.proof(task.challenge));
    await tick();
    f.transports[0]!.complete('SYNTHETIC without verified delegation');
    await tick();
    assert.equal(f.service.snapshot().root!.state, 'outcome_unknown');
    assert.equal(f.service.snapshot().canRetire, false);
    assert.throws(() => f.service.prepareRetire(), /exit/);
    f.exits[0]!(0, null);
    assert.equal(f.service.snapshot().canRetire, false); // The other process is still live.
    f.exits[1]!(null, 'SIGTERM');
    assert.equal(f.service.snapshot().canRetire, true);
    const before = f.service.snapshot();
    const prepared = f.service.prepareRetire();
    assert.throws(() => f.service.retire({}), /proof/);
    assert.throws(() => desktopAgentsAdmission(f.admissionDirectory), /reconciliation/);
    f.service.retire(f.proof(prepared.challenge));
    const after = f.service.snapshot();
    assert.deepEqual(after.root, before.root);
    assert.deepEqual(after.messages, before.messages);
    assert.equal(after.admission, 'retired');
    assert.equal(after.canRetire, false);
    assert.throws(() => f.service.prepareStart(0, 'synthetic-model'), /retired/);
    assert.throws(() => f.service.prepareTask('SYNTHETIC', '@terminal-b SYNTHETIC'), /uncertain/);
    assert.throws(() => f.service.retire(f.proof(prepared.challenge)), /retirable/);
    assert.deepEqual(
      f.transports.flatMap((t) => t.signals),
      [],
    );
    const archive = readdirSync(f.admissionDirectory).find((name) => name.startsWith('retired-'))!;
    const evidence = readFileSync(join(f.admissionDirectory, archive), 'utf8');
    assert.match(evidence, /outcome_unknown/);
    assert.match(evidence, /SIGTERM/);
    assert.equal(evidence.includes('without verified delegation'), false);
    assert.doesNotThrow(() => desktopAgentsAdmission(f.admissionDirectory));
  } finally {
    f.close();
  }
});

test('lost ownership cannot retire capacity even after late exit; admission owner replacement stays blocked', async () => {
  const f = fixture();
  try {
    const start = f.service.prepareStart(0, 'synthetic-model');
    await f.service.launch(0, f.proof(start.challenge));
    f.transports[0]!.lost();
    f.exits[0]!(0, null);
    assert.equal(f.service.snapshot().slots[0]!.state, 'ownership_lost');
    assert.equal(f.service.snapshot().canRetire, false);
    assert.throws(() => f.service.prepareRetire(), /exit/);
    assert.throws(() => desktopAgentsAdmission(f.admissionDirectory), /reconciliation/);
    assert.deepEqual(f.transports[0]!.signals, []);
  } finally {
    f.close();
  }
});

test('changed admission owner cannot archive or release capacity', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'orqst-synthetic-admission-')));
  try {
    const admission = desktopAgentsAdmission(root);
    admission.claim();
    const file = join(root, 'active-pair.json');
    writeFileSync(file, 'SYNTHETIC replacement', { mode: 0o600 });
    assert.throws(() => admission.claim(), /owner changed/);
    assert.throws(() => admission.prepareRelease(null), /owner changed/);
    assert.equal(readFileSync(file, 'utf8'), 'SYNTHETIC replacement');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

for (const journal of ['terminal', 'communication'] as const) {
  test(`retirement refuses ${journal} owner fencing after native exits and after preparation`, async () => {
    const f = fixture();
    try {
      const start = f.service.prepareStart(0, 'synthetic-model');
      await f.service.launch(0, f.proof(start.challenge));
      f.exits[0]!(0, null);
      const prepared = f.service.prepareRetire();
      const database = new DatabaseSync(
        join(
          f.service.project,
          '..',
          'a',
          journal === 'terminal' ? 'terminal.sqlite' : 'desktop-communication.sqlite',
        ),
      );
      try {
        database.prepare(`UPDATE ${journal}_owner SET epoch=?`).run(randomUUID());
      } finally {
        database.close();
      }
      assert.throws(() => f.service.retire(f.proof(prepared.challenge)), /owner/i);
      assert.throws(() => desktopAgentsAdmission(f.admissionDirectory), /reconciliation/);
      assert.deepEqual(f.transports[0]!.signals, []);
      assert.equal(
        readdirSync(f.admissionDirectory).some((name) => name.startsWith('retired-')),
        false,
      );
    } finally {
      f.close();
    }
  });
}

test('archive I/O failure preserves live ownership and permits a new signed retirement review', async () => {
  const f = fixture();
  try {
    const start = f.service.prepareStart(0, 'synthetic-model');
    await f.service.launch(0, f.proof(start.challenge));
    f.exits[0]!(0, null);
    const prepared = f.service.prepareRetire();
    chmodSync(f.admissionDirectory, 0o500);
    assert.throws(() => f.service.retire(f.proof(prepared.challenge)), /EACCES|EPERM/);
    assert.equal(f.service.snapshot().admission, 'reserved');
    assert.equal(f.service.snapshot().canRetire, true);
    assert.throws(() => desktopAgentsAdmission(f.admissionDirectory), /reconciliation/);
    chmodSync(f.admissionDirectory, 0o700);
    const next = f.service.prepareRetire();
    f.service.retire(f.proof(next.challenge));
    assert.equal(f.service.snapshot().admission, 'retired');
    assert.deepEqual(f.transports[0]!.signals, []);
  } finally {
    chmodSync(f.admissionDirectory, 0o700);
    f.close();
  }
});

test('a reserved pair with no dispatched process can retire without fabricating an exit', async () => {
  const f = fixture();
  try {
    assert.equal(f.service.snapshot().admission, 'unclaimed');
    assert.equal(f.service.snapshot().canRetire, false);
    f.service.prepareStart(0, 'synthetic-model');
    await assert.rejects(f.service.launch(0, {}), /proof/);
    assert.equal(f.transports.length, 0);
    assert.equal(f.service.snapshot().canRetire, true);
    const prepared = f.service.prepareRetire();
    assert.deepEqual(prepared.evidence.processes, []);
    f.service.retire(f.proof(prepared.challenge));
    assert.equal(f.service.snapshot().admission, 'retired');
    assert.doesNotThrow(() => desktopAgentsAdmission(f.admissionDirectory));
  } finally {
    f.close();
  }
});

test('failed marker finalization can be reviewed again after fencing without retrying provider work', async () => {
  let attempts = 0;
  const f = fixture((admission) => ({
    ...admission,
    prepareRelease(evidence: unknown) {
      const finish = admission.prepareRelease(evidence);
      return () => {
        if (++attempts === 1) throw new Error('SYNTHETIC transient marker I/O failure');
        finish();
      };
    },
  }));
  try {
    const start = f.service.prepareStart(0, 'synthetic-model');
    await f.service.launch(0, f.proof(start.challenge));
    f.exits[0]!(0, null);
    const prepared = f.service.prepareRetire();
    assert.throws(() => f.service.retire(f.proof(prepared.challenge)), /transient/);
    assert.equal(f.service.snapshot().admission, 'reserved');
    assert.equal(f.service.snapshot().canRetire, true);
    assert.throws(() => f.service.prepareStart(1, 'synthetic-model'), /retired/);
    assert.throws(() => desktopAgentsAdmission(f.admissionDirectory), /reconciliation/);
    const next = f.service.prepareRetire();
    f.service.retire(f.proof(next.challenge));
    assert.equal(f.service.snapshot().admission, 'retired');
    assert.equal(f.transports.length, 1);
    assert.deepEqual(f.transports[0]!.signals, []);
    assert.equal(
      readdirSync(f.admissionDirectory).filter((name) => name.startsWith('retired-')).length,
      1,
    );
  } finally {
    f.close();
  }
});

test('saved team intent stays inert until fresh live identities and a signed route review', async () => {
  const f = fixture();
  try {
    const { team, terminalIds } = f.service.readTeam();
    assert.equal(team.revision, 0);
    const configuration = {
      version: 1 as const,
      name: 'SYNTHETIC saved team',
      members: terminalIds.map((terminalId, slot) => ({
        terminalId,
        name: `SYNTHETIC restored ${slot}`,
        handle: `restored-${slot}`,
        role: 'reviewer' as const,
        allowedTargetTerminalIds: slot === 0 ? [terminalIds[1]!] : [],
      })),
    };
    f.service.saveTeam({ expectedRevision: 0, configuration });
    assert.deepEqual(f.service.snapshot().slots, [null, null]);
    assert.equal(f.transports.length, 0);
    assert.throws(() => f.service.prepareTeamRouting(0, 1), /Live/);
    for (const slot of [0, 1]) {
      const start = f.service.prepareStart(slot, 'synthetic-model');
      await f.service.launch(slot, f.proof(start.challenge));
    }
    assert.deepEqual(f.service.snapshot().slots[0]!.pane!.routing!.allowedTargetPaneIds, []);
    assert.equal(f.service.snapshot().slots[0]!.pane!.routing!.role, 'worker');
    assert.throws(() => f.service.prepareTask('SYNTHETIC', '@terminal-b task'), /denied/);
    assert.throws(() => f.service.prepareTeamRouting(0, 0), /Stale/);
    const proposal = f.service.prepareTeamRouting(0, 1);
    assert.deepEqual(f.service.snapshot().slots[0]!.pane!.routing!.allowedTargetPaneIds, []);
    assert.throws(() => f.service.applyRouting(proposal.changeId, {}));
    f.service.applyRouting(proposal.changeId, f.proof(proposal.challenge));
    const pane = f.service.snapshot().slots[0]!.pane!;
    assert.equal(pane.routing!.handle, 'restored-0');
    assert.equal(pane.routing!.role, 'reviewer');
    assert.deepEqual(pane.routing!.allowedTargetPaneIds, [
      f.service.snapshot().slots[1]!.pane!.paneId,
    ]);
    assert.equal(
      f.transports.reduce((sum, transport) => sum + transport.turns, 0),
      0,
    );
    assert.equal(f.service.readTeam().team.revision, 1);
  } finally {
    f.close();
  }
});

async function startFeaturePair(f: ReturnType<typeof fixture>) {
  for (const slot of [0, 1]) {
    const start = f.service.prepareStart(slot, 'synthetic-model');
    assert.equal(start.manifest.workspaceId, f.workspaceId);
    assert.equal(start.manifest.featureId, f.featureId);
    await f.service.launch(slot, f.proof(start.challenge));
  }
  f.allowRoute();
}

function saveFeaturePolicy(
  f: ReturnType<typeof fixture>,
  operations: Array<'delegate' | 'execute' | 'view'>,
) {
  const ids = f.service.readTeam().terminalIds;
  return f.features.savePermissions(f.featureId!, 'SYNTHETIC-native-owner', {
    expectedRevision: f.features.readPermissions(f.featureId!).revision,
    configuration: {
      schemaVersion: 1,
      rules: operations.length
        ? [{ sourceTerminalId: ids[0]!, targetTerminalId: ids[1]!, operations }]
        : [],
    },
  });
}

test('production host composition uses canonical Feature IDs, neutral absence, scoped mentions and retained journal digest', async () => {
  const f = fixture(undefined, true);
  try {
    const catalogue = readFileSync(f.native.observerDatabase);
    assert.notEqual(f.workspaceId, terminalDigest(f.service.project));
    assert.deepEqual(f.features.readPermissions(f.featureId!).configuration, null);
    await startFeaturePair(f);
    for (const slot of f.service.snapshot().slots) {
      assert.equal(slot!.pane!.workspaceId, f.workspaceId);
      assert.equal(slot!.pane!.featureId, f.featureId);
    }
    const task = f.service.prepareTask('SYNTHETIC neutral', '@terminal-b SYNTHETIC worker');
    assert.equal(task.plan.policyRevision, 0);
    f.service.runTask(task.plan.taskId, task.plan.correlationId, f.proof(task.challenge));
    await tick();
    f.transports[0]!.delegate(task.plan.target.paneId, '@terminal-b SYNTHETIC worker');
    await tick();
    assert.equal(f.transports[1]!.turns, 1);
    assert.deepEqual(readFileSync(f.native.observerDatabase), catalogue);
    const journal = new DatabaseSync(join(f.service.project, '..', 'a', 'terminal.sqlite'), {
      readOnly: true,
    });
    try {
      // The execution journal uses its historical project domain, independently of the catalogue.
      const rows = journal.prepare('SELECT project_id FROM terminal_attempts').all();
      assert.equal(rows[0]!.project_id, terminalDigest(f.service.project));
    } finally {
      journal.close();
    }
  } finally {
    f.close();
  }
});

test('production host saved policy restricts root preparation and stale plans without starting provider turns', async () => {
  const f = fixture(undefined, true);
  try {
    await startFeaturePair(f);
    f.allowRoute(0, 1, { role: 'orchestrator' });
    const stale = f.service.prepareTask('SYNTHETIC', '@terminal-b SYNTHETIC');
    saveFeaturePolicy(f, []);
    assert.throws(
      () => f.service.prepareTask('SYNTHETIC', '@terminal-b SYNTHETIC'),
      /permission denied/,
    );
    f.service.runTask(stale.plan.taskId, stale.plan.correlationId, f.proof(stale.challenge));
    await tick();
    assert.deepEqual(
      f.transports.map((t) => t.turns),
      [0, 0],
    );
    assert.equal(f.service.snapshot().root!.state, 'outcome_unknown');
    assert.deepEqual(f.service.snapshot().messages, []);
  } finally {
    f.close();
  }
});

for (const failure of [
  'archived',
  'corrupt',
  'foreign-workspace',
  'future-schema',
  'reader-unavailable',
] as const) {
  test(`production host composition denies ${failure} after capture; no provider turn or new message`, async () => {
    const f = fixture(undefined, true);
    try {
      await startFeaturePair(f);
      saveFeaturePolicy(f, ['delegate', 'execute', 'view']);
      if (failure === 'reader-unavailable') {
        chmodSync(
          join(f.native.preferencesDirectory, 'terminal-layouts/preferences.sqlite'),
          0o644,
        );
      } else {
        const db = new DatabaseSync(
          join(f.native.preferencesDirectory, 'terminal-layouts/preferences.sqlite'),
        );
        try {
          // Simulate an already archived catalogue, without weakening native lifecycle review.
          if (failure === 'archived') db.exec("UPDATE features SET status='archived'");
          if (failure === 'corrupt') db.exec("UPDATE feature_permissions SET metadata='{}'");
          if (failure === 'foreign-workspace')
            db.prepare('UPDATE feature_permissions SET workspace_id=?').run(
              terminalDigest(f.service.project),
            );
          if (failure === 'future-schema')
            db.exec('UPDATE feature_permission_schema SET version=2');
        } finally {
          db.close();
        }
      }
      assert.throws(() => f.service.prepareTask('SYNTHETIC', '@terminal-b SYNTHETIC'));
      assert.deepEqual(
        f.transports.map((t) => t.turns),
        [0, 0],
      );
      assert.deepEqual(f.service.snapshot().messages, []);
    } finally {
      f.close();
    }
  });
}

test('production host uses Feature team facade and preserves legacy keys without policy fallback', async () => {
  const f = fixture(undefined, true);
  try {
    const ids = f.service.readTeam().terminalIds;
    const legacy = terminalTeamDatabase(
      f.native.preferencesDirectory,
      ids,
      terminalDigest(f.service.project),
    );
    const configuration = {
      version: 1 as const,
      name: 'SYNTHETIC retained legacy team',
      members: ids.map((terminalId, slot) => ({
        terminalId,
        name: `SYNTHETIC ${slot}`,
        handle: `scoped-${slot}`,
        role: 'worker' as const,
        allowedTargetTerminalIds: slot === 0 ? [ids[1]!] : [],
      })),
    };
    legacy.save({ expectedRevision: 0, configuration });
    const retained = legacy.read();
    assert.equal(f.service.readTeam().team.revision, 0);
    f.service.saveTeam({
      expectedRevision: 0,
      configuration: { ...configuration, name: 'SYNTHETIC Feature team' },
    });
    assert.deepEqual(legacy.read(), retained);
    await startFeaturePair(f);
    saveFeaturePolicy(f, []);
    const denied = f.service.prepareTeamRouting(0, 1);
    assert.deepEqual(denied.plan.update.allowedTargetPaneIds, []);
    saveFeaturePolicy(f, ['delegate', 'execute', 'view']);
    const allowed = f.service.prepareTeamRouting(0, 1);
    assert.deepEqual(allowed.plan.update.allowedTargetPaneIds, [
      f.service.snapshot().slots[1]!.pane!.paneId,
    ]);
    assert.deepEqual(legacy.read(), retained);
  } finally {
    f.close();
  }
});

test('production bootstrap refuses missing reader context, divergent IDs, foreign native roots and mixed bindings', () => {
  const f = fixture(undefined, true);
  try {
    const admission = { claim() {}, assertOwner() {}, prepareRelease: () => () => {} };
    assert.throws(
      () => nativeManagedAgentsFeatureContext(f.files, undefined),
      /Native Feature context unavailable/,
    );
    assert.throws(
      () => managedAgentsHostComposition(f.hostArgs.slice(0, 4), f.backend, admission),
      /Native Feature context unavailable/,
    );
    const divergent = JSON.parse(f.hostArgs[4]!) as Record<string, unknown>;
    (divergent.feature as Record<string, unknown>).workspaceId = terminalDigest(f.service.project);
    assert.throws(
      () =>
        managedAgentsHostComposition(
          [...f.hostArgs.slice(0, 4), JSON.stringify(divergent)],
          f.backend,
          admission,
        ),
      /scope mismatch/,
    );
    assert.throws(
      () =>
        nativeManagedAgentsFeatureContext(f.files, {
          ...f.native,
          preferencesDirectory: f.admissionDirectory,
        }),
      /binding mismatch/,
    );
    const original = readFileSync(f.files[1], 'utf8');
    const config = JSON.parse(original) as ManagedCodexConfig;
    delete config.preparation;
    writeFileSync(f.files[1], JSON.stringify(config), { mode: 0o600 });
    assert.throws(() => nativeManagedAgentsFeatureContext(f.files, f.native), /binding mismatch/);
    assert.throws(
      () => f.service.prepareStart(0, 'synthetic-model'),
      /Native Feature binding mismatch/,
    );
    assert.equal(f.transports.length, 0);
  } finally {
    f.close();
  }
});

for (const scope of [true, 'null'] as const) {
  test(`untrusted ${scope} manifest roots are untouched at bootstrap, prepare and launch for both slots`, () => {
    const f = fixture(undefined, scope);
    try {
      const alternate = join(f.native.preferencesDirectory, '..', 'alternate');
      mkdirSync(alternate, { mode: 0o700 });
      const alternateObserver = join(alternate, 'observer.sqlite');
      copyFileSync(f.native.observerDatabase, alternateObserver);
      const alternatePreferences = join(alternate, 'preferences');
      mkdirSync(alternatePreferences, { mode: 0o700 });
      writeFileSync(join(alternatePreferences, 'marker'), 'SYNTHETIC', { mode: 0o600 });
      const snapshot = (directory: string): unknown =>
        readdirSync(directory)
          .sort()
          .map((name) => {
            const path = join(directory, name);
            const info = lstatSync(path, { bigint: true });
            return [
              name,
              info.mtimeNs,
              info.size,
              info.isDirectory() ? snapshot(path) : readFileSync(path),
            ];
          });
      const admission = { claim() {}, assertOwner() {}, prepareRelease: () => () => {} };
      for (const slot of [0, 1]) {
        for (const field of ['observerDatabase', 'preferencesDirectory'] as const) {
          const start = f.service.prepareStart(0, 'synthetic-model');
          const original = readFileSync(f.files[slot]!, 'utf8');
          const config = JSON.parse(original) as ManagedCodexConfig;
          config.preparation![field] =
            field === 'observerDatabase' ? alternateObserver : alternatePreferences;
          writeFileSync(f.files[slot]!, JSON.stringify(config), { mode: 0o600 });
          const before = [lstatSync(alternate, { bigint: true }).mtimeNs, snapshot(alternate)];
          assert.throws(() => nativeManagedAgentsFeatureContext(f.files, f.native));
          assert.throws(() => nativeManagedAgentsFeatureContext(f.files, undefined));
          assert.throws(() => managedAgentsHostComposition(f.hostArgs, f.backend, admission));
          assert.throws(() => f.service.prepareStart(0, 'synthetic-model'));
          assert.throws(() => f.service.launch(0, f.proof(start.challenge)));
          assert.deepEqual(
            [lstatSync(alternate, { bigint: true }).mtimeNs, snapshot(alternate)],
            before,
          );
          assert.equal(f.transports.length, 0);
          writeFileSync(f.files[slot]!, original, { mode: 0o600 });
        }
      }
    } finally {
      f.close();
    }
  });
}

test('native host authenticates the exact manifest snapshot before touching alternative roots', () => {
  const f = fixture(undefined, true);
  let fd: number | undefined;
  try {
    const file = f.files[0];
    const original = readFileSync(file);
    readManagedAgentsPair(f.files, f.native); // Parent validation before dispatch.
    const config = JSON.parse(original.toString('utf8')) as ManagedCodexConfig;
    const binding = {
      instanceId: randomUUID(),
      epoch: randomUUID(),
      manifestDigest: 'a'.repeat(64),
      configDigest: terminalDigest(original),
    };
    fd = createLifecycleReceipt(config.state, binding);
    const receiptPath = join(config.state, `lifecycle-${binding.instanceId}.jsonl`);
    const receiptBefore = readFileSync(receiptPath);
    const alternate = join(f.native.preferencesDirectory, '..', 'alternate-host');
    mkdirSync(alternate, { mode: 0o700 });
    const observer = join(alternate, 'observer.sqlite');
    copyFileSync(f.native.observerDatabase, observer);
    const preferences = join(alternate, 'preferences');
    mkdirSync(preferences, { mode: 0o700 });
    writeFileSync(join(preferences, 'marker'), 'SYNTHETIC', { mode: 0o600 });
    const snapshot = (path: string): unknown => {
      const info = lstatSync(path, { bigint: true });
      return [
        info.mtimeNs,
        info.size,
        info.isDirectory()
          ? readdirSync(path)
              .sort()
              .map((name) => [name, snapshot(join(path, name))])
          : readFileSync(path),
      ];
    };
    config.preparation!.observerDatabase = observer;
    config.preparation!.preferencesDirectory = preferences;
    writeFileSync(file, JSON.stringify(config), { mode: 0o600 });
    const before = snapshot(alternate);
    let spawns = 0;
    const dispatch = () => {
      const prepared = prepareNativeHost(file, fd!);
      spawns++; // Stand-in for the native-host spawn, never starts a process.
      return prepared;
    };
    assert.throws(dispatch, /Lifecycle config mismatch/);
    assert.deepEqual(snapshot(alternate), before);
    assert.deepEqual(readFileSync(receiptPath), receiptBefore);
    assert.equal(spawns, 0);
    writeFileSync(file, original);
    const prepared = dispatch();
    assert.deepEqual(prepared.config, JSON.parse(original.toString('utf8')));
    assert.equal(spawns, 1);
    assert.match(readFileSync(receiptPath, 'utf8'), /"type":"armed"/);
  } finally {
    if (fd !== undefined) closeSync(fd);
    f.close();
  }
});

test('null Feature binding survives private bootstrap and launch in the legacy domain', async () => {
  const f = fixture(undefined, 'null');
  try {
    for (const slot of [0, 1]) {
      const start = f.service.prepareStart(slot, 'synthetic-model');
      assert.equal(start.manifest.featureId, undefined);
      assert.equal(start.manifest.workspaceId, terminalDigest(f.service.project));
      await f.service.launch(slot, f.proof(start.challenge));
    }
    assert.equal(f.transports.length, 2);
  } finally {
    f.close();
  }
});

test('mixed null and Feature bindings are refused', () => {
  const f = fixture(undefined, 'null');
  try {
    const config = JSON.parse(readFileSync(f.files[1], 'utf8')) as ManagedCodexConfig;
    config.preparation!.featureId = randomUUID();
    writeFileSync(f.files[1], JSON.stringify(config), { mode: 0o600 });
    assert.throws(() => nativeManagedAgentsFeatureContext(f.files, f.native), /binding mismatch/);
    assert.throws(() => f.service.prepareStart(0, 'synthetic-model'), /binding mismatch/);
    assert.equal(f.transports.length, 0);
  } finally {
    f.close();
  }
});

test('Feature composition revalidates view fence before launch without promoting legacy manifests', async () => {
  const f = fixture(undefined, true);
  try {
    const start = f.service.prepareStart(0, 'synthetic-model');
    f.features.saveView({ expectedRevision: f.features.readView().revision, featureId: null });
    assert.throws(() => f.service.launch(0, f.proof(start.challenge)), /Selected Feature changed/);
    assert.equal(f.transports.length, 0);
    assert.equal(f.service.snapshot().admission, 'unclaimed');
  } finally {
    f.close();
  }
  const legacy = fixture();
  try {
    assert.equal(nativeManagedAgentsFeatureContext(legacy.files, legacy.native), undefined);
    assert.equal(nativeManagedAgentsFeatureContext(legacy.files, undefined), undefined);
    assert.equal(legacy.service.prepareStart(0, 'synthetic-model').manifest.featureId, undefined);
  } finally {
    legacy.close();
  }
});

test('captured Feature scope survives navigation while policies keep restricting delegation', async () => {
  const f = fixture(undefined, true);
  try {
    await startFeaturePair(f);
    f.features.saveView({ expectedRevision: f.features.readView().revision, featureId: null });
    const task = f.service.prepareTask('SYNTHETIC', '@terminal-b SYNTHETIC');
    assert.equal(task.plan.policyRevision, 0);
    saveFeaturePolicy(f, []);
    assert.throws(
      () => f.service.prepareTask('SYNTHETIC', '@terminal-b SYNTHETIC'),
      /permission denied/,
    );
    assert.deepEqual(
      f.transports.map((t) => t.turns),
      [0, 0],
    );
    assert.deepEqual(
      f.transports.flatMap((t) => t.signals),
      [],
    );
  } finally {
    f.close();
  }
});

test('renderer and operational IPC requests cannot override the native Feature bootstrap', () => {
  for (const injected of [
    { workspaceId: 'a'.repeat(64) },
    { featureId: randomUUID() },
    { preferencesDirectory: '/SYNTHETIC/foreign' },
    { observerDatabase: '/SYNTHETIC/foreign.sqlite' },
    { featureContext: { workspaceId: 'a'.repeat(64), featureId: randomUUID() } },
  ]) {
    assert.equal(
      managedAgentsRequestSchema.safeParse({
        version: 1,
        action: 'start',
        slot: 0,
        model: 'synthetic',
        ...injected,
      }).success,
      false,
    );
    assert.equal(
      agentsHostRequestSchema.safeParse({
        id: randomUUID(),
        operation: 'prepareStart',
        slot: 0,
        model: 'synthetic',
        ...injected,
      }).success,
      false,
    );
  }
});
