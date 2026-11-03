// Synthetic sessions, isolated observer/storage and a test-only browser listener.
import { test, expect } from '@playwright/test';
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

async function source(name: string, model?: string) {
  const { file } = JSON.parse(await readFile(process.env.ORQST_BROWSER_STATE!, 'utf8')) as {
    file: string;
  };
  const id = `synthetic-model-history-${name}`;
  const path = join(dirname(file), id + '.jsonl');
  const line = (type: string, payload: unknown) =>
    JSON.stringify({ type, payload, timestamp: new Date().toISOString() }) + '\n';
  await writeFile(
    path,
    line('session_meta', {
      id,
      cwd: '/synthetic/model-history',
      agent_nickname: 'Synthetic history',
    }) +
      line('token_usage_record', { thread_token_usage: { input_tokens: 1, output_tokens: 0 } }) +
      (model === undefined
        ? ''
        : line('turn_context', { model }) + line('event_msg', { type: 'task_started' })),
  );
  return { id, path, line };
}

test('real observer history is partial, lazy, nullable, inert and localized', async ({ page }) => {
  const hostile = '<img src=x onerror="window.syntheticHistoryInjected=true">';
  const { id } = await source('hostile', hostile);
  let requests = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/model-history')) requests++;
  });
  await page.goto(`/#session=${id}`);
  const history = page.locator('.model-history');
  await expect(history).toBeVisible();
  expect(requests).toBe(0);
  await history.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(history.locator('li')).toHaveCount(3);
  await expect(history.locator('li').first().locator('code').first()).toHaveText(hostile);
  await expect(history.locator('li').last().locator('code').first()).toHaveText('Not recorded');
  await expect(history).toContainText('Partial coverage');
  await expect(history).toContainText('They do not prove the original declaration');
  await expect(history).toContainText('Normalized event time:');
  await expect(history.locator('img, script, a, button, select, input')).toHaveCount(0);
  expect(
    await page.evaluate(() => Reflect.get(window, 'syntheticHistoryInjected')),
  ).toBeUndefined();
  expect(await history.innerText()).not.toContain('synthetic-model-history-hostile.jsonl');
  await page.getByLabel('Language', { exact: true }).selectOption('pt-BR');
  await expect(history).toContainText('Cobertura parcial');
  await expect(history).toContainText('Horário do evento normalizado');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
});

test('all-null evidence is distinct from missing evidence and bursts do not refetch', async ({
  page,
}) => {
  const { id, path, line } = await source('null');
  let requests = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/model-history')) requests++;
  });
  await page.goto(`/#session=${id}`);
  const history = page.locator('.model-history');
  await history.locator('summary').click();
  await expect(history).toContainText('These records do not establish any model.');
  const before = requests;
  for (let index = 0; index < 5; index++) {
    await appendFile(path, line('turn_context', { model: `synthetic-burst-${index}` }));
    await page.waitForTimeout(150);
  }
  expect(requests).toBe(before);
  await expect(history.locator('li').first()).toContainText('synthetic-burst-4', {
    timeout: 10000,
  });
  expect(requests).toBeLessThanOrEqual(before + 1);
  await page.context().setOffline(true);
  await expect(history).toContainText('History unavailable while disconnected.', {
    timeout: 15000,
  });
  await expect(history.locator('li')).toHaveCount(0);
  await page.context().setOffline(false);
});

test('late readings cannot cross sessions or survive closing; invalid responses stay unavailable', async ({
  page,
}) => {
  const first = await source('race-first', 'synthetic-old-private');
  const second = await source('race-second', 'synthetic-new');
  await page.goto(`/#session=${first.id}`);
  const history = page.locator('.model-history');
  await page.route(`**/api/sessions/${first.id}/model-history`, async (route) => {
    const response = await route.fetch();
    await page.waitForTimeout(800);
    await route.fulfill({ response });
  });
  await history.locator('summary').click();
  await history.locator('summary').click();
  await expect(history.locator('li')).toHaveCount(0);
  await page.goto(`/#session=${second.id}`);
  await history.locator('summary').click();
  await expect(history).toContainText('synthetic-new');
  await page.waitForTimeout(900);
  await expect(history).not.toContainText('synthetic-old-private');
  await history.locator('summary').click();
  await page.route(`**/api/sessions/${second.id}/model-history`, (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: '{"availability":"available","value":{"private":"invalid"}}',
    }),
  );
  await history.locator('summary').click();
  await expect(history).toContainText('History unavailable: the reading could not be validated.');
  await expect(history.locator('li')).toHaveCount(0);
});
