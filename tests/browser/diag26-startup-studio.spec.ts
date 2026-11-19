import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  defaultFeatureId,
  type DesktopFeatures,
  type FeatureNativeSnapshot,
  type FeatureNativeRequest,
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
  mode: 'returning' | 'first' | 'failed' | 'live' | 'antigravity' | 'diag28' | 'reserved',
  embedPtys = false,
  transientAdmission = false,
) {
  const diag28 = mode === 'diag28';
  const selected = {
    ...feature(workspaceId, featureId, 'Revisão'),
    terminalIds: [
      terminalId,
      uncertainId,
      releasedId,
      ...(mode === 'antigravity' ? [antigravityId] : []),
    ],
    terminalDisplays: [
      { terminalId, displayId: diag28 ? 'T-004' : 'T-001' },
      {
        terminalId: uncertainId,
        displayId: 'T-002',
        ...(mode === 'reserved'
          ? { name: 'Codex 1', provider: 'codex' as const, activeReservation: true as const }
          : {}),
      },
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
    layoutSaved: !diag28,
    slots: [
      {
        slot: 0,
        terminalId,
        ...(diag28
          ? { provider: 'codex', displayName: 'Codex 1' }
          : { provider: 'opencode', displayName: 'Backend' }),
      },
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
    ({ mode, startup, live, modelId, releasedId, embedPtys, transientAdmission, diag28 }) => {
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
        request: async (request: FeatureNativeRequest) => {
          if (diag28 && request.action === 'pane' && request.command === 'close')
            Reflect.set(window, 'diag28Close', request.terminalId);
          if (mode !== 'live' && mode !== 'antigravity' && !diag28)
            return { status: 'unavailable' };
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
            ...(request.action === 'inspector' && diag28
              ? {
                  inspector: {
                    status: 'ok',
                    featureId: live.activeFeatureId,
                    recipients: [live.slots[0]?.terminalId],
                    senders: [],
                    rows: [
                      {
                        id: 'synthetic-message',
                        to: live.slots[0]?.terminalId,
                        from: 'owner',
                        at,
                        delivery: 'delivered',
                        task: 'running',
                        kind: 'message',
                        text: 'Synthetic message',
                      },
                    ],
                    audit: [],
                  },
                }
              : {}),
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
                ...(diag28
                  ? {
                      pendingOwnedExits: [
                        { id: releasedId, principalCount: 1, code: 'owned_exit_pending' },
                      ],
                    }
                  : {}),
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
              Reflect.set(
                window,
                'diag28OpenNames',
                request.requests.map(({ name }) => name),
              );
              Reflect.set(window, 'acceptDiag27Open', (terminalId: string) => {
                if (diag28 && live.activeFeatureId) {
                  const feature = live.features.find(
                    ({ featureId }) => featureId === live.activeFeatureId,
                  );
                  const name = request.requests[0]?.name;
                  live.slots.push({ slot: 3, terminalId, provider: 'codex', displayName: name });
                  feature?.terminalIds.push(terminalId);
                  feature?.terminalDisplays?.push({ terminalId, displayId: 'T-005' });
                  live.generation++;
                  window.dispatchEvent(
                    new CustomEvent('orqst-feature-state', { detail: structuredClone(live) }),
                  );
                  window.dispatchEvent(
                    new CustomEvent('orqst-owned-pty-lifecycle', {
                      detail: {
                        terminalId,
                        evidence: { transport: 'connected', process: 'live', firstFrame: true },
                      },
                    }),
                  );
                }
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
                });
              });
              Reflect.set(window, 'refuseOpen', () =>
                resolve({
                  status: 'batch',
                  items: request.requests.map(({ id }) => ({
                    id,
                    status: 'refused',
                    reason: mode === 'reserved' ? 'capacity_reserved' : 'catalog_changed',
                    effects: 'not_started',
                  })),
                }),
              );
            });
          return { status: 'denied' };
        },
      });
    },
    { mode, startup, live, modelId, releasedId, embedPtys, transientAdmission, diag28 },
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

test('diag28 renders the same stable terminal ID, accessible controls and live count', async ({
  page,
}) => {
  await installFixture(page, 'diag28', true);
  await page.goto('/studio');
  const feature = page.getByRole('button', { name: 'Revisão', exact: true });
  const pane = page.locator(`[data-pane-id="${terminalId}"]`);
  const dot = pane.getByRole('img', { name: 'Sem sinal', exact: true });
  await expect(feature).toHaveText(/Revisão\s*1/);
  await expect(pane.locator('.ts-label')).toHaveText('T-004');
  await expect(dot).toHaveAttribute('title', 'Sem sinal');
  await expect(dot).toHaveCSS('background-color', 'rgb(129, 128, 149)');
  await expect(page.getByRole('button', { name: 'Delegar', exact: true })).toBeEnabled();
  const notice = page.getByRole('status').filter({ hasText: 'Layout não salvo' });
  const summary = page.locator('.ts-summary');
  const frame = () => page.evaluate(() => Reflect.get(window, 'diag27Layout'));
  await expect(notice).toBeVisible();
  await expect(summary).toContainText('1 terminal · Revisão');
  await page.locator('main').focus();
  await expect(page.locator('main')).toHaveCSS('outline-style', 'none');
  await captureDiag28(page, 'studio', async () => {
    const warningBox = (await notice.boundingBox())!;
    const summaryBox = (await summary.boundingBox())!;
    expect(warningBox.x + warningBox.width).toBeLessThan(summaryBox.x);
  });

  const menuTrigger = pane.getByRole('button', { name: 'Mais ações' });
  await expect(menuTrigger).toHaveAttribute('title', 'Mais ações');
  await menuTrigger.click();
  const menu = page.getByRole('menu');
  await expect(menu.getByRole('menuitem')).toHaveText([
    'Configurações / renomear',
    'Definir orquestrador',
    'Tornar flutuante',
    'Minimizar',
    'Maximizar / restaurar',
    'Enviar mensagem…',
    'Detalhes e logs',
    'Encerrar processo',
  ]);
  await page.keyboard.press('End');
  await expect(menu.getByRole('menuitem', { name: 'Encerrar processo' })).toBeFocused();
  await captureDiag28(page, 'pane-menu');
  await page.keyboard.press('Escape');
  await expect(menuTrigger).toBeFocused();

  await pane.locator('.ts-close').click();
  const close = page.getByRole('dialog', { name: 'Fechar T-004?' });
  await expect(close.getByRole('button')).toHaveText(['Cancelar', 'Ocultar', 'Encerrar processo']);
  await expect(close).toHaveAccessibleDescription(
    'Ocultar mantém ativo. Encerrar para o processo.',
  );
  await expect(close.getByRole('button', { name: 'Ocultar' })).toBeFocused();
  await expect.poll(frame).toMatchObject({
    panes: expect.arrayContaining([
      expect.objectContaining({
        terminalId,
        visible: true,
        rect: expect.objectContaining({ height: expect.any(Number) }),
      }),
    ]),
  });
  await captureDiag28(page, 'close', async () => {
    const box = (await close.boundingBox())!;
    const danger = (await close.getByRole('button', { name: 'Encerrar processo' }).boundingBox())!;
    const body = (await pane.locator('.ts-body').boundingBox())!;
    expect(danger.x + danger.width).toBeLessThanOrEqual(box.x + box.width);
    expect(body.y).toBeGreaterThan(box.y + box.height);
  });
  await page.keyboard.press('Escape');
  await expect(close).toHaveCount(0);
  await expect(pane.locator('.ts-close')).toBeFocused();
  await pane.locator('.ts-close').click();
  await close.getByRole('button', { name: 'Ocultar' }).click();
  await expect(page.locator('.ts-chip').getByText('Codex 1')).toBeVisible();
  expect(await page.evaluate(() => Reflect.has(window, 'diag28Close'))).toBe(false);
  await page.locator('.ts-chip').getByText('Codex 1').click();
  await pane.locator('.ts-close').click();
  await close.getByRole('button', { name: 'Encerrar processo' }).click();
  await expect.poll(() => page.evaluate(() => Reflect.get(window, 'diag28Close'))).toBe(terminalId);

  const ended = page.getByRole('button', { name: 'Encerrados (2)' });
  await expect(ended).toHaveAttribute('aria-expanded', 'false');
  await ended.press('Space');
  await expect(ended).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByText('Estado incerto')).toBeVisible();
  await captureDiag28(page, 'ended');

  const search = page.getByRole('button', { name: 'Busca e comandos' });
  await expect(search).toHaveAttribute('title', 'Buscar (⌘K)');
  await search.click();
  const palette = page.getByRole('dialog', { name: 'Busca e comandos' });
  await palette.getByRole('textbox').fill('T-004');
  await expect(palette.getByText('T-004 · Codex 1')).toBeVisible();
  await captureDiag28(page, 'palette');
  await page.keyboard.press('Escape');

  await page.getByRole('link', { name: 'Visão geral', exact: true }).click();
  await expect(page.getByRole('row', { name: /Revisão.*T-004.*Codex/ })).toBeVisible();
  await captureDiag28(page, 'overview');
  await page.getByRole('link', { name: 'Comunicação', exact: true }).click();
  await expect(page.locator('.communication-path').getByText('T-004 Codex')).toBeVisible();
  await captureDiag28(page, 'communication');
  await page.getByRole('link', { name: 'Métricas', exact: true }).click();
  await page.getByRole('combobox', { name: 'Feature', exact: true }).selectOption(featureId);
  await expect(page.getByRole('row', { name: /T-004.*Codex/ })).toBeVisible();
  await captureDiag28(page, 'metrics');

  await page.evaluate(
    (terminalId) =>
      window.dispatchEvent(
        new CustomEvent('orqst-owned-turn-alert', {
          detail: {
            kind: 'owned-turn-alert',
            contractVersion: 1,
            terminalId,
            epoch: '10000000-0000-4000-8000-000000000001',
            turnId: '10000000-0000-4000-8000-000000000002',
            slot: 0,
            category: 'waiting_for_user',
            observedAt: Date.now(),
            silent: true,
          },
        }),
      ),
    terminalId,
  );
  const bell = page.getByRole('button', { name: 'Notificações', exact: true });
  await expect(bell).toHaveAttribute('title', /Notificações/);
  await bell.click();
  const notifications = page.getByRole('dialog', { name: 'Notificações' });
  await expect(notifications.getByRole('button', { name: /T-004.*Revisão/ })).toBeVisible();
  await captureDiag28(page, 'notifications');
  await page.keyboard.press('Escape');

  await feature.click();
  await expect(page).toHaveURL('/studio');
  await page.getByRole('button', { name: '＋ Terminal', exact: true }).click();
  const create = page.getByRole('dialog', { name: 'Novo terminal' });
  await expect(create.getByRole('textbox').first()).toBeVisible();
  await expect(create.getByText(/Terminais salvos|Encerrados|recibo|descendentes/)).toHaveCount(0);
  await captureDiag28(page, 'new-terminal');
  await create.locator('button[type=submit]').click();
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, 'diag28OpenNames')))
    .toEqual(['Codex 2']);
  const starting = page.locator('.ts-pane').filter({ hasText: 'Codex 2' });
  await expect(starting.getByRole('img', { name: 'Iniciando', exact: true })).toHaveCSS(
    'background-color',
    'rgb(129, 128, 149)',
  );
  await captureDiag28(page, 'second-codex');
  await expect(feature).toHaveText(/Revisão\s*1/);
  await page.evaluate(() =>
    Reflect.get(window, 'acceptDiag27Open')('e75d4f83-d62e-4a74-950e-001ed1b735b7'),
  );
  await expect(feature).toHaveText(/Revisão\s*2/);
  await expect(starting.locator('.ts-label')).toHaveText('T-005');
  await captureDiag28(page, 'unique-live-codex');

  await page.evaluate(
    (terminalId) =>
      window.dispatchEvent(
        new CustomEvent('orqst-owned-pty-lifecycle', {
          detail: {
            terminalId,
            evidence: { transport: 'connected', process: 'exited', firstFrame: false, exitCode: 0 },
          },
        }),
      ),
    terminalId,
  );
  await expect(feature).toHaveText(/Revisão\s*1/);
  await expect(page).toHaveURL('/studio');
});

async function captureDiag28(page: Page, name: string, check?: () => Promise<void>) {
  const output = process.env.ORQST_DIAG28_UI_CAPTURES;
  for (const [width, height] of [
    [1440, 900],
    [1280, 800],
  ] as const) {
    await page.setViewportSize({ width, height });
    if (check) await check();
    if (output) {
      await page.mouse.move(1, 1);
      await page.screenshot({
        animations: 'disabled',
        path: join(output, `${width}x${height}`, name + '.png'),
      });
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
}

test('diag28 approved V6 browser references', async ({ page }) => {
  test.skip(!process.env.ORQST_DIAG28_UI_CAPTURES, 'Capture-only visual reference');
  const body = await readFile('docs/design/v6/source/ORQST_workspace_v6_features.html', 'utf8');
  await page.route('**/diag28-v6-reference', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body,
    }),
  );
  await page.goto('/diag28-v6-reference');
  await captureDiag28(page, 'v6-studio');
  await page.locator('.panehead button').filter({ hasText: '⋯' }).first().click();
  await captureDiag28(page, 'v6-menu');
  await page.locator('#add').click();
  await captureDiag28(page, 'v6-new-terminal');
});

test('a previous reservation links the failed opening to its named saved terminal', async ({
  page,
}) => {
  await installFixture(page, 'reserved');
  await page.goto('/studio');
  await page.getByRole('button', { name: '＋ Terminal', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Abrir terminal', exact: true })
    .click();
  await page.evaluate(() => Reflect.get(window, 'refuseOpen')());
  const failure = page
    .getByRole('alert')
    .filter({ hasText: 'Um terminal anterior bloqueia novas aberturas' });
  await expect(failure).toBeVisible();
  await expect(failure.getByText('capacity_reserved')).toHaveCount(0);
  await expect(failure.getByRole('button', { name: 'Tentar novamente' })).toHaveCount(0);
  await failure.getByRole('button', { name: 'Ver reserva' }).click();
  const entry = page.locator('.pane-lifecycle-ended li').filter({ hasText: 'T-002' });
  await expect(entry).toContainText('Codex 1');
  await expect(
    entry.getByText('Codex', { exact: false }).filter({ hasText: /^· Codex$/ }),
  ).toBeVisible();
  await expect(entry).toContainText('Estado incerto');
  await expect(entry).toContainText('As evidências de kernel exigidas');
  await expect(entry.getByText('Ver detalhes')).toBeFocused();
  await expect(entry.getByRole('button', { name: 'Reabrir' })).toHaveCount(0);
  await expect(entry.getByRole('button', { name: 'Remover da Feature' })).toHaveCount(0);
});
