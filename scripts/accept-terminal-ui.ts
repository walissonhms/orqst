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
      providers: ['SYNTHETIC Codex', 'SYNTHETIC Codex'],
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
      let listener:
        | ((layout: { axis: 'columns'; percent: number; visible: number[]; count: number }) => void)
        | undefined;
      Reflect.set(window, 'syntheticCalls', calls);
      Reflect.set(window, 'orqstTerminal', {
        contractVersion: 1,
        async request(raw: { action: string }) {
          calls.push(raw.action);
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
          const visible =
            action === 'split-columns' || action === 'restore'
              ? [0, 1]
              : action === 'tab-b'
                ? [1]
                : [0];
          listener?.({ axis: 'columns', percent: 50, visible, count: 2 });
          return true;
        },
        onLayout(next: typeof listener) {
          listener = next;
          queueMicrotask(() =>
            listener?.({ axis: 'columns', percent: 50, visible: [0], count: 2 }),
          );
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
    await page.locator('.layout-options summary').click();
    await page.locator('#split-columns').click();
    await expect(page.locator('#tab-a')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#guidance')).toHaveText(locale.managedTerminal.guide_input);
    await page.locator('#tab-a').click();
    await expect(page.locator('#tab-a')).toHaveAttribute('aria-pressed', 'true');
    await page.evaluate(() => Reflect.set(window, 'syntheticLayoutRefused', true));
    await page.locator('#split-columns').click();
    await expect(page.locator('#status')).toHaveText(locale.managedTerminal.focus_required);
    await page.evaluate(() => Reflect.set(window, 'syntheticRefusal', 'cancelled'));
    await page.locator('#input').click();
    await expect(page.locator('#status')).toHaveText(locale.managedTerminal.cancelled);
    await page.evaluate(() => Reflect.set(window, 'syntheticRefusal', false));
    await page.locator('#input').click();
    await page.screenshot({ path: join(artifacts, `${language}-running.png`), fullPage: true });
    await page.locator('#stop').click();
    await expect(page.locator('#lifecycle')).toHaveText(locale.managedTerminal.exited);
    await expect(page.locator('#guidance')).toHaveText(locale.managedTerminal.guide_exited);
    await expect(page.locator('#input')).toBeDisabled();
    await expect(page.locator('#kill')).not.toBeVisible();
    await page.locator('.session-details summary').click();
    await expect(page.locator('#kill')).toBeVisible();
    assert.equal(await page.locator('#terminal-identity').innerText(), 'synthetic-core-uuid');
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log(JSON.stringify({ status: 'passed', kind: 'synthetic-renderer-only', artifacts }));
} finally {
  await browser.close();
}
