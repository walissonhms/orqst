import { test, expect, type Page } from '@playwright/test';

async function settings(page: Page) {
  await page.goto('/#settings');
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
}
const themeSelect = (page: Page) => page.getByRole('combobox', { name: 'Theme', exact: true });

async function contained(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    page.viewportSize()!.width,
  );
}

test('old appearance preferences retain dark mode, reading choices and actual native control scheme', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('synthetic-theme-seeded')) {
      localStorage.setItem(
        'orqst.appearance.v1',
        JSON.stringify({ contrast: 'high', contentSize: 'large', contentFont: 'mono' }),
      );
      sessionStorage.setItem('synthetic-theme-seeded', 'yes');
    }
  });
  await settings(page);
  await expect(themeSelect(page)).toHaveValue('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'dark');
  await expect(page.getByRole('combobox', { name: 'Captured text font', exact: true })).toHaveValue(
    'mono',
  );
  await themeSelect(page).selectOption('light');
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'light');
  await expect(themeSelect(page)).toHaveCSS('color-scheme', 'light');
  await page.reload();
  await expect(themeSelect(page)).toHaveValue('light');
  await expect(page.locator('html')).toHaveAttribute('data-content-size', 'large');
  await expect(page.locator('html')).toHaveAttribute('data-contrast', 'high');
});

test('system appearance follows live media changes only when selected without overwriting the choice', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await settings(page);
  await themeSelect(page).selectOption('system');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  const stored = await page.evaluate(() => localStorage.getItem('orqst.appearance.v1'));
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await page.evaluate(() => localStorage.getItem('orqst.appearance.v1'))).toBe(stored);
  await page.reload();
  await expect(themeSelect(page)).toHaveValue('system');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await themeSelect(page).selectOption('dark');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await themeSelect(page).selectOption('light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('cross-tab changes and scoped reset preserve focus, language and workspace preferences', async ({
  page,
  context,
}) => {
  await settings(page);
  const other = await context.newPage();
  await settings(other);
  await page.bringToFront();
  await themeSelect(page).focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('combobox', { name: 'Contrast', exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(themeSelect(page)).toBeFocused();
  await themeSelect(page).selectOption('light');
  await expect(themeSelect(page)).toHaveValue('light');
  await expect(themeSelect(page)).toBeFocused();
  await expect(other.locator('html')).toHaveAttribute('data-theme', 'light');
  const shell = await page.evaluate(() => localStorage.getItem('orqst.shell.v1'));
  const language = await page.evaluate(() => localStorage.getItem('i18nextLng'));
  const reset = page.getByRole('button', { name: 'Reset appearance', exact: true });
  await reset.click();
  const dialog = page.getByRole('dialog', { name: 'Reset appearance', exact: true });
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(reset).toBeFocused();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await reset.click();
  await dialog.getByRole('button', { name: 'Restore appearance defaults', exact: true }).click();
  await expect(reset).toBeFocused();
  await expect(other.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await page.evaluate(() => localStorage.getItem('orqst.shell.v1'))).toBe(shell);
  expect(await page.evaluate(() => localStorage.getItem('i18nextLng'))).toBe(language);
  await other.evaluate(() => localStorage.setItem('orqst.appearance.v1', '{malformed'));
  await expect(themeSelect(page)).toHaveValue('dark');
  await themeSelect(page).selectOption('light');
  await other.evaluate(() => localStorage.removeItem('orqst.appearance.v1'));
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await other.close();
});

test('theme remains available offline with denied storage and localized labels', async ({
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
  await themeSelect(page).selectOption('light');
  await expect(
    page.getByText('Appearance applies for this visit.', { exact: false }),
  ).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page
    .locator('.settings-group')
    .getByRole('combobox', { name: 'Language', exact: true })
    .selectOption('pt-BR');
  const select = page.getByRole('combobox', { name: 'Tema', exact: true });
  await expect(select).toHaveValue('light');
  await expect(select.getByRole('option', { name: 'Claro', exact: true })).toHaveCount(1);
  await select.selectOption('system');
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('link', { name: 'Diretório de workspaces', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

// Resolve real CSS (including color-mix), not a duplicate hardcoded palette.
async function palette(page: Page) {
  return page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d')!;
    const luminance = (token: string) => {
      ctx.fillStyle = style.getPropertyValue(`--orqst-${token}`).trim();
      ctx.fillRect(0, 0, 1, 1);
      const rgb = Array.from(ctx.getImageData(0, 0, 1, 1).data).slice(0, 3);
      const [r = 0, g = 0, b = 0] = rgb.map((byte) => {
        const value = byte / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    return Object.fromEntries(
      [
        'background',
        'surface',
        'elevated',
        'text',
        'muted',
        'neon',
        'lavender',
        'success',
        'warning',
        'danger',
        'border-strong',
        'on-primary',
        'primary',
        'primary-hover',
        'success-soft',
        'warning-soft',
        'danger-soft',
        'accent-soft',
        'border',
      ].map((token) => [token, luminance(token)]),
    );
  });
}
function ratio(a: number, b: number) {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

test('light text, semantic states, controls and focus retain AA contrast in both contrast modes', async ({
  page,
}) => {
  await settings(page);
  await themeSelect(page).selectOption('light');
  let standardMuted = 0;
  for (const contrast of ['standard', 'high']) {
    await page.getByRole('combobox', { name: 'Contrast', exact: true }).selectOption(contrast);
    const colors = await palette(page);
    for (const surface of ['background', 'surface', 'elevated']) {
      for (const token of ['text', 'muted', 'neon', 'lavender', 'success', 'warning', 'danger']) {
        expect(
          ratio(colors[token]!, colors[surface]!),
          `${contrast}: ${token} on ${surface}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
      for (const token of ['border-strong', 'neon']) {
        expect(
          ratio(colors[token]!, colors[surface]!),
          `${token} boundary on ${surface}`,
        ).toBeGreaterThanOrEqual(3);
      }
    }
    for (const token of ['success', 'warning', 'danger']) {
      expect(ratio(colors[token]!, colors[`${token}-soft`]!)).toBeGreaterThanOrEqual(4.5);
    }
    expect(ratio(colors.lavender!, colors['accent-soft']!)).toBeGreaterThanOrEqual(4.5);
    for (const token of ['primary', 'primary-hover']) {
      expect(ratio(colors['on-primary']!, colors[token]!)).toBeGreaterThanOrEqual(4.5);
    }
    const muted = ratio(colors.muted!, colors.surface!);
    if (contrast === 'standard') standardMuted = muted;
    else {
      expect(muted).toBeGreaterThan(standardMuted);
      expect(ratio(colors.border!, colors.surface!)).toBeGreaterThanOrEqual(3);
    }
  }
  await themeSelect(page).focus();
  await expect(themeSelect(page)).toHaveCSS('outline-style', 'solid');
  await expect(themeSelect(page)).toHaveCSS('outline-width', '2px');
});

test('light theme covers real views and source text at desktop, laptop and mobile widths', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await settings(page);
  await themeSelect(page).selectOption('light');
  await page.getByRole('combobox', { name: 'Contrast', exact: true }).selectOption('high');
  await page.getByRole('combobox', { name: 'Spacing', exact: true }).selectOption('comfortable');
  for (const label of ['Interface text size', 'Captured text size']) {
    await page.getByRole('combobox', { name: label, exact: true }).selectOption('extra-large');
  }
  for (const width of [1440, 1280, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    for (const view of ['settings', 'workspaces', 'agents', 'models']) {
      await page.goto(`/#${view}`);
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
      await expect(page.locator('main h1')).toBeVisible();
      if (view === 'settings') {
        await page
          .getByRole('combobox', { name: 'Contrast', exact: true })
          .selectOption(width === 1440 ? 'standard' : 'high');
      }
      if (view === 'models') {
        await expect(
          page.getByRole('region', { name: 'Model ranking', exact: true }).first(),
        ).toBeVisible();
      }
      await contained(page);
      if ((width === 1280 && view === 'models') || (width === 390 && view === 'settings')) {
        await page.screenshot({
          path: test.info().outputPath(`light-${view}-${width}.png`),
          fullPage: true,
        });
      }
    }
    await page.goto('/#session=synthetic-browser-session');
    await expect(page.getByRole('region', { name: 'Session details', exact: true })).toBeVisible();
    await contained(page);
    if (width === 1440) {
      await page.screenshot({
        path: test.info().outputPath('light-overview-1440.png'),
        fullPage: true,
      });
    }
  }
  await page
    .getByRole('button', { name: 'Extract artifact manually', exact: true })
    .first()
    .click();
  const panel = page.getByRole('region', { name: 'Manual artifact', exact: true });
  const original = await panel.locator('pre.artifact-content').textContent();
  await panel.getByRole('button', { name: 'Edit draft', exact: true }).click();
  const editor = panel.getByRole('textbox');
  await expect(editor).toHaveValue(original!);
  await expect(editor).toHaveCSS('color-scheme', 'light');
  await editor.fill('Synthetic light draft — <script>window.orqstInjected=true</script>\n');
  await contained(page);
  await panel
    .getByRole('button', { name: 'Close artifact and discard draft', exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Discard artifact draft?', exact: true });
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await contained(page);
  await page.screenshot({
    path: test.info().outputPath('light-artifact-dialog-320.png'),
    fullPage: false,
  });
  await page.keyboard.press('Escape');
  await expect(editor).toHaveValue(
    'Synthetic light draft — <script>window.orqstInjected=true</script>\n',
  );
  expect(await page.evaluate(() => Reflect.get(window, 'orqstInjected'))).toBeUndefined();
});
