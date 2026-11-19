import { test, expect } from '@playwright/test';
import { managedAgentsDocument } from '../../apps/desktop/src/managed-agents-document.js';
import en from '../../apps/dashboard/src/locales/en-US.json' with { type: 'json' };
import { buildSharedTestRenderer } from '../../scripts/helpers/shared-test-resources.js';

// Synthetic client state only. This does not exercise native focus, IPC or modal acceptance.
test('focus refusal preserves known lifecycle until a fresh snapshot restores controls', async ({
  page,
}) => {
  await page.setContent(
    managedAgentsDocument(
      'en-US',
      (key) =>
        en.managedAgents[key.slice('managedAgents.'.length) as keyof typeof en.managedAgents],
    )
      .replace(/<script[^>]*>[\s\S]*?<\/script>/g, '')
      .replace(/<link[^>]*>/g, ''),
  );
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
  const { script } = await buildSharedTestRenderer('agents');
  await page.addScriptTag({ content: script });
  await expect(page.locator('#lifetime')).toHaveText(en.managedAgents.lifetime_active);
  await expect(page.locator('#stop-0')).toBeEnabled();
  await page.locator('#stop-0').click();
  await expect(page.locator('#status')).toHaveText(en.managedAgents.focus_required);
  await expect(page.locator('#lifetime')).toHaveText(en.managedAgents.lifetime_active);
  await expect(page.locator('#stop-0')).toBeDisabled();
  await page.evaluate(() => Reflect.set(window, 'syntheticSnapshotsHeld', false));
  await expect(page.locator('#stop-0')).toBeEnabled();
  await expect(page.locator('#lifetime')).toHaveText(en.managedAgents.lifetime_active);
});
