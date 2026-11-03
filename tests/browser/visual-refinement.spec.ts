import { test, expect, type Page } from '@playwright/test';
import type { Snapshot } from '@orqst/protocol';

async function contained(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    page.viewportSize()!.width,
  );
}

// The shared fixture can retain records added by earlier suites. Own this view's snapshot.
async function visualSnapshot(page: Page) {
  await page.route('**/api/snapshot', async (route) => {
    const response = await route.fetch();
    const snapshot = (await response.json()) as Snapshot;
    const sessions = snapshot.sessions
      .filter((session) => session.id === 'synthetic-browser-session')
      .map((session) => ({ ...session, status: 'completed' as const }));
    await route.fulfill({
      response,
      json: {
        ...snapshot,
        sessions,
        workspaces: snapshot.workspaces.filter((workspace) =>
          sessions.some((session) => session.workspaceId === workspace.id),
        ),
      },
    });
  });
}

for (const theme of ['dark', 'light']) {
  for (const language of ['en-US', 'pt-BR']) {
    test(`${theme} ${language}: all main views fit desktop, tablet and mobile with enlarged reading`, async ({
      page,
    }) => {
      test.setTimeout(90000);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await visualSnapshot(page);
      await page.addInitScript(
        ({ theme, language }) => {
          localStorage.setItem('i18nextLng', language);
          localStorage.setItem(
            'orqst.appearance.v1',
            JSON.stringify({ theme, textSize: 'extra-large', density: 'comfortable' }),
          );
        },
        { theme, language },
      );
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      for (const width of [1440, 768, 390, 320]) {
        await page.setViewportSize({ width, height: 900 });
        for (const view of [
          'overview',
          'workspaces',
          'agents',
          'models',
          'artifacts',
          'settings',
        ]) {
          await page.goto(`/${view}`);
          await expect(page.locator('main h1')).toBeVisible();
          await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
          if (view === 'overview') {
            await expect(page.locator('.agent-cell').first()).toBeVisible();
            await expect(page.locator('.stat-live')).toHaveCount(0);
          }
          if (view === 'models')
            await expect(
              page
                .getByRole('region', {
                  name: language === 'en-US' ? 'Model ranking' : 'Ranking de modelos',
                  exact: true,
                })
                .first(),
            ).toBeVisible();
          if (view === 'settings' && width === 1440) {
            const appearance = await page
              .locator('[aria-labelledby="settings-appearance"]')
              .boundingBox();
            const notifications = await page
              .locator('[aria-labelledby="settings-notifications"]')
              .boundingBox();
            expect(notifications!.y).toBeLessThan(appearance!.y + appearance!.height);
          }
          if (view === 'models') {
            const padding = await page
              .locator('.analytics-export')
              .evaluate((element) => parseFloat(getComputedStyle(element).paddingLeft));
            expect(padding).toBeGreaterThanOrEqual(16);
            const evolutionInset = await page
              .locator('.analytics-evolution > p')
              .first()
              .evaluate((element) => parseFloat(getComputedStyle(element).marginLeft));
            expect(evolutionInset).toBeGreaterThanOrEqual(16);
          }
          await contained(page);
          const controls = await page.locator('.topbar-actions').evaluate((bar) => {
            const rect = bar.getBoundingClientRect();
            return [...bar.querySelectorAll('button, select')].every((element) => {
              const box = element.getBoundingClientRect();
              return (
                box.left >= rect.left &&
                box.right <= innerWidth &&
                box.top >= 0 &&
                box.bottom <= rect.bottom
              );
            });
          });
          expect(controls).toBe(true);
          if (language === 'en-US' && (width === 1440 || width === 390)) {
            await page.screenshot({
              path: test.info().outputPath(`${view}-${width}.png`),
              fullPage: true,
            });
          }
        }
        await page.goto('/overview/sessions/synthetic-browser-session');
        await expect(page.locator('.session-detail')).toBeVisible();
        await contained(page);
        await page.locator('.session-detail').scrollIntoViewIfNeeded();
        const header = await page.locator('.topbar').boundingBox();
        const context = await page.locator('.session-context-bar').boundingBox();
        expect(context!.y).toBeGreaterThanOrEqual(header!.y + header!.height);
        if (language === 'en-US' && width === 390) {
          await page.screenshot({ path: test.info().outputPath('session-mobile.png') });
        }
      }
      expect(errors).toEqual([]);
    });
  }
}

test('short sidebar remains scrollable and the mobile disclosure closes with Escape and restores focus', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 540 });
  await page.goto('/overview');
  await expect(page.locator('.agent-cell').first()).toBeVisible();
  await page.locator('.sidebar-bottom').scrollIntoViewIfNeeded();
  expect(await page.locator('.sidebar').evaluate((element) => element.scrollTop)).toBeGreaterThan(
    0,
  );
  await expect(page.locator('.local-badge')).toBeInViewport();
  await page.getByRole('link', { name: 'Overview', exact: true }).focus();
  await expect(page.getByRole('link', { name: 'Overview', exact: true })).toBeInViewport();
  await page.setViewportSize({ width: 320, height: 568 });
  const menu = page.getByRole('button', { name: 'Workspaces', exact: true });
  await menu.click();
  await expect(page.locator('.brand-logo')).toBeVisible();
  await page.getByRole('link', { name: 'Settings', exact: true }).focus();
  await expect(page.getByRole('link', { name: 'Settings', exact: true })).toBeInViewport();
  await page.keyboard.press('Escape');
  await expect(menu).toBeFocused();
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.sidebar')).toBeHidden();
  await contained(page);
});

test('mobile sessions retain names, status, time, usage and working source actions without horizontal scrolling', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.route('**/api/snapshot', async (route) => {
    const response = await route.fetch();
    const snapshot = (await response.json()) as Snapshot;
    await route.fulfill({
      response,
      json: {
        ...snapshot,
        sessions: snapshot.sessions
          .filter((session) => session.id === 'synthetic-browser-session')
          .map((session) => ({
            ...session,
            agentName:
              'Synthetic agent with a very long unbroken identifier ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
            status: 'running',
          })),
      },
    });
  });
  await page.goto('/overview');
  const table = page.locator('.session-table');
  await expect(table).toBeVisible();
  await expect(page.locator('.stat-live')).toHaveCount(1);
  await expect(table.getByRole('columnheader', { name: 'Status', exact: true })).toHaveCount(1);
  await table.scrollIntoViewIfNeeded();
  expect(await table.evaluate((element) => element.scrollWidth)).toBeLessThanOrEqual(288);
  await expect(table.locator('.status-running')).toBeInViewport();
  await expect(table.locator('.token-cell')).toBeInViewport();
  await table.locator('.agent-cell').click();
  await expect(page.locator('.session-detail')).toBeVisible();
  await contained(page);
});
