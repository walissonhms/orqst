// Real relay children against a synthetic authorized broker: client notifications must
// never stop the relay, never replay a task and never mint authority. No provider CLI.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import {
  TerminalAuthority,
  terminalChallengeBytes,
} from '../packages/core/src/terminal/authority.js';
import { McpTaskBroker } from '../packages/core/src/terminal/mcp-task.js';
import { openMcpInstanceSockets, readMcpLines } from '../packages/core/src/terminal/mcp-socket.js';

type Wire = Record<string, unknown>;

/** One native-authorized synthetic broker: the only source of task authority here. */
function authorizedBroker(deadlineMs = 10_000) {
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
  const challenge = broker.prepare().challenge;
  broker.authorize({
    challengeId: challenge.challengeId,
    signature: sign(null, terminalChallengeBytes(challenge), keys.privateKey).toString('base64url'),
  });
  return broker;
}

/** The exact relay entry bundled as the provider would launch it. */
async function relayBinary(root: string) {
  const file = join(root, 'relay.cjs');
  await build({
    entryPoints: [resolve('packages/core/src/terminal/mcp-relay.ts')],
    outfile: file,
    bundle: true,
    platform: 'node',
    target: 'node24',
    format: 'cjs',
    logLevel: 'silent',
  });
  return file;
}

interface Relay {
  child: ReturnType<typeof spawn>;
  /** A JSON-RPC request with a fresh numeric id. */
  call(method: string, params?: unknown): Promise<Wire>;
  /** A JSON-RPC notification: no id, never answered. */
  notify(method: string, params?: unknown): void;
  /** Ids that received a response, in arrival order. */
  answered(): number[];
  /** Lines without an id: a relay must never answer a notification. */
  unsolicited(): Wire[];
  stderr(): string;
  alive(): boolean;
  exited(): Promise<void>;
}

function relay(file: string, endpoint: { socketPath: string; capabilityFile: string }): Relay {
  const child = spawn(process.execPath, [file], {
    env: {
      ORQST_SOCKET_PATH: endpoint.socketPath,
      ORQST_CAP_FILE: endpoint.capabilityFile,
      NODE_NO_WARNINGS: '1',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const waiters = new Map<number, (value: Wire) => void>();
  const answered: number[] = [];
  const unsolicited: Wire[] = [];
  let stderr = '';
  let next = 0;
  child.stdin!.on('error', () => {});
  child.stdout!.on('error', () => {});
  child.on('error', () => {});
  child.stderr!.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8');
  });
  readMcpLines(
    child.stdout!,
    (raw) => {
      const value = raw as Wire;
      if (typeof value.id !== 'number') {
        unsolicited.push(value);
        return;
      }
      answered.push(value.id);
      const settle = waiters.get(value.id);
      waiters.delete(value.id);
      settle?.(value);
    },
    () => {
      throw new Error('Malformed relay stdout');
    },
  );
  const write = (value: unknown) => {
    child.stdin!.write(JSON.stringify(value) + '\n');
  };
  return {
    child,
    call(method, params) {
      return new Promise<Wire>((done) => {
        const id = ++next;
        waiters.set(id, done);
        write({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) });
      });
    },
    notify(method, params) {
      write({ jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }) });
    },
    answered: () => [...answered],
    unsolicited: () => [...unsolicited],
    stderr: () => stderr,
    alive: () => child.exitCode === null && !child.killed,
    exited: () =>
      new Promise<void>((done) => {
        if (child.exitCode !== null || child.signalCode !== null) return done();
        child.once('exit', () => done());
      }),
  };
}

/** Waits for the child to exit without hanging the test on a relay that stayed up. */
async function settlement(client: Relay, ms = 4000) {
  const timeout = new Promise<'timeout'>((done) => setTimeout(() => done('timeout'), ms));
  return Promise.race([client.exited().then(() => 'exited' as const), timeout]);
}

async function initialize(client: Relay, protocolVersion: string) {
  const reply = await client.call('initialize', {
    protocolVersion,
    capabilities: {},
    clientInfo: { name: 'synthetic-client', version: '1' },
  });
  assert.equal((reply.result as { protocolVersion: string }).protocolVersion, protocolVersion);
  client.notify('notifications/initialized');
}

test(
  'client notifications never stop the relay or replay a granted task',
  { timeout: 30000 },
  async () => {
    const broker = authorizedBroker();
    const hub = await openMcpInstanceSockets(broker);
    const root = await mkdtemp(join(tmpdir(), 'orqst-mcp-relay-notify-'));
    const clients: Relay[] = [];
    try {
      const file = await relayBinary(root);
      assert.equal(hub.endpoints.length, 2);
      const source = relay(file, hub.endpoints[0]!);
      const worker = relay(file, hub.endpoints[1]!);
      clients.push(source, worker);
      await initialize(source, '2025-06-18');
      await initialize(worker, '2025-11-25');
      for (const client of clients) {
        // A cancelled/unknown/duplicate notification is ignored: no answer, no stop.
        client.notify('notifications/cancelled', { requestId: 1, reason: 'synthetic cancel' });
        client.notify('notifications/progress', { progressToken: 'synthetic', progress: 1 });
        client.notify('notifications/roots/list_changed');
        client.notify('notifications/initialized');
      }
      assert.deepEqual((await source.call('ping')).result, {});
      assert.deepEqual((await worker.call('ping')).result, {});
      assert.equal(source.alive(), true);
      assert.equal(worker.alive(), true);
      // A cancelled notification before any call changes no tool surface.
      assert.match(JSON.stringify(await source.call('tools/list')), /delegate_task/);
      const workerTools = JSON.stringify(await worker.call('tools/list'));
      assert.match(workerTools, /wait_task/);
      assert.doesNotMatch(workerTools, /delegate_task/);
      // Exactly one authorized exchange after the ignored notifications.
      const waiting = worker.call('tools/call', { name: 'wait_task', arguments: {} });
      const delegated = source.call('tools/call', {
        name: 'delegate_task',
        arguments: { task: 'SYNTHETIC task after notifications' },
      });
      const delivered = await waiting;
      const task = JSON.parse(
        (delivered.result as { content: Array<{ text: string }> }).content[0]!.text,
      ) as { state: string; taskId: string; task: string };
      assert.equal(task.state, 'delivered');
      assert.equal(task.task, 'SYNTHETIC task after notifications');
      await worker.call('tools/call', {
        name: 'submit_result',
        arguments: { taskId: task.taskId, result: 'SYNTHETIC result after notifications' },
      });
      assert.match(JSON.stringify(await delegated), /SYNTHETIC result after notifications/);
      assert.equal(broker.snapshot().state, 'completed');
      // A consumed grant cannot be replayed by another call.
      const repeated = await source.call('tools/call', {
        name: 'delegate_task',
        arguments: { task: 'SYNTHETIC replay' },
      });
      assert.equal((repeated.result as { isError: boolean }).isError, true);
      assert.equal(broker.snapshot().state, 'completed');
      // Every request is answered exactly once, in order; no notification is ever answered.
      assert.deepEqual(source.answered(), [1, 2, 3, 4, 5]);
      assert.deepEqual(worker.answered(), [1, 2, 3, 4, 5]);
      assert.deepEqual(source.unsolicited(), []);
      assert.deepEqual(worker.unsolicited(), []);
      assert.equal(source.stderr(), '');
      assert.equal(worker.stderr(), '');
      assert.equal(source.alive(), true);
      assert.equal(worker.alive(), true);
    } finally {
      for (const client of clients) client.child.kill('SIGTERM');
      await hub.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);

for (const frame of [
  {
    name: 'repeated ids',
    write: (child: ReturnType<typeof spawn>) => {
      const line = (id: number) => JSON.stringify({ jsonrpc: '2.0', id, method: 'ping' }) + '\n';
      child.stdin!.write(line(41));
      child.stdin!.write(line(41));
    },
  },
  {
    name: 'malformed JSON',
    write: (child: ReturnType<typeof spawn>) => {
      child.stdin!.write('{not-a-frame}\n');
    },
  },
  {
    name: 'an oversized record',
    write: (child: ReturnType<typeof spawn>) => {
      child.stdin!.write(`{"jsonrpc":"2.0","id":71,"method":"${'x'.repeat(70_000)}"}\n`);
    },
  },
])
  test(
    `a protocol violation (${frame.name}) still stops the relay`,
    { timeout: 30000 },
    async () => {
      const broker = authorizedBroker();
      const hub = await openMcpInstanceSockets(broker);
      const root = await mkdtemp(join(tmpdir(), 'orqst-mcp-relay-violation-'));
      let client: Relay | undefined;
      try {
        client = relay(await relayBinary(root), hub.endpoints[0]!);
        await initialize(client, '2025-11-25');
        assert.equal(client.alive(), true);
        frame.write(client.child);
        assert.equal(await settlement(client), 'exited');
        assert.equal(client.alive(), false);
      } finally {
        client?.child.kill('SIGTERM');
        await hub.close();
        await rm(root, { recursive: true, force: true });
      }
    },
  );
