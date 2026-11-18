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
  assert.equal(terminals[0]!.alias, 'T-001');
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
    // The approved shell reports the same insets that it renders.
    assert.deepEqual((last as unknown as { chrome: unknown }).chrome, {
      sidebar: 155,
      top: 45,
      bottom: 33,
    });
    assert.deepEqual(last.viewport, { width: 1440 - 155, height: 900 - 45 - 33 });
    assert.equal((await page.locator('.ts-toolbar').boundingBox())?.height, 45);
    assert.equal((await page.locator('.ts-dock').boundingBox())?.height, 33);
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
    const rolePane = page.locator(`[data-pane-id="${t2}"]`);
    await rolePane.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: 'Remove orchestrator label' }).click();
    await page.waitForFunction(() => {
      const updates = Reflect.get(window, 'featureUpdates') as unknown[];
      return updates.length === 1;
    });
    await page
      .locator('.feature-feedback')
      .getByText('Request refused. Check the current Feature and reviewed selection.', {
        exact: true,
      })
      .waitFor({ timeout: 5000 });
    assert.equal(
      await rolePane.locator('.ts-role').count(),
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
    await rolePane.locator('.ts-role').waitFor({ state: 'detached', timeout: 5000 });
    assert.equal(await page.locator('.ts-role').count(), 0);
    const unassigned = { ...cleared, activeFeatureId: null, view: { ...cleared.view, featureId: null } };
    await page.evaluate((value) => Reflect.get(window, 'publishFeature')(value), unassigned);
    await page.getByRole('article', { name: 'T-003 OpenCode' }).waitFor();
    assert.equal(await page.locator('.ts-crown').count(), 0);
    await page.close();
  } finally {
    await browser.close();
  }
});

test('V6 pane controls preserve document IDs and publish bounded Feature geometry', async () => {
  const { mkdir } = await import('node:fs/promises');
  const { nativeChrome } = await import('../apps/dashboard/src/studio-native.js');
  const terminalIds = [t1, t2, t3, '00000000-0000-4000-8000-000000000014'];
  const input = snapshot();
  const selected = input.features[0]!;
  selected.terminalIds = terminalIds;
  input.slots.push({ slot: 3, provider: 'codex', terminalId: terminalIds[3]! });
  const data = studioTerminals(input, [], undefined, 1000).map((terminal, index) => ({
    ...terminal,
    alias: `test-${index + 1}`,
    name: `Fixture ${index + 1}`,
    model: terminal.model ?? null,
    active: index === 0,
  }));
  const result = await build({
    stdin: {
      contents: `
        import React, { useRef, useState } from 'react';
        import { createRoot } from 'react-dom/client';
        import { createInstance } from 'i18next';
        import { I18nextProvider } from 'react-i18next';
        import { TerminalStudio } from './src/TerminalStudio.tsx';
        import { arrangeRequest, nativeChrome } from './src/studio-native.ts';
        import en from './src/locales/en-US.json';
        import pt from './src/locales/pt-BR.json';
        import './src/feature-shell.css';
        import './src/new-terminal-dialog.css';
        window.framesSeen = [];
        window.mountStudio = async (snapshot, terminals) => {
          const i18n = createInstance();
          await i18n.init({ lng: 'pt-BR', resources: {
            'en-US': {translation: en}, 'pt-BR': {translation: pt},
          } });
          function Fixture() {
            const controls = useRef(null);
            const [orchestrator, setOrchestrator] = useState(null);
            return <div style={{display:'grid',gridTemplateColumns:'155px minmax(0,1fr)',height:'100%'}}>
              <aside style={{background:'#0b0c12',borderRight:'1px solid #262334',padding:'14px'}}>
                <strong>ORQST</strong>
                <p>{snapshot.workspace.name}</p>
                <p>{snapshot.features[0].name}</p>
              </aside>
              <TerminalStudio
                v6={{
                  featureName:snapshot.features[0].name,
                  layoutControlsRef:controls,
                  onDuplicateConfig:(draft) => {window.duplicateDraft = draft;},
                }}
                storageKey="synthetic-lane3"
                terminals={terminals}
                messages={[]}
                toolbarStart={<strong>{snapshot.workspace.name} / {snapshot.features[0].name}</strong>}
                toolbarEnd={<div style={{marginInlineStart:'auto',display:'flex',gap:'6px'}}>
                  <button className="ts-ghost" type="button" onClick={() => controls.current?.toggleGrid()}>Grade</button>
                  <button className="ts-ghost" type="button" onClick={() => controls.current?.restore()}>Restaurar</button>
                </div>}
                renderBody={() => null}
                native={{onLayout:(holes,mode) => {
                  const chrome = nativeChrome(false, innerWidth, 'v6');
                  const frame = {...arrangeRequest(snapshot, terminals.map(({id}) => id), holes, mode, {
                    width:innerWidth-chrome.sidebar, height:innerHeight-chrome.top-chrome.bottom,
                  }, chrome), contractVersion:1,generation:snapshot.generation};
                  window.framesSeen.push(frame);
                }}}
                orchestratorLabel={orchestrator}
                onOrchestratorChange={setOrchestrator}
                onCloseTerminal={(id) => {window.reviewedCloseTarget = id;}}
              />
            </div>;
          }
          createRoot(document.getElementById('root')).render(
            <I18nextProvider i18n={i18n}><Fixture /></I18nextProvider>,
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
    write: false,
    outdir: 'unused-studio-v6-fixture',
    logLevel: 'silent',
  });
  const script = result.outputFiles.find(({ path }) => path.endsWith('.js'))!;
  const css = result.outputFiles.find(({ path }) => path.endsWith('.css'))!;
  const browser = await chromium.launch({ headless: true });
  try {
    for (const [width, height] of [
      [1440, 900],
      [1280, 800],
    ] as const) {
      const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce' });
      const output = process.env.ORQST_LANE3_CAPTURE;
      const folder = output ? resolve(output, `${width}x${height}`) : undefined;
      if (folder) await mkdir(folder, { recursive: true });
      const capture = async (name: string) => {
        if (folder)
          await page.screenshot({ path: resolve(folder, `${name}.png`), animations: 'disabled' });
      };
      const currentFrame = async () =>
        featureNativeRequestSchema.parse(
          await page.evaluate(() => (Reflect.get(window, 'framesSeen') as unknown[]).at(-1)),
        );
      const first = () => page.locator(`[data-pane-id="${t1}"]`);
      const menu = () => page.getByRole('menu');
      const openMenu = async () => {
        await first().locator('.ts-more').click();
        await menu().waitFor();
      };
      await page.route('http://synthetic-v6.invalid/', (route) =>
        route.fulfill({ contentType: 'text/html', body: '<!doctype html><div id="root"></div>' }),
      );
      await page.goto('http://synthetic-v6.invalid/');
      await page.addStyleTag({ content: css.text });
      await page.addScriptTag({ content: script.text });
      await page.evaluate(({ input, data }) => Reflect.get(window, 'mountStudio')(input, data), {
        input,
        data,
      });
      await page.waitForFunction(() => {
        const frames = Reflect.get(window, 'framesSeen') as { panes: { visible: boolean }[] }[];
        return frames.at(-1)?.panes.filter(({ visible }) => visible).length === 4;
      });
      assert.deepEqual(nativeChrome(false, width, 'v6'), { sidebar: 155, top: 45, bottom: 33 });
      assert.equal((await page.locator('.ts-toolbar').boundingBox())?.height, 45);
      assert.equal((await page.locator('.ts-dock').boundingBox())?.height, 33);
      assert.equal((await first().locator('.ts-head').boundingBox())?.height, 31);
      assert.equal(await first().locator('.ts-head .ts-meta').count(), 0);
      const summary = (await page.locator('.ts-dock .ts-summary').boundingBox())!;
      assert.equal(Math.round(width - summary.x - summary.width), 9);
      assert.equal(
        await first().evaluate((element) => getComputedStyle(element).borderRadius),
        '0px',
      );
      assert.equal(await page.locator('.ts-modes').count(), 0);
      const firstBox = (await first().boundingBox())!;
      assert.deepEqual([firstBox.x, firstBox.y], [159, 49]);
      const secondBox = (await page.locator(`[data-pane-id="${t2}"]`).boundingBox())!;
      assert.equal(secondBox.x - firstBox.x - firstBox.width, 5);
      const frame = await currentFrame();
      assert.equal(frame.action, 'arrange');
      if (frame.action !== 'arrange') throw new Error('Missing arrangement');
      assert.deepEqual(
        frame.panes.map(({ terminalId }) => terminalId),
        terminalIds,
      );
      assert.ok(frame.panes.every(({ rect }) => rect && rect.x >= 4 && rect.y >= 35));
      await capture('01-grid');

      await page.getByRole('button', { name: 'Grade', exact: true }).click();
      await page.waitForFunction(
        () => (Reflect.get(window, 'framesSeen') as { mode: string }[]).at(-1)?.mode === 'columns',
      );
      await capture('02-columns');
      await page.getByRole('button', { name: 'Restaurar', exact: true }).click();
      await page.waitForFunction(
        () => (Reflect.get(window, 'framesSeen') as { mode: string }[]).at(-1)?.mode === 'mosaic',
      );
      await capture('03-grid-restored');
      const divider = page.locator('.ts-track.ts-split-columns').first();
      const dividerBox = (await divider.boundingBox())!;
      assert.equal(dividerBox.width, 5);
      assert.equal(dividerBox.height, height - 86);
      await page.mouse.move(dividerBox.x + 2, dividerBox.y + 50);
      await page.mouse.down();
      await page.mouse.move(dividerBox.x + 50, dividerBox.y + 50, { steps: 4 });
      await page.mouse.up();
      const draggedWidth = (await first().boundingBox())!.width;
      assert.ok(draggedWidth > firstBox.width);
      await divider.press('ArrowRight');
      assert.ok((await first().boundingBox())!.width > draggedWidth);
      await capture('04-divider-resized');

      const header = (await first().locator('.ts-head').boundingBox())!;
      const target = (await page.locator(`[data-pane-id="${t2}"]`).boundingBox())!;
      await page.mouse.move(header.x + 50, header.y + 14);
      await page.mouse.down();
      await page.mouse.move(target.x + 80, target.y + 22, { steps: 5 });
      await page.mouse.up();
      assert.ok((await first().boundingBox())!.x > firstBox.x);
      await capture('05-dock-swap');

      await openMenu();
      assert.equal((await menu().boundingBox())?.width, 215);
      await page.waitForFunction(() =>
        (
          Reflect.get(window, 'framesSeen') as {
            panes: { visible: boolean }[];
          }[]
        )
          .at(-1)!
          .panes.some(({ visible }) => !visible),
      );
      await capture('06-pane-menu');
      await menu().getByRole('menuitem', { name: 'Configurações / renomear' }).click();
      await page.getByRole('dialog').waitFor();
      assert.ok((await page.getByRole('dialog').textContent())?.includes('test-1'));
      await capture('07-pane-details');
      await page.keyboard.press('Escape');

      await openMenu();
      await menu().getByRole('menuitem', { name: 'Tornar flutuante' }).click();
      const floating = page.locator('.ts-floating');
      await floating.waitFor();
      assert.equal(await floating.count(), 1);
      assert.equal(await page.locator('.ts-dock-slot').count(), 1);
      const floatingFrame = await currentFrame();
      assert.equal(floatingFrame.action === 'arrange' && floatingFrame.mode, 'free');
      await capture('08-floating');

      const floatBox = (await floating.boundingBox())!;
      const floatHeader = (await floating.locator('.ts-head').boundingBox())!;
      await page.mouse.move(floatHeader.x + 55, floatHeader.y + 10);
      await page.mouse.down();
      await page.mouse.move(floatHeader.x + 140, floatHeader.y + 90, { steps: 6 });
      await page.mouse.up();
      assert.ok((await floating.boundingBox())!.x > floatBox.x);
      const handle = (await floating.locator('.ts-edge-se').boundingBox())!;
      await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
      await page.mouse.down();
      await page.mouse.move(handle.x + 40, handle.y + 50, { steps: 4 });
      await page.mouse.up();
      assert.ok((await floating.boundingBox())!.width > floatBox.width);
      await capture('09-floating-resized');
      await openMenu();
      await capture('10-floating-menu');
      await menu().getByRole('menuitem', { name: 'Encaixar na grade' }).click();
      assert.equal(await floating.count(), 0);

      await first().getByRole('button', { name: 'Maximizar', exact: true }).click();
      assert.deepEqual(await first().boundingBox(), {
        x: 159,
        y: 49,
        width: width - 163,
        height: height - 86,
      });
      await capture('11-maximized');
      await first().getByRole('button', { name: 'Restaurar', exact: true }).click();
      await first().getByRole('button', { name: 'Minimizar', exact: true }).click();
      assert.equal(await first().count(), 0);
      await page.getByTitle('Restaurar Fixture 1').waitFor();
      assert.ok((await page.locator('.ts-dock').textContent())?.includes('4 terminais'));
      await capture('12-minimized');
      await page.getByTitle('Restaurar Fixture 1').click();
      await first().waitFor();
      await capture('13-restored');

      await openMenu();
      await capture('14-duplicate-config');
      await menu().getByRole('menuitem', { name: 'Duplicar configuração' }).click();
      assert.deepEqual(await page.evaluate(() => Reflect.get(window, 'duplicateDraft')), {
        sourceTerminalId: t1,
        name: 'Fixture 1',
        provider: 'codex',
        model: 'gpt-synthetic',
      });
      await openMenu();
      await menu().getByRole('menuitem', { name: 'Marcar como Orquestrador' }).click();
      await first().locator('.ts-role').waitFor();
      await capture('15-role');
      await first().locator('.ts-close').click();
      assert.equal(await page.evaluate(() => Reflect.get(window, 'reviewedCloseTarget')), t1);
      assert.equal(await first().count(), 1, 'the host still owns native close and confirmation');
      await page.close();
    }
  } finally {
    await browser.close();
  }
});
