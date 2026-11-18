import { expect, test } from '@playwright/test';
import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Preferences, Snapshot } from '@orqst/protocol';
import { createBridge } from '../../apps/bridge/src/app.js';

test('live browser alerts follow persisted categories, exclude replay, and expose read state', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const notices: string[] = [];
    Reflect.set(window, 'orqstTestNotices', notices);
    Object.defineProperty(window, 'Notification', {
      value: class {
        static permission = 'granted';
        constructor(title: string) {
          notices.push(title);
        }
      },
    });
  });
  const notices = () => page.evaluate(() => Reflect.get(window, 'orqstTestNotices') as string[]);
  const dir = await mkdtemp(join(tmpdir(), 'orqst-browser-notifications-'));
  const sessionsDir = join(dir, 'sessions');
  const bridge = createBridge({
    port: 0,
    dataDir: dir,
    sessionsDir,
    dashboardDir: resolve('apps/dashboard/dist'),
    retentionDays: 30,
    pollMs: 500,
    dev: false,
  });
  const liveFile = join(sessionsDir, 'notification-alert-test.jsonl');
  const sessionId = 'notification-alert-test';
  const record = (type: string, payload: unknown) =>
    JSON.stringify({ type, timestamp: new Date().toISOString(), payload }) + '\n';
  const bell = page.getByRole('button', { name: 'Notifications', exact: true });
  const dialog = page.getByRole('dialog', { name: 'Notifications', exact: true });
  try {
    await mkdir(sessionsDir);
    const base = `http://127.0.0.1:${await bridge.start()}`;
    await page.goto(base);
    await expect(page.getByRole('status').filter({ hasText: 'Live' })).toBeVisible();
    expect(await notices()).toEqual([]);
    const before = (await (await page.request.get(`${base}/api/snapshot`)).json()) as Snapshot;
    const setPrefs = async (patch: Partial<Preferences>) => {
      const response = await page.request.put(`${base}/api/preferences`, {
        data: { ...before.preferences, ...patch },
      });
      expect(response.ok()).toBe(true);
    };

    await bell.click();
    await expect(dialog.getByRole('button', { name: 'Mark all read' })).toBeDisabled();
    // Hold this client's rendered preferences while another client writes the shared settings.
    await page.route('**/api/snapshot', (route) => route.fulfill({ json: before }));
    await setPrefs({ sound: false, completed: false, failed: true, intervention: true });
    await writeFile(
      liveFile,
      record('session_meta', {
        id: sessionId,
        cwd: '/synthetic/notification-alert-test',
        agent_nickname: 'Synthetic alert agent',
      }) + record('event_msg', { type: 'task_started', turn_id: 'synthetic-alert-turn' }),
    );
    const failed = record('event_msg', { type: 'task_failed', message: 'Synthetic failure' });
    await appendFile(
      liveFile,
      record('event_msg', { type: 'task_complete' }) +
        record('response_item', {
          type: 'function_call',
          name: 'request_user_input',
          call_id: 'synthetic-alert-input',
        }) +
        failed +
        failed,
    );
    await expect.poll(notices).toEqual(['Your input is needed', 'Execution failed']);
    await page.unroute('**/api/snapshot');
    await expect(dialog.locator('.notification-item')).toHaveCount(2);
    await expect(dialog.getByRole('button', { name: /Execution failed.*Unread/ })).toBeVisible();
    await expect(bell).toHaveAccessibleDescription('2 unread');

    await setPrefs({ sound: false, completed: true, failed: true, intervention: true });
    await appendFile(
      liveFile,
      record('event_msg', { type: 'task_started', turn_id: 'synthetic-alert-second-turn' }) +
        record('event_msg', { type: 'task_complete', last_agent_message: 'Synthetic completion' }),
    );
    await expect
      .poll(notices)
      .toEqual(['Your input is needed', 'Execution failed', 'Turn completed']);
    await expect(dialog.locator('.notification-item')).toHaveCount(3);
    await expect(bell).toHaveAccessibleDescription('3 unread');

    const mark = dialog.getByRole('button', { name: 'Mark all read' });
    await page.route('**/api/notifications/read', (route) => route.fulfill({ status: 503 }));
    await mark.click();
    await expect(dialog.getByRole('alert')).toHaveText(
      'Could not confirm that notifications were marked read. Try again.',
    );
    await expect(bell).toHaveAccessibleDescription('3 unread');
    await page.unroute('**/api/notifications/read');
    await mark.click();
    await expect(mark).toBeDisabled();
    await expect(dialog.getByRole('button', { name: /Turn completed.*Read/ })).toBeVisible();
    await expect(bell).toHaveAccessibleDescription('0 unread');
    await page.keyboard.press('Escape');
    await expect(bell).toBeFocused();
    await page.getByLabel('Language').selectOption('pt-BR');
    await page.getByRole('button', { name: 'Notificações', exact: true }).click();
    await expect(
      page.getByRole('dialog').getByRole('option', { name: 'Turno concluído' }),
    ).toBeAttached();
    await page.reload();
    await page.getByRole('button', { name: 'Notificações', exact: true }).click();
    await expect(page.getByRole('dialog').locator('.notification-item')).toHaveCount(3);
    expect(await notices()).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await bridge.stop();
    await rm(dir, { recursive: true, force: true });
  }
});

test('loading and offline drawers avoid a false empty history or unread count', async ({
  page,
}) => {
  let failSnapshot!: () => void;
  const blocked = new Promise<void>((resolve) => {
    failSnapshot = resolve;
  });
  await page.route('**/api/snapshot', async (route) => {
    await blocked;
    await route.fulfill({ status: 503 });
  });
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await expect(page.locator('.stats .stat strong')).toHaveText(Array(4).fill('Unavailable'));
    await expect(page.getByText('All quiet here.')).toHaveCount(0);
    await page.getByRole('button', { name: 'Notifications', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Notifications', exact: true });
    await expect(dialog.getByText('Loading notifications…')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Mark all read' })).toHaveCount(0);
    failSnapshot();
    await expect(
      dialog.getByText('Notification history is unavailable while disconnected.'),
    ).toBeVisible();
    await expect(dialog.getByText(/No live notifications/)).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  } finally {
    failSnapshot();
  }
});

test.describe('Tauri dashboard user-agent', () => {
  // Same literal used by the Rust WebviewWindowBuilder. The event is a renderer fixture.
  test.use({ userAgent: 'ORQSTTauri/0.1 ORQSTDesktop/0.1' });
  test('accepts a native alert click only for a session in the refreshed snapshot', async ({
    page,
  }) => {
    await page.goto('/settings');
    await expect(page.getByRole('status').filter({ hasText: 'Live' })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Enable browser notifications', exact: true }),
    ).toHaveCount(0);
    const dispatch = (id: string) =>
      page.evaluate((sessionId) => {
        window.dispatchEvent(new CustomEvent('orqst-native-session', { detail: { sessionId } }));
      }, id);
    const checked = page.waitForResponse('**/api/snapshot');
    await dispatch('missing-synthetic-session');
    await checked;
    await expect(page).toHaveURL(/\/settings$/);
    await dispatch('synthetic-browser-session');
    await expect(page).toHaveURL(/\/overview\/sessions\/synthetic-browser-session$/);
    await expect(page.getByRole('region', { name: 'Session details' })).toContainText(
      'synthetic-browser-session',
    );
  });
});
