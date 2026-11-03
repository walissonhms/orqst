// Explicit real Desktop acceptance with a compiled, disposable fake Codex. Never a real provider.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { _electron, expect, type ElectronApplication } from '@playwright/test';
import type { DesktopTerminal } from '@orqst/protocol';
import { createBridge } from '../apps/bridge/src/app.js';

assert.deepEqual(process.argv.slice(2), ['--authorize-synthetic-pty']);
assert.match(process.version, /^v24\./);
assert.equal(process.platform, 'darwin');
assert.equal(process.arch, 'arm64');
process.umask(0o077);
const root = await realpath(await mkdtemp(join(tmpdir(), 'orqst-managed-acceptance-')));
const run = promisify(execFile);
let desktop: ElectronApplication | undefined;
const sessions = join(root, 'synthetic-sessions');
const project = join(root, 'synthetic-project');
await mkdir(sessions);
await mkdir(project);
const bridge = createBridge({
  port: 0,
  dataDir: join(root, 'observer-data'),
  sessionsDir: sessions,
  dashboardDir: resolve('apps/dashboard/dist'),
  retentionDays: 30,
  pollMs: 500,
  dev: false,
});
try {
  const fake = join(root, 'synthetic-codex');
  await run('/usr/bin/cc', [resolve('tests/helpers/managed-terminal-fixture.c'), '-o', fake]);
  await chmod(fake, 0o700);
  const state = join(root, 'managed');
  await run(process.execPath, [
    '--import',
    'tsx',
    resolve('scripts/setup-managed-terminal.ts'),
    '--authentication',
    'separate-login',
    '--executable',
    fake,
    '--executable-version',
    'SYNTHETIC-NOT-CODEX',
    '--project',
    project,
    '--state',
    state,
  ]);
  const file = join(state, 'terminal.json');
  const port = await bridge.start();
  const bootstrap = join(root, 'bootstrap.cjs');
  await writeFile(
    bootstrap,
    `require('electron').app.setPath('userData', ${JSON.stringify(join(root, 'electron-profile'))}); require(${JSON.stringify(resolve('apps/desktop/dist/main.cjs'))});`,
  );
  const require = createRequire(resolve('apps/desktop/package.json'));
  desktop = await _electron.launch({
    executablePath: require('electron') as string,
    args: [bootstrap, `--terminal-config=${file}`],
    env: {
      HOME: root,
      TMPDIR: root,
      LANG: 'en_US.UTF-8',
      LC_ALL: 'en_US.UTF-8',
      ORQST_DESKTOP_PORT: String(port),
      OPENAI_API_KEY: 'SYNTHETIC-MUST-NOT-REACH-CHILD',
      NODE_OPTIONS: '',
      SSH_AUTH_SOCK: '/synthetic-not-a-socket',
    },
    timeout: 30000,
  });
  await expect
    .poll(() =>
      desktop!.windows().some((page) => page.url().startsWith(`http://127.0.0.1:${port}/`)),
    )
    .toBe(true);
  const observer = desktop
    .windows()
    .find((page) => page.url().startsWith(`http://127.0.0.1:${port}/`))!;
  assert.equal(
    await observer.evaluate(() => typeof Reflect.get(window, 'orqstTerminal')),
    'undefined',
  );
  await desktop.evaluate(({ Menu }) =>
    Menu.getApplicationMenu()!.getMenuItemById('managed-terminal-open')!.click(),
  );
  const terminal = desktop
    .windows()
    .find((page) => page.url() === 'orqst-terminal://local/index.html')!;
  await expect(terminal.locator('#terminal .xterm')).toBeVisible();
  await desktop.evaluate(({ dialog }) => {
    dialog.showMessageBoxSync = () => 1;
    Reflect.set(globalThis, 'syntheticConfirm', false);
    Reflect.set(globalThis, 'syntheticConfirmDetails', []);
    dialog.showMessageBox = async (
      _window: Electron.BaseWindow | Electron.MessageBoxOptions,
      options?: Electron.MessageBoxOptions,
    ) => {
      (Reflect.get(globalThis, 'syntheticConfirmDetails') as string[]).push(options!.detail!);
      return {
        response: Reflect.get(globalThis, 'syntheticConfirm') ? 1 : 0,
        checkboxChecked: false,
      };
    };
  });
  await terminal.locator('#login').click();
  await expect(terminal.locator('#status')).toContainText(/cancelled|cancelada/);
  await desktop.evaluate(() => Reflect.set(globalThis, 'syntheticConfirm', true));
  await terminal.locator('#start').click();
  await expect(terminal.locator('#status')).toContainText(/Denied|Negado/);
  await terminal.locator('#login').click();
  await expect(terminal.locator('#status')).toHaveAttribute('data-state', 'exited');
  await terminal.locator('#attach').click();
  await expect(terminal.locator('#terminal')).toContainText('SYNTHETIC:LOGIN_ONLY');
  const auth = await readFile(join(state, 'codex/auth.json'), 'utf8');
  assert.equal(auth, '{"synthetic":true}');
  await terminal.locator('#start').click();
  await expect(terminal.locator('#status')).toHaveAttribute('data-state', 'running');
  await terminal.locator('#attach').click();
  await expect(terminal.locator('#terminal')).toContainText('SYNTHETIC:OWNED_TUI');
  await terminal.locator('#input').click();
  await terminal.locator('.xterm-helper-textarea').pressSequentially('ping', { delay: 50 });
  await terminal.locator('.xterm-helper-textarea').press('Enter');
  await expect(terminal.locator('#terminal')).toContainText('SYNTHETIC:PONG');
  await desktop.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().startsWith('orqst-terminal:'))!
      .setSize(960, 720),
  );
  await terminal.locator('.xterm-helper-textarea').pressSequentially('size', { delay: 50 });
  await terminal.locator('.xterm-helper-textarea').press('Enter');
  await expect(terminal.locator('#terminal')).toContainText(/SYNTHETIC:SIZE:\d+x\d+/);
  await expect(terminal.locator('#terminal')).not.toContainText('SYNTHETIC:SIZE:80x24');
  await terminal.locator('.xterm-helper-textarea').press('Control+c');
  await expect(terminal.locator('#terminal')).toContainText('SYNTHETIC:CTRL_C_BYTES');
  await expect(terminal.locator('#terminal')).not.toContainText('SYNTHETIC:UNEXPECTED_AUTO_REPLY');
  assert.match(await terminal.title(), /Managed Terminal|Terminal gerenciado/);
  assert.equal(await terminal.evaluate(() => Reflect.get(window, 'syntheticInjection')), undefined);
  assert.equal(await terminal.evaluate(() => typeof Reflect.get(window, 'require')), 'undefined');
  assert.equal(
    await terminal.evaluate(() =>
      fetch('http://127.0.0.1:4317/').then(
        () => true,
        () => false,
      ),
    ),
    false,
  );
  await terminal.evaluate(() => window.open('https://example.invalid/'));
  assert.equal(desktop.windows().length, 2);
  await desktop.evaluate(({ BrowserWindow }) => {
    const current = BrowserWindow.getAllWindows().find((window) =>
      window.webContents.getURL().startsWith('orqst-terminal:'),
    )!;
    current.emit('blur');
    current.focus();
  });
  await terminal.locator('.xterm-helper-textarea').pressSequentially('ping', { delay: 30 });
  await terminal.locator('#input').click();
  await expect(terminal.locator('.xterm-helper-textarea')).toBeFocused();
  const pasted = await terminal.evaluate(async () => {
    const client = (window as unknown as { orqstTerminal: DesktopTerminal }).orqstTerminal;
    return client.request({
      version: 1,
      action: 'paste',
      instanceId: document.getElementById('status')!.dataset.instanceId!,
      sequence: 0,
      text: 'ping\r',
    });
  });
  assert.equal(pasted.status, 'ok');
  await desktop.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().startsWith('orqst-terminal:'))!
      .close(),
  );
  assert.equal(
    await desktop.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL().startsWith('orqst-terminal:'))!
        .isVisible(),
    ),
    false,
  );
  await desktop.evaluate(({ Menu }) =>
    Menu.getApplicationMenu()!.getMenuItemById('managed-terminal-open')!.click(),
  );
  await expect(terminal.locator('#status')).toHaveAttribute('data-state', 'running');
  await terminal.locator('#input').click();
  await terminal.locator('.xterm-helper-textarea').pressSequentially('flood', { delay: 50 });
  await terminal.locator('.xterm-helper-textarea').press('Enter');
  await expect(terminal.locator('#status')).toContainText(
    /Output was evicted|saída foi descartada/,
  );
  await desktop.evaluate(({ app, BrowserWindow }) => {
    app.focus({ steal: true });
    const w = BrowserWindow.getAllWindows().find((w) =>
      w.webContents.getURL().startsWith('orqst-terminal:'),
    )!;
    w.show();
    w.focus();
    w.webContents.focus();
  });
  await expect(terminal.locator('#status')).toHaveAttribute('data-pending', 'false');
  await terminal.locator('#stop').click();
  await expect(terminal.locator('#status')).toHaveAttribute('data-state', 'exited');
  await terminal.reload();
  await terminal.locator('#login').click();
  await expect(terminal.locator('#status')).toContainText(/Denied|Negado/);
  const details = await desktop.evaluate(
    () => Reflect.get(globalThis, 'syntheticConfirmDetails') as string[],
  );
  assert.ok(details.some((value) => value.includes('codex-login-v1')));
  assert.ok(details.some((value) => JSON.parse(value).paste === 'ping\r'));
  assert.ok(
    details.some(
      (value) => value.includes('native-same-user') || value.includes('Native same-user'),
    ),
  );
  assert.equal(
    details.some((value) => /privateKey|signature|leaseId/.test(value)),
    false,
  );
  console.log(
    JSON.stringify({
      result: 'passed',
      scope: 'embedded-managed-terminal-real-electron-node-pty-synthetic-provider',
      checks: [
        'separate-login',
        'native-cancel',
        'auth-missing-denied',
        'fixed-profile',
        'interactive-keyboard',
        'ctrl-c-bytes',
        'pty-resize',
        'exact-native-paste',
        'hide-reopen-keeps-owned-process',
        'replay-gap-disables-screen-input',
        'reload-revokes-core-channel',
        'os-exit',
        'untrusted-output',
        'no-emulator-auto-input',
        'isolated-network-preload',
      ],
      providerAcceptance: 'NOT RUN; no real provider, credentials or sessions',
    }),
  );
} finally {
  await desktop?.close();
  await bridge.stop();
  await rm(root, { recursive: true, force: true });
}
