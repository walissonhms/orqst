// SYNTHETIC fixtures only: no provider executable, account or external source access.
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import {
  chmodSync,
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
import { managedAgentsRequestSchema } from '@orqst/protocol';
import { DesktopManagedAgents } from '../packages/core/src/managed-codex/desktop.js';
import { desktopAgentsAdmission } from '../packages/core/src/managed-codex/desktop-admission.js';
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
  const keys = generateKeyPairSync('ed25519');
  const transports: SyntheticDesktopTransport[] = [];
  const admissionDirectory = join(root, 'admission');
  const exits: Array<(code: number | null, signal: string | null) => void> = [];
  const service = new DesktopManagedAgents(
    files,
    keys.publicKey,
    {
      open: (_f, _c, events) => {
        exits.push(events.exit);
        const transport = new SyntheticDesktopTransport();
        transports.push(transport);
        queueMicrotask(() => events.started(123));
        return transport;
      },
    },
    wrapAdmission(desktopAgentsAdmission(admissionDirectory)),
  );
  const proof = (challenge: TerminalChallenge) => ({
    challengeId: challenge.challengeId,
    signature: sign(null, terminalChallengeBytes(challenge), keys.privateKey).toString('base64url'),
  });
  return {
    service,
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
