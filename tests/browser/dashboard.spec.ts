import { test, expect } from '@playwright/test';
import { readFile, appendFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { changeLanguage, coreStatus, openObservedSessions } from '../helpers/spec-dashboard.js';

test('synthetic session renders, localization persists, results are escaped, workspace association saves', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/visao-geral');
  await expect(coreStatus(page).filter({ hasText: 'CORE ONLINE' })).toBeVisible();
  await openObservedSessions(page);
  await page.getByRole('link', { name: 'Synthetic browser agent', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Session details' })).toBeVisible();
  await page.getByRole('button', { name: 'Latest result', exact: true }).click();
  await expect(page.locator('.result-content')).toContainText('Synthetic browser result');
  expect(await page.evaluate(() => Reflect.get(window, 'orqstInjected'))).toBeUndefined();
  expect(await page.getByRole('region', { name: 'Session details' }).locator('img').count()).toBe(
    0,
  );
  await changeLanguage(page, 'pt-BR');
  await expect(page.getByRole('region', { name: 'Detalhes da sessão' })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Synthetic browser agent', exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR');
  await expect(
    page.getByRole('heading', { name: 'Synthetic browser agent', exact: true }),
  ).toBeVisible();
  await changeLanguage(page, 'en-US');
  await page.getByRole('button', { name: 'New Workspace', exact: true }).click();
  await page.getByLabel('Workspace name').fill('Synthetic manual workspace');
  await page.getByLabel('Project path (label only)').fill('/synthetic/manual');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL('/studio');
  const workspace = page.getByRole('button', { name: 'Synthetic manual workspace', exact: true });
  await expect(workspace).toHaveAttribute('aria-current', 'true');
  await page.getByRole('button', { name: 'Search & commands' }).click();
  const search = page.getByRole('dialog', { name: 'Search & commands' }).getByRole('textbox');
  await search.fill('Synthetic browser agent');
  await search.press('Enter');
  await expect(page.getByRole('region', { name: 'Session details' })).toBeVisible();
  const association = page.getByLabel('Workspace association');
  const automatic = await association.inputValue();
  const [manual] = await association.selectOption({ label: 'Synthetic manual workspace' });
  await expect(association).toHaveValue(manual!);
  await page.reload();
  await expect(association).toHaveValue(manual!);
  await association.selectOption(automatic);
  await expect(association).toHaveValue(automatic);
  await page
    .locator('#app-sidebar')
    .getByRole('button', { name: 'Notifications', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: 'Notification preferences' })).toBeVisible();
  const sound = page.getByLabel('Enable sound', { exact: true });
  const initialSound = await sound.isChecked();
  await sound.check();
  await expect(sound).toBeChecked();
  if (!initialSound) {
    await sound.uncheck();
    await expect(sound).not.toBeChecked();
  }
  await page.getByRole('button', { name: 'Close', exact: true }).last().click();
  expect(errors).toEqual([]);
  await page.screenshot({ path: test.info().outputPath('orqst-desktop.png'), fullPage: true });
});
test('mobile layout stays within the viewport and exposes workspace navigation', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/visao-geral');
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await expect(page.getByRole('navigation', { name: 'Workspaces' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'browser-test', exact: true })).toBeVisible();
  await expect(page.locator('#app-sidebar')).toHaveCSS('width', '46px');
  await page.screenshot({ path: test.info().outputPath('orqst-mobile.png'), fullPage: true });
});

test('new external source records update the page and notification history without refresh', async ({
  page,
}) => {
  await page.goto('/visao-geral');
  await expect(coreStatus(page).filter({ hasText: 'CORE ONLINE' })).toBeVisible();
  await page
    .locator('#app-sidebar')
    .getByRole('button', { name: 'Notifications', exact: true })
    .click();
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
  await openObservedSessions(page);
  await page.getByRole('link', { name: 'Synthetic live browser agent', exact: true }).click();
  const badge = page.locator('.session-token-badge strong');
  await expect(badge).toHaveText('120');
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
  await expect(page.locator('.session-detail')).toContainText('Synthetic live browser task');
  await expect(badge).toHaveText('170');
  await page
    .locator('#app-sidebar')
    .getByRole('button', { name: 'Notifications', exact: true })
    .click();
  await expect(page.locator('.notification-item')).toHaveCount(1);
  await expect(page.locator('.notification-item')).toContainText('Turn completed');
  await page.reload();
  await page
    .locator('#app-sidebar')
    .getByRole('button', { name: 'Notifications', exact: true })
    .click();
  await expect(page.locator('.notification-item')).toHaveCount(1);
});

test('session links select only an identity in the current snapshot', async ({ page }) => {
  await page.goto('/#session=synthetic-browser-session');
  await expect(page.getByRole('region', { name: 'Session details' })).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).first().click();
  await page.goto('/#session=missing-session');
  await expect(coreStatus(page).filter({ hasText: 'CORE ONLINE' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Session details' })).toHaveCount(0);
});
