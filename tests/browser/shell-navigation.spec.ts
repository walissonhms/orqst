import { test, expect, type Page } from '@playwright/test';
import type { Snapshot } from '@orqst/protocol';

async function fixture(page: Page) {
  await page.route('**/api/snapshot', async (route) => {
    const response = await route.fetch();
    const snapshot = (await response.json()) as Snapshot;
    snapshot.notifications = [
      {
        id: 'synthetic-shell-alert',
        sessionId: 'synthetic-browser-session',
        type: 'agent.failed',
        timestamp: '2026-11-02T12:00:00.000Z',
        read: false,
      },
    ];
    await route.fulfill({ response, json: snapshot });
  });
}

test('workspace directory, layout, sidebar and scope restore without claiming process restoration', async ({
  page,
}) => {
  await fixture(page);
  await page.goto('/#workspaces');
  await expect(
    page.getByRole('heading', { name: 'Workspace directory', exact: true }),
  ).toBeVisible();
  const card = page.locator('.workspace-card').filter({ hasText: '/synthetic/browser-test' });
  await expect(card).toContainText('Observed sessions');
  await page.getByRole('button', { name: 'List view', exact: true }).click();
  await page.getByRole('combobox', { name: 'Sort by' }).selectOption('name');
  await page.getByRole('button', { name: 'Collapse sidebar' }).click();
  await page.reload();
  await expect(page.locator('.workspace-list')).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Sort by' })).toHaveValue('name');
  await expect(page.getByRole('button', { name: 'Expand sidebar' })).toBeVisible();
  await page.getByRole('link', { name: 'Agents & integrations' }).click();
  await expect(page.getByRole('heading', { name: 'Agents & integrations' })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Workspace directory' })).toBeVisible();
  await page
    .getByRole('textbox', { name: 'Search workspace names or paths' })
    .fill('no such synthetic workspace');
  await expect(page.locator('.workspace-card')).toHaveCount(0);
  await expect(page.getByText('No workspaces match this search.')).toBeVisible();
  await page.getByRole('textbox', { name: 'Search workspace names or paths' }).fill('');
  await card.getByRole('button', { name: 'Open sessions' }).click();
  await expect(page.getByRole('heading', { name: 'Your agents, in focus.' })).toBeVisible();
  const workspace = await page.evaluate(
    () => JSON.parse(localStorage.getItem('orqst.shell.v1')!).workspaceId as string,
  );
  expect(workspace).toBeTruthy();
  await page.getByRole('combobox', { name: 'Status', exact: true }).selectOption('failed');
  await page.reload();
  await expect(page.getByRole('combobox', { name: 'Status', exact: true })).toHaveValue('failed');
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('orqst.shell.v1')!).workspaceId),
  ).toBe(workspace);
});

test('command palette searches observed models and sessions, navigates and restores focus with keyboard', async ({
  page,
}) => {
  await fixture(page);
  await page.goto('/#models');
  await expect(page.getByRole('status').filter({ hasText: 'Live' })).toBeVisible();
  const trigger = page.getByRole('button', { name: 'Search & commands', exact: true });
  await trigger.focus();
  await page.keyboard.press('Control+k');
  const dialog = page.getByRole('dialog', { name: 'Search & commands' });
  const search = dialog.getByRole('textbox');
  await expect(search).toBeFocused();
  await search.fill('synthetic-test-model');
  await expect(dialog.locator('.palette-result')).toHaveCount(1);
  await page.keyboard.press('ArrowDown');
  await expect(dialog.locator('.palette-result')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Session details' })).toBeVisible();
  await expect(page.locator('.session-model')).toContainText('synthetic-test-model');
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await trigger.click();
  await dialog.getByRole('textbox').fill('No matching synthetic session');
  await expect(dialog.getByText('No matching views, workspaces or sessions.')).toBeVisible();
  await page.keyboard.press('Escape');
});

test('adapter inventory is truthful, bilingual and has no execution or model selection affordance', async ({
  page,
}) => {
  await page.goto('/#agents');
  await expect(page.getByRole('heading', { name: 'Agents & integrations' })).toBeVisible();
  const matrix = page.getByRole('region', { name: 'Observation capability matrix' });
  await expect(
    matrix.getByRole('row', { name: 'Session control Unavailable Unavailable Unavailable' }),
  ).toBeVisible();
  await expect(
    matrix.getByRole('row', { name: 'Mode Observation only Planned Planned' }),
  ).toBeVisible();
  await expect(
    matrix.getByRole('row', {
      name: 'External session discovery Supported Unavailable Unavailable',
    }),
  ).toBeVisible();
  await expect(matrix).toContainText('not a machine installation scan');
  await expect(
    page.getByRole('button', { name: /Start|Resume|Stop|Install|Authenticate/ }),
  ).toHaveCount(0);
  await page.getByLabel('Language').selectOption('pt-BR');
  await expect(page.getByRole('heading', { name: 'Agentes e integrações' })).toBeVisible();
  await expect(
    page.getByRole('row', { name: 'Controle de sessão Indisponível Indisponível Indisponível' }),
  ).toBeVisible();
});

test('workspace and notification dialogs contain focus, close with Escape and link back to source from Analytics', async ({
  page,
}) => {
  await fixture(page);
  await page.goto('/#models');
  const add = page.getByRole('button', { name: 'Add workspace', exact: true });
  await add.click();
  const form = page.getByRole('dialog', { name: 'Add workspace' });
  await expect(form.getByLabel('Workspace name')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(form.getByRole('button', { name: 'Close' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(form).toHaveCount(0);
  await expect(add).toBeFocused();
  const notifications = page.getByRole('button', { name: 'Notifications', exact: true });
  await notifications.click();
  await page.keyboard.press('Escape');
  await expect(notifications).toBeFocused();
  await notifications.click();
  await page
    .getByRole('dialog', { name: 'Notifications' })
    .getByRole('button', { name: /Execution failed/ })
    .click();
  await expect(page.getByRole('region', { name: 'Session details' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your agents, in focus.' })).toBeVisible();
});

test('new views and dialogs fit desktop, laptop and mobile with reduced motion', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const width of [1440, 1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const view of ['workspaces', 'agents']) {
      await page.goto(`/#${view}`);
      await expect(page.locator('.workspace-directory, .adapter-panel')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
      await page.screenshot({
        path: test.info().outputPath(`orqst-${view}-${width}.png`),
        fullPage: width > 700,
      });
    }
    await page.getByRole('button', { name: 'Search & commands' }).click();
    await expect(page.getByRole('dialog', { name: 'Search & commands' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    await page.keyboard.press('Escape');
  }
});

test('compact token disclosure reuses confirmed readings, remains visible on scroll and qualifies stale or missing values', async ({
  page,
}) => {
  let unavailable = false;
  let failed = false;
  let requests = 0;
  await page.route('**/api/sessions/synthetic-browser-session/metrics', async (route) => {
    requests++;
    if (failed) return route.fulfill({ status: 503, json: { error: 'synthetic-unavailable' } });
    if (unavailable)
      return route.fulfill({
        json: {
          availability: 'unavailable',
          reason: 'usage_not_recorded',
        },
      });
    return route.continue();
  });
  await page.goto('/#session=synthetic-browser-session');
  const badge = page.locator('.session-token-badge');
  const header = page.locator('.session-detail > .live-metrics');
  await expect(header.locator('.live-metric-values strong')).toHaveCount(4);
  const values = await header.locator('.live-metric-values strong').allTextContents();
  await expect(badge.locator('strong')).toHaveText(values[3]!);
  // The compact context adds no duplicate metrics query; only the inspector owns it.
  expect(requests).toBe(1);
  await badge.locator('summary').click();
  await expect(badge.locator('dd')).toHaveText(values.slice(0, 3));
  await expect(badge).toContainText('Cached input is included in input');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(badge.locator('summary')).toBeInViewport();
  await page.screenshot({ path: test.info().outputPath('orqst-session-sticky-context.png') });
  failed = true;
  await expect(header).toContainText('Metrics could not be refreshed');
  await expect(badge.locator('summary')).toContainText('Out of date');
  await expect(badge.locator('strong')).toHaveText(values[3]!);
  await page.locator('.session-detail').getByRole('button', { name: 'Close', exact: true }).click();
  await expect(badge).toHaveCount(0);
  failed = false;
  unavailable = true;
  await page.goto('/#session=synthetic-browser-session');
  await expect(badge.locator('summary')).toContainText('Unavailable');
  await expect(badge.locator('strong')).toHaveText('—');
  await expect(header).toContainText('No cumulative token snapshot was recorded.');
  await page.setViewportSize({ width: 390, height: 844 });
  await badge.locator('summary').click();
  await expect(badge).toContainText('no confirmed session snapshot');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('notification filters preserve source categories without inventing alerts', async ({
  page,
}) => {
  await fixture(page);
  await page.goto('/#agents');
  await page.getByRole('button', { name: 'Notifications', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Notifications' });
  await expect(dialog.locator('.notification-item')).toHaveCount(1);
  await expect(dialog.locator('.notification-item')).toHaveClass(/notification-agent-failed/);
  await dialog
    .getByRole('combobox', { name: 'Notification filter' })
    .selectOption('agent.completed');
  await expect(dialog.locator('.notification-item')).toHaveCount(0);
  await expect(dialog).toContainText('No notifications match this filter.');
  await dialog.getByRole('combobox', { name: 'Notification filter' }).selectOption('unread');
  await expect(dialog.locator('.notification-item')).toHaveCount(1);
  await page.screenshot({ path: test.info().outputPath('orqst-notifications-filtered.png') });
});
