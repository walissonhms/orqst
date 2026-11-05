import { syntheticCliAuthorization } from './terminal/synthetic-cli-authorization.js';
// Explicit disposable two-cycle Desktop/Core/PTY check. Only a compiled synthetic CLI runs.
// Native dialogs/focus and the reviewed provider pin are test doubles, never provider acceptance.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { _electron, expect, type ElectronApplication, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { createBridge } from '../apps/bridge/src/app.js';
import { readLifecycleReceipt } from '../packages/core/src/managed-codex/lifecycle-receipt.js';

assert.deepEqual(process.argv.slice(2), ['--authorize-synthetic-pty']);
assert.match(process.version, /^v24\./);
assert.equal(process.platform, 'darwin');
assert.equal(process.arch, 'arm64');
process.umask(0o077);
const root = await realpath(await mkdtemp(join(tmpdir(), 'orqst-synthetic-terminal-cycles-')));
const profile = join(root, 'profile');
const project = join(root, 'project');
const sessions = join(root, 'sessions');
for (const path of [profile, project, sessions, join(root, '.codex')])
  await mkdir(path, { mode: 0o700 });
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
  const fake = join(root, 'synthetic-cli');
  await promisify(execFile)('/usr/bin/cc', [
    resolve('tests/helpers/managed-terminal-fixture.c'),
    '-o',
    fake,
  ]);
  const node = await realpath(process.execPath);

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
    `const {app}=require('electron');const fail=(error)=>{console.error(error);app.exit(1);};process.on('uncaughtException',fail);process.on('unhandledRejection',fail);app.setPath('userData',${JSON.stringify(profile)});require(${JSON.stringify(join(output, 'main.cjs'))});`,
  );
  const port = await bridge.start();
  const require = createRequire(resolve('apps/desktop/package.json'));
  desktop = await _electron.launch({
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
  const observer = await desktop.firstWindow();
  await expect.poll(() => observer.url()).toBe(`http://127.0.0.1:${port}/`);
  const pid = desktop.process().pid;
  await desktop.evaluate(
    ({ BrowserWindow, dialog }, input) => {
      const w = BrowserWindow.getAllWindows()[0]!;
      Reflect.set(globalThis, 'syntheticFocusId', w.webContents.id);
      Reflect.set(globalThis, 'syntheticChoices', 0);
      Reflect.set(globalThis, 'syntheticRetireDenied', 0);
      w.isFocused = () => true;
      w.webContents.isFocused = () =>
        Reflect.get(globalThis, 'syntheticFocusId') === w.webContents.id;
      dialog.showOpenDialog = async (_parent: unknown, options?: Electron.OpenDialogOptions) => {
        const count = Number(Reflect.get(globalThis, 'syntheticChoices')) + 1;
        Reflect.set(globalThis, 'syntheticChoices', count);
        return {
          canceled: false,
          filePaths: [
            options?.properties?.includes('openDirectory')
              ? input.project
              : count % 3 === 1
                ? input.fake
                : input.node,
          ],
        };
      };
      dialog.showMessageBox = async (_parent: unknown, options?: Electron.MessageBoxOptions) => {
        if (options?.buttons?.length === 1) {
          Reflect.set(
            globalThis,
            'syntheticRetireDenied',
            Number(Reflect.get(globalThis, 'syntheticRetireDenied')) + 1,
          );
          return { response: 0, checkboxChecked: false };
        }
        return { response: 1, checkboxChecked: Boolean(options?.checkboxLabel) };
      };
      dialog.showMessageBoxSync = () => 1;
    },
    { fake, node, project },
  );
  const menuEnabled = (id: string) =>
    desktop!.evaluate(
      ({ Menu }, id) => Menu.getApplicationMenu()!.getMenuItemById(id)!.enabled,
      id,
    );
  const clickMenu = (id: string) =>
    desktop!.evaluate(
      ({ Menu }, id) => Menu.getApplicationMenu()!.getMenuItemById(id)!.click(),
      id,
    );
  const focus = async (slot?: number) => {
    await desktop!.evaluate(({ BrowserWindow, Menu }, slot) => {
      const w = BrowserWindow.getAllWindows()[0]!;
      const views = w.contentView.children.filter(
        (v): v is Electron.WebContentsView =>
          'webContents' in v &&
          (v as Electron.WebContentsView).webContents?.getURL().startsWith('orqst-terminal:') ===
            true,
      );
      const target =
        slot === undefined
          ? w.webContents
          : views.find((v) => v.webContents.getTitle().includes(`T-00${slot + 1}`))!.webContents;
      Reflect.set(globalThis, 'syntheticFocusId', target.id);
      for (const view of views)
        view.webContents.isFocused = () =>
          Reflect.get(globalThis, 'syntheticFocusId') === view.webContents.id;
      if (slot === undefined) w.webContents.focus();
      else
        Menu.getApplicationMenu()!
          .getMenuItemById(slot === 0 ? 'managed-terminal-open' : 'managed-terminal-b-open')!
          .click();
    }, slot);
  };
  const marker = join(profile, 'managed-agents/active-pair.json');
  const createPair = async (): Promise<{ pages: Page[] }> => {
    await focus();
    assert.equal(await menuEnabled('managed-terminal-create'), true);
    await clickMenu('managed-terminal-create');
    await expect.poll(() => menuEnabled('managed-terminal-open')).toBe(true);
    await clickMenu('managed-terminal-open');
    await expect
      .poll(
        () =>
          desktop!
            .context()
            .pages()
            .filter((p) => p.url().startsWith('orqst-terminal:')).length,
      )
      .toBe(2);
    const pages = desktop!
      .context()
      .pages()
      .filter((p) => p.url().startsWith('orqst-terminal:'));
    pages.sort(
      (a, b) => desktop!.context().pages().indexOf(a) - desktop!.context().pages().indexOf(b),
    );
    for (const [slot, page] of pages.entries()) {
      await focus(slot);
      await page.locator('#start').click();
      await expect(page.locator('#status')).toHaveAttribute('data-state', 'running', {
        timeout: 15000,
      });
    }
    assert.equal(await menuEnabled('managed-terminal-create'), false);
    assert.equal(await menuEnabled('managed-terminal-select'), false);
    return { pages };
  };
  // Keep new manifests in creation order using directory set differences, not UUID ordering.
  const create = async () => {
    const before = new Set(await readdir(profile));
    const result = await createPair();
    const next = (await readdir(profile)).find(
      (name) => name.startsWith('terminal-pair-') && !before.has(name),
    )!;
    assert.ok(next);
    return { ...result, states: ['A', 'B'].map((slot) => join(profile, next, slot)) };
  };
  for (let cycle = 0; cycle < 2; cycle++) {
    const { pages } = await create();
    const original = await readFile(marker, 'utf8');
    await focus(1);
    await clickMenu('managed-terminal-retire'); // Running processes cannot be retired or reset.
    await expect
      .poll(() => desktop!.evaluate(() => Number(Reflect.get(globalThis, 'syntheticRetireDenied'))))
      .toBe(cycle + 1);
    assert.equal(await menuEnabled('managed-terminal-create'), false);
    assert.equal(await readFile(marker, 'utf8'), original);
    for (const [slot, page] of pages.entries()) {
      await focus(slot);
      await page.locator('#stop').click();
      await expect(page.locator('#status')).toHaveAttribute('data-state', 'exited');
    }
    await focus(1);
    await clickMenu('managed-terminal-retire');
    await expect.poll(() => menuEnabled('managed-terminal-create'), { timeout: 15000 }).toBe(true);
    assert.equal(await menuEnabled('managed-terminal-select'), true);
    assert.ok(pages.every((page) => page.isClosed()));
    assert.equal(
      (await readdir(join(profile, 'managed-agents'))).filter((name) => name.startsWith('retired-'))
        .length,
      cycle + 1,
    );
    assert.equal(desktop.process().pid, pid);
  }
  const uncertain = await create();
  const preserved = await readFile(marker, 'utf8');
  await desktop.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0]!;
    const view = w.contentView.children.find(
      (v) =>
        'webContents' in v &&
        (v as Electron.WebContentsView).webContents.getTitle().includes('T-001'),
    ) as Electron.WebContentsView;
    view.webContents.close(); // Lose one owned attachment; do not signal or adopt its process.
  });
  await focus(1);
  await uncertain.pages[1]!.locator('#stop').click();
  await expect(uncertain.pages[1]!.locator('#status')).toHaveAttribute('data-state', 'exited');
  await clickMenu('managed-terminal-retire');
  await expect
    .poll(() => desktop!.evaluate(() => Number(Reflect.get(globalThis, 'syntheticRetireDenied'))))
    .toBe(3);
  assert.equal(await menuEnabled('managed-terminal-create'), false);
  assert.equal(await menuEnabled('managed-terminal-select'), false);
  // The C fixture ends itself after 25 seconds. A late durable exit does not restore ownership.
  await expect
    .poll(
      async () => {
        const receipt = (await readdir(uncertain.states[0]!)).find((name) =>
          name.startsWith('lifecycle-'),
        );
        if (!receipt) return false;
        const header = JSON.parse(
          (await readFile(join(uncertain.states[0]!, receipt), 'utf8')).split('\n')[0]!,
        );
        return (
          readLifecycleReceipt(uncertain.states[0]!, header.binding).status === 'recorded_exit'
        );
      },
      { timeout: 30000 },
    )
    .toBe(true);
  await clickMenu('managed-terminal-retire');
  await expect
    .poll(() => desktop!.evaluate(() => Number(Reflect.get(globalThis, 'syntheticRetireDenied'))))
    .toBe(4);
  assert.equal(await menuEnabled('managed-terminal-create'), false);
  assert.equal(await readFile(marker, 'utf8'), preserved);
  assert.deepEqual(await readdir(project), []);
  console.log(
    JSON.stringify({
      result: 'passed',
      scope: 'two-signed-retired-cycles-and-uncertain-remains-blocked',
      providerExecution: 'NOT RUN',
      nativeFocusAndDialogs: 'INTERCEPTED',
    }),
  );
} finally {
  await desktop?.close();
  await bridge.stop();
  await rm(root, { recursive: true, force: true });
}
