import { test, expect, type Page } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

// Disposable synthetic sources only. Each test owns a unique session file.
async function source(name: string, model?: string): Promise<{ file: string; id: string }> {
  const { file } = JSON.parse(await readFile(process.env.ORQST_BROWSER_STATE!, 'utf8')) as {
    file: string;
  };
  const id = `synthetic-model-qa-${name}`;
  const path = join(dirname(file), `synthetic-model-qa-${name}.jsonl`);
  const time = new Date(Date.now() - 20000).toISOString();
  const line = (type: string, payload: unknown) =>
    JSON.stringify({ type, payload, timestamp: time }) + '\n';
  await writeFile(
    path,
    line('session_meta', {
      id,
      cwd: `/synthetic/model-qa-${name}`,
      agent_nickname: 'Synthetic QA',
    }) + (model === undefined ? '' : line('turn_context', { model })),
  );
  return { file: path, id };
}

async function openModel(page: Page, id: string) {
  await page.goto(`/#session=${id}`);
  await expect(page.getByRole('region', { name: 'Session details', exact: true })).toBeVisible();
  const block = page.locator('.session-model');
  await expect(block).toBeVisible();
  return block;
}

async function sessionSnapshot(page: Page, id: string) {
  return page.evaluate(async (sessionId) => {
    const response = await fetch('/api/snapshot', { credentials: 'same-origin' });
    const body = (await response.json()) as {
      sessions: Array<Record<string, unknown> & { id: string }>;
    };
    return body.sessions.find((session) => session.id === sessionId)!;
  }, id);
}

test('the observed identifier carries no time, control or usage claim', async ({ page }) => {
  const { id } = await source('plain', 'synthetic-qa-model');
  const block = await openModel(page, id);
  await expect(block).toContainText('Observed model identifier: synthetic-qa-model');
  await expect(block.locator('time')).toHaveCount(0);
  await expect(block.locator('select, input, button')).toHaveCount(0);
  await expect(block.locator('[role="combobox"], [role="listbox"], [role="option"]')).toHaveCount(
    0,
  );

  // No timestamp of any kind, and lastActivity is never presented as the model time.
  const session = await sessionSnapshot(page, id);
  const text = (await block.innerText()).replace(/\s+/g, ' ');
  expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  expect(text).not.toContain(String(session.lastActivity));
  expect(text).not.toMatch(/provider|price|cost|tokens?/i);

  // Discovery limits are explicit and the payload was not expanded for this slice.
  await block.getByText('Model evidence limits', { exact: true }).click();
  await expect(block).toContainText('The model observation time is unavailable');
  await expect(block).toContainText('may differ from the latest model in the source');
  await expect(block).toContainText(
    'Model discovery is not implemented. Availability, capabilities and selection have not been verified.',
  );
  expect(Object.keys(session).sort()).toEqual(
    [
      'adapter',
      'agentName',
      'cwd',
      'id',
      'lastActivity',
      'manualWorkspace',
      'model',
      'parentSessionId',
      'result',
      'startedAt',
      'status',
      'task',
      'usage',
      'workspaceId',
    ].sort(),
  );
});

test('hostile identifiers stay inert without request URL or browser storage copies', async ({
  page,
}) => {
  const secret = 'sk-live-SECRET-abc123';
  const hostile = `<img src=x onerror="window.orqstQaInjected=true">[x](javascript:alert) ${secret}`;
  const { id } = await source('hostile', hostile);
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  const block = await openModel(page, id);
  const code = block.locator('code');
  await expect(code).toHaveText(hostile);
  // The value is plain React text: no element is created from it.
  await expect(code.locator('*')).toHaveCount(0);
  await expect(block.locator('img, script, a, iframe, object, embed')).toHaveCount(0);
  expect(
    await page.evaluate(() => (window as unknown as { orqstQaInjected?: boolean }).orqstQaInjected),
  ).toBeUndefined();
  // No extra browser storage copy or identifier in request URLs; the source remains historical data.
  expect(requests.some((url) => url.includes('SECRET'))).toBe(false);
  const storage = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  expect(storage.includes('SECRET')).toBe(false);
});

test('a missing model is explicitly not recorded, not a default model', async ({ page }) => {
  const { id } = await source('absent');
  const block = await openModel(page, id);
  await expect(block.locator('code')).toHaveText('Not recorded');
  await expect(block).not.toContainText('synthetic-qa-model');
  await expect(block.locator('select, input, button, time')).toHaveCount(0);
});

test('the observation limits are localized in pt-BR', async ({ page }) => {
  const { id } = await source('localized', 'synthetic-qa-model');
  const block = await openModel(page, id);
  await page.getByLabel('Language', { exact: true }).selectOption('pt-BR');
  await expect(block).toContainText('Identificador de modelo observado: synthetic-qa-model');
  await block.getByText('Limites da evidência de modelo', { exact: true }).click();
  await expect(block).toContainText('O horário da observação do modelo está indisponível');
  await expect(block).toContainText(
    'A descoberta de modelos não está implementada. Disponibilidade, capacidades e seleção não foram verificadas.',
  );
  await page.getByLabel('Idioma', { exact: true }).selectOption('en-US');
});
