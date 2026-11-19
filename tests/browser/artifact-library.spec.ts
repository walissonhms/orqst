// All observations in this suite come from the disposable synthetic browser fixture.
import { expect, test, type Page } from '@playwright/test';
import type { Snapshot, StoredEvent } from '@orqst/protocol';
import { changeLanguage, coreStatus } from '../helpers/spec-dashboard.js';

const searchName = 'Search artifacts';
const cards = (page: Page) => page.locator('.spec-artifact-item');
async function ready(page: Page) {
  await page.goto('/artifacts');
  await expect(cards(page)).toHaveCount(1);
  await expect(cards(page)).toBeEnabled();
}
async function template(page: Page) {
  await page.goto('/overview');
  await expect(coreStatus(page).filter({ hasText: 'CORE ONLINE' })).toBeVisible();
  const data = await page.evaluate(async () => {
    const response = await fetch('/api/events?limit=200');
    return response.json() as Promise<{ events: StoredEvent[] }>;
  });
  return data.events.find((event) => event.payload.role === 'assistant')!;
}
function event(source: StoredEvent, sequence: number, text: string): StoredEvent {
  return {
    ...source,
    id: `synthetic-library-${sequence}`,
    sequence,
    payload: { ...source.payload, text },
  };
}

test('real retained source search opens the split preview and keeps markup inert', async ({
  page,
}) => {
  await ready(page);
  const source = await cards(page).locator('strong').innerText();
  await expect(cards(page).locator('script, img, a, iframe')).toHaveCount(0);
  await page.getByRole('searchbox', { name: searchName }).fill('<script>');
  await expect(cards(page)).toHaveCount(1);
  await page.getByRole('searchbox', { name: searchName }).fill('absent synthetic term');
  await expect(cards(page)).toHaveCount(0);
  await expect(page.getByText(/No matching sources/)).toBeVisible();
  await page.getByRole('searchbox', { name: searchName }).fill('');
  await cards(page).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL('/artefatos');
  const panel = page.getByRole('region', { name: 'Manual artifact', exact: true });
  await expect(panel.getByRole('heading', { name: 'Manual artifact', exact: true })).toBeFocused();
  await expect(panel.locator('.artifact-content')).toContainText(source);
  await expect(panel.locator('.artifact-content').locator('script, img, a, iframe')).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Open in editor' })).toBeDisabled();
  await panel.getByRole('button', { name: 'Markdown', exact: true }).click();
  await expect(panel.locator('pre.artifact-content')).toHaveText(source);
  await panel.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(panel).toHaveCount(0);
  await page.reload();
  await expect(cards(page)).toHaveCount(1);
});

test('older-page search discloses loaded coverage, sends exact selection and handles expired sources honestly', async ({
  page,
}) => {
  const source = await template(page);
  const recent: StoredEvent[] = Array.from({ length: 200 }, (_, index) => ({
    ...event(source, index + 101, 'Synthetic non-source'),
    type: 'agent.updated' as const,
  }));
  recent[199] = event(source, 300, 'Synthetic newest source');
  const older = event(source, 100, 'Synthetic older needle');
  const before: string[] = [];
  await page.route('**/api/events?**', async (route) => {
    const url = new URL(route.request().url());
    before.push(url.searchParams.get('before') ?? '');
    await route.fulfill({
      json: { events: url.searchParams.get('before') === '101' ? [older] : recent, cursor: 300 },
    });
  });
  await page.getByRole('link', { name: 'Artifacts', exact: true }).click();
  await expect(cards(page)).toHaveCount(1);
  await page.getByRole('searchbox', { name: searchName }).fill('older needle');
  await expect(cards(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Load older observations', exact: true }).click();
  await expect(cards(page)).toHaveCount(1);
  await expect(page.getByText('1 artifact', { exact: true })).toHaveAttribute(
    'title',
    'Matching sources: 1 · Loaded sources: 2 · Observations read: 201',
  );
  await expect(page.getByRole('button', { name: 'Refresh sources', exact: true })).toBeFocused();
  await expect(
    page.getByRole('button', { name: 'Load older observations', exact: true }),
  ).toBeDisabled();
  expect(before).toEqual([String(Number.MAX_SAFE_INTEGER), '101']);
  let selection: unknown;
  await page.route('**/api/artifacts/extract', async (route) => {
    selection = route.request().postDataJSON();
    await route.fulfill({ json: { availability: 'unavailable', reason: 'event_not_retained' } });
  });
  await cards(page).click();
  await expect(page.getByRole('region', { name: 'Manual artifact', exact: true })).toContainText(
    'no longer retained',
  );
  expect(selection).toEqual({
    contractVersion: 1,
    sequence: 100,
    eventId: older.id,
    sessionId: older.sessionId,
    machineId: older.machineId,
    adapter: older.adapter,
    workspaceId: older.workspaceId,
    agentId: older.agentId,
    sourceHash: older.source.hash,
  });
});

test('scope uses current workspace association while switching workspaces aborts obsolete readings', async ({
  page,
}) => {
  const source = await template(page);
  const snapshotResponse = await page.request.get('/api/snapshot');
  const snapshot = (await snapshotResponse.json()) as Snapshot;
  const originalSession = snapshot.sessions[0]!;
  const originalWorkspace = snapshot.workspaces[0]!;
  snapshot.workspaces.push({
    ...originalWorkspace,
    id: 'synthetic-other-workspace',
    name: 'Synthetic other workspace',
  });
  snapshot.sessions.push({
    ...originalSession,
    id: 'synthetic-other-session',
    workspaceId: 'synthetic-other-workspace',
    agentName: 'Synthetic other agent',
  });
  await page.route('**/api/snapshot', (route) => route.fulfill({ json: snapshot }));
  let release = () => {};
  const delayed = new Promise<void>((resolve) => {
    release = resolve;
  });
  let reads = 0;
  await page.route('**/api/events?**', async (route) => {
    const first = ++reads === 1;
    if (first) await delayed;
    const other = {
      ...event(source, 2, 'Synthetic other source'),
      sessionId: 'synthetic-other-session',
    };
    await route
      .fulfill({
        json: {
          events: first ? [event(source, 1, 'Synthetic obsolete source')] : [other],
          cursor: 2,
        },
      })
      .catch(() => {});
  });
  await page.getByRole('link', { name: 'Artifacts', exact: true }).click();
  await expect.poll(() => reads).toBe(1);
  await page.getByRole('button', { name: 'Synthetic other workspace', exact: true }).click();
  await expect(cards(page)).toHaveCount(1);
  await expect(cards(page)).toContainText('Synthetic other source');
  await expect(cards(page)).toContainText('Synthetic other workspace');
  release();
  await expect(cards(page)).not.toContainText('Synthetic obsolete source');
  let recorded: unknown;
  await page.route('**/api/artifacts/extract', async (route) => {
    recorded = route.request().postDataJSON();
    await route.fulfill({ json: { availability: 'unavailable', reason: 'event_not_retained' } });
  });
  await cards(page).click();
  await expect(page.getByRole('region', { name: 'Manual artifact' })).toContainText(
    'no longer retained',
  );
  expect(recorded).toMatchObject({ sourceHash: source.source.hash });
});

test('malformed pages fail visibly, refresh recovers and offline data cannot open', async ({
  page,
  context,
}) => {
  await ready(page);
  await page.route('**/api/events?**', (route) =>
    route.fulfill({ json: { events: [{ unsafe: 'synthetic' }], cursor: 1 } }),
  );
  await page.getByRole('button', { name: 'Refresh sources', exact: true }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Could not load artifacts' }),
  ).toBeVisible();
  await expect(cards(page)).toHaveCount(0);
  await page.unroute('**/api/events?**');
  await page.getByRole('button', { name: 'Refresh sources', exact: true }).click();
  await expect(cards(page)).toHaveCount(1);
  await context.setOffline(true);
  await expect(page.getByText(/Core offline/)).toBeVisible();
  await expect(cards(page)).toBeDisabled();
  await expect(cards(page)).toHaveCount(1);
  await context.setOffline(false);
  await expect(cards(page)).toBeEnabled();
});

test('source and observation limits stop paging at both caps', async ({ page }) => {
  const source = await template(page);
  let requests = 0;
  await page.route('**/api/events?**', async (route) => {
    requests++;
    await route.fulfill({
      json: {
        events: Array.from({ length: 200 }, (_, index) =>
          event(source, index + 1, 'Synthetic bounded source'),
        ),
        cursor: 200,
      },
    });
  });
  await page.getByRole('link', { name: 'Artifacts', exact: true }).click();
  await expect(cards(page)).toHaveCount(200);
  await expect(page.getByText(/Scan limit reached/)).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Load older observations', exact: true }),
  ).toBeDisabled();
  expect(requests).toBe(1);
  await page.route('**/api/events?**', async (route) => {
    const before = Number(new URL(route.request().url()).searchParams.get('before'));
    const end = before === Number.MAX_SAFE_INTEGER ? 2200 : before - 1;
    await route.fulfill({
      json: {
        events: Array.from({ length: 200 }, (_, index) => ({
          ...event(source, end - 199 + index, 'Synthetic non-source'),
          type: 'agent.updated',
        })),
        cursor: 2200,
      },
    });
  });
  await page.getByRole('button', { name: 'Refresh sources', exact: true }).click();
  await expect(cards(page)).toHaveCount(0);
  for (let count = 1; count < 10; count++) {
    await page.getByRole('button', { name: 'Load older observations', exact: true }).click();
    await expect(page.getByText('0 artifacts', { exact: true })).toHaveAttribute(
      'title',
      `Matching sources: 0 · Loaded sources: 0 · Observations read: ${(count + 1) * 200}`,
    );
  }
  await expect(
    page.getByRole('button', { name: 'Load older observations', exact: true }),
  ).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Refresh sources', exact: true })).toBeFocused();
});

test('localized reading comfort stays contained at desktop and narrow widths in dark/light themes', async ({
  page,
}, testInfo) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      'orqst.appearance.v1',
      JSON.stringify({
        textSize: 'extra-large',
        contentSize: 'extra-large',
        density: 'comfortable',
      }),
    ),
  );
  await ready(page);
  await changeLanguage(page, 'pt-BR');
  for (const theme of ['dark', 'light']) {
    await page.evaluate((value) => (document.documentElement.dataset.theme = value), theme);
    for (const width of [1440, 1280, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(page.getByRole('heading', { name: 'Artefatos', exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
      await page.screenshot({
        path: testInfo.outputPath(`artifact-library-${theme}-${width}.png`),
        fullPage: true,
      });
    }
  }
});
