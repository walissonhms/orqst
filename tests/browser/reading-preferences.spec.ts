import { test, expect, type Page } from '@playwright/test';

async function openSettings(page: Page) {
  await page.goto('/#settings');
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
}
async function enlargeReading(page: Page) {
  await page
    .getByRole('combobox', { name: 'Interface text size', exact: true })
    .selectOption('extra-large');
  await page
    .getByRole('combobox', { name: 'Captured text size', exact: true })
    .selectOption('extra-large');
  await page
    .getByRole('combobox', { name: 'Captured text font', exact: true })
    .selectOption('sans');
}
async function fontSize(page: Page, selector: string) {
  return page
    .locator(selector)
    .first()
    .evaluate((node) => parseFloat(getComputedStyle(node).fontSize));
}

test('reading preferences migrate old storage, synchronize, survive reload and reset with Cancel focus', async ({
  page,
  context,
}) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('synthetic-reading-seeded')) {
      localStorage.setItem(
        'orqst.appearance.v1',
        JSON.stringify({ contrast: 'high', density: 'comfortable', motion: 'reduced' }),
      );
      sessionStorage.setItem('synthetic-reading-seeded', 'yes');
    }
  });
  await openSettings(page);
  await expect(
    page.getByRole('combobox', { name: 'Interface text size', exact: true }),
  ).toHaveValue('standard');
  await expect(page.getByRole('combobox', { name: 'Contrast', exact: true })).toHaveValue('high');
  const other = await context.newPage();
  await openSettings(other);
  await enlargeReading(page);
  await expect(other.locator('html')).toHaveAttribute('data-content-size', 'extra-large');
  await expect(other.locator('html')).toHaveAttribute('data-text-size', 'extra-large');
  await expect(other.locator('html')).toHaveAttribute('data-content-font', 'sans');
  await page.reload();
  await expect(page.getByRole('combobox', { name: 'Captured text font', exact: true })).toHaveValue(
    'sans',
  );
  await expect(page.getByRole('combobox', { name: 'Captured text size', exact: true })).toHaveValue(
    'extra-large',
  );
  const reset = page.getByRole('button', { name: 'Reset appearance', exact: true });
  await reset.click();
  const dialog = page.getByRole('dialog', { name: 'Reset appearance', exact: true });
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(reset).toBeFocused();
  await expect(
    page.getByRole('combobox', { name: 'Interface text size', exact: true }),
  ).toHaveValue('extra-large');
  await reset.click();
  await dialog.getByRole('button', { name: 'Restore appearance defaults', exact: true }).click();
  for (const label of ['Interface text size', 'Captured text size']) {
    await expect(page.getByRole('combobox', { name: label, exact: true })).toHaveValue('standard');
  }
  await expect(page.getByRole('combobox', { name: 'Captured text font', exact: true })).toHaveValue(
    'default',
  );
  await expect(reset).toBeFocused();
  await expect(other.locator('html')).toHaveAttribute('data-text-size', 'standard');
  await other.close();
});

test('reading settings apply actual independent typography offline and remain keyboard operable', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new Error('Synthetic storage denial');
      },
    });
  });
  await page.route('**/api/**', (route) => route.abort());
  await openSettings(page);
  const interfaceSize = await fontSize(page, '.reading-preview > p');
  const contentSize = await fontSize(page, '.reading-preview pre');
  const contentSelect = page.getByRole('combobox', { name: 'Captured text size', exact: true });
  await contentSelect.focus();
  await expect(contentSelect).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(
    page.getByRole('combobox', { name: 'Captured text font', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(contentSelect).toBeFocused();
  await contentSelect.selectOption('extra-large');
  await expect(contentSelect).toHaveValue('extra-large');
  expect(await fontSize(page, '.reading-preview > p')).toBe(interfaceSize);
  expect(await fontSize(page, '.reading-preview pre')).toBeCloseTo(contentSize * 1.3, 1);
  await page
    .getByRole('combobox', { name: 'Interface text size', exact: true })
    .selectOption('extra-large');
  expect(await fontSize(page, '.reading-preview > p')).toBeCloseTo(interfaceSize * 1.25, 1);
  expect(await fontSize(page, '.reading-preview pre')).toBeCloseTo(contentSize * 1.3 * 1.25, 1);
  await page
    .getByRole('combobox', { name: 'Captured text font', exact: true })
    .selectOption('sans');
  expect(
    await page
      .locator('.reading-preview pre')
      .evaluate((node) => getComputedStyle(node).fontFamily),
  ).toContain('Inter');
  await expect(
    page.getByText('Appearance applies for this visit.', { exact: false }),
  ).toBeVisible();
});

test('retained text and draft copies remain exact while reading fonts leave provenance and code distinct', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openSettings(page);
  await enlargeReading(page);
  await page.goto('/#session=synthetic-browser-session');
  const detail = page.getByRole('region', { name: 'Session details', exact: true });
  await expect(detail).toBeVisible();
  await page
    .getByRole('button', { name: 'Extract artifact manually', exact: true })
    .first()
    .click();
  const artifact = page.getByRole('region', { name: 'Manual artifact', exact: true });
  const source = artifact.locator('pre.artifact-content');
  await expect(source).toBeVisible();
  const original = await source.innerText();
  expect(await fontSize(page, 'pre.artifact-content')).toBeCloseTo(13 * 1.25 * 1.3, 1);
  expect(await source.evaluate((node) => getComputedStyle(node).fontFamily)).toContain('Inter');
  expect(
    await artifact
      .locator('.artifact-provenance')
      .evaluate((node) => getComputedStyle(node).fontFamily),
  ).not.toContain('Consolas');
  await artifact.getByRole('button', { name: 'Copy original Markdown', exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(original);
  await artifact.getByRole('button', { name: 'Edit draft', exact: true }).click();
  const editor = artifact.getByRole('textbox');
  await expect(editor).toHaveValue(original);
  expect(await editor.evaluate((node) => parseFloat(getComputedStyle(node).fontSize))).toBeCloseTo(
    13 * 1.25 * 1.3,
    1,
  );
  const draft =
    '# Synthetic reading test\n```js\nconst total = 120;\n```\n<script>window.readingInjected = true</script>';
  await editor.fill(draft);
  await artifact.getByRole('button', { name: 'Draft preview', exact: true }).click();
  expect(
    await artifact
      .locator('.artifact-content code')
      .evaluate((node) => getComputedStyle(node).fontFamily),
  ).toContain('Consolas');
  await expect(artifact.locator('script')).toHaveCount(0);
  expect(await page.evaluate(() => Reflect.get(window, 'readingInjected'))).toBeUndefined();
  await artifact.getByRole('button', { name: 'Copy draft Markdown', exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(draft);
  await artifact.getByRole('button', { name: 'Original source', exact: true }).click();
  await expect(source).toHaveText(original);
  await page.getByRole('button', { name: 'Observed tools', exact: true }).click();
  const toolText = detail.locator('.observed-tool-record pre.reading-content').first();
  await expect(toolText).toBeVisible();
  expect(
    await toolText.evaluate((node) => parseFloat(getComputedStyle(node).fontSize)),
  ).toBeCloseTo(13 * 1.25 * 1.3, 1);
});

test('maximum reading sizes reflow across views, overlays and artifacts at laptop and narrow widths in both languages', async ({
  page,
}) => {
  test.setTimeout(60000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openSettings(page);
  await enlargeReading(page);
  await page.getByRole('combobox', { name: 'Spacing', exact: true }).selectOption('comfortable');
  for (const width of [1440, 1280, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    for (const view of [
      'settings',
      'workspaces',
      'agents',
      'models',
      'session=synthetic-browser-session',
    ]) {
      await page.goto(`/#${view}`);
      await expect(page.locator('html')).toHaveAttribute('data-text-size', 'extra-large');
      await expect(
        page
          .locator(
            '.settings-page, .workspace-directory, .adapter-panel, .analytics, .session-detail',
          )
          .first(),
      ).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
    }
    await page
      .getByRole('button', { name: 'Extract artifact manually', exact: true })
      .first()
      .click();
    await expect(page.locator('pre.artifact-content')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    await page.getByRole('button', { name: 'Search & commands', exact: true }).click();
    const palette = page.getByRole('dialog', { name: 'Search & commands', exact: true });
    await expect(palette.getByRole('textbox')).toBeFocused();
    expect((await palette.boundingBox())!.width).toBeLessThanOrEqual(width);
    await page.keyboard.press('Escape');
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      window.scrollTo(0, 0);
    });
    await page.screenshot({
      path: test.info().outputPath(`orqst-reading-${width}.png`),
      fullPage: true,
    });
  }
  await openSettings(page);
  await page
    .locator('.settings-group')
    .getByRole('combobox', { name: 'Language', exact: true })
    .selectOption('pt-BR');
  await expect(
    page.getByRole('combobox', { name: 'Tamanho do texto da interface', exact: true }),
  ).toHaveValue('extra-large');
  await expect(
    page.getByRole('combobox', { name: 'Fonte do texto capturado', exact: true }),
  ).toHaveValue('sans');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await page.getByRole('button', { name: 'Redefinir aparência', exact: true }).click();
  const reset = page.getByRole('dialog');
  expect((await reset.boundingBox())!.width).toBeLessThanOrEqual(320);
  await page.screenshot({
    path: test.info().outputPath('orqst-reading-reset-pt-320.png'),
    fullPage: true,
  });
});
