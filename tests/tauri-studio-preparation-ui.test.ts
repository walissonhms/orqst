// Static renderer only: no browser, native host, provider, Core or PTY is started.
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';

test('EN/PT preparation keeps CLI, model and Open primary and technical detail in Advanced', async () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'orqst-synthetic-preparation-ui-')));
  try {
    const output = join(directory, 'render.cjs');
    await build({
      stdin: {
        contents: `
          import React from 'react';
          import { renderToStaticMarkup } from 'react-dom/server';
          import { createInstance } from 'i18next';
          import { I18nextProvider } from 'react-i18next';
          import { TauriStudioPreparation } from './src/TauriStudioPreparation.tsx';
          import en from './src/locales/en-US.json';
          import pt from './src/locales/pt-BR.json';
          export async function render(language) {
            const i18n = createInstance();
            await i18n.init({ lng: language, fallbackLng: 'en-US', resources: {
              'en-US': { translation: en }, 'pt-BR': { translation: pt },
            }});
            return renderToStaticMarkup(React.createElement(I18nextProvider, { i18n },
              React.createElement(TauriStudioPreparation)));
          }
        `,
        resolveDir: resolve('apps/dashboard'),
        loader: 'tsx',
      },
      outfile: output,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'node24',
      logLevel: 'silent',
    });
    const renderer = (await import(pathToFileURL(output).href)) as {
      render(language: string): Promise<string>;
    };
    for (const [locale, cli, model, open, advanced] of [
      ['en-US', 'CLI provider', 'Model', 'Open', 'Advanced'],
      ['pt-BR', 'Provedor CLI', 'Modelo', 'Abrir', 'Avançado'],
    ]) {
      const markup = await renderer.render(locale!);
      const [primary, details] = markup.split('<details');
      assert.ok(primary && details);
      assert.ok(primary.includes(`aria-label="${cli}"`));
      assert.ok(primary.includes(`aria-label="${model}"`));
      assert.ok(primary.includes(`>${open}</button>`));
      assert.match(primary, /type="checkbox" disabled=""/);
      assert.ok(!primary.includes('checked=""'));
      assert.ok(!primary.includes('worker model'));
      assert.ok(details.includes(advanced!));
      assert.ok(details.startsWith(' class="studio-advanced">'));
      assert.ok(details.includes('Terminal count') || details.includes('Quantidade de terminais'));
      assert.ok(!primary.includes('<h2'));
      assert.ok(!primary.includes('running Core'));
      assert.ok(!primary.includes('Core em execução'));
      assert.ok(!markup.includes('empty disposable'));
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
