import { test, expect, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { resolve } from 'node:path';
import type { Preferences, SessionMetricsResult, Snapshot } from '@orqst/protocol';
import { changeLanguage, openAppearance, settingsTabs } from '../helpers/spec-dashboard.js';

async function settings(page: Page) {
  await page.goto('/#settings');
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await openAppearance(page);
}

test('Settings navigation, appearance persistence and scoped reset preserve keyboard ownership', async ({
  page,
}) => {
  await page.goto('/#workspaces');
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page).toHaveURL(/\/configuracoes$/);
  await openAppearance(page);
  await page.getByRole('combobox', { name: 'Contrast', exact: true }).selectOption('high');
  await page.getByRole('combobox', { name: 'Spacing', exact: true }).selectOption('comfortable');
  await page.getByRole('combobox', { name: 'Motion', exact: true }).selectOption('reduced');
  await page.reload();
  await openAppearance(page);
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
  await page.getByRole('link', { name: 'Overview', exact: true }).click();
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await openAppearance(page);
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

  await page.getByRole('combobox', { name: 'Contrast', exact: true }).selectOption('high');
  await expect(page.locator('html')).toHaveAttribute('data-contrast', 'high');
  await page.getByRole('combobox', { name: 'Motion', exact: true }).selectOption('reduced');
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced');
  await page.getByRole('link', { name: 'Overview', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-contrast', 'high');
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await settingsTabs(page).getByRole('button', { name: 'Notifications', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Turn completed', exact: true })).toBeDisabled();
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
  return page.locator('#settings-tab-title').evaluate((heading) => {
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
  await expect(page.getByRole('combobox', { name: 'Motion' })).toHaveAttribute(
    'title',
    /system requests reduced motion/i,
  );
  expect(await animationName(page)).toBe('none');
  await page.getByRole('combobox', { name: 'Spacing', exact: true }).selectOption('comfortable');
  const size = await page.getByRole('combobox', { name: 'Contrast', exact: true }).boundingBox();
  expect(size!.height).toBeGreaterThanOrEqual(40);
  await page.getByRole('combobox', { name: 'Contrast', exact: true }).selectOption('high');
  const muted = await page.locator('.spec-settings-content').evaluate((node) => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--spec-muted)';
    node.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  });
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
  await settingsTabs(page).getByRole('button', { name: 'Notifications', exact: true }).click();
  const completed = page.getByRole('checkbox', { name: 'Turn completed', exact: true });
  await expect(completed).toBeEnabled();
  await completed.uncheck();
  await expect(completed).toBeEnabled();
  await expect(completed).not.toBeChecked();
  expect(writes).toBe(1);
  await page
    .locator('#app-sidebar')
    .getByRole('button', { name: 'Notifications', exact: true })
    .click();
  const drawer = page.getByRole('dialog', { name: 'Notifications', exact: true });
  await expect(
    drawer.getByRole('checkbox', { name: 'Turn completed', exact: true }),
  ).not.toBeChecked();
  await page.keyboard.press('Escape');
  failSave = true;
  await completed.check();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Preference change unconfirmed.' }),
  ).toBeVisible();
  await expect(completed).not.toBeChecked();
  const capturedTask = await page.evaluate(async () => {
    const snapshot = (await (await fetch('/api/snapshot')).json()) as Snapshot;
    return snapshot.sessions.find((session) => session.id === 'synthetic-browser-session')!.task!;
  });
  expect(capturedTask).toBeTruthy();
  await changeLanguage(page, 'pt-BR');
  await openAppearance(page);
  await expect(page.getByRole('heading', { name: 'Configurações', exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Contraste', exact: true })).toHaveValue(
    'standard',
  );
  await page.reload();
  await openAppearance(page);
  await expect(page.getByRole('heading', { name: 'Aparência', exact: true })).toBeVisible();
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
  await changeLanguage(page, 'pt-BR');
  await openAppearance(page);
  await settingsTabs(page).getByRole('button', { name: 'Privacidade e dados' }).click();
  await expect(page.getByRole('heading', { name: 'Privacidade e dados' })).toBeVisible();
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
      } else if (view === 'workspaces') {
        await expect(page.locator('.workspace-directory')).toBeVisible();
      } else {
        await expect(
          page.getByRole('heading', {
            name: view === 'agents' ? 'Agents' : 'Metrics',
            exact: true,
          }),
        ).toBeVisible();
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
    }
  }
});

for (const locale of ['en-US', 'pt-BR'] as const) {
  test.describe(`V6 settings in ${locale}`, () => {
    test.use({ locale, colorScheme: 'dark', reducedMotion: 'reduce' });

    test('opens settings from Studio through Overview and restores reset focus', async ({
      page,
    }) => {
      await page.addInitScript(() => {
        // Dashboard Studio routing uses the native facade when present.
        Reflect.set(window, 'orqstFeatures', {
          contractVersion: 1,
          request: async () => ({ status: 'unavailable' }),
        });
      });
      const portuguese = locale === 'pt-BR';
      const sizes = portuguese
        ? [
            [1440, 900],
            [1280, 800],
          ]
        : [[1440, 900]];
      for (const [width, height] of sizes) {
        await page.setViewportSize({ width: width!, height: height! });
        await page.goto('/studio');
        await page
          .getByRole('link', { name: portuguese ? 'Visão geral' : 'Overview', exact: true })
          .click();
        await expect(page).toHaveURL(/\/visao-geral$/);
        await page
          .getByRole('link', { name: portuguese ? 'Configurações' : 'Settings', exact: true })
          .click();
        await expect(page).toHaveURL(/\/configuracoes$/);
        const capture = (name: string) =>
          page.screenshot({
            path: test.info().outputPath(`${width}x${height}`, 'observer', `${name}.png`),
          });
        await openAppearance(page);
        const resetLabel = portuguese ? 'Redefinir aparência' : 'Reset appearance';
        const reset = page.getByRole('button', { name: resetLabel, exact: true });
        await expect(reset).toBeVisible();
        await capture('settings');
        await reset.click();
        const dialog = page.getByRole('dialog', { name: resetLabel });
        await expect(
          dialog.getByRole('button', { name: portuguese ? 'Cancelar' : 'Cancel' }),
        ).toBeFocused();
        await capture('settings-reset');
        await page.keyboard.press('Tab');
        await expect(dialog.getByRole('button').last()).toBeFocused();
        await page.keyboard.press('Shift+Tab');
        await expect(dialog.getByRole('button').first()).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(reset).toBeFocused();
        await page.goBack();
        await expect(page).toHaveURL(/\/visao-geral$/);
        await page.goBack();
        await expect(page).toHaveURL(/\/studio$/);
      }
    });
  });
}

for (const [locale, width, height] of [
  ['en-US', 1440, 900],
  ['pt-BR', 1440, 900],
  ['pt-BR', 1280, 800],
] as const) {
  test(`native Feature chrome keeps limit evidence and thresholds distinct in ${locale} at ${width}×${height}`, async ({
    browser,
  }) => {
    const bundle = await build({
      stdin: {
        contents: `
        import { mountFeatureWorkspace } from './src/feature-workspace-mount.tsx';
        mountFeatureWorkspace();
      `,
        resolveDir: resolve('apps/dashboard'),
        loader: 'tsx',
      },
      bundle: true,
      platform: 'browser',
      format: 'iife',
      target: 'safari17',
      outdir: 'out',
      write: false,
      logLevel: 'silent',
    });
    const snapshot = {
      contractVersion: 1,
      storage: 'core',
      generation: 7,
      workspace: { id: 'synthetic-lane5-workspace', name: 'Synthetic workspace' },
      features: [
        {
          featureId: '00000000-0000-4000-8000-000000000005',
          workspaceId: 'synthetic-lane5-workspace',
          name: 'Synthetic Feature',
          description: '',
          status: 'active',
          revision: 1,
          terminalIds: [11, 12, 13, 14].map((id) => `00000000-0000-4000-8000-0000000000${id}`),
          schemaVersion: 1,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      activeFeatureId: '00000000-0000-4000-8000-000000000005',
      slots: (['codex', 'claude', 'opencode', 'codex'] as const).map((provider, slot) => ({
        slot,
        provider,
        terminalId: `00000000-0000-4000-8000-0000000000${11 + slot}`,
      })),
      layoutSaved: true,
    };

    const portuguese = locale === 'pt-BR';
    const unknown = portuguese ? '— sem dados da CLI' : '— no CLI data';
    const page = await browser.newPage({
      locale,
      colorScheme: 'dark',
      reducedMotion: 'reduce',
      viewport: { width, height },
    });
    try {
      await page.setContent('<div id="root"></div>');
      const mount = async (withReport: boolean) => {
        await page.evaluate(
          ({ snapshot, withReport }) => {
            const now = Date.now();
            Reflect.set(window, 'orqstFeatures', {
              contractVersion: 1,
              request: async () => ({
                status: 'ok',
                snapshot,
                ...(withReport
                  ? {
                      accountLimits: {
                        readAt: now,
                        accounts: [
                          {
                            id: 'synthetic-claude',
                            provider: 'claude',
                            index: 1,
                            locked: false,
                            windows: [],
                          },
                          {
                            id: 'synthetic-codex',
                            provider: 'codex',
                            index: 1,
                            locked: false,
                            updatedAt: now,
                            windows: [
                              {
                                id: 'synthetic-week',
                                label: '7d',
                                usedPercent: 45,
                                resetsAt: now + 3600000,
                              },
                              { id: 'synthetic-zero', label: '1d', usedPercent: 0 },
                              { id: 'synthetic-unknown', label: '1h', resetsAt: now + 1200000 },
                              {
                                id: 'synthetic-expired',
                                label: '5h',
                                usedPercent: 99,
                                resetsAt: now - 1000,
                              },
                            ],
                          },
                        ],
                      },
                    }
                  : {}),
              }),
              arrange: async () => ({ status: 'ok', snapshot }),
            });
          },
          { snapshot, withReport },
        );
        for (const file of bundle.outputFiles) {
          if (file.path.endsWith('.css')) await page.addStyleTag({ content: file.text });
          else await page.addScriptTag({ content: file.text });
        }
        await expect(page.locator('.al-trigger')).toBeVisible();
      };
      const capture = (name: string) =>
        page.screenshot({
          path: test.info().outputPath(locale, `${width}x${height}`, 'tauri-chrome', `${name}.png`),
        });
      const trigger = page.locator('.al-trigger');
      const dialog = page.getByRole('dialog', {
        name: portuguese ? 'Limites das contas' : 'Account limits',
      });
      const close = dialog.getByRole('button', {
        name: portuguese ? 'Fechar' : 'Close',
        exact: true,
      });
      const accounts = dialog.getByRole('button', {
        name: portuguese ? 'Escolher contas' : 'Choose accounts',
      });
      const caps = dialog.getByRole('button', {
        name: portuguese ? 'Ajustar tetos' : 'Adjust caps',
      });

      await mount(false);
      await trigger.click();
      await expect(close).toBeFocused();
      await expect(dialog).toContainText(unknown);
      await expect(dialog.locator('.al-bar, .al-percent, .al-reset')).toHaveCount(0);
      await expect(accounts).toHaveCount(0);
      await expect(caps).toHaveCount(0);
      await capture('24-limits-unavailable');
      await page.keyboard.press('Shift+Tab');
      await expect(close).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(trigger).toBeFocused();

      // Replace only the disposable fixture document before supplying provider evidence.
      await page.goto('about:blank');
      await page.setContent('<div id="root"></div>');
      await mount(true);
      await trigger.click();
      await expect(dialog.locator('.al-percent')).toHaveText([
        '45%',
        portuguese ? 'Sem uso' : 'Unused',
      ]);
      await expect(
        dialog.locator('.al-window').filter({ has: page.getByText('1h', { exact: true }) }),
      ).toContainText(unknown);
      await expect(
        dialog.locator('.al-window').filter({ has: page.getByText('5h', { exact: true }) }),
      ).toContainText(portuguese ? 'janela encerrada' : 'window ended');
      await capture('19-limits');
      await expect(accounts).toHaveCount(0);
      await expect(caps).toHaveCount(0);
      await page.keyboard.press('Escape');
      await expect(trigger).toBeFocused();
    } finally {
      await page.close();
    }
  });
}
