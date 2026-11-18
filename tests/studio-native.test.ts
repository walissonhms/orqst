// Synthetic fixtures only. No app, Core, PTY, provider or native grant is used.
import assert from 'node:assert/strict';
import test from 'node:test';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import {
  featureNativeRequestSchema,
  featureNativeSnapshotSchema,
  type FeatureNativeSnapshot,
} from '../packages/protocol/src/index.js';
import { arrangeRequest, studioTerminals } from '../apps/dashboard/src/studio-native.js';

const featureId = '00000000-0000-4000-8000-000000000001';
const t1 = '00000000-0000-4000-8000-000000000011';
const t2 = '00000000-0000-4000-8000-000000000012';
const t3 = '00000000-0000-4000-8000-000000000013';

function snapshot(): FeatureNativeSnapshot {
  return featureNativeSnapshotSchema.parse({
    contractVersion: 1,
    storage: 'core',
    generation: 7,
    workspace: { id: 'synthetic-workspace', name: 'Synthetic workspace' },
    features: [
      {
        featureId,
        workspaceId: 'synthetic-workspace',
        name: 'Synthetic feature',
        description: '',
        status: 'active',
        revision: 2,
        terminalIds: [t1, t2],
        orchestratorTerminalId: t2,
        schemaVersion: 1,
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    view: {
      contractVersion: 1,
      storage: 'core',
      workspaceId: 'synthetic-workspace',
      featureId,
      revision: 3,
    },
    activeFeatureId: featureId,
    slots: [
      { slot: 0, provider: 'codex', terminalId: t1, selectedModel: 'gpt-synthetic' },
      { slot: 1, provider: 'claude', terminalId: t2, selectedModel: null },
      { slot: 2, provider: 'opencode', terminalId: t3 },
    ],
    layoutSaved: true,
  });
}

test('studio terminals use only evidenced snapshot facts', () => {
  const now = 10_000;
  const terminals = studioTerminals(
    snapshot(),
    [],
    {
      observedAt: now - 1000,
      entries: [
        {
          slot: 1,
          terminalId: t2,
          state: 'running',
          startedAt: 1000,
          session: {
            provider: 'claude',
            sessionId: '00000000-0000-4000-8000-0000000000aa',
            bindingEvidence: 'claude-argv-receipt-transcript',
          },
          activities: [{ at: 2000, kind: 'tool', label: 'Read' }],
          usage: { input: 8, output: 2, cached: 3, total: 10 },
          agentState: 'completed',
          turnId: '00000000-0000-4000-8000-0000000000bb',
        },
      ],
    },
    now,
  );
  assert.deepEqual(
    terminals.map((t) => t.id),
    [t1, t2],
    'only members of the active Feature',
  );
  assert.equal(terminals[0]!.model, 'gpt-synthetic');
  assert.equal(terminals[0]!.name, 'Codex', 'the CLI name is shown, not the ID twice');
  assert.equal(terminals[0]!.startedAt, undefined);
  assert.equal(terminals[1]!.model, null, 'CLI default stays explicit');
  assert.equal(terminals[0]!.tokens, undefined);
  assert.deepEqual(terminals[1]!.tokens, { input: 8, output: 2, cached: 3, total: 10 });
  assert.equal(terminals[1]!.startedAt, 1000);
  assert.equal(terminals[1]!.lastActivity, 'Read');
  assert.equal(terminals[1]!.orchestrator, true);
  assert.equal(terminals[0]!.status, 'unknown', 'no turn evidence means unknown');
  assert.equal(terminals[1]!.status, 'completed', 'evidenced Claude turn state is shown');
  const stale = studioTerminals(
    snapshot(),
    [],
    { observedAt: 0, entries: [{ slot: 1, terminalId: t2, state: 'running', startedAt: 0 }] },
    60_000,
  );
  assert.equal(stale[1]!.startedAt, undefined, 'stale evidence is ignored');
});

test('arrange requests are valid for every mode and clip to the viewport', () => {
  const layout = [
    { id: t1, rect: { x: 0.4, y: 0, width: 600.7, height: 400 }, z: 0 },
    { id: t2, rect: { x: 610, y: 0, width: 9000, height: 400 }, z: 1 },
  ];
  for (const mode of ['mosaic', 'columns', 'rows', 'focus', 'list', 'free'] as const) {
    const request = arrangeRequest(
      snapshot(),
      [t1, t2],
      layout,
      mode,
      { width: 1200.6, height: 700 },
      undefined,
    );
    const parsed = featureNativeRequestSchema.safeParse({
      ...request,
      contractVersion: 1,
      generation: 7,
    });
    assert.ok(parsed.success, `${mode}: ${parsed.success ? '' : parsed.error.message}`);
    assert.equal(request.panes.length, 2, 'every member is sent once');
    for (const pane of request.panes)
      if (pane.rect) {
        assert.ok(Number.isInteger(pane.rect.x) && Number.isInteger(pane.rect.width));
        assert.ok(pane.rect.x + pane.rect.width <= 1200);
      }
    if (mode === 'list') assert.ok(request.panes.every((pane) => !pane.visible));
    if (mode === 'focus') assert.ok(request.panes.filter((pane) => pane.visible).length <= 1);
  }
  const full = arrangeRequest(
    snapshot(),
    [t1, t2],
    layout,
    'mosaic',
    { width: 1440, height: 815 },
    { sidebar: 0, top: 47, bottom: 38 },
  );
  assert.equal(full.layoutVersion, 2);
  assert.ok(
    featureNativeRequestSchema.safeParse({ ...full, contractVersion: 1, generation: 7 }).success,
    'version 2 with chrome is valid',
  );
  const hidden = arrangeRequest(snapshot(), [t1, t2], [{ id: t1, rect: null, z: 0 }], 'mosaic', {
    width: 1200,
    height: 700,
  });
  assert.ok(hidden.panes.every((pane) => pane.rect === null && !pane.visible));
});

test('native Studio sends PTY holes, hides overlays and follows the saved Feature label', async () => {
  const result = await build({
    stdin: {
      contents: `
        import React from 'react';
        import { createRoot } from 'react-dom/client';
        import { createInstance } from 'i18next';
        import { I18nextProvider } from 'react-i18next';
        import { FeatureWorkspace } from './src/FeatureWorkspace.tsx';
        import en from './src/locales/en-US.json';
        window.startFixture = async (snapshot) => {
          window.arrangeFrames = [];
          window.generation = snapshot.generation;
          window.featureUpdates = [];
          window.publishFeature = (changed) => {
            snapshot = { ...changed, generation: ++window.generation };
            window.dispatchEvent(new CustomEvent('orqst-feature-state', { detail: snapshot }));
          };
          window.orqstFeatures = {
            contractVersion: 1,
            // Each read may carry a newer generation, as the native host does.
            request: async (input) => {
              if (input.action === 'update') {
                window.featureUpdates.push(input);
                return { status: 'denied', snapshot: { ...snapshot, generation: window.generation } };
              }
              return { status: 'ok', snapshot: { ...snapshot, generation: window.generation } };
            },
            arrange: async (input) => { window.arrangeFrames.push(input); return { status: 'ok', snapshot }; },
          };
          const i18n = createInstance();
          await i18n.init({ lng: 'en-US', resources: { 'en-US': { translation: en } } });
          createRoot(document.getElementById('root')).render(
            <I18nextProvider i18n={i18n}><FeatureWorkspace nativeWorkspace /></I18nextProvider>,
          );
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
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    // The real layout needs the stylesheet, so load the CSS the bundle left out.
    const css = await build({
      entryPoints: [
        resolve('apps/dashboard/src/feature-workspace.css'),
        resolve('apps/dashboard/src/terminal-studio.css'),
        resolve('apps/dashboard/src/pane-menu.css'),
      ],
      bundle: true,
      write: false,
      logLevel: 'silent',
      outdir: 'out',
    });
    await page.setContent('<div id="root"></div>');
    for (const file of css.outputFiles) await page.addStyleTag({ content: file.text });
    await page.addScriptTag({ content: result.outputFiles[0]!.text });
    await page.evaluate((value) => Reflect.get(window, 'startFixture')(value), snapshot());
    await page.waitForFunction(() =>
      (Reflect.get(window, 'arrangeFrames') as unknown as { panes: { visible: boolean }[] }[]).some(
        (frame) => frame.panes.filter((pane) => pane.visible).length === 2,
      ),
    );
    type Frame = {
      mode: string;
      generation: number;
      viewport: { width: number; height: number };
      panes: {
        terminalId: string;
        visible: boolean;
        rect: null | { x: number; y: number; width: number; height: number };
      }[];
    };
    const frames = (await page.evaluate(() =>
      Reflect.get(window, 'arrangeFrames'),
    )) as unknown as Frame[];
    const last = frames.at(-1)!;
    assert.equal(last.generation, 7);
    // Compact immersive Studio keeps the toolbar and dock in the native insets.
    assert.deepEqual((last as unknown as { chrome: unknown }).chrome, {
      sidebar: 0,
      top: 36,
      bottom: 34,
    });
    assert.deepEqual(last.viewport, { width: 1440, height: 900 - 70 });
    assert.equal((await page.locator('.ts-toolbar').boundingBox())?.height, 36);
    assert.equal((await page.locator('.ts-dock').boundingBox())?.height, 34);
    assert.equal((await page.locator('.ts-head').first().boundingBox())?.height, 31);
    assert.deepEqual(last.panes.map((pane) => pane.terminalId).sort(), [t1, t2]);
    for (const pane of last.panes) {
      assert.ok(pane.rect);
      assert.ok(pane.rect.x >= 0 && pane.rect.y >= 0);
      assert.ok(pane.rect.x + pane.rect.width <= last.viewport.width);
      assert.ok(pane.rect.y + pane.rect.height <= last.viewport.height);
      assert.ok(pane.rect.y >= 30, 'the PTY starts below the pane header');
    }
    const [a, b] = last.panes.map((pane) => pane.rect!) as [
      { x: number; y: number; width: number; height: number },
      { x: number; y: number; width: number; height: number },
    ];
    assert.ok(
      a.x + a.width <= b.x ||
        b.x + b.width <= a.x ||
        a.y + a.height <= b.y ||
        b.y + b.height <= a.y,
      'tiled holes do not overlap',
    );
    // Opening the pane menu hides only the native views under it; closing it shows them again.
    await page.locator('.ts-pane').first().getByRole('button', { name: 'More actions' }).click();
    await page.waitForFunction(() => {
      const list = Reflect.get(window, 'arrangeFrames') as unknown as Frame[];
      const panes = list.at(-1)!.panes;
      return panes.some((pane) => !pane.visible) && panes.some((pane) => pane.visible);
    });
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => {
      const list = Reflect.get(window, 'arrangeFrames') as unknown as Frame[];
      return list.at(-1)!.panes.every((pane) => pane.visible);
    });
    // A new native generation hides the views; the Studio must resend its frame with it.
    await page.evaluate(() => Reflect.set(window, 'generation', 9));
    await page.waitForFunction(
      () => {
        const list = Reflect.get(window, 'arrangeFrames') as unknown as Frame[];
        const last = list.at(-1)!;
        return last.generation === 9 && last.panes.every((pane) => pane.visible);
      },
      undefined,
      { timeout: 10_000 },
    );
    const marked = page.getByRole('button', { name: 'Remove orchestrator label' });
    await marked.click();
    await page.waitForFunction(() => {
      const updates = Reflect.get(window, 'featureUpdates') as unknown[];
      return updates.length === 1;
    });
    await page
      .getByRole('region', { name: 'Terminals' })
      .getByText('Request refused. Check the current Feature and reviewed selection.', {
        exact: true,
      })
      .waitFor({ timeout: 5000 });
    assert.equal(
      await page.locator('.ts-crown[aria-pressed="true"]').count(),
      1,
      'a denied update leaves the saved label in view',
    );
    assert.deepEqual(await page.evaluate(() => Reflect.get(window, 'featureUpdates')), [
      {
        action: 'update',
        contractVersion: 1,
        generation: 9,
        featureId,
        input: { expectedRevision: 2, orchestratorTerminalId: null },
      },
    ]);

    const cleared = snapshot();
    cleared.features[0]!.orchestratorTerminalId = null;
    cleared.features[0]!.revision = 3;
    await page.evaluate((value) => Reflect.get(window, 'publishFeature')(value), cleared);
    await marked.waitFor({ state: 'detached', timeout: 5000 });
    assert.equal(await page.locator('.ts-role').count(), 0);
    assert.equal(
      await page
        .locator('.ts-pane[aria-label="T-002 Claude Code"] .ts-crown')
        .getAttribute('aria-pressed'),
      'false',
    );
    const unassigned = { ...cleared, activeFeatureId: null };
    await page.evaluate((value) => Reflect.get(window, 'publishFeature')(value), unassigned);
    await page.getByRole('article', { name: 'T-003 OpenCode' }).waitFor();
    assert.equal(await page.locator('.ts-crown').count(), 0);
    await page.close();
  } finally {
    await browser.close();
  }
});
