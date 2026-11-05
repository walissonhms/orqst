import { syntheticCliAuthorization } from './terminal/synthetic-cli-authorization.js';
// Explicit disposable Electron integration. Native focus/dialog answers are doubles, not acceptance.
// Production pins stay unchanged; the test bundle accepts Node as a SYNTHETIC, never-run provider.
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron, expect, type ElectronApplication } from '@playwright/test';
import { build } from 'esbuild';
import { createBridge } from '../apps/bridge/src/app.js';
import { terminalExecutableSha256 } from '../packages/core/src/terminal/codex-profile.js';

assert.deepEqual(process.argv.slice(2), ['--authorize-synthetic-review']);
assert.match(process.version, /^v24\./);
assert.equal(process.platform, 'darwin');
assert.equal(process.arch, 'arm64');
process.umask(0o077);
const root = await realpath(await mkdtemp(join(tmpdir(), 'orqst-synthetic-terminal-selection-')));
let desktop: ElectronApplication | undefined;
const sessions = join(root, 'synthetic-sessions');
await mkdir(sessions, { mode: 0o700 });
const bridge = createBridge({
  port: 0,
  dataDir: join(root, 'synthetic-observer'),
  sessionsDir: sessions,
  dashboardDir: resolve('apps/dashboard/dist'),
  retentionDays: 30,
  pollMs: 500,
  dev: false,
});
try {
  const port = await bridge.start();
  const state = join(root, 'review'),
    project = join(root, 'project'),
    home = join(root, 'native-home');
  for (const path of [state, project, home, join(state, 'tmp')]) await mkdir(path, { mode: 0o700 });
  const syntheticCli = join(root, 'synthetic-opencode');
  await writeFile(syntheticCli, Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 7, 6, 5, 4]), { mode: 0o700 });
  const binary = { path: syntheticCli, sha256: terminalExecutableSha256(syntheticCli) };
  const nodePath = await realpath(process.execPath);
  const node = { path: nodePath, sha256: terminalExecutableSha256(nodePath) };
  const file = join(state, 'terminal.json');
  const bytes = JSON.stringify({
    version: 3,
    provider: 'opencode',
    trust: 'native-same-user',
    executable: binary,
    executableVersion: '2.2.5',
    node,
    project,
    state,
    authentication: {
      mode: 'reuse-existing',
      nativeIdentity: { HOME: home },
      sharedNativeConfiguration: true,
    },
    interactive: { sharedNativeSessions: true, nativeStartupAuthorized: false },
  });
  await writeFile(file, bytes, { mode: 0o600 });
  const profile = join(root, 'profile');
  await mkdir(join(profile, 'managed-agents'), { recursive: true, mode: 0o700 });
  const marker = join(profile, 'managed-agents/active-pair.json');
  const reservation = 'SYNTHETIC-PRESERVED-RESERVATION\n';
  await writeFile(marker, reservation, { mode: 0o600 });
  const output = join(root, 'desktop');
  await cp(resolve('apps/desktop/dist'), output, { recursive: true });
  await build({
    entryPoints: ['apps/desktop/src/main.ts'],
    outfile: join(output, 'main.cjs'),
    bundle: true,
    platform: 'node',
    target: 'node24',
    format: 'cjs',
    external: ['electron'],
    logLevel: 'silent',
    plugins: [syntheticCliAuthorization()],
  });
  const bootstrap = join(root, 'bootstrap.cjs');
  await writeFile(
    bootstrap,
    `require('electron').app.setPath('userData', ${JSON.stringify(profile)}); require(${JSON.stringify(join(output, 'main.cjs'))});`,
  );
  const require = createRequire(resolve('apps/desktop/package.json'));
  const launch = () =>
    _electron.launch({
      executablePath: require('electron') as string,
      args: [bootstrap],
      env: {
        HOME: root,
        TMPDIR: root,
        LANG: 'en_US.UTF-8',
        LC_ALL: 'en_US.UTF-8',
        ORQST_DESKTOP_PORT: String(port),
      },
      timeout: 30000,
    });
  desktop = await launch();
  const page = await desktop.firstWindow();
  await expect.poll(() => page.url()).toBe(`http://127.0.0.1:${port}/`);
  await desktop.evaluate(({ BrowserWindow, dialog }, file) => {
    const window = BrowserWindow.getAllWindows()[0]!;
    // Instrument only the disposable observer. Actual native focus remains unaccepted.
    window.isFocused = () => Boolean(Reflect.get(globalThis, 'syntheticFocus'));
    window.webContents.isFocused = window.isFocused;
    Reflect.set(globalThis, 'syntheticFocus', false);
    Reflect.set(globalThis, 'syntheticChooseCount', 0);
    Reflect.set(globalThis, 'syntheticConfirmCount', 0);
    Reflect.set(globalThis, 'syntheticFile', file);
    dialog.showOpenDialog = async (_target: unknown, options?: Electron.OpenDialogOptions) => {
      if (!options) throw new Error('Expected a parented synthetic chooser');
      if (!options.properties?.includes('noResolveAliases'))
        throw new Error('Alias resolution enabled');
      Reflect.set(
        globalThis,
        'syntheticChooseCount',
        Number(Reflect.get(globalThis, 'syntheticChooseCount')) + 1,
      );
      if (Reflect.get(globalThis, 'syntheticBlur')) window.emit('blur');
      return {
        canceled: Boolean(Reflect.get(globalThis, 'syntheticCancelChoose')),
        filePaths: [file],
      };
    };
    dialog.showMessageBox = async (_target: unknown, options?: Electron.MessageBoxOptions) => {
      if (!options) throw new Error('Expected a parented synthetic review');
      if (options.detail) {
        if (options.defaultId !== 0 || options.cancelId !== 0 || options.detail.length > 4096)
          throw new Error('Incomplete or unsafe synthetic review');
        const slot = JSON.parse(options.detail)[0];
        if (slot.file !== file || slot.blocker !== 'opencode_startup_required')
          throw new Error('Wrong synthetic review');
        Reflect.set(
          globalThis,
          'syntheticConfirmCount',
          Number(Reflect.get(globalThis, 'syntheticConfirmCount')) + 1,
        );
        if (Reflect.get(globalThis, 'syntheticNavigate'))
          window.webContents.emit('did-start-navigation');
      }
      return {
        response: Reflect.get(globalThis, 'syntheticAccept') ? 1 : 0,
        checkboxChecked: false,
      };
    };
  }, file);
  const select = async () => {
    await desktop!.evaluate(({ Menu }) =>
      Menu.getApplicationMenu()!.getMenuItemById('managed-terminal-select')!.click(),
    );
  };
  const enabled = () =>
    desktop!.evaluate(
      ({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('managed-terminal-open')!.enabled,
    );
  await select();
  assert.equal(await desktop.evaluate(() => Reflect.get(globalThis, 'syntheticChooseCount')), 0);
  await desktop.evaluate(() => {
    Reflect.set(globalThis, 'syntheticFocus', true);
    Reflect.set(globalThis, 'syntheticCancelChoose', true);
  });
  await select();
  await expect
    .poll(() => desktop!.evaluate(() => Reflect.get(globalThis, 'syntheticChooseCount')))
    .toBe(1);
  assert.equal(await enabled(), false);
  await desktop.evaluate(() => {
    Reflect.set(globalThis, 'syntheticCancelChoose', false);
  });
  await select();
  await expect
    .poll(() => desktop!.evaluate(() => Reflect.get(globalThis, 'syntheticConfirmCount')))
    .toBe(1);
  assert.equal(await enabled(), false); // Cancel-default review.
  await desktop.evaluate(() => {
    Reflect.set(globalThis, 'syntheticAccept', true);
    Reflect.set(globalThis, 'syntheticNavigate', true);
  });
  await select();
  await expect
    .poll(() => desktop!.evaluate(() => Reflect.get(globalThis, 'syntheticConfirmCount')))
    .toBe(2);
  assert.equal(await enabled(), false);
  await desktop.evaluate(() => {
    Reflect.set(globalThis, 'syntheticNavigate', false);
    Reflect.set(globalThis, 'syntheticBlur', true);
  });
  await select();
  await expect
    .poll(() => desktop!.evaluate(() => Reflect.get(globalThis, 'syntheticChooseCount')))
    .toBe(4);
  assert.equal(await enabled(), false);
  await desktop.evaluate(() => {
    Reflect.set(globalThis, 'syntheticBlur', false);
  });
  await select();
  await expect.poll(enabled).toBe(true);
  assert.deepEqual((await readdir(state)).sort(), ['terminal.json', 'tmp']);
  assert.equal(await readFile(marker, 'utf8'), reservation);
  assert.equal(
    await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length),
    1,
  );
  await writeFile(file, bytes + '\n');
  await desktop.evaluate(({ Menu }) =>
    Menu.getApplicationMenu()!.getMenuItemById('managed-terminal-open')!.click(),
  );
  await expect
    .poll(() =>
      desktop!.evaluate(
        ({ Menu }) =>
          Menu.getApplicationMenu()!.getMenuItemById('managed-terminal-select')!.enabled,
      ),
    )
    .toBe(true);
  assert.equal(
    await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length),
    1,
  );
  await select(); // Explicit re-review after drift, still no Core.
  await expect
    .poll(() => desktop!.evaluate(() => Reflect.get(globalThis, 'syntheticConfirmCount')))
    .toBe(4);
  const nextView = desktop.context().waitForEvent('page');
  await desktop.evaluate(({ Menu }) =>
    Menu.getApplicationMenu()!.getMenuItemById('managed-terminal-open')!.click(),
  );
  const terminal = await nextView;
  await expect(terminal.locator('#status')).toHaveAttribute('data-blocked', 'true');
  await expect(terminal.locator('#start')).toBeDisabled();
  await expect(terminal.locator('#login')).toBeDisabled();
  assert.equal(
    await desktop.evaluate(
      ({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('managed-terminal-select')!.enabled,
    ),
    false,
  );
  assert.deepEqual((await readdir(state)).sort(), ['terminal.json', 'tmp']);
  assert.equal(await readFile(marker, 'utf8'), reservation);
  assert.equal(await readFile(file, 'utf8'), bytes + '\n');
  await expect
    .poll(() =>
      desktop!.evaluate(
        ({ Menu }) =>
          Menu.getApplicationMenu()!.getMenuItemById('managed-terminal-dashboard')!.enabled,
      ),
    )
    .toBe(true);
  // A separate disposable app lifetime exercises partial pair initialization in the same domain.
  await desktop.close();
  desktop = undefined;
  const secondState = join(root, 'review-b');
  await mkdir(secondState, { mode: 0o700 });
  await mkdir(join(secondState, 'tmp'), { mode: 0o700 });
  const secondFile = join(secondState, 'terminal.json');
  await writeFile(secondFile, JSON.stringify({ ...JSON.parse(bytes), state: secondState }), {
    mode: 0o600,
  });
  desktop = await launch();
  const observer = await desktop.firstWindow();
  await expect.poll(() => observer.url()).toBe(`http://127.0.0.1:${port}/`);
  await desktop.evaluate(
    ({ BrowserWindow, webContents, dialog }, files) => {
      const window = BrowserWindow.getAllWindows()[0]!;
      window.isFocused = () => true;
      window.webContents.isFocused = () => true;
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: files });
      dialog.showMessageBox = async (_target: unknown, options?: Electron.MessageBoxOptions) => {
        if (!options) throw new Error('Expected parented synthetic dialog');
        if (options.detail) return { response: 1, checkboxChecked: false };
        Reflect.set(globalThis, 'syntheticInitializationDenied', true);
        return { response: 0, checkboxChecked: false };
      };
      const prototype = Object.getPrototypeOf(
        webContents.getAllWebContents()[0]!,
      ) as Electron.WebContents;
      const original = prototype.loadURL;
      let terminalLoads = 0;
      Reflect.set(
        prototype,
        'loadURL',
        function (this: Electron.WebContents, url: string, options?: Electron.LoadURLOptions) {
          if (url === 'orqst-terminal://local/index.html') {
            terminalLoads++;
            if (terminalLoads === 1)
              Reflect.set(globalThis, 'syntheticOldTerminalSession', this.session);
            if (terminalLoads === 2)
              return Promise.reject(new Error('SYNTHETIC second pane failure'));
          }
          return original.call(this, url, options);
        },
      );
    },
    [file, secondFile],
  );
  await select();
  await expect.poll(enabled).toBe(true);
  await desktop.evaluate(({ Menu }) =>
    Menu.getApplicationMenu()!.getMenuItemById('managed-terminal-open')!.click(),
  );
  await expect
    .poll(() => desktop!.evaluate(() => Reflect.get(globalThis, 'syntheticInitializationDenied')))
    .toBe(true);
  assert.equal(
    await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length),
    1,
  );
  assert.equal(
    await desktop.evaluate(
      ({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('managed-terminal-select')!.enabled,
    ),
    true, // Proven blocked-view failure: no admission/Core was entered and cleanup completed.
  );
  assert.equal(await enabled(), false);
  assert.equal(
    await desktop.evaluate(async () =>
      (
        Reflect.get(globalThis, 'syntheticOldTerminalSession') as Electron.Session
      ).protocol.isProtocolHandled('orqst-terminal'),
    ),
    false,
  );
  for (const directory of [state, secondState])
    assert.deepEqual((await readdir(directory)).sort(), ['terminal.json', 'tmp']);
  assert.equal(await readFile(marker, 'utf8'), reservation);
  await select(); // Retry requires a new complete native review; retained files/marker are unchanged.
  await expect.poll(enabled).toBe(true);
  const retriedView = desktop.context().waitForEvent('page');
  await desktop.evaluate(({ Menu }) =>
    Menu.getApplicationMenu()!.getMenuItemById('managed-terminal-open')!.click(),
  );
  const retried = await retriedView;
  await expect(retried.locator('#status')).toHaveAttribute('data-blocked', 'true');
  await expect(retried.locator('#start')).toBeDisabled();
  assert.equal(
    await desktop.evaluate(({ webContents }) =>
      webContents
        .getAllWebContents()
        .filter((contents) => contents.getURL() === 'orqst-terminal://local/index.html')
        .every(
          (contents) => contents.session !== Reflect.get(globalThis, 'syntheticOldTerminalSession'),
        ),
    ),
    true,
  );
  assert.equal(
    await desktop.evaluate(({ webContents }) =>
      webContents
        .getAllWebContents()
        .filter((contents) => contents.getURL() === 'orqst-terminal://local/index.html')
        .every((contents) => contents.session.storagePath === null),
    ),
    true,
  );
  await expect
    .poll(() =>
      desktop!.evaluate(
        ({ Menu }) =>
          Menu.getApplicationMenu()!.getMenuItemById('managed-terminal-dashboard')!.enabled,
      ),
    )
    .toBe(true);
  assert.equal(await readFile(marker, 'utf8'), reservation);
  console.log(
    JSON.stringify({
      result: 'passed',
      scope: 'synthetic-native-menu-review-blocked-view-and-partial-initialization',
      providerExecution: 'NOT RUN',
      nativeFocusAndDialogs: 'INTERCEPTED',
    }),
  );
} finally {
  await desktop?.close();
  await bridge.stop();
  await rm(root, { recursive: true, force: true });
}
