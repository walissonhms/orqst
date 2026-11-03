import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

// Disposable synthetic aggregate only; no user data.
type Row = {
  adapter: 'codex' | 'claude';
  model: string | null;
  sessions: number;
  usage: { input: number; output: number; cached: number; total: number } | null;
};

const summary = (models: Row[]) => ({
  contract: 'orqst.model-analytics',
  contractVersion: 1,
  query: {},
  basis: {
    tokens: 'retained_canonical_snapshot_deltas',
    period: 'fully_contained_intervals_half_open',
    workspace: 'current_session_assignment',
    sessions: 'observed_sessions_non_additive_across_models',
    comparison: 'descriptive_only',
  },
  usage: { input: 100, output: 10, cached: 5, total: 110 },
  sessions: 3,
  models: models.map((row) => ({ ...row, provider: null })),
  coverage: {
    scope: 'before_model_filter',
    complete: false,
    reason: 'source_coverage_unverified',
    sessions: 3,
    sessionsWithCanonicalUsage: 2,
    unidentifiedContributions: 1,
    gaps: [{ reason: 'usage_not_reported', count: 1 }],
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

const rows: Row[] = [
  {
    adapter: 'codex',
    model: 'shared-model',
    sessions: 2,
    usage: { input: 100, output: 10, cached: 5, total: 110 },
  },
  {
    adapter: 'claude',
    model: 'shared-model',
    sessions: 1,
    usage: { input: 0, output: 0, cached: 0, total: 0 },
  },
  { adapter: 'codex', model: null, sessions: 1, usage: null },
];

async function mock(page: Page, body: unknown) {
  await page.route('**/api/analytics/models*', (route) =>
    route.fulfill({ json: body, headers: { 'content-type': 'application/json' } }),
  );
  await page.goto('/#models');
  await expect(
    page.getByRole('region', { name: 'Export aggregate report', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.analytics-comparison')).toBeVisible();
}

async function select(page: Page, slot: number, label: string) {
  await page.locator('.analytics-comparison select').nth(slot).selectOption({ label });
}

test('rows keep adapter+model identity and distinguish null from zero', async ({ page }) => {
  await mock(page, summary(rows));
  const comparison = page.locator('.analytics-comparison');
  await expect(comparison.getByText('Descriptive, non-equivalent observations.')).toBeVisible();
  await expect(comparison).toContainText(
    'token totals do not establish quality, efficiency or a better model',
  );
  await expect(comparison).toContainText(
    'Observed identifiers do not establish current availability or access.',
  );

  const options = comparison.locator('select').first().locator('option');
  await expect(options).toHaveText([
    'Choose an observed row',
    'codex: shared-model',
    'claude: shared-model',
    'codex: Unidentified model',
  ]);

  await select(page, 0, 'codex: shared-model');
  await select(page, 1, 'claude: shared-model');
  await select(page, 2, 'codex: Unidentified model');
  const table = comparison.locator('table');
  await expect(table).toBeVisible();
  const headers = table.locator('thead th');
  await expect(headers).toHaveCount(4);
  await expect(headers.nth(1)).toContainText('shared-model');
  await expect(headers.nth(1)).toContainText('codex');
  await expect(headers.nth(2)).toContainText('shared-model');
  await expect(headers.nth(2)).toContainText('claude');
  await expect(headers.nth(3)).toContainText('Unidentified model');
  // Same model on two adapters stays two distinct columns.
  expect(await headers.nth(1).innerText()).not.toBe(await headers.nth(2).innerText());

  const tokens = table.locator('tbody tr').first().locator('td');
  await expect(tokens.nth(0)).toHaveText('110');
  await expect(tokens.nth(1)).toHaveText('0'); // confirmed zero, not "Unavailable"
  await expect(tokens.nth(2)).toHaveText('Unavailable'); // usage: null
  expect(await table.innerText()).not.toMatch(/better|best|efficient|quality score/i);
});

test('hostile identifiers are inert in options and headers', async ({ page }) => {
  const hostile = '<img src=x onerror="window.qaComparisonInjected=true">[l](javascript:alert)';
  await mock(
    page,
    summary([
      { adapter: 'codex', model: hostile, sessions: 1, usage: null },
      { adapter: 'claude', model: 'plain-model', sessions: 1, usage: null },
    ]),
  );
  const comparison = page.locator('.analytics-comparison');
  await expect(comparison.locator('select').first().locator('option').nth(1)).toHaveText(
    `codex: ${hostile}`,
  );
  await select(page, 0, `codex: ${hostile}`);
  await select(page, 1, 'claude: plain-model');
  await expect(comparison.locator('thead th').nth(1)).toContainText(hostile);
  await expect(comparison.locator('img, script, a, iframe, object, embed')).toHaveCount(0);
  expect(
    await page.evaluate(
      () => (window as unknown as { qaComparisonInjected?: boolean }).qaComparisonInjected,
    ),
  ).toBeUndefined();
});

test('refresh and filter changes reset the selection instead of comparing stale rows', async ({
  page,
}) => {
  await mock(page, summary(rows));
  const comparison = page.locator('.analytics-comparison');
  await select(page, 0, 'codex: shared-model');
  await select(page, 1, 'claude: shared-model');
  await expect(comparison.locator('table')).toBeVisible();

  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(comparison.locator('table')).toHaveCount(0);
  await expect(comparison).toContainText('Select at least two distinct observed rows to compare.');

  await select(page, 0, 'codex: shared-model');
  await select(page, 1, 'claude: shared-model');
  await expect(comparison.locator('table')).toBeVisible();
  // A filter change produces a new reading and must clear the comparison too.
  await page.getByLabel('CLI adapter', { exact: true }).selectOption('codex');
  await expect(comparison.locator('table')).toHaveCount(0);
});

test('the exported aggregate is not reduced by the comparison selection', async ({ page }) => {
  await mock(page, summary(rows));
  // All-history keeps the reading query empty, matching the synthetic aggregate.
  await page.getByLabel('Period', { exact: true }).selectOption('all');
  await expect(page.locator('.analytics-comparison')).toBeVisible();
  await select(page, 0, 'codex: shared-model');
  await select(page, 1, 'claude: shared-model');
  await expect(page.locator('.analytics-comparison table')).toBeVisible();

  const csv = page.getByRole('button', { name: 'Export CSV', exact: true });
  await expect(csv).toBeEnabled();
  const [download] = await Promise.all([page.waitForEvent('download'), csv.click()]);
  const text = await readFile((await download.path())!, 'utf8');
  // All three observed rows remain in the file, including the unselected one.
  expect(text).toContain('shared-model');
  expect(text).toContain('"\'unidentified"');
  expect(text.split('\r\n').filter((line) => line.startsWith('"\'model"')).length).toBe(3);
});

test('offline removes the comparison and pt-BR keeps it accessible', async ({ page }) => {
  let blocked = false;
  let socket: { close: () => Promise<void> } | undefined;
  await page.routeWebSocket(/\/ws/, (route) => {
    if (blocked) {
      void route.close();
      return;
    }
    socket = route;
    route.connectToServer();
  });
  await mock(page, summary(rows));
  const comparison = page.locator('.analytics-comparison');
  await select(page, 0, 'codex: shared-model');
  await select(page, 1, 'claude: shared-model');
  const table = comparison.locator('table');
  await expect(table).toBeVisible();
  await expect(
    comparison.getByRole('region', { name: 'Observed usage side by side' }),
  ).toBeVisible();
  await expect(table.locator('caption')).toHaveText('Observed usage side by side');
  await expect(table.locator('th[scope="col"]')).toHaveCount(3);
  await expect(table.locator('th[scope="row"]').first()).toHaveText('Reported tokens');

  await page.getByLabel('Language', { exact: true }).selectOption('pt-BR');
  await expect(comparison).toContainText('Comparar uso observado');
  await expect(comparison).toContainText('não comprovam qualidade, eficiência');
  await page.setViewportSize({ width: 360, height: 800 });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
  await page.getByLabel('Idioma', { exact: true }).selectOption('en-US');

  // Disconnection removes the current reading, so the comparison disappears.
  blocked = true;
  await socket!.close();
  await expect(page.locator('.analytics-comparison')).toHaveCount(0, { timeout: 15000 });
});
