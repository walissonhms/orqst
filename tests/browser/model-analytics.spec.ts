import { test, expect, type Page } from '@playwright/test';
import { appendFile, readFile } from 'node:fs/promises';
import type { ModelAnalyticsSummary, Usage } from '@orqst/protocol';

// Explicitly synthetic aggregates; no captured session content or shared fixture changes.
const usage = (total: number): Usage => ({
  total,
  input: total * 0.8,
  output: total * 0.2,
  cached: total * 0.3,
});
const hostileModel = '<img src=x onerror="window.analyticsInjected=true">';
function report(): ModelAnalyticsSummary {
  return {
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
    usage: usage(1000),
    sessions: 5,
    models: [
      { adapter: 'codex', provider: null, model: 'synthetic-beta', sessions: 3, usage: usage(300) },
      { adapter: 'codex', provider: null, model: null, sessions: 1, usage: usage(100) },
      {
        adapter: 'codex',
        provider: null,
        model: 'synthetic-alpha',
        sessions: 2,
        usage: usage(600),
      },
      { adapter: 'codex', provider: null, model: hostileModel, sessions: 2, usage: null },
    ],
    coverage: {
      scope: 'before_model_filter',
      complete: false,
      reason: 'source_coverage_unverified',
      sessions: 5,
      sessionsWithCanonicalUsage: 3,
      unidentifiedContributions: 1,
      gaps: [
        { reason: 'usage_not_reported', count: 2 },
        { reason: 'window_boundary', count: 1 },
      ],
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
  };
}
async function syntheticApi(page: Page) {
  const queries: URLSearchParams[] = [];
  await page.route('**/api/analytics/models?*', async (route) => {
    const query = new URL(route.request().url()).searchParams;
    queries.push(query);
    const body = report();
    if (query.has('model') || query.has('unidentified')) {
      body.models = body.models.filter((row) =>
        query.has('unidentified') ? row.model === null : row.model === query.get('model'),
      );
      body.usage = body.models[0]?.usage ?? null;
      body.sessions = body.models[0]?.sessions ?? 0;
    }
    await route.fulfill({ json: body });
  });
  return queries;
}
async function openModels(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('status').filter({ hasText: 'Live' })).toBeVisible();
  await page.getByRole('link', { name: 'Most used models' }).click();
  await expect(page.locator('.analytics-table tbody tr')).toHaveCount(4);
}

test('synthetic multi-model ranking, explicit unknowns, shares, sessions, escaping and navigation', async ({
  page,
}) => {
  const queries = await syntheticApi(page);
  await openModels(page);
  const rows = page.locator('.analytics-table tbody tr');
  await expect(rows.nth(0)).toContainText('synthetic-alpha');
  await expect(rows.nth(0)).toContainText('60%');
  await expect(rows.nth(1)).toContainText('synthetic-beta');
  await expect(rows.nth(2)).toContainText('Unidentified model');
  await expect(rows.nth(2)).toContainText('10%');
  await expect(rows.nth(3)).toContainText(hostileModel);
  await expect(rows.nth(3).locator('td').nth(1)).toHaveText('Unavailable');
  await expect(page.locator('.analytics-stats .stat').nth(1)).toContainText('1,000');
  await expect(page.locator('.analytics-stats .stat').nth(2).locator('strong')).toHaveText('5');
  await expect(page.locator('.analytics-coverage')).toContainText('Incomplete coverage');
  await expect(page.getByText(/Token shares and bars use 1,000/)).toBeVisible();
  await expect(page.getByText('Usage not reported: 2')).toBeVisible();
  await expect(page.getByText('Measurement crosses period boundary: 1')).toBeVisible();
  expect(await page.locator('.analytics img').count()).toBe(0);
  expect(await page.evaluate(() => Reflect.get(window, 'analyticsInjected'))).toBeUndefined();
  await page.screenshot({ path: '/tmp/orqst-models-desktop.png', fullPage: true });
  const count = queries.length;
  await page.getByLabel('Rank by').selectOption('sessions');
  await expect(rows.nth(0)).toContainText('synthetic-beta');
  await expect(page.locator('.analytics-leader')).toHaveText('synthetic-beta');
  expect(queries).toHaveLength(count);
  await expect(page.getByRole('link', { name: 'Most used models' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await page.getByRole('link', { name: 'Overview', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your agents, in focus.' })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Most used models' })).toBeVisible();
});

test('synthetic filters preserve workspace and send exact IDs with exclusive unidentified selection', async ({
  page,
}) => {
  const queries = await syntheticApi(page);
  await openModels(page);
  await page.getByRole('navigation', { name: 'Workspaces' }).getByRole('button').nth(1).click();
  await expect.poll(() => queries.at(-1)?.get('workspaceId')).not.toBeNull();
  const workspace = queries.at(-1)?.get('workspaceId');
  expect(workspace).toBeTruthy();
  await page.getByLabel('Agent ID', { exact: true }).fill('synthetic-agent-id');
  await page.getByLabel('CLI adapter', { exact: true }).selectOption('codex');
  await page.getByLabel('Exact model ID', { exact: true }).fill('synthetic-alpha');
  await expect(page.locator('.analytics-table tbody tr')).toHaveCount(1);
  await expect.poll(() => queries.at(-1)?.get('model')).toBe('synthetic-alpha');
  expect(queries.at(-1)?.get('agentId')).toBe('synthetic-agent-id');
  expect(queries.at(-1)?.get('adapter')).toBe('codex');
  expect(queries.at(-1)?.get('workspaceId')).toBe(workspace);
  await page.getByLabel('Unidentified model only').check();
  await expect(page.getByLabel('Exact model ID', { exact: true })).toBeDisabled();
  await expect.poll(() => queries.at(-1)?.get('unidentified')).toBe('true');
  expect(queries.at(-1)?.has('model')).toBe(false);
  await expect(page.locator('.analytics-table tbody tr')).toContainText('Unidentified model');
  await expect(page.getByText(/Token shares and bars use 100 reported tokens/)).toBeVisible();
  await expect(page.getByLabel('CLI adapter', { exact: true }).locator('option')).toHaveCount(2);
});

test.describe('local calendar query boundaries', () => {
  test.use({ timezoneId: 'America/New_York' });
  test('presets and custom bounds use UTC across DST; invalid custom does not request', async ({
    page,
  }) => {
    await page.clock.setFixedTime(new Date('2026-03-08T16:00:00Z'));
    const queries = await syntheticApi(page);
    await openModels(page);
    expect(queries.at(-1)?.get('from')).toBe('2026-03-02T05:00:00.000Z');
    expect(queries.at(-1)?.get('to')).toBe('2026-03-09T04:00:00.000Z');
    await page.getByLabel('Period', { exact: true }).selectOption('today');
    await expect.poll(() => queries.at(-1)?.get('from')).toBe('2026-03-08T05:00:00.000Z');
    await page.getByLabel('Period', { exact: true }).selectOption('month');
    await expect.poll(() => queries.at(-1)?.get('from')).toBe('2026-02-07T05:00:00.000Z');
    await page.getByLabel('Period', { exact: true }).selectOption('all');
    await expect.poll(() => queries.at(-1)?.has('from')).toBe(false);
    expect(queries.at(-1)?.has('to')).toBe(false);
    const count = queries.length;
    await page.getByLabel('Period', { exact: true }).selectOption('custom');
    await expect(page.getByRole('alert')).toContainText('Choose valid start');
    await page.getByLabel('Start date', { exact: true }).fill('2026-03-09');
    await page.getByLabel('End date (inclusive)', { exact: true }).fill('2026-03-08');
    await expect(page.getByRole('alert')).toContainText('Choose valid start');
    await page.waitForTimeout(450);
    expect(queries).toHaveLength(count);
    await page.getByLabel('Start date', { exact: true }).fill('2026-03-08');
    await expect.poll(() => queries.at(-1)?.get('from')).toBe('2026-03-08T05:00:00.000Z');
    expect(queries.at(-1)?.get('to')).toBe('2026-03-09T04:00:00.000Z');
    await expect(page.getByText(/Calendar days in America\/New_York/)).toBeVisible();
  });
});

test('loading, unavailable versus zero, empty, HTTP errors and explicit retry', async ({
  page,
}) => {
  let mode: 'loading' | 'empty' | 'missing' | 'zero' | 'capacity' | 'invalid' | 'error' = 'loading';
  let release: (() => void) | undefined;
  await page.route('**/api/analytics/models?*', async (route) => {
    if (mode === 'loading')
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    if (mode === 'capacity' || mode === 'invalid' || mode === 'error') {
      await route.fulfill({
        status: mode === 'capacity' ? 503 : mode === 'invalid' ? 400 : 500,
        json: { error: mode === 'capacity' ? 'analytics_capacity_exceeded' : 'invalid_query' },
      });
      return;
    }
    const body = report();
    body.usage = mode === 'zero' ? usage(0) : null;
    body.models = mode === 'empty' ? [] : [{ ...body.models[0]!, usage: body.usage }];
    body.sessions = mode === 'empty' ? 0 : 1;
    await route.fulfill({ json: body });
  });
  await page.goto('/#models');
  await expect(page.getByText('Loading model usage…')).toBeVisible();
  await expect.poll(() => Boolean(release)).toBe(true);
  mode = 'empty';
  release?.();
  await expect(page.getByText('No model observations match this query.')).toBeVisible();
  await expect(page.locator('.analytics-stats .stat').nth(1).locator('strong')).toHaveText(
    'Unavailable',
  );
  mode = 'missing';
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.locator('.analytics-table tbody tr')).toHaveCount(1);
  await expect(page.locator('.analytics-leader')).toHaveText('Unavailable');
  mode = 'zero';
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.locator('.analytics-stats .stat').nth(1).locator('strong')).toHaveText('0');
  await expect(page.locator('.analytics-table tbody tr td').nth(2)).toHaveText('Unavailable');
  mode = 'capacity';
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('exceeds local analytics capacity');
  await expect(page.locator('.analytics-table')).toHaveCount(0);
  mode = 'invalid';
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('bridge rejected');
  mode = 'error';
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Could not load model usage');
  await expect(page.locator('.analytics-coverage')).toBeVisible();
  mode = 'empty';
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByText('No model observations match this query.')).toBeVisible();
});

test('late synthetic responses cannot overwrite the current filter', async ({ page }) => {
  await syntheticApi(page);
  await openModels(page);
  let release: (() => void) | undefined;
  await page.route('**/api/analytics/models?*model=slow*', async (route) => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    const body = report();
    body.models = [{ ...body.models[0]!, model: 'stale-synthetic-model' }];
    await route.fulfill({ json: body });
  });
  await page.getByLabel('Exact model ID', { exact: true }).fill('slow');
  await expect.poll(() => Boolean(release)).toBe(true);
  await page.getByLabel('Exact model ID', { exact: true }).fill('synthetic-alpha');
  await expect(page.locator('.analytics-table tbody tr')).toHaveCount(1);
  await expect(page.locator('.analytics-table')).toContainText('synthetic-alpha');
  release?.();
  await page.waitForTimeout(450);
  await expect(page.locator('.analytics-table')).not.toContainText('stale-synthetic-model');
});

test('mobile dedicated navigation and Portuguese translation preserve plain model labels', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await syntheticApi(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Workspaces', exact: true }).click();
  await page.getByRole('link', { name: 'Most used models' }).click();
  await expect(page.locator('.analytics-table tbody tr')).toHaveCount(4);
  await page.getByLabel('Language').selectOption('pt-BR');
  await expect(page.getByRole('heading', { name: 'Modelos mais utilizados' })).toBeVisible();
  await expect(page.getByLabel('Período', { exact: true })).toBeVisible();
  await expect(page.locator('.analytics-coverage')).toContainText('Cobertura incompleta');
  await expect(page.locator('.analytics-table')).toContainText('Modelo não identificado');
  await expect(page.locator('.analytics-table')).toContainText(hostileModel);
  await expect(page.locator('.analytics')).not.toContainText('analytics.');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Modelos mais utilizados' })).toBeVisible();
  await page.getByLabel('Idioma').selectOption('en-US');
  await expect(page.getByRole('heading', { name: 'Most used models' })).toBeVisible();
  await expect(page.locator('.analytics-table tbody tr')).toHaveCount(4);
  const tableScroll = page.locator('.analytics .table-scroll');
  await tableScroll.focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => tableScroll.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  await page.screenshot({ path: '/tmp/orqst-models-mobile.png', fullPage: true });
});

test('analytics refresh follows observed source events, not snapshot polling or rendering', async ({
  page,
}) => {
  const queries = await syntheticApi(page);
  await openModels(page);
  const count = queries.length;
  await page.getByLabel('Language').selectOption('pt-BR');
  await page.getByLabel('Idioma').selectOption('en-US');
  // Cross the existing snapshot polling interval with no new source evidence.
  await page.waitForTimeout(5500);
  expect(queries).toHaveLength(count);
  const { file } = JSON.parse(await readFile(process.env.ORQST_BROWSER_STATE!, 'utf8')) as {
    file: string;
  };
  const timestamp = new Date().toISOString();
  await appendFile(
    file,
    [
      {
        type: 'event_msg',
        payload: { type: 'task_started', turn_id: 'synthetic-analytics-refresh-turn' },
      },
      {
        type: 'token_usage_record',
        payload: {
          thread_id: 'synthetic-browser-session',
          response_id: 'synthetic-analytics-refresh',
          thread_token_usage: {
            input_tokens: 160,
            output_tokens: 30,
            cached_input_tokens: 60,
            total_tokens: 190,
          },
        },
      },
      {
        type: 'event_msg',
        payload: {
          type: 'task_complete',
          last_agent_message: 'Synthetic analytics refresh result',
        },
      },
    ]
      .map((record) => JSON.stringify({ ...record, timestamp }) + '\n')
      .join(''),
  );
  await expect.poll(() => queries.length).toBe(count + 1);
  await expect(page.locator('.analytics-table tbody tr')).toHaveCount(4);
  await page.waitForTimeout(600);
  expect(queries).toHaveLength(count + 1);
});
