// SYNTHETIC native-protocol fixtures only. Never launch Codex or inspect user credentials/history.
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Store } from '@orqst/database';
import type { CommunicationContent, CommunicationPane, PaneSend } from '@orqst/protocol';
import {
  PaneCommunication,
  type CommunicationContentScope,
} from '../packages/core/src/communication/service.js';
import {
  CodexChannel,
  codexChannelLimits,
  type CodexTransport,
} from '../packages/core/src/managed-codex/channel.js';
import {
  CodexStructuredRuntime,
  nativeCodexBackend,
  type CodexRuntimeBackend,
} from '../packages/core/src/managed-codex/runtime.js';
import {
  TerminalAuthority,
  terminalChallengeBytes,
  terminalDigest,
  type TerminalChallenge,
} from '../packages/core/src/terminal/authority.js';
import {
  managedCodexSettings,
  terminalExecutableSha256,
  type ManagedCodexConfig,
} from '../packages/core/src/terminal/codex-profile.js';

class SyntheticTransport implements CodexTransport {
  data: (bytes: Uint8Array) => void = () => {};
  lost: () => void = () => {};
  requests: Array<{ method: string; params: Record<string, unknown> }> = [];
  signals: string[] = [];
  detached = false;
  threadId = randomUUID();
  turnId = randomUUID();
  reportedModel = 'synthetic-model';
  startedBeforeReply = true;
  replyToTurn = true;
  listen(data: (bytes: Uint8Array) => void, lost: () => void) {
    this.data = data;
    this.lost = lost;
    return () => {
      this.data = () => {};
      this.lost = () => {};
    };
  }
  emit(message: object) {
    this.data(Buffer.from(JSON.stringify(message) + '\n'));
  }
  send(line: string) {
    const request = JSON.parse(line) as {
      id: string;
      method: string;
      params: Record<string, unknown>;
    };
    this.requests.push(request);
    queueMicrotask(() => {
      if (request.method === 'initialize')
        this.emit({ id: request.id, result: { userAgent: 'SYNTHETIC' } });
      if (request.method === 'thread/start')
        this.emit({
          id: request.id,
          result: { thread: { id: this.threadId }, model: this.reportedModel },
        });
      if (request.method === 'turn/start' && this.replyToTurn) {
        this.turnId = randomUUID();
        if (this.startedBeforeReply) this.event('turn/started');
        this.emit({ id: request.id, result: { turn: { id: this.turnId, status: 'inProgress' } } });
        if (!this.startedBeforeReply) queueMicrotask(() => this.event('turn/started'));
      }
    });
  }
  event(method: string, status = 'inProgress', threadId = this.threadId, turnId = this.turnId) {
    this.emit({ method, params: { threadId, turn: { id: turnId, status } } });
  }
  complete(text = 'SYNTHETIC RESULT') {
    this.emit({
      method: 'item/completed',
      params: {
        threadId: this.threadId,
        turnId: this.turnId,
        item: { id: randomUUID(), type: 'agentMessage', phase: 'final_answer', text },
      },
    });
    this.event('turn/completed', 'completed');
  }
  signal(signal: 'SIGTERM' | 'SIGKILL') {
    this.signals.push(signal);
  }
  detach() {
    this.detached = true;
  }
}
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'orqst-synthetic-structured-')));
  const project = join(root, 'project');
  mkdirSync(project, { mode: 0o700 });
  const keys = generateKeyPairSync('ed25519');
  const authority = new TerminalAuthority(
    new Map([['synthetic-native', keys.publicKey]]),
    Date.now,
  );
  const store = new Store(join(root, 'communication.sqlite'));
  const contents = new Map<string, { scope: CommunicationContentScope; bytes: Uint8Array }>();
  const communication = new PaneCommunication(
    store.communicationJournal(randomUUID(), { recover: false }),
    (scope, id) => {
      const record = contents.get(id);
      assert.ok(record);
      assert.deepEqual(scope, record.scope);
      return record.bytes;
    },
  );
  const write = (scope: CommunicationContentScope, bytes: Uint8Array): CommunicationContent => {
    const id = randomUUID();
    contents.set(id, { scope, bytes: Uint8Array.from(bytes) });
    return { id, bytes: bytes.length, sha256: terminalDigest(bytes) };
  };
  const transports: SyntheticTransport[] = [];
  const exits: Array<(code: number | null, signal: string | null) => void> = [];
  const backend: CodexRuntimeBackend = {
    open: (_file, _config, events) => {
      const transport = new SyntheticTransport();
      transports.push(transport);
      exits.push(events.exit);
      queueMicrotask(events.started);
      return transport;
    },
  };
  const runtime = new CodexStructuredRuntime(authority, communication, write, backend);
  const executable = realpathSync(process.execPath);
  const binary = { path: executable, sha256: terminalExecutableSha256(executable) };
  const config = (name: string) => {
    const state = join(root, name);
    mkdirSync(state, { mode: 0o700 });
    for (const directory of ['home', 'codex', 'tmp'])
      mkdirSync(join(state, directory), { mode: 0o700 });
    const config: ManagedCodexConfig = {
      version: 1,
      trust: 'native-same-user',
      executable: binary,
      executableVersion: 'SYNTHETIC-NOT-CODEX',
      node: binary,
      project,
      state,
    };
    writeFileSync(join(state, 'codex/config.toml'), managedCodexSettings(config), { mode: 0o600 });
    const file = join(state, 'terminal.json');
    writeFileSync(file, JSON.stringify(config), { mode: 0o600 });
    return { file, config };
  };
  const proof = (challenge: TerminalChallenge) => ({
    challengeId: challenge.challengeId,
    signature: sign(null, terminalChallengeBytes(challenge), keys.privateKey).toString('base64url'),
  });
  const prepare = (file: string, name: string, model: string | null = 'synthetic-model') =>
    runtime.prepare('synthetic-native', file, {
      workspaceId: 'synthetic-workspace',
      name,
      ownerId: 'synthetic-owner',
      model,
    });
  const launch = async (file: string, name: string) => {
    const prepared = prepare(file, name);
    return { pane: await runtime.launch(prepared.instanceId, proof(prepared.challenge)), prepared };
  };
  const client = (source: CommunicationPane, target: CommunicationPane) =>
    communication.authorize({
      actorId: 'synthetic-owner',
      workspaceId: source.workspaceId,
      sourcePaneId: source.paneId,
      targetPaneIds: [target.paneId],
      expiresAt: Date.now() + 60000,
    });
  const request = (source: CommunicationPane, target: CommunicationPane): PaneSend => ({
    schemaVersion: 1,
    messageId: randomUUID(),
    taskId: randomUUID(),
    correlationId: randomUUID(),
    workspaceId: source.workspaceId,
    sourcePaneId: source.paneId,
    targetPaneId: target.paneId,
    parentTaskId: null,
    kind: 'task.request',
    payload: write(
      {
        workspaceId: source.workspaceId,
        actorId: 'synthetic-owner',
        sourcePaneId: source.paneId,
        targetPaneId: target.paneId,
        purpose: 'request',
      },
      Buffer.from('SYNTHETIC BOUNDED TASK'),
    ),
    deliveryPolicy: 'queue-if-busy',
    idempotencyKey: randomUUID(),
    deadline: Date.now() + 50000,
  });
  return {
    root,
    config,
    authority,
    communication,
    runtime,
    transports,
    exits,
    prepare,
    proof,
    launch,
    request,
    client,
    close: () => {
      runtime.shutdown();
      store.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

test('two independently authorized structured Codex fixtures delegate and return correlated results automatically', async () => {
  const f = fixture();
  try {
    const a = await f.launch(f.config('slot-a').file, 'Initiator');
    const b = await f.launch(f.config('slot-b').file, 'Worker');
    assert.equal(a.pane.displayId, 'T-001');
    assert.equal(b.pane.displayId, 'T-002');
    assert.notEqual(a.pane.binding!.instanceId, b.pane.binding!.instanceId);
    assert.equal(a.pane.binding!.projectId, b.pane.binding!.projectId);
    assert.notEqual(
      f.runtime.snapshot(a.prepared.instanceId).slotId,
      f.runtime.snapshot(b.prepared.instanceId).slotId,
    );
    const caller = f.client(a.pane, b.pane);
    const updates: string[] = [];
    caller.subscribe((message) => updates.push(message.taskState));
    const request = f.request(a.pane, b.pane);
    assert.equal(caller.send(request).deliveryState, 'queued');
    assert.equal(caller.send(request).messageId, request.messageId);
    const admitted = await f.communication.dispatchNext(b.pane.paneId);
    assert.equal(admitted!.deliveryState, 'accepted');
    assert.equal(admitted!.taskState, 'running');
    assert.equal(caller.inbox().length, 0);
    const second = f.request(a.pane, b.pane);
    caller.send(second);
    assert.equal(await f.communication.dispatchNext(b.pane.paneId), undefined);
    f.transports[1]!.complete();
    await tick();
    const completed = caller.status(request.messageId);
    assert.equal(completed.taskState, 'completed');
    assert.equal(completed.deliveryState, 'accepted'); // No separate delivery receipt was invented.
    assert.ok(completed.result);
    assert.equal(caller.inbox()[0]!.taskId, request.taskId);
    assert.ok(updates.includes('completed'));
    assert.equal((await f.communication.dispatchNext(b.pane.paneId))!.taskState, 'running');
    f.transports[1]!.complete('SYNTHETIC SECOND RESULT');
    assert.equal(caller.inbox().length, 2);
    const turn = f.transports[1]!.requests.find((request) => request.method === 'turn/start')!;
    assert.deepEqual(turn.params.input, [{ type: 'text', text: 'SYNTHETIC BOUNDED TASK' }]);
    assert.equal(f.runtime.snapshot(b.prepared.instanceId).reportedModel, 'synthetic-model');
  } finally {
    f.close();
  }
});

test('native starts require exact one-use proof, distinct state and capacity; stops need separate proof', async () => {
  const f = fixture();
  try {
    const slot = f.config('slot-a');
    const prepared = f.prepare(slot.file, 'A');
    await assert.rejects(f.runtime.launch(prepared.instanceId, {}), /authorization|proof/);
    assert.equal(f.transports.length, 0);
    const pane = await f.runtime.launch(prepared.instanceId, f.proof(prepared.challenge));
    assert.ok(pane.binding);
    await assert.rejects(
      f.runtime.launch(prepared.instanceId, f.proof(prepared.challenge)),
      /already used/,
    );
    const same = f.prepare(slot.file, 'same-home');
    await assert.rejects(f.runtime.launch(same.instanceId, f.proof(same.challenge)), /isolation/);
    const second = await f.launch(f.config('slot-b').file, 'B');
    const third = f.prepare(f.config('slot-c').file, 'C');
    await assert.rejects(f.runtime.launch(third.instanceId, f.proof(third.challenge)), /capacity/);
    const stop = f.runtime.requestStop('synthetic-native', prepared.instanceId, 'SIGTERM');
    assert.throws(
      () => f.runtime.stop(second.prepared.instanceId, 'SIGTERM', f.proof(stop)),
      /authorization/,
    );
    f.runtime.stop(prepared.instanceId, 'SIGTERM', f.proof(stop));
    assert.deepEqual(f.transports[0]!.signals, ['SIGTERM']);
    assert.equal(f.runtime.snapshot(prepared.instanceId).state, 'running'); // Request is not exit evidence.
    f.exits[0]!(0, null);
    assert.equal(f.runtime.snapshot(prepared.instanceId).state, 'exited');
    assert.equal(f.communication.resolvePane('synthetic-workspace', pane.paneId).state, 'closed');
    const next = await f.launch(slot.file, 'A-new-process');
    assert.equal(next.pane.displayId, 'T-003');
    assert.notEqual(next.pane.paneId, pane.paneId);
  } finally {
    f.close();
  }
});

test('manifest drift and exact requested model mismatch fail closed without provider fallback', async () => {
  const f = fixture();
  try {
    const slot = f.config('drift');
    const prepared = f.prepare(slot.file, 'Drift');
    writeFileSync(slot.file, JSON.stringify({ ...slot.config, executableVersion: 'changed' }));
    await assert.rejects(
      f.runtime.launch(prepared.instanceId, f.proof(prepared.challenge)),
      /manifest changed/,
    );
    assert.equal(f.transports.length, 0);
    const mismatch = f.prepare(f.config('mismatch').file, 'Mismatch', 'unavailable-model');
    await assert.rejects(
      f.runtime.launch(mismatch.instanceId, f.proof(mismatch.challenge)),
      /unavailable|uncertain/,
    );
    assert.equal(f.runtime.snapshot(mismatch.instanceId).state, 'ownership_lost');
    assert.equal(
      f.transports[0]!.requests.some((r) => r.method === 'turn/start'),
      false,
    );
    assert.equal(f.transports[0]!.detached, true);
  } finally {
    f.close();
  }
});

for (const failure of [
  'wrong-turn',
  'missing-result',
  'interrupted',
  'transport-loss',
  'approval',
  'process-exit',
] as const) {
  test(`structured ${failure} preserves uncertainty instead of inventing task completion`, async () => {
    const f = fixture();
    try {
      const a = await f.launch(f.config('slot-a').file, 'A');
      const b = await f.launch(f.config('slot-b').file, 'B');
      const caller = f.client(a.pane, b.pane);
      const request = f.request(a.pane, b.pane);
      caller.send(request);
      await f.communication.dispatchNext(b.pane.paneId);
      const target = f.transports[1]!;
      if (failure === 'wrong-turn')
        target.event('turn/completed', 'completed', target.threadId, randomUUID());
      if (failure === 'missing-result') target.event('turn/completed', 'completed');
      if (failure === 'interrupted') target.event('turn/completed', 'interrupted');
      if (failure === 'transport-loss') target.lost();
      if (failure === 'process-exit') f.exits[1]!(0, null);
      if (failure === 'approval') {
        target.emit({
          id: 7,
          method: 'item/commandExecution/requestApproval',
          params: { threadId: target.threadId, turnId: target.turnId },
        });
        assert.equal(caller.status(request.messageId).taskState, 'waiting_approval');
        assert.equal(
          target.requests.some((r) => Reflect.has(r, 'result')),
          false,
        );
        f.runtime.shutdown();
      }
      assert.equal(caller.status(request.messageId).taskState, 'outcome_unknown');
      assert.equal(caller.status(request.messageId).result, null);
      assert.equal(caller.status(request.messageId).deliveryState, 'accepted');
      assert.equal(target.detached, true);
      assert.deepEqual(target.signals, []);
    } finally {
      f.close();
    }
  });
}

test('channel enforces partial-line UTF-8 decoding, correlated RPC, byte budgets and no process signaling', async () => {
  const transport = new SyntheticTransport();
  const channel = new CodexChannel(transport);
  const request = channel.request('initialize', {});
  await request;
  let notifications = 0;
  channel.onNotification(() => notifications++);
  const bytes = Buffer.from(JSON.stringify({ method: 'SYNTHETIC', params: 'ação' }) + '\n');
  for (const byte of bytes) transport.data(Uint8Array.of(byte));
  assert.equal(notifications, 1);
  transport.data(Buffer.alloc(codexChannelLimits.lineBytes + 1));
  assert.equal(channel.available, false);
  assert.deepEqual(transport.signals, []);
  await assert.rejects(channel.request('initialize', {}), /unavailable/);
});

test('task deadlines revoke adapter readiness and retain accepted outcome uncertainty', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture();
  try {
    const a = await f.launch(f.config('a').file, 'A');
    const b = await f.launch(f.config('b').file, 'B');
    const caller = f.client(a.pane, b.pane);
    const request = { ...f.request(a.pane, b.pane), deadline: Date.now() + 1000 };
    caller.send(request);
    await f.communication.dispatchNext(b.pane.paneId);
    t.mock.timers.tick(1001);
    assert.equal(caller.status(request.messageId).taskState, 'outcome_unknown');
    assert.equal(f.runtime.snapshot(b.prepared.instanceId).state, 'ownership_lost');
    f.transports[1]!.complete('LATE SYNTHETIC RESULT');
    assert.equal(caller.status(request.messageId).result, null);
    assert.deepEqual(f.transports[1]!.signals, []);
  } finally {
    f.close();
  }
});

test('a lost turn/start receipt is never accepted or automatically retried', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture();
  try {
    const a = await f.launch(f.config('a').file, 'A');
    const b = await f.launch(f.config('b').file, 'B');
    f.transports[1]!.replyToTurn = false;
    const caller = f.client(a.pane, b.pane);
    const request = f.request(a.pane, b.pane);
    caller.send(request);
    const dispatched = f.communication.dispatchNext(b.pane.paneId);
    t.mock.timers.tick(codexChannelLimits.requestMs);
    await dispatched;
    assert.equal(caller.status(request.messageId).deliveryState, 'delivery_unknown');
    assert.equal(caller.status(request.messageId).taskState, 'outcome_unknown');
    assert.equal(f.transports[1]!.requests.filter((r) => r.method === 'turn/start').length, 1);
    assert.equal(await f.communication.dispatchNext(b.pane.paneId), undefined);
  } finally {
    f.close();
  }
});

test('signal-only process exit preserves the journal limitation without inventing a numeric exit code', async () => {
  const f = fixture();
  try {
    const a = await f.launch(f.config('a').file, 'A');
    f.exits[0]!(null, 'SIGTERM');
    assert.equal(f.runtime.snapshot(a.prepared.instanceId).state, 'ownership_lost');
    assert.equal(f.communication.resolvePane(a.pane.workspaceId, a.pane.paneId).state, 'closed');
    assert.deepEqual(f.transports[0]!.signals, []);
  } finally {
    f.close();
  }
});

test('native provider failure is separate from a successful process and empty completion is unavailable', async () => {
  const f = fixture();
  try {
    const a = await f.launch(f.config('a').file, 'A');
    const b = await f.launch(f.config('b').file, 'B');
    const caller = f.client(a.pane, b.pane);
    const request = f.request(a.pane, b.pane);
    caller.send(request);
    await f.communication.dispatchNext(b.pane.paneId);
    f.transports[1]!.event('turn/completed', 'failed');
    assert.equal(caller.status(request.messageId).taskState, 'failed');
    assert.equal(f.runtime.snapshot(b.prepared.instanceId).state, 'running');
    assert.equal(f.communication.resolvePane(b.pane.workspaceId, b.pane.paneId).state, 'ready');
  } finally {
    f.close();
  }
});

test('shutdown preserves durable ownership uncertainty and does not adopt a prior slot on a new runtime', async () => {
  const f = fixture();
  let replacement: CodexStructuredRuntime | undefined;
  try {
    const slot = f.config('a');
    const a = await f.launch(slot.file, 'A');
    f.runtime.shutdown();
    assert.equal(f.runtime.snapshot(a.prepared.instanceId).state, 'ownership_lost');
    assert.deepEqual(f.transports[0]!.signals, []);
    const keys = generateKeyPairSync('ed25519');
    const authority = new TerminalAuthority(new Map([['synthetic', keys.publicKey]]), Date.now);
    let launched = false;
    replacement = new CodexStructuredRuntime(
      authority,
      f.communication,
      () => {
        throw new Error('unused');
      },
      {
        open: () => {
          launched = true;
          return new SyntheticTransport();
        },
      },
    );
    const prepared = replacement.prepare('synthetic', slot.file, {
      workspaceId: a.pane.workspaceId,
      ownerId: 'synthetic-owner',
      name: 'No adoption',
      model: null,
    });
    await assert.rejects(
      replacement.launch(prepared.instanceId, {
        challengeId: prepared.challenge.challengeId,
        signature: sign(null, terminalChallengeBytes(prepared.challenge), keys.privateKey).toString(
          'base64url',
        ),
      }),
      /unavailable|uncertain/,
    );
    assert.equal(launched, false);
  } finally {
    replacement?.shutdown();
    f.close();
  }
});

for (const failure of ['native-revocation', 'journal-fencing'] as const) {
  test(`${failure} prevents dispatch and preserves owned-process uncertainty`, async () => {
    const f = fixture();
    let fencedStore: Store | undefined;
    try {
      const a = await f.launch(f.config('a').file, 'A');
      const slot = f.config('b');
      const b = await f.launch(slot.file, 'B');
      const caller = f.client(a.pane, b.pane);
      const request = f.request(a.pane, b.pane);
      caller.send(request);
      if (failure === 'native-revocation') f.authority.revoke('synthetic-native');
      else {
        fencedStore = new Store(join(slot.config.state, 'terminal.sqlite'));
        fencedStore.terminalJournal(randomUUID(), { recover: true }); // Synthetic external epoch fencing only.
      }
      assert.equal(await f.communication.dispatchNext(b.pane.paneId), undefined);
      assert.equal(
        f.transports[1]!.requests.some((r) => r.method === 'turn/start'),
        false,
      );
      assert.equal(f.runtime.snapshot(b.prepared.instanceId).available, false);
      assert.equal(f.runtime.snapshot(b.prepared.instanceId).state, 'ownership_lost');
      assert.equal(caller.status(request.messageId).deliveryState, 'queued');
      assert.deepEqual(f.transports[1]!.signals, []);
    } finally {
      fencedStore?.close();
      f.close();
    }
  });
}

test('an existing PTY/Core owner blocks use of the same managed home through app-server', async () => {
  const f = fixture();
  const slot = f.config('occupied');
  const occupied = new Store(join(slot.config.state, 'terminal.sqlite'));
  const journal = occupied.terminalJournal(randomUUID(), { recover: false });
  try {
    const prepared = f.prepare(slot.file, 'Cannot share PTY home');
    await assert.rejects(
      f.runtime.launch(prepared.instanceId, f.proof(prepared.challenge)),
      /unavailable|uncertain/,
    );
    assert.equal(f.transports.length, 0);
    assert.throws(() => f.communication.resolvePane('synthetic-workspace', 'T-001'), /missing/);
  } finally {
    journal.release();
    occupied.close();
    f.close();
  }
});

test('private native transport uses isolated Node IPC and distinguishes host loss from provider exit', async () => {
  const f = fixture();
  let transport: CodexTransport | undefined;
  try {
    const slot = f.config('native-ipc');
    const host = join(f.root, 'SYNTHETIC-ipc-host.cjs');
    writeFileSync(
      host,
      `
      process.send({type:'started'});
      process.on('message', request => {
        if (request.action === 'send') {
          const rpc = JSON.parse(request.line);
          const response = {id:rpc.id,result:{home:process.env.HOME,codex:process.env.CODEX_HOME,syntheticOnly:true}};
          process.send({type:'data',base64:Buffer.from(JSON.stringify(response)+'\\n').toString('base64')});
        }
        if (request.action === 'signal') {
          process.send({type:'exit',code:0,signal:null}, () => process.disconnect());
        }
      });
      process.on('disconnect', () => process.exit(0));
    `,
      { mode: 0o600 },
    );
    let started: () => void;
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve;
    });
    let exit: () => void;
    const exitPromise = new Promise<void>((resolve) => {
      exit = resolve;
    });
    transport = nativeCodexBackend(host).open(slot.file, slot.config, {
      started: () => started(),
      exit: (code, signal) => {
        assert.equal(code, 0);
        assert.equal(signal, null);
        exit();
      },
    });
    const channel = new CodexChannel(transport);
    await startedPromise;
    assert.deepEqual(await channel.request('initialize', {}), {
      home: join(slot.config.state, 'home'),
      codex: join(slot.config.state, 'codex'),
      syntheticOnly: true,
    });
    transport.signal('SIGTERM');
    await exitPromise;
  } finally {
    transport?.detach();
    f.close();
  }
});

test('a native host exit without an owned-provider exit report does not invent provider exit', async () => {
  const f = fixture();
  let transport: CodexTransport | undefined;
  try {
    const slot = f.config('native-host-loss');
    const host = join(f.root, 'SYNTHETIC-lost-host.cjs');
    writeFileSync(host, "process.send({type:'started'}, () => process.exit(0));", { mode: 0o600 });
    let exits = 0;
    transport = nativeCodexBackend(host).open(slot.file, slot.config, {
      started: () => {},
      exit: () => exits++,
    });
    const channel = new CodexChannel(transport);
    const lost = new Promise<void>((resolve) => channel.onLost(resolve));
    await lost;
    assert.equal(exits, 0);
    assert.equal(channel.available, false);
  } finally {
    transport?.detach();
    f.close();
  }
});
