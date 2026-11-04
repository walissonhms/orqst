// Explicit disposable Electron/Core/PTY exercise. Native focus/dialogs are synthetic doubles.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
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

assert.ok(
  JSON.stringify(process.argv.slice(2)) === JSON.stringify(['--authorize-synthetic-pty']) ||
    JSON.stringify(process.argv.slice(2)) ===
      JSON.stringify(['--authorize-synthetic-pty', '--slots=2']),
);
assert.match(process.version, /^v24\./);
assert.equal(process.platform, 'darwin');
assert.equal(process.arch, 'arm64');
process.umask(0o077);
const count = process.argv.includes('--slots=2') ? 2 : 8;
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
    (await readFile(resolve('tests/helpers/managed-terminal-fixture.c'), 'utf8')).replace(
      'alarm(25)',
      'alarm(90)',
    ),
  );
  await run('/usr/bin/cc', [source, '-o', fake]);
  await chmod(fake, 0o700);
  const states = Array.from({ length: count }, (_, slot) => join(root, `slot-${slot}`));
  const ids: string[] = [];
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
    const file = join(state, 'terminal.json');
    const config = JSON.parse(await readFile(file, 'utf8'));
    const terminalId = randomUUID();
    ids.push(terminalId);
    config.identity = { terminalId };
    await writeFile(file, JSON.stringify(config), { mode: 0o600 });
  }
  const profile = join(root, 'profile');
  const bootstrap = join(root, 'bootstrap.cjs');
  await writeFile(
    bootstrap,
    `require('electron').app.setPath('userData', ${JSON.stringify(profile)}); require(${JSON.stringify(resolve('apps/desktop/dist/main.cjs'))});`,
  );
  const port = await bridge.start();
  const require = createRequire(resolve('apps/desktop/package.json'));
  desktop = await _electron.launch({
    executablePath: require('electron') as string,
    args: [
      bootstrap,
      ...states.map((state) => `--terminal-config=${join(state, 'terminal.json')}`),
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
  try {
    await expect.poll(() => desktop!.context().pages().length).toBe(count + 1);
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
    throw error;
  }
  await desktop.evaluate(({ BrowserWindow, dialog }) => {
    const window = BrowserWindow.getAllWindows()[0]!;
    // Deliberate positive doubles in this disposable app only, not native-focus acceptance.
    window.isFocused = () => true;
    for (const view of window.contentView.children)
      if ('webContents' in view)
        (view as Electron.WebContentsView).webContents.isFocused = () => true;
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: true });
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
    await expect(page.locator('#status')).toHaveAttribute('data-state', 'running');
    await page.locator('#attach').click();
    await expect(page.locator('#terminal')).toContainText('SYNTHETIC:OWNED_TUI');
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
  await panes[last]!.locator(`#tab-${String.fromCharCode(97 + layoutSlot)}`).click();
  await expect(panes[layoutSlot]!.locator('#start')).toBeVisible();
  await panes[layoutSlot]!.locator('.layout-options > summary').click();
  await panes[layoutSlot]!.locator('#split-columns').click();
  assert.equal(
    await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length),
    1,
  );
  assert.equal(
    await desktop.evaluate(
      ({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]!.contentView.children.filter(
          (view) =>
            'webContents' in view &&
            (view as Electron.WebContentsView).webContents.getURL().startsWith('orqst-terminal:') &&
            view.getVisible(),
        ).length,
    ),
    2,
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
  await desktop.evaluate(({ Menu }) =>
    Menu.getApplicationMenu()!.getMenuItemById('managed-terminal-retire')!.click(),
  );
  await expect
    .poll(async () => (await readdir(join(profile, 'managed-agents'))).includes('active-pair.json'))
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
      provider: 'not executed',
      nativeFocus: 'test double',
    }),
  );
} finally {
  await desktop?.close().catch(() => {});
  await bridge.stop();
  await rm(root, { recursive: true, force: true });
}
