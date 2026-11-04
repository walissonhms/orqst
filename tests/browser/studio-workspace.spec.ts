import { test, expect } from '@playwright/test';

// Renderer-only facades: no native runtime, terminal process or execution grant.
test('Studio fills the viewport with one workspace and keeps preparation in a dismissible drawer', async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    Reflect.set(window, 'featureCalls', []);
    Reflect.set(window, 'studioCalls', []);
    Object.defineProperty(window, 'orqstFeatures', {
      value: {
        contractVersion: 1,
        async request({ action }: { action: string }) {
          (Reflect.get(window, 'featureCalls') as string[]).push(action);
          return { status: 'unavailable' };
        },
      },
    });
    Object.defineProperty(window, 'orqstStudio', {
      value: {
        contractVersion: 1,
        async request({ action }: { action: string }) {
          (Reflect.get(window, 'studioCalls') as string[]).push(action);
          return {
            status: 'ok',
            snapshot: {
              count: 0,
              limit: 2,
              opened: false,
              prepared: false,
              canCreate: true,
              canSelect: true,
              busy: false,
            },
          };
        },
      },
    });
  });
  await page.goto('/studio');
  const workspace = page.locator('.studio-workspace > .feature-workspace');
  await expect(workspace).toBeVisible();
  await expect(page.locator('#app-sidebar')).toBeHidden();
  await expect(page.locator('.main-shell > .topbar')).toBeHidden();
  await expect(page.locator('.app-footer')).toBeHidden();
  await expect(page.locator('.feature-workspace')).toHaveCount(1);
  for (const [width, height] of [
    [1440, 900],
    [720, 700],
    [390, 600],
    [320, 600],
  ]) {
    await page.setViewportSize({ width: width!, height: height! });
    await expect.poll(() => workspace.boundingBox()).toEqual({ x: 0, y: 0, width, height });
    expect(
      await page.evaluate(() => ({
        width: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight,
      })),
    ).toEqual({ width, height });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: '＋ Terminal', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'Terminal preparation', exact: true });
  await expect(drawer).toBeVisible();
  await expect(
    drawer.getByRole('button', { name: 'Prepare Codex + OpenCode…', exact: true }),
  ).toBeEnabled();
  await expect(page.locator('.feature-workspace')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  await expect(page.getByRole('button', { name: '＋ Terminal', exact: true })).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath('studio-full-viewport-en.png') });
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await expect(page).toHaveURL('/overview');
  await expect(page.locator('#app-sidebar')).toBeVisible();
  await page.getByRole('combobox', { name: 'Language' }).selectOption('pt-BR');
  await page.getByRole('link', { name: 'Terminais / Studio', exact: true }).click();
  await expect(workspace).toBeVisible();
  await page.getByRole('button', { name: '＋ Terminal', exact: true }).click();
  await expect(
    page.getByRole('dialog', { name: 'Preparação de terminais', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Fechar', exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath('studio-full-viewport-pt.png') });
  expect(await page.evaluate(() => Reflect.get(window, 'studioCalls'))).toEqual([
    'snapshot',
    'snapshot',
  ]);
  expect((await page.evaluate(() => Reflect.get(window, 'featureCalls'))) as string[]).toEqual([
    'snapshot',
    'snapshot',
  ]);
});
