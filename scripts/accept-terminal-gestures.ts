// Disposable Electron regression: real renderer/Core/PTY, synthetic native focus/dialogs only.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  chmod,
  cp,
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
import { readLifecycleReceipt } from '../packages/core/src/managed-codex/lifecycle-receipt.js';

const regression = process.argv[3] ?? 'attach-pointer';
assert.match(regression, /^(attach|stop)(-inflight)?-(pointer|space)$/);
assert.deepEqual(process.argv.slice(2), [
  '--authorize-synthetic-pty',
  ...(process.argv[3] ? [regression] : []),
]);
assert.match(process.version, /^v24\./);
assert.equal(process.platform, 'darwin');
assert.equal(process.arch, 'arm64');
process.umask(0o077);
const root = await realpath(await mkdtemp(join(tmpdir(), 'orqst-terminal-gestures-')));
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
  const state = join(root, 'slot-a');
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
  const output = join(root, 'desktop');
  await cp(resolve('apps/desktop/dist'), output, { recursive: true });
  const renderer = join(output, 'managed-terminal-client.js');
  // Control only the polling clock; all request/client/runtime/broker guards stay in use.
  await writeFile(
    renderer,
    `window.setInterval = (tick) => { window.syntheticTick = tick; return 1; };\n${await readFile(renderer, 'utf8')}`,
  );
  const bootstrap = join(root, 'bootstrap.cjs');
  await writeFile(
    bootstrap,
    `
    const { app, ipcMain } = require('electron');
    app.setPath('userData', ${JSON.stringify(join(root, 'profile'))});
    const handle = ipcMain.handle.bind(ipcMain);
    global.syntheticCalls = [];
    ipcMain.handle = (channel, listener) => handle(channel, async (event, raw) => {
      if (channel === 'orqst:terminal-native') {
        global.syntheticCalls.push(raw.action);
        if (global.syntheticHold && ['snapshot', 'read', 'resize'].includes(raw.action))
          await new Promise(resolve => { global.syntheticRelease = resolve; });
      }
      return listener(event, raw);
    });
    require(${JSON.stringify(join(output, 'main.cjs'))});
  `,
  );
  const port = await bridge.start();
  const require = createRequire(resolve('apps/desktop/package.json'));
  desktop = await _electron.launch({
    executablePath: require('electron') as string,
    args: [bootstrap, `--terminal-config=${join(state, 'terminal.json')}`],
    env: {
      HOME: root,
      TMPDIR: root,
      LANG: 'en_US.UTF-8',
      LC_ALL: 'en_US.UTF-8',
      ORQST_DESKTOP_PORT: String(port),
      NODE_OPTIONS: '',
    },
    timeout: 30000,
  });
  await expect.poll(() => desktop!.context().pages().length).toBe(2);
  const page = desktop
    .context()
    .pages()
    .find((p) => p.url().startsWith('orqst-terminal:'))!;
  await expect
    .poll(() =>
      desktop!.evaluate(
        ({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('managed-terminal-open')!.enabled,
      ),
    )
    .toBe(true);
  const nativeBefore = await desktop.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0]!;
    return { visible: w.isVisible(), focused: w.isFocused() };
  });
  await desktop.evaluate(({ BrowserWindow, Menu, dialog }) => {
    Reflect.set(globalThis, 'syntheticFocus', true);
    Reflect.set(globalThis, 'syntheticConfirmations', 0);
    const w = BrowserWindow.getAllWindows()[0]!;
    // Explicit test double, distinct from the untouched native acceptance/preflight.
    w.isFocused = () => Boolean(Reflect.get(globalThis, 'syntheticFocus'));
    for (const view of w.contentView.children)
      if ('webContents' in view)
        (view as Electron.WebContentsView).webContents.isFocused = w.isFocused;
    dialog.showMessageBox = async () => {
      Reflect.set(
        globalThis,
        'syntheticConfirmations',
        Number(Reflect.get(globalThis, 'syntheticConfirmations')) + 1,
      );
      return { response: 1, checkboxChecked: false };
    };
    dialog.showMessageBoxSync = () => 1;
    Menu.getApplicationMenu()!.getMenuItemById('managed-terminal-open')!.click();
  });
  await expect(page.locator('#terminal .xterm')).toBeVisible();
  const tick = async () => {
    await page.evaluate(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      (Reflect.get(window, 'syntheticTick') as () => void)();
    });
    await expect(page.locator('#status')).toHaveAttribute('data-pending', 'false');
  };
  // A renderer gesture/document focus never substitutes for the authoritative native predicate.
  await desktop.evaluate(() => Reflect.set(globalThis, 'syntheticFocus', false));
  await page.locator('#start').click();
  await expect(page.locator('#status')).toHaveText(
    (await page.locator('#status').getAttribute('data-focus_required')) ?? '',
  );
  assert.equal(await desktop.evaluate(() => Reflect.get(globalThis, 'syntheticConfirmations')), 0);
  assert.equal(await page.locator('#status').getAttribute('data-state'), null);
  await desktop.evaluate(() => Reflect.set(globalThis, 'syntheticFocus', true));
  await page.locator('#start').click();
  await expect
    .poll(async () => {
      for (let i = 0; i < 5; i++) await tick();
      return page.locator('#status').getAttribute('data-state');
    })
    .toBe('running');
  const gesture = async (action: string) => {
    const button = page.locator(`#${action}`);
    await expect(button).toBeEnabled();
    await desktop!.evaluate(() => Reflect.set(globalThis, 'syntheticFocus', false));
    const confirms = await desktop!.evaluate(() =>
      Reflect.get(globalThis, 'syntheticConfirmations'),
    );
    await button.click();
    await expect(page.locator('#status')).toHaveText(
      (await page.locator('#status').getAttribute('data-focus_required')) ?? '',
    );
    assert.equal(
      await desktop!.evaluate(() => Reflect.get(globalThis, 'syntheticConfirmations')),
      confirms,
    );
    await expect(page.locator('#status')).toHaveAttribute('data-state', 'running');
    await desktop!.evaluate(() => Reflect.set(globalThis, 'syntheticFocus', true));
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 0)));
    await page.evaluate((action) => {
      Reflect.set(window, 'syntheticClicks', 0);
      document.getElementById(action)!.addEventListener('click', () => {
        Reflect.set(window, 'syntheticClicks', Number(Reflect.get(window, 'syntheticClicks')) + 1);
      });
    }, action);
    if (regression.includes('inflight')) {
      await desktop!.evaluate(() => Reflect.set(globalThis, 'syntheticHold', true));
      await page.evaluate(() => {
        for (let i = 0; i < 5; i++) (Reflect.get(window, 'syntheticTick') as () => void)();
      });
      await expect(page.locator('#status')).toHaveAttribute('data-pending', 'true');
      await expect(button).toBeEnabled();
    }
    if (regression.endsWith('space')) {
      await button.focus();
      await page.keyboard.down('Space');
    } else {
      const bounds = (await button.boundingBox())!;
      await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      await page.mouse.down();
    }
    const before = await desktop!.evaluate(() => Reflect.get(globalThis, 'syntheticCalls'));
    await desktop!.evaluate(() => Reflect.set(globalThis, 'syntheticHold', true));
    // Five ticks include a snapshot even before attachment. A held reply makes the old race exact.
    await page.evaluate(() => {
      for (let i = 0; i < 5; i++) (Reflect.get(window, 'syntheticTick') as () => void)();
    });
    const enabledDuring = await button.isEnabled();
    const during = await desktop!.evaluate(() => Reflect.get(globalThis, 'syntheticCalls'));
    if (regression.endsWith('space')) await page.keyboard.up('Space');
    else await page.mouse.up();
    if (regression.includes('inflight')) {
      // The one active gesture waits for the current read; no privileged request is dispatched yet.
      await expect(button).toBeDisabled();
      assert.deepEqual(
        await desktop!.evaluate(() => Reflect.get(globalThis, 'syntheticCalls')),
        during,
      );
      assert.equal(
        await desktop!.evaluate(() => Reflect.get(globalThis, 'syntheticConfirmations')),
        confirms,
      );
    }
    await desktop!.evaluate(() => {
      Reflect.set(globalThis, 'syntheticHold', false);
      (Reflect.get(globalThis, 'syntheticRelease') as (() => void) | undefined)?.();
    });
    await expect(page.locator('#status')).toHaveAttribute('data-pending', 'false');
    console.log(
      JSON.stringify({
        regression,
        action,
        enabledDuring,
        before,
        during,
        after: await desktop!.evaluate(() => Reflect.get(globalThis, 'syntheticCalls')),
        clicks: await page.evaluate(() => Reflect.get(window, 'syntheticClicks')),
        confirmationDelta:
          Number(await desktop!.evaluate(() => Reflect.get(globalThis, 'syntheticConfirmations'))) -
          Number(confirms),
      }),
    );
    assert.equal(enabledDuring, true, `${action} must remain enabled through the gesture`);
    assert.deepEqual(during, before, 'no background request may interrupt an active gesture');
    assert.equal(await page.evaluate(() => Reflect.get(window, 'syntheticClicks')), 1);
    assert.equal(
      Number(await desktop!.evaluate(() => Reflect.get(globalThis, 'syntheticConfirmations'))) -
        Number(confirms),
      1,
    );
  };
  if (regression.startsWith('attach')) await gesture('attach');
  else await page.locator('#attach').click();
  await expect
    .poll(async () => {
      await tick();
      return page.locator('#terminal').innerText();
    })
    .toContain('SYNTHETIC:OWNED_TUI');
  await expect(page.locator('#attach')).toBeDisabled();
  if (regression.startsWith('stop')) await gesture('stop');
  else await page.locator('#stop').click();
  await expect
    .poll(async () => {
      for (let i = 0; i < 5; i++) await tick();
      return page.locator('#status').getAttribute('data-state');
    })
    .toBe('exited');
  assert.equal(await desktop.evaluate(() => Reflect.get(globalThis, 'syntheticConfirmations')), 3);
  // A gesture waiting for a read is discarded on blur, even if focus returns before that reply.
  await desktop.evaluate(() => Reflect.set(globalThis, 'syntheticHold', true));
  await page.evaluate(() => {
    for (let i = 0; i < 5; i++) (Reflect.get(window, 'syntheticTick') as () => void)();
  });
  await expect(page.locator('#status')).toHaveAttribute('data-pending', 'true');
  const beforeCancelledAction = await desktop.evaluate(() =>
    Reflect.get(globalThis, 'syntheticCalls'),
  );
  await page.locator('#start').click();
  await expect(page.locator('#start')).toBeDisabled();
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await desktop.evaluate(() => {
    Reflect.set(globalThis, 'syntheticHold', false);
    (Reflect.get(globalThis, 'syntheticRelease') as () => void)();
  });
  await expect(page.locator('#status')).toHaveAttribute('data-pending', 'false');
  await expect(page.locator('#start')).toBeEnabled();
  assert.deepEqual(
    await desktop.evaluate(() => Reflect.get(globalThis, 'syntheticCalls')),
    beforeCancelledAction,
  );
  assert.equal(await desktop.evaluate(() => Reflect.get(globalThis, 'syntheticConfirmations')), 3);
  // Direct concurrent preload requests keep the existing busy contract; no queued invocation.
  await desktop.evaluate(() => Reflect.set(globalThis, 'syntheticHold', true));
  await page.evaluate(() => {
    for (let i = 0; i < 5; i++) (Reflect.get(window, 'syntheticTick') as () => void)();
  });
  await expect(page.locator('#status')).toHaveAttribute('data-pending', 'true');
  await expect(page.locator('#start')).toBeEnabled();
  const inflightCalls = await desktop.evaluate(() => Reflect.get(globalThis, 'syntheticCalls'));
  const busyReply = await page.evaluate(() =>
    (window as unknown as { orqstTerminal: DesktopTerminal }).orqstTerminal.request({
      version: 1,
      action: 'snapshot',
      instanceId: document.getElementById('status')!.dataset.instanceId!,
    }),
  );
  assert.equal(busyReply.status, 'busy');
  await desktop.evaluate(() => {
    Reflect.set(globalThis, 'syntheticHold', false);
    (Reflect.get(globalThis, 'syntheticRelease') as () => void)();
  });
  await expect(page.locator('#status')).toHaveAttribute('data-pending', 'false');
  await expect(page.locator('#start')).toBeEnabled();
  assert.deepEqual(
    await desktop.evaluate(() => Reflect.get(globalThis, 'syntheticCalls')),
    inflightCalls,
  );
  assert.equal(await desktop.evaluate(() => Reflect.get(globalThis, 'syntheticConfirmations')), 3);
  if (regression === 'attach-inflight-pointer') {
    // Let Chromium's existing transient activation expire; do not renew it or extend a guard.
    const cdp = await desktop.context().newCDPSession(page);
    await desktop.evaluate(() => Reflect.set(globalThis, 'syntheticHold', true));
    await page.evaluate(() => {
      for (let i = 0; i < 5; i++) (Reflect.get(window, 'syntheticTick') as () => void)();
    });
    await expect(page.locator('#status')).toHaveAttribute('data-pending', 'true');
    const beforeExpiredAction = await desktop.evaluate(() =>
      Reflect.get(globalThis, 'syntheticCalls'),
    );
    await page.locator('#start').click();
    await expect(page.locator('#start')).toBeDisabled();
    await page.waitForTimeout(5500);
    // Playwright page.evaluate supplies userGesture; this observation must not reactivate the page.
    const activation = await cdp.send('Runtime.evaluate', {
      expression: 'navigator.userActivation.isActive',
      userGesture: false,
      returnByValue: true,
    });
    assert.equal(activation.result.value, false);
    await desktop.evaluate(() => {
      Reflect.set(globalThis, 'syntheticHold', false);
      (Reflect.get(globalThis, 'syntheticRelease') as () => void)();
    });
    await expect
      .poll(async () => {
        const observed = await cdp.send('Runtime.evaluate', {
          expression: `(() => { const s = document.getElementById('status'); return s.dataset.pending === 'false' && s.textContent === s.dataset.denied; })()`,
          userGesture: false,
          returnByValue: true,
        });
        return observed.result.value;
      })
      .toBe(true);
    await cdp.detach();
    assert.deepEqual(
      await desktop.evaluate(() => Reflect.get(globalThis, 'syntheticCalls')),
      beforeExpiredAction,
    );
    assert.equal(
      await desktop.evaluate(() => Reflect.get(globalThis, 'syntheticConfirmations')),
      3,
    );
  }
  // Synthetic cancellation events exercise only scheduling, never authorization or a click.
  for (const cancellation of ['pointercancel', 'blur', 'pointerleave']) {
    await page.locator('#start').dispatchEvent('pointerdown', { isPrimary: true, button: 0 });
    const before: unknown = await desktop.evaluate(() => Reflect.get(globalThis, 'syntheticCalls'));
    await page.evaluate(() => {
      for (let i = 0; i < 5; i++) (Reflect.get(window, 'syntheticTick') as () => void)();
    });
    assert.deepEqual(
      await desktop.evaluate(() => Reflect.get(globalThis, 'syntheticCalls')),
      before,
    );
    await page.evaluate(async (name) => {
      (name === 'pointerleave' ? document : window).dispatchEvent(new Event(name));
      await new Promise((resolve) => setTimeout(resolve, 0));
    }, cancellation);
    for (let i = 0; i < 5; i++) await tick();
    const after = await desktop.evaluate(() => Reflect.get(globalThis, 'syntheticCalls'));
    assert.ok((after as string[]).length > (before as string[]).length, cancellation);
    assert.equal(
      await desktop.evaluate(() => Reflect.get(globalThis, 'syntheticConfirmations')),
      3,
    );
  }
  const receipts = (await readdir(state)).filter((name) => name.startsWith('lifecycle-'));
  assert.equal(receipts.length, 1);
  const header = JSON.parse((await readFile(join(state, receipts[0]!), 'utf8')).split('\n')[0]!);
  assert.equal(readLifecycleReceipt(state, header.binding).status, 'recorded_exit');
  console.log(
    JSON.stringify({
      result: 'passed',
      scope: 'synthetic-pointer-poll-attach-stop',
      regression,
      nativeBefore,
      nativeFocus: 'TEST DOUBLE; native acceptance remains separate',
      providerAcceptance: 'NOT RUN',
    }),
  );
} finally {
  await desktop?.close();
  await bridge.stop();
  await rm(root, { recursive: true, force: true });
}
