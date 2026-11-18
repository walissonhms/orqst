import { test, expect, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FeatureNativeSnapshot, TerminalPreparationCatalog } from '@orqst/protocol';

// Synthetic Desktop facade. No provider or native authority exists in this browser test.
test('Studio preparation guides EN/PT, keeps denied actions visible and opens reviewed panels', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const snapshot = {
      count: 0,
      limit: 2,
      opened: false,
      prepared: false,
      canCreate: true,
      canSelect: true,
      busy: false,
    };
    Reflect.set(window, 'studioCalls', []);
    Reflect.set(window, 'studioStatus', 'ok');
    Object.defineProperty(window, 'orqstStudio', {
      value: {
        contractVersion: 1,
        async request({ action }: { action: string }) {
          (Reflect.get(window, 'studioCalls') as string[]).push(action);
          const status = Reflect.get(window, 'studioStatus');
          if (status !== 'ok') return { status };
          if (action === 'createMixed') {
            snapshot.count = 2;
            snapshot.canCreate = false;
          }
          if (action === 'open') {
            snapshot.opened = true;
            snapshot.canSelect = false;
          }
          return { status, snapshot: { ...snapshot } };
        },
      },
    });
  });
  await page.goto('/studio');
  await expect(page.getByRole('heading', { name: 'Terminals / Studio' })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Open reviewed terminals', exact: true }),
  ).toBeDisabled();
  await page.getByRole('combobox', { name: 'Language' }).selectOption('pt-BR');
  await page.evaluate(() => Reflect.set(window, 'studioStatus', 'focus_required'));
  await page.getByRole('button', { name: 'Preparar Codex + OpenCode…', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Clique na página do Studio' }),
  ).toBeVisible();
  await page.evaluate(() => Reflect.set(window, 'studioStatus', 'ok'));
  await page.getByRole('button', { name: 'Preparar Codex + OpenCode…', exact: true }).click();
  await expect(page.getByText('Seleção revisada', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Abrir terminais revisados', exact: true }).click();
  await expect(page.getByText('Painéis disponíveis', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Voltar aos terminais', exact: true }),
  ).toBeEnabled();
  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole('heading', { name: 'Terminais / Studio' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: `/private/tmp/orqst-675-studio-${width}.png`, fullPage: true });
  }
  expect(await page.evaluate(() => Reflect.get(window, 'studioCalls'))).toEqual([
    'snapshot',
    'createMixed',
    'createMixed',
    'open',
  ]);
});

test('Studio distinguishes browser from older Desktop and offers no fake terminal controls', async ({
  page,
}) => {
  await page.goto('/studio');
  await expect(
    page.getByText('This browser shows observed sessions only.', { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Prepare Codex + OpenCode…', exact: true }),
  ).toHaveCount(0);
  await page.addInitScript(() =>
    Object.defineProperty(window, 'orqstManagedAgents', { value: { contractVersion: 1 } }),
  );
  await page.reload();
  await expect(page.getByText('This Desktop is running an older', { exact: false })).toBeVisible();
  await page.getByRole('combobox', { name: 'Language' }).selectOption('pt-BR');
  await expect(
    page.getByText('Este Desktop está com a interface anterior', { exact: false }),
  ).toBeVisible();
});

const workspace = { id: 'synthetic-lane4', name: 'Workspace de teste' };
const fixtureId = (id: number) => `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`;
const featureId = fixtureId(100);
const otherFeatureId = fixtureId(101);
const createdId = fixtureId(50);
const catalogId = 'a'.repeat(64);
const defaultModel = 'b'.repeat(64);
const explicitModel = 'c'.repeat(64);

function studioSnapshot(count: number): FeatureNativeSnapshot {
  const terminalIds = Array.from({ length: count }, (_, index) => fixtureId(index + 1));
  return {
    contractVersion: 1,
    generation: 7,
    storage: 'core',
    workspace,
    activeFeatureId: featureId,
    features: [
      {
        featureId,
        workspaceId: workspace.id,
        name: 'Feature de teste',
        description: '',
        status: 'active',
        schemaVersion: 1,
        revision: 1,
        terminalIds,
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    view: {
      contractVersion: 1,
      storage: 'core',
      workspaceId: workspace.id,
      featureId,
      revision: 1,
    },
    slots: terminalIds.map((terminalId, slot) => ({ slot, terminalId, provider: 'codex' })),
    layoutSaved: true,
  };
}

const catalog: TerminalPreparationCatalog = {
  contractVersion: 1,
  workspaceId: workspace.id,
  featureId,
  catalogId,
  providers: [
    {
      provider: 'codex',
      status: 'available',
      reason: 'ready',
      models: [
        {
          id: defaultModel,
          label: 'Default fixture',
          source: 'cli-default',
          isDefault: true,
          availability: 'unverified',
        },
        {
          id: explicitModel,
          label: 'Modelo de teste',
          source: 'native-config',
          isDefault: false,
          availability: 'unverified',
        },
      ],
    },
    {
      provider: 'claude',
      status: 'available',
      reason: 'ready',
      models: [],
    },
    {
      provider: 'opencode',
      status: 'unavailable',
      reason: 'executable_not_found',
      models: [],
    },
    {
      provider: 'antigravity',
      status: 'unavailable',
      reason: 'executable_unreviewed',
      models: [],
    },
  ],
};

async function installStudioFixture(page: Page, count: number, language: 'pt-BR' | 'en-US') {
  await page.addInitScript(
    ({ snapshot, catalog, createdId, language }) => {
      localStorage.setItem('i18nextLng', language);
      localStorage.setItem('orqst.studio.panel', 'open');
      const calls: unknown[] = [];
      Reflect.set(window, 'lane4Calls', calls);
      Reflect.set(window, 'lane4Mode', 'refuse');
      Object.defineProperty(window, 'orqstFeatures', {
        value: {
          contractVersion: 1,
          async request() {
            return { status: 'ok', snapshot: structuredClone(snapshot) };
          },
        },
      });
      const nativeSnapshot = {
        generation: 42,
        count: snapshot.slots.length,
        limit: 8,
        canCreate: true,
        canReview: false,
        selectionLocked: false,
        busy: false,
        liveEnrollment: snapshot.slots.length > 0,
      };
      Object.defineProperty(window, 'orqstTauriStudio', {
        value: {
          contractVersion: 1,
          async request(input: { action: string; requests: { id: string }[] }) {
            calls.push(input);
            const mode = Reflect.get(window, 'lane4Mode');
            if (input.action === 'snapshot')
              return { status: 'ok', snapshot: { ...nativeSnapshot, generation: 41 } };
            if (input.action === 'catalog')
              return {
                status: 'catalog',
                catalog,
                ...(mode === 'missing-generation' ? {} : { snapshot: nativeSnapshot }),
              };
            if (input.action !== 'create-batch') throw new Error('Unexpected synthetic request');
            if (mode === 'accept') {
              const slot = snapshot.slots.length;
              snapshot.slots.push({ terminalId: createdId, slot, provider: 'codex' });
              snapshot.features[0]!.terminalIds.push(createdId);
              snapshot.generation++;
              window.dispatchEvent(
                new CustomEvent('orqst-feature-state', { detail: structuredClone(snapshot) }),
              );
              return {
                status: 'batch',
                items: input.requests.map(({ id }) => ({
                  id,
                  status: 'accepted',
                  reason: 'core_enrolled',
                  effects: 'possible',
                  terminalId: createdId,
                  slot,
                })),
              };
            }
            return {
              status: 'batch',
              items: input.requests.map(({ id }, index) =>
                index === 0
                  ? {
                      id,
                      status: 'refused',
                      reason: 'review_cancelled',
                      effects: 'not_started',
                    }
                  : {
                      id,
                      status: 'unknown',
                      reason: 'opening_uncertain',
                      effects: 'possible',
                    },
              ),
            };
          },
        },
      });
    },
    { snapshot: studioSnapshot(count), catalog, createdId, language },
  );
}

function captureIntegrated(page: Page, outputPath: string, name: string) {
  const { width, height } = page.viewportSize()!;
  return page.screenshot({
    path:
      process.env.ORQST_V6_INTEGRATED_CAPTURES === '1'
        ? join('docs/development/v6-parity/integrated', `${width}x${height}`, name)
        : outputPath,
    animations: 'disabled',
  });
}

for (const [width, height] of [
  [1440, 900],
  [1280, 800],
] as const) {
  test(`compact native creation retains existing pane IDs and DOM at ${width}×${height}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    await installStudioFixture(page, 4, 'pt-BR');
    await page.goto('/studio');
    const workspaceRoot = page.locator('.studio-workspace > .feature-workspace');
    const trigger = workspaceRoot.locator('.feature-topbar, .ts-toolbar').getByRole('button', {
      name: '＋ Terminal',
      exact: true,
    });
    const originals = workspaceRoot.locator('.ts-body[data-terminal-id]');
    await expect(originals).toHaveCount(4);
    await originals.first().evaluate((node) => Reflect.set(window, 'lane4OriginalPane', node));
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: 'Novos terminais' });
    const name = dialog.getByLabel('Nome', { exact: true });
    const cli = dialog.getByRole('combobox', { name: 'CLI', exact: true });
    const model = dialog.getByRole('combobox', { name: 'Modelo', exact: true });
    const submit = dialog.getByRole('button', { name: 'Abrir terminal', exact: true });
    await expect(name).toBeFocused();
    await expect(dialog).toHaveCSS('width', '390px');
    await expect(dialog.getByLabel('Alias para menções @')).toHaveAttribute('readonly');
    await expect(cli.locator('option')).toHaveCount(4);
    await expect(cli.locator('option[value="opencode"]')).toHaveText(/OpenCode.*não encontrada/);
    await expect(cli.locator('option[value="opencode"]')).toHaveJSProperty('disabled', true);
    await expect(cli.locator('option[value="antigravity"]')).toHaveText(
      /Antigravity.*não revisado/,
    );
    await expect(cli.locator('option[value="antigravity"]')).toHaveJSProperty('disabled', true);
    await expect(model).toHaveValue('');
    await captureIntegrated(page, testInfo.outputPath('creation-open.png'), 'creation-open.png');

    await cli.selectOption('claude');
    await expect(model.locator('option')).toHaveText('Nenhum modelo revisado disponível');
    await expect(submit).toBeDisabled();
    await cli.selectOption('codex');
    await name.fill('Terminal de revisão');
    await model.selectOption(explicitModel);
    await captureIntegrated(
      page,
      testInfo.outputPath('creation-filled.png'),
      'creation-filled.png',
    );
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();

    await trigger.click();
    await dialog.getByRole('button', { name: 'Vários terminais' }).click();
    await expect(dialog.getByText('Quantos', { exact: true })).toBeVisible();
    await captureIntegrated(page, testInfo.outputPath('creation-batch.png'), 'creation-batch.png');
    await dialog.getByRole('button', { name: 'Um terminal' }).click();
    await dialog.getByRole('button', { name: /Opções avançadas \(par MCP/ }).click();
    const advanced = page.getByRole('dialog', { name: 'Abrir terminal', exact: true });
    await expect(advanced.getByLabel('Provedor CLI')).toBeVisible();
    await expect(advanced.getByLabel('Provedor CLI').locator('option')).toHaveCount(4);
    await advanced.getByLabel('Modelo', { exact: true }).selectOption(explicitModel);
    await expect(advanced.getByRole('button', { name: 'Abrir', exact: true })).toBeEnabled();
    await captureIntegrated(
      page,
      testInfo.outputPath('creation-advanced.png'),
      'creation-advanced.png',
    );
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();

    await trigger.click();
    await name.fill('Terminal de revisão');
    await model.selectOption(explicitModel);
    await submit.click();
    await expect(dialog.getByText('A revisão foi cancelada')).toBeVisible();
    await captureIntegrated(
      page,
      testInfo.outputPath('creation-refused.png'),
      'creation-refused.png',
    );
    await dialog.getByRole('button', { name: 'Fechar', exact: true }).click();
    await expect(trigger).toBeFocused();
    const submitted = await page.evaluate(() =>
      (Reflect.get(window, 'lane4Calls') as { action: string }[]).filter(
        ({ action }) => action === 'create-batch',
      ),
    );
    expect(submitted).toEqual([
      {
        action: 'create-batch',
        generation: 42,
        workspaceId: workspace.id,
        featureId,
        catalogId,
        requests: [
          {
            id: expect.any(String),
            workspaceId: workspace.id,
            name: 'Terminal de revisão',
            provider: 'codex',
            modelId: explicitModel,
          },
        ],
      },
    ]);

    await page.evaluate(() => Reflect.set(window, 'lane4Mode', 'accept'));
    await trigger.click();
    await submit.click();
    await expect(dialog).toBeHidden();
    await expect(originals).toHaveCount(5);
    await expect(workspaceRoot.locator(`[data-terminal-id="${createdId}"]`).first()).toBeVisible();
    expect(
      await originals.first().evaluate((node) => node === Reflect.get(window, 'lane4OriginalPane')),
    ).toBe(true);
    await captureIntegrated(
      page,
      testInfo.outputPath('creation-retained-panes.png'),
      'creation-retained-panes.png',
    );
  });

  test(`empty Feature creation opens the first pane at ${width}×${height}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    await installStudioFixture(page, 0, 'pt-BR');
    await page.goto('/studio');
    await page
      .locator('.feature-topbar, .ts-toolbar')
      .getByRole('button', { name: '＋ Terminal', exact: true })
      .click();
    const dialog = page.getByRole('dialog', { name: 'Novos terminais' });
    await expect(dialog.getByLabel('Nome', { exact: true })).toBeFocused();
    await captureIntegrated(page, testInfo.outputPath('creation-empty.png'), 'creation-empty.png');
    await page.evaluate(() => Reflect.set(window, 'lane4Mode', 'accept'));
    await dialog.getByRole('button', { name: 'Abrir terminal', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator(`.ts-body[data-terminal-id="${createdId}"]`)).toBeVisible();
    await captureIntegrated(
      page,
      testInfo.outputPath('creation-first-pane.png'),
      'creation-first-pane.png',
    );
  });
}

test('a catalog with no admission generation cannot open a terminal', async ({ page }) => {
  await installStudioFixture(page, 1, 'en-US');
  await page.goto('/studio');
  await page.evaluate(() => Reflect.set(window, 'lane4Mode', 'missing-generation'));
  await page
    .locator('.feature-topbar, .ts-toolbar')
    .getByRole('button', { name: '＋ Terminal', exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: 'New terminals' });
  await expect(
    dialog.getByText('The native catalog and its current session could not be verified.'),
  ).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Open terminal', exact: true })).toHaveCount(0);
  await expect(
    dialog.getByRole('button', { name: 'Refresh selection', exact: true }),
  ).toBeEnabled();
  expect(await page.evaluate(() => Reflect.get(window, 'lane4Calls'))).toEqual([
    { action: 'catalog', workspaceId: workspace.id, featureId },
  ]);
});

test('batch outcomes remain individual when native enrollment is uncertain', async ({ page }) => {
  await installStudioFixture(page, 2, 'pt-BR');
  await page.goto('/studio');
  await page
    .locator('.feature-topbar, .ts-toolbar')
    .getByRole('button', { name: '＋ Terminal', exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Novos terminais' });
  await dialog.getByRole('button', { name: 'Vários terminais' }).click();
  await dialog.getByRole('button', { name: '2', exact: true }).click();
  await dialog.locator('button[type="submit"]').click();
  await expect(dialog.getByText('0 de 2 terminais abertos.')).toBeVisible();
  await expect(dialog.getByText('A revisão foi cancelada')).toBeVisible();
  await expect(dialog.getByText('A abertura pode ou não ter acontecido')).toBeVisible();
  await expect(
    dialog.getByText('Confira a área de terminais antes de tentar de novo.'),
  ).toBeVisible();
  await expect(dialog.locator('button[type="submit"]')).toHaveCount(0);
});

const mentionBundle = () =>
  build({
    stdin: {
      contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { FeatureStudio } from './src/FeatureStudio';
      import './src/i18n';
      window.mountLane4Delegate = (snapshot) => {
        const calls = [];
        window.lane4Mentions = calls;
        window.orqstFeatures = {
          contractVersion: 1,
          async request(input) {
            if (input.action !== 'mention') return { status: 'ok', snapshot };
            calls.push(input);
            return {
              status: 'ok',
              snapshot,
              mention: {
                id: '00000000-0000-4000-8000-000000000199',
                outcomes: input.to.map((terminalId) => ({
                  terminalId: window.lane4WrongReceipt ?? terminalId,
                  delivery: 'queued',
                  reason: 'hub_inbox',
                })),
              },
            };
          },
        };
        createRoot(document.querySelector('#root')).render(<FeatureStudio nativeWorkspace />);
      };
    `,
      resolveDir: resolve('apps/dashboard'),
      loader: 'tsx',
    },
    bundle: true,
    platform: 'browser',
    loader: { '.css': 'empty' },
    write: false,
    logLevel: 'silent',
  });

for (const [width, height] of [
  [1440, 900],
  [1280, 800],
] as const) {
  test(`breadcrumb delegation queues only exact Feature IDs at ${width}×${height}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    const { outputFiles } = await mentionBundle();
    const indexHtml = await readFile('apps/dashboard/dist/index.html', 'utf8');
    const stylesheet = indexHtml.match(/<link[^>]+href="([^"]+\.css)"/)?.[1];
    expect(stylesheet).toBeTruthy();
    await page.route('**/lane4-delegation', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><link rel="stylesheet" href="${stylesheet}"><div id="root"></div>`,
      }),
    );
    await page.goto('/lane4-delegation');
    await page.evaluate(() => {
      localStorage.setItem('i18nextLng', 'pt-BR');
      localStorage.setItem('orqst.studio.panel', 'open');
    });
    await page.addScriptTag({ content: outputFiles[0]!.text });
    const snapshot = studioSnapshot(4);
    snapshot.slots.push({ slot: 4, terminalId: fixtureId(5), provider: 'opencode' });
    snapshot.features.push({
      ...snapshot.features[0]!,
      featureId: otherFeatureId,
      terminalIds: [fixtureId(5)],
    });
    await page.evaluate((value) => Reflect.get(window, 'mountLane4Delegate')(value), snapshot);
    await page.locator('.feature-brand img').evaluate((logo: HTMLImageElement) => {
      // Chromium uses the same asset over HTTP because it has no native URL handler.
      logo.src = '/brand/orqst-logo-dark.svg';
      return logo.decode();
    });
    const trigger = page.locator('.feature-topbar, .ts-toolbar').getByRole('button', {
      name: 'Delegar',
      exact: true,
    });
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: 'Delegar' });
    const text = dialog.getByRole('textbox', { name: 'Mensagem' });
    const submit = dialog.getByRole('button', { name: 'Enfileirar mensagem' });
    await expect(text).toBeFocused();
    await captureIntegrated(page, testInfo.outputPath('delegate-open.png'), 'delegate-open.png');
    await text.fill('@');
    await expect(dialog.getByRole('option', { name: /T-005/ })).toHaveCount(0);
    const listbox = dialog.getByRole('listbox');
    await expect(listbox.getByRole('option')).toHaveCount(4);
    await expect(listbox.getByText('Modelo desconhecido', { exact: true })).toHaveCount(4);
    await captureIntegrated(
      page,
      testInfo.outputPath('delegate-targets.png'),
      'delegate-targets.png',
    );
    await text.fill('@T-002 @T-005 revise o teste');
    await expect(submit).toBeDisabled();
    await text.fill('@T-002 @outra-feature/T-002 revise o teste');
    await expect(submit).toBeDisabled();
    await text.fill('@T-002 revise o teste');
    await expect(submit).toBeEnabled();
    await captureIntegrated(page, testInfo.outputPath('delegate-draft.png'), 'delegate-draft.png');
    await submit.click();
    await expect(dialog.getByText('Na fila da caixa de entrada do terminal')).toBeVisible();
    await expect(dialog.getByText('Enviado', { exact: false })).toHaveCount(0);
    await captureIntegrated(
      page,
      testInfo.outputPath('delegate-queued.png'),
      'delegate-queued.png',
    );
    expect(await page.evaluate(() => Reflect.get(window, 'lane4Mentions'))).toEqual([
      {
        contractVersion: 1,
        generation: snapshot.generation,
        action: 'mention',
        from: { kind: 'user' },
        to: [fixtureId(2)],
        text: '@T-002 revise o teste',
      },
    ]);
    await page.evaluate((id) => Reflect.set(window, 'lane4WrongReceipt', id), fixtureId(5));
    await text.fill('@T-002 confirme o teste');
    await submit.click();
    await expect(dialog.getByText('Entrega desconhecida', { exact: true })).toBeVisible();
    await expect(dialog.getByText('Na fila da caixa de entrada do terminal')).toHaveCount(0);
    await expect(dialog.getByText('Enviado', { exact: false })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });
}
