// Explicit renderer-only preview. Synthetic evidence is never staged into the native app.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
import type { FeatureNativeSnapshot } from '@orqst/protocol';
import en from '../apps/dashboard/src/locales/en-US.json';
import pt from '../apps/dashboard/src/locales/pt-BR.json';

assert.deepEqual(process.argv.slice(2), ['--authorize-synthetic-canvas-ui']);
assert.match(process.version, /^v24\./);
const output = resolve('dist/accept-feature-canvas-ui');
await mkdir(output, { recursive: true });
const bundle = await build({
  stdin: {
    contents: `import React, {useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {FeatureCanvas} from './apps/dashboard/src/FeatureCanvas.tsx';
    import {CanvasSessionList,CanvasStatusBar} from './apps/dashboard/src/FeatureCanvasSummary.tsx';
    import {FeatureWorkspace} from './apps/dashboard/src/FeatureWorkspace.tsx';
    import {installCanvasEscape} from './apps/tauri/src/terminal-escape.ts';
    import {syntheticCanvas} from './tests/fixtures/feature-canvas.ts';
    import './apps/dashboard/src/feature-workspace.css';
    import i18n from './apps/dashboard/src/i18n.ts';
    window.orqstFeatures = {contractVersion:1,request:window.syntheticRequest};
    installCanvasEscape(()=>window.syntheticEscape());
    await i18n.changeLanguage(navigator.language);
    function SyntheticReference(){
      const {agents,groups,journal}=syntheticCanvas();
      const [query,setQuery]=useState('');
      return <section className="feature-workspace feature-native feature-canvas-mode" aria-label="SYNTHETIC RENDERER ONLY">
        <aside className="feature-sidebar"><div className="feature-brand"><img src="/brand.svg" alt="ORQST" /></div>
          <div className="feature-project">SYNTHETIC UI ONLY</div><label className="canvas-search"><span>{i18n.t('canvas.search')} ⌘K</span><input aria-label={i18n.t('canvas.search')} value={query} onChange={e=>setQuery(e.target.value)} /></label>
          <button className="feature-create" onClick={()=>window.syntheticPrepare()}>＋ {i18n.t('canvas.newSession')} ⌘N</button>
          <CanvasSessionList agents={agents} query={query} busy={false} onOpen={a=>window.syntheticOpen(a.slot)}/>
        </aside>
        <header className="feature-topbar"><strong>SYNTHETIC UI ONLY / Feature canvas</strong></header>
        <nav className="feature-terminalbar canvas-feature-tabs"><button className="active">SYNTHETIC Feature <span className="canvas-attention-dot" /></button></nav>
        <div className="feature-surface"><FeatureCanvas agents={agents.filter(a=>a.title.toLowerCase().includes(query.toLowerCase()))} groups={groups} journal={journal} onOpen={a=>window.syntheticOpen(a.slot)} onPrepare={()=>window.syntheticPrepare()}/></div>
        <footer className="feature-bottom"><CanvasStatusBar agents={agents} connected={false}/></footer>
      </section>;
    }
    createRoot(document.getElementById('root')).render(location.pathname==='/reference' ? <SyntheticReference/> : <FeatureWorkspace onPrepare={()=>window.syntheticPrepare()} />);`,
    sourcefile: 'synthetic-canvas.tsx',
    resolveDir: resolve('.'),
    loader: 'tsx',
  },
  outfile: 'canvas.js',
  nodePaths: [resolve('apps/dashboard/node_modules')],
  bundle: true,
  platform: 'browser',
  target: 'es2022',
  format: 'esm',
  write: false,
  logLevel: 'silent',
});
const script = bundle.outputFiles.find((file) => file.path.endsWith('.js'))!.text;
const css = bundle.outputFiles.find((file) => file.path.endsWith('.css'))!.text;
const logo = await readFile('apps/dashboard/public/brand/orqst-logo-dark.svg');
const html = `<!doctype html><meta charset="utf-8"><style>body{margin:0}${css}.feature-workspace{height:100vh;min-height:0}</style><div id="root"></div><script type="module">${script.replace(/<\/script/gi, '<\\/script')}</script>`;
const ids = Array.from({ length: 3 }, () => randomUUID());
const snapshot: FeatureNativeSnapshot = {
  contractVersion: 1,
  storage: 'core',
  generation: 0,
  workspace: { id: 'synthetic-workspace', name: 'SYNTHETIC UI ONLY' },
  features: [
    {
      schemaVersion: 1,
      featureId: 'e10636eb-3a12-4094-9123-49a4cdad27b8',
      workspaceId: 'synthetic-workspace',
      name: 'SYNTHETIC feature',
      description: '',
      status: 'planned',
      revision: 1,
      terminalIds: [],
      createdAt: 0,
      updatedAt: 0,
    },
  ],
  activeFeatureId: null,
  view: {
    contractVersion: 1,
    storage: 'core',
    workspaceId: 'synthetic-workspace',
    featureId: null,
    revision: 0,
  },
  slots: ids.map((terminalId, slot) => ({ slot, terminalId, provider: 'codex' })),
  layoutSaved: true,
};
const browser = await chromium.launch();
const captures: string[] = [];
try {
  for (const [language, locale] of [
    ['en-US', en],
    ['pt-BR', pt],
  ] as const) {
    for (const width of [1440, 390]) {
      const page = await browser.newPage({
        locale: language,
        viewport: { width, height: 900 },
        reducedMotion: 'reduce',
      });
      const errors: string[] = [];
      const opened: number[] = [];
      const commands: unknown[] = [];
      let liveSnapshot = structuredClone(snapshot);
      let prepares = 0;
      let escapes = 0;
      page.on('pageerror', (error) => errors.push(error.message));
      await page.exposeFunction('syntheticOpen', (slot: number) => {
        opened.push(slot);
      });
      await page.exposeFunction('syntheticPrepare', () => {
        prepares++;
      });
      await page.exposeFunction('syntheticEscape', () => {
        escapes++;
      });
      await page.exposeFunction('syntheticRequest', (request: unknown) => {
        commands.push(request);
        const input = request as { action: string; featureId?: string | null };
        if (input.action === 'select') {
          liveSnapshot = {
            ...liveSnapshot,
            generation: liveSnapshot.generation + 1,
            activeFeatureId: input.featureId ?? null,
            view: {
              ...liveSnapshot.view,
              featureId: input.featureId ?? null,
              revision: liveSnapshot.view.revision + 1,
            },
          };
        }
        return { status: 'ok', snapshot: liveSnapshot };
      });
      await page.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        if (url.pathname.endsWith('.svg'))
          return route.fulfill({ contentType: 'image/svg+xml', body: logo });
        return route.fulfill({ contentType: 'text/html', body: html });
      });
      await page.goto('http://127.0.0.1:14917/reference');
      await expect(page.locator('.canvas-agent')).toHaveCount(7);
      await expect(page.locator('.canvas-edges path')).toHaveCount(6);
      await expect(page.locator('.canvas-group')).toHaveCount(3);
      await expect(
        page.getByRole('button', { name: locale.canvas.reply, exact: true }),
      ).toHaveCount(1);
      await expect(page.locator('.canvas-agent-activities > div')).toHaveCount(21);
      await page.screenshot({
        path: resolve(output, `${language}-${width}-synthetic-evidence.png`),
      });
      captures.push(`${language}-${width}-synthetic-evidence.png`);
      const zoom = page.getByRole('status', { name: locale.canvas.zoom });
      const initialZoom = await zoom.textContent();
      await page.getByRole('button', { name: locale.canvas.zoomIn, exact: true }).click();
      await expect(zoom).not.toHaveText(initialZoom!);
      await page.getByRole('button', { name: locale.canvas.fit, exact: true }).click();
      await page.getByRole('button', { name: locale.canvas.pan, exact: true }).click();
      const card = await page.locator('.canvas-agent-heading').first().boundingBox();
      assert.ok(card);
      const panBefore = await page.locator('.canvas-world').getAttribute('style');
      await page.mouse.move(card.x + 20, card.y + 15);
      await page.mouse.down();
      await page.mouse.move(card.x + 55, card.y + 45, { steps: 4 });
      await page.mouse.up();
      assert.notEqual(await page.locator('.canvas-world').getAttribute('style'), panBefore);
      assert.deepEqual(opened, []);
      await page.getByRole('button', { name: locale.canvas.select, exact: true }).click();
      await page.getByRole('button', { name: locale.canvas.fit, exact: true }).click();
      await page.getByRole('button', { name: locale.canvas.reply, exact: true }).click();
      assert.equal(opened.at(-1), 4);
      await page
        .getByRole('button', { name: locale.canvas.newSession, exact: true })
        .last()
        .click();
      assert.equal(prepares, 1);
      const before = await page.locator('.canvas-world').getAttribute('style');
      await page.getByRole('region', { name: locale.canvas.title, exact: true }).focus();
      await page.keyboard.press('ArrowRight');
      assert.notEqual(await page.locator('.canvas-world').getAttribute('style'), before);
      if (width === 1440) {
        await page.getByRole('textbox', { name: locale.canvas.search }).fill('Inspect keyboard');
        await expect(page.locator('.canvas-agent')).toHaveCount(1);
        await page.locator('.canvas-agent-heading').click();
        assert.equal(opened.at(-1), 6);
      }
      await page.evaluate(() => {
        const button = document.createElement('button');
        button.id = 'canvas';
        document.body.append(button);
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      });
      assert.equal(escapes, 0); // Synthetic DOM events never invoke the native action.
      await page.keyboard.press('Escape');
      await expect.poll(() => escapes).toBe(1);
      await page.evaluate(() => {
        const menu = document.createElement('details');
        menu.id = 'pane-menu';
        menu.open = true;
        document.body.append(menu);
      });
      await page.keyboard.press('Escape');
      assert.equal(escapes, 1);
      await page.goto('http://127.0.0.1:14917/native-metadata');
      await expect(page.locator('.canvas-agent')).toHaveCount(3);
      await expect(page.locator('.canvas-edges path')).toHaveCount(0);
      await expect(page.getByText(locale.canvas.modelUnavailable, { exact: true })).toHaveCount(3);
      await expect(page.getByText(locale.canvas.statusUnavailable, { exact: true })).toHaveCount(3);
      // Captures use the actual production FeatureWorkspace with metadata-only cards.
      await page.screenshot({
        path: resolve(output, `${language}-${width}-metadata-unavailable.png`),
      });
      captures.push(`${language}-${width}-metadata-unavailable.png`);
      await page.locator('.canvas-agent-heading').first().click();
      assert.ok(
        commands.some(
          (request) =>
            (request as { action: string; terminalId?: string }).action === 'pane' &&
            (request as { terminalId: string }).terminalId === ids[0],
        ),
      );
      if (width === 1440) {
        await page.keyboard.press('Meta+k');
        await expect(page.getByRole('textbox', { name: locale.canvas.search })).toBeFocused();
        await page.keyboard.press('Meta+n');
        assert.equal(prepares, 2);
      }
      await page.getByRole('button', { name: 'SYNTHETIC feature', exact: true }).click();
      await expect(page.locator('.canvas-agent')).toHaveCount(0);
      await page.getByRole('button', { name: locale.features.unassigned, exact: true }).click();
      await expect(page.locator('.canvas-agent')).toHaveCount(3);
      assert.equal(
        await page.locator('body').evaluate((body) => body.scrollWidth <= window.innerWidth),
        true,
      );
      assert.deepEqual(errors, []);
      await page.close();
    }
  }
  await writeFile(
    resolve(output, 'report.json'),
    JSON.stringify(
      {
        rendererOnly: true,
        synthetic: true,
        providerStarted: false,
        nativeAcceptance: false,
        captures,
      },
      null,
      2,
    ) + '\n',
  );
  process.stdout.write(JSON.stringify({ passed: true, output, captures }) + '\n');
} finally {
  await browser.close();
}
