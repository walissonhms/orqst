// SYNTHETIC native-protocol fixtures only. Never launch Codex or inspect user credentials/history.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
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
  toolReplies: Array<{
    id: string | number;
    result: { success: boolean; contentItems: Array<{ type: string; text: string }> };
  }> = [];
  signals: string[] = [];
  detached = false;
  threadId = randomUUID();
  turnId = randomUUID();
  reportedModel = 'synthetic-model';
  accountType: string | null = 'chatgpt';
  ephemeral = true;
  sandbox = 'readOnly';
  approvalPolicy = 'on-request';
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
    if (!request.method) {
      this.toolReplies.push(JSON.parse(line));
      return;
    }
    this.requests.push(request);
    queueMicrotask(() => {
      if (request.method === 'initialize')
        this.emit({ id: request.id, result: { userAgent: 'SYNTHETIC' } });
      if (request.method === 'account/read')
        this.emit({
          id: request.id,
          result: {
            account:
              this.accountType === null
                ? null
                : { type: this.accountType, email: 'SYNTHETIC-PRIVATE-IDENTITY' },
            requiresOpenaiAuth: true,
          },
        });
      if (request.method === 'thread/start')
        this.emit({
          id: request.id,
          result: {
            thread: { id: this.threadId, ephemeral: this.ephemeral },
            model: this.reportedModel,
            sandbox: { type: this.sandbox },
            approvalPolicy: this.approvalPolicy,
          },
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
  requestTool(targetPaneId: string, task: string, callId = randomUUID(), threadId = this.threadId) {
    this.emit({
      id: randomUUID(),
      method: 'item/tool/call',
      params: {
        threadId,
        turnId: this.turnId,
        callId,
        namespace: null,
        tool: 'orqst_delegate_task',
        arguments: { targetPaneId, task },
      },
    });
    return callId;
  }
  toolReceipt(callId: string) {
    this.emit({
      method: 'item/completed',
      params: {
        threadId: this.threadId,
        turnId: this.turnId,
        item: {
          id: callId,
          type: 'dynamicToolCall',
          tool: 'orqst_delegate_task',
          status: 'completed',
          success: true,
        },
      },
    });
  }
  signal(signal: 'SIGTERM' | 'SIGKILL') {
    this.signals.push(signal);
  }
  detach() {
    this.detached = true;
  }
}
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
function fixture(
  options: {
    tamperRootResult?: boolean;
    accountType?: string | null;
    ephemeral?: boolean;
    sandbox?: string;
    approvalPolicy?: string;
  } = {},
) {
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
  const read = (scope: Readonly<CommunicationContentScope>, id: string): Uint8Array => {
    const record = contents.get(id);
    assert.ok(record);
    assert.deepEqual(scope, record.scope);
    if (
      options.tamperRootResult &&
      scope.purpose === 'result' &&
      scope.sourcePaneId === scope.targetPaneId
    )
      return Buffer.from('SYNTHETIC ROOT RESULT DRIFT');
    return record.bytes;
  };
  const communication = new PaneCommunication(
    store.communicationJournal(randomUUID(), { recover: false }),
    read,
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
      if ('accountType' in options) transport.accountType = options.accountType ?? null;
      if (options.ephemeral !== undefined) transport.ephemeral = options.ephemeral;
      if (options.sandbox !== undefined) transport.sandbox = options.sandbox;
      if (options.approvalPolicy !== undefined) transport.approvalPolicy = options.approvalPolicy;
      transports.push(transport);
      exits.push(events.exit);
      queueMicrotask(events.started);
      return transport;
    },
  };
  const runtime = new CodexStructuredRuntime(authority, communication, write, backend, read);
  const executable = realpathSync('/usr/bin/true'); // Tiny native fixture: never executed as a provider.
  const binary = { path: executable, sha256: terminalExecutableSha256(executable) };
  const config = (name: string, nativeNode = false, reuseExisting = false) => {
    const state = join(root, name);
    mkdirSync(state, { mode: 0o700 });
    for (const directory of ['home', 'codex', 'tmp'])
      mkdirSync(join(state, directory), { mode: 0o700 });
    const config: ManagedCodexConfig = {
      version: 1,
      trust: 'native-same-user',
      executable: binary,
      executableVersion: 'SYNTHETIC-NOT-CODEX',
      node: nativeNode
        ? {
            path: realpathSync(process.execPath),
            sha256: terminalExecutableSha256(realpathSync(process.execPath)),
          }
        : binary,
      project,
      state,
      ...(reuseExisting
        ? {
            authentication: {
              mode: 'reuse-existing' as const,
              home: root,
              codexHome: join(root, 'synthetic-native-home'),
              sharedNativeConfiguration: true as const,
            },
          }
        : {}),
    };
    if (reuseExisting && !existsSync(config.authentication!.codexHome)) {
      mkdirSync(config.authentication!.codexHome, { mode: 0o700 });
      writeFileSync(
        join(config.authentication!.codexHome, 'auth.json'),
        'SYNTHETIC-SECRET-NEVER-READ',
        { mode: 0o000 },
      );
    }
    writeFileSync(join(state, 'codex/config.toml'), managedCodexSettings(config), { mode: 0o600 });
    const file = join(state, 'terminal.json');
    writeFileSync(file, JSON.stringify(config), { mode: 0o600 });
    return { file, config };
  };
  const proof = (challenge: TerminalChallenge) => ({
    challengeId: challenge.challengeId,
    signature: sign(null, terminalChallengeBytes(challenge), keys.privateKey).toString('base64url'),
  });
  const prepare = (
    file: string,
    name: string,
    model: string | null = 'synthetic-model',
    dynamicTools = false,
  ) =>
    runtime.prepare('synthetic-native', file, {
      workspaceId: 'synthetic-workspace',
      name,
      ownerId: 'synthetic-owner',
      model,
      dynamicTools,
    });
  const launch = async (file: string, name: string, dynamicTools = false) => {
    const prepared = prepare(file, name, 'synthetic-model', dynamicTools);
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
    read,
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
    assert.equal(caller.status(second.messageId).taskState, 'running');
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
    const slot = f.config('native-ipc', true);
    const host = join(f.root, 'SYNTHETIC-ipc-host.cjs');
    writeFileSync(
      host,
      `
      process.send({type:'started',processId:process.pid});
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
      started: (processId) => {
        assert.ok(Number.isSafeInteger(processId) && processId! > 0);
        assert.notEqual(processId, process.pid);
        started();
      },
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
    const slot = f.config('native-host-loss', true);
    const host = join(f.root, 'SYNTHETIC-lost-host.cjs');
    writeFileSync(
      host,
      "process.send({type:'started',processId:process.pid}, () => process.exit(0));",
      { mode: 0o600 },
    );
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

for (const failure of ['registry-full', 'manifest-drift-after-registry'] as const) {
  test(`pre-dispatch ${failure} does not reserve capacity for a process that was never opened`, async () => {
    const f = fixture();
    try {
      const slot = f.config('predispatch');
      const original = f.communication.registerPane.bind(f.communication);
      f.communication.registerPane = (input) => {
        if (failure === 'registry-full') throw new Error('SYNTHETIC registry capacity');
        const pane = original(input);
        writeFileSync(
          slot.file,
          JSON.stringify({ ...slot.config, executableVersion: 'SYNTHETIC DRIFT' }),
        );
        return pane;
      };
      const prepared = f.prepare(slot.file, 'Never dispatched');
      await assert.rejects(
        f.runtime.launch(prepared.instanceId, f.proof(prepared.challenge)),
        /unavailable|uncertain/,
      );
      assert.equal(f.runtime.snapshot(prepared.instanceId).state, 'start_failed');
      assert.equal(f.transports.length, 0);
      if (failure === 'manifest-drift-after-registry') {
        assert.equal(f.communication.resolvePane('synthetic-workspace', 'T-001').state, 'closed');
        writeFileSync(slot.file, JSON.stringify(slot.config));
      }
      f.communication.registerPane = original;
      const next = await f.launch(slot.file, 'Authorized fresh start');
      assert.equal(next.pane.state, 'ready');
      assert.equal(f.transports.length, 1);
    } finally {
      f.close();
    }
  });
}

test('legacy explicit journal recovery fences structured control but does not permit a second process in its home', async () => {
  const f = fixture();
  let legacy: Store | undefined;
  try {
    const slot = f.config('fenced');
    const a = await f.launch(slot.file, 'Still potentially alive');
    legacy = new Store(join(slot.config.state, 'terminal.sqlite'));
    const recovered = legacy.terminalJournal(randomUUID(), { recover: true });
    const next = randomUUID();
    recovered.prepare({
      instanceId: next,
      projectId: a.pane.binding!.projectId,
      clientId: 'SYNTHETIC-legacy',
      manifestDigest: terminalDigest('synthetic'),
    });
    assert.throws(() => recovered.transition(next, 'starting'), /admission/);
    assert.equal(f.runtime.snapshot(a.prepared.instanceId).state, 'ownership_lost');
    assert.equal(f.transports.length, 1);
    assert.deepEqual(f.transports[0]!.signals, []);
  } finally {
    legacy?.close();
    f.close();
  }
});

async function dynamicRoot(f: ReturnType<typeof fixture>) {
  const a = await f.launch(f.config('dynamic-a').file, 'Initiator', true);
  const b = await f.launch(f.config('dynamic-b').file, 'Worker');
  const task = 'SYNTHETIC: Reply with WORKER_MARKER only. Do not read files or call tools.';
  const prepared = f.runtime.prepareRootTask('synthetic-native', a.prepared.instanceId, {
    targetPaneId: b.pane.paneId,
    delegatedTask: task,
    text: 'SYNTHETIC root delegates the exact granted task.',
    deadline: Date.now() + 60000,
  });
  const running = f.runtime.runRootTask(prepared.plan.taskId, f.proof(prepared.challenge));
  void running.catch(() => {});
  await tick();
  return { a, b, task, prepared, running, source: f.transports[0]!, worker: f.transports[1]! };
}

test('a native A dynamic call delegates exactly once through ORQST and returns the worker result into A', async () => {
  const f = fixture();
  try {
    const r = await dynamicRoot(f);
    assert.equal(f.runtime.snapshot(r.a.prepared.instanceId).dynamicTools, 'requested');
    const declaration = r.source.requests.find((m) => m.method === 'thread/start')!.params
      .dynamicTools;
    assert.ok(Array.isArray(declaration));
    const callId = r.source.requestTool(r.b.pane.paneId, r.task);
    await tick();
    assert.equal(r.source.toolReplies.length, 0); // Acceptance/start do not return a completed tool result.
    assert.equal(r.worker.requests.filter((m) => m.method === 'turn/start').length, 1);
    r.worker.complete('WORKER_MARKER');
    await tick();
    assert.equal(r.source.toolReplies.length, 1);
    const response = r.source.toolReplies[0]!.result;
    assert.equal(response.success, true);
    const returned = JSON.parse(response.contentItems[0]!.text) as {
      taskState: string;
      untrustedWorkerResult: string;
    };
    assert.equal(returned.taskState, 'completed');
    assert.equal(returned.untrustedWorkerResult, 'WORKER_MARKER');
    r.source.toolReceipt(callId);
    r.source.complete('SYNTHETIC A received WORKER_MARKER');
    const result = await r.running;
    assert.equal(result.correlationId, r.prepared.plan.correlationId);
    assert.equal(f.runtime.snapshot(r.a.prepared.instanceId).dynamicTools, 'observed');
    assert.equal(f.runtime.snapshot(r.a.prepared.instanceId).delegationReturned, true);
    const bytes = f.read(
      {
        workspaceId: r.a.pane.workspaceId,
        actorId: r.a.pane.ownerId,
        sourcePaneId: r.a.pane.paneId,
        targetPaneId: r.a.pane.paneId,
        purpose: 'result',
      },
      result.result.id,
    );
    assert.match(Buffer.from(bytes).toString(), /WORKER_MARKER/);
    await assert.rejects(
      f.runtime.runRootTask(result.taskId, f.proof(r.prepared.challenge)),
      /unavailable/,
    );
  } finally {
    f.close();
  }
});

for (const failure of [
  'wrong-target',
  'changed-task',
  'wrong-native-thread',
  'no-native-call',
  'missing-tool-receipt',
  'duplicate-native-call',
] as const) {
  test(`dynamic ${failure} cannot grant authority, duplicate dispatch or claim A-to-B-to-A success`, async () => {
    const f = fixture();
    try {
      const r = await dynamicRoot(f);
      if (failure === 'no-native-call')
        r.source.complete('No actual dynamic API support demonstrated');
      else {
        const callId = r.source.requestTool(
          failure === 'wrong-target' ? randomUUID() : r.b.pane.paneId,
          failure === 'changed-task' ? 'UNAUTHORIZED SYNTHETIC TASK' : r.task,
          randomUUID(),
          failure === 'wrong-native-thread' ? randomUUID() : r.source.threadId,
        );
        await tick();
        if (failure === 'duplicate-native-call')
          r.source.requestTool(r.b.pane.paneId, r.task, callId);
        else if (failure === 'missing-tool-receipt') {
          r.worker.complete();
          await tick();
          r.source.complete();
        } else if (failure !== 'wrong-native-thread') r.source.complete();
      }
      await assert.rejects(r.running, /unavailable|not confirmed/);
      const requests = r.worker.requests.filter((m) => m.method === 'turn/start');
      assert.ok(requests.length <= 1);
      if (
        ['wrong-target', 'changed-task', 'wrong-native-thread', 'no-native-call'].includes(failure)
      )
        assert.equal(requests.length, 0);
    } finally {
      f.close();
    }
  });
}

test('root delegation requires separate signed native consent and a dynamic-enabled source', async () => {
  const f = fixture();
  try {
    const a = await f.launch(f.config('root-a').file, 'A');
    const b = await f.launch(f.config('root-b').file, 'B');
    assert.throws(
      () =>
        f.runtime.prepareRootTask('synthetic-native', a.prepared.instanceId, {
          targetPaneId: b.pane.paneId,
          delegatedTask: 'SYNTHETIC',
          text: 'SYNTHETIC',
          deadline: Date.now() + 60000,
        }),
      /unavailable|policy/,
    );
  } finally {
    f.close();
  }
});

test('editing the returned root plan cannot expand its signed target or task', async () => {
  const f = fixture();
  try {
    const a = await f.launch(f.config('mutation-a').file, 'A', true);
    const b = await f.launch(f.config('mutation-b').file, 'B');
    const prepared = f.runtime.prepareRootTask('synthetic-native', a.prepared.instanceId, {
      targetPaneId: b.pane.paneId,
      delegatedTask: 'SYNTHETIC ORIGINAL',
      text: 'SYNTHETIC root',
      deadline: Date.now() + 60000,
    });
    prepared.plan.input.delegatedTask = 'SYNTHETIC UNAUTHORIZED MUTATION';
    const running = f.runtime.runRootTask(prepared.plan.taskId, f.proof(prepared.challenge));
    void running.catch(() => {});
    await tick();
    f.transports[0]!.requestTool(b.pane.paneId, prepared.plan.input.delegatedTask);
    await tick();
    assert.equal(f.transports[0]!.toolReplies[0]!.result.success, false);
    assert.equal(
      f.transports[1]!.requests.some((m) => m.method === 'turn/start'),
      false,
    );
    f.transports[0]!.complete();
    await assert.rejects(running, /not confirmed/);
  } finally {
    f.close();
  }
});

test('a signed process start does not authorize a root inference or a root proof replay', async () => {
  const f = fixture();
  try {
    const a = await f.launch(f.config('grant-a').file, 'A', true);
    const b = await f.launch(f.config('grant-b').file, 'B');
    const prepared = f.runtime.prepareRootTask('synthetic-native', a.prepared.instanceId, {
      targetPaneId: b.pane.paneId,
      delegatedTask: 'SYNTHETIC',
      text: 'SYNTHETIC root',
      deadline: Date.now() + 60000,
    });
    await assert.rejects(
      f.runtime.runRootTask(prepared.plan.taskId, f.proof(a.prepared.challenge)),
      /authorization/,
    );
    assert.equal(
      f.transports[0]!.requests.some((m) => m.method === 'turn/start'),
      false,
    );
  } finally {
    f.close();
  }
});

test('the real acceptance command refuses missing authorization before reading a path or launching a provider', () => {
  const flags = [
    '--authorize-real-codex',
    '--acknowledge-advisory-cost-only',
    '--cleanup-owned-processes',
  ];
  for (const missing of flags) {
    const result = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        resolve('scripts/accept-codex-two-agent.ts'),
        ...flags.filter((flag) => flag !== missing),
        '--authentication',
        'separate-login',
        '--acceptance-root',
        '/SYNTHETIC-PATH-MUST-NOT-BE-READ',
        '--model',
        'SYNTHETIC',
      ],
      {
        cwd: resolve('.'),
        encoding: 'utf8',
        timeout: 20000,
      },
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Requires explicit --authorize-real-codex/);
    assert.doesNotMatch(result.stdout, /native-thread-ready|native-delegation-confirmed/);
  }
});

test('JSON expansion of a bounded worker result returns a tool failure without losing the owned instance', async () => {
  const f = fixture();
  try {
    const r = await dynamicRoot(f);
    const callId = r.source.requestTool(r.b.pane.paneId, r.task);
    await tick();
    r.worker.complete('\u0001'.repeat(8192));
    await tick();
    const reply = r.source.toolReplies[0]!.result;
    assert.equal(reply.success, false);
    assert.ok(Buffer.byteLength(reply.contentItems[0]!.text) < 16384);
    r.source.emit({
      method: 'item/completed',
      params: {
        threadId: r.source.threadId,
        turnId: r.source.turnId,
        item: {
          id: callId,
          type: 'dynamicToolCall',
          tool: 'orqst_delegate_task',
          status: 'completed',
          success: false,
        },
      },
    });
    r.source.complete('SYNTHETIC bounded tool failure');
    await assert.rejects(r.running, /not confirmed/);
    assert.equal(f.runtime.snapshot(r.a.prepared.instanceId).state, 'running');
    assert.equal(f.runtime.snapshot(r.a.prepared.instanceId).available, true);
  } finally {
    f.close();
  }
});

test('a changed local root result cannot pass a native delegation completion', async () => {
  const f = fixture({ tamperRootResult: true });
  try {
    const r = await dynamicRoot(f);
    const callId = r.source.requestTool(r.b.pane.paneId, r.task);
    await tick();
    r.worker.complete('SYNTHETIC VALID WORKER');
    await tick();
    r.source.toolReceipt(callId);
    r.source.complete('SYNTHETIC VALID ROOT');
    await assert.rejects(r.running, /Root result reference unavailable/);
  } finally {
    f.close();
  }
});

test('existing native authentication is checked before two distinct ephemeral threads without credentials access', async () => {
  const f = fixture();
  try {
    const a = await f.launch(f.config('reuse-a', false, true).file, 'Initiator');
    const b = await f.launch(f.config('reuse-b', false, true).file, 'Worker');
    assert.notEqual(a.pane.paneId, b.pane.paneId);
    assert.notEqual(
      f.runtime.snapshot(a.prepared.instanceId).nativeThreadId,
      f.runtime.snapshot(b.prepared.instanceId).nativeThreadId,
    );
    for (const transport of f.transports) {
      const requests = transport.requests.filter((request) => request.method !== 'initialized');
      assert.deepEqual(
        requests.map((request) => request.method),
        ['initialize', 'account/read', 'thread/start'],
      );
      assert.deepEqual(requests[1]!.params, { refreshToken: false });
      assert.equal(requests[2]!.params.ephemeral, true);
      assert.equal(requests[2]!.params.allowProviderModelFallback, false);
    }
    const snapshot = f.runtime.snapshot(a.prepared.instanceId);
    assert.equal(snapshot.authentication, 'existing-native-login');
    assert.ok(!JSON.stringify(snapshot).includes('SYNTHETIC-PRIVATE-IDENTITY'));
  } finally {
    f.close();
  }
});

for (const accountType of [null, 'chatgptAuthTokens', 'unexpected']) {
  test(`native reuse rejects unavailable or unsupported auth ${accountType} before thread creation`, async () => {
    const f = fixture({ accountType });
    try {
      await assert.rejects(f.launch(f.config('reuse', false, true).file, 'Initiator'));
      assert.ok(!f.transports[0]!.requests.some((request) => request.method === 'thread/start'));
      assert.ok(!f.transports[0]!.requests.some((request) => request.method === 'turn/start'));
    } finally {
      f.close();
    }
  });
}

test('native reuse requires explicit ephemeral confirmation before any task can start', async () => {
  const f = fixture({ ephemeral: false });
  try {
    await assert.rejects(f.launch(f.config('reuse', false, true).file, 'Initiator'));
    assert.ok(!f.transports[0]!.requests.some((request) => request.method === 'turn/start'));
  } finally {
    f.close();
  }
});

for (const policy of [{ sandbox: 'dangerFullAccess' }, { approvalPolicy: 'never' }]) {
  test('native reuse rejects unconfirmed permission policy before a task', async () => {
    const f = fixture(policy);
    try {
      await assert.rejects(f.launch(f.config('reuse', false, true).file, 'Initiator'));
      assert.ok(!f.transports[0]!.requests.some((request) => request.method === 'turn/start'));
    } finally {
      f.close();
    }
  });
}

for (const type of ['commandExecution', 'fileChange', 'mcpToolCall', 'unknownFutureTool']) {
  test(`acceptance can detect ${type} even when the task returns a valid result`, async () => {
    const f = fixture();
    try {
      const a = await f.launch(f.config('slot-a').file, 'Initiator');
      const b = await f.launch(f.config('slot-b').file, 'Worker');
      const caller = f.client(a.pane, b.pane);
      const request = f.request(a.pane, b.pane);
      caller.send(request);
      await f.communication.dispatchNext(b.pane.paneId);
      const transport = f.transports[1]!;
      assert.equal(f.runtime.snapshot(b.prepared.instanceId).unexpectedToolUse, false);
      transport.emit({
        method: 'item/started',
        params: {
          threadId: transport.threadId,
          turnId: transport.turnId,
          item: { id: randomUUID(), type },
        },
      });
      transport.complete();
      assert.equal(caller.status(request.messageId).taskState, 'completed');
      assert.equal(f.runtime.snapshot(b.prepared.instanceId).unexpectedToolUse, true);
    } finally {
      f.close();
    }
  });
}
