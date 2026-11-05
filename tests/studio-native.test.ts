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
  assert.equal(terminals[0]!.startedAt, undefined);
  assert.equal(terminals[1]!.model, null, 'CLI default stays explicit');
  assert.equal(terminals[1]!.startedAt, 1000);
  assert.equal(terminals[1]!.lastActivity, 'Read');
  assert.equal(terminals[1]!.orchestrator, true);
  assert.ok(
    terminals.every((t) => t.status === 'unknown'),
    'process state never becomes an agent state',
  );
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
    const request = arrangeRequest(snapshot(), [t1, t2], layout, mode, {
      width: 1200.6,
      height: 700,
    });
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
  const hidden = arrangeRequest(snapshot(), [t1, t2], [{ id: t1, rect: null, z: 0 }], 'mosaic', {
    width: 1200,
    height: 700,
  });
  assert.ok(hidden.panes.every((pane) => pane.rect === null && !pane.visible));
});

test('native Studio sends PTY holes and hides them under overlays', async () => {
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
          window.frames = [];
          window.orqstFeatures = {
            contractVersion: 1,
            request: async () => ({ status: 'ok', snapshot }),
            arrange: async (input) => { window.frames.push(input); return { status: 'ok', snapshot }; },
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
      (Reflect.get(window, 'frames') as { panes: { visible: boolean }[] }[]).some(
        (frame) => frame.panes.filter((pane) => pane.visible).length === 2,
      ),
    );
    type Frame = {
      mode: string;
      generation: number;
      viewport: { width: number; height: number };
      panes: { terminalId: string; visible: boolean; rect: null | Record<string, number> }[];
    };
    const frames = (await page.evaluate(() => Reflect.get(window, 'frames'))) as Frame[];
    const last = frames.at(-1)!;
    assert.equal(last.generation, 7);
    assert.deepEqual(last.viewport, { width: 1440 - 155, height: 900 - 115 });
    assert.deepEqual(last.panes.map((pane) => pane.terminalId).sort(), [t1, t2]);
    for (const pane of last.panes) {
      assert.ok(pane.rect);
      assert.ok(pane.rect.x >= 0 && pane.rect.y >= 0);
      assert.ok(pane.rect.x + pane.rect.width! <= last.viewport.width);
      assert.ok(pane.rect.y + pane.rect.height! <= last.viewport.height);
      assert.ok(pane.rect.y >= 30, 'the PTY starts below the pane header');
    }
    const [a, b] = last.panes.map((pane) => pane.rect!);
    assert.ok(
      a!.x + a!.width! <= b!.x! || b!.x! + b!.width! <= a!.x! || a!.y! + a!.height! <= b!.y!,
      'tiled holes do not overlap',
    );
    // Opening the pane menu hides every native view; closing it shows them again.
    await page.locator('.ts-pane').first().getByRole('button', { name: 'More actions' }).click();
    await page.waitForFunction(() => {
      const list = Reflect.get(window, 'frames') as Frame[];
      return list.at(-1)!.panes.every((pane) => !pane.visible);
    });
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => {
      const list = Reflect.get(window, 'frames') as Frame[];
      return list.at(-1)!.panes.every((pane) => pane.visible);
    });
    await page.close();
  } finally {
    await browser.close();
  }
});
