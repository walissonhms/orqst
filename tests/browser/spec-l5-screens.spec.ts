import { expect, test, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  defaultFeatureId,
  featureNativeReplySchema,
  modelAnalyticsEvolutionSchema,
  modelAnalyticsQuerySchema,
  modelAnalyticsSummarySchema,
  terminalPreparationCatalogSchema,
  type FeatureNativeReply,
  type TerminalPreparationCatalog,
} from '@orqst/protocol';

const workspaceId = 'fixture-workspace';
const featureId = defaultFeatureId(workspaceId);
const secondFeatureId = '1dd8053c-eade-4467-b4bd-a3d83e133c00';
const firstTerminal = '63097963-c2dd-4fa7-9aba-e67c8294bbc6';
const secondTerminal = '2d16b16e-9b54-45dc-952c-04d0c77bab49';

function nativeFixture() {
  const at = Date.now();
  const workspace = { id: workspaceId, name: 'Workspace de teste' };
  const features = ['General', 'Revisão'].map((name, index) => ({
    schemaVersion: 1 as const,
    name,
    workspaceId: workspace.id,
    featureId: index ? secondFeatureId : featureId,
    description: '',
    status: 'active' as const,
    revision: 1,
    terminalIds: [index ? secondTerminal : firstTerminal],
    createdAt: at - 90_000,
    updatedAt: at - 30_000,
  }));
  const reply = featureNativeReplySchema.parse({
    status: 'ok',
    snapshot: {
      contractVersion: 1,
      generation: 1,
      storage: 'core',
      workspace,
      features,
      view: {
        contractVersion: 1,
        storage: 'core',
        workspaceId: workspace.id,
        featureId,
        revision: 1,
      },
      activeFeatureId: featureId,
      slots: [
        { slot: 0, terminalId: firstTerminal, provider: 'codex', selectedModel: 'fixture-gpt' },
        {
          slot: 1,
          terminalId: secondTerminal,
          provider: 'claude',
          selectedModel: 'fixture-sonnet',
        },
      ],
      layoutSaved: false,
    },
    canvas: {
      observedAt: at,
      entries: [
        { slot: 0, terminalId: firstTerminal, state: 'running', startedAt: at - 25_000 },
        {
          slot: 1,
          terminalId: secondTerminal,
          state: 'running',
          startedAt: at - 30_000,
          session: {
            provider: 'claude',
            sessionId: 'ed501812-242e-4a53-8325-d9a1c112cddc',
            bindingEvidence: 'claude-argv-receipt-transcript',
          },
          agentState: 'waiting_for_user',
          turnId: '44eb94cc-9397-4f0e-bf87-a2e29ccd4108',
          activities: [{ kind: 'tool', label: 'Read', at: at - 2000 }],
          usage: { total: 120, input: 100, output: 20, cached: 40 },
        },
      ],
    },
    accountLimits: {
      readAt: at,
      accounts: [
        {
          id: 'codex-default',
          provider: 'codex',
          index: 1,
          plan: 'Fixture',
          updatedAt: at,
          locked: false,
          windows: [{ id: '5h', label: '5h', usedPercent: 62, resetsAt: at + 3600_000 }],
        },
      ],
    },
    communication: { events: [] },
  });
  const catalog = terminalPreparationCatalogSchema.parse({
    contractVersion: 1,
    workspaceId: workspace.id,
    featureId,
    catalogId: 'f'.repeat(64),
    providers: (['codex', 'opencode', 'claude', 'antigravity'] as const).map((provider, index) => ({
      provider,
      status: index < 3 ? 'available' : 'unavailable',
      reason: index < 3 ? 'ready' : 'executable_not_found',
      ...(provider === 'codex' ? { path: '/synthetic/bin/codex', version: '0.169.0' } : {}),
      models:
        index < 3
          ? [
              {
                id: String(index + 1).repeat(64),
                label: 'CLI default',
                source: 'cli-default',
                isDefault: true,
                availability: 'unverified',
              },
            ]
          : [],
    })),
  });
  return { reply, catalog, secondFeatureId };
}

/** Browser assertions exercise the approved renderer contracts without a worker startup deadline. */
async function installAnalytics(page: Page) {
  await page.route(/\/api\/analytics\/models(?:\/evolution)?\?/, async (route) => {
    const url = new URL(route.request().url());
    const query = modelAnalyticsQuerySchema.parse(Object.fromEntries(url.searchParams));
    const first = { total: 120, input: 100, output: 20, cached: 40 };
    const second = { total: 60, input: 50, output: 10, cached: 20 };
    const summary = modelAnalyticsSummarySchema.parse({
      contract: 'orqst.model-analytics',
      contractVersion: 1,
      query,
      basis: {
        tokens: 'retained_canonical_snapshot_deltas',
        period: 'fully_contained_intervals_half_open',
        sessions: 'observed_sessions_non_additive_across_models',
        workspace: 'current_session_assignment',
        comparison: 'descriptive_only',
      },
      usage: { total: 180, input: 150, output: 30, cached: 60 },
      sessions: 2,
      models: [
        { adapter: 'codex', provider: null, model: 'fixture-gpt', sessions: 1, usage: first },
        { adapter: 'claude', provider: null, model: 'fixture-sonnet', sessions: 1, usage: second },
      ],
      coverage: {
        scope: 'before_model_filter',
        complete: false,
        reason: 'source_coverage_unverified',
        sessions: 2,
        sessionsWithCanonicalUsage: 2,
        unidentifiedContributions: 0,
        gaps: [],
      },
      unavailable: {
        provider: 'not_recorded',
        reasoningTokens: 'not_recorded',
        executions: 'not_recorded',
        duration: 'not_measured',
        successRate: 'task_outcomes_not_recorded',
        tokensPerExecution: 'executions_not_recorded',
        tokensPerCompletedTask: 'equivalent_tasks_not_recorded',
        cost: 'verified_prices_and_billing_not_recorded',
        taskEquivalence: 'not_recorded',
      },
    });
    const day = 86_400_000;
    const midnight = Math.floor(Date.now() / day) * day;
    const iso = (at: number) => new Date(at).toISOString();
    await route.fulfill({
      json: url.pathname.endsWith('/evolution')
        ? modelAnalyticsEvolutionSchema.parse({
            contract: 'orqst.model-analytics-evolution',
            contractVersion: 1,
            summary,
            bucketDays: 1,
            buckets: [
              { from: iso(midnight - day), to: iso(midnight), usage: first },
              { from: iso(midnight), to: iso(midnight + day), usage: second },
            ],
            undistributedUsage: null,
          })
        : summary,
    });
  });
}

async function installNative(page: Page) {
  const calls: Array<{ action: string; command?: string; terminalId?: string }> = [];
  await page.exposeFunction('recordSpecRequest', (request: (typeof calls)[number]) => {
    calls.push(request);
  });
  await page.addInitScript(
    ({
      reply,
      catalog,
      secondFeatureId,
    }: {
      reply: FeatureNativeReply;
      catalog: TerminalPreparationCatalog;
      secondFeatureId: string;
    }) => {
      const snapshot = reply.snapshot!;
      const record = (request: unknown) => void Reflect.get(window, 'recordSpecRequest')(request);
      Object.defineProperty(window, 'orqstFeatures', {
        value: {
          contractVersion: 1,
          request: async (request: { action: string; featureId?: string }) => {
            record(request);
            if (request.action === 'select' && request.featureId === secondFeatureId) {
              snapshot.activeFeatureId = secondFeatureId;
              snapshot.view.featureId = secondFeatureId;
              snapshot.generation++;
              snapshot.view.revision++;
              dispatchEvent(
                new CustomEvent('orqst-feature-state', { detail: structuredClone(snapshot) }),
              );
            }
            return structuredClone(reply);
          },
        },
      });
      Object.defineProperty(window, 'orqstTauriStudio', {
        value: {
          contractVersion: 1,
          request: async (request: { featureId: string }) => {
            record(request);
            return { status: 'catalog', catalog: { ...catalog, featureId: request.featureId } };
          },
        },
      });
    },
    nativeFixture(),
  );
  return calls;
}

test('Overview uses owned evidence and focuses the matching terminal across Features', async ({
  page,
}) => {
  const calls = await installNative(page);
  await page.goto('/overview');
  const overview = page.locator('.spec-screen');
  await expect(overview.locator('.spec-counters > div')).toHaveCount(5);
  await expect(
    page.locator('.topbar-actions').getByRole('button', { name: 'Refresh' }),
  ).toBeVisible();
  await expect(overview.getByRole('row', { name: /Revisão.*T-002.*Claude/ })).toBeVisible();
  await expect(overview.locator('.spec-counters dd').first()).toHaveText('2');
  const observed = overview.locator('details').filter({ hasText: 'Observed sessions' });
  await expect(observed).toHaveJSProperty('open', false);
  await observed.locator('summary').click();
  await expect(observed.getByText('Synthetic browser agent', { exact: true })).toBeVisible();
  await expect(observed.getByRole('button')).toHaveCount(0);
  expect(calls.some(({ action }) => action === 'canvas')).toBe(false);
  await overview.getByRole('button', { name: 'Open', exact: true }).click();
  await expect(page).toHaveURL(/\/studio$/);
  await expect
    .poll(() =>
      calls.some(
        ({ action, command, terminalId }) =>
          action === 'pane' && command === 'focus' && terminalId === secondTerminal,
      ),
    )
    .toBe(true);
});

test('Metrics shows known limits, unknowns, and cache as a subset', async ({ page }) => {
  await installNative(page);
  await installAnalytics(page);
  await page.goto('/models');
  const screen = page.locator('.spec-screen');
  await page
    .locator('.topbar-actions')
    .getByRole('combobox', { name: 'Feature', exact: true })
    .selectOption(secondFeatureId);
  const row = screen.getByRole('row', { name: /Claude.*fixture-sonnet/ });
  await expect(row.getByRole('cell')).toHaveText([
    'Claude',
    'fixture-sonnet',
    '100',
    '20',
    '40',
    '120',
  ]);
  await screen.getByRole('button', { name: 'Models', exact: true }).click();
  await expect(screen.getByRole('heading', { name: /ranking/i })).toBeVisible();
  await screen.getByRole('button', { name: 'Limits', exact: true }).click();
  await expect(screen.getByRole('row', { name: /Codex.*62%/ })).toBeVisible();
  await expect(screen.getByRole('row', { name: /Antigravity/ }).getByRole('cell')).toHaveText([
    '—',
    '—',
    '—',
    '—',
  ]);
});

test('Artifact preview stays in the library and leaves hostile markup inert', async ({ page }) => {
  await page.goto('/artifacts');
  const screen = page.locator('.spec-screen');
  await screen.getByRole('button', { name: /Synthetic browser result/ }).click();
  await expect(page).toHaveURL(/\/artefatos$/);
  const preview = screen.locator('.spec-artifact-preview');
  await expect(preview.getByRole('button', { name: 'Rendered' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(preview.locator('.artifact-content')).toContainText('<script>');
  await expect(preview.locator('.artifact-content script, .artifact-content img')).toHaveCount(0);
  await preview.getByRole('button', { name: 'Markdown', exact: true }).click();
  await expect(preview.locator('pre.artifact-content')).toContainText('<script>');
  const saved = page.waitForEvent('download');
  await preview.getByRole('button', { name: 'Save .md' }).click();
  expect((await saved).suggestedFilename()).toBe('artifact.md');
  await expect(preview.getByRole('button', { name: 'Open in editor' })).toBeDisabled();
});

test('Settings includes all tabs, discovers the current CLI catalog, and persists language', async ({
  page,
}) => {
  const calls = await installNative(page);
  await page.goto('/settings');
  const screen = page.locator('.spec-screen');
  await expect(screen.locator('.spec-settings-nav button')).toHaveCount(8);
  await screen.getByRole('button', { name: 'Agents', exact: true }).click();
  await expect(screen.getByRole('columnheader', { name: 'Claude', exact: true })).toBeVisible();
  await expect(screen.getByText('Not installed', { exact: true })).toBeVisible();
  await expect(screen.getByText('/synthetic/bin/codex', { exact: true })).toBeVisible();
  await expect(screen.getByText('0.169.0', { exact: true })).toBeVisible();
  await expect(screen.getByRole('link', { name: /How to install/ })).toHaveCount(1);
  await expect
    .poll(() => calls.filter(({ action }) => action === 'catalog').length)
    .toBeGreaterThan(0);
  const seen = calls.filter(({ action }) => action === 'catalog').length;
  await page
    .locator('.topbar-actions')
    .getByRole('button', { name: 'Refresh', exact: true })
    .click();
  await expect
    .poll(() => calls.filter(({ action }) => action === 'catalog').length)
    .toBeGreaterThan(seen);
  await screen.getByRole('button', { name: 'General', exact: true }).click();
  await screen.getByLabel('Language').selectOption('pt-BR');
  await expect(screen.getByRole('heading', { name: 'Configurações' })).toBeVisible();
  await page.reload();
  await expect(screen.getByLabel('Idioma')).toHaveValue('pt-BR');
});

test('Onboarding offers a skip and stays dismissed on the next launch', async ({ page }) => {
  await page.goto('/');
  const firstRun = page.getByRole('dialog', { name: 'Welcome to ORQST' });
  await expect(firstRun).toBeVisible();
  await firstRun.getByRole('button', { name: 'Skip', exact: true }).click();
  await expect(page).toHaveURL(/\/studio$/);
  await page.goto('/');
  await expect(firstRun).toHaveCount(0);
});

for (const [width, height] of [
  [1440, 900],
  [1280, 800],
] as const) {
  test(`V6 comparison captures at ${width}x${height}`, async ({ page }) => {
    const integrated = process.env.ORQST_SPEC_INTEGRATED_CAPTURES;
    test.skip(
      !integrated && process.env.ORQST_SPEC_L5_SCREENSHOTS !== '1',
      'Explicit screenshot run',
    );
    await page.setViewportSize({ width, height });
    await page.addInitScript(() => localStorage.setItem('i18nextLng', 'pt-BR'));
    await installNative(page);
    await installAnalytics(page);
    const capture = (name: string) =>
      page.screenshot({
        path: `${integrated ?? 'docs/development/spec-l5'}/${width}x${height}/${name}.png`,
        animations: 'disabled',
      });
    const screen = page.locator('.spec-screen');
    await page.goto('/overview');
    await expect(screen.getByRole('row', { name: /Revisão.*T-002.*Claude/ })).toBeVisible();
    await expect(screen.locator('.spec-counters dd').first()).toHaveText('2');
    await capture('overview');

    await page.goto('/models');
    await expect(screen.getByRole('heading', { name: 'Métricas', exact: true })).toBeVisible();
    await expect(screen.locator('.spec-usage-counters dd').first()).toHaveText('180');
    await expect(screen.locator('.analytics-evolution table')).toBeVisible();
    await capture('metrics-usage');
    await screen.getByRole('button', { name: 'Modelos', exact: true }).click();
    await expect(screen.locator('.analytics-stats')).toBeVisible();
    const selectors = screen.locator('.analytics-comparison select');
    await selectors.nth(0).selectOption(JSON.stringify(['codex', 'fixture-gpt']));
    await selectors.nth(1).selectOption(JSON.stringify(['claude', 'fixture-sonnet']));
    await expect(screen.locator('.analytics-comparison-table')).toBeVisible();
    await capture('metrics-models');
    await screen.getByRole('button', { name: 'Limites', exact: true }).click();
    await expect(screen.getByRole('row', { name: /Codex.*62%/ })).toBeVisible();
    await capture('metrics-limits');

    await page.goto('/artifacts');
    await screen.getByRole('button', { name: /Synthetic browser result/ }).click();
    await expect(screen.getByRole('button', { name: 'Renderizado', exact: true })).toBeVisible();
    await capture('artifacts-rendered');
    await screen.getByRole('button', { name: 'Markdown', exact: true }).click();
    await capture('artifacts-markdown');

    await page.goto('/settings');
    await expect(screen.getByRole('heading', { name: 'Geral', exact: true })).toBeVisible();
    await capture('settings-general');
    await screen.getByRole('button', { name: 'Agentes', exact: true }).click();
    await expect(screen.getByText('Não instalado', { exact: true })).toBeVisible();
    await capture('settings-agents');

    await page.goto('/');
    await expect(
      page.getByRole('dialog', { name: 'Boas-vindas ao ORQST' }).getByText('Não instalado'),
    ).toBeVisible();
    await capture('onboarding');

    const reference = resolve('docs/design/v6/source/ORQST_workspace_v6_features.html');
    await page.goto(pathToFileURL(reference).href);
    await expect(page.locator('.sidebar')).toBeVisible();
    await capture('v6-reference');
  });
}
