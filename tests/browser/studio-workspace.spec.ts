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
    Object.defineProperty(window, 'orqstTauriStudio', {
      value: {
        contractVersion: 1,
        async request({ action }: { action: string }) {
          (Reflect.get(window, 'studioCalls') as string[]).push(action);
          return {
            status: 'ok',
            snapshot: {
              count: 0,
              generation: 1,
              limit: 8,
              selectionLocked: false,
              canCreate: true,
              canReview: false,
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
  const newTerminal = workspace.locator('.ts-toolbar').getByRole('button', {
    name: 'New terminal',
    exact: true,
  });
  await newTerminal.click();
  await page
    .getByRole('dialog', { name: 'New terminals', exact: true })
    .getByRole('button', { name: 'Advanced options (MCP pair, path review)' })
    .click();
  const drawer = page.getByRole('dialog', { name: 'Open terminal', exact: true });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole('button', { name: 'Open', exact: true })).toBeDisabled();
  await expect(drawer.getByText('Prepare Codex + OpenCode…', { exact: true })).toHaveCount(0);
  await expect(drawer.getByLabel('CLI provider').locator('option')).toHaveCount(4);
  await expect(drawer.getByLabel('Terminal count').locator('option')).toHaveCount(8);
  await expect(drawer.getByText('This Desktop is running an older', { exact: false })).toHaveCount(
    0,
  );
  await expect(page.locator('.feature-workspace')).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath('studio-preparation-en.png') });
  await page.setViewportSize({ width: 390, height: 600 });
  await expect(drawer).toHaveCSS('width', '390px');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await expect(drawer.getByLabel('CLI provider')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('studio-preparation-compact-en.png') });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  await expect(newTerminal).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath('studio-full-viewport-en.png') });
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await expect(page).toHaveURL('/overview');
  await expect(page.locator('#app-sidebar')).toBeVisible();
  await page.getByRole('combobox', { name: 'Language' }).selectOption('pt-BR');
  await page.getByRole('link', { name: 'Terminais / Studio', exact: true }).click();
  await expect(workspace).toBeVisible();
  await workspace
    .locator('.ts-toolbar')
    .getByRole('button', { name: 'Novo terminal', exact: true })
    .click();
  await page
    .getByRole('dialog', { name: 'Novos terminais', exact: true })
    .getByRole('button', { name: 'Opções avançadas (par MCP, revisão de caminhos)' })
    .click();
  await expect(page.getByRole('dialog', { name: 'Abrir terminal', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('studio-preparation-pt.png') });
  await page.getByRole('button', { name: 'Fechar', exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath('studio-full-viewport-pt.png') });
  expect(await page.evaluate(() => Reflect.get(window, 'studioCalls'))).toEqual([
    'catalog',
    'snapshot',
    'catalog',
    'snapshot',
  ]);
  // Periodic Feature reads may finish during either drawer, without sending mutations.
  const featureCalls = (await page.evaluate(() => Reflect.get(window, 'featureCalls'))) as string[];
  expect(new Set(featureCalls)).toEqual(new Set(['snapshot']));
});

test('Studio has one Overview action and a compact Feature sidebar at narrow widths', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'orqstFeatures', {
      value: {
        contractVersion: 1,
        request: async () => ({ status: 'unavailable' }),
      },
    });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/studio');
  const overview = page.getByRole('button', { name: 'Overview', exact: true });
  const sidebar = page.locator('.feature-sidebar');
  await expect(overview).toHaveCount(1);
  await page.getByRole('button', { name: 'Show the Feature panel' }).click();
  await expect(overview).toHaveCount(1);
  await expect(sidebar).toHaveCSS('width', '155px');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(sidebar).toHaveCSS('width', '46px');
  await expect(overview).toBeInViewport({ ratio: 1 });
  await expect(
    page.locator('.ts-toolbar').getByRole('button', { name: 'New terminal' }),
  ).toBeInViewport({ ratio: 1 });
  await overview.click();
  await expect(page).toHaveURL('/overview');
});
