// Unmocked synthetic observer -> Store -> authenticated API/WS -> shared dashboard.
import { test, expect } from '@playwright/test';
import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

test('real synthetic token events update one shared session/artifact reading with token time', async ({
  page,
}) => {
  const { file } = JSON.parse(await readFile(process.env.ORQST_BROWSER_STATE!, 'utf8')) as {
    file: string;
  };
  const source = join(dirname(file), 'synthetic-live-metrics.jsonl');
  const id = 'synthetic-live-metrics-session';
  const time = new Date(Date.now() - 10000).toISOString();
  const line = (type: string, payload: unknown, timestamp = time) =>
    JSON.stringify({ type, payload, timestamp }) + '\n';
  await writeFile(
    source,
    line('session_meta', {
      id,
      cwd: '/synthetic/live-metrics',
      agent_nickname: 'Synthetic Live Metrics',
    }) +
      line('response_item', {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: '# Synthetic metrics artifact' }],
      }),
  );
  await page.goto(`/#session=${id}`);
  const session = page.getByRole('region', { name: 'Session details', exact: true });
  await expect(session).toBeVisible();
  const header = session.locator(':scope > .live-metrics');
  await expect(header).toContainText('No cumulative token snapshot was recorded.');
  await expect(header.locator('.live-metric-values')).toHaveCount(0);
  await session.getByRole('button', { name: 'Extract artifact manually', exact: true }).click();
  const artifact = page.getByRole('region', { name: 'Manual artifact', exact: true });
  await expect(artifact.locator('.live-metrics')).toContainText('no confirmed session snapshot');
  await appendFile(
    source,
    line('token_usage_record', {
      thread_id: id,
      response_id: 'synthetic-live-response',
      thread_token_usage: {
        input_tokens: 200,
        output_tokens: 30,
        cached_input_tokens: 50,
        total_tokens: 230,
      },
    }) + line('event_msg', { type: 'task_started' }, new Date().toISOString()),
  );
  await expect(header.locator('.live-metric-values strong')).toHaveText(['200', '30', '50', '230']);
  await expect(artifact.locator('.live-metric-values strong')).toHaveText([
    '200',
    '30',
    '50',
    '230',
  ]);
  await expect(header.locator('time')).toHaveAttribute('datetime', time);
  await expect(artifact.locator('.live-metrics time')).toHaveAttribute('datetime', time);
  // The first available snapshot is a baseline in both already open views.
  await expect(session.locator('.live-metric-updated')).toHaveCount(0);
  await header.screenshot({ path: test.info().outputPath('confirmed-metrics.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
  await header.screenshot({ path: test.info().outputPath('confirmed-metrics-mobile.png') });
  await header.getByText('Metric provenance', { exact: true }).click();
  await expect(header).toContainText('synthetic-live-metrics.jsonl');
  await expect(header).toContainText('synthetic-live-response');
  const response = await page.request.get(`/api/sessions/${id}/metrics`);
  expect(response.status()).toBe(200);
  const result = (await response.json()) as { value: { usage: { total: number } } };
  expect(result.value.usage.total).toBe(230);

  // A second real synthetic source record changes input/total only, at the same source time.
  await appendFile(
    source,
    line('token_usage_record', {
      thread_id: id,
      response_id: 'synthetic-live-response-2',
      thread_token_usage: {
        input_tokens: 210,
        output_tokens: 30,
        cached_input_tokens: 50,
        total_tokens: 240,
      },
    }),
  );
  await expect(header.locator('.live-metric-updated')).toHaveText(['210', '240']);
  await expect(artifact.locator('.live-metric-updated')).toHaveText(['210', '240']);
  await expect(header.locator('time')).toHaveAttribute('datetime', time);
  await expect(artifact.locator('[aria-live]')).toHaveCount(0);
});
