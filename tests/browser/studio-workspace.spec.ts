import { expect, test, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { join } from 'node:path';
import {
  featureNativeSnapshotSchema,
  type FeatureNativeRequest,
  type FeatureNativeSnapshot,
  type FeaturePreparationRequest,
  type WorkspaceFeature,
} from '@orqst/protocol';

// Renderer-only facades: no native runtime, terminal process or execution grant.
test('Studio fills the viewport with one workspace and keeps preparation in a dismissible drawer', async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    Reflect.set(window, 'featureCalls', []);
    Reflect.set(window, 'studioCalls', []);
    Object.defineProperty(window, 'orqstFeatures', {
      value: {
        contractVersion: 1,
        async request({ action }: { action: string }) {
          (Reflect.get(window, 'featureCalls') as string[]).push(action);
          return { status: 'unavailable' };
        },
      },
    });
    Object.defineProperty(window, 'orqstTauriStudio', {
      value: {
        contractVersion: 1,
        async request({ action }: { action: string }) {
          (Reflect.get(window, 'studioCalls') as string[]).push(action);
          return { status: 'denied' };
        },
      },
    });
  });
  await page.goto('/studio');
  const workspace = page.locator('.studio-workspace > .feature-workspace');
  await expect(workspace).toBeVisible();
  await expect(workspace.locator('.feature-core')).toHaveAttribute('data-state', 'unavailable');
  await expect(page.locator('#app-sidebar')).toBeHidden();
  await expect(page.locator('.main-shell > .topbar')).toBeHidden();
  await expect(page.locator('.app-footer')).toBeHidden();
  await expect(page.locator('.feature-workspace')).toHaveCount(1);
  for (const [width, height] of [
    [1440, 900],
    [720, 700],
    [390, 600],
    [320, 600],
  ]) {
    await page.setViewportSize({ width: width!, height: height! });
    await expect.poll(() => workspace.boundingBox()).toEqual({ x: 0, y: 0, width, height });
    expect(
      await page.evaluate(() => ({
        width: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight,
      })),
    ).toEqual({ width, height });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: '＋ Terminal', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'New terminals', exact: true });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText(/the action was refused/i)).toBeVisible();
  await expect(drawer.getByRole('button', { name: 'Refresh selection' })).toBeVisible();
  await expect(drawer.getByRole('button', { name: 'Open', exact: true })).toHaveCount(0);
  await expect(page.locator('.feature-workspace')).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath('studio-preparation-en.png') });
  await page.setViewportSize({ width: 390, height: 600 });
  expect((await drawer.boundingBox())!.width).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await expect(drawer.getByRole('button', { name: 'Close', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('studio-preparation-compact-en.png') });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  await expect(page.getByRole('button', { name: '＋ Terminal', exact: true })).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath('studio-full-viewport-en.png') });
  await page.getByRole('link', { name: 'Overview', exact: true }).click();
  await expect(page).toHaveURL('/overview');
  await expect(page.locator('#app-sidebar')).toBeVisible();
  await page.getByRole('combobox', { name: 'Language' }).selectOption('pt-BR');
  await page.getByRole('link', { name: 'Terminais / Studio', exact: true }).click();
  await expect(workspace).toBeVisible();
  await page.getByRole('button', { name: '＋ Terminal', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Novos terminais', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('studio-preparation-pt.png') });
  await page.getByRole('button', { name: 'Fechar', exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath('studio-full-viewport-pt.png') });
  expect(await page.evaluate(() => Reflect.get(window, 'studioCalls'))).toEqual([
    'catalog',
    'catalog',
  ]);
  const calls = (await page.evaluate(() => Reflect.get(window, 'featureCalls'))) as string[];
  expect(calls.length).toBeGreaterThanOrEqual(2);
  expect(new Set(calls)).toEqual(new Set(['snapshot']));
});

test('Studio has one Overview action and a compact Feature sidebar at narrow widths', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'orqstFeatures', {
      value: {
        contractVersion: 1,
        request: async () => ({ status: 'unavailable' }),
      },
    });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/studio');
  const overview = page.getByRole('link', { name: 'Overview', exact: true });
  const sidebar = page.locator('.feature-sidebar');
  await expect(overview).toHaveCount(1);
  await expect(page.locator('.ts-features')).toHaveCount(0);
  await expect(page.locator('.feature-topbar, .ts-toolbar')).toHaveCount(1);
  await expect(sidebar).toHaveCSS('width', '155px');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(sidebar).toHaveCSS('width', '46px');
  await expect(overview).toBeInViewport({ ratio: 1 });
  await expect(
    page.locator('.ts-toolbar').getByRole('button', { name: '＋ Terminal' }),
  ).toBeInViewport({ ratio: 1 });
  await overview.click();
  await expect(page).toHaveURL('/overview');
});

const workspace = { id: 'lane2-synthetic', name: 'Workspace sintético' };
const observerWorkspace = { id: 'observer-synthetic', name: 'Projeto observado' };
const terminalId = (ordinal: number) =>
  `00000000-0000-4000-8000-${String(ordinal).padStart(12, '0')}`;
const featureId = (ordinal: number) =>
  `10000000-0000-4000-8000-${String(ordinal).padStart(12, '0')}`;
const providers = ['codex', 'claude', 'opencode'] as const;

function syntheticSnapshot(): FeatureNativeSnapshot {
  let offset = 1;
  const features: WorkspaceFeature[] = [4, 2, 1, 0].map((count, index) => ({
    schemaVersion: 1,
    workspaceId: workspace.id,
    featureId: featureId(index + 1),
    name: `Feature ${String.fromCharCode(65 + index)}`,
    description: '',
    status: 'active',
    terminalIds: Array.from({ length: count }, () => terminalId(offset++)),
    revision: 1,
    createdAt: index,
    updatedAt: index,
  }));
  return featureNativeSnapshotSchema.parse({
    contractVersion: 1,
    storage: 'core',
    workspace,
    generation: 1,
    activeFeatureId: featureId(1),
    features,
    view: {
      contractVersion: 1,
      storage: 'core',
      workspaceId: workspace.id,
      featureId: featureId(1),
      revision: 1,
    },
    slots: Array.from({ length: 7 }, (_, slot) => ({
      slot,
      terminalId: terminalId(slot + 1),
      provider: providers[slot % providers.length],
    })),
    layoutSaved: true,
  });
}

async function openNativeFixture(page: Page, nativeWorkspace = true) {
  const bundle = await build({
    stdin: {
      contents: `
        import { createRoot } from 'react-dom/client';
        import { FeatureWorkspace } from './src/FeatureWorkspace.tsx';
        import './src/feature-shell.css';
        import './src/i18n.ts';
        createRoot(document.getElementById('root')).render(
          <FeatureWorkspace nativeWorkspace={${nativeWorkspace}} workspaces={window.fixtureWorkspaces} />
        );
      `,
      resolveDir: join(process.cwd(), 'apps/dashboard'),
      loader: 'tsx',
    },
    outdir: 'out',
    bundle: true,
    platform: 'browser',
    format: 'iife',
    jsx: 'automatic',
    write: false,
  });
  await page.addInitScript(
    ({ snapshot, newFeatureId, observerWorkspace }) => {
      localStorage.setItem('i18nextLng', 'pt-BR');
      Reflect.set(window, 'fixtureWorkspaces', [observerWorkspace]);
      const calls: FeatureNativeRequest[] = [];
      const frames: Extract<FeatureNativeRequest, { action: 'arrange' }>[] = [];
      const prepares: { featureId: string | null; expectedRevision: number }[] = [];
      Reflect.set(window, 'fixtureCalls', calls);
      Reflect.set(window, 'fixtureFrames', frames);
      Reflect.set(window, 'fixturePrepares', prepares);
      const dashboardRequests: FeaturePreparationRequest[] = [];
      Reflect.set(window, 'dashboardRequests', dashboardRequests);
      const publishDock = (canvas: boolean) => {
        const members =
          snapshot.features.find((feature) => feature.featureId === snapshot.activeFeatureId)
            ?.terminalIds ?? [];
        const active = members.at(-1);
        window.dispatchEvent(
          new CustomEvent('orqst-terminal-dock', {
            detail: {
              canvas,
              hidden: [],
              generation: snapshot.generation,
              panes: snapshot.slots
                .filter((slot) => members.includes(slot.terminalId))
                .map((slot) => ({
                  slot: slot.slot,
                  label: `T-${String(slot.slot + 1).padStart(3, '0')}`,
                  provider: slot.provider,
                  active: slot.terminalId === active,
                  minimized: false,
                  visible: !canvas,
                  maximized: false,
                })),
            },
          }),
        );
      };
      Reflect.set(window, 'orqstFeatures', {
        contractVersion: 1,
        async request(input: FeatureNativeRequest) {
          calls.push(input);
          if (input.action === 'select') {
            if (input.expectedRevision !== snapshot.view.revision) return { status: 'stale' };
            snapshot.generation++;
            snapshot.activeFeatureId = input.featureId;
            snapshot.view.featureId = input.featureId;
            snapshot.view.revision++;
            publishDock(true);
          }
          if (input.action === 'create') {
            snapshot.features.push({
              schemaVersion: 1,
              workspaceId: snapshot.workspace.id,
              featureId: newFeatureId,
              name: input.input.name,
              description: input.input.description ?? '',
              status: input.input.status ?? 'planned',
              revision: 1,
              terminalIds: [],
              createdAt: 5,
              updatedAt: 5,
            });
            snapshot.generation++;
          }
          if (input.action === 'update') {
            const feature = snapshot.features.find(
              ({ featureId }) => featureId === input.featureId,
            );
            if (!feature || feature.revision !== input.input.expectedRevision)
              return { status: 'stale', snapshot: structuredClone(snapshot) };
            if (input.input.status === 'archived' && feature.terminalIds.length)
              return { status: 'archive_blocked', snapshot: structuredClone(snapshot) };
            if (input.input.status) feature.status = input.input.status;
            feature.revision++;
            snapshot.generation++;
          }
          if (input.action === 'canvas') publishDock(true);
          return { status: 'ok', snapshot: structuredClone(snapshot) };
        },
        async arrange(input: Extract<FeatureNativeRequest, { action: 'arrange' }>) {
          frames.push(input);
          if (input.generation !== snapshot.generation)
            return { status: 'stale', snapshot: structuredClone(snapshot) };
          publishDock(false);
          return { status: 'ok', snapshot: structuredClone(snapshot) };
        },
        async showDashboard(input: FeaturePreparationRequest) {
          dashboardRequests.push(input);
          return { status: 'ok' };
        },
        async showPreparationDrawer(input: { featureId: string | null; expectedRevision: number }) {
          prepares.push(input);
          return { status: 'denied' };
        },
      });
    },
    { snapshot: syntheticSnapshot(), newFeatureId: featureId(5), observerWorkspace },
  );
  await page.route('**/lane2-native-fixture', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><div id="root"></div>' }),
  );
  await page.goto('/lane2-native-fixture');
  for (const file of bundle.outputFiles) {
    if (file.path.endsWith('.css')) await page.addStyleTag({ content: file.text });
    if (file.path.endsWith('.js')) await page.addScriptTag({ content: file.text });
  }
  // Only Chromium needs the normal dashboard URL for the native product mark.
  await page.locator('.feature-brand img').evaluate((image: HTMLImageElement) => {
    image.src = '/brand/orqst-logo-dark.svg';
  });
}

for (const [width, height] of [
  [1440, 900],
  [1280, 800],
] as const) {
  test(`the native Feature tree retains exact scope and pane geometry at ${width}×${height}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    await openNativeFixture(page);
    const size = `${width}x${height}`;
    const capture = async (name: string) => {
      const folder = process.env.ORQST_LANE2_SCREENSHOTS;
      await page.screenshot({
        path: folder ? join(folder, size, `${name}.png`) : testInfo.outputPath(`${name}.png`),
      });
    };
    const paneIds = () =>
      page
        .locator('.ts-pane .ts-body[data-terminal-id]')
        .evaluateAll((panes) => panes.map((pane) => pane.getAttribute('data-terminal-id')));
    const frames = () =>
      page.evaluate(
        () =>
          Reflect.get(window, 'fixtureFrames') as Extract<
            FeatureNativeRequest,
            { action: 'arrange' }
          >[],
      );
    const scope = (id: string) => page.locator(`[data-feature-scope="${id}"]`);
    const header = page.locator('.feature-topbar, .ts-toolbar');
    await expect(page.locator('.feature-core')).toHaveText('● CORE ONLINE');
    await expect(page.locator('.feature-sidebar')).toHaveCSS('width', '155px');
    await expect(header).toHaveCount(1);
    await expect(header).toHaveCSS('height', '45px');
    await expect(page.locator('.feature-crumb')).toContainText('Workspace sintético / Feature A');
    await expect(page.getByRole('button', { name: /Projeto observado/ })).toBeDisabled();
    await expect(page.getByRole('button', { name: '＋ Novo Workspace' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Delegar' })).toHaveAttribute('title', /.+/);
    await expect.poll(paneIds).toEqual([1, 2, 3, 4].map(terminalId));
    await expect
      .poll(async () => (await page.locator('.ts-pane').first().boundingBox())?.y)
      .toBe(49);
    await expect
      .poll(async () => (await page.locator('.ts-pane').first().boundingBox())?.x)
      .toBe(159);
    await expect
      .poll(async () => (await frames()).at(-1)?.panes.filter(({ visible }) => visible).length)
      .toBe(4);
    const original = (await frames()).at(-1)!;
    const measured = await page.locator('.ts-body').first().boundingBox();
    expect(original.chrome).toEqual({ sidebar: 155, top: 47, bottom: 38 });
    expect(original.panes[0]!.rect!.y + 47).toBe(Math.ceil(measured!.y));
    await capture('01-four-panes');
    await page.getByRole('button', { name: 'Configurações', exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => Reflect.get(window, 'dashboardRequests')))
      .toEqual([
        {
          contractVersion: 1,
          generation: 1,
          workspaceId: workspace.id,
          featureId: featureId(1),
          expectedRevision: 1,
          destination: 'settings',
        },
      ]);
    if (process.env.ORQST_V6_INTEGRATED_CAPTURES === '1') {
      await page.screenshot({
        path: join('docs/development/v6-parity/integrated', size, '01-studio.png'),
        animations: 'disabled',
      });
    }
    await page.getByRole('button', { name: 'Grade' }).click();
    await expect.poll(async () => (await frames()).at(-1)?.mode).toBe('columns');
    const saved = (await frames()).at(-1)!;

    for (const [id, ids, name] of [
      [featureId(2), [5, 6], '02-two-panes'],
      [featureId(3), [7], '03-one-pane'],
      [featureId(4), [], '04-empty-feature'],
      [featureId(1), [1, 2, 3, 4], '05-return-four'],
    ] as const) {
      await scope(id).click();
      await expect(scope(id)).toHaveAttribute('aria-current', 'true');
      await expect(scope(id)).toBeFocused();
      await expect.poll(paneIds).toEqual([...ids].map(terminalId));
      await expect
        .poll(async () => (await frames()).at(-1)?.panes.map(({ terminalId }) => terminalId))
        .toEqual([...ids].map(terminalId));
      await capture(name);
    }
    expect((await frames()).at(-1)?.panes).toEqual(saved.panes);
    expect((await frames()).at(-1)?.mode).toBe('columns');
    const calls = () =>
      page.evaluate(() => Reflect.get(window, 'fixtureCalls') as FeatureNativeRequest[]);
    expect((await calls()).filter(({ action }) => action !== 'snapshot')).toEqual(
      [2, 3, 4, 1].map((id, offset) => ({
        action: 'select',
        contractVersion: 1,
        generation: offset + 1,
        featureId: featureId(id),
        expectedRevision: offset + 1,
      })),
    );

    await expect(page.getByRole('radiogroup')).toHaveCount(0);
    await page.getByRole('button', { name: 'Restaurar' }).click();
    await expect.poll(async () => (await frames()).at(-1)?.mode).toBe('mosaic');
    await expect(page.getByRole('button', { name: 'Grade' })).toBeVisible();
    const firstPane = page.locator('.ts-pane').first();
    await firstPane.hover();
    await firstPane.getByRole('button', { name: 'Minimizar', exact: true }).click();
    await expect.poll(paneIds).toEqual([2, 3, 4].map(terminalId));
    await header.getByRole('button', { name: 'Restaurar', exact: true }).click();
    await expect.poll(paneIds).toEqual([1, 2, 3, 4].map(terminalId));

    const create = page.getByRole('button', { name: '＋ Nova Feature' });
    await create.click();
    const editor = page.locator('.feature-editor');
    await expect(editor.locator('input')).toBeFocused();
    await editor.locator('input').fill('Feature criada');
    await capture('06-feature-create');
    await editor.getByRole('button', { name: 'Salvar' }).click();
    await expect(scope(featureId(5))).toHaveAttribute('aria-current', 'true');
    await expect(scope(featureId(5))).toBeFocused();
    await expect.poll(paneIds).toEqual([]);
    await capture('07-created-empty');

    await page.getByRole('button', { name: '＋ Terminal' }).click();
    const prepares = await page.evaluate(() => Reflect.get(window, 'fixturePrepares'));
    expect(prepares).toMatchObject([{ featureId: featureId(5), expectedRevision: 6 }]);
    await expect(page.locator('.feature-feedback')).toBeVisible();

    await page.locator('.feature-permissions-disclosure > summary').click();
    await page.getByRole('button', { name: 'Editar Feature' }).click();
    await editor.locator('select').selectOption('archived');
    await editor.getByRole('button', { name: 'Salvar' }).click();
    await expect(scope(featureId(5))).toContainText('Arquivada');
    await expect(page.getByRole('button', { name: '＋ Terminal' })).toBeDisabled();
    await capture('08-archived');

    await scope(featureId(1)).click();
    await page.getByRole('button', { name: 'Editar Feature' }).click();
    await editor.locator('select').selectOption('archived');
    await editor.getByRole('button', { name: 'Salvar' }).click();
    await expect(editor).toBeVisible();
    await expect
      .poll(async () => (await calls()).at(-1))
      .toMatchObject({
        action: 'update',
        featureId: featureId(1),
        input: { status: 'archived', expectedRevision: 1 },
      });
    await expect(page.locator('.feature-feedback')).toContainText(/arquiv/i);
    await capture('09-archive-refused');
    await editor.getByRole('button', { name: 'Cancelar' }).click();
    await page.getByRole('button', { name: 'Canvas' }).click();
    await expect(page.locator('.feature-canvas-mode')).toBeVisible();
    await capture('10-canvas');
    await page.locator('[data-managed-workspace]').click();
    await expect(page.locator('.feature-canvas-mode')).toHaveCount(0);
    await expect.poll(paneIds).toEqual([]);
    await capture('11-workspace-landing');
  });
}

test('the renderer restores the previous terminal control by its ID within the returning Feature', async ({
  page,
}) => {
  await openNativeFixture(page, false);
  const original = page.locator(`[data-terminal-id="${terminalId(4)}"]`).getByRole('button');
  await original.focus();
  await expect(original).toBeFocused();
  await page.locator(`[data-feature-scope="${featureId(2)}"]`).click();
  await expect(original).toHaveCount(0);
  await page.locator(`[data-feature-scope="${featureId(1)}"]`).click();
  await expect(original).toBeFocused();
  expect(
    await page.evaluate(() =>
      (Reflect.get(window, 'fixtureCalls') as FeatureNativeRequest[]).some(
        (call) => call.action === 'pane',
      ),
    ),
  ).toBe(false);
});
