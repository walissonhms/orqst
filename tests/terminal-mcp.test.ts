// Synthetic native-signed grants, real local Unix sockets and Node stdio clients. No provider CLI.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { chmod, lstat, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import {
  TerminalAuthority,
  terminalChallengeBytes,
} from '../packages/core/src/terminal/authority.js';
import {
  claudeInteractiveMcpConfiguration,
  opencodeInteractiveMcpConfiguration,
  reviewedProviderMcpBinaries,
} from '../packages/core/src/terminal/provider-mcp-config.js';
import { terminalDigest } from '../packages/core/src/terminal/authority.js';
import { McpTaskBroker } from '../packages/core/src/terminal/mcp-task.js';
import {
  connectMcpInstance,
  openMcpInstanceSockets,
  readMcpLines,
} from '../packages/core/src/terminal/mcp-socket.js';

function grant(deadline = 10000) {
  const keys = generateKeyPairSync('ed25519');
  const authority = new TerminalAuthority(new Map([['desktop-managed', keys.publicKey]]));
  let owned = true;
  const broker = new McpTaskBroker(
    authority,
    {
      sourceInstanceId: randomUUID(),
      targetInstanceId: randomUUID(),
      workspaceId: 'synthetic-workspace',
    },
    () => owned,
    deadline,
  );
  const prepared = broker.prepare();
  const proof = {
    challengeId: prepared.challenge.challengeId,
    signature: sign(null, terminalChallengeBytes(prepared.challenge), keys.privateKey).toString(
      'base64url',
    ),
  };
  return {
    broker,
    authority,
    proof,
    lose() {
      owned = false;
    },
  };
}

test('MCP grant binds identities, explicit native proof, roles, target, bytes, single-use and correlated completion', async () => {
  const f = grant();
  try {
    await assert.rejects(
      f.broker.call('source', { name: 'delegate_task', arguments: { task: 'synthetic' } }),
      /unavailable/,
    );
    assert.throws(() => f.broker.authorize({}), /proof/);
    f.broker.authorize(f.proof);
    await assert.rejects(
      f.broker.call('worker', { name: 'delegate_task', arguments: { task: 'synthetic' } }),
    );
    await assert.rejects(
      f.broker.call('source', {
        name: 'delegate_task',
        arguments: { task: 'synthetic', targetInstanceId: randomUUID() },
      }),
    );
    await assert.rejects(
      f.broker.call('source', { name: 'delegate_task', arguments: { task: '💥'.repeat(2048) } }),
    );
    const waiting = f.broker.call('worker', { name: 'wait_task', arguments: {} });
    const result = f.broker.call('source', {
      name: 'delegate_task',
      arguments: { task: 'SYNTHETIC task' },
    });
    const task = (await waiting) as { state: string; taskId: string; task: string };
    assert.equal(task.state, 'delivered');
    assert.equal(task.task, 'SYNTHETIC task');
    await assert.rejects(
      f.broker.call('source', { name: 'delegate_task', arguments: { task: 'retry' } }),
    );
    await assert.rejects(
      f.broker.call('worker', {
        name: 'submit_result',
        arguments: { taskId: randomUUID(), result: 'wrong task' },
      }),
    );
    await f.broker.call('worker', {
      name: 'submit_result',
      arguments: { taskId: task.taskId, result: 'SYNTHETIC result' },
    });
    assert.deepEqual(await result, {
      state: 'completed',
      taskId: task.taskId,
      result: 'SYNTHETIC result',
    });
    await assert.rejects(f.broker.call('worker', { name: 'wait_task', arguments: {} }));
  } finally {
    f.broker.close();
  }
});

test('MCP timeout, lost ownership and disconnect retain unknown outcomes without retry or process exit', async () => {
  const f = grant(30);
  f.broker.authorize(f.proof);
  const outcome = await f.broker.call('source', {
    name: 'delegate_task',
    arguments: { task: 'SYNTHETIC no receiver' },
  });
  assert.equal((outcome as { state: string }).state, 'unknown');
  assert.equal('exit' in f.broker.snapshot(), false);
  await assert.rejects(f.broker.call('worker', { name: 'wait_task', arguments: {} }));
  const g = grant();
  try {
    g.broker.authorize(g.proof);
    const pending = g.broker.call('worker', { name: 'wait_task', arguments: {} });
    g.lose();
    await assert.rejects(
      g.broker.call('source', { name: 'delegate_task', arguments: { task: 'no ownership' } }),
    );
    assert.equal(((await pending) as { state: string }).state, 'unknown');
  } finally {
    g.broker.close();
  }
});

test('private Unix endpoints reject bad secrets and public capability files, and socket closure is not CLI exit', async () => {
  const f = grant();
  f.broker.authorize(f.proof);
  const hub = await openMcpInstanceSockets(f.broker);
  let client: Awaited<ReturnType<typeof connectMcpInstance>> | undefined;
  try {
    assert.equal((await lstat(hub.directory)).mode & 0o777, 0o700);
    const endpoint = hub.endpoints[0]!;
    assert.equal((await lstat(endpoint.socketPath)).mode & 0o777, 0o600);
    assert.equal((await lstat(endpoint.capabilityFile)).mode & 0o777, 0o600);
    const wrong = createConnection(endpoint.socketPath);
    await new Promise<void>((resolve) => {
      wrong.on('connect', () => wrong.write(JSON.stringify({ secret: 'x'.repeat(43) }) + '\n'));
      wrong.on('close', resolve);
      wrong.on('error', () => {});
    });
    assert.equal(f.broker.snapshot().state, 'ready');
    await chmod(endpoint.capabilityFile, 0o644);
    await assert.rejects(
      connectMcpInstance(endpoint.socketPath, endpoint.capabilityFile),
      /capability/,
    );
    await chmod(endpoint.capabilityFile, 0o600);
    client = await connectMcpInstance(endpoint.socketPath, endpoint.capabilityFile);
    assert.equal(client.role, 'source');
    const task = client.call(randomUUID(), {
      name: 'delegate_task',
      arguments: { task: 'SYNTHETIC' },
    });
    client.close();
    await assert.rejects(task, /unknown/);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal('exit' in f.broker.snapshot(), false);
  } finally {
    client?.close();
    await hub.close();
  }
});

for (const providers of [
  ['relay', 'relay'],
  ['claude', 'opencode'],
  ['opencode', 'claude'],
] as const)
  test(
    `real relay children use ${providers.join('/')} configuration for synthetic A -> B -> A without PTY input`,
    { timeout: 15000 },
    async () => {
      const f = grant();
      f.broker.authorize(f.proof);
      const hub = await openMcpInstanceSockets(f.broker);
      const root = await realpath(await mkdtemp(join(tmpdir(), 'orqst-mcp-relay-test-')));
      const children: ReturnType<typeof spawn>[] = [];
      try {
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
        const relayHash = terminalDigest(await readFile(file));
        const clients = hub.endpoints.map((endpoint, index) => {
          const provider = providers[index]!;
          let command = process.execPath;
          let args = [file];
          let environment: Record<string, string> = {
            ORQST_SOCKET_PATH: endpoint.socketPath,
            ORQST_CAP_FILE: endpoint.capabilityFile,
          };
          if (provider !== 'relay') {
            const input = {
              executableVersion: reviewedProviderMcpBinaries[provider].version,
              executableSha256: reviewedProviderMcpBinaries[provider].sha256,
              nodePath: process.execPath,
              mcp: {
                serverName: 'orqst_' + 'a'.repeat(32),
                socketPath: endpoint.socketPath,
                capabilityFile: endpoint.capabilityFile,
                relay: { path: file, sha256: relayHash },
              },
            };
            if (provider === 'claude') {
              const plan = claudeInteractiveMcpConfiguration({ ...input, sessionId: randomUUID() });
              const config = JSON.parse(plan.argv[2]!).mcpServers[input.mcp.serverName] as {
                command: string;
                args: string[];
                env: Record<string, string>;
              };
              command = config.command;
              args = config.args;
              environment = config.env;
            } else {
              const plan = opencodeInteractiveMcpConfiguration(input);
              const config = JSON.parse(plan.environmentOverrides.OPENCODE_CONFIG_CONTENT).mcp
                .servers[input.mcp.serverName] as {
                command: string[];
                environment: Record<string, string>;
              };
              command = config.command[0]!;
              args = config.command.slice(1);
              environment = config.environment;
            }
          }
          // Execute only the generated Node relay command, never the native provider argv.
          assert.equal(command, process.execPath);
          assert.deepEqual(args, [file]);
          const child = spawn(command, args, {
            env: { ...environment, NODE_NO_WARNINGS: '1' },
            stdio: ['pipe', 'pipe', 'pipe'],
          });
          children.push(child);
          const pending = new Map<number, (value: Record<string, unknown>) => void>();
          let next = 0,
            output = '',
            stderr = '';
          child.stdout!.on('data', (chunk: Buffer) => {
            output += chunk.toString('utf8');
          });
          child.stderr!.on('data', (chunk: Buffer) => {
            stderr += chunk.toString('utf8');
          });
          readMcpLines(
            child.stdout!,
            (raw) => {
              const value = raw as Record<string, unknown>;
              const resolve = pending.get(value.id as number);
              assert.ok(resolve);
              pending.delete(value.id as number);
              resolve(value);
            },
            () => {
              throw new Error('Malformed relay stdout');
            },
          );
          const call = (method: string, params?: unknown) =>
            new Promise<Record<string, unknown>>((resolve) => {
              const id = ++next;
              pending.set(id, resolve);
              child.stdin!.write(
                JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) }) +
                  '\n',
              );
            });
          return { call, child, output: () => output, stderr: () => stderr };
        });
        for (const client of clients) {
          const initialized = await client.call('initialize', {
            protocolVersion: '2025-11-25',
            capabilities: {},
            clientInfo: { name: 'synthetic-client', version: '1' },
          });
          assert.ok(initialized.result);
          client.child.stdin!.write(
            JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n',
          );
        }
        const a = clients[0]!,
          b = clients[1]!;
        const aTools = await a.call('tools/list'),
          bTools = await b.call('tools/list');
        assert.match(JSON.stringify(aTools), /delegate_task/);
        assert.doesNotMatch(JSON.stringify(bTools), /delegate_task/);
        const waiting = b.call('tools/call', { name: 'wait_task', arguments: {} });
        const delegated = a.call('tools/call', {
          name: 'delegate_task',
          arguments: { task: 'SYNTHETIC stdio task' },
        });
        const delivered = await waiting;
        const task = JSON.parse(
          (delivered.result as { content: Array<{ text: string }> }).content[0]!.text,
        );
        assert.equal(task.state, 'delivered');
        await b.call('tools/call', {
          name: 'submit_result',
          arguments: { taskId: task.taskId, result: 'SYNTHETIC stdio result' },
        });
        const result = await delegated;
        assert.match(JSON.stringify(result), /SYNTHETIC stdio result/);
        for (const [index, client] of clients.entries()) {
          assert.equal(client.stderr(), '');
          const secret = await readFile(hub.endpoints[index]!.capabilityFile, 'utf8');
          assert.equal(client.output().includes(secret), false);
          assert.equal(
            client.child.spawnargs.some((arg) => arg.includes(secret)),
            false,
          );
        }
        assert.equal(f.broker.snapshot().state, 'completed');
      } finally {
        for (const child of children) {
          child.stdin?.end();
          child.kill('SIGTERM');
        }
        await hub.close();
        await rm(root, { recursive: true, force: true });
      }
    },
  );
