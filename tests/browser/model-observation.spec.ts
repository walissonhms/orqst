// Disposable synthetic source -> observer -> API/WS -> shared browser/Desktop header.
import { test, expect } from '@playwright/test';
import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

test('model identifiers stay historical, unavailable discovery stays explicit, and hostile text is inert', async ({
  page,
}) => {
  const { file } = JSON.parse(await readFile(process.env.ORQST_BROWSER_STATE!, 'utf8')) as {
    file: string;
  };
  const source = join(dirname(file), 'synthetic-model-observation.jsonl');
  const id = 'synthetic-model-observation';
  const time = new Date(Date.now() - 20000).toISOString();
  const line = (type: string, payload: unknown, timestamp = time) =>
    JSON.stringify({ type, payload, timestamp }) + '\n';
  await writeFile(
    source,
    line('session_meta', {
      id,
      cwd: '/synthetic/model-observation',
      agent_nickname: 'Synthetic Model Observation',
    }),
  );
  await page.goto(`/#session=${id}`);
  const session = page.getByRole('region', { name: 'Session details', exact: true });
  await expect(session).toBeVisible();
  // The session region's accessible name changes when switching language.
  const model = page.locator('.session-model');
  await expect(model).toContainText('Observed model identifier: Not recorded');
  await expect(model.locator('time')).toHaveCount(0);
  await model.getByText('Model evidence limits', { exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(model.locator('details')).toHaveAttribute('open', '');
  await expect(model).toContainText('The model observation time is unavailable');
  await expect(model).toContainText(
    'Availability, capabilities and selection have not been verified.',
  );
  await expect(model.locator('select, input, button, a, time')).toHaveCount(0);
  const hostile = '<img src=x onerror="window.orqstModelInjected=true">synthetic-model';
  await appendFile(source, line('turn_context', { model: hostile }));
  await expect(model.locator('code')).toHaveText(hostile);
  await expect(model.locator('img, script')).toHaveCount(0);
  expect(await page.evaluate(() => Reflect.get(window, 'orqstModelInjected'))).toBeUndefined();
  await appendFile(
    source,
    line('turn_context', { model: 'synthetic-next-model' }, new Date().toISOString()),
  );
  await expect(model.locator('code')).toHaveText('synthetic-next-model');
  await expect(model).toContainText('Observed model identifier');
  await expect(model).toContainText('Model discovery is not implemented.');
  await page.getByLabel('Language', { exact: true }).selectOption('pt-BR');
  await expect(model).toContainText('Identificador de modelo observado');
  await expect(model).toContainText(
    'Disponibilidade, capacidades e seleção não foram verificadas.',
  );
  await expect(model.getByText('Limites da evidência de modelo', { exact: true })).toBeVisible();
  await page.reload();
  // Session links are intentionally consumed; reopen it to check the persisted locale.
  await page.goto(`/#session=${id}`);
  await expect(model).toContainText('Identificador de modelo observado');
  await model.getByText('Limites da evidência de modelo', { exact: true }).click();
  await expect(model).toContainText('O horário da observação do modelo está indisponível');
  await page.getByLabel('Idioma', { exact: true }).selectOption('en-US');
  await page.setViewportSize({ width: 390, height: 844 });
  await appendFile(
    source,
    line('turn_context', { model: 'synthetic-long-model-'.repeat(100) }, new Date().toISOString()),
  );
  await expect(model.locator('code')).toHaveText('synthetic-long-model-'.repeat(100));
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
});
