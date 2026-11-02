import { test, expect } from '@playwright/test';

// Synthetic capability only: this checks view integration; Electron smoke checks real IPC.
test('native capability waits for reading acknowledgment and reports consumed save in both locales', async ({
  page,
}) => {
  await page.addInitScript(() => {
    let generation = 0;
    const capability: NonNullable<Window['orqstAnalytics']> = {
      contractVersion: 1,
      async setReading(reading) {
        const current = ++generation;
        Reflect.set(window, 'syntheticReading', reading);
        return { generation: current, status: 'acknowledged' };
      },
      async save(format, current, reading) {
        Reflect.set(window, 'syntheticSave', { format, generation: current, reading });
        return { status: 'saved' };
      },
    };
    Object.defineProperty(window, 'orqstAnalytics', { value: capability });
  });
  await page.goto('/#models');
  const section = page.locator('.analytics-export');
  const csv = section.getByRole('button', { name: 'Export CSV', exact: true });
  await expect(section.getByText(/Observed model IDs are arbitrary metadata/)).toBeVisible();
  await expect(csv).toBeEnabled();
  await csv.click();
  await expect(section.getByRole('status')).toHaveText('Report saved. Refresh for another export.');
  await expect(csv).toBeDisabled();
  await page.getByLabel('Rank by').selectOption('sessions');
  await expect(csv).toBeDisabled();
  await expect(section.getByText(/A new current reading is required/)).toBeVisible();
  const saved = await page.evaluate(() => Reflect.get(window, 'syntheticSave'));
  expect(Object.keys(saved).sort()).toEqual(['format', 'generation', 'reading']);
  expect(saved.format).toBe('csv');
  expect(Object.keys(saved.reading).sort()).toEqual([
    'cursor',
    'digest',
    'obtainedAt',
    'query',
    'ranking',
    'readingId',
  ]);
  expect(saved.reading.digest).toMatch(/^[a-f0-9]{64}$/);
  await expect(section.locator('a[download]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(csv).toBeEnabled();
  await page.getByRole('combobox', { name: 'Language' }).selectOption('pt-BR');
  await section.getByRole('button', { name: 'Exportar Markdown', exact: true }).click();
  await expect(section.getByRole('status')).toHaveText(
    'Relatório salvo. Atualize para exportar novamente.',
  );
  await expect(section.getByRole('button', { name: 'Exportar CSV', exact: true })).toBeDisabled();
});
