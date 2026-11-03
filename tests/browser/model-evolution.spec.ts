import { test, expect } from '@playwright/test';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';

// Native-shaped synthetic source in the browser harness's disposable directory only.
test('evolution reconciles real observer/API readings, unknown windows, filters and both locales', async ({
  page,
}) => {
  const state = JSON.parse(await readFile(process.env.ORQST_BROWSER_STATE!, 'utf8')) as {
    file: string;
  };
  const file = join(dirname(state.file), 'synthetic-evolution.jsonl');
  const record = (timestamp: string, type: string, payload: unknown) =>
    JSON.stringify({ timestamp, type, payload }) + '\n';
  const records = [
    record('2026-10-01T12:00:00Z', 'session_meta', {
      id: 'synthetic-evolution-session',
      cwd: '/synthetic/evolution-project',
      agent_nickname: 'Synthetic evolution agent',
    }),
  ];
  for (const [timestamp, total] of [
    ['2026-10-01T12:00:00Z', 50],
    ['2026-10-02T12:00:00Z', 80],
    ['2026-10-04T12:00:00Z', 110],
    ['2026-10-06T12:00:00Z', 110],
  ] as const) {
    records.push(record(timestamp, 'turn_context', { model: 'synthetic-evolution-model' }));
    records.push(
      record(timestamp, 'token_usage_record', {
        thread_id: 'synthetic-evolution-session',
        thread_token_usage: {
          input_tokens: total,
          output_tokens: 0,
          cached_input_tokens: 0,
          total_tokens: total,
        },
      }),
    );
  }
  try {
    await writeFile(file, records.join(''));
    await page.goto('/#models');
    await expect(page.getByRole('status').filter({ hasText: 'Live' })).toBeVisible();
    await page
      .getByRole('navigation', { name: 'Workspaces' })
      .getByRole('button', { name: /evolution-project/ })
      .click();
    await page.getByLabel('Period', { exact: true }).selectOption('all');
    await page.getByLabel('Exact model ID', { exact: true }).fill('synthetic-evolution-model');
    await expect(page.locator('.analytics-table tbody')).toContainText('synthetic-evolution-model');
    const panel = page.locator('.analytics-evolution');
    await panel.getByRole('button', { name: 'Show evolution', exact: true }).click();
    const rows = panel.locator('tbody tr');
    await expect(rows).toHaveCount(5);
    await expect(rows.nth(0)).toContainText('30');
    await expect(rows.nth(1)).toContainText('Unavailable');
    await expect(rows.nth(4).locator('td').nth(1)).toHaveText('0');
    await expect(panel).toContainText('unknown time distribution');
    await expect(panel).toContainText('Coverage is incomplete');
    const response = await page.request.get(
      '/api/analytics/models/evolution?model=synthetic-evolution-model',
    );
    expect(response.ok()).toBeTruthy();
    const report = await response.json();
    expect(report.summary.usage.total).toBe(60);
    expect(
      report.buckets.reduce(
        (sum: number, bucket: { usage: { total: number } | null }) =>
          sum + (bucket.usage?.total ?? 0),
        0,
      ),
    ).toBe(60);
    await page.getByLabel('Unidentified model only').check();
    await expect(panel.locator('tbody tr')).toHaveCount(0);
    await panel.getByRole('button', { name: 'Show evolution', exact: true }).click();
    await expect(panel).toContainText('No covered interval with a known start');
    await expect(panel.locator('.analytics-evolution-totals')).toContainText('50');
    await page.getByLabel('Language', { exact: true }).selectOption('pt-BR');
    await expect(panel.getByRole('heading')).toHaveText('Evolução do uso');
    await expect(panel).toContainText('distribuição temporal desconhecida');
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBeTruthy();
  } finally {
    await rm(file, { force: true });
  }
});

test('evolution rejects mismatched readings and removes pending data after filter changes', async ({
  page,
}) => {
  await page.goto('/#models');
  await expect(page.getByRole('status').filter({ hasText: 'Live' })).toBeVisible();
  await page.getByLabel('Period', { exact: true }).selectOption('all');
  const panel = page.locator('.analytics-evolution');
  await expect(panel.getByRole('button', { name: 'Show evolution' })).toBeVisible();
  await page.route('**/api/analytics/models/evolution?*', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.summary.query = { model: 'different-synthetic-query' };
    await route.fulfill({ json: body });
  });
  await panel.getByRole('button', { name: 'Show evolution' }).click();
  await expect(panel.getByRole('alert')).toContainText('no longer matches');
  await expect(panel.locator('tbody')).toHaveCount(0);
  await page.unroute('**/api/analytics/models/evolution?*');
  let finish: (() => void) | undefined;
  await page.route('**/api/analytics/models/evolution?*', async (route) => {
    const response = await route.fetch();
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    await route.fulfill({ response }).catch(() => {});
  });
  await panel.getByRole('button', { name: 'Refresh evolution' }).click();
  await expect.poll(() => !!finish).toBeTruthy();
  await page.getByLabel('Exact model ID', { exact: true }).fill('missing-synthetic-model');
  await expect(panel.getByRole('button', { name: 'Show evolution' })).toBeVisible();
  finish!();
  await expect(panel.locator('tbody')).toHaveCount(0);
});
