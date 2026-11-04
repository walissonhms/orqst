// Explicit renderer-only acceptance: disposable Chromium, synthetic native transport, no CLI.
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { terminalDocument } from '../apps/desktop/src/terminal-document.js';
import { terminalScriptURL, terminalStyleURL } from '../apps/desktop/src/terminal-policy.js';
import en from '../apps/dashboard/src/locales/en-US.json';
import pt from '../apps/dashboard/src/locales/pt-BR.json';

assert.deepEqual(process.argv.slice(2), ['--authorize-synthetic-ui']);
assert.match(process.version, /^v24\./);
const artifacts = await mkdtemp(join(tmpdir(), 'orqst-terminal-ui-'));
const script = await readFile('apps/desktop/dist/managed-terminal-client.js', 'utf8');
const style = await readFile('apps/desktop/dist/managed-terminal.css', 'utf8');
const browser = await chromium.launch();
try {
  const approved = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    reducedMotion: 'reduce',
  });
  await approved.goto(
    new URL('../docs/design/v6/source/ORQST_workspace_v6_features.html', import.meta.url).href,
  );
  await approved.screenshot({ path: join(artifacts, 'approved-v6-1440x900.png') });
  assert.equal((await approved.locator('.sidebar').boundingBox())?.width, 155);
  assert.equal((await approved.locator('.top').boundingBox())?.height, 45);
  assert.equal((await approved.locator('.panehead').first().boundingBox())?.height, 31);
  await approved.close();
  for (const [language, locale] of [
    ['en-US', en],
    ['pt-BR', pt],
  ] as const) {
    const page = await browser.newPage({ reducedMotion: 'reduce' });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const html = terminalDocument({
      language,
      slot: 0,
      provider: 'SYNTHETIC Codex',
      providers: ['SYNTHETIC Codex', 'SYNTHETIC OpenCode'],
      project: '/synthetic-only/disposable/project-with-a-long-name-for-responsive-review',
      version: 'SYNTHETIC-NOT-A-PROVIDER',
      startProfile: 'codex-terminal-v1',
      nativeAuthentication: true,
      scope: 'reuseScope',
      terminalId: 'synthetic-core-uuid',
      translate: (key) =>
        locale.managedTerminal[
          key.slice('managedTerminal.'.length) as keyof typeof locale.managedTerminal
        ],
    })
      .replace(terminalScriptURL, '/client.js')
      .replace(terminalStyleURL, '/style.css');
    // All requests are fulfilled locally. No listeners or connections to the live Bridge.
    await page.route('**/*', (route) => {
      const path = new URL(route.request().url()).pathname;
      return route.fulfill({
        contentType:
          path === '/client.js'
            ? 'application/javascript'
            : path === '/style.css'
              ? 'text/css'
              : 'text/html',
        body: path === '/client.js' ? script : path === '/style.css' ? style : html,
      });
    });
    await page.addInitScript(() => {
      let state = 'prepared';
      let emitted = false;
      const calls: string[] = [];
      const layout = {
        axis: 'columns' as const,
        percent: 50,
        visible: [0, 1],
        count: 2,
        order: [0, 1],
        shown: [0, 1],
        active: 0,
        maximized: null as number | null,
        names: ['Synthetic frontend', 'Synthetic backend'],
        columns: 2,
        persisted: true,
      };
      let listener: ((value: typeof layout) => void) | undefined;
      const views: unknown[] = [];
      Reflect.set(window, 'syntheticViews', views);
      Reflect.set(window, 'syntheticCalls', calls);
      Reflect.set(window, 'orqstTerminal', {
        contractVersion: 1,
        async request(raw: { action: string }) {
          calls.push(raw.action);
          if (Reflect.get(window, 'syntheticTransportFailure'))
            throw new Error('Synthetic transport');
          const refusal = Reflect.get(window, 'syntheticRefusal');
          if (refusal && !['read', 'snapshot', 'resize'].includes(raw.action))
            return { status: refusal };
          if (raw.action === 'start') state = 'running';
          if (raw.action === 'stop') state = 'exited';
          const output = raw.action === 'attach' && !emitted;
          emitted ||= output;
          return {
            status: 'ok',
            instanceId: 'synthetic-instance-uuid',
            snapshot: { state },
            ...(output
              ? {
                  output: {
                    nextCursor: 1,
                    bytes: [...new TextEncoder().encode('SYNTHETIC UI FIXTURE — no provider\r\n')],
                    gap: false,
                  },
                }
              : {}),
          };
        },
      });
      Reflect.set(window, 'orqstTerminalPane', {
        async show(action: unknown) {
          if (Reflect.get(window, 'syntheticLayoutRefused')) return false;
          views.push(action);
          if (action === 'maximize') layout.maximized = 0;
          if (action === 'restore' || action === 'split-columns') layout.maximized = null;
          if (action && typeof action === 'object' && 'name' in action)
            layout.names[0] = String(action.name);
          if (action && typeof action === 'object' && 'tab' in action)
            layout.active = Number(action.tab);
          layout.visible = layout.maximized === null ? [0, 1] : [0];
          listener?.({ ...layout });
          return true;
        },
        onLayout(next: typeof listener) {
          listener = next;
          queueMicrotask(() => listener?.({ ...layout }));
          return () => {
            listener = undefined;
          };
        },
      });
    });
    await page.goto('https://synthetic.orqst.invalid/');
    await expect(page.locator('#terminal .xterm')).toBeVisible();
    assert.deepEqual(await page.evaluate(() => Reflect.get(window, 'syntheticCalls')), []);
    await expect(page.locator('#guidance')).toHaveText(locale.managedTerminal.guide_start);
    await expect(page.locator('#pane-title')).toHaveText('Synthetic frontend');
    await expect(page.locator('#attach')).toBeDisabled();
    await expect(page.locator('#input')).toBeDisabled();
    for (const [name, width, height] of [
      ['desktop', 1440, 900],
      ['split', 640, 900],
      ['mobile', 390, 844],
    ] as const) {
      await page.setViewportSize({ width, height });
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        .toBe(true);
      await expect(page.locator('#stop')).toBeVisible();
      const geometry = await page.locator('#terminal').boundingBox();
      assert.ok(geometry && geometry.height > height * 0.7);
      assert.equal((await page.locator('.pane-header').boundingBox())?.height, 31);
      await page.screenshot({
        path: join(artifacts, `${language}-${name}-prepared.png`),
        fullPage: true,
      });
    }
    await page.setViewportSize({ width: 640, height: 900 });
    await page.locator('#start').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#guidance')).toHaveText(locale.managedTerminal.guide_attach);
    await page.locator('#attach').click();
    await expect(page.locator('#terminal')).toContainText('SYNTHETIC UI FIXTURE');
    await expect(page.locator('#guidance')).toHaveText(locale.managedTerminal.guide_input);
    await page.locator('#input').click();
    await expect(page.locator('#guidance')).toHaveText(locale.managedTerminal.guide_typing);
    await page.locator('#pane-menu-toggle').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#pane-menu-toggle')).toHaveAttribute('aria-expanded', 'true');
    await page.locator('.layout-options summary').click();
    await page.locator('#split-columns').click();
    await expect(page.locator('#tab-a')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#guidance')).toHaveText(locale.managedTerminal.guide_input);
    await page.locator('#tab-a').click();
    await expect(page.locator('#tab-a')).toHaveAttribute('aria-pressed', 'true');
    await page.evaluate(() => Reflect.set(window, 'syntheticLayoutRefused', true));
    await page.locator('#split-columns').click();
    await expect(page.locator('#status')).toHaveText(locale.managedTerminal.focus_required);
    await page.keyboard.press('Escape');
    await page.evaluate(() => Reflect.set(window, 'syntheticRefusal', 'cancelled'));
    await page.locator('#input').click();
    await expect(page.locator('#status')).toHaveText(locale.managedTerminal.cancelled);
    await page.locator('#pane-menu-toggle').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#status')).toHaveText(locale.managedTerminal.cancelled);
    await page.keyboard.press('Escape');
    await expect(page.locator('#status')).toHaveText(locale.managedTerminal.cancelled);
    await page.evaluate(() => Reflect.set(window, 'syntheticRefusal', false));
    await page.locator('#input').click();
    await page.screenshot({ path: join(artifacts, `${language}-running.png`), fullPage: true });
    // Layout operations retain the same xterm DOM/buffer and issue no process start/stop.
    const starts = await page.evaluate(
      () => Reflect.get(window, 'syntheticCalls').filter((x: string) => x === 'start').length,
    );
    await page.evaluate(() =>
      Reflect.set(window, 'syntheticXterm', document.querySelector('.xterm')),
    );
    await page.evaluate(() => Reflect.set(window, 'syntheticLayoutRefused', false));
    await page.locator('#pane-menu-toggle').click();
    await page.locator('#pane-name').fill('Synthetic renamed <inert>');
    await page.locator('#rename-pane button').click();
    await expect(page.locator('#pane-title')).toHaveText('Synthetic renamed <inert>');
    await page.screenshot({ path: join(artifacts, `${language}-menu.png`), fullPage: true });
    await page.keyboard.press('Escape');
    await expect(page.locator('#pane-menu')).not.toHaveAttribute('open');
    await expect(page.locator('#pane-menu-toggle')).toBeFocused();
    await page.locator('#maximize').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#restore')).toBeFocused();
    await expect(page.locator('#restore')).toBeVisible();
    await page.screenshot({ path: join(artifacts, `${language}-maximized.png`), fullPage: true });
    await page.keyboard.press('Enter');
    await expect(page.locator('#maximize')).toBeFocused();
    await page.locator('#hide-pane').click();
    await page.locator('#pane-menu-toggle').click();
    await page.locator('#show-all').click();
    await page.keyboard.press('Escape');
    await expect(page.locator('#terminal')).toContainText('SYNTHETIC UI FIXTURE');
    assert.equal(
      await page.evaluate(
        () => Reflect.get(window, 'syntheticXterm') === document.querySelector('.xterm'),
      ),
      true,
    );
    assert.equal(
      await page.evaluate(
        () => Reflect.get(window, 'syntheticCalls').filter((x: string) => x === 'start').length,
      ),
      starts,
    );
    assert.ok(!(await page.evaluate(() => Reflect.get(window, 'syntheticCalls'))).includes('stop'));
    await page.evaluate(() => Reflect.set(window, 'syntheticTransportFailure', true));
    await page.locator('#input').click();
    await expect(page.locator('#status')).toHaveText(locale.managedTerminal.unavailable);
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await expect(page.locator('#status')).toHaveText(locale.managedTerminal.unavailable);
    await page.evaluate(() => Reflect.set(window, 'syntheticTransportFailure', false));
    await page.locator('#stop').click();
    await expect(page.locator('#lifecycle')).toHaveText(locale.managedTerminal.state_exited);
    await expect(page.locator('#lifecycle')).toHaveAttribute(
      'title',
      locale.managedTerminal.exited,
    );
    await expect(page.locator('#guidance')).toHaveText(locale.managedTerminal.guide_exited);
    await expect(page.locator('#input')).toBeDisabled();
    await expect(page.locator('#kill')).not.toBeVisible();
    await page.locator('#pane-menu-toggle').click();
    await page.locator('.session-details summary').click();
    await expect(page.locator('#kill')).toBeVisible();
    assert.equal(await page.locator('#terminal-identity').innerText(), 'synthetic-core-uuid');
    assert.deepEqual(errors, []);
    if (language === 'en-US') {
      await page.setViewportSize({ width: 1440, height: 900 });
      // Comparison harness only: retained production documents, synthetic transport.
      // The sidebar/topbar are geometry guides, not a runtime Feature implementation.
      await page.evaluate(() => {
        document.querySelector('main')!.hidden = true;
        const guide = document.createElement('div');
        guide.id = 'synthetic-comparison';
        guide.style.cssText =
          'position:fixed;inset:0;display:grid;grid-template-columns:155px 1fr;grid-template-rows:45px 1fr 33px;background:#07080c';
        const sidebar = document.createElement('aside');
        sidebar.textContent = 'ORQST · SYNTHETIC renderer comparison';
        sidebar.style.cssText =
          'grid-row:1/4;padding:12px;border-right:1px solid #262334;color:#9994b2';
        const top = document.createElement('header');
        top.textContent = 'Renderer only · no Feature contract / no CLI';
        top.style.cssText = 'padding:12px;border-bottom:1px solid #262334';
        const grid = document.createElement('div');
        grid.style.cssText =
          'min-height:0;display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;gap:5px;padding:4px';
        for (let i = 0; i < 4; i++) {
          const frame = document.createElement('iframe');
          frame.title = `Synthetic renderer ${i + 1}`;
          frame.src = `${location.href}?synthetic-pane=${i}`;
          frame.style.cssText = 'width:100%;height:100%;min-height:0;border:0';
          grid.append(frame);
        }
        guide.append(sidebar, top, grid);
        document.body.append(guide);
      });
      await expect(page.frameLocator('iframe').first().locator('.xterm')).toBeVisible();
      await page.screenshot({ path: join(artifacts, 'renderer-grid-1440x900.png') });
    }
    await page.close();
  }
  console.log(JSON.stringify({ status: 'passed', kind: 'synthetic-renderer-only', artifacts }));
} finally {
  await browser.close();
}
