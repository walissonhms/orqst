import { expect, test, type Page } from '@playwright/test';
import type { Snapshot } from '@orqst/protocol';

const sourceId = 'synthetic-browser-session';
const draftText = 'Synthetic guide navigation draft — preserve exactly.\n';

function guide(page: Page, locale = 'en-US') {
  return page.getByRole('dialog', {
    name: locale === 'pt-BR' ? 'Guia de observação' : 'Observation guide',
    exact: true,
  });
}

async function fromPalette(page: Page) {
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Search & commands', exact: true });
  await palette.getByRole('textbox').fill('Observation guide');
  await page.keyboard.press('Enter');
  await expect(palette).toHaveCount(0);
  await expect(guide(page).getByRole('heading', { name: 'Observation guide' })).toBeFocused();
}

test('the guide exposes actual snapshot evidence, contains keyboard focus and makes no mutation requests', async ({
  page,
}) => {
  await page.route('**/api/snapshot', async (route) => {
    const response = await route.fetch();
    const snapshot = (await response.json()) as Snapshot;
    snapshot.diagnostics = {
      files: 4,
      malformed: 2,
      oversized: 3,
      skipped: 1,
      errors: 5,
      scanning: true,
      lastScan: '2026-11-03T12:34:56.000Z',
    };
    await route.fulfill({ response, json: snapshot });
  });
  await page.goto('/settings');
  await expect(page.getByRole('status').filter({ hasText: 'Live' })).toBeVisible();
  const mutations: string[] = [];
  page.on('request', (request) => {
    if (!['GET', 'HEAD'].includes(request.method())) mutations.push(request.url());
  });
  const trigger = page.getByRole('button', { name: 'Observation guide', exact: true });
  const storage = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  await trigger.click();
  const modal = guide(page);
  await expect(modal.getByRole('heading', { name: 'Observation guide' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(modal.getByRole('button', { name: 'Back to dashboard' })).toBeFocused();
  await expect(modal.getByRole('listitem')).toHaveCount(3);
  await expect(modal.getByRole('status')).toHaveText('The local Bridge is connected.');
  await expect(modal).toContainText('A source scan was in progress in this snapshot.');
  await expect(modal.locator('time')).toHaveAttribute('datetime', '2026-11-03T12:34:56.000Z');
  await expect(
    modal.locator('dl > div').filter({ hasText: 'Last discovered JSONL files' }),
  ).toContainText('4');
  await expect(modal.locator('dl > div').filter({ hasText: 'Malformed records' })).toContainText(
    '2',
  );
  await expect(modal.locator('dl > div').filter({ hasText: 'Oversized records' })).toContainText(
    '3',
  );
  await expect(modal.locator('dl > div').filter({ hasText: 'Skipped source reads' })).toContainText(
    '1',
  );
  await expect(
    modal.locator('dl > div').filter({ hasText: 'Source read / scan errors' }),
  ).toContainText('5');
  await expect(modal).toContainText(
    '1 retained session in the loaded snapshot, across all workspaces.',
  );
  await expect(modal).toContainText('zero errors does not prove complete coverage');
  await expect(
    modal.getByRole('button', { name: /Start|Install|Authenticate|Scan now|Complete/ }),
  ).toHaveCount(0);
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await modal.getByRole('button', { name: 'Back to dashboard' }).focus();
  await page.keyboard.press('Tab');
  await expect(modal.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(modal.getByRole('button', { name: 'Back to dashboard' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await expect(page).toHaveURL('/settings');
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).toBe(
    storage,
  );
  expect(mutations).toEqual([]);
});

test('empty history explains missing scans and the guide can return through existing routes', async ({
  page,
}) => {
  await page.route('**/api/snapshot', async (route) => {
    const response = await route.fetch();
    const snapshot = (await response.json()) as Snapshot;
    snapshot.sessions = [];
    snapshot.diagnostics = {
      files: 0,
      malformed: 0,
      oversized: 0,
      skipped: 0,
      errors: 0,
      scanning: false,
      lastScan: null,
    };
    await route.fulfill({ response, json: snapshot });
  });
  await page.goto('/overview');
  const trigger = page.getByRole('button', { name: 'Observation guide', exact: true });
  await trigger.click();
  await expect(guide(page)).toContainText('No scan time reported');
  await expect(guide(page)).toContainText('0 retained sessions');
  await expect(guide(page)).toContainText('No sessions are retained in this snapshot.');
  await guide(page).getByRole('button', { name: 'View observation capabilities' }).click();
  await expect(guide(page)).toHaveCount(0);
  await expect(page).toHaveURL('/agents');
  await expect(page.locator('#main-content')).toBeFocused();
  await expect(page.getByRole('region', { name: 'Observation capability matrix' })).toBeVisible();
  await page.goBack();
  await expect(trigger).toBeVisible();
  await fromPalette(page);
  await guide(page).getByRole('button', { name: 'Browse recorded workspaces' }).click();
  await expect(page).toHaveURL('/workspaces');
  await expect(page.locator('#main-content')).toBeFocused();
});

test('a scoped empty workspace does not hide global retained-session evidence or alter filters', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'orqst.shell.v1',
      JSON.stringify({ workspaceId: 'synthetic-empty-workspace', status: 'failed' }),
    );
  });
  await page.route('**/api/snapshot', async (route) => {
    const response = await route.fetch();
    const snapshot = (await response.json()) as Snapshot;
    snapshot.workspaces.push({
      ...snapshot.workspaces[0]!,
      id: 'synthetic-empty-workspace',
      name: 'Synthetic empty workspace',
      path: '/synthetic/empty',
      sessions: 0,
    });
    await route.fulfill({ response, json: snapshot });
  });
  await page.goto('/overview');
  await page.getByRole('button', { name: 'Observation guide', exact: true }).click();
  await expect(guide(page)).toContainText(
    '1 retained session in the loaded snapshot, across all workspaces.',
  );
  await expect(guide(page)).not.toContainText('No sessions are retained in this snapshot.');
  await page.keyboard.press('Escape');
  await expect(page.locator('.breadcrumbs')).toContainText('Synthetic empty workspace');
  await expect(page.getByRole('combobox', { name: 'Status', exact: true })).toHaveValue('failed');
});

test('without a snapshot, offline onboarding stays available and unknown counts never become zero', async ({
  page,
}) => {
  await page.route('**/api/snapshot', (route) => route.abort());
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Observation guide', exact: true }).click();
  await expect(guide(page).getByRole('status')).toContainText('snapshot could not be loaded');
  await expect(guide(page)).toContainText('Source diagnostics are unavailable');
  await expect(guide(page)).toContainText('Session history is unavailable');
  await expect(guide(page).locator('dl')).toHaveCount(0);
  await expect(guide(page)).not.toContainText('0 retained sessions');
  await expect(
    guide(page).getByRole('button', { name: 'Browse recorded workspaces' }),
  ).toBeDisabled();
  await expect(
    guide(page).getByRole('button', { name: 'View observation capabilities' }),
  ).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Observation guide', exact: true })).toBeFocused();
});

test('loaded diagnostics update in place and become explicitly stale on snapshot failure', async ({
  page,
}) => {
  let fail = false;
  let files = 1;
  await page.route('**/api/snapshot', async (route) => {
    if (fail) return route.abort();
    const response = await route.fetch();
    const snapshot = (await response.json()) as Snapshot;
    snapshot.diagnostics.files = files;
    await route.fulfill({ response, json: snapshot });
  });
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Observation guide', exact: true }).click();
  const count = guide(page)
    .locator('dl > div')
    .filter({ hasText: 'Last discovered JSONL files' })
    .locator('dd');
  await expect(count).toHaveText('1');
  files = 7;
  await expect(count).toHaveText('7');
  await expect(guide(page).getByRole('heading', { name: 'Observation guide' })).toBeFocused();
  fail = true;
  await expect(guide(page).getByRole('status')).toContainText('snapshot could not be loaded');
  await expect(guide(page)).toContainText('last loaded snapshot and may be out of date');
  await expect(count).toHaveText('7');
  await expect(guide(page)).toContainText('1 retained session');
  fail = false;
  files = 8;
  await expect(count).toHaveText('8');
  await expect(guide(page)).not.toContainText('last loaded snapshot and may be out of date');
});

test('palette handoff preserves exact drafts and guide navigation shares the existing discard guard', async ({
  page,
}) => {
  await page.goto(`/overview/sessions/${sourceId}`);
  await page
    .getByRole('button', { name: 'Extract artifact manually', exact: true })
    .first()
    .click();
  const panel = page.getByRole('region', { name: 'Manual artifact', exact: true });
  await panel.getByRole('button', { name: 'Edit draft', exact: true }).click();
  await panel.getByRole('textbox').fill(draftText);
  await fromPalette(page);
  await page.keyboard.press('Escape');
  await expect(panel.getByRole('textbox')).toBeFocused();
  await expect(panel.getByRole('textbox')).toHaveValue(draftText);
  await fromPalette(page);
  await guide(page).getByRole('button', { name: 'View observation capabilities' }).click();
  const discard = page.getByRole('dialog', { name: 'Discard artifact draft?', exact: true });
  await expect(guide(page)).toHaveCount(0);
  await expect(discard.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(panel.getByRole('textbox')).toHaveValue(draftText);
  await expect(panel.getByRole('heading', { name: 'Manual artifact', exact: true })).toBeFocused();
  await expect(page).toHaveURL(`/overview/sessions/${sourceId}`);
  await fromPalette(page);
  await guide(page).getByRole('button', { name: 'Browse recorded workspaces' }).click();
  await discard.getByRole('button', { name: 'Discard draft and continue', exact: true }).click();
  await expect(page).toHaveURL('/workspaces');
  await expect(page.locator('#main-content')).toBeFocused();
  await expect(panel).toHaveCount(0);
});

test('localized guide fits dark and light layouts at maximum reading sizes with reduced motion', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'orqst.appearance.v1',
      JSON.stringify({
        textSize: 'extra-large',
        contentSize: 'extra-large',
        density: 'comfortable',
      }),
    );
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/settings');
  for (const theme of ['dark', 'light']) {
    await page.getByRole('combobox', { name: 'Theme', exact: true }).selectOption(theme);
    for (const width of [1440, 1280, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await page.getByRole('button', { name: 'Observation guide', exact: true }).click();
      const modal = guide(page);
      await expect(modal).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
      expect(await modal.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
        true,
      );
      const bounds = await modal.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
      await modal.getByRole('button', { name: 'Back to dashboard' }).scrollIntoViewIfNeeded();
      await expect(modal.getByRole('button', { name: 'Back to dashboard' })).toBeInViewport();
      await modal.evaluate((element) => element.scrollTo(0, 0));
      await page.screenshot({ path: test.info().outputPath(`guide-${theme}-${width}.png`) });
      await page.keyboard.press('Escape');
    }
  }
  await page.getByLabel('Language', { exact: true }).selectOption('pt-BR');
  await page.getByRole('button', { name: 'Guia de observação', exact: true }).click();
  await expect(guide(page, 'pt-BR')).toContainText('1 sessão retida');
  await expect(guide(page, 'pt-BR')).toContainText('Conecte-se ao observador');
  expect(
    await guide(page, 'pt-BR').evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
  await page.screenshot({ path: test.info().outputPath('guide-light-pt-BR-320.png') });
});
