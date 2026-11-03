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
      await expect(logo).toBeVisible();
      await expect(page.getByRole('link', { name: 'ORQST', exact: true })).toBeVisible();
      await expect(page.locator('.brand')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
      await expect(logo).toHaveAttribute(
        'src',
        theme === 'dark' ? '/brand/orqst-logo-dark.svg' : '/brand/orqst-logo.svg',
      );
      for (const element of [logo, mascot]) {
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
  await expect(page).toHaveURL('/overview');
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

test('transparent theme variant preserves the source silhouette and purple accent without a backing', async ({
  page,
}) => {
  await page.goto('/settings');
  const pixels = await page.evaluate(async () => {
    const decode = async (src: string) => {
      const image = new Image();
      image.src = src;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0);
      return context.getImageData(0, 0, canvas.width, canvas.height).data;
    };
    const original = await decode('/brand/orqst-logo.svg');
    const dark = await decode('/brand/orqst-logo-dark.svg');
    let transparentChanged = 0;
    let silhouetteChanged = 0;
    let accentChanged = 0;
    let accentCount = 0;
    let lightInk = 0;
    for (let i = 0; i < original.length; i += 4) {
      const x = (i / 4) % 880;
      const y = Math.floor(i / 4 / 880);
      if (original[i + 3] === 0 && dark[i + 3] !== 0) transparentChanged++;
      // The only removed pixels are stray source noise outside the artwork bounds.
      if (x >= 64 && x <= 878 && y >= 63 && y <= 248 && original[i + 3] !== dark[i + 3])
        silhouetteChanged++;
      if (original[i + 3]! > 0 && original[i]! >= 40 && original[i + 2]! >= 80) {
        accentCount++;
        if ([0, 1, 2, 3].some((channel) => original[i + channel] !== dark[i + channel]))
          accentChanged++;
      }
      if (dark[i]! > 230 && dark[i + 1]! > 230 && dark[i + 2]! > 240 && dark[i + 3]! > 128)
        lightInk++;
    }
    return {
      transparentChanged,
      silhouetteChanged,
      accentChanged,
      accentCount,
      lightInk,
      corner: Array.from(dark.slice(0, 4)),
    };
  });
  expect(pixels.transparentChanged).toBe(0);
  expect(pixels.silhouetteChanged).toBe(0);
  expect(pixels.accentChanged).toBe(0);
  expect(pixels.accentCount).toBeGreaterThan(3000);
  expect(pixels.lightInk).toBeGreaterThan(60000);
  expect(pixels.corner).toEqual([0, 0, 0, 0]);
  await page.getByRole('combobox', { name: 'Theme', exact: true }).selectOption('system');
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    await expect(page.locator('.brand-logo')).toHaveAttribute(
      'src',
      colorScheme === 'dark' ? '/brand/orqst-logo-dark.svg' : '/brand/orqst-logo.svg',
    );
    await expect(page.locator('.brand-logo')).toHaveCSS('filter', 'none');
  }
});
