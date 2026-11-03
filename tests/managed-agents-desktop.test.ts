// SYNTHETIC fixtures only: no provider executable, account or external source access.
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
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
function fixture() {
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
    desktopAgentsAdmission(admissionDirectory),
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
    const task = f.service.prepareTask('SYNTHETIC A instructions', 'SYNTHETIC B task');
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
    const call = f.transports[0]!.delegate(task.plan.target.paneId, 'SYNTHETIC B task');
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

test('Desktop source loss blocks uncertain task retries; reopening cannot migrate or adopt journals', async () => {
  const f = fixture();
  try {
    for (const slot of [0, 1]) {
      const p = f.service.prepareStart(slot, 'synthetic-model');
      await f.service.launch(slot, f.proof(p.challenge));
    }
    const task = f.service.prepareTask('SYNTHETIC', 'SYNTHETIC');
    f.service.runTask(task.plan.taskId, task.plan.correlationId, f.proof(task.challenge));
    await tick();
    f.transports[0]!.lost();
    await tick();
    assert.equal(f.service.snapshot().root!.state, 'outcome_unknown');
    assert.throws(() => f.service.prepareTask('SYNTHETIC', 'SYNTHETIC'), /uncertain/);
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
          { claim() {}, release() {} },
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

test('cross-restart admission releases only after confirmed native exits with no uncertain task', async () => {
  const f = fixture();
  try {
    const a = f.service.prepareStart(0, 'synthetic-model');
    // No launch: preparing and canceling cannot occupy the durable global process admission.
    assert.doesNotThrow(() => desktopAgentsAdmission(f.admissionDirectory));
    await f.service.launch(0, f.proof(a.challenge));
    assert.throws(() => desktopAgentsAdmission(f.admissionDirectory), /reconciliation/);
    f.exits[0]!(0, null);
    assert.equal(f.service.snapshot().slots[0]!.state, 'exited');
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
    { version: 1, action: 'approve' },
  ])
    assert.equal(managedAgentsRequestSchema.safeParse(request).success, false);
});
