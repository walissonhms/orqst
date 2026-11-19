import { expect, test, type Page, type Locator } from '@playwright/test';
import type { Snapshot } from '@orqst/protocol';
import { coreStatus, settingsTabs } from '../helpers/spec-dashboard.js';

const sourceId = 'synthetic-browser-session';

async function openAdvanced(page: Page) {
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await settingsTabs(page).getByRole('button', { name: 'Advanced', exact: true }).click();
  return page.getByRole('region', { name: 'Advanced', exact: true });
}

const value = (region: Locator, label: string) =>
  region.locator('dl > div').filter({ hasText: label }).locator('dd');

test('advanced diagnostics expose actual snapshot evidence without mutation requests', async ({
  page,
}) => {
  await page.route('**/api/snapshot', async (route) => {
    const response = await route.fetch();
    const snapshot = (await response.json()) as Snapshot;
    snapshot.sessions = snapshot.sessions.filter((session) => session.id === sourceId);
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
  await page.goto('/visao-geral');
  await expect(coreStatus(page)).toHaveText('CORE ONLINE');
  const mutations: string[] = [];
  page.on('request', (request) => {
    if (!['GET', 'HEAD'].includes(request.method())) mutations.push(request.url());
  });
  const advanced = await openAdvanced(page);
  await expect(advanced.locator('time')).toHaveAttribute('datetime', '2026-11-03T12:34:56.000Z');
  for (const [label, expected] of [
    ['Last discovered JSONL files', '4'],
    ['Malformed records', '2'],
    ['Oversized records', '3'],
    ['Skipped source reads', '1'],
    ['Source read / scan errors', '5'],
  ] as const) {
    await expect(value(advanced, label)).toHaveText(expected);
  }
  await expect(advanced).toContainText(
    '1 retained session in the loaded snapshot, across all workspaces.',
  );
  await advanced.getByText('Details', { exact: true }).press('Enter');
  await expect(advanced.getByText('A source scan was in progress in this snapshot.')).toBeVisible();
  await expect(advanced.getByText(/zero errors does not prove complete coverage/)).toBeVisible();
  await expect(
    advanced.getByRole('button', { name: /Start|Install|Authenticate|Scan now/ }),
  ).toHaveCount(0);
  expect(mutations).toEqual([]);
});

test('empty diagnostics identify an unreported scan and a measured zero-session snapshot', async ({
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
  await page.goto('/visao-geral');
  const advanced = await openAdvanced(page);
  await expect(advanced.getByTitle('No scan time reported')).toHaveText('—');
  await expect(advanced).toContainText('0 retained sessions');
  await expect(value(advanced, 'Last discovered JSONL files')).toHaveText('0');
  await settingsTabs(page).getByRole('button', { name: 'Agents', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Agents', exact: true })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL('/visao-geral');
});

test('an empty workspace does not hide global evidence or change selection', async ({ page }) => {
  await page.route('**/api/snapshot', async (route) => {
    const response = await route.fetch();
    const snapshot = (await response.json()) as Snapshot;
    snapshot.sessions = snapshot.sessions.filter((session) => session.id === sourceId);
    snapshot.workspaces.push({
      ...snapshot.workspaces[0]!,
      id: 'synthetic-empty-workspace',
      name: 'Synthetic empty workspace',
      path: '/synthetic/empty',
      sessions: 0,
    });
    await route.fulfill({ response, json: snapshot });
  });
  await page.goto('/visao-geral');
  const workspace = page.getByRole('button', { name: 'Synthetic empty workspace' });
  await workspace.click();
  const advanced = await openAdvanced(page);
  await expect(advanced).toContainText(
    '1 retained session in the loaded snapshot, across all workspaces.',
  );
  await expect(workspace).toHaveAttribute('aria-current', 'true');
  await expect(page.locator('.breadcrumbs')).toContainText('Synthetic empty workspace');
});

test('offline onboarding can be skipped and diagnostics keep unknown values unknown', async ({
  page,
}) => {
  await page.route('**/api/snapshot', (route) => route.abort());
  await page.goto('/');
  const onboarding = page.getByRole('dialog', { name: 'Welcome to ORQST' });
  await expect(onboarding.getByRole('heading', { name: 'Welcome to ORQST' })).toBeFocused();
  await expect(onboarding.getByRole('button', { name: 'Start', exact: true })).toBeDisabled();
  await onboarding.getByRole('button', { name: 'Skip', exact: true }).click();
  await expect(onboarding).toHaveCount(0);
  const advanced = await openAdvanced(page);
  await expect(advanced.getByRole('status')).toContainText('Source diagnostics are unavailable');
  await expect(value(advanced, 'Last discovered JSONL files')).toHaveText('—');
  await expect(advanced).not.toContainText('0 retained sessions');
  await expect(page.locator('.shell-offline')).toHaveCSS('height', '28px');
  await expect(coreStatus(page)).toHaveText('CORE OFFLINE');
});

test('diagnostics update in place and identify the last reading as stale on snapshot failure', async ({
  page,
}) => {
  let fail = false;
  let files = 1;
  await page.route('**/api/snapshot', async (route) => {
    if (fail) return route.abort();
    const response = await route.fetch();
    const snapshot = (await response.json()) as Snapshot;
    snapshot.sessions = snapshot.sessions.filter((session) => session.id === sourceId);
    snapshot.diagnostics.files = files;
    await route.fulfill({ response, json: snapshot });
  });
  await page.goto('/visao-geral');
  const advanced = await openAdvanced(page);
  const count = value(advanced, 'Last discovered JSONL files');
  await expect(count).toHaveText('1');
  files = 7;
  await expect(count).toHaveText('7');
  fail = true;
  await expect(advanced.getByRole('status')).toContainText(
    'last loaded snapshot and may be out of date',
  );
  await expect(count).toHaveText('7');
  await expect(advanced).toContainText('1 retained session');
  fail = false;
  files = 8;
  await expect(count).toHaveText('8');
  await expect(advanced.getByRole('status')).toHaveCount(0);
});

test('palette handoff to Settings shares the exact artifact draft guard', async ({ page }) => {
  const draft = 'Synthetic diagnostic navigation draft — preserve exactly.\n';
  await page.goto(`/overview/sessions/${sourceId}`);
  await page
    .getByRole('button', { name: 'Extract artifact manually', exact: true })
    .first()
    .click();
  const panel = page.getByRole('region', { name: 'Manual artifact', exact: true });
  await panel.getByRole('button', { name: 'Edit draft', exact: true }).click();
  const editor = panel.getByRole('textbox');
  await editor.fill(draft);
  const palette = page.getByRole('dialog', { name: 'Search & commands' });
  await page.keyboard.press('Control+k');
  await expect(palette).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(editor).toBeFocused();
  await expect(editor).toHaveValue(draft);
  const discard = page.getByRole('dialog', { name: 'Discard artifact draft?', exact: true });
  for (const confirm of [false, true]) {
    await page.keyboard.press('Control+k');
    await palette.getByRole('textbox').fill('Settings');
    await page.keyboard.press('Enter');
    await expect(discard.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
    if (confirm) await discard.getByRole('button', { name: 'Discard draft and continue' }).click();
    else {
      await page.keyboard.press('Escape');
      await expect(editor).toHaveValue(draft);
      await expect(
        panel.getByRole('heading', { name: 'Manual artifact', exact: true }),
      ).toBeFocused();
      await expect(page).toHaveURL(`/overview/sessions/${sourceId}`);
    }
  }
  await expect(page).toHaveURL('/configuracoes');
  await expect(page.locator('#main-content')).toBeFocused();
  await expect(panel).toHaveCount(0);
});

test('first-run onboarding fits localized layouts at maximum reading sizes with reduced motion', async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const theme of ['dark', 'light'] as const) {
    for (const width of [1440, 1280, 390, 320]) {
      const locale = width < 720 ? 'pt-BR' : 'en-US';
      await page.goto('/configuracoes');
      await page.evaluate(
        ({ theme, locale }) => {
          localStorage.removeItem('orqst.onboarding.v1');
          localStorage.setItem('i18nextLng', locale);
          localStorage.setItem(
            'orqst.appearance.v1',
            JSON.stringify({
              theme,
              textSize: 'extra-large',
              contentSize: 'extra-large',
              density: 'comfortable',
            }),
          );
        },
        { theme, locale },
      );
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/');
      const modal = page.getByRole('dialog', {
        name: locale === 'pt-BR' ? 'Boas-vindas ao ORQST' : 'Welcome to ORQST',
      });
      await expect(modal).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
      expect(await modal.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
        true,
      );
      const bounds = (await modal.boundingBox())!;
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      const skip = modal.getByRole('button', {
        name: locale === 'pt-BR' ? 'Pular' : 'Skip',
        exact: true,
      });
      await skip.scrollIntoViewIfNeeded();
      await expect(skip).toBeInViewport();
      await page.screenshot({ path: testInfo.outputPath(`onboarding-${theme}-${width}.png`) });
      await skip.click();
      await expect(modal).toHaveCount(0);
    }
  }
});
