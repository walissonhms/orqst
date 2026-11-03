import { expect, test, type Page } from '@playwright/test';
import type { Snapshot } from '@orqst/protocol';

const storageKey = 'orqst.workspace-pins.v1';
async function fixture(page: Page) {
  await page.route('**/api/snapshot', async (route) => {
    const response = await route.fetch();
    const snapshot = (await response.json()) as Snapshot;
    const source = snapshot.workspaces[0]!;
    snapshot.workspaces = [
      { ...source, id: 'synthetic-a', name: 'Synthetic Alpha', path: '/synthetic/alpha' },
      { ...source, id: 'synthetic-b', name: 'Synthetic Beta', path: '/synthetic/beta' },
      { ...source, id: 'synthetic-c', name: 'Synthetic Gamma', path: '/synthetic/gamma' },
    ];
    snapshot.sessions = snapshot.sessions.map((session) => ({
      ...session,
      workspaceId: 'synthetic-a',
    }));
    await route.fulfill({ response, json: snapshot });
  });
}
const cards = (page: Page) => page.locator('.workspace-card');
const pin = (page: Page, name: string) =>
  page.getByRole('button', { name: `Pin workspace Synthetic ${name}`, exact: true });
async function order(page: Page) {
  return cards(page).getByRole('heading').allTextContents();
}

test('keyboard pinning prioritizes both lists, persists across routes/reload and preserves active scope', async ({
  page,
}) => {
  await fixture(page);
  await page.goto('/workspaces');
  await page.getByRole('combobox', { name: 'Sort by' }).selectOption('name');
  await expect(cards(page)).toHaveCount(3);
  const shell = await page.evaluate(() => localStorage.getItem('orqst.shell.v1'));
  await pin(page, 'Gamma').focus();
  await page.keyboard.press('Space');
  await expect(pin(page, 'Gamma')).toHaveAttribute('aria-pressed', 'true');
  await expect(pin(page, 'Gamma')).toBeFocused();
  expect(await order(page)).toEqual(['Synthetic Gamma', 'Synthetic Alpha', 'Synthetic Beta']);
  await expect(page.locator('.sidebar nav').last().getByRole('button').nth(1)).toHaveAccessibleName(
    'Synthetic Gamma (pinned)',
  );
  expect(await page.evaluate(() => localStorage.getItem('orqst.shell.v1'))).toBe(shell);
  await pin(page, 'Beta').click();
  expect(await order(page)).toEqual(['Synthetic Beta', 'Synthetic Gamma', 'Synthetic Alpha']);
  await page.getByRole('button', { name: 'List view', exact: true }).click();
  await page.reload();
  await expect(pin(page, 'Gamma')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.workspace-list')).toBeVisible();
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.goBack();
  await expect(pin(page, 'Gamma')).toHaveAttribute('aria-pressed', 'true');
  await cards(page)
    .filter({ hasText: 'Synthetic Gamma' })
    .getByRole('button', { name: 'Open sessions' })
    .click();
  await expect(page).toHaveURL(/\/overview$/);
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('orqst.shell.v1')!).workspaceId),
  ).toBe('synthetic-c');
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), storageKey)).toEqual([
    'synthetic-c',
    'synthetic-b',
  ]);
});

test('pinned filter composes with search and restores keyboard focus when unpinning the last result', async ({
  page,
}) => {
  await fixture(page);
  await page.goto('/workspaces');
  await pin(page, 'Beta').click();
  const filter = page.getByRole('button', { name: 'Pinned only', exact: true });
  await filter.click();
  await expect(cards(page)).toHaveCount(1);
  await page.getByRole('textbox', { name: 'Search workspace names or paths' }).fill('gamma');
  await expect(cards(page)).toHaveCount(0);
  await page.locator('.workspace-pin-recovery').click();
  await expect(filter).toBeFocused();
  await expect(filter).toHaveAttribute('aria-pressed', 'false');
  await expect(cards(page)).toHaveCount(3);
  await filter.click();
  await pin(page, 'Beta').focus();
  await page.keyboard.press('Enter');
  await expect(filter).toBeFocused();
  await expect(cards(page)).toHaveCount(0);
  await expect(
    page.getByRole('status').filter({ hasText: 'Synthetic Beta unpinned.' }),
  ).toBeVisible();
  await page.reload();
  await expect(filter).toHaveAttribute('aria-pressed', 'false');
});

test('other-tab changes synchronize without echo writes; missing records never become fabricated workspaces', async ({
  page,
  context,
}) => {
  await fixture(page);
  await page.goto('/workspaces');
  const other = await context.newPage();
  await fixture(other);
  await other.goto('/workspaces');
  await other.evaluate(() => {
    Reflect.set(window, 'syntheticPinWrites', 0);
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key === 'orqst.workspace-pins.v1')
        Reflect.set(
          window,
          'syntheticPinWrites',
          Number(Reflect.get(window, 'syntheticPinWrites')) + 1,
        );
      original.call(this, key, value);
    };
  });
  await pin(page, 'Gamma').click();
  await expect(pin(other, 'Gamma')).toHaveAttribute('aria-pressed', 'true');
  expect(await other.evaluate(() => Reflect.get(window, 'syntheticPinWrites'))).toBe(0);
  await other.evaluate(
    (key) => localStorage.setItem(key, JSON.stringify(['missing-synthetic', 'synthetic-b'])),
    storageKey,
  );
  await expect(pin(page, 'Beta')).toHaveAttribute('aria-pressed', 'true');
  await expect(pin(page, 'Gamma')).toHaveAttribute('aria-pressed', 'false');
  await expect(cards(page)).toHaveCount(3);
  await pin(page, 'Alpha').click();
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), storageKey)).toEqual([
    'missing-synthetic',
    'synthetic-b',
    'synthetic-a',
  ]);
  await other.evaluate((key) => localStorage.removeItem(key), storageKey);
  await expect(pin(page, 'Alpha')).toHaveAttribute('aria-pressed', 'false');
  await other.evaluate((key) => localStorage.setItem(key, '{bad'), storageKey);
  await expect(pin(page, 'Beta')).toHaveAttribute('aria-pressed', 'false');
  await other.close();
});

test('storage write denial retains visit-only pins through views and offline; no Bridge mutation', async ({
  page,
}) => {
  await fixture(page);
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key === 'orqst.workspace-pins.v1') throw new Error('Synthetic pin storage full');
      original.call(this, key, value);
    };
  });
  const mutations: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/') && !['GET', 'HEAD'].includes(request.method()))
      mutations.push(request.url());
  });
  await page.goto('/workspaces');
  await pin(page, 'Gamma').click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Pins apply for this visit.' }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.goBack();
  await expect(pin(page, 'Gamma')).toHaveAttribute('aria-pressed', 'true');
  await page.context().setOffline(true);
  await pin(page, 'Beta').click();
  await pin(page, 'Gamma').click();
  await expect(pin(page, 'Beta')).toHaveAttribute('aria-pressed', 'true');
  await expect(pin(page, 'Gamma')).toHaveAttribute('aria-pressed', 'false');
  expect(mutations).toEqual([]);
  await page.context().setOffline(false);
});

for (const theme of ['dark', 'light'])
  test(`localized pin controls fit ${theme} at 320px maximum text sizes`, async ({ page }) => {
    await fixture(page);
    await page.addInitScript((theme) => {
      localStorage.setItem('i18nextLng', 'pt-BR');
      localStorage.setItem(
        'orqst.appearance.v1',
        JSON.stringify({
          theme,
          textSize: 'extra-large',
          contentSize: 'extra-large',
          density: 'comfortable',
        }),
      );
    }, theme);
    await page.goto('/workspaces');
    await page.getByLabel('Idioma').selectOption('pt-BR');
    for (const width of [1440, 320]) {
      await page.setViewportSize({ width, height: 900 });
      const button = page.getByRole('button', {
        name: 'Fixar workspace Synthetic Beta',
        exact: true,
      });
      await button.click();
      await expect(button).toBeFocused();
      await expect(button).toHaveAttribute('aria-pressed', width === 1440 ? 'true' : 'false');
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
      await page.screenshot({
        path: test.info().outputPath(`workspace-pins-${theme}-${width}.png`),
        fullPage: true,
      });
    }
  });

test('blocked storage reads still allow pinning and capacity does not prevent unpinning', async ({
  page,
}) => {
  await fixture(page);
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new Error('Synthetic storage denial');
      },
    });
  });
  await page.goto('/workspaces');
  await expect(
    page.getByRole('status').filter({ hasText: 'Pins apply for this visit.' }),
  ).toBeVisible();
  await pin(page, 'Beta').click();
  await expect(pin(page, 'Beta')).toHaveAttribute('aria-pressed', 'true');
  await pin(page, 'Beta').click();
  await expect(pin(page, 'Beta')).toHaveAttribute('aria-pressed', 'false');
});

test('pin limit disables only additions, retaining removal and cross-tab changes while a draft is open', async ({
  page,
  context,
}) => {
  await fixture(page);
  await page.addInitScript(() =>
    localStorage.setItem(
      'orqst.workspace-pins.v1',
      JSON.stringify([
        'synthetic-a',
        ...Array.from({ length: 99 }, (_, index) => `missing-synthetic-${index}`),
      ]),
    ),
  );
  await page.goto('/workspaces');
  await expect(pin(page, 'Beta')).toBeDisabled();
  await expect(pin(page, 'Alpha')).toBeEnabled();
  await pin(page, 'Alpha').click();
  await expect(pin(page, 'Beta')).toBeEnabled();
  const clear = page.getByRole('button', { name: 'Unpin all workspaces', exact: true });
  await clear.click();
  expect(await page.evaluate((key) => localStorage.getItem(key), storageKey)).toBe('[]');
  await expect(clear).toBeDisabled();
  await cards(page)
    .filter({ hasText: 'Synthetic Alpha' })
    .getByRole('button', { name: 'Open sessions' })
    .click();
  await page.getByRole('button', { name: 'View session Synthetic browser agent' }).click();
  await page
    .getByRole('button', { name: 'Extract artifact manually', exact: true })
    .first()
    .click();
  const artifact = page.getByRole('region', { name: 'Manual artifact', exact: true });
  await artifact.getByRole('button', { name: 'Edit draft', exact: true }).click();
  const draft = 'Synthetic pinned workspace draft <script>inert</script>\n';
  await artifact.getByRole('textbox').fill(draft);
  const source = await artifact.locator('.artifact-provenance').innerText();
  const url = page.url();
  const other = await context.newPage();
  await other.goto('/settings');
  await other.evaluate(
    (key) => localStorage.setItem(key, JSON.stringify(['synthetic-c'])),
    storageKey,
  );
  await expect(
    page.getByRole('button', { name: 'Synthetic Gamma (pinned)', exact: true }),
  ).toBeVisible();
  await expect(artifact.getByRole('textbox')).toHaveValue(draft);
  await expect(artifact.locator('.artifact-provenance')).toHaveText(source, { useInnerText: true });
  expect(page.url()).toBe(url);
  await page.getByRole('button', { name: 'Synthetic Gamma (pinned)', exact: true }).click();
  await expect(
    page.getByRole('dialog', { name: 'Discard artifact draft?', exact: true }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(artifact.getByRole('textbox')).toHaveValue(draft);
  await other.close();
});
