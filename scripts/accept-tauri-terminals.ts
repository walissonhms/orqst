// Explicit disposable packaging acceptance. Native focus/dialogs are simulated; no provider runs.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { cp, mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import type { TerminalLayoutState } from '../apps/desktop/src/terminal-layout.js';
import { chromium, expect, type Page } from '@playwright/test';
import { terminalNativeReplySchema, type TerminalNativeRequest } from '@orqst/protocol';
import {
  managedCodexSettings,
  terminalExecutableSha256,
  type ManagedCodexConfig,
} from '../packages/core/src/terminal/codex-profile.js';

const args = process.argv.slice(2);
const count = args[1] === '--panes=8' ? 8 : 2;
assert.deepEqual(
  args,
  count === 8 ? ['--authorize-synthetic', '--panes=8'] : ['--authorize-synthetic'],
);
const fixture = await realpath(await mkdtemp(join(tmpdir(), 'orqst-tauri-terminal-acceptance-')));
await cp('apps/tauri/dist/core', join(fixture, 'core'), { recursive: true });
const runtime = JSON.parse(await readFile('apps/tauri/dist/core/runtime.json', 'utf8')) as {
  target: string;
};
const node = join(fixture, 'node');
await cp(`apps/tauri/src-tauri/binaries/orqst-node-${runtime.target}`, node);
const executable = join(fixture, 'synthetic-pty');
execFileSync('cc', [
  '-O2',
  '-DORQST_SYNTHETIC_TIMEOUT_SECONDS=90',
  resolve('tests/helpers/managed-terminal-fixture.c'),
  '-o',
  executable,
]);
const project = join(fixture, 'project');
await mkdir(project, { mode: 0o700 });
const manifests: string[] = [];
for (let slot = 0; slot < count; slot++) {
  const state = join(fixture, `state-${slot}`);
  for (const directory of [state, ...['home', 'codex', 'tmp'].map((p) => join(state, p))])
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
  const manifest = join(fixture, `manifest-${slot}.json`);
  await writeFile(manifest, JSON.stringify(config), { mode: 0o600 });
  await writeFile(join(state, 'codex/config.toml'), managedCodexSettings(config), { mode: 0o600 });
  await writeFile(join(state, 'codex/auth.json'), '{"synthetic":true}', { mode: 0o600 });
  manifests.push(manifest);
}
const child = spawn(
  node,
  [
    join(fixture, 'core/tauri-terminal-host.cjs'),
    JSON.stringify(manifests),
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
let acceptReady!: (value: { panes: Array<{ html: string }>; layout: TerminalLayoutState }) => void;
let layout: TerminalLayoutState;
const pages: Page[] = [];
let layoutWork = Promise.resolve();
let layoutError: unknown;
const ready = new Promise<{ panes: Array<{ html: string }>; layout: TerminalLayoutState }>(
  (resolve) => {
    acceptReady = resolve;
  },
);
const confirmations: string[] = [];
lines.on('line', (line) => {
  const value = JSON.parse(line) as {
    kind: string;
    id: string;
    detail: string;
    value: unknown;
    panes: Array<{ html: string }>;
    layout: TerminalLayoutState;
    state: TerminalLayoutState;
    bounds: Array<{ slot: number; rect: { width: number; height: number } | null }>;
  };
  if (value.kind === 'ready') {
    layout = value.layout;
    acceptReady(value);
  } else if (value.kind === 'layout') {
    layout = value.state;
    layoutWork = layoutWork
      .then(async () => {
        for (const [slot, page] of pages.entries()) {
          const rect = value.bounds.find((b) => b.slot === slot)?.rect;
          if (rect) await page.setViewportSize({ width: rect.width, height: rect.height });
          await page.evaluate((state) => {
            window.dispatchEvent(new CustomEvent('orqst-terminal-layout', { detail: state }));
          }, value.state);
        }
      })
      .catch((error: unknown) => {
        layoutError = error;
      });
  } else if (value.kind === 'confirm') {
    confirmations.push(value.detail);
    send({ kind: 'confirm', id: value.id, accepted: true }); // Synthetic native consent only.
  } else pending.get(value.id)?.(value.value);
});
async function request(request: TerminalNativeRequest, slot = 0) {
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
    send({ kind: 'request', id, slot, focused: true, request });
  });
}
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
const deadline = setTimeout(() => child.kill('SIGKILL'), 90_000);
try {
  const value = await Promise.race([
    ready,
    exited.then(() => {
      throw new Error(`Synthetic host exited: ${diagnostics}`);
    }),
  ]);
  browser = await chromium.launch();
  send({ kind: 'layout-resize', width: 1440, height: 1200 });
  send({ kind: 'layout-open', slot: 0 });
  await expect.poll(() => layout.visible.length).toBeGreaterThan(0);
  const client = await readFile('apps/tauri/dist/terminal/client.js', 'utf8');
  const style = await readFile('apps/tauri/dist/terminal/style.css', 'utf8');
  const errors: string[] = [];
  const ids: string[] = [];
  for (let slot = 0; slot < count; slot++) {
    const page: Page = await browser.newPage({ viewport: { width: 720, height: 600 } });
    await page.exposeFunction(
      'syntheticNativeInvoke',
      (command: string, args: { request: TerminalNativeRequest; action: unknown }) => {
        if (command === 'terminal_view') {
          if (args.action === 'layout') return layout;
          if (!layout.visible.includes(slot)) return false;
          send({ kind: 'layout-action', slot, action: args.action });
          return true;
        }
        assert.equal(command, 'terminal_request');
        if (
          !layout.visible.includes(slot) &&
          !['read', 'snapshot', 'resize', 'detach'].includes(args.request.action)
        )
          return { status: 'focus_required' };
        return request(args.request, slot);
      },
    );
    await page.addInitScript(() => {
      Reflect.set(window, '__TAURI_INTERNALS__', {
        invoke: Reflect.get(window, 'syntheticNativeInvoke'),
      });
    });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/*', (route) => {
      const path = new URL(route.request().url()).pathname;
      assert.ok([`/${slot}/index.html`, `/${slot}/client.js`, `/${slot}/style.css`].includes(path));
      return route.fulfill({
        contentType: path.endsWith('.js')
          ? 'text/javascript'
          : path.endsWith('.css')
            ? 'text/css'
            : 'text/html',
        body: path.endsWith('.js')
          ? client
          : path.endsWith('.css')
            ? style
            : value.panes[slot]!.html,
      });
    });
    // Native menu selection makes compact-page panes visible; it never starts a process.
    send({ kind: 'layout-open', slot });
    await expect.poll(() => layout.visible.includes(slot)).toBe(true);
    await page.goto(`https://synthetic.orqst.invalid/${slot}/index.html`);
    pages.push(page);
    await expect(page.locator('#terminal .xterm')).toBeVisible();
    await page.locator('#start').click();
    await expect(page.locator('#status')).toHaveAttribute('data-state', 'running');
    await page.locator('#attach').click();
    await expect(page.locator('#terminal')).toContainText('SYNTHETIC:OWNED_TUI');
    assert.equal(await page.evaluate(() => Reflect.get(window, 'syntheticInjection')), undefined);
    const id = await page.locator('#status').getAttribute('data-instance-id');
    assert.ok(id && !ids.includes(id));
    ids.push(id);
  }
  const page = pages[0]!;
  send({ kind: 'layout-open', slot: 0 });
  await expect.poll(() => layout.visible.includes(0)).toBe(true);
  await layoutWork;
  await page.locator('#maximize').click();
  await expect(page.locator('#restore')).toBeVisible();
  await expect.poll(() => layout.visible).toEqual([0]);
  await page.locator('#restore').click();
  await expect(page.locator('#maximize')).toBeVisible();
  await page.locator('.layout-options summary').click();
  await page.locator('#pane-name').fill('<script>plain name</script>');
  await page.locator('#rename-pane button').click();
  await expect(page.locator('#pane-title')).toContainText('<script>plain name</script>');
  await page.locator('#move-later').click();
  await expect.poll(() => layout.order[1]).toBe(0);
  await expect(page.locator('.pane-tabs button').nth(1)).toHaveAttribute('data-tab', '0');
  await page.locator('#column-choice').selectOption('3');
  await expect.poll(() => layout.columns).toBe(3);
  await page.locator('.layout-options summary').click();
  await page.locator('#hide-pane').click();
  await expect.poll(() => layout.shown.includes(0)).toBe(false);
  send({ kind: 'layout-open', slot: 0 });
  await expect.poll(() => layout.visible.includes(0)).toBe(true);
  await layoutWork;
  assert.equal(await page.locator('#status').getAttribute('data-instance-id'), ids[0]);
  await expect(page.locator('#terminal')).toContainText('SYNTHETIC:OWNED_TUI');
  send({ kind: 'layout-resize', width: 600, height: 700 });
  await expect.poll(() => layout.visible).toEqual([0]);
  await layoutWork;
  await page.locator('#input').click();
  await expect(page.locator('main')).toHaveAttribute('data-next', 'typing');
  await page.keyboard.type('ping');
  await page.keyboard.press('Enter');
  await expect(page.locator('#terminal')).toContainText('SYNTHETIC:PONG');
  await page.keyboard.type('size');
  await page.keyboard.press('Enter');
  await expect(page.locator('#terminal')).toContainText('SYNTHETIC:SIZE:');
  const size = (await page.locator('#terminal').innerText()).match(/SYNTHETIC:SIZE:(\d+)x(\d+)/);
  assert.ok(size && Number(size[1]) > 0 && Number(size[2]) > 0);
  const resized = terminalNativeReplySchema.parse(
    await request({ version: 1, action: 'resize', instanceId: ids[0]!, columns: 91, rows: 31 }),
  );
  assert.equal(resized.status, 'ok');
  send({ kind: 'revoke', slot: 0 });
  const revoked = terminalNativeReplySchema.parse(
    await request({
      version: 1,
      action: 'write',
      instanceId: ids[0]!,
      sequence: 100,
      text: 'revoked',
    }),
  );
  assert.equal(revoked.status, 'denied');
  const second = pages[1]!;
  send({ kind: 'layout-open', slot: 1 });
  await expect.poll(() => layout.visible.includes(1)).toBe(true);
  await second.locator('#stop').click();
  await expect(second.locator('#status')).toHaveAttribute('data-state', 'exited');
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'running');
  for (const [slot, current] of pages.entries()) {
    if (slot === 1) continue;
    send({ kind: 'layout-open', slot });
    await expect.poll(() => layout.visible.includes(slot)).toBe(true);
    await current.locator('#stop').click();
    await expect(current.locator('#status')).toHaveAttribute('data-state', 'exited');
  }
  await layoutWork;
  assert.equal(layoutError, undefined);
  assert.deepEqual(errors, []);
  assert.ok(confirmations.length >= count * 2);
  child.stdin.end('shutdown\n');
  const [code, signal] = await exited;
  assert.equal(code, 0);
  assert.equal(signal, null);
  console.log(
    `PASS: packaged Node hosts + ${count} independent synthetic PTYs + retained Tauri xterm documents, layout/rename/reorder/hide/compact/maximize, signed start/attach/input/stop, output, resize and revocation outside checkout. Native IPC/focus/dialogs simulated; no real provider.`,
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
