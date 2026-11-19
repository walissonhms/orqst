import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  defaultFeatureId,
  type DesktopFeatures,
  type FeatureNativeSnapshot,
  type StudioStartup,
  type TauriStudio,
} from '@orqst/protocol';

const workspaceId = 'a'.repeat(64);
const otherWorkspaceId = 'b'.repeat(64);
const terminalId = '11111111-1111-4111-8111-111111111111';
const uncertainId = '22222222-2222-4222-8222-222222222222';
const releasedId = '33333333-3333-4333-8333-333333333333';
const antigravityId = '44444444-4444-4444-8444-444444444444';
const featureId = '55555555-5555-4555-8555-555555555555';
const workspace = { id: workspaceId, name: 'Projeto gerenciado' };
const generalId = defaultFeatureId(workspaceId);
const modelId = 'a'.repeat(64);
const otherWorkspace = { id: otherWorkspaceId, name: 'Outro projeto gerenciado' };

function feature(workspaceId: string, featureId: string, name: string) {
  return {
    schemaVersion: 1 as const,
    featureId,
    workspaceId,
    name,
    description: '',
    status: 'active' as const,
    revision: 1,
    terminalIds: [] as string[],
    createdAt: 1,
    updatedAt: 1,
  };
}
function view(workspaceId: string, featureId: string | null) {
  return {
    contractVersion: 1 as const,
    storage: 'core' as const,
    workspaceId,
    featureId,
    revision: 1,
  };
}

async function installFixture(
  page: Page,
  mode: 'returning' | 'first' | 'failed' | 'live' | 'antigravity',
  embedPtys = false,
  transientAdmission = false,
) {
  const selected = {
    ...feature(workspaceId, featureId, 'Revisão'),
    terminalIds: [
      terminalId,
      uncertainId,
      releasedId,
      ...(mode === 'antigravity' ? [antigravityId] : []),
    ],
    terminalDisplays: [
      { terminalId, displayId: 'T-001' },
      { terminalId: uncertainId, displayId: 'T-002' },
      { terminalId: releasedId, displayId: 'T-003', released: true as const },
      ...(mode === 'antigravity' ? [{ terminalId: antigravityId, displayId: 'T-004' }] : []),
    ],
  };
  const otherGeneral = defaultFeatureId(otherWorkspaceId);
  const startup: StudioStartup = {
    workspaces:
      mode === 'first' || mode === 'failed'
        ? []
        : [
            {
              ...workspace,
              features: [feature(workspaceId, generalId, 'General'), selected],
              view: view(workspaceId, featureId),
            },
            {
              ...otherWorkspace,
              features: [feature(otherWorkspaceId, otherGeneral, 'General')],
              view: view(otherWorkspaceId, null),
            },
          ],
  };
  const live: FeatureNativeSnapshot = {
    contractVersion: 1,
    storage: 'core',
    generation: 1,
    workspace,
    activeFeatureId: featureId,
    features: [feature(workspaceId, generalId, 'General'), selected],
    view: view(workspaceId, featureId),
    layoutSaved: true,
    slots: [
      { slot: 0, terminalId, provider: 'opencode', displayName: 'Backend' },
      { slot: 1, terminalId: uncertainId, provider: 'codex', displayName: 'Investigar' },
      {
        slot: 2,
        terminalId: releasedId,
        provider: 'opencode',
        displayName: 'OpenCode',
        closed: true,
      },
      ...(mode === 'antigravity'
        ? [{ slot: 3, terminalId: antigravityId, provider: 'antigravity' as const }]
        : []),
    ],
  };
  await page.addInitScript(
    ({ mode, startup, live, modelId, releasedId, embedPtys, transientAdmission }) => {
      localStorage.setItem('i18nextLng', 'pt-BR');
      if (!localStorage.getItem('orqst.shell.v1'))
        localStorage.setItem(
          'orqst.shell.v1',
          JSON.stringify({ view: 'overview', workspaceId: 'legacy-observer' }),
        );
      const providers = ['codex', 'opencode', 'claude', 'antigravity'] as const;
      const studio = {
        generation: 1,
        limit: 8,
        count: 1,
        busy: false,
        canCreate: true,
        canReview: false,
        selectionLocked: false,
      };
      Reflect.set(window, 'orqstFeatures', {
        contractVersion: 1,
        ...(embedPtys && {
          arrange: async (request: Parameters<NonNullable<DesktopFeatures['arrange']>>[0]) => {
            Reflect.set(window, 'diag27Layout', request);
            return { status: 'ok' };
          },
        }),
        request: async (request: Parameters<DesktopFeatures['request']>[0]) => {
          if (mode !== 'live' && mode !== 'antigravity') return { status: 'unavailable' };
          if (request.action === 'select') {
            if (request.expectedRevision !== live.view.revision)
              return { status: 'stale', snapshot: live };
            live.activeFeatureId = request.featureId;
            live.view = {
              ...live.view,
              featureId: request.featureId,
              revision: live.view.revision + 1,
            };
            live.generation++;
            window.dispatchEvent(
              new CustomEvent('orqst-feature-state', { detail: structuredClone(live) }),
            );
          }
          const at = Date.now();
          return {
            status: 'ok',
            snapshot: structuredClone(live),
            canvas: {
              observedAt: at,
              entries: live.slots.map(({ slot, terminalId }) => ({
                slot,
                terminalId,
                ...(slot === 0
                  ? { state: 'running', startedAt: at - 1600 }
                  : slot === 2
                    ? { state: 'exited', startedAt: at - 5000, exitedAt: at - 3000 }
                    : { state: 'unknown' }),
              })),
            },
          };
        },
      });
      let discoveryAttempts = 0;
      Reflect.set(window, 'orqstTauriStudio', {
        contractVersion: 1,
        request: async (request: Parameters<TauriStudio['request']>[0]) => {
          if (request.action === 'startup')
            return mode === 'failed' ? { status: 'unavailable' } : { status: 'startup', startup };
          if (request.action === 'discovery') {
            if (++discoveryAttempts === 1)
              return new Promise((resolve) =>
                Reflect.set(window, 'failDiscovery', () => resolve({ status: 'unavailable' })),
              );
            return {
              status: 'discovery',
              clis: providers.map((provider) => ({
                provider,
                lookup: provider === 'codex' ? 'candidate_found' : 'not_found',
              })),
            };
          }
          if (request.action === 'snapshot') return { status: 'ok', snapshot: studio };
          if (request.action === 'catalog')
            return {
              status: 'catalog',
              snapshot: transientAdmission ? { ...studio, canCreate: false } : studio,
              catalog: {
                contractVersion: 1,
                workspaceId: request.workspaceId,
                featureId: request.featureId,
                catalogId: 'f'.repeat(64),
                providers: providers.map((provider) => ({
                  provider,
                  status: 'available',
                  reason: 'ready',
                  models: [
                    {
                      id: modelId,
                      label: 'CLI default',
                      source: 'cli-default',
                      isDefault: true,
                      availability: 'unverified',
                    },
                  ],
                })),
                reopenable: [
                  {
                    terminalId: releasedId,
                    provider: 'opencode',
                    displayId: 'T-003',
                    name: 'OpenCode',
                    modelId,
                  },
                ],
              },
            };
          if (request.action === 'create-batch')
            return new Promise((resolve) => {
              Reflect.set(window, 'diag28ReopenId', request.reopenTerminalId);
              Reflect.set(window, 'acceptDiag27Open', (terminalId: string) =>
                resolve({
                  status: 'batch',
                  items: request.requests.map(({ id }) => ({
                    id,
                    terminalId,
                    slot: 3,
                    status: 'accepted',
                    reason: 'core_enrolled',
                    effects: 'possible',
                  })),
                }),
              );
              Reflect.set(window, 'refuseOpen', () =>
                resolve({
                  status: 'batch',
                  items: request.requests.map(({ id }) => ({
                    id,
                    status: 'refused',
                    reason: 'catalog_changed',
                    effects: 'not_started',
                  })),
                }),
              );
            });
          return { status: 'denied' };
        },
      });
    },
    { mode, startup, live, modelId, releasedId, embedPtys, transientAdmission },
  );
  await page.setViewportSize({ width: 1440, height: 900 });
}

async function capture(page: Page, state: string) {
  const output = process.env.ORQST_DIAG26_CAPTURES;
  if (!output) return;
  for (const [width, height] of [
    [1440, 900],
    [1280, 800],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.mouse.move(0, 0);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await page.screenshot({
      animations: 'disabled',
      path: join(output, `${width}x${height}`, state + '.png'),
    });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
}

test('unfocused-style passive startup restores the selected Feature without observed projects', async ({
  page,
}) => {
  await installFixture(page, 'returning');
  await page.goto('/');
  await expect(page.getByRole('button', { name: /^Revisão/ })).toHaveAttribute(
    'aria-current',
    'true',
  );
  const startupMs = await page.evaluate(() => performance.now());
  console.log(`Fixture navigation to selected Feature: ${Math.round(startupMs)} ms`);
  await expect(page.getByRole('button', { name: /Projeto gerenciado/ }).first()).toContainText('2');
  await expect(page.getByText('/synthetic/browser-test', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: /Boas-vindas/ })).toHaveCount(0);
  await expect(page.getByRole('article')).toHaveCount(0);
  await expect(page.getByText('Encerrados (3)')).toBeVisible();
  await page.getByRole('button', { name: 'Geral', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Geral', exact: true })).toHaveAttribute(
    'aria-current',
    'true',
  );
  await page.getByRole('button', { name: /^Outro projeto gerenciado/ }).click();
  await expect(page.getByRole('button', { name: /^Geral/ })).toHaveAttribute(
    'aria-current',
    'true',
  );
  await expect(page.getByRole('button', { name: /Espaço livre/ })).toHaveCount(4);
  await page.reload();
  await expect(page.getByRole('button', { name: /^Geral/ })).toHaveAttribute(
    'aria-current',
    'true',
  );
  await capture(page, 'empty-feature');
});

test('a failed metadata read cannot trigger first-run onboarding', async ({ page }) => {
  await installFixture(page, 'failed');
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Tentar novamente' })).toBeVisible();
  await expect(page.getByRole('dialog', { name: /Boas-vindas/ })).toHaveCount(0);
});

test('first-run CLI discovery shows loading, failure and retry and remembers Skip', async ({
  page,
}) => {
  await installFixture(page, 'first');
  await page.goto('/');
  const guide = page.getByRole('dialog', { name: /Boas-vindas/ });
  await expect(guide.getByText('Carregando…')).toBeVisible();
  await page.evaluate(() => Reflect.get(window, 'failDiscovery')());
  await expect(guide.getByRole('alert')).toHaveText('Catálogo indisponível');
  await capture(page, 'onboarding-retry');
  await guide.getByRole('button', { name: 'Tentar novamente' }).click();
  await expect(guide.getByText('Instalado', { exact: true })).toBeVisible();
  await guide.getByRole('button', { name: 'Pular' }).click();
  await page.goto('/');
  await expect(guide).toHaveCount(0);
});

test('Studio renders live, starting, failed and ended states from their evidence', async ({
  page,
}) => {
  await installFixture(page, 'live');
  await page.goto('/studio');
  const live = page.locator(`[data-pane-id="${terminalId}"]`);
  await expect(live).toBeVisible();
  await expect(page.getByRole('button', { name: 'Revisão', exact: true })).toContainText('1');
  await expect(live.locator('.ts-label')).toHaveText('T-001');
  await expect(live.locator('.ts-card-model')).toHaveCount(0);
  await expect(live.locator('.ts-card-tokens')).toHaveText('—');
  await expect(page.locator(`[data-pane-id="${uncertainId}"]`)).toHaveCount(0);
  await expect(page.getByText('Ainda sem evidência de atividade')).toHaveCount(0);
  await capture(page, 'studio-grid');
  await live
    .getByRole('button', { name: /menu|ações/i })
    .first()
    .click();
  await expect(page.getByRole('menu')).toBeVisible();
  await capture(page, 'pane-menu');
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: /Delegar/ }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByText('Antigravity não tem MCP por sessão.')).toHaveCount(0);
  await page.keyboard.press('Escape');

  await page.getByText('Encerrados (2)').click();
  const uncertain = page.locator('.pane-lifecycle-ended li').filter({ hasText: 'T-002' }).first();
  await expect(uncertain).toContainText('Investigar');
  await expect(uncertain).toContainText('Estado incerto');
  await expect(uncertain.getByText('Ver detalhes')).toBeVisible();
  const ended = page.locator('.pane-lifecycle-ended li').filter({ hasText: 'T-003' });
  await expect(ended.getByText('OpenCode', { exact: true })).toHaveCount(1);
  await expect(ended.getByRole('button', { name: 'Reabrir' })).toBeVisible();
  await expect(ended.getByRole('button', { name: 'Remover da Feature' })).toBeVisible();
  await capture(page, 'ended');

  await page.getByRole('button', { name: '＋ Terminal', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox').first().fill('Agente de teste');
  await dialog.locator('button[type=submit]').click();
  const opening = page.locator('.ts-pane').filter({ hasText: 'Agente de teste' });
  await expect(opening).toHaveAttribute('data-lifecycle', 'starting');
  await expect(opening.locator('.ts-label')).toHaveCount(0);
  await capture(page, 'starting');
  await page.evaluate(() => Reflect.get(window, 'refuseOpen')());
  await expect(opening).toHaveAttribute('data-lifecycle', 'failed');
  await expect(opening.locator('.ts-body > .pane-lifecycle-content')).toBeVisible();
  await expect(opening.getByText('Catálogo mudou')).toBeVisible();
  await expect(opening.getByText('catalog_changed')).toHaveCount(0);
  await capture(page, 'failed');
  await opening.getByRole('button', { name: 'Ver logs' }).click();
  await expect(opening.getByText('catalog_changed')).toBeVisible();
});

test('Delegate reports the Antigravity limit only when its Feature contains one', async ({
  page,
}) => {
  await installFixture(page, 'antigravity');
  await page.goto('/studio');
  await page.getByRole('button', { name: /Delegar/ }).click();
  await expect(
    page.getByRole('dialog').getByText('Antigravity não tem MCP por sessão.'),
  ).toBeVisible();
  await capture(page, 'delegate-antigravity');
});

test('approved V6 reference', async ({ page }) => {
  test.skip(!process.env.ORQST_DIAG26_CAPTURES, 'Capture-only visual reference');
  const body = await readFile('docs/design/v6/source/ORQST_workspace_v6_features.html', 'utf8');
  await page.route('**/diag26-v6-reference', (route) =>
    route.fulfill({ contentType: 'text/html', body }),
  );
  await page.goto('/diag26-v6-reference');
  await capture(page, 'v6-studio');
});

test('a refused native open remains a failed Studio card with a retry action', async ({ page }) => {
  await installFixture(page, 'live', true);
  await page.goto('/studio');
  const frame = () => page.evaluate(() => Reflect.get(window, 'diag27Layout'));
  const liveBody = page.locator(`[data-pane-id="${terminalId}"] .ts-body`);
  await expect(liveBody).toBeVisible();
  const box = await liveBody.boundingBox();
  expect(box).not.toBeNull();
  await expect.poll(frame).toMatchObject({
    layoutVersion: 2,
    chrome: { sidebar: 155, top: 45, bottom: 33 },
    panes: expect.arrayContaining([
      expect.objectContaining({
        terminalId,
        rect: expect.objectContaining({
          x: Math.round(box!.x - 155),
          y: Math.round(box!.y - 45),
        }),
      }),
    ]),
  });
  await page.getByRole('button', { name: '＋ Terminal', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect.poll(frame).toMatchObject({
    panes: expect.arrayContaining([expect.objectContaining({ terminalId, rect: null })]),
  });
  await dialog.getByRole('textbox').first().fill('Terminal recusado');
  await dialog.locator('button[type=submit]').click();
  const card = page.locator('.ts-pane').filter({ hasText: 'Terminal recusado' });
  await expect(card).toHaveAttribute('data-lifecycle', 'starting');
  await page.evaluate(() => {
    const terminalId = 'e75d4f83-d62e-4a74-950e-001ed1b735b7';
    Reflect.get(window, 'acceptDiag27Open')(terminalId);
    window.dispatchEvent(
      new CustomEvent('orqst-owned-pty-lifecycle', {
        detail: {
          terminalId,
          evidence: { transport: 'connected', process: 'open_refused', firstFrame: false },
        },
      }),
    );
  });
  await expect(card).toHaveAttribute('data-lifecycle', 'failed');
  await expect(card.getByText('Ação recusada')).toBeVisible();
  await expect(page.locator('.pane-lifecycle-ended')).not.toContainText('Terminal recusado');
  await card.getByRole('button', { name: 'Tentar novamente' }).click();
  await expect(page.getByRole('dialog').getByRole('textbox').first()).toHaveValue(
    'Terminal recusado',
  );
});

test('Feature round trip reapplies geometry to the same owned pane', async ({ page }) => {
  await installFixture(page, 'live', true);
  await page.goto('/studio');
  const pane = page.locator(`[data-pane-id="${terminalId}"]`);
  const frame = () => page.evaluate(() => Reflect.get(window, 'diag27Layout'));
  await expect(pane).toBeVisible();
  await expect.poll(frame).toMatchObject({
    panes: expect.arrayContaining([expect.objectContaining({ terminalId, visible: true })]),
  });
  const before = (await frame()).panes.find(
    (pane: { terminalId: string }) => pane.terminalId === terminalId,
  );
  await page.getByRole('button', { name: 'Geral', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Geral', exact: true })).toHaveAttribute(
    'aria-current',
    'true',
  );
  await expect(pane).toHaveCount(0);
  await page.getByRole('button', { name: 'Revisão', exact: true }).click();
  await expect(pane).toBeVisible();
  await expect.poll(frame).toMatchObject({
    panes: expect.arrayContaining([expect.objectContaining(before)]),
  });
});

test('reopen submits the exact released member without a new-terminal fallback', async ({
  page,
}) => {
  await installFixture(page, 'live', true);
  await page.goto('/studio');
  await page.getByText('Encerrados (2)').click();
  const released = page.locator('.pane-lifecycle-ended li').filter({ hasText: 'T-003' });
  await released.getByRole('button', { name: 'Reabrir' }).click();
  const picker = page.getByRole('dialog');
  await expect(picker.getByRole('button', { name: 'Abrir terminal', exact: true })).toHaveCount(0);
  await picker.getByRole('button', { name: /Reabrir T-003/ }).click();
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, 'diag28ReopenId')))
    .toBe(releasedId);
});

test('a cached busy admission does not disable later opens in the same scope', async ({ page }) => {
  await installFixture(page, 'live', true, true);
  await page.goto('/studio');
  await page.getByRole('button', { name: '＋ Terminal', exact: true }).click();
  await expect(
    page.getByRole('dialog').getByRole('button', { name: 'Abrir terminal', exact: true }),
  ).toBeEnabled();
});
