// Pure contracts only. No Core host, session, socket, PTY, provider or native app.
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import test from 'node:test';
import {
  terminalMcpPairMembers,
  terminalMcpPairRequestSchema,
  tauriStudioRequestSchema,
} from '@orqst/protocol';
import { createTauriStudioClient } from '../apps/tauri/src/studio-bridge.js';
import { McpTaskBroker } from '../packages/core/src/terminal/mcp-task.js';
import {
  TerminalAuthority,
  terminalChallengeBytes,
} from '../packages/core/src/terminal/authority.js';

const request = {
  action: 'create-mcp-pair' as const,
  generation: 1,
  workspaceId: 'synthetic-workspace',
  featureId: null,
  catalogId: 'a'.repeat(64),
  sourceProvider: 'codex' as const,
  codexModelId: 'b'.repeat(64),
  openCodeModelId: 'c'.repeat(64),
};

test('pair preparation is exact, bilateral, generation-bound and distinct from native task authority', async () => {
  const sent: unknown[] = [];
  let active = false;
  const client = createTauriStudioClient(
    async (value) => {
      sent.push(value);
      return { status: 'denied' };
    },
    () => active,
  );
  assert.equal((await client.request(request)).status, 'focus_required');
  assert.deepEqual(sent, []);
  active = true;
  assert.equal((await client.request(request)).status, 'denied');
  assert.deepEqual(sent, [request]);
  for (const sourceProvider of ['codex', 'opencode']) {
    assert.equal(tauriStudioRequestSchema.safeParse({ ...request, sourceProvider }).success, true);
    const helper = { ...request, sourceProvider };
    Reflect.deleteProperty(helper, 'generation');
    assert.equal(terminalMcpPairRequestSchema.safeParse(helper).success, true);
  }
  for (const invalid of [
    { ...request, sourceProvider: 'claude' },
    { ...request, codexModelId: undefined },
    { ...request, openCodeModelId: undefined },
    { ...request, generation: undefined },
    { ...request, count: 3 },
    { ...request, mcp: true },
    { ...request, path: '/SYNTHETIC' },
    { ...request, task: 'SYNTHETIC' },
    { ...request, proof: 'SYNTHETIC' },
    { ...request, sourceInstanceId: randomUUID() },
  ]) {
    assert.equal(tauriStudioRequestSchema.safeParse(invalid).success, false);
    assert.equal((await client.request(invalid as never)).status, 'denied');
  }
  assert.equal(sent.length, 1);
});

function brokerFixture() {
  let now = 1000;
  let owned = true;
  const keys = generateKeyPairSync('ed25519');
  const authority = new TerminalAuthority(
    new Map([['desktop-managed', keys.publicKey]]),
    () => now,
  );
  const identity = {
    sourceInstanceId: randomUUID(),
    targetInstanceId: randomUUID(),
    workspaceId: 'synthetic-workspace',
  };
  const broker = new McpTaskBroker(authority, identity, () => owned);
  const authorize = () => {
    const prepared = broker.prepare();
    assert.deepEqual(
      {
        sourceInstanceId: prepared.grant.sourceInstanceId,
        targetInstanceId: prepared.grant.targetInstanceId,
        workspaceId: prepared.grant.workspaceId,
      },
      identity,
    );
    broker.authorize({
      challengeId: prepared.challenge.challengeId,
      signature: sign(null, terminalChallengeBytes(prepared.challenge), keys.privateKey).toString(
        'base64url',
      ),
    });
  };
  return {
    broker,
    authorize,
    expire: () => {
      now += 120_000;
    },
    lose: () => {
      owned = false;
    },
  };
}

test('existing broker keeps a separate signed one-use task and correlated return without PTY input or stdout evidence', async () => {
  const f = brokerFixture();
  try {
    await assert.rejects(
      f.broker.call('source', { name: 'delegate_task', arguments: { task: 'SYNTHETIC' } }),
    );
    f.authorize();
    assert.equal(f.broker.snapshot().state, 'ready');
    await assert.rejects(f.broker.call('source', { name: 'wait_task', arguments: {} }));
    await assert.rejects(
      f.broker.call('worker', { name: 'delegate_task', arguments: { task: 'SYNTHETIC' } }),
    );
    const result = f.broker.call('source', {
      name: 'delegate_task',
      arguments: { task: 'SYNTHETIC bounded task' },
    });
    assert.equal(f.broker.snapshot().state, 'queued');
    const received = (await f.broker.call('worker', { name: 'wait_task', arguments: {} })) as {
      state: string;
      taskId: string;
      task: string;
    };
    assert.equal(received.state, 'delivered');
    assert.equal(received.task, 'SYNTHETIC bounded task');
    assert.equal(f.broker.snapshot().state, 'delivered');
    await assert.rejects(
      f.broker.call('worker', {
        name: 'submit_result',
        arguments: { taskId: randomUUID(), result: 'wrong correlation' },
      }),
    );
    await f.broker.call('worker', {
      name: 'submit_result',
      arguments: { taskId: received.taskId, result: 'SYNTHETIC worker-reported result' },
    });
    assert.deepEqual(await result, {
      state: 'completed',
      taskId: received.taskId,
      result: 'SYNTHETIC worker-reported result',
    });
    await assert.rejects(
      f.broker.call('source', { name: 'delegate_task', arguments: { task: 'duplicate' } }),
    );
    assert.throws(f.authorize);
  } finally {
    f.broker.close();
  }
});

for (const fault of ['expiry', 'ownership', 'disconnect'] as const) {
  test(`existing broker preserves unknown after ${fault}, without resend or provider completion inference`, async () => {
    const f = brokerFixture();
    try {
      f.authorize();
      const result = f.broker.call('source', {
        name: 'delegate_task',
        arguments: { task: 'SYNTHETIC unreceived' },
      });
      const taskId = f.broker.snapshot().taskId;
      if (fault === 'expiry') f.expire();
      else if (fault === 'ownership') f.lose();
      else f.broker.close();
      await assert.rejects(f.broker.call('worker', { name: 'wait_task', arguments: {} }));
      assert.deepEqual(await result, { state: 'unknown', taskId });
      assert.equal(f.broker.snapshot().state, 'unknown');
      assert.throws(f.authorize);
    } finally {
      f.broker.close();
    }
  });
}

test('MCP pair contract: Claude joins only with an explicit worker and its own model id', () => {
  const base = {
    action: 'create-mcp-pair' as const,
    workspaceId: 'a'.repeat(64),
    featureId: null,
    catalogId: 'b'.repeat(64),
  };
  const claude = {
    ...base,
    sourceProvider: 'claude' as const,
    workerProvider: 'codex' as const,
    claudeModelId: 'c'.repeat(64),
    codexModelId: 'd'.repeat(64),
  };
  assert.ok(terminalMcpPairRequestSchema.safeParse(claude).success);
  assert.deepEqual(terminalMcpPairMembers(claude), ['claude', 'codex']);
  // The original Codex/OpenCode shape stays valid in both directions.
  const legacy = {
    ...base,
    sourceProvider: 'opencode' as const,
    codexModelId: 'd'.repeat(64),
    openCodeModelId: 'e'.repeat(64),
  };
  assert.ok(terminalMcpPairRequestSchema.safeParse(legacy).success);
  assert.deepEqual(terminalMcpPairMembers(legacy), ['opencode', 'codex']);
  for (const invalid of [
    { ...claude, workerProvider: undefined },
    { ...claude, workerProvider: 'claude' },
    { ...claude, openCodeModelId: 'e'.repeat(64) },
    { ...claude, claudeModelId: undefined },
    { ...legacy, claudeModelId: 'c'.repeat(64) },
  ])
    assert.equal(terminalMcpPairRequestSchema.safeParse(invalid).success, false);
});
