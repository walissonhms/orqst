import { test, expect } from '@playwright/test';

// Synthetic Desktop facade. No provider or native authority exists in this browser test.
test('Studio preparation guides EN/PT, keeps denied actions visible and opens reviewed panels', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const snapshot = {
      count: 0,
      limit: 2,
      opened: false,
      prepared: false,
      canCreate: true,
      canSelect: true,
      busy: false,
    };
    Reflect.set(window, 'studioCalls', []);
    Reflect.set(window, 'studioStatus', 'ok');
    Object.defineProperty(window, 'orqstStudio', {
      value: {
        contractVersion: 1,
        async request({ action }: { action: string }) {
          (Reflect.get(window, 'studioCalls') as string[]).push(action);
          const status = Reflect.get(window, 'studioStatus');
          if (status !== 'ok') return { status };
          if (action === 'createMixed') {
            snapshot.count = 2;
            snapshot.canCreate = false;
          }
          if (action === 'open') {
            snapshot.opened = true;
            snapshot.canSelect = false;
          }
          return { status, snapshot: { ...snapshot } };
        },
      },
    });
  });
  await page.goto('/studio');
  await expect(page.getByRole('heading', { name: 'Terminals / Studio' })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Open reviewed terminals', exact: true }),
  ).toBeDisabled();
  await page.getByRole('combobox', { name: 'Language' }).selectOption('pt-BR');
  await page.evaluate(() => Reflect.set(window, 'studioStatus', 'focus_required'));
  await page.getByRole('button', { name: 'Preparar Codex + OpenCode…', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Clique na página do Studio' }),
  ).toBeVisible();
  await page.evaluate(() => Reflect.set(window, 'studioStatus', 'ok'));
  await page.getByRole('button', { name: 'Preparar Codex + OpenCode…', exact: true }).click();
  await expect(page.getByText('Seleção revisada', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Abrir terminais revisados', exact: true }).click();
  await expect(page.getByText('Painéis disponíveis', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Voltar aos terminais', exact: true }),
  ).toBeEnabled();
  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole('heading', { name: 'Terminais / Studio' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: `/private/tmp/orqst-675-studio-${width}.png`, fullPage: true });
  }
  expect(await page.evaluate(() => Reflect.get(window, 'studioCalls'))).toEqual([
    'snapshot',
    'createMixed',
    'createMixed',
    'open',
  ]);
});

test('Studio distinguishes browser from older Desktop and offers no fake terminal controls', async ({
  page,
}) => {
  await page.goto('/studio');
  await expect(page.getByText('Terminal preparation is available', { exact: false })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Prepare Codex + OpenCode…', exact: true }),
  ).toBeDisabled();
  await page.addInitScript(() =>
    Object.defineProperty(window, 'orqstManagedAgents', { value: { contractVersion: 1 } }),
  );
  await page.reload();
  await expect(page.getByText('This Desktop is running an older', { exact: false })).toBeVisible();
  await page.getByRole('combobox', { name: 'Language' }).selectOption('pt-BR');
  await expect(
    page.getByText('Este Desktop está com a interface anterior', { exact: false }),
  ).toBeVisible();
});
