import { test, expect, type Page } from '@playwright/test';

// Disposable synthetic Bridge fixture (tests/browser/server.ts). No user data.
const sessionId = 'synthetic-browser-session';
const hash = 'a'.repeat(64);

const history = (entries: Array<{ sequence: number; model: string | null; at?: string }>) => ({
  availability: 'available',
  value: {
    contract: 'orqst.session-model-history',
    contractVersion: 1,
    sessionId,
    adapter: 'codex',
    coverage: 'partial',
    basis: 'normalized_event_carried_identifier',
    sourceVerification: 'not_rechecked',
    entries: entries.map((entry) => ({
      sequence: entry.sequence,
      normalizedEventAt: entry.at ?? '2026-11-02T10:00:00.000Z',
      model: entry.model,
      source: { hash, recordType: 'turn_context' },
    })),
  },
});

async function openHistory(page: Page) {
  await page.goto(`/#session=${sessionId}`);
  await expect(page.getByRole('region', { name: 'Session details', exact: true })).toBeVisible();
  const details = page.locator('.model-history');
  await expect(details).toBeVisible();
  return details;
}

test('history loads only when expanded, with no query and no controls', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/model-history')) requests.push(request.url());
  });
  const details = await openHistory(page);
  // Collapsed by default: nothing is fetched before the user expands it.
  expect(await details.getAttribute('open')).toBeNull();
  expect(requests).toEqual([]);

  await details.locator('summary').click();
  await expect(details).toContainText(
    'Partial coverage: at most the latest 32 compact evidence records',
  );
  await expect(details).toContainText('Repeated identifiers are not model changes');
  await expect(details).toContainText(
    'They do not prove the original declaration, effective use or current model',
  );
  const entries = details.locator('ol li');
  await expect(entries.first()).toBeVisible();
  await expect(entries.first().locator('code').first()).toHaveText('synthetic-test-model');
  await expect(entries.first().locator('time')).toHaveAttribute('datetime', /^\d{4}-\d{2}-\d{2}T/);
  await expect(entries.first()).toContainText('Compact evidence #');
  // Provenance stays within the fixed record-type allowlist and a 64-hex hash.
  await expect(entries.first().locator('code').nth(1)).toHaveText(
    /^(turn_context|event_msg:task_started|event_msg:token_count|token_usage_record)$/,
  );
  await expect(entries.first().locator('code').nth(2)).toHaveText(/^[a-f0-9]{64}$/);
  // No model controls, no export/open-source actions.
  await expect(details.locator('select, input, button, a')).toHaveCount(0);
  // The client never sends a query or body.
  expect(requests.length).toBeGreaterThan(0);
  for (const url of requests) expect(new URL(url).search).toBe('');
});

test('an all-null window is explicit and never implies a model', async ({ page }) => {
  await page.route('**/api/sessions/*/model-history', (route) =>
    route.fulfill({
      json: history([
        { sequence: 2, model: null },
        { sequence: 1, model: null },
      ]),
      headers: { 'content-type': 'application/json' },
    }),
  );
  const details = await openHistory(page);
  await details.locator('summary').click();
  await expect(details).toContainText(
    'No model identifier is recorded in this partial window. These records do not establish any model.',
  );
  await expect(details.locator('ol li')).toHaveCount(2);
  await expect(details.locator('ol li').first().locator('code').first()).toHaveText('Not recorded');
});

test('unavailable reasons and oversized bodies are explicit and drop the reading', async ({
  page,
}) => {
  let mode: 'conflict' | 'oversized' = 'conflict';
  await page.route('**/api/sessions/*/model-history', (route) => {
    if (mode === 'oversized')
      return route.fulfill({
        body: 'x'.repeat(24 * 1024 + 1),
        headers: { 'content-type': 'application/json' },
      });
    return route.fulfill({
      json: { availability: 'unavailable', reason: 'identity_conflict' },
      headers: { 'content-type': 'application/json' },
    });
  });
  const details = await openHistory(page);
  await details.locator('summary').click();
  await expect(details).toContainText('History unavailable: session evidence identity conflicts.');
  await expect(details.locator('ol')).toHaveCount(0);

  // An oversized body is rejected before JSON/schema and shows the generic failure.
  mode = 'oversized';
  await details.locator('summary').click();
  await expect(details.locator('ol')).toHaveCount(0);
  await details.locator('summary').click();
  await expect(details).toContainText('History unavailable: the reading could not be validated.');
  await expect(details.locator('ol')).toHaveCount(0);
});

test('a non-JSON response is rejected before any parsing or rendering', async ({ page }) => {
  await page.route('**/api/sessions/*/model-history', (route) =>
    route.fulfill({
      status: 200,
      body: '<html><body>not json</body></html>',
      headers: { 'content-type': 'text/html' },
    }),
  );
  const details = await openHistory(page);
  await details.locator('summary').click();
  await expect(details).toContainText('History unavailable: the reading could not be validated.');
  await expect(details.locator('ol')).toHaveCount(0);
  await expect(details.locator('code')).toHaveCount(0);
});

test('offline shows the disconnected state without keeping the previous list', async ({ page }) => {
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
  const details = await openHistory(page);
  await details.locator('summary').click();
  await expect(details.locator('ol li').first()).toBeVisible();

  blocked = true;
  await socket!.close();
  await expect(details).toContainText('History unavailable while disconnected.', {
    timeout: 15000,
  });
  await expect(details.locator('ol')).toHaveCount(0);
});

test('hostile identifiers are rendered as inert text', async ({ page }) => {
  const hostile = '<img src=x onerror="window.qaHistoryInjected=true">[l](javascript:alert)';
  await page.route('**/api/sessions/*/model-history', (route) =>
    route.fulfill({
      json: history([{ sequence: 1, model: hostile }]),
      headers: { 'content-type': 'application/json' },
    }),
  );
  const details = await openHistory(page);
  await details.locator('summary').click();
  await expect(details.locator('ol li code').first()).toHaveText(hostile);
  await expect(details.locator('img, script, a, iframe, object, embed')).toHaveCount(0);
  expect(
    await page.evaluate(
      () => (window as unknown as { qaHistoryInjected?: boolean }).qaHistoryInjected,
    ),
  ).toBeUndefined();
});

test('switching session discards a late response for the previous session', async ({ page }) => {
  let release: (() => void) | undefined;
  await page.route('**/api/sessions/*/model-history', async (route) => {
    const url = route.request().url();
    if (url.includes(sessionId)) {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return route.fulfill({
        json: history([{ sequence: 1, model: 'stale-previous-model' }]),
        headers: { 'content-type': 'application/json' },
      });
    }
    return route.continue().catch(() => undefined);
  });
  const details = await openHistory(page);
  await details.locator('summary').click();
  await expect.poll(() => Boolean(release)).toBe(true);

  // Close the panel before the slow response resolves: the reading must be discarded.
  await page.getByRole('button', { name: 'Close', exact: true }).first().click();
  await expect(page.locator('.model-history')).toHaveCount(0);
  release?.();
  await page.waitForTimeout(500);
  await expect(page.locator('body')).not.toContainText('stale-previous-model');
});
