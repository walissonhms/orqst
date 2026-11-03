import { test, expect, type Page } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

// Disposable synthetic Bridge fixture only. No user data.
const sessionId = 'synthetic-browser-session';
const control = (page: Page) => page.locator('.session-detail .live-token-threshold-control');
const status = (page: Page) =>
  page.locator('.session-detail > .live-metrics .live-token-threshold');
const live = (page: Page) => page.locator('.session-detail p.sr-only[aria-live="polite"]');

async function open(page: Page, id = sessionId) {
  await page.goto(`/#session=${id}`);
  await expect(page.getByRole('region', { name: 'Session details', exact: true })).toBeVisible();
  await expect(page.locator('.session-detail .live-metric-values strong').first()).toBeVisible();
}

async function ensureOpen(page: Page) {
  const details = control(page);
  if (!(await details.evaluate((element) => (element as HTMLDetailsElement).open)))
    await details.locator('summary').click();
}

async function apply(page: Page, value: string) {
  await ensureOpen(page);
  await control(page).getByLabel('Total-token threshold').fill(value);
  await control(page).getByRole('button', { name: 'Apply threshold' }).click();
}

test('only safe integers apply; the comparison is explicit and never persisted', async ({
  page,
}) => {
  await open(page);
  await ensureOpen(page);
  const invalid = 'Enter a whole number from 1 to 9007199254740991, using digits only.';

  for (const value of ['1e3', '0', '1.5', '-5', '9007199254740992', '9999999999999999']) {
    await apply(page, value);
    await expect(control(page).getByText(invalid)).toBeVisible();
    await expect(control(page).getByLabel('Total-token threshold')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    await expect(control(page).getByLabel('Total-token threshold')).toBeFocused();
    await expect(status(page)).toHaveCount(0);
  }

  // A safe integer applies only on the explicit gesture.
  await control(page).getByLabel('Total-token threshold').fill('100');
  await expect(status(page)).toHaveCount(0);
  await control(page).getByRole('button', { name: 'Apply threshold' }).click();
  await expect(status(page)).toContainText('Session alert threshold: 100 tokens.');
  // Fixture confirmed total is 120, so the threshold is reached.
  await expect(status(page)).toContainText(
    'The last confirmed total is at or above the threshold.',
  );

  // Nothing is persisted anywhere.
  const storage = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  expect(storage).not.toContain('100');
  // Closing and reopening the session detail loses the threshold (memory only).
  await page.getByRole('button', { name: 'Close', exact: true }).first().click();
  await expect(page.locator('.session-detail')).toHaveCount(0);
  await page
    .getByRole('button', { name: /Synthetic browser agent/ })
    .first()
    .click();
  await expect(page.getByRole('region', { name: 'Session details', exact: true })).toBeVisible();
  await expect(status(page)).toHaveCount(0);
  await expect(page.locator('.session-detail .live-token-threshold-control input')).toHaveValue('');
});

test('clear removes the comparison and the state resets across sessions', async ({ page }) => {
  const { file } = JSON.parse(await readFile(process.env.ORQST_BROWSER_STATE!, 'utf8')) as {
    file: string;
  };
  const other = 'synthetic-threshold-other';
  const time = new Date(Date.now() - 20000).toISOString();
  const line = (type: string, payload: unknown) =>
    JSON.stringify({ type, payload, timestamp: time }) + '\n';
  await writeFile(
    join(dirname(file), 'synthetic-threshold-other.jsonl'),
    line('session_meta', {
      id: other,
      cwd: '/synthetic/threshold',
      agent_nickname: 'Synthetic Other',
    }) +
      line('token_usage_record', {
        thread_id: other,
        thread_token_usage: {
          input_tokens: 10,
          output_tokens: 2,
          cached_input_tokens: 0,
          total_tokens: 12,
        },
      }),
  );

  await open(page);
  await apply(page, '100');
  await expect(status(page)).toContainText('at or above');

  await control(page).getByRole('button', { name: 'Clear threshold' }).click();
  await expect(status(page)).toHaveCount(0);
  await expect(control(page).getByLabel('Total-token threshold')).toHaveValue('');

  await apply(page, '100');
  await expect(status(page)).toContainText('at or above');
  // Switching session must not carry the threshold over.
  await open(page, other);
  await expect(status(page)).toHaveCount(0);
  await expect(page.locator('.session-detail .live-token-threshold-control input')).toHaveValue('');
  // Returning to the first session also starts clean (no persistence).
  await open(page);
  await expect(status(page)).toHaveCount(0);
});

test('offline and stale keep the comparison unavailable and recovery is honest', async ({
  page,
}) => {
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
  await open(page);
  await apply(page, '100');
  await expect(status(page)).toContainText('at or above');

  blocked = true;
  await socket!.close();
  await expect(
    page.locator('.session-detail p.fine-print').filter({ hasText: 'Bridge offline' }),
  ).toBeVisible({ timeout: 15000 });
  await expect(status(page)).toContainText(
    'Threshold comparison is unavailable until metrics are confirmed again.',
  );

  blocked = false;
  await expect(
    page.locator('.session-detail p.fine-print').filter({ hasText: 'Last confirmed reading' }),
  ).toBeVisible({ timeout: 20000 });
  await expect(status(page)).toContainText('at or above');
});

test('pending keeps the settled announcement once and the panel never announces', async ({
  page,
}) => {
  let slow = false;
  await page.route('**/api/sessions/*/metrics', async (route) => {
    if (slow) await new Promise((resolve) => setTimeout(resolve, 3000));
    await route.continue().catch(() => undefined);
  });
  await open(page);
  await apply(page, '100');
  await expect(status(page)).toContainText('at or above');
  const settled = (await live(page).textContent()) ?? '';
  expect(settled).toContain('at or above the threshold');

  // Open the artifact panel: the threshold status is shared but only the header announces.
  await page
    .getByRole('region', { name: 'Session details', exact: true })
    .getByRole('button', { name: 'Extract artifact manually', exact: true })
    .first()
    .click();
  const panel = page.getByRole('region', { name: 'Manual artifact', exact: true });
  await expect(panel.locator('.live-token-threshold')).toContainText('at or above');
  await expect(panel.locator('.live-token-threshold-control')).toHaveCount(0);
  await expect(page.locator('.session-detail [aria-live]')).toHaveCount(1);
  await expect(page.locator('.artifact-panel [aria-live]')).toHaveCount(0);

  // A slow refresh is pending: the visible comparison goes unavailable, the announcement does not change.
  slow = true;
  await expect(status(page)).toContainText(
    'Threshold comparison is unavailable until metrics are confirmed again.',
    { timeout: 12000 },
  );
  expect((await live(page).textContent()) ?? '').toBe(settled);
  await expect(page.locator('.session-detail [aria-live]')).toHaveCount(1);
  slow = false;
  await expect(status(page)).toContainText('at or above', { timeout: 12000 });
});
