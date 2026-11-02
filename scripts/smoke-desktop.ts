// Explicit real Electron smoke. Uses only a disposable synthetic Bridge and profile.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron, expect, type ElectronApplication } from '@playwright/test';
import { createBridge } from '../apps/bridge/src/app.js';

const root = await mkdtemp(join(tmpdir(), 'orqst-electron-'));
const sessionsDir = join(root, 'synthetic-sessions');
await mkdir(sessionsDir);
const record = (type: string, payload: unknown) =>
  JSON.stringify({ type, timestamp: new Date().toISOString(), payload }) + '\n';
await writeFile(
  join(sessionsDir, 'synthetic.jsonl'),
  record('session_meta', {
    id: 'synthetic-desktop-smoke',
    cwd: '/synthetic/desktop-smoke',
    agent_nickname: 'Synthetic Desktop Smoke',
  }) +
    record('response_item', {
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: 'Disposable synthetic desktop fixture' }],
    }),
);
const config = {
  port: 0,
  dataDir: join(root, 'data'),
  sessionsDir,
  dashboardDir: resolve('apps/dashboard/dist'),
  retentionDays: 30,
  pollMs: 500,
  dev: false,
};
let bridge = createBridge(config);
let desktop: ElectronApplication | undefined;
let electronDiagnostics = '';
const evidenceDir = resolve('test-results/desktop-smoke');
await mkdir(evidenceDir, { recursive: true });
try {
  const port = await bridge.start();
  const origin = `http://127.0.0.1:${port}`;
  const desktopRequire = createRequire(resolve('apps/desktop/package.json'));
  const env: Record<string, string> = Object.fromEntries(
    Object.entries(process.env).flatMap(([key, value]) =>
      value === undefined ? [] : [[key, value]],
    ),
  );
  env.ORQST_DESKTOP_PORT = String(port);
  delete env.ELECTRON_RUN_AS_NODE;
  desktop = await _electron.launch({
    executablePath: desktopRequire('electron') as string,
    args: [resolve('apps/desktop'), `--user-data-dir=${join(root, 'profile')}`],
    env,
    timeout: 30000,
  });
  desktop.process().stderr?.on('data', (chunk: Buffer) => {
    electronDiagnostics = (electronDiagnostics + chunk.toString()).slice(-16000);
  });
  let page = await desktop.firstWindow();
  await expect(page.locator('.connection-connected')).toBeVisible();
  await expect(
    page.getByRole('button', { name: /Synthetic Desktop Smoke Disposable/ }),
  ).toBeVisible();
  assert.deepEqual(
    await page.evaluate(() => ({
      require: typeof Reflect.get(window, 'require'),
      process: typeof Reflect.get(window, 'process'),
    })),
    { require: 'undefined', process: 'undefined' },
  );
  const versions = await desktop.evaluate(() => ({
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    modules: process.versions.modules,
    arch: process.arch,
  }));
  await page.evaluate(() => window.open('https://example.com/'));
  assert.equal(desktop.windows().length, 1);
  assert.equal(await page.evaluate(() => Notification.requestPermission()), 'denied');
  const cookies = await desktop.evaluate(
    ({ session }, url) => session.fromPartition('orqst-desktop').cookies.get({ url }),
    origin,
  );
  const cookie = cookies.find((value) => value.name === 'orqst_session');
  assert.equal(cookie?.httpOnly, true);
  assert.equal(cookie.sameSite, 'strict');
  assert.equal(await page.evaluate(() => document.cookie.includes('orqst_session')), false);
  await page.screenshot({ path: join(evidenceDir, 'online.png') });
  // Close/reopen the native window while proving the independently owned Bridge lives.
  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.close());
  await expect
    .poll(() => desktop!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length))
    .toBe(0);
  assert.equal((await fetch(`${origin}/api/bootstrap`)).status, 200);
  const reopened = desktop.waitForEvent('window');
  await desktop.evaluate(({ app }) => app.emit('activate'));
  page = await reopened;
  await expect(page.locator('.connection-connected')).toBeVisible();
  await bridge.stop();
  await expect(page.locator('.connection-offline')).toBeVisible({ timeout: 15000 });
  bridge = createBridge({ ...config, port });
  await bridge.start();
  await expect(page.locator('.connection-connected')).toBeVisible({ timeout: 20000 });
  // Loading/reopening while the Bridge is absent exercises the script-free offline page.
  await bridge.stop();
  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.close());
  await expect
    .poll(() => desktop!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length))
    .toBe(0);
  const offlineWindow = desktop.waitForEvent('window');
  await desktop.evaluate(({ app }) => app.emit('activate'));
  page = await offlineWindow;
  await expect(page).toHaveURL('orqst-desktop://offline/');
  await expect(page.locator('h1')).toContainText(/Bridge/);
  await page.screenshot({ path: join(evidenceDir, 'offline.png') });
  bridge = createBridge({ ...config, port });
  await bridge.start();
  await expect(page.locator('.connection-connected')).toBeVisible({ timeout: 20000 });
  await desktop.close();
  desktop = undefined;
  assert.equal((await fetch(`${origin}/api/bootstrap`)).status, 200);
  console.log(JSON.stringify({ result: 'passed', platform: process.platform, versions }, null, 2));
  console.log(`Window evidence: ${evidenceDir}`);
} catch (error) {
  console.error(electronDiagnostics);
  throw error;
} finally {
  await desktop?.close();
  await bridge.stop();
  await rm(root, { recursive: true, force: true });
}
