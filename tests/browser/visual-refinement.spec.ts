import { test, expect, type Page } from '@playwright/test';
import type { Snapshot } from '@orqst/protocol';
import { openModelsTab, openObservedSessions, settingsTabs } from '../helpers/spec-dashboard.js';

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
            await openObservedSessions(page);
            await expect(
              page.getByRole('link', { name: 'Synthetic browser agent', exact: true }),
            ).toBeVisible();
            await expect(page.locator('.spec-counters dd')).toHaveText(Array(5).fill('—'));
          }
          if (view === 'models') {
            await openModelsTab(page);
            await expect(
              page
                .getByRole('region', {
                  name: language === 'en-US' ? 'Model ranking' : 'Ranking de modelos',
                  exact: true,
                })
                .first(),
            ).toBeVisible();
          }
          if (view === 'settings' && width === 1440) {
            await expect(settingsTabs(page)).toBeVisible();
            const bounds = await page.locator('.spec-settings-content').boundingBox();
            expect(bounds!.width).toBeLessThanOrEqual(640);
          }
          if (view === 'models') {
            const exportPanel = page.locator('.analytics-export');
            await exportPanel.locator('summary').click();
            await expect(exportPanel.getByRole('button', { name: /CSV/ })).toBeVisible();
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
          if (view === 'models') {
            const filters = page.locator('.spec-metrics-controls');
            const header = page.locator('.topbar');
            await expect(header).toHaveCSS('height', '45px');
            for (const control of await filters.getByRole('combobox').all()) {
              await control.focus();
              await expect(control).toBeInViewport();
            }
            const refresh = header.getByRole('button', { name: /^(Refresh|Atualizar)$/ });
            await refresh.focus();
            await expect(refresh).toBeInViewport();
          } else {
            expect(controls).toBe(true);
          }
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
        const header = page.locator('.topbar');
        const badge = header.locator('.session-token-badge');
        await expect(badge).toBeInViewport();
        await expect(header).toHaveCSS('height', '45px');
        const frame = (await header.boundingBox())!;
        const inspector = (await page.locator('.session-detail').boundingBox())!;
        expect(inspector.y).toBeGreaterThanOrEqual(frame.y + frame.height);
        if (language === 'en-US' && width === 390) {
          await page.screenshot({ path: test.info().outputPath('session-mobile.png') });
        }
      }
      expect(errors).toEqual([]);
    });
  }
}

test('short layout keeps the persistent mobile rail and restores notification focus', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 540 });
  await page.goto('/visao-geral');
  await openObservedSessions(page);
  await expect(
    page.getByRole('link', { name: 'Synthetic browser agent', exact: true }),
  ).toBeVisible();
  const sidebar = page.locator('#app-sidebar');
  await expect(sidebar.getByRole('link', { name: 'Overview', exact: true })).toBeInViewport();
  await page.setViewportSize({ width: 320, height: 568 });
  await expect(sidebar).toHaveCSS('width', '46px');
  await expect(sidebar.locator('.shell-brand-logo')).toBeVisible();
  const bell = sidebar.getByRole('button', { name: 'Notifications', exact: true });
  await bell.click();
  const drawer = page.getByRole('dialog', { name: 'Notifications', exact: true });
  await expect(drawer).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(bell).toBeFocused();
  await expect(sidebar).toBeVisible();
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
  await openObservedSessions(page);
  const table = page.locator('details[open] .spec-table');
  await expect(table).toBeVisible();
  await expect(table.getByRole('columnheader', { name: 'Status', exact: true })).toHaveCount(1);
  await expect(table.getByRole('columnheader', { name: 'Last activity', exact: true })).toHaveCount(
    1,
  );
  await expect(table.getByRole('row').last()).toContainText(/Running|Stale/);
  await contained(page);
  await table.getByRole('link', { name: /^Synthetic agent with a very long/ }).click();
  await expect(page.locator('.session-detail')).toBeVisible();
  await expect(page.locator('.session-token-badge strong')).toHaveText(/\d/);
  await contained(page);
});
