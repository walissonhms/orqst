import { expect, test, type Page } from '@playwright/test';

const storageKey = 'orqst.overview.v1';
const defaultOrder = ['activity', 'attention', 'usage', 'diagnostics'];
const trigger = (page: Page) =>
  page.getByRole('button', { name: 'Customize overview', exact: true });
const editor = (page: Page) =>
  page.getByRole('dialog', { name: 'Customize overview', exact: true });
async function panelOrder(page: Page) {
  return page
    .locator('[data-overview-panel]')
    .evaluateAll((panels) => panels.map((panel) => panel.getAttribute('data-overview-panel')));
}

test('visible panels and reading order persist; keyboard moves, reset and dismissal retain focus and scope', async ({
  page,
}) => {
  await page.goto('/overview');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(
    page.getByRole('button', { name: 'View session Synthetic browser agent' }),
  ).toBeVisible();
  await expect.poll(() => panelOrder(page)).toEqual(defaultOrder);
  const shell = await page.evaluate(() => localStorage.getItem('orqst.shell.v1'));
  await trigger(page).click();
  const dialog = editor(page);
  await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(
    dialog.getByRole('checkbox', { name: 'Execution timeline', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('dialog', { name: 'Search & commands' })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Move Execution timeline up' })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Move Needs attention up' }).focus();
  await page.keyboard.press('Enter');
  await expect(
    dialog.getByRole('checkbox', { name: 'Needs attention', exact: true }),
  ).toBeFocused();
  await expect(dialog.getByRole('status')).toContainText('position 1 of 4');
  await dialog.getByRole('checkbox', { name: 'Token usage', exact: true }).uncheck();
  await page.keyboard.press('Escape');
  await expect(trigger(page)).toBeFocused();
  expect(await panelOrder(page)).toEqual(['attention', 'activity', 'diagnostics']);
  expect(await page.evaluate(() => localStorage.getItem('orqst.shell.v1'))).toBe(shell);
  await page.reload();
  expect(await panelOrder(page)).toEqual(['attention', 'activity', 'diagnostics']);
  const primary = page.locator('.overview-primary');
  const secondary = page.locator('.overview-secondary');
  expect((await primary.boundingBox())!.width).toBeGreaterThan(
    (await secondary.boundingBox())!.width,
  );
  await trigger(page).click();
  await dialog.getByRole('button', { name: 'Restore default layout' }).click();
  await expect(dialog.getByRole('button', { name: 'Restore default layout' })).toBeFocused();
  await expect(dialog.getByRole('checkbox', { name: 'Token usage', exact: true })).toBeChecked();
  await expect(dialog.getByRole('status')).toHaveText('Default overview layout restored.');
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(trigger(page)).toBeFocused();
  await expect.poll(() => panelOrder(page)).toEqual(defaultOrder);
  expect(await page.evaluate(() => localStorage.getItem('orqst.shell.v1'))).toBe(shell);
});

test('all-hidden and single-panel layouts retain sessions, notifications and a discoverable recovery action', async ({
  page,
}) => {
  await page.goto('/overview');
  await trigger(page).click();
  const dialog = editor(page);
  const checks = dialog.getByRole('checkbox');
  for (const check of await checks.all()) await check.uncheck();
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.locator('[data-overview-panel]')).toHaveCount(0);
  await expect(
    page.getByText('Optional overview panels are hidden.', { exact: false }),
  ).toBeVisible();
  await expect(page.locator('.stats')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Notifications', exact: true })).toBeVisible();
  await page.locator('.overview-empty').getByRole('button', { name: 'Customize overview' }).click();
  await dialog.getByRole('checkbox', { name: 'Source health', exact: true }).check();
  await page.keyboard.press('Escape');
  await expect(trigger(page)).toBeFocused();
  await expect(page.locator('.overview-panels-single')).toBeVisible();
  expect(await panelOrder(page)).toEqual(['diagnostics']);
  await page.getByRole('button', { name: 'View session Synthetic browser agent' }).click();
  await expect(page.getByRole('region', { name: 'Session details', exact: true })).toBeVisible();
  await expect(page.locator('[data-overview-panel]')).toHaveCount(0);
  await page.locator('.session-detail').getByRole('button', { name: 'Close', exact: true }).click();
  expect(await panelOrder(page)).toEqual(['diagnostics']);
});

test('malformed or removed layout storage recovers safely and same-origin tabs synchronize without storing observations', async ({
  page,
  context,
}) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('synthetic-overview-seeded')) {
      localStorage.setItem('orqst.overview.v1', '{bad-json');
      sessionStorage.setItem('synthetic-overview-seeded', 'yes');
    }
  });
  await page.goto('/overview');
  await expect.poll(() => panelOrder(page)).toEqual(defaultOrder);
  const other = await context.newPage();
  await other.goto('/overview');
  await other.evaluate(() => {
    Reflect.set(window, 'syntheticOverviewWrites', 0);
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key === 'orqst.overview.v1')
        Reflect.set(
          window,
          'syntheticOverviewWrites',
          Number(Reflect.get(window, 'syntheticOverviewWrites')) + 1,
        );
      original.call(this, key, value);
    };
  });
  await trigger(page).click();
  await editor(page).getByRole('checkbox', { name: 'Execution timeline', exact: true }).uncheck();
  await expect(other.locator('[data-overview-panel="activity"]')).toHaveCount(0);
  expect(await other.evaluate(() => Reflect.get(window, 'syntheticOverviewWrites'))).toBe(0);
  await other.evaluate((key) => localStorage.removeItem(key), storageKey);
  await expect(
    editor(page).getByRole('checkbox', { name: 'Execution timeline', exact: true }),
  ).toBeChecked();
  await other.evaluate((key) => localStorage.setItem(key, 'null'), storageKey);
  await expect(
    editor(page).getByRole('checkbox', { name: 'Execution timeline', exact: true }),
  ).toBeChecked();
  // Invalid storage need not be rewritten if defaults were already active.
  // The next explicit edit/reset must still write only the allowlisted shape.
  await editor(page).getByRole('checkbox', { name: 'Token usage', exact: true }).uncheck();
  await editor(page).getByRole('button', { name: 'Restore default layout' }).click();
  await expect.poll(() => other.locator('[data-overview-panel]').count()).toBe(4);
  const stored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), storageKey);
  expect(Object.keys(stored).sort()).toEqual(['hidden', 'order']);
  expect(stored).toEqual({ order: defaultOrder, hidden: [] });
  await other.close();
});

test('layout remains usable offline when local storage is denied and reports visit-only changes', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new Error('Synthetic overview storage denial');
      },
    });
  });
  await page.route('**/api/**', (route) => route.abort());
  await page.goto('/overview');
  await trigger(page).click();
  await expect(editor(page)).toContainText('Layout applies for this visit.');
  await editor(page).getByRole('checkbox', { name: 'Execution timeline', exact: true }).uncheck();
  await page.keyboard.press('Escape');
  expect(await panelOrder(page)).toEqual(['attention', 'usage', 'diagnostics']);
  await trigger(page).click();
  await expect(
    editor(page).getByRole('checkbox', { name: 'Execution timeline', exact: true }),
  ).not.toBeChecked();
});

test('customizing panels preserves the exact active artifact draft and its navigation guard', async ({
  page,
}) => {
  const draft = 'Synthetic overview draft <script>window.orqstInjected=true</script>\n';
  await page.goto('/overview/sessions/synthetic-browser-session');
  await page
    .getByRole('button', { name: 'Extract artifact manually', exact: true })
    .first()
    .click();
  const artifact = page.getByRole('region', { name: 'Manual artifact', exact: true });
  await artifact.getByRole('button', { name: 'Edit draft', exact: true }).click();
  await artifact.getByRole('textbox').fill(draft);
  const provenance = await artifact.locator('.artifact-provenance').innerText();
  await trigger(page).click();
  await editor(page).getByRole('button', { name: 'Move Needs attention up' }).click();
  await editor(page).getByRole('checkbox', { name: 'Execution timeline', exact: true }).uncheck();
  await editor(page).getByRole('button', { name: 'Restore default layout' }).click();
  await page.keyboard.press('Escape');
  await expect(trigger(page)).toBeFocused();
  await expect(artifact.getByRole('textbox')).toHaveValue(draft);
  await expect(artifact.locator('.artifact-provenance')).toHaveText(provenance, {
    useInnerText: true,
  });
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(
    page.getByRole('dialog', { name: 'Discard artifact draft?', exact: true }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(artifact.getByRole('textbox')).toHaveValue(draft);
  expect(
    await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage })),
  ).not.toContain(draft);
  expect(await page.evaluate(() => Reflect.get(window, 'orqstInjected'))).toBeUndefined();
});

test('localized reordered panels and customization fit light desktop and narrow maximum-size layouts', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'orqst.overview.v1',
      JSON.stringify({
        order: ['attention', 'diagnostics', 'activity', 'usage'],
        hidden: [],
      }),
    );
    localStorage.setItem(
      'orqst.appearance.v1',
      JSON.stringify({
        theme: 'light',
        contrast: 'high',
        density: 'comfortable',
        motion: 'reduced',
        textSize: 'extra-large',
        contentSize: 'extra-large',
        contentFont: 'sans',
      }),
    );
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const width of [1440, 1280, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/overview');
    await expect(
      page.locator('.agent-cell').filter({ hasText: 'Synthetic browser agent' }),
    ).toBeVisible();
    expect(await panelOrder(page)).toEqual(['attention', 'diagnostics', 'activity', 'usage']);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    await page
      .getByRole('combobox', { name: /Language|Idioma/, exact: true })
      .selectOption(width < 700 ? 'pt-BR' : 'en-US');
    const title = width < 700 ? 'Personalizar visão geral' : 'Customize overview';
    await page.getByRole('button', { name: title, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: title, exact: true });
    await expect(dialog.getByRole('checkbox')).toHaveCount(4);
    expect(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    const bounds = (await dialog.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: test.info().outputPath(`overview-layout-${width}.png`) });
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: title, exact: true })).toBeFocused();
    await page.screenshot({
      path: test.info().outputPath(`overview-panels-${width}.png`),
      fullPage: true,
    });
  }
});
