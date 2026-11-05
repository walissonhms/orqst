// Explicit renderer-only acceptance with the real layout controller. No host, PTY or provider.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
import { featureNativeRequestSchema, type FeatureNativeSnapshot } from '@orqst/protocol';
import { TauriTerminalLayout } from '../apps/desktop/src/tauri-terminal-layout.js';
import type { TerminalLayoutState } from '../apps/desktop/src/terminal-layout.js';
import en from '../apps/dashboard/src/locales/en-US.json';
import pt from '../apps/dashboard/src/locales/pt-BR.json';

assert.deepEqual(process.argv.slice(2), ['--authorize-synthetic-workspace-ui']);
assert.match(process.version, /^v24\./);
const output = resolve('dist/accept-terminal-workspace-ui');
await mkdir(output, { recursive: true });
const bundle = await build({
  stdin: {
    contents: `import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { FeatureWorkspace } from './FeatureWorkspace.tsx';
      import i18n from './i18n.ts';
      window.orqstFeatures = { contractVersion: 1, request: window.syntheticWorkspaceRequest,
        showPreparationDrawer: window.syntheticPreparation };
      window.orqstTerminalDock = { restore: window.syntheticRestore };
      await i18n.changeLanguage(navigator.language);
      createRoot(document.getElementById('root')).render(React.createElement(FeatureWorkspace, {nativeWorkspace:true}));`,
    resolveDir: resolve('apps/dashboard/src'),
    sourcefile: 'synthetic-workspace.tsx',
    loader: 'tsx',
  },
  outfile: 'workspace.js',
  bundle: true,
  platform: 'browser',
  target: 'es2022',
  format: 'esm',
  write: false,
  logLevel: 'silent',
});
const script = bundle.outputFiles.find((file) => file.path.endsWith('.js'))!.text;
const css = bundle.outputFiles.find((file) => file.path.endsWith('.css'))!.text;
const html = `<!doctype html><meta charset="utf-8"><style>body{margin:0}${css}</style>
  <div id="root"></div><script type="module">${script.replace(/<\/script/gi, '<\\/script')}</script>`;
const logo = await readFile('apps/dashboard/public/brand/orqst-logo-dark.svg');
const browser = await chromium.launch();
try {
  for (const [language, locale] of [
    ['en-US', en],
    ['pt-BR', pt],
  ] as const) {
    const page = await browser.newPage({
      locale: language,
      viewport: { width: 1440, height: 900 },
      reducedMotion: 'reduce',
    });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const ids = Array.from({ length: 4 }, () => randomUUID());
    let generation = 0;
    let nativeGeneration = 7;
    let prepared = 0;
    const snapshot = (): FeatureNativeSnapshot => ({
      contractVersion: 1,
      storage: 'core',
      generation,
      workspace: { id: 'synthetic-workspace', name: 'SYNTHETIC UI ONLY' },
      features: [],
      view: {
        contractVersion: 1,
        storage: 'core',
        workspaceId: 'synthetic-workspace',
        featureId: null,
        revision: 0,
      },
      activeFeatureId: null,
      slots: ids.map((terminalId, slot) => ({ slot, terminalId, provider: 'codex' })),
      layoutSaved: true,
    });
    let state: TerminalLayoutState;
    const publish = async () => {
      const panes = state.order.map((slot) => ({
        slot,
        label: state.names[slot] || `SYNTHETIC ${slot + 1}`,
        provider: 'Codex',
        minimized: !state.shown.includes(slot),
        visible: state.visible.includes(slot),
        active: state.active === slot,
        maximized: state.maximized === slot,
      }));
      await page.evaluate(
        (detail) => window.dispatchEvent(new CustomEvent('orqst-terminal-dock', { detail })),
        {
          generation: nativeGeneration,
          panes,
          hidden: panes
            .filter((pane) => pane.minimized)
            .map(({ slot, label, provider }) => ({ slot, label, provider })),
        },
      );
    };
    const layout = new TauriTerminalLayout(
      4,
      { save: () => {} },
      (packet) => {
        state = (packet as { state: TerminalLayoutState }).state;
      },
      () => {},
    );
    layout.context(layout.snapshot(), () => {});
    layout.resize(1440, 900);
    assert.deepEqual(state!.visible, [0, 1, 2, 3]);
    layout.setNativeGeneration(nativeGeneration);
    await page.exposeFunction('syntheticWorkspaceRequest', async (raw: unknown) => {
      const request = featureNativeRequestSchema.parse(raw);
      assert.equal(request.generation, generation);
      if (request.action !== 'snapshot') {
        layout.setNativeGeneration(++nativeGeneration);
        if (request.action === 'organize')
          assert.equal(
            layout.workspaceAct(
              state.active,
              request.command.startsWith('columns-')
                ? { columns: Number(request.command.slice(-1)) }
                : request.command,
            ),
            true,
          );
        else if (
          request.action === 'pane' ||
          request.action === 'renamePane' ||
          request.action === 'movePane'
        ) {
          assert.equal(ids[request.slot], request.terminalId);
          assert.equal(
            layout.workspaceAct(
              request.slot,
              request.action === 'pane'
                ? request.command
                : request.action === 'renamePane'
                  ? { name: request.name }
                  : { moveTo: request.beforeSlot },
            ),
            true,
          );
        } else throw new Error('Unexpected synthetic command');
        generation++;
      }
      await publish();
      return { status: 'ok', snapshot: snapshot() };
    });
    await page.exposeFunction('syntheticRestore', async (slot: number, epoch: number) => {
      assert.equal(layout.act(slot, 'reopen', epoch), true);
      await publish();
      return true;
    });
    await page.exposeFunction('syntheticPreparation', () => {
      prepared++;
      return { status: 'ok' };
    });
    await page.route('**/*', (route) =>
      route.fulfill({
        contentType: route.request().url().endsWith('.svg') ? 'image/svg+xml' : 'text/html',
        body: route.request().url().endsWith('.svg') ? logo : html,
      }),
    );
    await page.goto('https://synthetic-workspace.invalid/');
    const settle = () =>
      expect(page.locator('.feature-workspace')).toHaveAttribute('aria-busy', 'false');
    const tabs = page.locator('.feature-terminal-tab');
    const tools = page.locator('.feature-terminal-tools');
    await expect(tabs).toHaveCount(4);
    await settle();
    await tabs.nth(2).click();
    await settle();
    await expect(tabs.nth(2)).toHaveAttribute('aria-pressed', 'true');
    assert.deepEqual(state!.visible, [2]);
    await tools.getByRole('button', { name: locale.managedTerminal.minimize, exact: true }).click();
    await settle();
    const dock = page.getByRole('region', { name: locale.features.dockLabel, exact: true });
    await expect(dock.getByRole('button')).toHaveCount(1);
    assert.ok(!state!.shown.includes(2));
    await page.getByRole('button', { name: `▦ ${locale.features.grid}`, exact: true }).click();
    await settle();
    assert.ok(!state!.shown.includes(2));
    await tabs.nth(1).focus();
    await tabs.nth(1).press('F2');
    const rename = page.locator('.feature-pane-editor');
    await rename.getByRole('textbox').fill('<SYNTHETIC Backend>');
    await rename.getByRole('button', { name: locale.managedTerminal.rename, exact: true }).click();
    await settle();
    await expect(tabs.nth(1)).toContainText('<SYNTHETIC Backend>');
    assert.ok(!state!.shown.includes(2));
    await tabs.nth(1).dragTo(tabs.nth(0));
    await settle();
    await expect(tabs.nth(0)).toContainText('T-002');
    assert.deepEqual(state!.order, [1, 0, 2, 3]);
    await tabs.nth(0).press('Alt+ArrowRight');
    await settle();
    await expect(tabs.nth(1)).toContainText('T-002');
    assert.deepEqual(state!.order, [0, 1, 2, 3]);
    await page.screenshot({ path: resolve(output, `${language}-minimized.png`) });
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 720, height: 700 },
      { width: 390, height: 600 },
      { width: 320, height: 600 },
    ]) {
      await page.setViewportSize(viewport);
      layout.resize(viewport.width, viewport.height);
      await publish();
      const bounds = await dock.boundingBox();
      assert.ok(
        bounds && bounds.y >= viewport.height - 34 && bounds.y + bounds.height <= viewport.height,
      );
      const bar = await page.locator('.feature-terminalbar').boundingBox();
      assert.equal(bar?.y, 45);
      assert.equal(bar?.height, 36);
      assert.ok(!state!.shown.includes(2));
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
      );
    }
    await dock.getByRole('button').click();
    await expect(dock).toHaveCount(0);
    assert.equal(state!.shown.includes(2), true);
    await page.locator('.feature-terminal-add').click();
    assert.equal(prepared, 1);
    assert.deepEqual(errors, []);
    console.log(
      `${language}: 4 tabs, focus, minimize, persistent hidden state, rename, drag, keyboard reorder, dock bounds/restore and preparation navigation passed (renderer only)`,
    );
    await page.close();
  }
} finally {
  await browser.close();
}
