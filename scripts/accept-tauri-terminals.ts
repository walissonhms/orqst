// Explicit disposable packaging acceptance. Native focus/dialogs are simulated; no provider runs.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { cp, mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { chromium, expect } from '@playwright/test';
import { terminalNativeReplySchema, type TerminalNativeRequest } from '@orqst/protocol';
import {
  managedCodexSettings,
  terminalExecutableSha256,
  type ManagedCodexConfig,
} from '../packages/core/src/terminal/codex-profile.js';

assert.deepEqual(process.argv.slice(2), ['--authorize-synthetic']);
const fixture = await realpath(await mkdtemp(join(tmpdir(), 'orqst-tauri-terminal-acceptance-')));
await cp('apps/tauri/dist/core', join(fixture, 'core'), { recursive: true });
const runtime = JSON.parse(await readFile('apps/tauri/dist/core/runtime.json', 'utf8')) as {
  target: string;
};
const node = join(fixture, 'node');
await cp(`apps/tauri/src-tauri/binaries/orqst-node-${runtime.target}`, node);
const executable = join(fixture, 'synthetic-pty');
execFileSync('cc', ['-O2', resolve('tests/helpers/managed-terminal-fixture.c'), '-o', executable]);
const project = join(fixture, 'project');
const state = join(fixture, 'state');
for (const directory of [project, state, ...['home', 'codex', 'tmp'].map((p) => join(state, p))])
  await mkdir(directory, { mode: 0o700 });
const config: ManagedCodexConfig = {
  version: 1,
  trust: 'native-same-user',
  executable: { path: executable, sha256: terminalExecutableSha256(executable) },
  executableVersion: 'SYNTHETIC-NOT-A-PROVIDER',
  node: { path: node, sha256: terminalExecutableSha256(node) },
  project,
  state,
};
const manifest = join(fixture, 'manifest.json');
await writeFile(manifest, JSON.stringify(config), { mode: 0o600 });
await writeFile(join(state, 'codex/config.toml'), managedCodexSettings(config), { mode: 0o600 });
await writeFile(join(state, 'codex/auth.json'), '{"synthetic":true}', { mode: 0o600 });
const child = spawn(
  node,
  [
    join(fixture, 'core/tauri-terminal-host.cjs'),
    JSON.stringify([manifest]),
    join(fixture, 'admission'),
  ],
  {
    cwd: fixture,
    env: { HOME: fixture, PATH: '/usr/bin:/bin', LANG: 'en_US.UTF-8' },
    stdio: ['pipe', 'pipe', 'pipe'],
  },
);
const exited = once(child, 'exit');
let diagnostics = '';
child.stderr.on('data', (chunk: Buffer) => {
  diagnostics = (diagnostics + chunk.toString()).slice(-4096);
});
const lines = createInterface({ input: child.stdout });
const pending = new Map<string, (value: unknown) => void>();
const send = (value: object) => child.stdin.write(JSON.stringify(value) + '\n');
let acceptReady!: (value: { panes: Array<{ html: string }> }) => void;
const ready = new Promise<{ panes: Array<{ html: string }> }>((resolve) => {
  acceptReady = resolve;
});
const confirmations: string[] = [];
lines.on('line', (line) => {
  const value = JSON.parse(line) as {
    kind: string;
    id: string;
    detail: string;
    value: unknown;
    panes: Array<{ html: string }>;
  };
  if (value.kind === 'ready') acceptReady(value);
  else if (value.kind === 'confirm') {
    confirmations.push(value.detail);
    send({ kind: 'confirm', id: value.id, accepted: true }); // Synthetic native consent only.
  } else pending.get(value.id)?.(value.value);
});
async function request(request: TerminalNativeRequest) {
  const id = randomUUID();
  return new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('Synthetic request timed out'));
    }, 10_000);
    pending.set(id, (value) => {
      clearTimeout(timer);
      pending.delete(id);
      resolve(value);
    });
    send({ kind: 'request', id, slot: 0, focused: true, request });
  });
}
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
const deadline = setTimeout(() => child.kill('SIGKILL'), 30_000);
try {
  const value = await Promise.race([
    ready,
    exited.then(() => {
      throw new Error(`Synthetic host exited: ${diagnostics}`);
    }),
  ]);
  browser = await chromium.launch();
  const page = await browser.newPage();
  await page.exposeFunction(
    'syntheticNativeInvoke',
    (command: string, args: { request: TerminalNativeRequest }) => {
      assert.equal(command, 'terminal_request');
      return request(args.request);
    },
  );
  await page.addInitScript(() => {
    const native = Reflect.get(window, 'syntheticNativeInvoke') as (
      command: string,
      args: unknown,
    ) => Promise<unknown>;
    Reflect.set(window, '__TAURI_INTERNALS__', { invoke: native });
  });
  const client = await readFile('apps/tauri/dist/terminal/client.js', 'utf8');
  const style = await readFile('apps/tauri/dist/terminal/style.css', 'utf8');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*', (route) => {
    const path = new URL(route.request().url()).pathname;
    assert.ok(['/0/index.html', '/0/client.js', '/0/style.css'].includes(path));
    return route.fulfill({
      contentType: path.endsWith('.js')
        ? 'text/javascript'
        : path.endsWith('.css')
          ? 'text/css'
          : 'text/html',
      body: path.endsWith('.js') ? client : path.endsWith('.css') ? style : value.panes[0]!.html,
    });
  });
  await page.goto('https://synthetic.orqst.invalid/0/index.html');
  await expect(page.locator('#terminal .xterm')).toBeVisible();
  await page.locator('#start').click();
  await expect(page.locator('#status'))
    .toHaveAttribute('data-state', 'running')
    .catch((error: unknown) => {
      throw new Error(
        `Synthetic start failed (${confirmations.length} confirmations; host diagnostics: ${diagnostics})`,
        { cause: error },
      );
    });
  await page.locator('#attach').click();
  await expect(page.locator('#terminal')).toContainText('SYNTHETIC:OWNED_TUI');
  assert.equal(await page.evaluate(() => Reflect.get(window, 'syntheticInjection')), undefined);
  await page.locator('#input').click();
  await expect(page.locator('main')).toHaveAttribute('data-next', 'typing');
  await page.keyboard.type('ping');
  await page.keyboard.press('Enter');
  await expect(page.locator('#terminal')).toContainText('SYNTHETIC:PONG');
  const id = await page.locator('#status').getAttribute('data-instance-id');
  assert.ok(id);
  const resized = terminalNativeReplySchema.parse(
    await request({ version: 1, action: 'resize', instanceId: id, columns: 91, rows: 31 }),
  );
  assert.equal(resized.status, 'ok');
  send({ kind: 'revoke', slot: 0 });
  const revoked = terminalNativeReplySchema.parse(
    await request({ version: 1, action: 'write', instanceId: id, sequence: 100, text: 'revoked' }),
  );
  assert.equal(revoked.status, 'denied');
  await page.locator('#stop').click();
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'exited');
  assert.deepEqual(errors, []);
  assert.ok(confirmations.length >= 4);
  child.stdin.end('shutdown\n');
  const [code, signal] = await exited;
  assert.equal(code, 0);
  assert.equal(signal, null);
  console.log(
    'PASS: packaged Node hosts + real synthetic PTY + Tauri xterm bundle, signed start/attach/input/stop, output, resize and revocation outside checkout. Native IPC/focus/dialogs simulated; no real provider.',
  );
} finally {
  clearTimeout(deadline);
  await browser?.close();
  lines.close();
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    await exited;
  }
  await rm(fixture, { recursive: true, force: true });
}
