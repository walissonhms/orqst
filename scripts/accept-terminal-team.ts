import { syntheticCliAuthorization } from './terminal/synthetic-cli-authorization.js';
import { openTerminalPaneMenu, openTerminalPaneSettings } from './terminal/ui-controls.js';
// Explicit disposable Electron/Core/PTY exercise. Native focus/dialogs are synthetic doubles.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  access,
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  stat,
  rm,
  writeFile,
} from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { terminalLayoutRecordSchema } from '@orqst/protocol';
import { _electron, expect, type ElectronApplication } from '@playwright/test';
import { build } from 'esbuild';
import { terminalExecutableSha256 } from '../packages/core/src/terminal/codex-profile.js';
import type { DesktopTerminal } from '@orqst/protocol';
import { createBridge } from '../apps/bridge/src/app.js';

assert.ok(
  JSON.stringify(process.argv.slice(2)) === JSON.stringify(['--authorize-synthetic-pty']) ||
    JSON.stringify(process.argv.slice(2)) ===
      JSON.stringify(['--authorize-synthetic-pty', '--slots=2']) ||
    JSON.stringify(process.argv.slice(2)) ===
      JSON.stringify(['--authorize-synthetic-pty', '--mixed-codex-opencode']),
);
assert.match(process.version, /^v24\./);
assert.equal(process.platform, 'darwin');
assert.equal(process.arch, 'arm64');
process.umask(0o077);
const mixed = process.argv.includes('--mixed-codex-opencode');
const count = mixed || process.argv.includes('--slots=2') ? 2 : 8;
const root = await realpath(await mkdtemp(join(tmpdir(), 'orqst-synthetic-team-')));
const run = promisify(execFile);
const project = join(root, 'project');
const sessions = join(root, 'sessions');
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
  const fake = join(root, 'synthetic-cli');
  const source = join(root, 'fixture.c');
  // Longer fixture-only deadline accommodates eight independent native confirmations.
  await writeFile(
    source,
    (await readFile(resolve('tests/helpers/managed-terminal-fixture.c'), 'utf8'))
      .replace('alarm(25)', 'alarm(90)')
      .replace(
        '  struct termios raw;',
        mixed
          ? `  const char *codex = getenv("CODEX_HOME");
  const char *home = getenv("HOME");
  if (!home || getenv("OPENCODE_CONFIG_CONTENT")) return 8;
  if (argc == 2 && strcmp(argv[1], "--standalone") == 0) {
    if (codex || !strstr(home, "native-opencode") || !getenv("OPENCODE_DB")) return 9;
  } else {
    if (!codex || !strstr(home, "native-codex") || getenv("OPENCODE_DB")) return 10;
  }
  struct termios raw;`
          : '  struct termios raw;',
      ),
  );
  await run('/usr/bin/cc', [source, '-o', fake]);
  await chmod(fake, 0o700);
  const states = Array.from({ length: count }, (_, slot) => join(root, `slot-${slot}`));
  const ids: string[] = [];
  for (const [slot, state] of states.entries()) {
    if (mixed && slot === 1) {
      const home = join(root, 'native-opencode');
      for (const dir of [home, state, join(state, 'tmp')]) await mkdir(dir, { mode: 0o700 });
      const node = {
        path: await realpath(process.execPath),
        sha256: terminalExecutableSha256(process.execPath),
      };
      await writeFile(
        join(state, 'terminal.json'),
        JSON.stringify({
          version: 3,
          provider: 'opencode',
          trust: 'native-same-user',
          executable: { path: fake, sha256: terminalExecutableSha256(fake) },
          executableVersion: '2.2.5',
          node,
          project,
          state,
          authentication: {
            mode: 'reuse-existing',
            sharedNativeConfiguration: true,
            nativeIdentity: { HOME: home, OPENCODE_DB: join(home, 'SYNTHETIC-UNOPENED.db') },
          },
          interactive: {
            sharedNativeSessions: true,
            nativeStartupAuthorized: true,
            nativeDatabaseMigrationsAcknowledged: true,
            nativeStartupActivityAcknowledged: true,
          },
        }),
        { mode: 0o600 },
      );
    } else {
      const home = join(root, 'native-codex');
      if (mixed) {
        await mkdir(home, { mode: 0o700 });
        await mkdir(join(home, '.codex'), { mode: 0o700 });
      }
      await run(process.execPath, [
        '--import',
        'tsx',
        resolve('scripts/setup-managed-terminal.ts'),
        '--authentication',
        mixed ? 'reuse-existing' : 'separate-login',
        ...(mixed
          ? [
              '--interactive',
              '--acknowledge-shared-native-config',
              '--acknowledge-shared-native-sessions',
              '--user-home',
              home,
              '--codex-home',
              join(home, '.codex'),
            ]
          : []),
        '--executable',
        fake,
        '--executable-version',
        'SYNTHETIC-NOT-A-PROVIDER',
        '--project',
        project,
        '--state',
        state,
      ]);
      if (!mixed)
        await writeFile(join(state, 'codex/auth.json'), '{"synthetic":true}', { mode: 0o600 });
    }
    const file = join(state, 'terminal.json');
    const config = JSON.parse(await readFile(file, 'utf8'));
    const terminalId = randomUUID();
    ids.push(terminalId);
    config.identity = { terminalId };
    await writeFile(file, JSON.stringify(config), { mode: 0o600 });
  }
  const output = join(root, 'desktop');
  await cp(resolve('apps/desktop/dist'), output, { recursive: true });
  if (mixed) {
    // Synthetic pin substitution is confined to disposable copies of all three process boundaries.
    for (const [entry, name] of [
      ['apps/desktop/src/main.ts', 'main.cjs'],
      ['packages/core/src/terminal/host.ts', 'managed-terminal-core.cjs'],
      ['packages/core/src/terminal/pty-host.ts', 'managed-terminal-host.cjs'],
    ])
      await build({
        entryPoints: [entry!],
        outfile: join(output, name!),
        bundle: true,
        platform: 'node',
        target: 'node24',
        format: 'cjs',
        external: ['electron', 'node-pty'],
        logLevel: 'silent',
        plugins: [syntheticCliAuthorization()],
      });
  }
  const manifestBytes = await Promise.all(
    states.map((state) => readFile(join(state, 'terminal.json'), 'utf8')),
  );
  const profile = join(root, 'profile');
  const bootstrap = join(root, 'bootstrap.cjs');
  await writeFile(
    bootstrap,
    `const { app, dialog } = require('electron');
     app.setPath('userData', ${JSON.stringify(profile)});
     dialog.showMessageBoxSync = () => 1;
     dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: true });
     require(${JSON.stringify(join(output, 'main.cjs'))});`,
  );
  const port = await bridge.start();
  const require = createRequire(resolve('apps/desktop/package.json'));
  desktop = await _electron.launch({
    executablePath: require('electron') as string,
    args: [
      bootstrap,
      ...(mixed ? [] : states.map((state) => `--terminal-config=${join(state, 'terminal.json')}`)),
    ],
    env: {
      HOME: root,
      TMPDIR: root,
      LANG: 'en_US.UTF-8',
      LC_ALL: 'en_US.UTF-8',
      ORQST_DESKTOP_PORT: String(port),
      ORQST_TERMINAL_LIMIT: String(count),
      NODE_OPTIONS: '',
    },
    timeout: 30000,
  });
  const launchedProcess = desktop.process();
  let diagnostics = '';
  launchedProcess.stderr?.on('data', (bytes: Buffer) => {
    diagnostics = (diagnostics + bytes.toString('utf8')).slice(-16000);
  });
  await desktop.firstWindow({ timeout: 30000 });
  if (mixed) {
    const files = states.map((state) => join(state, 'terminal.json'));
    await desktop.evaluate(({ BrowserWindow, dialog, Menu }, files) => {
      const window = BrowserWindow.getAllWindows()[0]!;
      window.isFocused = () => true;
      window.webContents.isFocused = () => true;
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: files });
      dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: true });
      Menu.getApplicationMenu()!.getMenuItemById('managed-terminal-select')!.click();
    }, files);
    await expect
      .poll(() =>
        desktop!.evaluate(
          ({ Menu }) =>
            Menu.getApplicationMenu()!.getMenuItemById('managed-terminal-open')!.enabled,
        ),
      )
      .toBe(true);
    // Native review alone starts no Core/journal/CLI and writes no admission marker.
    for (const state of states) assert.ok(!(await readdir(state)).includes('terminal.sqlite'));
    await assert.rejects(access(join(profile, 'managed-agents/active-pair.json')), {
      code: 'ENOENT',
    });
    await desktop.evaluate(({ Menu }) =>
      Menu.getApplicationMenu()!.getMenuItemById('managed-terminal-open')!.click(),
    );
  }
  try {
    await expect.poll(() => desktop!.context().pages().length, { timeout: 30000 }).toBe(count + 1);
  } catch (error) {
    console.log(
      JSON.stringify({
        stage: 'synthetic-team-document-count',
        diagnostics,
        exitCode: launchedProcess.exitCode,
        defaultContextPages: desktop.context().pages().length,
        electronWindows: desktop.windows().length,
        native: await desktop
          .evaluate(({ BrowserWindow, webContents }) => ({
            windows: BrowserWindow.getAllWindows().length,
            documents: webContents.getAllWebContents().map((contents) => ({
              type: contents.getType(),
              url: contents.getURL(),
              title: contents.getTitle(),
            })),
          }))
          .catch(() => ({ closed: true })),
      }),
    );
    await desktop.evaluate(({ app }) => app.exit(1));
    throw error;
  }
  await desktop.evaluate(({ BrowserWindow, dialog }) => {
    const window = BrowserWindow.getAllWindows()[0]!;
    // Deliberate positive doubles in this disposable app only, not native-focus acceptance.
    window.isFocused = () => true;
    for (const view of window.contentView.children)
      if ('webContents' in view)
        (view as Electron.WebContentsView).webContents.isFocused = () => true;
    Reflect.set(globalThis, 'syntheticRetirementDenials', 0);
    dialog.showMessageBox = async (_target: unknown, options?: Electron.MessageBoxOptions) => {
      if (options?.buttons?.length === 1)
        Reflect.set(
          globalThis,
          'syntheticRetirementDenials',
          Number(Reflect.get(globalThis, 'syntheticRetirementDenials')) + 1,
        );
      return { response: 1, checkboxChecked: true };
    };
    dialog.showMessageBoxSync = () => 1;
  });
  const indexed = await Promise.all(
    desktop
      .context()
      .pages()
      .filter((page) => page.url().startsWith('orqst-terminal:'))
      .map(async (page) => ({ page, title: await page.title() })),
  );
  const panes = ids.map((id) => indexed.find(({ title }) => title.includes(id))!.page);
  const focus = async (slot: number) => {
    await expect
      .poll(() =>
        desktop!.evaluate(
          ({ Menu }, index) =>
            Menu.getApplicationMenu()!.getMenuItemById(
              index === 0
                ? 'managed-terminal-open'
                : index === 1
                  ? 'managed-terminal-b-open'
                  : `managed-terminal-${index}-open`,
            )!.enabled,
          slot,
        ),
      )
      .toBe(true);
    await desktop!.evaluate(
      ({ Menu }, index) =>
        Menu.getApplicationMenu()!
          .getMenuItemById(
            index === 0
              ? 'managed-terminal-open'
              : index === 1
                ? 'managed-terminal-b-open'
                : `managed-terminal-${index}-open`,
          )!
          .click(),
      slot,
    );
  };
  for (const [slot, page] of panes.entries()) {
    await focus(slot);
    await page.locator('#start').click();
    try {
      await expect(page.locator('#status')).toHaveAttribute('data-state', 'running');
    } catch (error) {
      console.log(
        JSON.stringify({ slot, diagnostics, status: await page.locator('#status').textContent() }),
      );
      throw error;
    }
    await page.locator('#attach').click();
    try {
      await expect(page.locator('#terminal')).toContainText('SYNTHETIC:OWNED_TUI', {
        timeout: 10000,
      });
    } catch (error) {
      console.log(
        JSON.stringify({
          stage: 'synthetic-attach-output',
          slot,
          outputEvidence: await page.evaluate(async () => {
            const instanceId = document.getElementById('instance')!.textContent!;
            const result = await (
              window as unknown as { orqstTerminal: DesktopTerminal }
            ).orqstTerminal.request({ version: 1, action: 'read', instanceId, cursor: 0 });
            const recordedOutput = result.status === 'ok' ? result.output : undefined;
            return {
              status: result.status,
              bytes: recordedOutput?.bytes.length,
              gap: recordedOutput?.gap,
              marker: recordedOutput
                ? new TextDecoder()
                    .decode(Uint8Array.from(recordedOutput.bytes))
                    .includes('SYNTHETIC:OWNED_TUI')
                : false,
              viewport: { width: innerWidth, height: innerHeight, hidden: document.hidden },
              terminal: {
                height: document.getElementById('terminal')!.clientHeight,
                width: document.getElementById('terminal')!.clientWidth,
              },
            };
          }),
          diagnostics,
          status: await page.locator('#status').textContent(),
          geometry: await desktop.evaluate(({ BrowserWindow }) => {
            const window = BrowserWindow.getAllWindows()[0]!;
            return {
              size: window.getContentSize(),
              views: window.contentView.children.map((view) => ({
                visible: view.getVisible(),
                bounds: view.getBounds(),
              })),
            };
          }),
        }),
      );
      throw error;
    }
  }
  const attempts = await Promise.all(panes.map((page) => page.locator('#instance').textContent()));
  assert.equal(new Set(attempts).size, count);
  assert.deepEqual(
    await Promise.all(panes.map((page) => page.locator('#terminal-identity').textContent())),
    ids,
  );
  const last = count - 1;
  const layoutSlot = count > 2 ? 2 : 0;
  await focus(last);
  const cross = await panes[last]!.evaluate(
    async (instanceId) =>
      (window as unknown as { orqstTerminal: DesktopTerminal }).orqstTerminal.request({
        version: 1,
        action: 'snapshot',
        instanceId,
      }),
    attempts[0]!,
  );
  assert.equal(cross.status, 'denied');
  await openTerminalPaneMenu(panes[last]!);
  await panes[last]!.locator(`#tab-${String.fromCharCode(97 + layoutSlot)}`).click();
  await expect(panes[layoutSlot]!.locator('#start')).toBeVisible();
  await openTerminalPaneSettings(panes[layoutSlot]!);
  await panes[layoutSlot]!.locator('#split-columns').click();
  assert.equal(
    await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length),
    1,
  );
  assert.ok(
    (await desktop.evaluate(
      ({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]!.contentView.children.filter(
          (view) =>
            'webContents' in view &&
            (view as Electron.WebContentsView).webContents.getURL().startsWith('orqst-terminal:') &&
            view.getVisible(),
        ).length,
    )) >= 2,
  );
  const layoutPage = panes[layoutSlot]!;
  const documentMarker = randomUUID();
  await layoutPage.evaluate(
    (marker) => Reflect.set(window, 'syntheticDocumentMarker', marker),
    documentMarker,
  );
  await layoutPage.locator('#pane-name').fill('<Review & UI>');
  await layoutPage.locator('#rename-pane button').press('Enter');
  await expect(layoutPage.locator('#pane-title')).toContainText('<Review & UI>');
  assert.equal(await layoutPage.locator('#pane-title img').count(), 0);
  await layoutPage.locator('#move-later').press('Space');
  await expect.poll(async () => (await layoutPage.locator('[data-tab]').all()).length).toBe(count);
  await layoutPage.locator('#maximize').press('Enter');
  await expect(layoutPage.locator('#restore')).toBeFocused();
  await layoutPage.locator('#restore').press('Enter');
  await expect(layoutPage.locator('#maximize')).toBeFocused();
  // Pointer reorder has a complete keyboard equivalent above, and moves no document.
  await openTerminalPaneMenu(layoutPage);
  await layoutPage
    .locator('#pane-title')
    .dragTo(layoutPage.locator(layoutSlot === 0 ? '#tab-b' : '#tab-a'));
  await expect(layoutPage.locator('[data-tab]').first()).toHaveAttribute(
    'data-tab',
    String(layoutSlot),
  );
  await layoutPage.locator('#hide-pane').click();
  await focus(layoutSlot);
  assert.equal(
    await layoutPage.evaluate(() => Reflect.get(window, 'syntheticDocumentMarker')),
    documentMarker,
  );
  await expect(layoutPage.locator('#terminal')).toContainText('SYNTHETIC:OWNED_TUI');
  await desktop.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]!.setContentSize(700, 700),
  );
  await expect
    .poll(() =>
      desktop!.evaluate(
        ({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0]!.contentView.children.filter(
            (view) =>
              'webContents' in view &&
              (view as Electron.WebContentsView).webContents
                .getURL()
                .startsWith('orqst-terminal:') &&
              view.getVisible(),
          ).length,
      ),
    )
    .toBe(1);
  await layoutPage.locator('#input').click();
  await layoutPage.locator('.xterm-helper-textarea').pressSequentially('size', { delay: 20 });
  await layoutPage.locator('.xterm-helper-textarea').press('Enter');
  await expect(layoutPage.locator('#terminal')).toContainText(/SYNTHETIC:SIZE:\d+x\d+/);
  await desktop.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 1000),
  );
  await openTerminalPaneSettings(layoutPage);
  await layoutPage.locator('#show-all').click();
  await layoutPage.locator('#column-choice').selectOption('3');
  await expect
    .poll(() =>
      desktop!.evaluate(
        ({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0]!.contentView.children.filter(
            (view) =>
              'webContents' in view &&
              (view as Electron.WebContentsView).webContents
                .getURL()
                .startsWith('orqst-terminal:') &&
              view.getVisible(),
          ).length,
      ),
    )
    .toBe(Math.min(count, 6));
  const layoutDirectory = join(profile, 'managed-agents', 'terminal-layouts');
  const layoutFile = join(layoutDirectory, 'preferences.sqlite');
  const readSavedLayout = () => {
    const layoutDb = new DatabaseSync(layoutFile, { readOnly: true });
    try {
      const rows = layoutDb.prepare('SELECT metadata FROM terminal_layouts').all();
      assert.equal(rows.length, 1);
      return terminalLayoutRecordSchema.parse(JSON.parse(String(rows[0]!.metadata)));
    } finally {
      layoutDb.close();
    }
  };
  // Native view updates precede the private Core's durable acknowledgment.
  await expect.poll(() => readSavedLayout().columns).toBe(3);
  const savedLayout = readSavedLayout();
  assert.ok(!(await readdir(layoutDirectory)).some((file) => file.endsWith('.json')));
  assert.equal(savedLayout.columns, 3);
  assert.equal(savedLayout.order[0], ids[layoutSlot]);
  assert.ok(
    savedLayout.names.some(
      (name: { id: string; name: string }) =>
        name.id === ids[layoutSlot] && name.name === '<Review & UI>',
    ),
  );
  assert.equal((await stat(layoutFile)).mode & 0o777, 0o600);
  assert.deepEqual(
    await Promise.all(panes.map((page) => page.locator('#instance').textContent())),
    attempts,
  );
  assert.deepEqual(
    await Promise.all(states.map((state) => readFile(join(state, 'terminal.json'), 'utf8'))),
    manifestBytes,
  );
  // One explicit stop leaves seven live slots. A premature retirement cannot release admission.
  await focus(0);
  await panes[0]!.locator('#stop').click();
  await expect(panes[0]!.locator('#status')).toHaveAttribute('data-state', 'exited');
  await desktop.evaluate(({ Menu }) =>
    Menu.getApplicationMenu()!.getMenuItemById('managed-terminal-retire')!.click(),
  );
  await expect
    .poll(() =>
      desktop!.evaluate(
        ({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('managed-terminal-open')!.enabled,
      ),
    )
    .toBe(true);
  assert.ok((await readdir(join(profile, 'managed-agents'))).includes('active-pair.json'));
  for (let slot = 1; slot < count; slot++) {
    await focus(slot);
    await expect(panes[slot]!.locator('#status')).toHaveAttribute('data-state', 'running');
    await panes[slot]!.locator('#stop').click();
    await expect(panes[slot]!.locator('#status')).toHaveAttribute('data-state', 'exited');
  }
  const marker = join(profile, 'managed-agents/active-pair.json');
  const beforeRetire = await readFile(marker, 'utf8');
  const denialsBefore = await desktop.evaluate(() =>
    Number(Reflect.get(globalThis, 'syntheticRetirementDenials')),
  );
  await desktop.evaluate(({ Menu }) =>
    Menu.getApplicationMenu()!.getMenuItemById('managed-terminal-retire')!.click(),
  );
  if (mixed) {
    // Wait for the denial dialog: an unchanged marker before RPC settles proves nothing.
    await expect
      .poll(() =>
        desktop!.evaluate(() => Number(Reflect.get(globalThis, 'syntheticRetirementDenials'))),
      )
      .toBe(denialsBefore + 1);
    // Owned TUI exit is insufficient to establish OpenCode descendant exit.
    assert.deepEqual(
      await Promise.all(states.map((state) => readFile(join(state, 'terminal.json'), 'utf8'))),
      manifestBytes,
    );
    assert.equal(await readFile(marker, 'utf8'), beforeRetire);
    await expect.poll(() => desktop!.context().pages().length).toBe(3);
    console.log(
      JSON.stringify({
        synthetic: true,
        slots: count,
        windows: 1,
        providers: ['codex', 'opencode'],
        providerEnvironmentIsolated: true,
        crossSlotDenied: true,
        allOwnedTuisExited: true,
        retirement: 'blocked-descendant-exit-unvalidated',
        providerAcceptance: 'NOT RUN',
        nativeFocus: 'test double',
      }),
    );
  } else {
    await expect
      .poll(async () =>
        (await readdir(join(profile, 'managed-agents'))).includes('active-pair.json'),
      )
      .toBe(false);
    await expect.poll(() => desktop!.context().pages().length).toBe(1);
    const archive = (await readdir(join(profile, 'managed-agents'))).find((name) =>
      name.startsWith('retired-'),
    )!;
    const record = JSON.parse(await readFile(join(profile, 'managed-agents', archive), 'utf8'));
    assert.equal(record.evidence.attempts.length, count);
    assert.ok(
      record.evidence.attempts.every((attempt: { state: string }) => attempt.state === 'exited'),
    );
    await expect
      .poll(() =>
        desktop!.evaluate(
          ({ Menu }) =>
            Menu.getApplicationMenu()!.getMenuItemById('managed-terminal-create')!.enabled,
        ),
      )
      .toBe(true);
    console.log(
      JSON.stringify({
        synthetic: true,
        slots: count,
        windows: 1,
        crossSlotDenied: true,
        partialRetirementDenied: true,
        allRetired: true,
        layout:
          'grid, rename, keyboard/pointer reorder, maximize/restore, hide, compact paging, real PTY resize, private persistence',
        stableDocumentsAndInstances: true,
        provider: 'not executed',
        nativeFocus: 'test double',
      }),
    );
  }
} finally {
  await desktop?.close().catch(() => {});
  await bridge.stop();
  await rm(root, { recursive: true, force: true });
}
