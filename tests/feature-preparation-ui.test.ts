// Synthetic headless renderer only. No app, Core, PTY, provider or native grant is used.
import assert from 'node:assert/strict';
import test from 'node:test';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';

test('EN/PT chrome hands exact scope to the existing Studio drawer without opening a CLI', async () => {
  const result = await build({
    stdin: {
      contents: `
        import React, { useState } from 'react';
        import { createRoot } from 'react-dom/client';
        import { createInstance } from 'i18next';
        import { I18nextProvider } from 'react-i18next';
        import { FeatureWorkspace } from './src/FeatureWorkspace.tsx';
        import { StudioWorkspace } from './src/StudioWorkspace.tsx';
        import { featureNativeSnapshotSchema } from '@orqst/protocol';
        import en from './src/locales/en-US.json';
        import pt from './src/locales/pt-BR.json';
        window.startFixture = async (language) => {
          window.calls = [];
          const featureId = '00000000-0000-4000-8000-000000000001';
          const snapshot = featureNativeSnapshotSchema.parse({
            contractVersion: 1, storage: 'core', generation: 7,
            workspace: { id: 'synthetic-workspace', name: 'Synthetic workspace' },
            features: [{ featureId, workspaceId: 'synthetic-workspace', name: 'Synthetic feature',
              description: '', status: 'active', revision: 2, terminalIds: [],
              schemaVersion: 1, createdAt: 1, updatedAt: 1, }],
            view: { contractVersion: 1, storage: 'core', workspaceId: 'synthetic-workspace', featureId, revision: 3 },
            activeFeatureId: featureId, slots: [{ slot: 0, provider: 'codex',
              terminalId: '00000000-0000-4000-8000-000000000002' }], layoutSaved: true,
          });
          const i18n = createInstance();
          await i18n.init({ lng: language, fallbackLng: 'en-US', resources: {
            'en-US': { translation: en }, 'pt-BR': { translation: pt },
          }});
          function Fixture() {
            const [request, setRequest] = useState();
            window.orqstFeatures = {
              contractVersion: 1,
              request: async () => ({ status: 'ok', snapshot }),
              showPreparationDrawer: async (scope) => {
                window.calls.push({ command: 'feature_prepare', scope });
                setRequest(scope);
                return { status: 'ok' };
              },
            };
            window.orqstTauriStudio = {
              contractVersion: 1,
              request: async (input) => {
                window.calls.push(input);
                return input.action === 'snapshot' ? { status: 'ok', snapshot: {
                  generation: 1, limit: 8, count: 0, busy: false, canCreate: true,
                  canReview: false, selectionLocked: false,
                }} : { status: 'unavailable' };
              },
            };
            return <I18nextProvider i18n={i18n}>
              <div id="chrome"><FeatureWorkspace nativeWorkspace /></div>
              <div id="main"><StudioWorkspace onOverview={() => {}}
                preparationRequest={request} onPreparationHandled={() => setRequest(undefined)} /></div>
            </I18nextProvider>;
          }
          createRoot(document.getElementById('root')).render(<Fixture />);
        };
      `,
      resolveDir: resolve('apps/dashboard'),
      loader: 'tsx',
    },
    bundle: true,
    platform: 'browser',
    format: 'iife',
    target: 'safari17',
    loader: { '.css': 'empty' },
    write: false,
    logLevel: 'silent',
  });
  const browser = await chromium.launch({ headless: true });
  try {
    for (const [language, title, cli, model, open, guided, advanced] of [
      [
        'en-US',
        'Open terminal',
        'CLI provider',
        'Model',
        'Open',
        'New terminals',
        'Advanced options (MCP pair, path review)',
      ],
      [
        'pt-BR',
        'Abrir terminal',
        'Provedor CLI',
        'Modelo',
        'Abrir',
        'Novos terminais',
        'Opções avançadas (par MCP, revisão de caminhos)',
      ],
    ] as const) {
      const page = await browser.newPage();
      await page.setContent('<div id="root"></div>');
      await page.addScriptTag({ content: result.outputFiles[0]!.text });
      await page.evaluate((language) => Reflect.get(window, 'startFixture')(language), language);
      const button = page
        .locator('#chrome')
        .getByRole('button', { name: '＋ Terminal', exact: true });
      await button.waitFor();
      await page.waitForFunction(
        () =>
          !document
            .querySelector('#chrome .feature-topbar button:last-child')
            ?.hasAttribute('disabled'),
      );
      await button.click();
      // The guided dialog opens first; the previous detailed form stays one click away.
      const dialog = page.getByRole('dialog', { name: guided, exact: true });
      await dialog.waitFor({ state: 'visible' });
      await dialog.getByRole('button', { name: advanced, exact: true }).click();
      const drawer = page.getByRole('dialog', { name: title, exact: true });
      await drawer.waitFor({ state: 'visible' });
      assert.equal(await drawer.getByLabel(cli, { exact: true }).count(), 1);
      assert.equal(await drawer.getByLabel(model, { exact: true }).count(), 1);
      assert.equal(
        await drawer.getByRole('button', { name: open, exact: true }).isDisabled(),
        true,
      );
      const calls = await page.evaluate(() => Reflect.get(window, 'calls'));
      assert.deepEqual(calls[0], {
        command: 'feature_prepare',
        scope: {
          contractVersion: 1,
          generation: 7,
          workspaceId: 'synthetic-workspace',
          featureId: '00000000-0000-4000-8000-000000000001',
          expectedRevision: 3,
        },
      });
      assert.ok(calls.some((call: { action: string }) => call.action === 'catalog'));
      assert.ok(
        calls.every(
          (call: { action?: string }) =>
            !call.action || ['snapshot', 'catalog'].includes(call.action),
        ),
      );
      await page.close();
    }
  } finally {
    await browser.close();
  }
});
