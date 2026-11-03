// Native-shaped synthetic source, read only by the disposable browser harness.
import { test, expect } from '@playwright/test';
import { appendFile, readFile, writeFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const hostile =
  '<img src=x onerror="window.syntheticToolInjected=true">\u001b]52;c;synthetic\u0007\r\u202e';

test('tool evidence pairs by explicit identity, remains inert and receives retained updates', async ({
  page,
}) => {
  const { file } = JSON.parse(await readFile(process.env.ORQST_BROWSER_STATE!, 'utf8')) as {
    file: string;
  };
  const path = join(dirname(file), 'synthetic-observed-tools.jsonl');
  const id = 'synthetic-observed-tools';
  const line = (type: string, payload: unknown) =>
    JSON.stringify({ type, payload, timestamp: new Date().toISOString() }) + '\n';
  try {
    await writeFile(
      path,
      line('session_meta', { id, cwd: '/synthetic/observed-tools' }) +
        line('turn_context', { turn_id: 'synthetic-turn' }) +
        line('response_item', {
          type: 'function_call',
          name: 'synthetic_tool',
          call_id: 'synthetic-call',
          arguments: 'Synthetic input; no command will be executed',
        }) +
        line('response_item', {
          type: 'function_call_output',
          call_id: 'synthetic-call',
          output: hostile,
        }),
    );
    const writes: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/') && request.method() !== 'GET') writes.push(request.url());
    });
    await page.goto(`/#session=${id}`);
    await page.getByRole('button', { name: 'Observed tools', exact: true }).click();
    const panel = page.locator('.observed-tools');
    await expect(panel.locator('article')).toHaveCount(1);
    await expect(panel).toContainText('matching recorded identity');
    await expect(panel).toContainText('Synthetic input; no command will be executed');
    await expect(panel).toContainText('\\u001b]52;c;synthetic\\u0007\\u000d\\u202e');
    await expect(panel.locator('img, script, a, input, textarea, button')).toHaveCount(0);
    expect(await page.evaluate(() => Reflect.get(window, 'syntheticToolInjected'))).toBeUndefined();
    await panel.locator('.source-detail').first().locator('summary').click();
    await expect(panel).toContainText('byte offset');
    await expect(panel).toContainText('response_item:function_call');
    await expect(panel).toContainText('Source was not rechecked');
    await appendFile(
      path,
      line('response_item', {
        type: 'custom_tool_call_output',
        call_id: 'synthetic-orphan',
        output: 'Synthetic orphan return',
      }),
    );
    await expect(panel.locator('article')).toHaveCount(2);
    await expect(panel.locator('article').first()).toContainText('Separate record');
    await expect(panel).not.toContainText('Running');
    await page.getByLabel('Language', { exact: true }).selectOption('pt-BR');
    await expect(panel).toContainText('Entrada e saída de ferramentas observadas');
    await expect(panel).toContainText('somente de leitura');
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await page.context().setOffline(true);
    await expect(panel).toContainText('Desconectado ou atualizando', { timeout: 15000 });
    await expect(panel.locator('article')).toHaveCount(2);
    expect(writes).toEqual([]);
    await page.context().setOffline(false);
  } finally {
    await rm(path, { force: true });
  }
});
