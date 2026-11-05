// Synthetic owned handles and disposable journals/sockets only. Never invokes a provider.
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Store } from '@orqst/database';
import {
  TerminalAuthority,
  terminalChallengeBytes,
  terminalDigest,
  type TerminalChallenge,
} from '../packages/core/src/terminal/authority.js';
import { desktopAgentsAdmission } from '../packages/core/src/managed-codex/desktop-admission.js';
import { InteractiveMcpSession } from '../packages/core/src/terminal/interactive-mcp.js';
import { ManagedTerminalPair } from '../packages/core/src/terminal/managed-pair.js';
import { connectMcpInstance } from '../packages/core/src/terminal/mcp-socket.js';
import type { TerminalEvents } from '../packages/core/src/terminal/supervisor.js';

async function fixture(
  profileIds = ['codex-terminal-v1', 'codex-terminal-v1'],
  now?: () => number,
) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'orqst-synthetic-mcp-pair-')));
  const keys = generateKeyPairSync('ed25519');
  const authority = new TerminalAuthority(new Map([['desktop-managed', keys.publicKey]]), now);
  const stores: Store[] = [];
  const events: TerminalEvents[] = [];
  const writes: string[] = [];
  const admission = desktopAgentsAdmission(join(root, 'admission'));
  const session = new InteractiveMcpSession(authority, 'synthetic-workspace', (slot, id) => {
    try {
      admission.assertOwner();
      return (call(slot, 'snapshot', [id]) as { state: string }).state === 'running';
    } catch {
      return false;
    }
  });
  const endpoints = await session.open();
  const pair: ManagedTerminalPair = new ManagedTerminalPair(
    authority,
    [0, 1].map((slot) => {
      const state = join(root, String(slot));
      mkdirSync(state, { mode: 0o700 });
      const store = new Store(join(state, 'terminal.sqlite'));
      stores.push(store);
      return {
        profiles: [
          {
            id: profileIds[slot]!,
            projectId: 'synthetic-workspace',
            executable: '/synthetic/never-executed',
            executableSha256: terminalDigest('synthetic'),
            executableVersion: 'synthetic',
            argv: [],
            cwd: root,
            environmentProfile: 'synthetic',
            permissions: 'Synthetic fixture only',
          },
        ],
        journal: store.terminalJournal(authority.epoch, { recover: false }),
        backend: session.wrap(slot, {
          validate: () => true,
          start: (_profile, handlers) => {
            events[slot] = handlers;
            handlers.started();
            return {
              write: (text) => {
                writes.push(text);
              },
              resize() {},
              signal() {},
              dispose() {},
            };
          },
        }),
      };
    }),
    admission,
  );
  function call(slot: number, operation: string, args: unknown[]): unknown {
    return pair.dispatch(slot, { id: randomUUID(), operation, args });
  }
  const proof = (challenge: TerminalChallenge) => ({
    challengeId: challenge.challengeId,
    signature: sign(null, terminalChallengeBytes(challenge), keys.privateKey).toString('base64url'),
  });
  const launch = (slot: number) => {
    const prepared = call(slot, 'prepare', ['desktop-managed', profileIds[slot]!]) as {
      attemptId: string;
      challenge: TerminalChallenge;
    };
    call(slot, 'launch', [prepared.attemptId, proof(prepared.challenge)]);
    return prepared.attemptId;
  };
  const clients = await Promise.all(
    endpoints.map((endpoint) => connectMcpInstance(endpoint.socketPath, endpoint.capabilityFile)),
  );
  return {
    session,
    authority,
    call,
    proof,
    launch,
    clients,
    events,
    writes,
    async close() {
      for (const client of clients) client.close();
      await session.close();
      pair.close();
      for (const store of stores) store.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

test('abandoned preparation expires without blocking a fresh grant or accepting its old proof', async () => {
  let clock = 1_000_000;
  const f = await fixture(undefined, () => clock);
  try {
    f.launch(0);
    f.launch(1);
    const old = f.session.prepare();
    const oldProof = f.proof(old.challenge);
    clock += 120_001;
    const fresh = f.session.prepare();
    assert.notEqual(fresh.grant.grantId, old.grant.grantId);
    assert.notEqual(fresh.challenge.digest, old.challenge.digest);
    assert.throws(() => f.session.authorize(oldProof));
    f.session.authorize(f.proof(fresh.challenge));
    assert.equal(f.session.snapshot().state, 'ready');
    assert.deepEqual(f.writes, []);
  } finally {
    await f.close();
  }
});

test('a fourth call on the same grant closes the socket; an unconfirmed preparation cannot reset it', async () => {
  const f = await fixture();
  try {
    f.launch(0);
    f.launch(1);
    const prepared = f.session.prepare();
    f.session.authorize(f.proof(prepared.challenge));
    const waiting = f.clients[1]!.call(randomUUID(), { name: 'wait_task', arguments: {} });
    const outcome = f.clients[0]!.call(randomUUID(), {
      name: 'delegate_task',
      arguments: { task: 'SYNTHETIC budget' },
    });
    const task = (await waiting) as { taskId: string };
    const bad = { name: 'submit_result', arguments: { taskId: task.taskId, result: 'result' } };
    await f.clients[1]!.call(randomUUID(), bad);
    await outcome;
    await assert.rejects(f.clients[1]!.call(randomUUID(), bad));
    f.session.prepare(); // A cancelled native review has not installed a new grant.
    await assert.rejects(f.clients[1]!.call(randomUUID(), bad), /transport/);
    assert.throws(() => f.session.prepare());
  } finally {
    await f.close();
  }
});

test('at most 16 separately authorized grants are available on one pair', async () => {
  const f = await fixture();
  try {
    f.launch(0);
    f.launch(1);
    for (let count = 0; count < 16; count++) {
      const prepared = f.session.prepare();
      f.session.authorize(f.proof(prepared.challenge));
      const waiting = f.clients[1]!.call(randomUUID(), { name: 'wait_task', arguments: {} });
      const outcome = f.clients[0]!.call(randomUUID(), {
        name: 'delegate_task',
        arguments: { task: 'SYNTHETIC bounded grant' },
      });
      const task = (await waiting) as { taskId: string };
      await f.clients[1]!.call(randomUUID(), {
        name: 'submit_result',
        arguments: { taskId: task.taskId, result: 'SYNTHETIC result' },
      });
      assert.equal(((await outcome) as { state: string }).state, 'completed');
    }
    assert.throws(() => f.session.prepare(), /grant limit/);
    assert.equal(f.session.snapshot().state, 'completed');
    assert.deepEqual(f.writes, []);
  } finally {
    await f.close();
  }
});

test('an in-flight old call prevents a new grant and stays on its original broker', async () => {
  const f = await fixture();
  try {
    f.launch(0);
    f.launch(1);
    const first = f.session.prepare();
    f.session.authorize(f.proof(first.challenge));
    const waiting = f.clients[1]!.call(randomUUID(), { name: 'wait_task', arguments: {} });
    // A source call proves the worker request has reached the old broker before preparation.
    const outcome = f.clients[0]!.call(randomUUID(), {
      name: 'delegate_task',
      arguments: { task: 'SYNTHETIC old grant' },
    });
    const old = (await waiting) as { taskId: string };
    assert.throws(() => f.session.prepare());
    await f.clients[1]!.call(randomUUID(), {
      name: 'submit_result',
      arguments: { taskId: old.taskId, result: 'old result' },
    });
    await outcome;
    // A pending review does not install its candidate: this still reaches the old broker.
    const fresh = f.session.prepare();
    await assert.rejects(
      f.clients[0]!.call(randomUUID(), {
        name: 'delegate_task',
        arguments: { task: 'late old request' },
      }),
    );
    f.session.authorize(f.proof(fresh.challenge));
    await assert.rejects(
      f.clients[1]!.call(randomUUID(), {
        name: 'submit_result',
        arguments: { taskId: old.taskId, result: 'stale result' },
      }),
    );
    assert.equal(f.session.snapshot().state, 'ready');
    assert.deepEqual(f.writes, []);
  } finally {
    await f.close();
  }
});

test('Desktop MCP composition binds actual owned starts and signed grant, with synthetic A -> B -> A and no PTY writes', async () => {
  const f = await fixture();
  try {
    const [a, b] = f.clients;
    await assert.rejects(
      a!.call(randomUUID(), { name: 'delegate_task', arguments: { task: 'before grant' } }),
    );
    assert.throws(() => f.session.prepare(), /owned/);
    const sourceInstanceId = f.launch(0);
    assert.throws(() => f.session.prepare(), /owned/);
    const targetInstanceId = f.launch(1);
    assert.throws(() => f.call(0, 'snapshot', [targetInstanceId]), /Unknown terminal/);
    const prepared = f.session.prepare();
    assert.equal(prepared.grant.sourceInstanceId, sourceInstanceId);
    assert.equal(prepared.grant.targetInstanceId, targetInstanceId);
    assert.equal(prepared.grant.epoch, f.authority.epoch);
    assert.equal(prepared.grant.workspaceId, 'synthetic-workspace');
    assert.throws(() => f.session.authorize({}), /proof/);
    f.session.authorize(f.proof(prepared.challenge));
    assert.throws(() => f.session.authorize(f.proof(prepared.challenge)));
    const waiting = b!.call(randomUUID(), { name: 'wait_task', arguments: {} });
    const outcome = a!.call(randomUUID(), {
      name: 'delegate_task',
      arguments: { task: 'SYNTHETIC composed task' },
    });
    const delivered = (await waiting) as { taskId: string; task: string };
    assert.equal(delivered.task, 'SYNTHETIC composed task');
    await assert.rejects(
      b!.call(randomUUID(), {
        name: 'submit_result',
        arguments: { taskId: randomUUID(), result: 'wrong correlation' },
      }),
    );
    await b!.call(randomUUID(), {
      name: 'submit_result',
      arguments: { taskId: delivered.taskId, result: 'SYNTHETIC composed result' },
    });
    assert.deepEqual(await outcome, {
      state: 'completed',
      taskId: delivered.taskId,
      result: 'SYNTHETIC composed result',
    });
    assert.deepEqual(f.writes, []);
    f.events[0]!.exit(0);
    assert.throws(() => f.session.prepare());
  } finally {
    await f.close();
  }
});

test('MCP disconnect revokes the grant without exiting either owned terminal or authorizing a rebind', async () => {
  const f = await fixture();
  try {
    const a = f.launch(0),
      b = f.launch(1);
    const prepared = f.session.prepare();
    f.session.authorize(f.proof(prepared.challenge));
    const waiting = f.clients[1]!.call(randomUUID(), { name: 'wait_task', arguments: {} });
    f.clients[0]!.close();
    assert.equal(((await waiting) as { state: string }).state, 'unknown');
    assert.equal((f.call(0, 'snapshot', [a]) as { state: string }).state, 'running');
    assert.equal((f.call(1, 'snapshot', [b]) as { state: string }).state, 'running');
    assert.throws(() => f.session.prepare());
    await assert.rejects(f.session.open(), /already/);
    assert.deepEqual(f.writes, []);
  } finally {
    await f.close();
  }
});

test('owned process loss ends a pending MCP wait as unknown and does not recover on a late exit', async () => {
  const f = await fixture();
  try {
    const a = f.launch(0);
    f.launch(1);
    const prepared = f.session.prepare();
    f.session.authorize(f.proof(prepared.challenge));
    const outcome = f.clients[0]!.call(randomUUID(), {
      name: 'delegate_task',
      arguments: { task: 'SYNTHETIC no receiver' },
    });
    const deadline = performance.now() + 1000;
    while (f.session.snapshot().state !== 'queued' && performance.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(f.session.snapshot().state, 'queued');
    f.events[1]!.lost();
    assert.equal(((await outcome) as { state: string }).state, 'unknown');
    f.events[1]!.exit(0);
    assert.throws(() => f.session.prepare());
    assert.equal((f.call(0, 'snapshot', [a]) as { state: string }).state, 'running');
    assert.deepEqual(f.writes, []);
  } finally {
    await f.close();
  }
});

test('mixed profile slots preserve signed source/worker roles without PTY delivery', async () => {
  for (const profiles of [
    ['codex-terminal-v1', 'claude-terminal-v1'],
    ['claude-terminal-v1', 'codex-terminal-v1'],
    ['codex-terminal-v1', 'opencode-terminal-v1'],
    ['opencode-terminal-v1', 'codex-terminal-v1'],
  ]) {
    const f = await fixture(profiles);
    try {
      const source = f.launch(0);
      const target = f.launch(1);
      const prepared = f.session.prepare();
      assert.equal(prepared.grant.sourceInstanceId, source);
      assert.equal(prepared.grant.targetInstanceId, target);
      f.session.authorize(f.proof(prepared.challenge));
      const waiting = f.clients[1]!.call(randomUUID(), { name: 'wait_task', arguments: {} });
      const outcome = f.clients[0]!.call(randomUUID(), {
        name: 'delegate_task',
        arguments: { task: 'SYNTHETIC mixed-provider contract' },
      });
      const task = (await waiting) as { taskId: string };
      await f.clients[1]!.call(randomUUID(), {
        name: 'submit_result',
        arguments: { taskId: task.taskId, result: 'SYNTHETIC result' },
      });
      assert.equal(((await outcome) as { state: string }).state, 'completed');
      assert.deepEqual(f.writes, []);
    } finally {
      await f.close();
    }
  }
});
