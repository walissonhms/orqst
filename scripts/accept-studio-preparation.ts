// Explicit renderer-only regression. Intercepted resources/facades; no Core/PTY/provider.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { readFile, readdir } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
import {
  tauriStudioRequestSchema,
  tauriStudioSnapshotSchema,
  terminalPreparationCatalogSchema,
} from '@orqst/protocol';
import en from '../apps/dashboard/src/locales/en-US.json';
import pt from '../apps/dashboard/src/locales/pt-BR.json';

assert.deepEqual(process.argv.slice(2), ['--authorize-synthetic-studio-ui']);
assert.match(process.version, /^v24\./);
const bundled = await build({
  stdin: {
    contents: `
      import React from 'react'; import { createRoot } from 'react-dom/client';
      import { StudioWorkspace } from './StudioWorkspace.tsx'; import { Studio } from './Studio.tsx';
      import { createTauriStudioClient } from '../../tauri/src/studio-bridge.ts'; import i18n from './i18n.ts';
      if (window.syntheticMode === 'tauri') {
        Object.defineProperty(window, 'orqstTauriStudio', { value:createTauriStudioClient(window.syntheticStudioRequest,()=>navigator.userActivation.isActive) });
        Object.defineProperty(window, 'orqstFeatures', { value:{contractVersion:1,request:async()=>({status:'unavailable'})} });
      } else Object.defineProperty(window,'orqstStudio',{value:{contractVersion:1,request:window.syntheticStudioRequest}});
      await i18n.changeLanguage(navigator.language);
      createRoot(document.getElementById('root')).render(window.syntheticMode==='tauri'
        ? React.createElement(StudioWorkspace,{onOverview:()=>{},workspaces:[{id:'synthetic-workspace',name:'SYNTHETIC project'}],workspaceId:'synthetic-workspace'})
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
const directory = process.env.ORQST_STUDIO_CSS_DIR ?? 'apps/dashboard/dist/assets';
const styles = (await readdir(directory)).filter((file) => file.endsWith('.css'));
assert.ok(
  styles.length > 0,
  'Dashboard CSS is required; an existing read-only build may be supplied',
);
const css =
  (await Promise.all(styles.map((file) => readFile(resolve(directory, file), 'utf8')))).join('\n') +
  '\n' +
  (bundled.outputFiles.find((file) => file.path.endsWith('.css'))?.text ?? '');
const html = `<!doctype html><meta charset="utf-8"><style>${css}</style><div id="root"></div><script type="module">${js.replace(/<\/script/gi, '<\\/script')}</script>`;
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
    let catalog = terminalPreparationCatalogSchema.parse({
      contractVersion: 1,
      workspaceId: 'synthetic-workspace',
      featureId: null,
      catalogId: 'a'.repeat(64),
      providers: ['codex', 'claude', 'opencode'].map((provider, index) => ({
        provider,
        status: 'available',
        reason: 'ready',
        models: [
          {
            id: String(index + 1).repeat(64),
            label: `SYNTHETIC ${provider} model`,
            source: 'native-config',
            isDefault: false,
            availability: 'unverified',
          },
        ],
      })),
    });
    let release: (() => void) | undefined;
    await page.addInitScript(() => Reflect.set(window, 'syntheticMode', 'tauri'));
    await page.exposeFunction('syntheticStudioRequest', async (raw: unknown) => {
      const request = tauriStudioRequestSchema.parse(raw);
      calls.push(request);
      if (request.action === 'catalog') return { status: 'catalog', catalog };
      if (request.action === 'create-selected') {
        assert.deepEqual(request, {
          action: 'create-selected',
          generation: 1,
          workspaceId: 'synthetic-workspace',
          featureId: null,
          catalogId: 'a'.repeat(64),
          provider: 'opencode',
          modelId: '3'.repeat(64),
          count: 1,
        });
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        snapshot = {
          ...snapshot,
          generation: 2,
          count: 1,
          canCreate: false,
          selectionLocked: true,
        };
        return { status: 'denied' }; // Native transition fenced the old source. Never repeat create.
      }
      return { status: 'ok', snapshot };
    });
    await page.route('**/*', (route) => route.fulfill({ contentType: 'text/html', body: html }));
    await page.goto('https://synthetic-studio.invalid/studio');
    await expect(page.locator('.feature-workspace')).toHaveCount(1);
    await expect(page.locator('.feature-sidebar')).toHaveCount(1);
    await page.getByRole('button', { name: '＋ Terminal', exact: true }).click();
    const drawer = page.getByRole('dialog', { name: locale.studio.tauri.openTitle, exact: true });
    await expect(drawer).toBeVisible();
    const provider = drawer.getByLabel(locale.studio.tauri.provider);
    const model = drawer.getByLabel(locale.studio.tauri.model, { exact: true });
    const open = drawer.getByRole('button', { name: locale.studio.tauri.open, exact: true });
    await expect(provider.locator('option')).toHaveCount(3);
    await expect(open).toBeDisabled();
    for (const [value, id] of [
      ['codex', '1'],
      ['claude', '2'],
      ['opencode', '3'],
    ]) {
      await provider.selectOption(value!);
      await expect(model).toHaveValue('');
      await model.selectOption(id!.repeat(64));
      await expect(open).toBeEnabled();
    }
    // Unavailable installations cannot be opened and do not silently select another CLI.
    catalog = {
      ...catalog,
      providers: catalog.providers.map((p) =>
        p.provider === 'opencode'
          ? {
              ...p,
              status: 'unavailable' as const,
              reason: 'executable_not_found' as const,
              models: [],
            }
          : p,
      ),
    };
    await drawer.getByRole('button', { name: locale.studio.refresh, exact: true }).click();
    await expect(open).toBeDisabled();
    await expect(provider).toHaveValue('opencode');
    await expect(
      drawer.getByText(locale.studio.tauri.catalog_executable_not_found, { exact: true }),
    ).toBeVisible();
    catalog = {
      ...catalog,
      providers: catalog.providers.map((p) =>
        p.provider === 'opencode'
          ? {
              ...p,
              status: 'available' as const,
              reason: 'catalog_limited' as const,
              models: [
                {
                  id: '3'.repeat(64),
                  label: 'SYNTHETIC opencode model',
                  source: 'native-config' as const,
                  isDefault: false,
                  availability: 'unverified' as const,
                },
              ],
            }
          : p,
      ),
    };
    await drawer.getByRole('button', { name: locale.studio.refresh, exact: true }).click();
    await model.selectOption('3'.repeat(64));
    await open.click();
    await expect(open).toBeDisabled();
    await expect
      .poll(
        () =>
          calls.filter((c) => tauriStudioRequestSchema.parse(c).action === 'create-selected')
            .length,
      )
      .toBe(1);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    release!();
    await expect(drawer.getByText(locale.studio.tauri.state_locked, { exact: true })).toBeVisible();
    assert.equal(
      calls.filter((c) => tauriStudioRequestSchema.parse(c).action === 'create-selected').length,
      1,
    );
    assert.equal(
      calls.filter((c) => ['create', 'review'].includes(tauriStudioRequestSchema.parse(c).action))
        .length,
      0,
    );
    for (const width of [1440, 720, 390, 320]) {
      await page.setViewportSize({ width, height: 700 });
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
      );
      await expect(provider).toBeVisible();
    }
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    await expect(page.getByRole('button', { name: '＋ Terminal', exact: true })).toBeFocused();
    assert.deepEqual(errors, []);
    await page.close();
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
      `${language}: scoped CLI/model/Open, unavailable catalog, no mutation retry, retained single shell, keyboard and 320px overflow passed (renderer only)`,
    );
  }
} finally {
  await browser.close();
}
