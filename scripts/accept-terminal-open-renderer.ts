// Real xterm renderer with in-memory native facade. No host, Core, PTY, provider or server.
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { terminalNativeRequestSchema, type TerminalNativeRequest } from '@orqst/protocol';
import { buildSharedTestRenderer } from './helpers/shared-test-resources.js';
import { terminalDocument } from '../apps/desktop/src/terminal-document.js';
import en from '../apps/dashboard/src/locales/en-US.json';
import pt from '../apps/dashboard/src/locales/pt-BR.json';

assert.deepEqual(process.argv.slice(2), ['--authorize-synthetic-terminal-renderer']);
const { script, style } = await buildSharedTestRenderer('terminal');
const instanceId = '00000000-0000-4000-8000-000000000001';
const epoch = '00000000-0000-4000-8000-000000000002';
const snapshot = { instanceId, epoch, state: 'running' };
const browser = await chromium.launch({ headless: true });
try {
  for (const [language, locale] of [
    ['en-US', en],
    ['pt-BR', pt],
  ] as const) {
    for (const opening of ['ready', 'incomplete', 'studio-incomplete'] as const) {
      const studioChrome = opening === 'studio-incomplete';
      const page = await browser.newPage({ locale: language });
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      const calls: TerminalNativeRequest[] = [];
      let delivered = false;
      let resizeDenied = false;
      let isExited = false;
      let wrongInstance = false;
      await page.exposeFunction('syntheticNativeRequest', (raw: unknown) => {
        const request = terminalNativeRequestSchema.parse(raw);
        calls.push(request);
        if (studioChrome && request.action === 'resize' && !resizeDenied) {
          resizeDenied = true;
          return { status: 'denied' };
        }
        if (request.action === 'read') {
          if (!delivered && studioChrome) assert.equal(request.cursor, 0);
          const bytes = delivered
            ? []
            : [
                ...Buffer.from(
                  studioChrome ? 'SYNTHETIC OpenCode first frame\r\n' : 'SYNTHETIC OUTPUT\r\n',
                ),
              ];
          delivered = true;
          return { status: 'ok', instanceId, output: { bytes, nextCursor: 20, gap: false } };
        }
        return {
          status: 'ok',
          instanceId,
          snapshot: {
            ...snapshot,
            instanceId: wrongInstance ? epoch : instanceId,
            state: isExited || wrongInstance ? 'exited' : 'running',
          },
        };
      });
      await page.addInitScript({
        content: `
        let manual = false;
        window.addEventListener('click', (event) => {
          if (event.isTrusted && ['attach', 'input'].includes(event.target?.id)) manual = true;
        }, true);
        Object.defineProperty(window,'orqstTerminal',{value:{contractVersion:1,request:(request) => {
          if (['attach', 'input'].includes(request.action) && !manual)
            return Promise.resolve({status:'denied'});
          return window.syntheticNativeRequest(request);
        }}});
        Object.defineProperty(window,'orqstTerminalPane',{value:{show:async()=>false,onLayout:(listener)=>{window.syntheticLayout=listener;return ()=>{};}}});
      `,
      });
      const html = terminalDocument({
        language: studioChrome ? 'en-US' : language,
        slot: 0,
        providers: [studioChrome ? 'OpenCode' : 'SYNTHETIC Codex'],
        provider: studioChrome ? 'OpenCode' : 'SYNTHETIC Codex',
        project: '/SYNTHETIC/project',
        version: 'SYNTHETIC',
        startProfile: studioChrome ? 'opencode-terminal-v1' : 'codex-terminal-v1',
        studioChrome,
        operationalOpen: true,
        nativeAuthentication: true,
        scope: 'reuseScope',
        translate: (key) =>
          String(Reflect.get(locale.managedTerminal, key.slice('managedTerminal.'.length))),
      })
        .replace('orqst-terminal://local/client.js', '/client.js')
        .replace('orqst-terminal://local/style.css', '/style.css');
      await page.route('**/*', (route) => {
        const path = new URL(route.request().url()).pathname;
        return route.fulfill(
          path === '/client.js'
            ? { contentType: 'application/javascript', body: script }
            : path === '/style.css'
              ? { contentType: 'text/css', body: style }
              : { contentType: 'text/html', body: html },
        );
      });
      await page.goto('https://synthetic-terminal.invalid/');
      await expect(page.locator('.xterm')).toBeVisible();
      await page.evaluate(
        ({ instanceId, epoch, opening }) =>
          window.dispatchEvent(
            new CustomEvent('orqst-terminal-open', {
              detail: {
                status: 'ok',
                instanceId,
                opening,
                ...(opening === 'ready'
                  ? { snapshot: { instanceId, epoch, state: 'running' } }
                  : {}),
              },
            }),
          ),
        { instanceId, epoch, opening: studioChrome ? 'incomplete' : opening },
      );
      await expect(page.locator('#instance')).toHaveText(instanceId);
      await expect(page.locator('#start')).toBeDisabled();
      if (studioChrome) {
        await expect(page.locator('.xterm')).toContainText('SYNTHETIC OpenCode first frame');
        await expect(page.locator('.process-controls')).toBeHidden();
        await expect(page.locator('#guidance')).toHaveCount(0);
        await expect(page.locator('#status')).toBeHidden();
        await expect(page.locator('html')).toHaveAttribute('lang', language);
        await expect(page.locator('#terminal')).toHaveAttribute(
          'aria-label',
          locale.managedTerminal.output,
        );
        await expect
          .poll(() => calls.filter((request) => request.action === 'resize').length)
          .toBeGreaterThan(1);
        assert.equal(
          calls.some(({ action }) => ['attach', 'input', 'open', 'start'].includes(action)),
          false,
        );
        wrongInstance = true;
        const snapshots = calls.filter(({ action }) => action === 'snapshot').length;
        await expect
          .poll(() => calls.filter(({ action }) => action === 'snapshot').length)
          .toBeGreaterThan(snapshots);
        await expect(page.locator('#status')).toBeHidden();
        wrongInstance = false;
        isExited = true;
        await expect(page.locator('#status')).toHaveText(locale.managedTerminal.exited);
        await expect(page.locator('.process-controls')).toBeHidden();
        await expect(page.locator('.xterm')).toContainText('SYNTHETIC OpenCode first frame');
        await page.locator('.xterm-helper-textarea').focus();
        await page.keyboard.press('Shift+F10');
        await expect(page.locator('.pane-actions')).toBeVisible();
        await expect(page.locator('#hide-pane-menu')).toHaveText(locale.managedTerminal.hideView);
        await expect(page.locator('#detach')).toHaveText(locale.managedTerminal.detach);
        await expect(page.locator('#stop')).toHaveText(locale.managedTerminal.stop);
        await expect(page.locator('#kill')).toHaveText(locale.managedTerminal.kill);
        await page.keyboard.press('Escape');
        await expect(page.locator('.pane-actions')).toBeHidden();
        assert.deepEqual(errors, []);
        await page.close();
        continue;
      }
      if (opening === 'incomplete') {
        await expect(page.locator('#status')).toHaveText(locale.managedTerminal.openingIncomplete);
        await expect(page.locator('#attach')).toBeEnabled();
        await page.locator('#attach').click();
        await page.locator('#input').click();
      }
      await expect.poll(() => calls.some((request) => request.action === 'read')).toBe(true);
      await expect(page.locator('.xterm')).toContainText('SYNTHETIC OUTPUT');
      await page.evaluate(() => {
        Reflect.set(window, 'syntheticOriginalXterm', document.querySelector('.xterm'));
        Reflect.get(
          window,
          'syntheticLayout',
        )({
          count: 2,
          order: [0, 1],
          shown: [0, 1],
          visible: [0, 1],
          active: 1,
          maximized: null,
          axis: 'columns',
          percent: 50,
          columns: 2,
          names: ['SYNTHETIC original', 'SYNTHETIC added'],
          persisted: true,
        });
      });
      await expect(page.locator('[data-tab="1"]')).toHaveCount(1);
      await expect(page.locator('[data-tab="1"]')).toContainText('SYNTHETIC added');
      await expect(page.locator('#focus-other')).toBeEnabled();
      assert.equal(
        await page.evaluate(
          () => Reflect.get(window, 'syntheticOriginalXterm') === document.querySelector('.xterm'),
        ),
        true,
        'Live membership must retain the original xterm and its scrollback',
      );
      await expect(page.locator('.xterm')).toContainText('SYNTHETIC OUTPUT');

      await page.locator('.xterm-helper-textarea').focus();
      await page.keyboard.type('k');
      await expect
        .poll(() => calls.filter((request) => request.action === 'write').length)
        .toBeGreaterThan(0);
      assert.equal(
        calls.some((request) => ['open', 'start'].includes(request.action)),
        false,
        'Supplied opening result must never trigger a repeated launch',
      );
      assert.equal(
        calls
          .filter((request) => request.action === 'write')
          .every((request) => request.instanceId === instanceId),
        true,
      );
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log(
      `${language}: real xterm output/keyboard, Studio auto-attach, resize retry and evidenced exit passed (facade only)`,
    );
  }
} finally {
  await browser.close();
}
