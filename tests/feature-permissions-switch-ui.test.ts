// Synthetic headless renderer; no native application or provider is started.
import assert from 'node:assert/strict';
import test from 'node:test';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';

test('switching Features discards old permission reads and proposals', async () => {
  const bundle = await build({
    stdin: {
      contents: `
        import React, { useState } from 'react';
        import { createRoot } from 'react-dom/client';
        import { createInstance } from 'i18next';
        import { I18nextProvider } from 'react-i18next';
        import { FeaturePermissions } from './src/FeaturePermissions.tsx';
        import en from './src/locales/en-US.json';
        window.pending = [];
        window.calls = [];
        window.orqstFeaturePermissions = {
          read: (id) => new Promise(resolve => window.pending.push({id, resolve})),
          propose: async (request) => { window.calls.push(request); if (window.rejectProposal) throw new Error('response lost after commit'); return {status:'ok'}; },
        };
        const i18n = createInstance();
        await i18n.init({lng:'en-US', resources:{'en-US':{translation:en}}});
        function Fixture() {
          const [id, setId] = useState('a');
          window.switchFeature = setId;
          return <I18nextProvider i18n={i18n}><FeaturePermissions feature={{featureId:id}} /></I18nextProvider>;
        }
        createRoot(document.getElementById('root')).render(<Fixture />);
      `,
      resolveDir: resolve('apps/dashboard'),
      loader: 'tsx',
    },
    bundle: true,
    platform: 'browser',
    format: 'esm',
    target: 'safari17',
    write: false,
    logLevel: 'silent',
  });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<div id="root"></div>');
    await page.addScriptTag({ type: 'module', content: bundle.outputFiles[0]!.text });
    await page.waitForFunction(() => Reflect.get(window, 'pending')?.length === 1);
    const propose = page.getByRole('button', { name: 'Review and save policy' });
    await page.evaluate(() =>
      Reflect.get(window, 'pending')[0].resolve({
        status: 'ok',
        permissions: { revision: 7, configuration: null },
      }),
    );
    await page.waitForFunction(() => !document.querySelector('button')?.disabled);
    await page.evaluate(() => Reflect.get(window, 'switchFeature')('b'));
    await page.waitForFunction(() => Reflect.get(window, 'pending')?.length === 2);
    assert.equal(await propose.isDisabled(), true);
    await page.evaluate(() => Reflect.get(window, 'pending')[1].resolve({ status: 'denied' }));
    await page.getByText('The request was refused.').waitFor();
    await page.getByRole('button', { name: 'Refresh' }).click();
    await page.waitForFunction(() => Reflect.get(window, 'pending')?.length === 3);
    await page.evaluate(() =>
      Reflect.get(window, 'pending')[2].resolve({
        status: 'ok',
        permissions: { revision: 8, configuration: null },
      }),
    );
    await page.waitForFunction(() => !document.querySelector('button')?.disabled);
    await page.evaluate(() => Reflect.get(window, 'switchFeature')('a'));
    await page.waitForFunction(() => Reflect.get(window, 'pending')?.length === 4);
    assert.equal(await propose.isDisabled(), true);
    await page.evaluate(() =>
      Reflect.get(window, 'pending')[3].resolve({
        status: 'ok',
        permissions: { revision: 9, configuration: null },
      }),
    );
    await page.waitForFunction(() => !document.querySelector('button')?.disabled);
    await page.evaluate(() => Reflect.set(window, 'rejectProposal', true));
    await propose.click();
    await page
      .getByText(
        'The policy save may have completed. Read the current policy before proposing another change.',
      )
      .waitFor();
    assert.equal(await propose.isDisabled(), true);
    const calls = await page.evaluate(() => Reflect.get(window, 'calls'));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].featureId, 'a');
    assert.equal(calls[0].expectedRevision, 9);
    await page.getByRole('button', { name: 'Refresh' }).click();
    await page.waitForFunction(() => Reflect.get(window, 'pending')?.length === 5);
    await page.evaluate(() =>
      Reflect.get(window, 'pending')[4].resolve({
        status: 'ok',
        permissions: { revision: 10, configuration: null },
      }),
    );
    await page.waitForFunction(() => !document.querySelector('button')?.disabled);
    await page.evaluate(() => Reflect.set(window, 'rejectProposal', false));
    await propose.click();
    const afterRefresh = await page.evaluate(() => Reflect.get(window, 'calls'));
    assert.equal(afterRefresh.length, 2);
    assert.equal(afterRefresh[1].expectedRevision, 10);
    await page.evaluate(() => Reflect.get(window, 'switchFeature')('b'));
    await page.waitForFunction(() => Reflect.get(window, 'pending')?.length === 6);
    await page.evaluate(() => Reflect.get(window, 'switchFeature')('a'));
    await page.waitForFunction(() => Reflect.get(window, 'pending')?.length === 7);
    await page.evaluate(() =>
      Reflect.get(window, 'pending')[5].resolve({
        status: 'ok',
        permissions: { revision: 88, configuration: null },
      }),
    );
    assert.equal(await propose.isDisabled(), true);
    await page.evaluate(() =>
      Reflect.get(window, 'pending')[6].resolve({
        status: 'ok',
        permissions: { revision: 11, configuration: null },
      }),
    );
    await page.waitForFunction(() => !document.querySelector('button')?.disabled);
    await propose.click();
    const finalCalls = await page.evaluate(() => Reflect.get(window, 'calls'));
    assert.equal(finalCalls[2].featureId, 'a');
    assert.equal(finalCalls[2].expectedRevision, 11);
  } finally {
    await browser.close();
  }
});
