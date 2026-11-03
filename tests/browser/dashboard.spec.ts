import { test, expect } from '@playwright/test';
import { readFile, appendFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

test('synthetic session renders, localization persists, results are escaped, workspace association saves', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('status').filter({ hasText: 'Live' })).toBeVisible();
  await expect(
    page.getByRole('button', { name: /Synthetic browser agent Synthetic browser task/ }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: /Synthetic browser agent Synthetic browser task/ })
    .click();
  await expect(page.getByRole('region', { name: 'Session details' })).toBeVisible();
  await page.getByRole('button', { name: 'Latest result', exact: true }).click();
  await expect(page.locator('.result-content')).toContainText('Synthetic browser result');
  expect(await page.evaluate(() => Reflect.get(window, 'orqstInjected'))).toBeUndefined();
  expect(await page.locator('img').count()).toBe(0);
  await page.getByLabel('Language').selectOption('pt-BR');
  await expect(page.getByRole('heading', { name: 'Seus agentes, em foco.' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Seus agentes, em foco.' })).toBeVisible();
  await page.getByLabel('Idioma').selectOption('en-US');
  await page.getByRole('button', { name: 'Add workspace', exact: true }).click();
  await page.getByLabel('Workspace name').fill('Synthetic manual workspace');
  await page.getByLabel('Project path (label only)').fill('/synthetic/manual');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page
    .getByRole('button', { name: /Synthetic browser agent Synthetic browser task/ })
    .click();
  await page
    .getByLabel('Workspace association')
    .selectOption({ label: 'Synthetic manual workspace' });
  await expect(page.getByLabel('Workspace association')).not.toHaveValue('');
  await page.getByRole('button', { name: 'Notifications', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Notification preferences' })).toBeVisible();
  await page.getByLabel('Enable sound', { exact: true }).check();
  await expect(page.getByLabel('Enable sound', { exact: true })).toBeChecked();
  await page.getByRole('button', { name: 'Close', exact: true }).last().click();
  expect(errors).toEqual([]);
  await page.screenshot({ path: test.info().outputPath('orqst-desktop.png'), fullPage: true });
});
test('mobile layout stays within the viewport and exposes workspace navigation', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Your agents, in focus.' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.getByRole('button', { name: 'Workspaces', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Workspaces' })).toBeVisible();
  await page.getByRole('button', { name: 'All workspaces', exact: false }).click();
  await page.screenshot({ path: test.info().outputPath('orqst-mobile.png'), fullPage: true });
});

test('new external source records update the page and notification history without refresh', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('status').filter({ hasText: 'Live' })).toBeVisible();
  await page.getByRole('button', { name: 'Notifications', exact: true }).click();
  const sound = page.getByLabel('Enable sound', { exact: true });
  if (await sound.isChecked()) await sound.uncheck();
  await page.evaluate(() => {
    Notification.requestPermission = async () => 'denied';
  });
  await page.getByRole('button', { name: 'Enable browser notifications', exact: true }).click();
  await expect(
    page.getByText('Browser notifications unavailable or denied.', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).last().click();
  const { file } = JSON.parse(await readFile(process.env.ORQST_BROWSER_STATE!, 'utf8')) as {
    file: string;
  };
  // Preserve the shared 120-token session used by later threshold checks.
  const liveFile = join(dirname(file), 'synthetic-dashboard-live.jsonl');
  const liveSession = 'synthetic-dashboard-live-session';
  const timestamp = new Date().toISOString();
  await writeFile(
    liveFile,
    [
      {
        type: 'session_meta',
        payload: {
          id: liveSession,
          cwd: '/synthetic/dashboard-live',
          agent_nickname: 'Synthetic live browser agent',
        },
      },
      {
        type: 'token_usage_record',
        payload: {
          thread_id: liveSession,
          thread_token_usage: {
            input_tokens: 100,
            output_tokens: 20,
            cached_input_tokens: 40,
            total_tokens: 120,
          },
        },
      },
    ]
      .map((record) => JSON.stringify({ ...record, timestamp }) + '\n')
      .join(''),
  );
  await expect(page.locator('.stats .stat').last()).toContainText('240');
  const records = [
    { type: 'event_msg', payload: { type: 'task_started', turn_id: 'synthetic-live-turn' } },
    {
      type: 'response_item',
      payload: {
        type: 'message',
        id: 'synthetic-live-user',
        role: 'user',
        content: [{ text: 'Synthetic live browser task — appended outside ORQST' }],
      },
    },
    {
      type: 'token_usage_record',
      payload: {
        thread_id: liveSession,
        response_id: 'synthetic-live-response',
        thread_token_usage: {
          input_tokens: 140,
          output_tokens: 30,
          cached_input_tokens: 60,
          total_tokens: 170,
        },
      },
    },
    {
      type: 'event_msg',
      payload: { type: 'task_complete', last_agent_message: 'Synthetic live result' },
    },
  ];
  await appendFile(
    liveFile,
    records.map((record) => JSON.stringify({ ...record, timestamp }) + '\n').join(''),
  );
  await expect(
    page.getByRole('button', { name: /Synthetic live browser agent Synthetic live browser task/ }),
  ).toBeVisible();
  await expect(page.locator('.stats .stat').last()).toContainText('290');
  await page.getByRole('button', { name: 'Notifications', exact: true }).click();
  await expect(page.locator('.notification-item')).toHaveCount(1);
  await expect(page.locator('.notification-item')).toContainText('Turn completed');
  await page.reload();
  await page.getByRole('button', { name: 'Notifications', exact: true }).click();
  await expect(page.locator('.notification-item')).toHaveCount(1);
});

test('session links select only an identity in the current snapshot', async ({ page }) => {
  await page.goto('/#session=synthetic-browser-session');
  await expect(page.getByRole('region', { name: 'Session details' })).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).first().click();
  await page.goto('/#session=missing-session');
  await expect(page.getByRole('status').filter({ hasText: 'Live' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Session details' })).toHaveCount(0);
});
