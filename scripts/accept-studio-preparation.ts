// Explicit renderer regression: intercepted resources and synthetic facades, no Core/PTY/provider.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { readFile, readdir } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
import { tauriStudioRequestSchema, tauriStudioSnapshotSchema } from '@orqst/protocol';
import en from '../apps/dashboard/src/locales/en-US.json';
import pt from '../apps/dashboard/src/locales/pt-BR.json';

assert.deepEqual(process.argv.slice(2), ['--authorize-synthetic-studio-ui']);
assert.match(process.version, /^v24\./);
const bundled = await build({
  stdin: {
    contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { Studio } from './Studio.tsx';
      import { TauriStudioPreparation } from './TauriStudioPreparation.tsx';
      import { createTauriStudioClient } from '../../tauri/src/studio-bridge.ts';
      import i18n from './i18n.ts';
      if (window.syntheticMode === 'tauri') Object.defineProperty(window, 'orqstTauriStudio', {
        value: createTauriStudioClient(window.syntheticStudioRequest, () => navigator.userActivation.isActive),
      });
      if (window.syntheticMode === 'electron') Object.defineProperty(window, 'orqstStudio', {
        value: { contractVersion: 1, request: window.syntheticStudioRequest },
      });
      await i18n.changeLanguage(navigator.language);
      createRoot(document.getElementById('root')).render(window.syntheticMode === 'tauri'
        ? React.createElement('section', { className: 'panel studio-setup' },
            React.createElement(TauriStudioPreparation, { native: window.orqstTauriStudio }))
        : React.createElement(Studio));
    `,
    resolveDir: resolve('apps/dashboard/src'),
    sourcefile: 'synthetic-studio.tsx',
    loader: 'tsx',
  },
  outfile: 'studio.js',
  bundle: true,
  platform: 'browser',
  target: 'es2022',
  format: 'esm',
  write: false,
  logLevel: 'silent',
});
const js = bundled.outputFiles.find((file) => file.path.endsWith('.js'))!.text;
const styles = (await readdir('apps/dashboard/dist/assets')).filter((file) =>
  file.endsWith('.css'),
);
assert.ok(styles.length > 0, 'Build the dashboard before this renderer regression');
const css = (
  await Promise.all(styles.map((file) => readFile(`apps/dashboard/dist/assets/${file}`, 'utf8')))
).join('\n');
const html = `<!doctype html><meta charset="utf-8"><style>${css}</style><div id="root"></div>
<script type="module">${js.replace(/<\/script/gi, '<\\/script')}</script>`;
const browser = await chromium.launch({ headless: true });
try {
  for (const [language, locale] of [
    ['en-US', en],
    ['pt-BR', pt],
  ] as const) {
    const page = await browser.newPage({ locale: language });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const calls: unknown[] = [];
    let snapshot = tauriStudioSnapshotSchema.parse({
      generation: 1,
      limit: 8,
      count: 0,
      busy: false,
      canCreate: true,
      canReview: false,
      selectionLocked: false,
    });
    let status = 'ok';
    let release: (() => void) | undefined;
    await page.addInitScript(() => Reflect.set(window, 'syntheticMode', 'tauri'));
    await page.exposeFunction('syntheticStudioRequest', async (raw: unknown) => {
      const request = tauriStudioRequestSchema.parse(raw);
      calls.push(request);
      if (request.action === 'create') {
        assert.equal(request.generation, snapshot.generation);
        assert.equal(request.provider, 'claude');
        assert.equal(request.count, 8);
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        snapshot = { ...snapshot, count: 8, canCreate: false, canReview: true };
      }
      if (request.action === 'review' && status === 'ok') {
        snapshot = { ...snapshot, generation: 2, canReview: false, selectionLocked: true };
        return { status: 'denied' }; // Opening changed native focus/generation; no automatic retry.
      }
      return { status, snapshot };
    });
    await page.route('**/*', (route) => route.fulfill({ contentType: 'text/html', body: html }));
    await page.goto('https://synthetic-studio.invalid/studio');
    const prepare = page.getByRole('button', { name: locale.studio.tauri.prepare, exact: true });
    const review = page.getByRole('button', { name: locale.studio.continueReview, exact: true });
    await expect(prepare).toBeEnabled();
    await expect(review).toBeDisabled();
    await expect(page.getByText(locale.studio.oldDesktop, { exact: true })).toHaveCount(0);
    await expect(page.getByText(locale.studio.prepareMixed, { exact: true })).toHaveCount(0);
    await expect(page.getByLabel(locale.studio.tauri.count).locator('option')).toHaveCount(8);
    await expect(page.getByLabel(locale.studio.tauri.provider).locator('option')).toHaveCount(2);
    await page.getByLabel(locale.studio.tauri.provider).selectOption('claude');
    await page.getByLabel(locale.studio.tauri.count).selectOption('8');
    await prepare.click();
    await expect(prepare).toBeDisabled();
    await expect.poll(() => calls.length).toBe(2);
    // Native own-sheet focus transitions must not replace an in-flight result with a busy snapshot.
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    assert.equal(calls.length, 2);
    release!();
    await expect(review).toBeEnabled();
    await expect(prepare).toBeDisabled();
    status = 'focus_required';
    await review.click();
    await expect(page.getByText(locale.studio.focus_required, { exact: true })).toBeVisible();
    status = 'ok';
    await review.click();
    await expect(page.getByText(locale.studio.tauri.state_locked, { exact: true })).toBeVisible();
    await expect(review).toBeDisabled();
    await expect(prepare).toBeDisabled();
    for (const width of [1440, 720, 390]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
      );
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(
      calls.map((call) => tauriStudioRequestSchema.parse(call).action),
      ['snapshot', 'create', 'review', 'review', 'snapshot'],
    );
    await page.getByRole('button', { name: locale.studio.refresh, exact: true }).click();
    await expect(page.getByText(locale.studio.tauri.denied, { exact: true })).toHaveCount(0);
    await page.close();
    // Electron keeps the original action-only contract and mixed preset.
    const electron = await browser.newPage({ locale: language });
    await electron.addInitScript(() => Reflect.set(window, 'syntheticMode', 'electron'));
    const electronCalls: unknown[] = [];
    await electron.exposeFunction('syntheticStudioRequest', (request: { action: string }) => {
      electronCalls.push(request);
      return {
        status: 'ok',
        snapshot: {
          count: request.action === 'createMixed' ? 2 : 0,
          limit: 2,
          prepared: false,
          opened: false,
          busy: false,
          canCreate: true,
          canSelect: true,
        },
      };
    });
    await electron.route('**/*', (route) =>
      route.fulfill({ contentType: 'text/html', body: html }),
    );
    await electron.goto('https://synthetic-studio.invalid/studio');
    await electron.getByRole('button', { name: locale.studio.prepareMixed, exact: true }).click();
    await expect(electron.getByText(locale.studio.state_reviewed, { exact: true })).toBeVisible();
    assert.deepEqual(electronCalls, [{ action: 'snapshot' }, { action: 'createMixed' }]);
    await electron.close();
    console.log(
      `${language}: Tauri 1–8, native-review states, focus race, narrow geometry and Electron contract passed (renderer only)`,
    );
  }
} finally {
  await browser.close();
}
