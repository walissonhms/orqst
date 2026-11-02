import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

// Disposable synthetic Bridge fixture (tests/browser/server.ts). No user data.
const exportSection = (page: Page) =>
  page.getByRole('region', { name: 'Export aggregate report', exact: true });

const blocked =
  'Export is blocked until a new current report is available while connected. Refresh, filter changes, errors and reconnection require a new response.';
const limits =
  'This report cannot be exported: export requires at most 5,000 model buckets, model IDs of 1–256 UTF-16 characters and consistent safe-integer aggregates. The displayed report is preserved.';

async function openModels(page: Page): Promise<void> {
  await page.goto('/#models');
  await expect(page.getByRole('status').filter({ hasText: 'Live' })).toBeVisible();
  await expect(exportSection(page)).toBeVisible();
}

async function expectExportable(page: Page): Promise<void> {
  await expect(exportSection(page).getByRole('button', { name: 'Export CSV' })).toBeEnabled();
  await expect(exportSection(page).getByRole('button', { name: 'Export Markdown' })).toBeEnabled();
  await expect(exportSection(page).getByText(blocked)).toHaveCount(0);
}

async function expectBlocked(page: Page, timeout = 10000): Promise<void> {
  await expect(exportSection(page).getByRole('button', { name: 'Export CSV' })).toBeDisabled({
    timeout,
  });
  await expect(exportSection(page).getByRole('button', { name: 'Export Markdown' })).toBeDisabled({
    timeout,
  });
  await expect(exportSection(page).getByText(blocked)).toBeVisible({ timeout });
}

async function download(page: Page, name: string): Promise<{ filename: string; text: string }> {
  const [event] = await Promise.all([
    page.waitForEvent('download'),
    exportSection(page).getByRole('button', { name }).click(),
  ]);
  const path = await event.path();
  return { filename: event.suggestedFilename(), text: await readFile(path, 'utf8') };
}

test('real export downloads the aggregate without session, workspace or agent identities', async ({
  page,
}) => {
  await openModels(page);
  await expectExportable(page);

  const csv = await download(page, 'Export CSV');
  expect(csv.filename).toBe('orqst-model-usage.csv');
  expect(csv.text.startsWith('"\'section"')).toBe(true);
  expect(csv.text.includes('\r\n')).toBe(true);
  expect(csv.text.split('\r\n')[0]!.split('","').length).toBe(12);
  // The observed model is exported; identities and source paths are not.
  expect(csv.text.includes('synthetic-test-model')).toBe(true);
  for (const secret of [
    'synthetic-browser-session',
    '/synthetic/browser-test',
    'synthetic-browser',
  ])
    expect(csv.text.includes(secret), secret).toBe(false);

  const markdown = await download(page, 'Export Markdown');
  expect(markdown.filename).toBe('orqst-model-usage.md');
  expect(markdown.text.startsWith('| ')).toBe(true);
  expect(markdown.text.includes('\r')).toBe(false);
  expect(markdown.text.includes('<')).toBe(false);
  for (const secret of ['synthetic-browser-session', '/synthetic/browser-test'])
    expect(markdown.text.includes(secret), secret).toBe(false);
});

test('export stays blocked until a new response, through refresh, error, offline and reconnection', async ({
  page,
}) => {
  let mode: 'pass' | 'error' = 'pass';
  let hold = false;
  let releases: Array<() => void> = [];
  await page.route('**/api/analytics/models?*', async (route) => {
    if (mode === 'error') {
      await route.fulfill({ status: 503, json: { error: 'analytics_unavailable' } });
      return;
    }
    if (hold) await new Promise<void>((resolve) => releases.push(resolve));
    await route.continue().catch(() => undefined);
  });
  const releaseAll = () => {
    for (const release of releases) release();
    releases = [];
  };

  let blockedStream = false;
  let socket: { close: () => Promise<void> } | undefined;
  await page.routeWebSocket(/\/ws/, (route) => {
    if (blockedStream) {
      void route.close();
      return;
    }
    socket = route;
    route.connectToServer();
  });

  await openModels(page);
  await expectExportable(page);

  // Refresh held in flight: the previous report cannot be exported before the answer.
  hold = true;
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expectBlocked(page);
  await expect.poll(() => releases.length).toBeGreaterThan(0);
  await expectBlocked(page);
  releaseAll();
  hold = false;
  await expectExportable(page);

  // Failed query: no export of the stale report.
  mode = 'error';
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(
    'Local analytics is unavailable. Retry after the observer is ready; no partial results are shown.',
  );
  await expectBlocked(page);

  // Disconnected transport: no export and no stale report claim.
  mode = 'pass';
  blockedStream = true;
  await socket!.close();
  await expectBlocked(page);
  await expect(page.locator('.analytics-table')).toHaveCount(0);

  // Reconnection needs a new response even with an identical cursor.
  hold = true;
  blockedStream = false;
  await expect.poll(() => releases.length).toBeGreaterThan(0);
  await expectBlocked(page);
  releaseAll();
  hold = false;
  await expectExportable(page);
});

test('a same-task filter change cannot export the previous report', async ({ page }) => {
  let hold = false;
  let releases: Array<() => void> = [];
  await page.route('**/api/analytics/models?*', async (route) => {
    if (hold) await new Promise<void>((resolve) => releases.push(resolve));
    await route.continue().catch(() => undefined);
  });

  await openModels(page);
  await expectExportable(page);

  const downloads: string[] = [];
  page.on('download', (event) => downloads.push(event.suggestedFilename()));

  hold = true;
  const outcome = await page.evaluate(() => {
    const selects = Array.from(document.querySelectorAll('select'));
    const select = selects.find((item) =>
      item.closest('label')?.textContent?.includes('CLI adapter'),
    );
    const button = document.querySelector<HTMLButtonElement>('.analytics-export button');
    if (!select || !button) return { found: false, before: true, value: '' };
    const before = button.disabled;
    select.value = 'codex';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    // Same task as the filter change: React effects have not run yet.
    button.click();
    return { found: true, before, value: select.value };
  });
  expect(outcome.found).toBe(true);
  expect(outcome.value).toBe('codex');
  expect(outcome.before).toBe(false);

  // Blocked before the new response, and nothing was written to disk.
  await expectBlocked(page);
  await expect.poll(() => releases.length).toBeGreaterThan(0);
  expect(downloads, 'stale aggregate was exported').toEqual([]);
  for (const release of releases) release();
  releases = [];
  hold = false;
  await expectExportable(page);
  expect(downloads).toEqual([]);
});

test('a cursor change with a live stream blocks export until the new response', async ({
  page,
}) => {
  let bump = false;
  await page.route('**/api/snapshot', async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { cursor: number };
    if (bump) {
      bump = false;
      body.cursor += 1;
    }
    await route.fulfill({ response, json: body });
  });
  let hold = false;
  let releases: Array<() => void> = [];
  await page.route('**/api/analytics/models?*', async (route) => {
    if (hold) await new Promise<void>((resolve) => releases.push(resolve));
    await route.continue().catch(() => undefined);
  });

  await openModels(page);
  await expectExportable(page);

  // The observed cursor advances while the WebSocket stays connected.
  hold = true;
  bump = true;
  await expectBlocked(page);
  await expect.poll(() => releases.length).toBeGreaterThan(0);
  await expectBlocked(page);
  for (const release of releases) release();
  releases = [];
  hold = false;
  await expectExportable(page);
});

test('a snapshot error with a live stream blocks export and recovery needs a new read', async ({
  page,
}) => {
  let snapshotMode: 'ok' | 'fail' = 'ok';
  await page.route('**/api/snapshot', async (route) => {
    if (snapshotMode === 'fail') {
      await route.fulfill({ status: 500, json: { error: 'internal' } });
      return;
    }
    await route.continue().catch(() => undefined);
  });
  let hold = false;
  let releases: Array<() => void> = [];
  await page.route('**/api/analytics/models?*', async (route) => {
    if (hold) await new Promise<void>((resolve) => releases.push(resolve));
    await route.continue().catch(() => undefined);
  });

  await openModels(page);
  await expectExportable(page);

  // The transport stays connected, but snapshot reconciliation fails.
  snapshotMode = 'fail';
  await expectBlocked(page, 15000);
  await expect(page.locator('.analytics-table')).toHaveCount(0);

  // Recovery with the same cursor still needs a fresh analytics response.
  hold = true;
  snapshotMode = 'ok';
  await expect.poll(() => releases.length, { timeout: 15000 }).toBeGreaterThan(0);
  await expectBlocked(page);
  for (const release of releases) release();
  releases = [];
  hold = false;
  await expectExportable(page);
});

test('a report above export limits stays visible while export is blocked', async ({ page }) => {
  const longModel = `hostile${'a'.repeat(250)}`;
  const report = {
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
    usage: null,
    sessions: 1,
    models: [{ adapter: 'codex', provider: null, model: longModel, sessions: 1, usage: null }],
    coverage: {
      scope: 'before_model_filter',
      complete: false,
      reason: 'source_coverage_unverified',
      sessions: 1,
      sessionsWithCanonicalUsage: 0,
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
  };
  await page.route('**/api/analytics/models?*', (route) =>
    route.fulfill({ json: report, headers: { 'content-type': 'application/json' } }),
  );
  await openModels(page);

  // The screen keeps rendering the legitimate report...
  await expect(page.locator('.analytics-table tbody tr')).toHaveCount(1);
  await expect(page.locator('.analytics-table')).toContainText(longModel.slice(0, 40));
  // ...while export fails closed with an honest, specific message.
  await expect(exportSection(page).getByRole('button', { name: 'Export CSV' })).toBeDisabled();
  await expect(exportSection(page).getByRole('button', { name: 'Export Markdown' })).toBeDisabled();
  await expect(exportSection(page).getByText(limits)).toBeVisible();
  const downloaded = await page.waitForEvent('download', { timeout: 1000 }).catch(() => undefined);
  expect(downloaded).toBeUndefined();
});

test('native capability shows ack-gated controls and calls the single save channel', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const calls: Array<[string, ...unknown[]]> = [];
    (window as unknown as { __native: unknown }).__native = calls;
    (window as unknown as { orqstAnalytics: unknown }).orqstAnalytics = {
      contractVersion: 1,
      setReading(reading: unknown) {
        calls.push(['setReading', reading]);
        return Promise.resolve({ generation: 3, status: 'acknowledged' });
      },
      save(format: string, generation: number, reading: unknown) {
        calls.push(['save', format, generation, reading]);
        return Promise.resolve({ status: 'saved' });
      },
    };
  });
  await openModels(page);
  const section = exportSection(page);
  const csv = section.getByRole('button', { name: 'Export CSV' });
  await expect(csv).toBeEnabled();
  await expect(section.getByText('Choose a native destination for this reading.')).toBeVisible();
  await csv.click();
  await expect(section.getByText('Report saved. Refresh for another export.')).toBeVisible();
  // The consumed reading cannot be exported again before a new response.
  await expect(csv).toBeDisabled();
  const calls = (await page.evaluate(
    () => (window as unknown as { __native: Array<[string, ...unknown[]]> }).__native,
  )) as Array<[string, ...unknown[]]>;
  const save = calls.find((entry) => entry[0] === 'save')!;
  expect(save[1]).toBe('csv');
  expect(save[2]).toBe(3);
  const reading = save[3] as { digest: string; readingId: string; ranking: string };
  expect(reading.digest).toMatch(/^[a-f0-9]{64}$/);
  expect(reading.readingId).toMatch(/^[0-9a-f-]{36}$/);
  expect(reading.ranking).toBe('tokens');
});

test('native controls stay disabled until the current reading is acknowledged', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const pending: Array<() => void> = [];
    (window as unknown as { __release: () => void }).__release = () => {
      for (const release of pending.splice(0)) release();
    };
    (window as unknown as { orqstAnalytics: unknown }).orqstAnalytics = {
      contractVersion: 1,
      setReading() {
        return new Promise((resolve) => {
          pending.push(() => resolve({ generation: 1, status: 'acknowledged' }));
        });
      },
      save() {
        return Promise.resolve({ status: 'saved' });
      },
    };
  });
  await openModels(page);
  const csv = exportSection(page).getByRole('button', { name: 'Export CSV' });
  // No control is usable before the ack for the published reading.
  await expect(csv).toBeDisabled();
  await expect
    .poll(async () => {
      await page.evaluate(() => (window as unknown as { __release: () => void }).__release());
      return csv.isEnabled();
    })
    .toBe(true);
});

test('desktop capability alone hides export controls in a normal browser', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'orqstArtifacts', {
      value: { saveMarkdown: async () => ({ status: 'cancelled' }) },
    });
  });
  await openModels(page);
  const section = exportSection(page);
  await expect(
    section.getByText('This Desktop client does not support native Analytics save.'),
  ).toBeVisible();
  await expect(section.getByRole('button')).toHaveCount(0);
  await expect(section.locator('a[download]')).toHaveCount(0);
});

test.describe('desktop surface', () => {
  test.use({ userAgent: 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 ORQSTDesktop/0.1' });

  test('desktop user agent without preload never shows export controls', async ({ page }) => {
    await openModels(page);
    const section = exportSection(page);
    await expect(
      section.getByText('This Desktop client does not support native Analytics save.'),
    ).toBeVisible();
    await expect(section.getByRole('button')).toHaveCount(0);
    await expect(section.locator('a[download]')).toHaveCount(0);
    await expect(page.locator('.analytics-table tbody tr').first()).toBeVisible();
  });

  test('desktop capability never shows export controls', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, 'orqstArtifacts', {
        value: { saveMarkdown: async () => ({ status: 'cancelled' }) },
      });
    });
    await openModels(page);
    const section = exportSection(page);
    await expect(
      section.getByText('This Desktop client does not support native Analytics save.'),
    ).toBeVisible();
    await expect(section.getByRole('button')).toHaveCount(0);
    await expect(section.locator('a[download]')).toHaveCount(0);
  });
});
