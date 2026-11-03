import { resolve } from 'node:path';
import { test, expect } from '@playwright/test';

// Synthetic opener replies only; real sender/preload/focus refusal is checked in Electron smoke.
test('managed opener explains focus refusal, recovers and supports an older running preload', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Reflect.set(window, 'syntheticOpenStatus', 'focus_required');
    Object.defineProperty(window, 'orqstManagedAgents', {
      value: {
        contractVersion: 1,
        async open() {
          const status = Reflect.get(window, 'syntheticOpenStatus');
          if (status === 'legacy') return;
          if (status === 'throw') throw new Error('Synthetic transport loss');
          return { status };
        },
      },
    });
  });
  await page.goto('/overview');
  const open = () => page.getByRole('button', { name: 'Managed agents', exact: true });
  await open().click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Bring the ORQST dashboard' }),
  ).toBeVisible();
  await page.evaluate(() => Reflect.set(window, 'syntheticOpenStatus', 'ok'));
  await open().click();
  await expect(page.getByText('Bring the ORQST dashboard', { exact: false })).toHaveCount(0);
  await page.evaluate(() => Reflect.set(window, 'syntheticOpenStatus', 'unavailable'));
  await open().click();
  await expect(
    page.getByRole('status').filter({ hasText: 'could not be requested' }),
  ).toBeVisible();
  await page.evaluate(() => Reflect.set(window, 'syntheticOpenStatus', 'legacy'));
  await open().click();
  await expect(page.getByText('could not be requested', { exact: false })).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Language' }).selectOption('pt-BR');
  await page.evaluate(() => Reflect.set(window, 'syntheticOpenStatus', 'focus_required'));
  await page.getByRole('button', { name: 'Agentes gerenciados', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Traga o painel do ORQST' }),
  ).toBeVisible();
  await page.evaluate(() => Reflect.set(window, 'syntheticOpenStatus', 'throw'));
  await page.getByRole('button', { name: 'Agentes gerenciados', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Não foi possível solicitar' }),
  ).toBeVisible();
});

// Synthetic client state only. This does not exercise native focus, IPC or modal acceptance.
test('focus refusal preserves known lifecycle until a fresh snapshot restores controls', async ({
  page,
}) => {
  await page.setContent(`
    <p id="status" data-working="working" data-focus_required="focus required"></p>
    <p id="lifetime" data-active="active" data-idle="idle" data-uncertain="uncertain"></p>
    <p id="project"></p><button id="retire"></button><button id="delegate"></button>
    <textarea id="instructions"></textarea><textarea id="task"></textarea>
    <pre id="communication"></pre>
    ${[0, 1]
      .map(
        (slot) => `<input id="model-${slot}" value="SYNTHETIC">
      <button id="start-${slot}"></button><button id="stop-${slot}"></button>
      <pre id="identity-${slot}"></pre><pre id="output-${slot}"></pre>`,
      )
      .join('')}
  `);
  await page.evaluate(() => {
    let held = false;
    Reflect.set(window, 'syntheticSnapshotsHeld', false);
    Object.defineProperty(window, 'orqstManagedAgentsClient', {
      value: {
        async request(request: { action: string }) {
          if (request.action !== 'snapshot') {
            held = true;
            Reflect.set(window, 'syntheticSnapshotsHeld', true);
            return { status: 'focus_required', empty: false };
          }
          while (held && Reflect.get(window, 'syntheticSnapshotsHeld'))
            await new Promise((done) => setTimeout(done, 20));
          return {
            status: 'ok',
            snapshot: {
              admission: 'reserved',
              project: '/SYNTHETIC',
              canRetire: false,
              slots: [0, 1].map(() => ({
                state: 'running',
                available: true,
                pane: { state: 'ready' },
              })),
              root: null,
              messages: [],
            },
          };
        },
      },
    });
  });
  await page.addScriptTag({ path: resolve('apps/desktop/dist/managed-agents-client.js') });
  await expect(page.locator('#lifetime')).toHaveText('active');
  await expect(page.locator('#stop-0')).toBeEnabled();
  await page.locator('#stop-0').click();
  await expect(page.locator('#status')).toHaveText('focus required');
  await expect(page.locator('#lifetime')).toHaveText('active');
  await expect(page.locator('#stop-0')).toBeDisabled();
  await page.evaluate(() => Reflect.set(window, 'syntheticSnapshotsHeld', false));
  await expect(page.locator('#stop-0')).toBeEnabled();
  await expect(page.locator('#lifetime')).toHaveText('active');
});
