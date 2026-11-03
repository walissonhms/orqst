import { test, expect } from '@playwright/test';
import type { Snapshot } from '@orqst/protocol';

test('approved artwork loads locally, preserves proportions and remains accessible across layouts', async ({
  page,
}) => {
  // Explicitly synthetic empty welcome, isolated from the shared fixture's retained sessions.
  await page.route('**/api/snapshot', async (route) => {
    const response = await route.fetch();
    const snapshot = (await response.json()) as Snapshot;
    await route.fulfill({ response, json: { ...snapshot, sessions: [] } });
  });
  const failures: string[] = [];
  page.on('pageerror', (error) => failures.push(error.message));
  const artworkRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/brand/')) artworkRequests.push(request.url());
  });
  for (const theme of ['dark', 'light']) {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/#settings');
    await page.getByRole('combobox', { name: 'Theme', exact: true }).selectOption(theme);
    await page.getByRole('link', { name: 'Overview', exact: true }).click();
    const mascot = page.locator('.empty-mascot');
    await expect(mascot).toBeVisible();
    await expect(mascot).toHaveAttribute('alt', '');
    await expect(mascot).toHaveAttribute('aria-hidden', 'true');
    for (const width of [1440, 1024, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      if (width <= 700) await page.getByRole('button', { name: 'Workspaces', exact: true }).click();
      const logo = page.getByRole('img', { name: 'ORQST', exact: true });
      if (width <= 700) {
        // Preserve the existing mobile menu policy: branding is hidden there.
        await expect(page.locator('.brand')).toBeHidden();
      } else {
        await expect(logo).toBeVisible();
        await expect(page.getByRole('link', { name: 'ORQST', exact: true })).toBeVisible();
      }
      for (const element of width <= 700 ? [mascot] : [logo, mascot]) {
        const metrics = await element.evaluate((image: HTMLImageElement) => ({
          loaded: image.complete && image.naturalWidth > 0,
          naturalRatio: image.naturalWidth / image.naturalHeight,
          ratio: image.getBoundingClientRect().width / image.getBoundingClientRect().height,
        }));
        expect(metrics.loaded).toBe(true);
        expect(metrics.ratio).toBeCloseTo(metrics.naturalRatio, 2);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
      if (width <= 700) await page.getByRole('button', { name: 'Workspaces', exact: true }).click();
    }
    await page.screenshot({
      path: test.info().outputPath(`brand-${theme}-mobile.png`),
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByLabel('Language').selectOption('pt-BR');
  await expect(
    page.getByRole('heading', { name: 'Pronto para acompanhar seus agentes.' }),
  ).toBeVisible();
  const home = page.getByRole('link', { name: 'ORQST', exact: true });
  await home.focus();
  await expect(home).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#overview$/);
  await expect(page.getByRole('img', { name: 'ORQST', exact: true })).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath('brand-light-desktop.png'),
    fullPage: true,
  });
  expect(artworkRequests.length).toBeGreaterThanOrEqual(2);
  expect(artworkRequests.every((url) => new URL(url).origin === new URL(page.url()).origin)).toBe(
    true,
  );
  expect(failures).toEqual([]);
});
