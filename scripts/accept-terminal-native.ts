// Explicit real Electron + Node-host acceptance. Never part of runtime/build/test/CI.
import assert from 'node:assert/strict';
import { chmod, copyFile, cp, mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { build } from 'esbuild';
import { _electron, expect, type ElectronApplication } from '@playwright/test';
import { requireSyntheticAuthorization } from './terminal/probe.js';
import type { DesktopTerminal } from '@orqst/protocol';

requireSyntheticAuthorization(process.argv.slice(2));
assert.match(process.version, /^v24\./);
assert.equal(process.platform, 'darwin');
assert.equal(process.arch, 'arm64');
assert.notEqual(process.getuid?.(), 0);
process.umask(0o077);
const root = await realpath(await mkdtemp(join(tmpdir(), 'orqst-native-terminal-')));
const node = await realpath(process.execPath);
let desktop: ElectronApplication | undefined;
try {
  const require = createRequire(import.meta.url);
  const dependency = dirname(require.resolve('node-pty/package.json'));
  const manifest = JSON.parse(await readFile(join(dependency, 'package.json'), 'utf8')) as {
    version: string;
    license: string;
  };
  assert.equal(manifest.version, '1.1.0');
  assert.equal(manifest.license, 'MIT');
  const staged = join(root, 'node-pty');
  const native = join(staged, 'prebuilds/darwin-arm64');
  await mkdir(native, { recursive: true, mode: 0o700 });
  await cp(join(dependency, 'lib'), join(staged, 'lib'), { recursive: true });
  for (const file of ['package.json', 'LICENSE'])
    await copyFile(join(dependency, file), join(staged, file));
  for (const file of ['pty.node', 'spawn-helper'])
    await copyFile(join(dependency, 'prebuilds/darwin-arm64', file), join(native, file));
  await chmod(join(native, 'spawn-helper'), 0o700);
  await copyFile(resolve('scripts/terminal/fixture.mjs'), join(root, 'synthetic-fixture.mjs'));
  for (const [entry, outfile, platform] of [
    ['apps/desktop/src/terminal-lab.ts', 'main.cjs', 'node'],
    ['scripts/terminal/native-host.ts', 'host.cjs', 'node'],
    ['apps/desktop/src/terminal-preload.ts', 'preload.cjs', 'node'],
    ['scripts/terminal/native-client.ts', 'client.js', 'browser'],
  ] as const) {
    await build({
      entryPoints: [entry],
      outfile: join(root, outfile),
      bundle: true,
      platform,
      target: platform === 'node' ? 'node24' : 'chrome156',
      format: platform === 'node' ? 'cjs' : 'iife',
      external: ['electron'],
      define: { __SYNTHETIC_NODE__: JSON.stringify(node) },
    });
  }
  const desktopRequire = createRequire(resolve('apps/desktop/package.json'));
  // No inherited provider/auth/PATH/loader environment reaches Electron or its Node host.
  desktop = await _electron.launch({
    executablePath: desktopRequire('electron') as string,
    args: [join(root, 'main.cjs'), '--authorize-synthetic-pty'],
    env: { HOME: root, TMPDIR: root, LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' },
    timeout: 30000,
  });
  const page = await desktop.firstWindow();
  await expect(page).toHaveURL('orqst-terminal://local/index.html');
  await expect(page.locator('h1')).toContainText(/Synthetic|sintético/);
  assert.equal(await page.evaluate(() => typeof Reflect.get(window, 'require')), 'undefined');
  assert.equal(
    await page.evaluate(() => typeof Reflect.get(window, 'orqstArtifacts')),
    'undefined',
  );
  assert.equal(
    await page.evaluate(() => typeof Reflect.get(window, 'orqstAnalytics')),
    'undefined',
  );
  assert.equal(await page.evaluate(() => Notification.requestPermission()), 'denied');
  assert.equal(
    await page.evaluate(() =>
      fetch('http://127.0.0.1:4317/').then(
        () => true,
        () => false,
      ),
    ),
    false,
  );
  await page.evaluate(() => window.open('https://example.invalid/'));
  assert.equal(desktop.windows().length, 1);
  // Intercept the native dialog only: this checks real IPC/document/focus/runtime, not a human gesture.
  await desktop.evaluate(({ dialog }) => {
    Reflect.set(globalThis, 'syntheticConfirm', false);
    Reflect.set(globalThis, 'syntheticDetails', []);
    dialog.showMessageBox = async (
      _window: Electron.BaseWindow | Electron.MessageBoxOptions,
      options?: Electron.MessageBoxOptions,
    ) => {
      (Reflect.get(globalThis, 'syntheticDetails') as string[]).push(options!.detail!);
      return {
        response: Reflect.get(globalThis, 'syntheticConfirm') ? 1 : 0,
        checkboxChecked: false,
      };
    };
  });
  await page.locator('#start').click();
  await expect(page.locator('#status')).toContainText(/cancelled|cancelada/);
  await desktop.evaluate(() => Reflect.set(globalThis, 'syntheticConfirm', true));
  await page.locator('#start').click();
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'starting');
  // Owner readiness comes from fixed-fixture instrumentation in Node, never provider prose.
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const instanceId = document.querySelector<HTMLElement>('#status')!.dataset.instanceId!;
        const client = (window as unknown as { orqstTerminal: DesktopTerminal }).orqstTerminal;
        const reply = await client.request({ version: 1, action: 'snapshot', instanceId });
        return reply.status === 'ok' ? reply.snapshot?.state : reply.status;
      }),
    )
    .toBe('running');
  await page.locator('#attach').click();
  await expect(page.locator('#output')).toContainText('SYNTHETIC:READY:80x24');
  await page.locator('#input').click();
  await expect(page.locator('#status')).toContainText(/processed|processada/);
  await page.locator('#paste').fill('ping\n');
  await page.locator('#send').click();
  await expect(page.locator('#output')).toContainText('SYNTHETIC:PONG');
  const details = await desktop.evaluate(
    () => Reflect.get(globalThis, 'syntheticDetails') as string[],
  );
  assert.equal(details.length, 5); // cancel start, start, attach, input, exact paste
  assert.equal(JSON.parse(details[4]!).paste, 'ping\n');
  assert.equal(
    details.some((value) => /signature|privateKey|challengeId|leaseId/.test(value)),
    false,
  );
  await desktop.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]!;
    window.emit('blur');
    window.focus();
  });
  await page.locator('#send').click();
  await expect(page.locator('#status')).toContainText(/denied|negada/);
  await page.locator('#input').click();
  await page.locator('#stop').click();
  await page.waitForTimeout(100);
  await page.locator('#detach').click();
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'exited');
  const firstId = await page.locator('#status').getAttribute('data-instance-id');
  await page.locator('#start').click();
  await expect(page.locator('#status')).not.toHaveAttribute('data-instance-id', firstId!);
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const instanceId = document.querySelector<HTMLElement>('#status')!.dataset.instanceId!;
        const client = (window as unknown as { orqstTerminal: DesktopTerminal }).orqstTerminal;
        const reply = await client.request({ version: 1, action: 'snapshot', instanceId });
        return reply.status === 'ok' ? reply.snapshot?.state : reply.status;
      }),
    )
    .toBe('running');
  await page.locator('#attach').click();
  await expect(page.locator('#output')).toContainText('SYNTHETIC:READY:80x24');
  await expect(page.locator('#output')).not.toContainText('SYNTHETIC:PONG');
  await page.locator('#stop').click();
  await page.waitForTimeout(100);
  await page.locator('#detach').click();
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'exited');
  await page.reload();
  await page.locator('#start').click();
  await expect(page.locator('#status')).toContainText(/denied|negada/);
  const versions = await desktop.evaluate(() => ({
    electron: process.versions.electron,
    node: process.versions.node,
    arch: process.arch,
  }));
  console.log(
    JSON.stringify({
      result: 'passed',
      scope: 'synthetic-native-terminal-ipc-node-host-pty',
      versions,
      checks: [
        'isolated-preload-session-network',
        'native-cancel',
        'signed-start-node-host',
        'attach-read',
        'leased-exact-paste',
        'blur-revokes-input',
        'stop-confirmed-exit',
        'reload-permanent-revocation',
        'fresh-instance-output-reset',
      ],
      nativeConfirmation: 'intercepted; real human/modal/layout/accessibility acceptance pending',
      providers: 'Codex not enabled or executed; Claude/OpenCode unvalidated',
    }),
  );
} finally {
  await desktop?.close();
  // Fixture has an independent 8s lifetime; cleanup never searches/kills unrelated processes.
  await rm(root, { recursive: true, force: true });
}
