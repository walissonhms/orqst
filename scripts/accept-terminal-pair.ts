// Explicit two-window Desktop acceptance. Only a compiled synthetic CLI and disposable state.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { _electron, expect, type ElectronApplication } from '@playwright/test';
import type { DesktopTerminal } from '@orqst/protocol';
import { createBridge } from '../apps/bridge/src/app.js';
import {
  managedCodexSettings,
  type ManagedCodexConfig,
} from '../packages/core/src/terminal/codex-profile.js';
import { readLifecycleReceipt } from '../packages/core/src/managed-codex/lifecycle-receipt.js';

assert.deepEqual(process.argv.slice(2), ['--authorize-synthetic-pty']);
assert.match(process.version, /^v24\./);
assert.equal(process.platform, 'darwin');
assert.equal(process.arch, 'arm64');
process.umask(0o077);
const root = await realpath(await mkdtemp(join(tmpdir(), 'orqst-terminal-pair-')));
const run = promisify(execFile);
const project = join(root, 'synthetic-project');
const sessions = join(root, 'synthetic-sessions');
await mkdir(project);
await mkdir(sessions);
const bridge = createBridge({
  port: 0,
  dataDir: join(root, 'observer'),
  sessionsDir: sessions,
  dashboardDir: resolve('apps/dashboard/dist'),
  retentionDays: 30,
  pollMs: 500,
  dev: false,
});
let desktop: ElectronApplication | undefined;
try {
  const fake = join(root, 'synthetic-native-cli');
  await run('/usr/bin/cc', [resolve('tests/helpers/managed-terminal-fixture.c'), '-o', fake]);
  await chmod(fake, 0o700);
  const states = [join(root, 'slot-a'), join(root, 'slot-b')];
  for (const state of states) {
    await run(process.execPath, [
      '--import',
      'tsx',
      resolve('scripts/setup-managed-terminal.ts'),
      '--authentication',
      'separate-login',
      '--executable',
      fake,
      '--executable-version',
      'SYNTHETIC-NOT-A-PROVIDER',
      '--project',
      project,
      '--state',
      state,
    ]);
    await writeFile(join(state, 'codex/auth.json'), '{"synthetic":true}', { mode: 0o600 });
  }
  const profile = join(root, 'electron-profile');
  const bootstrap = join(root, 'bootstrap.cjs');
  await writeFile(
    bootstrap,
    `require('electron').app.setPath('userData', ${JSON.stringify(profile)}); require(${JSON.stringify(resolve('apps/desktop/dist/main.cjs'))});`,
  );
  const port = await bridge.start();
  const require = createRequire(resolve('apps/desktop/package.json'));
  const launch = (selected: string[]) =>
    _electron.launch({
      executablePath: require('electron') as string,
      args: [bootstrap, ...selected.map((file) => `--terminal-config=${file}`)],
      env: {
        HOME: root,
        TMPDIR: root,
        LANG: 'en_US.UTF-8',
        LC_ALL: 'en_US.UTF-8',
        ORQST_DESKTOP_PORT: String(port),
        NODE_OPTIONS: '',
        OPENAI_API_KEY: 'SYNTHETIC-NOT-FORWARDED',
      },
      timeout: 30000,
    });
  desktop = await launch(states.map((state) => join(state, 'terminal.json')));
  await expect.poll(() => desktop!.windows().length).toBe(3);
  await desktop.evaluate(({ dialog }) => {
    Reflect.set(globalThis, 'syntheticConfirmCount', 0);
    dialog.showMessageBox = async () => {
      Reflect.set(
        globalThis,
        'syntheticConfirmCount',
        Number(Reflect.get(globalThis, 'syntheticConfirmCount')) + 1,
      );
      return { response: 1, checkboxChecked: false };
    };
    dialog.showMessageBoxSync = () => 1;
  });
  const focus = async (slot: number) => {
    await desktop!.evaluate(({ app, Menu, BrowserWindow }, index) => {
      app.show();
      app.focus({ steal: true });
      Menu.getApplicationMenu()!
        .getMenuItemById(index === 0 ? 'managed-terminal-open' : 'managed-terminal-b-open')!
        .click();
      const w = BrowserWindow.getAllWindows().find((w) =>
        w.getTitle().includes(index === 0 ? 'T-001' : 'T-002'),
      )!;
      w.show();
      w.focus();
      w.webContents.focus();
    }, slot);
    await expect
      .poll(() =>
        desktop!.evaluate(({ BrowserWindow }, index) => {
          const w = BrowserWindow.getAllWindows().find((w) =>
            w.getTitle().includes(index === 0 ? 'T-001' : 'T-002'),
          );
          return !!w && w.isFocused() && w.webContents.isFocused();
        }, slot),
      )
      .toBe(true)
      .catch(async (error) => {
        console.error(
          JSON.stringify({
            stage: 'synthetic-focus',
            slot,
            native: await desktop!.evaluate(({ app, BrowserWindow }) => ({
              hidden: app.isHidden(),
              windows: BrowserWindow.getAllWindows().map((w) => ({
                title: w.getTitle(),
                visible: w.isVisible(),
                focused: w.isFocused(),
                contentsFocused: w.webContents.isFocused(),
                focusable: w.isFocusable(),
              })),
            })),
          }),
        );
        throw error;
      });
  };
  const pages = desktop
    .windows()
    .filter((page) => page.url() === 'orqst-terminal://local/index.html');
  // Select by native trusted header, never by provider output.
  const indexed = await Promise.all(
    pages.map(async (page) => ({ page, header: await page.locator('h1').innerText() })),
  );
  const terminals = ['T-001', 'T-002'].map(
    (id) => indexed.find((entry) => entry.header.includes(id))!.page,
  );
  for (const [slot, page] of terminals.entries()) {
    await focus(slot);
    await expect(page.locator('#terminal .xterm')).toBeVisible();
    await page.locator('#start').click();
    try {
      await expect(page.locator('#status')).toHaveAttribute('data-state', 'running');
    } catch (error) {
      console.error(
        JSON.stringify({
          stage: 'synthetic-start',
          slot,
          native: await desktop.evaluate(({ BrowserWindow }) => ({
            confirmations: Reflect.get(globalThis, 'syntheticConfirmCount'),
            windows: BrowserWindow.getAllWindows().map((w) => ({
              title: w.getTitle(),
              focused: w.isFocused(),
              contentsFocused: w.webContents.isFocused(),
            })),
          })),
        }),
      );
      throw error;
    }
    await page.locator('#attach').click();
    await expect(page.locator('#terminal')).toContainText('SYNTHETIC:OWNED_TUI');
    await page.locator('#input').click();
    await page.locator('.xterm-helper-textarea').pressSequentially('ping', { delay: 20 });
    await page.locator('.xterm-helper-textarea').press('Enter');
    await expect(page.locator('#terminal')).toContainText('SYNTHETIC:PONG');
    await expect(page.locator('#terminal')).not.toContainText('SYNTHETIC:UNEXPECTED_AUTO_REPLY');
  }
  const ids = await Promise.all(terminals.map((page) => page.locator('#instance').innerText()));
  assert.notEqual(ids[0], ids[1]);
  const cross = await terminals[0]!.evaluate(
    async (id) =>
      (window as unknown as { orqstTerminal: DesktopTerminal }).orqstTerminal.request({
        version: 1,
        action: 'snapshot',
        instanceId: id,
      }),
    ids[1]!,
  );
  assert.equal(cross.status, 'denied');
  const marker = join(profile, 'managed-agents/active-pair.json');
  const originalMarker = await readFile(marker, 'utf8');
  for (const [slot, page] of terminals.entries()) {
    await focus(slot);
    await page.locator('#stop').click();
    await expect(page.locator('#status')).toHaveAttribute('data-state', 'exited');
    assert.equal(await readFile(marker, 'utf8'), originalMarker);
  }
  await focus(1);
  await desktop.evaluate(({ Menu }) =>
    Menu.getApplicationMenu()!.getMenuItemById('managed-terminal-retire')!.click(),
  );
  await expect
    .poll(async () => (await readdir(join(profile, 'managed-agents'))).includes('active-pair.json'))
    .toBe(false);
  for (const state of states) {
    const receipts = (await readdir(state)).filter((name) => name.startsWith('lifecycle-'));
    assert.equal(receipts.length, 1);
    const header = JSON.parse((await readFile(join(state, receipts[0]!), 'utf8')).split('\n')[0]!);
    assert.equal(readLifecycleReceipt(state, header.binding).status, 'recorded_exit');
  }
  await desktop.close();
  desktop = undefined;
  const preserved = JSON.stringify({ version: 1, owner: 'SYNTHETIC-OLD-RESERVATION' }) + '\n';
  await writeFile(marker, preserved, { flag: 'wx', mode: 0o600 });
  const nativeHome = join(root, 'synthetic-native-home');
  await mkdir(nativeHome, { mode: 0o700 });
  const blockedFiles: string[] = [];
  for (const [slot, previous] of states.entries()) {
    const state = join(root, `blocked-${slot}`);
    await mkdir(state, { mode: 0o700 });
    for (const name of ['home', 'codex', 'tmp']) await mkdir(join(state, name), { mode: 0o700 });
    const original: ManagedCodexConfig = JSON.parse(
      await readFile(join(previous, 'terminal.json'), 'utf8'),
    );
    const config: ManagedCodexConfig = {
      ...original,
      state,
      authentication: {
        mode: 'reuse-existing',
        home: root,
        codexHome: nativeHome,
        sharedNativeConfiguration: true,
      },
    };
    await writeFile(join(state, 'codex/config.toml'), managedCodexSettings(config), {
      mode: 0o600,
    });
    const file = join(state, 'terminal.json');
    await writeFile(file, JSON.stringify(config), { mode: 0o600 });
    blockedFiles.push(file);
  }
  desktop = await launch(blockedFiles);
  await expect.poll(() => desktop!.windows().length).toBe(3);
  for (const page of desktop
    .windows()
    .filter((page) => page.url() === 'orqst-terminal://local/index.html')) {
    await expect(page.locator('#status')).toHaveAttribute('data-blocked', 'true');
    await expect(page.locator('#status')).toContainText(
      /existing native login|login nativo existente/,
    );
    await expect(page.locator('#start')).toBeDisabled();
    await expect(page.locator('#login')).toBeDisabled();
  }
  for (const file of blockedFiles) {
    const state = file.slice(0, -'/terminal.json'.length);
    assert.deepEqual((await readdir(state)).sort(), ['codex', 'home', 'terminal.json', 'tmp']);
  }
  assert.equal(await readFile(marker, 'utf8'), preserved);
  console.log(
    JSON.stringify({
      result: 'passed',
      scope: 'two-synthetic-PTY-xterm-windows-same-workspace',
      checks: [
        'two-owned-identities',
        'keyboard-both-slots',
        'isolated-cross-instance-denial',
        'sticky-admission-until-signed-retirement',
        'durable-owned-exit-receipts',
        'reuse-blocked-without-core-journals-or-login',
        'old-reservation-byte-preservation',
        'no-provider-execution',
      ],
      providerAcceptance: 'NOT RUN',
    }),
  );
} finally {
  await desktop?.close();
  await bridge.stop();
  await rm(root, { recursive: true, force: true });
}
