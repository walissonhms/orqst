import { test, expect, type Page } from '@playwright/test';
import type { Preferences, SessionMetricsResult, Snapshot } from '@orqst/protocol';

async function settings(page: Page) {
  await page.goto('/#settings');
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
}

test('Settings navigation, appearance persistence and scoped reset preserve keyboard ownership', async ({
  page,
}) => {
  await page.goto('/#workspaces');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page).toHaveURL(/#settings$/);
  await page.getByRole('combobox', { name: 'Contrast', exact: true }).selectOption('high');
  await page.getByRole('combobox', { name: 'Spacing', exact: true }).selectOption('comfortable');
  await page.getByRole('combobox', { name: 'Motion', exact: true }).selectOption('reduced');
  await page.reload();
  await expect(page.getByRole('combobox', { name: 'Contrast', exact: true })).toHaveValue('high');
  await expect(page.getByRole('combobox', { name: 'Spacing', exact: true })).toHaveValue(
    'comfortable',
  );
  await expect(page.getByRole('combobox', { name: 'Motion', exact: true })).toHaveValue('reduced');
  const shell = await page.evaluate(() => localStorage.getItem('orqst.shell.v1'));
  const reset = page.getByRole('button', { name: 'Reset appearance', exact: true });
  await reset.click();
  const dialog = page.getByRole('dialog', { name: 'Reset appearance' });
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('dialog', { name: 'Search & commands' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(reset).toBeFocused();
  await expect(page.getByRole('combobox', { name: 'Contrast', exact: true })).toHaveValue('high');
  await reset.click();
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Restore appearance defaults' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await expect(reset).toBeFocused();
  await expect(page.getByRole('combobox', { name: 'Contrast', exact: true })).toHaveValue(
    'standard',
  );
  await expect(page.getByRole('combobox', { name: 'Spacing', exact: true })).toHaveValue('compact');
  await expect(page.getByRole('combobox', { name: 'Motion', exact: true })).toHaveValue('system');
  expect(await page.evaluate(() => localStorage.getItem('orqst.shell.v1'))).toBe(shell);
  await page.getByRole('button', { name: 'Search & commands', exact: true }).click();
  const palette = page.getByRole('dialog', { name: 'Search & commands' });
  await palette.getByRole('textbox').fill('Settings');
  await page.keyboard.press('Enter');
  await expect(palette).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Workspace directory', exact: true }).click();
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
});

test('appearance works offline and reports storage denial without disabling observation UI', async ({
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
  await settings(page);
  await expect(
    page.getByText('Appearance applies for this visit.', { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Turn completed', exact: true })).toBeDisabled();
  await page.getByRole('combobox', { name: 'Contrast', exact: true }).selectOption('high');
  await expect(page.locator('html')).toHaveAttribute('data-contrast', 'high');
  await page.getByRole('combobox', { name: 'Motion', exact: true }).selectOption('reduced');
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced');
  await page.getByRole('link', { name: 'Workspace directory', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-contrast', 'high');
});

test('malformed preferences use defaults and appearance changes synchronize between same-origin tabs', async ({
  page,
  context,
}) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('synthetic-storage-seeded')) {
      localStorage.setItem('orqst.appearance.v1', '{bad-json');
      sessionStorage.setItem('synthetic-storage-seeded', 'yes');
    }
  });
  await settings(page);
  await expect(page.getByRole('combobox', { name: 'Contrast', exact: true })).toHaveValue(
    'standard',
  );
  const other = await context.newPage();
  await settings(other);
  await page.getByRole('combobox', { name: 'Contrast', exact: true }).selectOption('high');
  await expect(other.getByRole('combobox', { name: 'Contrast', exact: true })).toHaveValue('high');
  await other.evaluate(() => localStorage.removeItem('orqst.appearance.v1'));
  await expect(page.getByRole('combobox', { name: 'Contrast', exact: true })).toHaveValue(
    'standard',
  );
  await other.close();
});

async function animationName(page: Page) {
  return page.locator('#settings-appearance').evaluate((heading) => {
    // Apply the real confirmed-metric cue to a disposable test element; no synthetic data enters runtime.
    const probe = document.createElement('span');
    probe.className = 'live-metric-updated';
    heading.append(probe);
    const animation = getComputedStyle(probe).animationName;
    probe.remove();
    return animation;
  });
}

test('both explicit and OS reduced motion suppress the real update cue while comfortable controls grow', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await settings(page);
  expect(await animationName(page)).toBe('live-metric-confirmed-update');
  await page.getByRole('combobox', { name: 'Motion', exact: true }).selectOption('reduced');
  expect(await animationName(page)).toBe('none');
  await page.getByRole('combobox', { name: 'Motion', exact: true }).selectOption('system');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(
    page.getByText('Your system requests reduced motion.', { exact: false }),
  ).toBeVisible();
  expect(await animationName(page)).toBe('none');
  await page.getByRole('combobox', { name: 'Spacing', exact: true }).selectOption('comfortable');
  const size = await page.getByRole('combobox', { name: 'Contrast', exact: true }).boundingBox();
  expect(size!.height).toBeGreaterThanOrEqual(40);
  await page.getByRole('combobox', { name: 'Contrast', exact: true }).selectOption('high');
  const muted = await page
    .locator('#settings-appearance + p')
    .evaluate((node) => getComputedStyle(node).color);
  expect(muted).toBe('rgb(217, 201, 255)');
});

test('notification preferences share confirmed values and rollback errors; bilingual Settings keep captures untranslated', async ({
  page,
}) => {
  let prefs: Preferences = { completed: true, failed: true, intervention: true, sound: false };
  let failSave = false;
  let writes = 0;
  await page.route('**/api/snapshot', async (route) => {
    const response = await route.fetch();
    const snapshot = (await response.json()) as Snapshot;
    snapshot.preferences = prefs;
    await route.fulfill({ response, json: snapshot });
  });
  await page.route('**/api/preferences', async (route) => {
    expect(route.request().method()).toBe('PUT');
    writes++;
    if (failSave) return route.fulfill({ status: 503, json: { error: 'synthetic-save-failure' } });
    prefs = route.request().postDataJSON() as Preferences;
    return route.fulfill({ json: prefs });
  });
  await settings(page);
  const completed = page.getByRole('checkbox', { name: 'Turn completed', exact: true });
  await expect(completed).toBeEnabled();
  await completed.uncheck();
  await expect(completed).toBeEnabled();
  await expect(completed).not.toBeChecked();
  expect(writes).toBe(1);
  await page.getByRole('button', { name: 'Notifications', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'Notifications', exact: true });
  await expect(
    drawer.getByRole('checkbox', { name: 'Turn completed', exact: true }),
  ).not.toBeChecked();
  await page.keyboard.press('Escape');
  failSave = true;
  await completed.check();
  await expect(page.getByRole('alert').filter({ hasText: 'Could not save' })).toBeVisible();
  await expect(completed).not.toBeChecked();
  const capturedTask = await page.evaluate(async () => {
    const snapshot = (await (await fetch('/api/snapshot')).json()) as Snapshot;
    return snapshot.sessions.find((session) => session.id === 'synthetic-browser-session')!.task!;
  });
  expect(capturedTask).toBeTruthy();
  await page
    .locator('.settings-group')
    .filter({ has: page.getByRole('heading', { name: 'General', exact: true }) })
    .getByRole('combobox')
    .selectOption('pt-BR');
  await expect(page.getByRole('heading', { name: 'Configurações', exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Contraste', exact: true })).toHaveValue(
    'standard',
  );
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Aparência e acessibilidade' })).toBeVisible();
  await page.goto('/#session=synthetic-browser-session');
  await expect(page.getByRole('region', { name: 'Detalhes da sessão' })).toContainText(
    capturedTask,
  );
});

test('Settings remain contained on desktop, laptop and mobile with both contrast and comfortable spacing', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await settings(page);
  await page.getByRole('combobox', { name: 'Spacing', exact: true }).selectOption('comfortable');
  await page.getByRole('combobox', { name: 'Contrast', exact: true }).selectOption('high');
  for (const width of [1440, 1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      window.scrollTo(0, 0);
    });
    await page.screenshot({
      path: test.info().outputPath(`orqst-settings-${width}.png`),
      fullPage: true,
    });
    await page.getByRole('button', { name: 'Reset appearance', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Reset appearance' });
    await expect(dialog).toBeVisible();
    expect((await dialog.boundingBox())!.width).toBeLessThanOrEqual(width);
    await page.keyboard.press('Escape');
  }
  await page
    .locator('.settings-group')
    .getByRole('combobox', { name: 'Language', exact: true })
    .selectOption('pt-BR');
  await expect(page.getByRole('heading', { name: 'Privacidade e armazenamento' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    window.scrollTo(0, 0);
  });
  await page.screenshot({
    path: test.info().outputPath('orqst-settings-mobile-pt.png'),
    fullPage: true,
  });
});

test('comfortable appearance carries across observed-data views without changing confirmed metrics', async ({
  page,
}) => {
  await settings(page);
  await page.getByRole('combobox', { name: 'Spacing', exact: true }).selectOption('comfortable');
  await page.getByRole('combobox', { name: 'Contrast', exact: true }).selectOption('high');
  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    for (const view of ['workspaces', 'agents', 'models', 'session=synthetic-browser-session']) {
      await page.goto(`/#${view}`);
      await expect(page.locator('html')).toHaveAttribute('data-density', 'comfortable');
      await expect(page.locator('html')).toHaveAttribute('data-contrast', 'high');
      if (view.startsWith('session=')) {
        const badge = page.locator('.session-token-badge');
        // Other browser specs append synthetic records; compare the current authenticated reading.
        const metrics = await page.evaluate(
          async () =>
            (await (
              await fetch('/api/sessions/synthetic-browser-session/metrics')
            ).json()) as SessionMetricsResult,
        );
        expect(metrics.availability).toBe('available');
        if (metrics.availability !== 'available') throw new Error('Synthetic metrics unavailable');
        const number = new Intl.NumberFormat('en-US');
        await expect(badge.locator('strong')).toHaveText(number.format(metrics.value.usage.total));
        await badge.locator('summary').click();
        await expect(badge.locator('dd')).toHaveText(
          [metrics.value.usage.input, metrics.value.usage.output, metrics.value.usage.cached].map(
            (value) => number.format(value),
          ),
        );
        await expect(page.getByRole('region', { name: 'Session details' })).toBeVisible();
      } else {
        await expect(
          page.locator('.workspace-directory, .adapter-panel, .analytics').first(),
        ).toBeVisible();
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
    }
  }
});
