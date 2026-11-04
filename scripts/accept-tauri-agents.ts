// Packaged synthetic native processes and shipped Tauri client; native dialogs/focus are simulated.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { chromium, expect } from '@playwright/test';
import en from '../apps/dashboard/src/locales/en-US.json';
import {
  managedAgentsReplySchema,
  type ManagedAgentsRequest,
  type ManagedAgentsReply,
} from '@orqst/protocol';
import {
  managedCodexSettings,
  terminalExecutableSha256,
  type ManagedCodexConfig,
} from '../packages/core/src/terminal/codex-profile.js';

assert.deepEqual(process.argv.slice(2), ['--authorize-synthetic']);
assert.match(process.version, /^v24\./);
assert.equal(process.platform, 'darwin');
assert.equal(process.arch, 'arm64');
process.umask(0o077);
const fixture = await realpath(await mkdtemp(join(tmpdir(), 'orqst-tauri-agents-acceptance-')));
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let child: ReturnType<typeof spawn> | undefined;
try {
  await cp('apps/tauri/dist/core', join(fixture, 'core'), { recursive: true });
  const runtime = JSON.parse(await readFile('apps/tauri/dist/core/runtime.json', 'utf8')) as {
    target: string;
  };
  const node = join(fixture, 'node');
  await cp(`apps/tauri/src-tauri/binaries/orqst-node-${runtime.target}`, node);
  const executable = join(fixture, 'SYNTHETIC-not-codex');
  execFileSync('/usr/bin/cc', [
    resolve('tests/helpers/managed-agents-fixture.c'),
    '-o',
    executable,
  ]);
  const project = join(fixture, 'project');
  const home = join(fixture, 'SYNTHETIC-home');
  await mkdir(project, { mode: 0o700 });
  await mkdir(home, { mode: 0o700 });
  const files: string[] = [];
  for (const slot of [0, 1]) {
    const state = join(fixture, `state-${slot}`);
    for (const directory of [state, ...['home', 'codex', 'tmp'].map((p) => join(state, p))])
      await mkdir(directory, { mode: 0o700 });
    const config: ManagedCodexConfig = {
      version: 1,
      trust: 'native-same-user',
      executable: { path: executable, sha256: terminalExecutableSha256(executable) },
      node: { path: node, sha256: terminalExecutableSha256(node) },
      executableVersion: 'SYNTHETIC-NOT-CODEX',
      project,
      state,
      authentication: {
        mode: 'reuse-existing',
        home,
        codexHome: home,
        sharedNativeConfiguration: true,
      },
    };
    const file = join(state, 'terminal.json');
    await writeFile(file, JSON.stringify(config), { mode: 0o600 });
    await writeFile(join(state, 'codex/config.toml'), managedCodexSettings(config), {
      mode: 0o600,
    });
    files.push(file);
  }
  const processHost = (child = spawn(
    node,
    [
      join(fixture, 'core/tauri-agents-host.cjs'),
      JSON.stringify(files),
      join(fixture, 'admission'),
    ],
    {
      cwd: fixture,
      env: { HOME: home, PATH: '/usr/bin:/bin', LANG: 'en_US.UTF-8' },
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  ));
  assert.ok(processHost.stdin && processHost.stdout && processHost.stderr);
  const exited = once(processHost, 'exit');
  const deadline = setTimeout(() => processHost.kill('SIGKILL'), 60_000);
  let diagnostics = '';
  processHost.stderr.on('data', (chunk: Buffer) => {
    diagnostics = (diagnostics + chunk.toString()).slice(-4096);
  });
  const pending = new Map<string, (value: unknown) => void>();
  const send = (value: object) => processHost.stdin!.write(JSON.stringify(value) + '\n');
  let ready!: (value: { html: string }) => void;
  const startup = new Promise<{ html: string }>((resolve) => {
    ready = resolve;
  });
  let approve = true;
  const reviews: string[] = [];
  const lines = createInterface({ input: processHost.stdout });
  lines.on('line', (line) => {
    const value = JSON.parse(line) as {
      kind: string;
      id: string;
      html: string;
      detail: string;
      value: unknown;
    };
    if (value.kind === 'ready') ready(value);
    else if (value.kind === 'confirm') {
      reviews.push(value.detail);
      send({ kind: 'confirm', id: value.id, accepted: approve });
    } else if (value.kind === 'reply') pending.get(value.id)?.(value.value);
  });
  async function request(request: ManagedAgentsRequest): Promise<ManagedAgentsReply> {
    const id = randomUUID();
    const value = await new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('Synthetic agents request timed out'));
      }, 15_000);
      pending.set(id, (value) => {
        clearTimeout(timer);
        pending.delete(id);
        resolve(value);
      });
      send({ kind: 'request', id, focused: true, request });
    });
    return managedAgentsReplySchema.parse(value);
  }
  const snapshot = async () => (await request({ version: 1, action: 'snapshot' })).snapshot!;
  try {
    const ready = await Promise.race([
      startup,
      exited.then(() => {
        throw new Error(`Packaged startup refused: ${diagnostics}`);
      }),
    ]);
    assert.ok(ready.html.includes('src="client.js"'));
    assert.ok(!ready.html.includes('orqst-terminal://'));
    assert.ok(ready.html.includes(en.managedAgents.tauriSetup));
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.exposeFunction(
      'syntheticTauriInvoke',
      async (command: string, args: { request: ManagedAgentsRequest }) => {
        assert.equal(command, 'agents_request');
        return request(args.request);
      },
    );
    await page.setContent(
      ready.html.replace(/<script[^>]*>[\s\S]*?<\/script>/g, '').replace(/<link[^>]*>/g, ''),
    );
    await page.evaluate(
      `window.__TAURI_INTERNALS__ = { invoke: (command, args) => window.syntheticTauriInvoke(command, args) }`,
    );
    await page.addScriptTag({ path: resolve('apps/tauri/dist/agents/client.js') });
    await expect(page.locator('#start-0')).toBeEnabled();
    approve = false;
    await page.locator('#model-0').fill('SYNTHETIC-model');
    await page.locator('#start-0').click();
    await expect(page.locator('#status')).toHaveText(en.managedAgents.cancelled);
    assert.equal((await snapshot()).slots[0]?.state, 'prepared');
    approve = true;
    for (const slot of [0, 1]) {
      await page.locator(`#model-${slot}`).fill('SYNTHETIC-model');
      await page.locator(`#start-${slot}`).click();
      await expect.poll(async () => (await snapshot()).slots[slot]?.pane?.state).toBe('ready');
    }
    await expect(page.locator('#delegate')).toBeDisabled();
    assert.equal(
      (
        await request({
          version: 1,
          action: 'delegate',
          sourceSlot: 0,
          text: 'SYNTHETIC',
          task: '@terminal-b SYNTHETIC worker task',
        })
      ).status,
      'unavailable',
    );
    await page.locator('#name-0').fill('Synthetic coordinator');
    await page.locator('#role-0').selectOption('orchestrator');
    await page.locator('#route-0').check();
    await page.locator('#routing-0').click();
    await expect
      .poll(async () => (await snapshot()).slots[0]?.pane?.routing?.role)
      .toBe('orchestrator');
    await expect(page.locator('#delegate')).toBeEnabled();
    await page.locator('#task').fill('SYNTHETIC prefix @');
    await page.locator('#mention-options button').click();
    await expect(page.locator('#task')).toHaveValue('SYNTHETIC prefix @terminal-b ');
    const current = await snapshot();
    assert.notEqual(current.slots[0]?.nativeThreadId, current.slots[1]?.nativeThreadId);
    const reverse = await request({
      version: 1,
      action: 'routing',
      slot: 1,
      update: {
        name: 'Synthetic reviewer',
        handle: 'terminal-b',
        role: 'reviewer',
        allowedTargetPaneIds: [current.slots[0]!.pane!.paneId],
      },
    });
    assert.equal(reverse.status, 'unavailable', 'transitive/direct cycle remains refused by Core');
    await page.locator('#instructions').fill('SYNTHETIC root instruction');
    await page.locator('#task').fill('@terminal-b SYNTHETIC worker task');
    await page.locator('#delegate').click();
    await expect.poll(async () => (await snapshot()).root?.state).toBe('completed');
    await expect(page.locator('#output-0')).toHaveText('SYNTHETIC root received worker result');
    await expect(page.locator('#output-1')).toHaveText('SYNTHETIC worker result');
    const result = await snapshot();
    assert.equal(result.messages[0]?.correlationId, result.root?.correlationId);
    assert.equal(result.messages[0]?.resultText, 'SYNTHETIC worker result');
    for (const slot of [0, 1]) {
      assert.equal((await request({ version: 1, action: 'stop', slot })).status, 'ok');
      await expect.poll(async () => (await snapshot()).slots[slot]?.state).toBe('exited');
    }
    await expect(page.locator('#retire')).toBeEnabled();
    await page.locator('#retire').click();
    await expect.poll(async () => (await snapshot()).admission).toBe('retired');
    assert.deepEqual(errors, []);
    assert.ok(reviews.length >= 7);
    assert.ok(reviews.every((review) => review.length <= 4096));
    await browser.close();
    browser = undefined;
    processHost.stdin.write('shutdown\n');
    const [code, signal] = await exited;
    assert.equal(code, 0);
    assert.equal(signal, null);
    console.log(
      JSON.stringify({
        result: 'passed',
        scope: 'packaged-tauri-client-and-node-structured-hosts',
        checks: [
          'cancelled-start',
          'signed-starts',
          'deny-by-default',
          'signed-directed-routing',
          'cycle-denial',
          'autocomplete',
          'correlated-worker-return',
          'confirmed-exits',
          'signed-retirement',
          'pipe-shutdown',
        ],
        limits:
          'Synthetic CLI executables and Chromium; Tauri invoke/focus/dialog decisions simulated. No installed provider, native WebKit interaction, login, durable reconnect or platform packaging acceptance.',
      }),
    );
  } finally {
    clearTimeout(deadline);
    lines.close();
  }
} finally {
  await browser?.close();
  if (child && child.exitCode === null && child.signalCode === null) {
    child.stdin?.end('shutdown\n');
    const deadline = setTimeout(() => child?.kill('SIGKILL'), 5000);
    await once(child, 'exit');
    clearTimeout(deadline);
  }
  await rm(fixture, { recursive: true, force: true });
}
