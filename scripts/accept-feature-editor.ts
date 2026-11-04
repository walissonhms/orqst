// Explicit renderer-only regression. Synthetic metadata; no Core, host, PTY or provider.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
import {
  featureNativeRequestSchema,
  featureNativeSnapshotSchema,
  type WorkspaceFeature,
} from '@orqst/protocol';
import en from '../apps/dashboard/src/locales/en-US.json';
import pt from '../apps/dashboard/src/locales/pt-BR.json';

assert.deepEqual(process.argv.slice(2), ['--authorize-synthetic-feature-ui']);
assert.match(process.version, /^v24\./);
const bundled = await build({
  stdin: {
    contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { FeatureWorkspace } from './FeatureWorkspace.tsx';
      import i18n from './i18n.ts';
      Object.defineProperty(window, 'orqstFeatures', {
        value: { contractVersion: 1, request: window.syntheticFeatureRequest },
      });
      await i18n.changeLanguage(navigator.language);
      createRoot(document.getElementById('root')).render(React.createElement(FeatureWorkspace));
    `,
    resolveDir: resolve('apps/dashboard/src'),
    sourcefile: 'synthetic-feature-editor.tsx',
    loader: 'tsx',
  },
  outfile: 'feature-editor.js',
  bundle: true,
  platform: 'browser',
  target: 'es2022',
  format: 'esm',
  write: false,
  logLevel: 'silent',
});
const script = bundled.outputFiles
  .find((file) => file.path.endsWith('.js'))!
  .text.replace(/<\/script/gi, '<\\/script');
const style = bundled.outputFiles.find((file) => file.path.endsWith('.css'))!.text;
const html = `<!doctype html><meta charset="utf-8"><style>${style}</style>
  <div id="root"></div><script type="module">${script}</script>`;
const logo = await readFile('apps/dashboard/public/brand/orqst-logo-dark.svg');
const browser = await chromium.launch();
try {
  for (const [language, locale] of [
    ['en-US', en],
    ['pt-BR', pt],
  ] as const) {
    const featureId = randomUUID();
    const terminalId = randomUUID();
    let generation = 0;
    let feature: WorkspaceFeature = {
      schemaVersion: 1,
      workspaceId: 'synthetic-editor-only',
      featureId,
      name: 'SYNTHETIC Feature',
      description: 'SYNTHETIC existing description',
      status: 'planned',
      revision: 1,
      terminalIds: [terminalId],
      createdAt: 0,
      updatedAt: 0,
    };
    let writes = 0;
    const page = await browser.newPage({ locale: language, reducedMotion: 'reduce' });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.exposeFunction('syntheticFeatureRequest', (raw: unknown) => {
      const request = featureNativeRequestSchema.parse(raw);
      assert.ok(['snapshot', 'update'].includes(request.action));
      assert.equal(request.generation, generation);
      if (request.action === 'update') {
        assert.equal(request.featureId, featureId);
        const { expectedRevision, ...changes } = request.input;
        assert.equal(expectedRevision, feature.revision);
        feature = { ...feature, ...changes, revision: feature.revision + 1 };
        generation++;
        writes++;
      }
      return {
        status: 'ok',
        snapshot: featureNativeSnapshotSchema.parse({
          contractVersion: 1,
          storage: 'core',
          generation,
          workspace: { id: feature.workspaceId, name: 'SYNTHETIC UI ONLY' },
          features: [feature],
          view: {
            contractVersion: 1,
            storage: 'core',
            workspaceId: feature.workspaceId,
            featureId,
            revision: 1,
          },
          activeFeatureId: featureId,
          slots: [{ slot: 0, terminalId, provider: 'codex' }],
          layoutSaved: true,
        }),
      };
    });
    await page.route('**/*', (route) =>
      route.fulfill({
        contentType: route.request().url().endsWith('.svg') ? 'image/svg+xml' : 'text/html',
        body: route.request().url().endsWith('.svg') ? logo : html,
      }),
    );
    await page.goto('https://synthetic-feature-editor.invalid/');
    for (let cycle = 0; cycle < 3; cycle++) {
      await page.getByRole('button', { name: locale.features.edit, exact: true }).click();
      await expect(page.getByLabel(locale.features.description, { exact: true })).toHaveValue(
        feature.description,
      );
      const status = page.getByLabel(locale.features.status, { exact: true });
      await expect(status).toHaveValue(feature.status);
      await page
        .getByLabel(locale.features.name, { exact: true })
        .fill(`SYNTHETIC renamed ${cycle}`);
      await status.selectOption('active');
      await page.getByRole('button', { name: locale.features.save, exact: true }).click();
      await expect(page.locator('.feature-topbar strong')).toContainText(
        `SYNTHETIC renamed ${cycle}`,
      );
    }
    await page.getByRole('button', { name: locale.features.edit, exact: true }).click();
    await expect(page.getByLabel(locale.features.status, { exact: true })).toHaveValue('active');
    await page.getByRole('button', { name: locale.features.cancel, exact: true }).click();
    await expect(page.locator('.feature-editor')).toHaveCount(0);
    assert.equal(writes, 3);
    assert.deepEqual(errors, []);
    console.log(`${language}: exact editor labels and three save/reopen cycles passed (UI only)`);
    await page.close();
  }
} finally {
  await browser.close();
}
