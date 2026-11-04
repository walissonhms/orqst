// Explicit disposable packaging acceptance. Native menu/focus/dialogs are doubles; no provider.
import assert from 'node:assert/strict';
import { spawn, execFileSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { setTimeout } from 'node:timers/promises';
import {
  managedCodexSettings,
  terminalExecutableSha256,
  type ManagedCodexConfig,
} from '../packages/core/src/terminal/codex-profile.js';

assert.deepEqual(process.argv.slice(2), ['--authorize-synthetic']);
const root = await realpath(await mkdtemp(join(tmpdir(), 'orqst-tauri-mcp-acceptance-')));
const children: ChildProcessWithoutNullStreams[] = [];
const exits: Array<Promise<unknown>> = [];
function start(script: string, args: string[], environment: Record<string, string>) {
  const child = spawn(join(root, 'node'), [script, ...args], {
    cwd: root,
    env: { HOME: root, PATH: '/usr/bin:/bin', LANG: 'en_US.UTF-8', ...environment },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  children.push(child);
  exits.push(once(child, 'exit'));
  child.stderr.resume();
  return child;
}
function wire(child: ChildProcessWithoutNullStreams) {
  const pending = new Map<string, (value: Record<string, unknown>) => void>();
  const send = (value: object) => child.stdin.write(JSON.stringify(value) + '\n');
  const request = (value: Record<string, unknown>) => {
    const id = randomUUID();
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = globalThis.setTimeout(() => {
        pending.delete(id);
        reject(new Error('Synthetic private request timed out'));
      }, 15_000);
      pending.set(id, (response) => {
        clearTimeout(timer);
        pending.delete(id);
        resolve(response);
      });
      send({ ...value, id });
    });
  };
  const lines = createInterface({ input: child.stdout });
  return { pending, send, request, lines };
}

try {
  await cp('apps/tauri/dist/core', join(root, 'core'), { recursive: true });
  const runtime = JSON.parse(await readFile('apps/tauri/dist/core/runtime.json', 'utf8')) as {
    target: string;
  };
  await cp(`apps/tauri/src-tauri/binaries/orqst-node-${runtime.target}`, join(root, 'node'));
  const executable = join(root, 'SYNTHETIC-NOT-A-PROVIDER');
  execFileSync('cc', [
    '-O2',
    '-DORQST_SYNTHETIC_TIMEOUT_SECONDS=60',
    resolve('tests/helpers/managed-terminal-fixture.c'),
    '-o',
    executable,
  ]);
  const home = join(root, 'synthetic-native-home');
  const codexHome = join(home, '.codex');
  const project = join(root, 'project');
  for (const directory of [home, codexHome, project]) await mkdir(directory, { mode: 0o700 });
  const manifests: string[] = [];
  for (const slot of [0, 1]) {
    const state = join(root, `state-${slot}`);
    for (const directory of [state, ...['home', 'codex', 'tmp'].map((name) => join(state, name))])
      await mkdir(directory, { mode: 0o700 });
    const config: ManagedCodexConfig = {
      version: 1,
      trust: 'native-same-user',
      executable: { path: executable, sha256: terminalExecutableSha256(executable) },
      // Required manifest contract label only: the executable is the synthetic C fixture above.
      executableVersion: '0.162.1',
      node: { path: join(root, 'node'), sha256: terminalExecutableSha256(join(root, 'node')) },
      project,
      state,
      authentication: { mode: 'reuse-existing', home, codexHome, sharedNativeConfiguration: true },
      interactive: { sharedNativeSessions: true, mcp: true },
    };
    const file = join(root, `terminal-${slot}.json`);
    await writeFile(file, JSON.stringify(config), { mode: 0o600 });
    await writeFile(join(state, 'codex/config.toml'), managedCodexSettings(config), {
      mode: 0o600,
    });
    manifests.push(file);
  }
  const host = start(
    join(root, 'core/tauri-terminal-host.cjs'),
    [JSON.stringify(manifests), join(root, 'admission')],
    {},
  );
  const native = wire(host);
  const starts: Array<Record<string, unknown>> = [];
  const grants: Array<Record<string, unknown>> = [];
  let ready!: (value: Record<string, unknown>) => void;
  const startup = new Promise<Record<string, unknown>>((resolve) => {
    ready = resolve;
  });
  native.lines.on('line', (line) => {
    const value = JSON.parse(line) as Record<string, unknown>;
    if (value.kind === 'ready') ready(value);
    else if (value.kind === 'confirm') {
      if (value.requestId) grants.push(value);
      else starts.push(JSON.parse(String(value.detail)) as Record<string, unknown>);
      native.send({ kind: 'confirm', id: value.id, accepted: true });
    } else if (value.kind === 'reply')
      native.pending.get(String(value.id))?.(value.value as Record<string, unknown>);
  });
  const deadline = globalThis.setTimeout(() => host.kill('SIGKILL'), 50_000);
  try {
    assert.equal(
      (
        await Promise.race([
          startup,
          exits[0]!.then(() => {
            throw new Error('Synthetic Tauri host refused startup');
          }),
        ])
      ).mcpEnabled,
      true,
    );
    const ids: string[] = [];
    for (const slot of [0, 1]) {
      const start = await native.request({
        kind: 'request',
        slot,
        focused: true,
        request: { version: 1, action: 'start', profileId: 'codex-terminal-v1' },
      });
      assert.equal(start.status, 'ok');
      ids.push(String(start.instanceId));
      let running = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        const result = await native.request({
          kind: 'request',
          slot,
          focused: true,
          request: { version: 1, action: 'snapshot', instanceId: ids[slot] },
        });
        if ((result.snapshot as { state: string }).state === 'running') {
          running = true;
          break;
        }
        await setTimeout(20);
      }
      assert.equal(running, true, 'Synthetic owned PTY must reach source-backed running');
    }
    const marker = await readFile(join(root, 'admission/active-pair.json'));
    const relays = starts.map((confirmation) => {
      const profile = confirmation.profile as { argv: string[] };
      const config = profile.argv.find((arg) => arg.startsWith('mcp_servers.orqst_'))!;
      assert.ok(config);
      const endpoint = (name: string) =>
        JSON.parse(new RegExp(`${name}=("(?:[^"\\\\]|\\\\.)*")`).exec(config)![1]!) as string;
      const child = start(join(root, 'core/orqst-mcp-relay.cjs'), [], {
        ORQST_SOCKET_PATH: endpoint('ORQST_SOCKET_PATH'),
        ORQST_CAP_FILE: endpoint('ORQST_CAP_FILE'),
      });
      const channel = wire(child);
      channel.lines.on('line', (line) => {
        const value = JSON.parse(line) as Record<string, unknown>;
        channel.pending.get(String(value.id))?.(value);
      });
      return channel;
    });
    for (const relay of relays) {
      const initialized = await relay.request({
        jsonrpc: '2.0',
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          clientInfo: { name: 'SYNTHETIC', version: '1' },
          capabilities: {},
        },
      });
      assert.ok(initialized.result);
      relay.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    }
    async function tool(slot: number, name: string, args: object) {
      const response = await relays[slot]!.request({
        jsonrpc: '2.0',
        method: 'tools/call',
        params: { name, arguments: args },
      });
      const result = response.result as { isError: boolean; content: Array<{ text: string }> };
      return {
        isError: result.isError,
        value: JSON.parse(result.content[0]!.text) as Record<string, unknown>,
      };
    }
    // Use raw response here: the denied text is deliberately not JSON.
    const before = await relays[0]!.request({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: 'delegate_task', arguments: { task: 'SYNTHETIC before grant' } },
    });
    assert.equal((before.result as { isError: boolean }).isError, true);
    const granted = await native.request({ kind: 'authorizeMcp', slot: 1, focused: true });
    assert.equal(granted.status, 'ok');
    assert.equal(grants.length, 1);
    const grant = JSON.parse(String(grants[0]!.detail)) as Record<string, unknown>;
    assert.equal(grant.sourceInstanceId, ids[0]);
    assert.equal(grant.targetInstanceId, ids[1]);
    const waiting = tool(1, 'wait_task', {});
    const completed = tool(0, 'delegate_task', { task: 'SYNTHETIC packaged Tauri task' });
    const delivered = await waiting;
    assert.equal(delivered.value.state, 'delivered');
    assert.equal(delivered.value.task, 'SYNTHETIC packaged Tauri task');
    await tool(1, 'submit_result', {
      taskId: delivered.value.taskId,
      result: 'SYNTHETIC packaged result',
    });
    assert.deepEqual((await completed).value, {
      state: 'completed',
      taskId: delivered.value.taskId,
      result: 'SYNTHETIC packaged result',
    });
    assert.equal(
      (await native.request({ kind: 'authorizeMcp', slot: 0, focused: true })).status,
      'denied',
    );
    assert.deepEqual(await readFile(join(root, 'admission/active-pair.json')), marker);
    for (const slot of [0, 1]) {
      assert.equal(
        (
          await native.request({
            kind: 'request',
            slot,
            focused: true,
            request: { version: 1, action: 'stop', instanceId: ids[slot], signal: 'SIGTERM' },
          })
        ).status,
        'ok',
      );
    }
    host.stdin.write('shutdown\n');
    assert.deepEqual(
      await exits[0],
      [0, null],
      'Host must exit cleanly, not via the fixture deadline',
    );
    console.log(
      'PASS: packaged Tauri host, two synthetic owned PTYs, native-consent double, two stdio relays and correlated MCP return; reservation retained. No provider/native UI acceptance.',
    );
  } finally {
    clearTimeout(deadline);
  }
} finally {
  for (const child of children) {
    child.stdin.end();
    child.kill();
  }
  await Promise.allSettled(exits);
  await rm(root, { recursive: true, force: true });
}
