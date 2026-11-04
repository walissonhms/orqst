import { openTerminalPaneMenu, openTerminalPaneSettings } from './terminal/ui-controls.js';
// Explicit same-window Desktop acceptance. Only a compiled synthetic CLI and disposable state.
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
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
import { DatabaseSync } from 'node:sqlite';
import { _electron, expect, type ElectronApplication } from '@playwright/test';
import type { DesktopTerminal } from '@orqst/protocol';
import { createBridge } from '../apps/bridge/src/app.js';
import {
  managedCodexSettings,
  terminalFile,
  type ManagedCodexConfig,
} from '../packages/core/src/terminal/codex-profile.js';
import { readLifecycleReceipt } from '../packages/core/src/managed-codex/lifecycle-receipt.js';

assert.deepEqual(process.argv.slice(2), ['--authorize-synthetic-pty']);
assert.match(process.version, /^v24\./);
assert.equal(process.platform, 'darwin');
assert.equal(process.arch, 'arm64');
// Diagnostic preflight only; the unchanged native sender predicate remains authoritative.
const consoleState = execFileSync('/usr/sbin/ioreg', ['-n', 'Root', '-d1'], {
  encoding: 'utf8',
  timeout: 3000,
  maxBuffer: 1024 * 1024,
});
assert.ok(
  !/"CGSSessionScreenIsLocked"\s*=\s*Yes/.test(consoleState),
  'Native focus unavailable: macOS console is locked. Unlock macOS and rerun. No fixture or provider started.',
);
process.umask(0o077);
const root = await realpath(await mkdtemp(join(tmpdir(), 'orqst-terminal-pair-')));
const run = promisify(execFile);
const project = join(root, 'synthetic-project');
const sessions = join(root, 'synthetic-sessions');
await mkdir(project);
await mkdir(sessions);
const draftOriginal = '# Synthetic terminal draft source';
const draftText = '# Exact synthetic draft 😀\nUnsaved and retained across native view changes.';
await writeFile(
  join(sessions, 'synthetic-draft.jsonl'),
  [
    {
      type: 'session_meta',
      payload: {
        id: 'synthetic-terminal-draft',
        cwd: project,
        agent_nickname: 'Synthetic draft test',
      },
    },
    {
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: draftOriginal }],
      },
    },
  ]
    .map((record) => JSON.stringify({ ...record, timestamp: new Date().toISOString() }))
    .join('\n') + '\n',
);
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
const states = [join(root, 'slot-a'), join(root, 'slot-b')];
try {
  const fake = join(root, 'synthetic-native-cli');
  await run('/usr/bin/cc', [resolve('tests/helpers/managed-terminal-fixture.c'), '-o', fake]);
  await chmod(fake, 0o700);
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
  await expect.poll(() => desktop!.context().pages().length).toBe(3);
  assert.equal(
    await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length),
    1,
  );
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
  const observer = desktop
    .context()
    .pages()
    .find((page) => page.url().startsWith('http:'))!;
  await observer.goto(`http://127.0.0.1:${port}/overview/sessions/synthetic-terminal-draft`);
  await observer
    .getByRole('button', { name: /Extract artifact manually|Extrair artefato manualmente/ })
    .click();
  const draft = observer.locator('.artifact-panel').getByRole('textbox');
  await observer
    .locator('.artifact-panel')
    .getByRole('button', { name: /Edit draft|Editar rascunho/, exact: true })
    .click();
  await draft.fill(draftText);
  const focus = async (slot: number) => {
    // All focus phases share the original 5-second budget; never retry an opener/action.
    const deadline = Date.now() + 5000;
    const remaining = () => Math.max(1, deadline - Date.now());
    await expect
      .poll(
        () =>
          desktop!.evaluate(
            ({ Menu }, index) =>
              Menu.getApplicationMenu()!.getMenuItemById(
                index === 0 ? 'managed-terminal-open' : 'managed-terminal-b-open',
              )!.enabled,
            slot,
          ),
        { timeout: remaining() },
      )
      .toBe(true);
    await desktop!.evaluate(({ app, BrowserWindow }) => {
      app.show();
      app.focus({ steal: true });
      const w = BrowserWindow.getAllWindows()[0]!;
      w.show();
      w.focus();
    });
    await expect
      .poll(
        () =>
          desktop!.evaluate(({ BrowserWindow }) => {
            const w = BrowserWindow.getAllWindows()[0]!;
            return w.isVisible() && w.isFocused();
          }),
        { timeout: remaining() },
      )
      .toBe(true);
    await desktop!.evaluate(({ Menu }, index) => {
      // The opener focuses the native child last, as a real menu gesture does.
      Menu.getApplicationMenu()!
        .getMenuItemById(index === 0 ? 'managed-terminal-open' : 'managed-terminal-b-open')!
        .click();
    }, slot);
    await expect
      .poll(
        () =>
          desktop!.evaluate(({ BrowserWindow }, index) => {
            const w = BrowserWindow.getAllWindows()[0]!;
            const view = w.contentView.children.find(
              (view) =>
                'webContents' in view &&
                (view as Electron.WebContentsView).webContents
                  .getTitle()
                  .includes(index === 0 ? 'T-001' : 'T-002'),
            ) as Electron.WebContentsView | undefined;
            return !!view && w.isFocused() && view.webContents.isFocused();
          }, slot),
        { timeout: remaining() },
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
    .context()
    .pages()
    .filter((page) => page.url() === 'orqst-terminal://local/index.html');
  // Select by native trusted header, never by provider output.
  const indexed = await Promise.all(
    pages.map(async (page) => ({ page, header: await page.locator('#pane-identity').innerText() })),
  );
  const terminals = ['T-001', 'T-002'].map(
    (id) => indexed.find((entry) => entry.header.includes(id))!.page,
  );
  // A focused parent/dashboard is insufficient. Recover the exact native child via its opener.
  await focus(0);
  await desktop.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]!.webContents.focus(),
  );
  await expect
    .poll(() =>
      desktop!.evaluate(({ BrowserWindow }) => {
        const w = BrowserWindow.getAllWindows()[0]!;
        return (
          w.isFocused() &&
          w.webContents.isFocused() &&
          w.contentView.children.every(
            (view) =>
              !('webContents' in view) ||
              !(view as Electron.WebContentsView).webContents.isFocused(),
          )
        );
      }),
    )
    .toBe(true);
  await focus(0);
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
  const ids = await Promise.all(terminals.map((page) => page.locator('#instance').textContent()));
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
  // Both native views are children of the sole window, with adjacent non-overlapping bounds.
  assert.deepEqual(
    await desktop.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0]!;
      const panes = w.contentView.children.filter(
        (v) =>
          'webContents' in v &&
          (v as Electron.WebContentsView).webContents.getURL().startsWith('orqst-terminal:'),
      );
      const a = panes[0]!.getBounds(),
        b = panes[1]!.getBounds();
      return {
        count: BrowserWindow.getAllWindows().length,
        visible: panes.map((v) => v.getVisible()),
        adjacent: a.x + a.width === b.x,
        sameHeight: a.height === b.height,
      };
    }),
    { count: 1, visible: [true, true], adjacent: true, sameHeight: true },
  );
  // Native layout controls operate on the same live documents and never start a process.
  const geometry = () =>
    desktop!.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0]!;
      return {
        size: w.getContentSize(),
        panes: w.contentView.children
          .filter(
            (v) =>
              'webContents' in v &&
              (v as Electron.WebContentsView).webContents.getURL().startsWith('orqst-terminal:'),
          )
          .map((v) => ({ visible: v.getVisible(), bounds: v.getBounds() })),
      };
    });
  await focus(0);
  await openTerminalPaneSettings(terminals[0]!);
  await terminals[0]!.locator('#split-rows').click();
  await expect
    .poll(async () => {
      const { size, panes } = await geometry();
      return (
        panes[0]!.bounds.y === 0 &&
        panes[0]!.bounds.height === panes[1]!.bounds.y &&
        panes[1]!.bounds.y + panes[1]!.bounds.height === size[1] &&
        panes.every((p) => p.visible && p.bounds.width === size[0])
      );
    })
    .toBe(true);
  await terminals[0]!.locator('#input').click();
  const confirmationsBeforeLayout = await desktop.evaluate(() =>
    Reflect.get(globalThis, 'syntheticConfirmCount'),
  );
  await openTerminalPaneSettings(terminals[0]!);
  await terminals[0]!.locator('#split-size').focus();
  await terminals[0]!.locator('#split-size').press('ArrowRight');
  await expect(terminals[0]!.locator('#split-value')).toHaveText('51%');
  await expect
    .poll(async () => {
      const { size, panes } = await geometry();
      return panes[0]!.bounds.height === Math.floor(size[1]! * 0.51);
    })
    .toBe(true);
  // Changing layout revokes a still-focused terminal's previous keyboard lease.
  const revoked = await terminals[0]!.evaluate(
    async (id) =>
      (window as unknown as { orqstTerminal: DesktopTerminal }).orqstTerminal.request({
        version: 1,
        action: 'write',
        instanceId: id,
        sequence: 0,
        text: 'SYNTHETIC-REFUSED',
      }),
    ids[0]!,
  );
  assert.equal(revoked.status, 'denied');
  await terminals[0]!.locator('#maximize').click();
  await expect
    .poll(async () => (await geometry()).panes.map((p) => p.visible))
    .toEqual([true, false]);
  await openTerminalPaneMenu(terminals[0]!);
  await terminals[0]!.locator('#tab-b').click();
  await expect
    .poll(async () => (await geometry()).panes.map((p) => p.visible))
    .toEqual([false, true]);
  const hidden = await terminals[0]!.evaluate(async () =>
    (
      window as unknown as { orqstTerminalPane: { show(action: string): Promise<boolean> } }
    ).orqstTerminalPane.show('restore'),
  );
  assert.equal(hidden, false);
  await openTerminalPaneSettings(terminals[1]!);
  await terminals[1]!.locator('#restore').click();
  await expect
    .poll(async () => (await geometry()).panes.map((p) => p.visible))
    .toEqual([true, true]);
  await openTerminalPaneSettings(terminals[1]!);
  await terminals[1]!.locator('#split-columns').click();
  await expect
    .poll(async () => {
      const { size, panes } = await geometry();
      return (
        panes[0]!.bounds.width === Math.floor(size[0]! * 0.51) &&
        panes[0]!.bounds.x + panes[0]!.bounds.width === panes[1]!.bounds.x
      );
    })
    .toBe(true);
  await terminals[1]!.locator('#focus-other').click();
  await expect
    .poll(() =>
      desktop!.evaluate(({ BrowserWindow }) => {
        const w = BrowserWindow.getAllWindows()[0]!;
        return w.contentView.children.some(
          (v) =>
            'webContents' in v &&
            (v as Electron.WebContentsView).webContents.getTitle().includes('T-001') &&
            (v as Electron.WebContentsView).webContents.isFocused(),
        );
      }),
    )
    .toBe(true);
  assert.deepEqual(
    await Promise.all(terminals.map((p) => p.locator('#instance').textContent())),
    ids,
  );
  assert.equal(
    await desktop.evaluate(() => Reflect.get(globalThis, 'syntheticConfirmCount')),
    confirmationsBeforeLayout,
  );
  assert.equal(
    await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length),
    1,
  );
  await openTerminalPaneMenu(terminals[0]!);
  await terminals[0]!.locator('#dashboard').click();
  await expect(draft).toHaveValue(draftText);
  assert.equal(
    await observer.evaluate(() => typeof Reflect.get(window, 'orqstTerminal')),
    'undefined',
  );
  await focus(0);
  await terminals[0]!.locator('#input').click();
  await terminals[0]!.locator('.xterm-helper-textarea').pressSequentially('ping', { delay: 20 });
  await terminals[0]!.locator('.xterm-helper-textarea').press('Enter');
  await expect(terminals[0]!.locator('#terminal')).toContainText('SYNTHETIC:PONG');
  // Native close hides this window: original observer document and owned processes survive.
  const before = await observer.evaluate(() => {
    Reflect.set(window, 'syntheticDraft', 'exact draft');
    return location.href;
  });
  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.close());
  assert.equal(
    await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length),
    1,
  );
  assert.equal(await observer.evaluate(() => Reflect.get(window, 'syntheticDraft')), 'exact draft');
  assert.equal(observer.url(), before);
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
  await expect(draft).toHaveValue(draftText);
  await draft.fill(draftOriginal);
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
  await expect.poll(() => desktop!.context().pages().length).toBe(3);
  for (const page of desktop
    .context()
    .pages()
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
      scope: 'two-synthetic-PTY-xterm-panels-one-window',
      checks: [
        'two-owned-identities',
        'keyboard-both-slots',
        'exact-unsaved-artifact-draft-preserved',
        'one-window-native-adjacent-panels',
        'tabs-both-split-axes-proportion-maximize-restore-focus',
        'layout-revokes-input-without-provider-start-or-new-identity',
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
} catch (error) {
  // Post-mortem only: preserve assertions/behavior for the unresolved initial-output flake.
  try {
    console.error(
      'SYNTHETIC_PAIR_NATIVE_POST_MORTEM',
      JSON.stringify(
        await desktop?.evaluate(({ BrowserWindow }) => ({
          confirmCount: Reflect.get(globalThis, 'syntheticConfirmCount'),
          leaseEvidence: 'private; no new authorization or request made for diagnostics',
          windows: BrowserWindow.getAllWindows().map((window) => ({
            visible: window.isVisible(),
            focused: window.isFocused(),
            views: window.contentView.children
              .filter((view) => 'webContents' in view)
              .map((view) => ({
                visible: view.getVisible(),
                focused: (view as Electron.WebContentsView).webContents.isFocused(),
              })),
          })),
        })),
      ),
    );
  } catch {
    console.error('SYNTHETIC_PAIR_NATIVE_POST_MORTEM: native state unavailable');
  }
  for (const page of desktop?.context().pages() ?? []) {
    if (page.url() !== 'orqst-terminal://local/index.html') continue;
    try {
      console.error(
        'SYNTHETIC_PAIR_POST_MORTEM',
        await page.evaluate(() => {
          const status = document.getElementById('status');
          return {
            state: status?.getAttribute('data-state'),
            gap: status?.getAttribute('data-gap'),
            pending: status?.getAttribute('data-pending'),
            blocked: status?.getAttribute('data-blocked'),
            focused: document.hasFocus(),
            displayedGapMessage: status?.textContent === status?.getAttribute('data-gap'),
            initialMarkerVisible: document
              .getElementById('terminal')
              ?.textContent?.includes('SYNTHETIC:OWNED_TUI'),
            status: status?.textContent,
            lifecycle: document.getElementById('lifecycle')?.textContent,
          };
        }),
      );
    } catch {
      console.error('SYNTHETIC_PAIR_POST_MORTEM: document unavailable');
    }
  }
  for (const [slot, state] of states.entries()) {
    try {
      const journal = new DatabaseSync(join(state, 'terminal.sqlite'), { readOnly: true });
      try {
        console.error('SYNTHETIC_PAIR_JOURNAL_POST_MORTEM', {
          slot,
          attempts: journal
            .prepare(
              "SELECT instance_id,state,updated_at,json_extract(metadata,'$.exit') AS exit FROM terminal_attempts LIMIT 2",
            )
            .all(),
        });
      } finally {
        journal.close();
      }
      const receipts = [];
      for (const name of (await readdir(state))
        .filter((name) => /^lifecycle-[a-f0-9-]+\.jsonl$/.test(name))
        .slice(0, 2)) {
        const header = JSON.parse(
          terminalFile(join(state, name), true, 4096).toString('utf8').split('\n')[0]!,
        );
        const receipt = readLifecycleReceipt(state, header.binding);
        const exit = receipt.records?.find((record) => record.type === 'exit');
        receipts.push({
          status: receipt.status,
          phases: receipt.records?.map((record) => record.type),
          ...(exit ? { exit: { code: exit.code, signal: exit.signal } } : {}),
        });
      }
      console.error('SYNTHETIC_PAIR_RECEIPT_POST_MORTEM', JSON.stringify({ slot, receipts }));
    } catch {
      console.error('SYNTHETIC_PAIR_JOURNAL_POST_MORTEM: evidence unavailable', { slot });
    }
  }
  throw error;
} finally {
  await desktop?.close();
  await bridge.stop();
  await rm(root, { recursive: true, force: true });
}
