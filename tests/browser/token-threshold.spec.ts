import { test, expect, type Page } from '@playwright/test';
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { sessionMetricsResultSchema, type SessionMetricsResult } from '@orqst/protocol';

const sessionId = 'synthetic-browser-session';
const reached = 'The last confirmed total is at or above the threshold.';
const below = 'The last confirmed total is below the threshold.';
const unavailable = 'Threshold comparison is unavailable until metrics are confirmed again.';

async function openControl(page: Page, id = sessionId) {
  await page.goto(`/#session=${id}`);
  const header = page.locator('.session-detail > .live-metrics');
  await expect(header).toHaveAttribute('aria-busy', 'false');
  await header.getByText('Session token alert', { exact: true }).click();
  const input = header.getByLabel('Total-token threshold', { exact: true });
  const apply = async (value: string) => {
    await input.fill(value);
    await header.getByRole('button', { name: 'Apply threshold', exact: true }).click();
  };
  return { header, input, apply };
}

test('unmocked synthetic totals drive the shared visual alert without adding cached input', async ({
  page,
}) => {
  const { file } = JSON.parse(await readFile(process.env.ORQST_BROWSER_STATE!, 'utf8')) as {
    file: string;
  };
  const source = join(dirname(file), 'synthetic-token-threshold.jsonl');
  const id = 'synthetic-token-threshold';
  const timestamp = new Date(Date.now() - 10000).toISOString();
  const line = (type: string, payload: unknown) =>
    JSON.stringify({ type, payload, timestamp }) + '\n';
  const tokenLine = (input: number, output: number, cached: number) =>
    line('token_usage_record', {
      thread_id: id,
      response_id: `synthetic-threshold-${input}`,
      thread_token_usage: {
        input_tokens: input,
        output_tokens: output,
        cached_input_tokens: cached,
        total_tokens: input + output,
      },
    });
  await writeFile(
    source,
    line('session_meta', { id, cwd: '/synthetic/token-threshold' }) +
      line('response_item', {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: '# Synthetic threshold artifact' }],
      }) +
      tokenLine(200, 30, 50),
  );
  const mutations: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/') && request.method() !== 'GET')
      mutations.push(`${request.method()} ${new URL(request.url()).pathname}`);
  });
  const { header, apply } = await openControl(page, id);
  const status = header.locator('.live-token-threshold');
  await expect(status).toHaveCount(0);
  await apply('250');
  await expect(status).toContainText(below);
  await expect(status).toContainText('Confirmed total: 20 tokens below the threshold.');
  await expect(status.locator('svg')).toHaveCount(0);
  await expect(header.locator('.live-token-threshold-reached')).toHaveCount(0);
  await page.getByRole('button', { name: 'Extract artifact manually', exact: true }).click();
  const artifact = page.locator('.artifact-panel .live-metrics');
  await expect(artifact.locator('.live-token-threshold')).toContainText(below);
  await expect(artifact.locator('input')).toHaveCount(0);
  await appendFile(source, tokenLine(210, 40, 80));
  await expect(header.locator('.live-token-threshold-reached')).toContainText(reached);
  await expect(artifact.locator('.live-token-threshold-reached')).toContainText(reached);
  for (const panel of [header, artifact]) {
    await expect(panel.locator('.live-token-threshold')).toContainText(
      'The confirmed total exactly matches the threshold.',
    );
    await expect(panel.locator('.live-token-threshold-icon')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
  }
  await expect(header.locator('.live-metric-values strong')).toHaveText(['210', '40', '80', '250']);
  await expect(header.locator('time')).toHaveAttribute('datetime', timestamp);
  await expect(page.locator('.session-detail [aria-live]')).toHaveCount(1);
  await expect(header.locator('[aria-live]')).toContainText(reached);
  await appendFile(source, tokenLine(211, 40, 80));
  for (const panel of [header, artifact])
    await expect(panel.locator('.live-token-threshold')).toContainText(
      'Confirmed total: 1 token above the threshold.',
    );
  await expect(header.locator('[aria-live]')).toContainText(
    'Confirmed total: 1 token above the threshold.',
  );
  await header.getByRole('button', { name: 'Clear threshold', exact: true }).click();
  await expect(status).toHaveCount(0);
  await expect(artifact.locator('.live-token-threshold')).toHaveCount(0);
  expect(mutations).toEqual(['POST /api/artifacts/extract']);
});

test('explicit integer validation preserves an applied threshold until replacement or clear', async ({
  page,
}) => {
  const { header, apply } = await openControl(page);
  const input = header.locator('input');
  const status = header.locator('.live-token-threshold');
  await apply('9007199254740991');
  await expect(status).toContainText('9,007,199,254,740,991');
  await expect(status).toContainText(below);
  await expect(status).toContainText('Confirmed total: 9,007,199,254,740,871 tokens below');
  for (const invalid of [
    '',
    '0',
    '-1',
    '1.5',
    '1e3',
    '9007199254740992',
    ' 100',
    '100 ',
    '1,000',
  ]) {
    await apply(invalid);
    await expect(input).toHaveAttribute('aria-invalid', 'true');
    await expect(header.getByText('Enter a whole number', { exact: false })).toBeVisible();
    await expect(status).toContainText('9,007,199,254,740,991');
  }
  await input.fill('1');
  await expect(status).toContainText(below);
  await input.press('Enter');
  await expect(status).toContainText('threshold: 1 tokens.');
  await expect(status).toContainText(reached);
  await expect(input).toHaveAttribute('aria-invalid', 'false');
  await header.getByRole('button', { name: 'Clear threshold', exact: true }).click();
  await expect(input).toHaveValue('');
  await expect(status).toHaveCount(0);
});

test('pending, failed and unavailable metrics suppress the visual comparison and recover honestly', async ({
  page,
}) => {
  const now = new Date('2026-11-02T12:00:00Z');
  await page.clock.install({ time: now });
  await page.clock.pauseAt(now);
  let baseline: SessionMetricsResult | undefined;
  let mode: 'available' | 'pending' | 'failed' | 'unavailable' = 'available';
  let release: (() => void) | undefined;
  let reads = 0;
  await page.route('**/api/sessions/*/metrics', async (route) => {
    baseline ??= sessionMetricsResultSchema.parse(await (await route.fetch()).json());
    reads++;
    if (mode === 'pending')
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    if (mode === 'failed') await route.fulfill({ status: 500, json: { error: 'synthetic' } });
    else
      await route.fulfill({
        json:
          mode === 'unavailable'
            ? { availability: 'unavailable', reason: 'evidence_missing' }
            : baseline,
      });
  });
  const { header, apply } = await openControl(page);
  await apply('1');
  const status = header.locator('.live-token-threshold');
  await expect(status).toContainText(reached);
  const counts = await header.locator('.live-metric-values strong').allTextContents();
  const announced = await header.locator('[aria-live]').textContent();
  const refresh = async () => {
    const previous = reads;
    await page.clock.runFor(5251);
    await expect.poll(() => reads).toBeGreaterThan(previous);
  };
  mode = 'pending';
  await refresh();
  await expect(status).toContainText(unavailable);
  await expect(status).not.toContainText('Confirmed total:');
  await expect(status.locator('svg')).toHaveCount(0);
  await expect(header.locator('.live-token-threshold-reached')).toHaveCount(0);
  // Polling is visual only; the single announcer retains the last settled comparison.
  await expect(header.locator('[aria-live]')).toHaveText(announced!);
  release?.();
  await expect(header).toHaveAttribute('aria-busy', 'false');
  for (const next of ['failed', 'unavailable', 'available'] as const) {
    mode = next;
    await refresh();
    await expect(header).toHaveAttribute('aria-busy', 'false');
    await expect(status).toContainText(next === 'available' ? reached : unavailable);
    await expect(status.locator('svg')).toHaveCount(next === 'available' ? 1 : 0);
    if (next !== 'available') await expect(status).not.toContainText('Confirmed total:');
    await expect(header.locator('.live-metric-values strong')).toHaveText(counts);
  }
});

test('threshold is memory-only, localized and keyboard accessible at mobile width', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const { header, apply } = await openControl(page);
  const input = header.locator('input');
  await apply('1');
  await page.getByLabel('Language', { exact: true }).selectOption('pt-BR');
  await expect(header.locator('.live-token-threshold')).toContainText(
    'O último total confirmado atingiu ou ultrapassou o limiar.',
  );
  await expect(header.locator('.live-token-threshold')).toContainText(
    'Total confirmado: 119 tokens acima do limiar.',
  );
  const icon = header.locator('.live-token-threshold-icon');
  await expect(icon).toHaveCSS('animation-name', 'none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(icon).toHaveCSS('animation-name', 'none');
  await expect(input).toHaveAccessibleName('Limiar do total de tokens');
  await expect(header).not.toContainText('liveMetrics.threshold.');
  await input.focus();
  await input.fill('9007199254740991');
  await input.press('Enter');
  await expect(header.locator('.live-token-threshold')).toContainText('9.007.199.254.740.991');
  await expect(header.locator('.live-token-threshold')).toContainText(
    'Total confirmado: 9.007.199.254.740.871 tokens abaixo do limiar.',
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  await page
    .getByRole('region', { name: 'Detalhes da sessão', exact: true })
    .getByRole('button', { name: 'Fechar', exact: true })
    .click();
  await expect(header).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Ver sessão Synthetic browser agent', exact: true })
    .click();
  await expect(header).toBeVisible();
  await expect(header.locator('.live-token-threshold')).toHaveCount(0);
  await header.getByText('Alerta de tokens da sessão', { exact: true }).click();
  await header.getByLabel('Limiar do total de tokens', { exact: true }).fill('1');
  await header.getByRole('button', { name: 'Aplicar limiar', exact: true }).click();
  await page.reload();
  await page
    .getByRole('button', { name: 'Ver sessão Synthetic browser agent', exact: true })
    .click();
  await expect(header).toBeVisible();
  await expect(header.locator('.live-token-threshold')).toHaveCount(0);
});

for (const total of [0, Number.MAX_SAFE_INTEGER]) {
  test(`synthetic confirmed total ${total} keeps threshold arithmetic exact`, async ({ page }) => {
    await page.route('**/api/sessions/*/metrics', async (route) => {
      const data = sessionMetricsResultSchema.parse(await (await route.fetch()).json());
      if (data.availability !== 'available') throw new Error('Synthetic baseline unavailable');
      data.value.usage = { input: total, output: 0, cached: total, total };
      await route.fulfill({ json: sessionMetricsResultSchema.parse(data) });
    });
    const { header, apply } = await openControl(page);
    await apply('1');
    await expect(header.locator('.live-token-threshold')).toContainText(
      total === 0
        ? 'Confirmed total: 1 token below the threshold.'
        : 'Confirmed total: 9,007,199,254,740,990 tokens above the threshold.',
    );
    await expect(header.locator('.live-token-threshold-icon')).toHaveCount(total === 0 ? 0 : 1);
    if (total > 0) {
      await apply(String(total));
      await expect(header.locator('.live-token-threshold')).toContainText(
        'The confirmed total exactly matches the threshold.',
      );
    }
  });
}
