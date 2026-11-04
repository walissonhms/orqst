// Explicit disposable Electron test. Native dialogs/focus and CLI pins are synthetic doubles.
// Never opens a provider, credential, native database, quarantine or user profile.
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron, expect, type ElectronApplication } from '@playwright/test';
import { build } from 'esbuild';
import { createBridge } from '../apps/bridge/src/app.js';
import { terminalExecutableSha256 } from '../packages/core/src/terminal/codex-profile.js';
import { reviewedDesktopCodexBinary } from '../apps/desktop/src/terminal-creation.js';
import { reviewedProviderMcpBinaries } from '../packages/core/src/terminal/provider-mcp-config.js';

assert.deepEqual(process.argv.slice(2), ['--authorize-synthetic-creation']);
assert.match(process.version, /^v24\./);
assert.equal(process.platform, 'darwin');
assert.equal(process.arch, 'arm64');
process.umask(0o077);
const root = await realpath(await mkdtemp(join(tmpdir(), 'orqst-synthetic-creation-')));
let desktop: ElectronApplication | undefined;
const sessions = join(root, 'synthetic-sessions');
const project = join(root, 'project');
for (const path of [sessions, project, join(root, '.codex')]) await mkdir(path, { mode: 0o700 });
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
  const binary = await realpath(process.execPath);
  const hash = terminalExecutableSha256(binary);
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
    plugins: [
      {
        name: 'synthetic-pins-only',
        setup(builder) {
          builder.onLoad(
            { filter: /(?:provider-mcp-config|terminal-creation)\.ts$/ },
            async (args) => ({
              contents: (await readFile(args.path, 'utf8'))
                .replace(reviewedDesktopCodexBinary.sha256, hash)
                .replace(reviewedProviderMcpBinaries.claude.sha256, hash)
                .replace(reviewedProviderMcpBinaries.opencode.sha256, hash),
              loader: 'ts',
            }),
          );
        },
      },
    ],
  });
  const require = createRequire(resolve('apps/desktop/package.json'));
  for (const { provider, startupAuthorized } of [
    { provider: 'codex', startupAuthorized: false },
    { provider: 'claude', startupAuthorized: false },
    { provider: 'opencode', startupAuthorized: false },
    { provider: 'opencode', startupAuthorized: true },
  ]) {
    const profile = join(root, `profile-${provider}-${startupAuthorized}`);
    await mkdir(join(profile, 'managed-agents'), { recursive: true, mode: 0o700 });
    const marker = join(profile, 'managed-agents/active-pair.json');
    const reservation = 'SYNTHETIC-UNKNOWN-DO-NOT-RECONCILE\n';
    await writeFile(marker, reservation, { mode: 0o600 });
    const bootstrap = join(root, `bootstrap-${provider}-${startupAuthorized}.cjs`);
    await writeFile(
      bootstrap,
      `require('electron').app.setPath('userData', ${JSON.stringify(profile)}); require(${JSON.stringify(join(output, 'main.cjs'))});`,
    );
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
    await desktop.evaluate(
      ({ BrowserWindow, dialog }, { project, binary, providerIndex, startupAuthorized }) => {
        const window = BrowserWindow.getAllWindows()[0]!;
        window.isFocused = () => Boolean(Reflect.get(globalThis, 'syntheticFocus'));
        window.webContents.isFocused = window.isFocused;
        Reflect.set(globalThis, 'syntheticFocus', false);
        Reflect.set(globalThis, 'syntheticCancel', '');
        Reflect.set(globalThis, 'syntheticStep', '');
        Reflect.set(globalThis, 'syntheticChoose', 0);
        Reflect.set(globalThis, 'syntheticStages', []);
        dialog.showOpenDialog = async (_parent: unknown, options?: Electron.OpenDialogOptions) => {
          if (!options) throw new Error('Missing parented chooser options');
          if (!options!.properties!.includes('noResolveAliases'))
            throw new Error('Aliases allowed');
          const count = Number(Reflect.get(globalThis, 'syntheticChoose')) + 1;
          Reflect.set(globalThis, 'syntheticChoose', count);
          const cancelled = Reflect.get(globalThis, 'syntheticCancel') === `choose-${count}`;
          if (cancelled) Reflect.set(globalThis, 'syntheticStep', 'cancelled');
          return {
            canceled: cancelled,
            filePaths: [options!.properties!.includes('openDirectory') ? project : binary],
          };
        };
        dialog.showMessageBox = async (_parent: unknown, options?: Electron.MessageBoxOptions) => {
          if (!options) throw new Error('Missing parented confirmation options');
          if (options!.detail && options!.detail.length > 4096) throw new Error('Oversized review');
          if (
            options!.buttons &&
            options!.buttons.length > 1 &&
            (options!.defaultId !== 0 || options!.cancelId !== 0)
          )
            throw new Error('Unsafe confirmation default');
          const stage =
            options!.buttons!.length === 4
              ? 'provider'
              : options!.buttons!.length === 3 && options!.checkboxLabel
                ? 'opencode-startup'
                : options!.buttons!.length === 3
                  ? 'mcp'
                  : options!.checkboxLabel
                    ? 'creation'
                    : options!.detail
                      ? 'selection'
                      : 'denied';
          const cancel = Reflect.get(globalThis, 'syntheticCancel');
          (Reflect.get(globalThis, 'syntheticStages') as unknown[]).push({
            stage,
            cancel: typeof cancel === 'string' ? cancel : typeof cancel,
            buttons: options.buttons?.length,
            checkbox: !!options.checkboxLabel,
          });
          if (
            stage === cancel ||
            (stage === 'creation' && ['checkbox', 'blur', 'navigation'].includes(String(cancel))) ||
            (stage === 'opencode-startup' &&
              ['startup-checkbox', 'startup-blur', 'startup-navigation'].includes(String(cancel)))
          ) {
            if (cancel === 'blur' || cancel === 'startup-blur') window.emit('blur');
            if (cancel === 'navigation' || cancel === 'startup-navigation')
              window.webContents.emit('did-start-navigation');
            Reflect.set(globalThis, 'syntheticStep', 'cancelled');
            return {
              response: String(cancel).startsWith('startup-')
                ? 2
                : cancel === 'checkbox' || cancel === 'blur' || cancel === 'navigation'
                  ? 1
                  : 0,
              checkboxChecked: cancel !== 'checkbox' && cancel !== 'startup-checkbox',
            };
          }
          if (stage === 'creation') Reflect.set(globalThis, 'syntheticPreview', options!.detail);
          Reflect.set(globalThis, 'syntheticStep', stage);
          return {
            response:
              stage === 'provider'
                ? providerIndex + 1
                : stage === 'opencode-startup'
                  ? startupAuthorized
                    ? 2
                    : 1
                  : stage === 'mcp'
                    ? 2
                    : stage === 'denied'
                      ? 0
                      : 1,
            checkboxChecked:
              stage === 'creation' || (stage === 'opencode-startup' && startupAuthorized),
          };
        };
      },
      {
        project,
        binary,
        providerIndex: ['codex', 'claude', 'opencode'].indexOf(provider),
        startupAuthorized,
      },
    );
    const create = () =>
      desktop!.evaluate(({ Menu }) =>
        Menu.getApplicationMenu()!.getMenuItemById('managed-terminal-create')!.click(),
      );
    await create();
    assert.equal(await desktop.evaluate(() => Reflect.get(globalThis, 'syntheticStep')), 'denied');
    assert.deepEqual(
      (await readdir(profile)).filter((name) => name.startsWith('terminal-pair-')),
      [],
    );
    assert.deepEqual(await readdir(join(profile, 'managed-agents')), ['active-pair.json']);
    await desktop.evaluate(() => Reflect.set(globalThis, 'syntheticFocus', true));
    for (const cancellation of provider === 'codex'
      ? [
          'provider',
          'choose-1',
          'choose-2',
          'choose-3',
          'mcp',
          'creation',
          'checkbox',
          'blur',
          'navigation',
        ]
      : provider === 'opencode' && startupAuthorized
        ? ['opencode-startup', 'startup-checkbox', 'startup-blur', 'startup-navigation']
        : []) {
      await desktop.evaluate((_electron, cancellation) => {
        Reflect.set(globalThis, 'syntheticCancel', cancellation);
        Reflect.set(globalThis, 'syntheticStep', '');
        Reflect.set(globalThis, 'syntheticChoose', 0);
      }, cancellation);
      await create();
      try {
        await expect
          .poll(() => desktop!.evaluate(() => Reflect.get(globalThis, 'syntheticStep')), {
            message: `Cancellation stage: ${cancellation}`,
          })
          .toBe('cancelled');
      } catch (error) {
        console.error(await desktop.evaluate(() => Reflect.get(globalThis, 'syntheticStages')));
        throw error;
      }
      assert.deepEqual(
        (await readdir(profile)).filter((name) => name.startsWith('terminal-pair-')),
        [],
      );
      assert.deepEqual(await readdir(join(profile, 'managed-agents')), ['active-pair.json']);
      assert.equal(await readFile(marker, 'utf8'), reservation);
    }
    await desktop.evaluate(() => {
      Reflect.set(globalThis, 'syntheticCancel', '');
      Reflect.set(globalThis, 'syntheticChoose', 0);
      Reflect.set(globalThis, 'syntheticStages', []);
    });
    await desktop.evaluate(({ Menu }) => {
      const item = Menu.getApplicationMenu()!.getMenuItemById('managed-terminal-create')!;
      item.click();
      item.click(); // Busy native creation must ignore a concurrent duplicate gesture.
    });
    await expect
      .poll(() =>
        desktop!.evaluate(
          ({ Menu }) =>
            Menu.getApplicationMenu()!.getMenuItemById('managed-terminal-open')!.enabled,
        ),
      )
      .toBe(true);
    const children = await readdir(profile);
    assert.equal(children.filter((name) => name.startsWith('terminal-pair-')).length, 1);
    const pair = children.find((name) => name.startsWith('terminal-pair-'))!;
    assert.ok(pair && !pair.endsWith('.pending'));
    const files = ['A', 'B'].map((slot) => join(profile, pair, slot, 'terminal.json'));
    // Test bundle pin substitution is intentionally confined to Electron; inspect JSON here.
    const configs = await Promise.all(
      files.map(async (file) => JSON.parse(await readFile(file, 'utf8'))),
    );
    assert.equal(configs.length, 2);
    for (const config of configs) {
      assert.equal(config.executable.sha256, hash);
      assert.equal(config.node.path, binary);
      assert.equal(config.project, project);
      assert.equal(config.interactive.mcp, true);
      assert.equal(config.authentication.home ?? config.authentication.nativeIdentity.HOME, root);
      assert.deepEqual(
        (await readdir(config.state)).sort(),
        provider === 'codex' ? ['codex', 'home', 'terminal.json', 'tmp'] : ['terminal.json', 'tmp'],
      );
    }
    if (provider === 'claude') {
      assert.notEqual(configs[0].sessionId, configs[1].sessionId);
      assert.equal(configs[0].interactive.strictMcpAcknowledged, true);
    }
    if (provider === 'opencode')
      assert.equal(configs[0].interactive.nativeStartupAuthorized, startupAuthorized);
    if (provider === 'opencode' && startupAuthorized) {
      assert.equal(configs[0].interactive.nativeDatabaseMigrationsAcknowledged, true);
      assert.equal(configs[0].interactive.nativeStartupActivityAcknowledged, true);
    }
    assert.equal(await readFile(marker, 'utf8'), reservation);
    const nextView = desktop.context().waitForEvent('page', { timeout: 15000 });
    await desktop.evaluate(({ Menu }) =>
      Menu.getApplicationMenu()!.getMenuItemById('managed-terminal-open')!.click(),
    );
    const terminal = await nextView;
    await expect(terminal.locator('#status')).toHaveAttribute('data-blocked', 'true');
    await expect(terminal.locator('#start')).toBeDisabled();
    await expect(terminal.locator('#login')).toBeDisabled();
    if (provider !== 'opencode' || startupAuthorized)
      await expect(terminal.locator('#status')).toContainText(/reconciliation|reconciliação/);
    await expect
      .poll(() =>
        desktop!.evaluate(
          ({ Menu }) =>
            Menu.getApplicationMenu()!.getMenuItemById('managed-terminal-dashboard')!.enabled,
        ),
      )
      .toBe(true); // Wait for both views, not only the first page event, before requesting quit.
    assert.equal(await readFile(marker, 'utf8'), reservation);
    assert.equal(
      await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length),
      1,
    );
    assert.deepEqual(await readdir(project), []);
    assert.equal(
      await desktop.evaluate(
        ({ Menu }) =>
          Menu.getApplicationMenu()!.getMenuItemById('managed-terminal-create')!.enabled,
      ),
      false,
    );
    await desktop.close();
    desktop = undefined;
  }
  console.log(
    JSON.stringify({
      result: 'passed',
      scope:
        'native-create-review-three-synthetic-pins-explicit-opencode-consent-preserved-reservations',
      providerExecution: 'NOT RUN',
      nativeFocusAndDialogs: 'INTERCEPTED',
    }),
  );
} finally {
  await desktop?.close();
  await bridge.stop();
  await rm(root, { recursive: true, force: true });
}
