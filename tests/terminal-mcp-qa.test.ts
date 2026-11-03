// QA-only synthetic negatives for the S2 MCP delegation transport.
// Reuses the real broker/socket pieces with disposable temp endpoints.
// No provider, no credentials, no PTY and no real session data.
import assert from 'node:assert/strict';
import { randomUUID, generateKeyPairSync, sign } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { McpTaskBroker } from '../packages/core/src/terminal/mcp-task.js';
import {
  openMcpInstanceSockets,
  connectMcpInstance,
} from '../packages/core/src/terminal/mcp-socket.js';
import {
  TerminalAuthority,
  terminalChallengeBytes,
} from '../packages/core/src/terminal/authority.js';

function brokerHarness(deadlineMs = 120_000) {
  const keys = generateKeyPairSync('ed25519');
  const authority = new TerminalAuthority(new Map([['desktop-managed', keys.publicKey]]));
  const broker = new McpTaskBroker(
    authority,
    {
      sourceInstanceId: randomUUID(),
      targetInstanceId: randomUUID(),
      workspaceId: 'synthetic-workspace',
    },
    () => true,
    deadlineMs,
  );
  return {
    broker,
    keys,
    prepare: () => broker.prepare(),
    authorize: async () => {
      const challenge = broker.prepare().challenge;
      broker.authorize({
        challengeId: challenge.challengeId,
        signature: sign(null, terminalChallengeBytes(challenge), keys.privateKey).toString(
          'base64url',
        ),
      });
    },
  };
}

test('mcp grant rejects replay, role confusion and terminal-state reuse', async () => {
  const { broker, authorize } = brokerHarness();
  await authorize();
  const delegated = broker.call('source', {
    name: 'delegate_task',
    arguments: { task: 'SYNTHETIC task' },
  });
  await broker.call('worker', { name: 'wait_task', arguments: {} });
  const taskId = broker.snapshot().taskId;
  assert.ok(taskId);
  await broker.call('worker', {
    name: 'submit_result',
    arguments: { taskId, result: 'SYNTHETIC result' },
  });
  await delegated;
  assert.equal(broker.snapshot().state, 'completed');
  await assert.rejects(
    broker.call('worker', {
      name: 'submit_result',
      arguments: { taskId, result: 'SYNTHETIC again' },
    }),
    /terminal|denied/i,
  );
  await assert.rejects(
    broker.call('source', { name: 'delegate_task', arguments: { task: 'again' } }),
    /denied|terminal/i,
  );
  await assert.rejects(
    broker.call('worker', { name: 'delegate_task', arguments: { task: 'x' } }),
    /terminal|denied/i,
  );
  await assert.rejects(
    broker.call('source', { name: 'wait_task', arguments: {} }),
    /terminal|denied/i,
  );
});

test('grant expiry closes the delegation window without retry', async () => {
  const { broker, authorize } = brokerHarness(40);
  await authorize();
  await new Promise((done) => setTimeout(done, 70));
  await assert.rejects(
    broker.call('source', { name: 'delegate_task', arguments: { task: 'late' } }),
    /unavailable/i,
  );
  assert.equal(broker.snapshot().state, 'unknown');
});

test('endpoints reject duplicate clients, wrong secrets and tampered capabilities', async () => {
  const { broker, authorize } = brokerHarness();
  await authorize();
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'orqst-mcp-qa-')));
  const session = await openMcpInstanceSockets(broker);
  const directory = session.directory;
  try {
    const source = await connectMcpInstance(
      session.endpoints[0]!.socketPath,
      session.endpoints[0]!.capabilityFile,
    );
    assert.equal(source.role, 'source');
    await assert.rejects(
      connectMcpInstance(session.endpoints[0]!.socketPath, session.endpoints[0]!.capabilityFile),
      /unavailable/i,
    );
    const wrong = join(directory, 'wrong.cap');
    writeFileSync(wrong, 'y'.repeat(43), { mode: 0o600 });
    await assert.rejects(
      connectMcpInstance(session.endpoints[1]!.socketPath, wrong),
      /unavailable/i,
    );
    const other = join(root, 'other');
    mkdirSync(other, { mode: 0o700 });
    const foreign = join(other, 'foreign.cap');
    writeFileSync(foreign, 'z'.repeat(43), { mode: 0o600 });
    await assert.rejects(
      connectMcpInstance(session.endpoints[1]!.socketPath, foreign),
      /endpoint mismatch/i,
    );
    const tampered = join(directory, 'tampered.cap');
    writeFileSync(tampered, 'x'.repeat(43), { mode: 0o600 });
    chmodSync(tampered, 0o644);
    await assert.rejects(
      connectMcpInstance(session.endpoints[0]!.socketPath, tampered),
      /MCP (capability|endpoint|transport)/i,
    );
    source.close();
  } finally {
    rmSync(join(directory, 'wrong.cap'), { force: true });
    rmSync(join(directory, 'tampered.cap'), { force: true });
    await session.close();
    rmSync(root, { recursive: true, force: true });
  }
});
