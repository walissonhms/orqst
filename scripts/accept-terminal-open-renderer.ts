// Real xterm renderer with in-memory native facade. No host, Core, PTY, provider or server.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
import { terminalNativeRequestSchema, type TerminalNativeRequest } from '@orqst/protocol';
import { terminalDocument } from '../apps/desktop/src/terminal-document.js';
import en from '../apps/dashboard/src/locales/en-US.json';
import pt from '../apps/dashboard/src/locales/pt-BR.json';

assert.deepEqual(process.argv.slice(2), ['--authorize-synthetic-terminal-renderer']);
const bundle = await build({
  entryPoints: ['apps/desktop/src/managed-terminal-client.ts'],
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'iife',
  target: 'es2022',
  logLevel: 'silent',
});
const js = bundle.outputFiles[0]!.text;
const css = await readFile('apps/desktop/node_modules/@xterm/xterm/css/xterm.css', 'utf8');
const instanceId = '00000000-0000-4000-8000-000000000001';
const epoch = '00000000-0000-4000-8000-000000000002';
const snapshot = { instanceId, epoch, state: 'running' };
const browser = await chromium.launch({ headless: true });
try {
  for (const [language, locale] of [
    ['en-US', en],
    ['pt-BR', pt],
  ] as const) {
    for (const opening of ['ready', 'incomplete'] as const) {
      const page = await browser.newPage({ locale: language });
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      const calls: TerminalNativeRequest[] = [];
      let delivered = false;
      await page.exposeFunction('syntheticNativeRequest', (raw: unknown) => {
        const request = terminalNativeRequestSchema.parse(raw);
        calls.push(request);
        if (request.action === 'read') {
          const bytes = delivered ? [] : [...Buffer.from('SYNTHETIC OUTPUT\r\n')];
          delivered = true;
          return { status: 'ok', instanceId, output: { bytes, nextCursor: 20, gap: false } };
        }
        return { status: 'ok', instanceId, snapshot };
      });
      await page.addInitScript({
        content: `
        Object.defineProperty(window,'orqstTerminal',{value:{contractVersion:1,request:window.syntheticNativeRequest}});
        Object.defineProperty(window,'orqstTerminalPane',{value:{show:async()=>false,onLayout:(listener)=>{window.syntheticLayout=listener;return ()=>{};}}});
      `,
      });
      const html = terminalDocument({
        language,
        slot: 0,
        providers: ['SYNTHETIC Codex'],
        provider: 'SYNTHETIC Codex',
        project: '/SYNTHETIC/project',
        version: 'SYNTHETIC',
        startProfile: 'codex-terminal-v1',
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
            ? { contentType: 'application/javascript', body: js }
            : path === '/style.css'
              ? { contentType: 'text/css', body: css }
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
        { instanceId, epoch, opening },
      );
      await expect(page.locator('#instance')).toHaveText(instanceId);
      await expect(page.locator('#start')).toBeDisabled();
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
      `${language}: real xterm output/keyboard and partial instance continuation passed (facade only)`,
    );
  }
} finally {
  await browser.close();
}
