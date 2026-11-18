import { expect, test } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { TauriStudio } from '@orqst/protocol';

const workspaceId = 'a'.repeat(64);
const featureId = '00000000-0000-4000-8000-000000000001';
const terminalId = '00000000-0000-4000-8000-000000000002';
const savedId = '00000000-0000-4000-8000-000000000003';
const modelId = 'b'.repeat(64);

test('L3 projects the submit before the native reply and preserves failure on that card', async ({
  page,
}, info) => {
  await page.addInitScript(
    ({ workspaceId, featureId, terminalId, savedId, modelId }) => {
      // Renderer-only fixture, with a controlled native refusal and no CLI or user data.
      localStorage.setItem('i18nextLng', 'pt-BR');
      const workspace = { id: workspaceId, name: 'Projeto sintético' };
      const feature = {
        featureId,
        workspaceId,
        name: 'Feature sintética',
        description: '',
        status: 'active',
        schemaVersion: 1,
        revision: 1,
        terminalIds: [terminalId, savedId],
        createdAt: 1,
        updatedAt: 1,
      };
      const snapshot = {
        storage: 'core',
        contractVersion: 1,
        generation: 1,
        workspace,
        activeFeatureId: featureId,
        features: [feature],
        view: { storage: 'core', contractVersion: 1, revision: 1, workspaceId, featureId },
        slots: [{ slot: 0, terminalId, provider: 'opencode' }],
        layoutSaved: true,
      };
      Reflect.set(window, 'orqstFeatures', {
        contractVersion: 1,
        request: async () => ({ status: 'ok', snapshot }),
      });
      let catalogs = 0;
      document.addEventListener(
        'click',
        (event) => {
          if (!(event.target instanceof Element) || !event.target.closest('button[type=submit]'))
            return;
          const started = performance.now();
          const observer = new MutationObserver(() => {
            if (!document.querySelector('.pane-lifecycle[data-state=starting]')) return;
            Reflect.set(window, 'submitToCardMs', performance.now() - started);
            observer.disconnect();
          });
          observer.observe(document.body, { childList: true, subtree: true });
        },
        true,
      );
      Reflect.set(window, 'orqstTauriStudio', {
        contractVersion: 1,
        async request(request: Parameters<TauriStudio['request']>[0]) {
          if (request.action === 'catalog') {
            if (request.workspaceId !== workspaceId || request.featureId !== featureId)
              return { status: 'denied' };
            Reflect.set(window, 'fixtureCatalogs', ++catalogs);
            return {
              status: 'catalog',
              catalog: {
                contractVersion: 1,
                workspaceId,
                featureId,
                catalogId: 'c'.repeat(64),
                providers: [
                  {
                    provider: 'codex',
                    status: 'available',
                    reason: 'ready',
                    models: [
                      {
                        id: modelId,
                        label: 'CLI default',
                        source: 'cli-default',
                        isDefault: true,
                        availability: 'unverified',
                      },
                    ],
                  },
                ],
              },
              snapshot: {
                generation: 1,
                limit: 8,
                count: 1,
                canCreate: true,
                canReview: false,
                selectionLocked: false,
                busy: false,
                liveEnrollment: true,
              },
            };
          }
          if (request.action !== 'create-batch') return { status: 'denied' as const };
          return new Promise((resolve) => {
            Reflect.set(window, 'refuseFixtureOpen', () =>
              resolve({
                status: 'batch',
                items: request.requests.map(({ id }) => ({
                  id,
                  status: 'refused',
                  reason: 'catalog_changed',
                  effects: 'not_started',
                })),
              }),
            );
          });
        },
      });
    },
    { workspaceId, featureId, terminalId, savedId, modelId },
  );
  const evidence = process.env.ORQST_SPEC_L3_SCREENSHOTS;
  if (evidence) await mkdir(evidence, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/studio');
  await expect(page.getByRole('button', { name: 'Feature sintética 2' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => Reflect.get(window, 'fixtureCatalogs'))).toBe(1);

  await page.getByRole('button', { name: '＋ Terminal', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('textbox').first().fill('Agente sintético');
  await dialog.locator('button[type=submit]').click();
  await expect(dialog).toBeHidden();
  const card = page.locator('.ts-pane').filter({ hasText: 'Agente sintético' });
  await expect(card.getByText('Iniciando', { exact: true })).toBeVisible();
  const submitToCardMs: unknown = await page.evaluate(() => Reflect.get(window, 'submitToCardMs'));
  expect(typeof submitToCardMs).toBe('number');
  console.log(`Synthetic submit to starting DOM: ${String(submitToCardMs)} ms`);
  await page.screenshot({
    path: evidence ? resolve(evidence, 'starting-1440.png') : info.outputPath('starting.png'),
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  if (evidence) await page.screenshot({ path: resolve(evidence, 'starting-1280.png') });

  await page.evaluate(() => Reflect.get(window, 'refuseFixtureOpen')());
  await expect(card.getByText('Catálogo mudou', { exact: true })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Tentar novamente' })).toBeEnabled();
  await expect(card.getByRole('button', { name: 'Alterar CLI' })).toBeEnabled();
  await expect(card.getByRole('button', { name: 'Ver logs' })).toBeEnabled();
  if (evidence) await page.screenshot({ path: resolve(evidence, 'failed-1280.png') });
  await page.setViewportSize({ width: 1440, height: 900 });
  if (evidence) await page.screenshot({ path: resolve(evidence, 'failed-1440.png') });

  await card.getByRole('button', { name: 'Ver logs' }).click();
  await expect(card.getByText('catalog_changed')).toBeVisible();
  await card.getByRole('button', { name: 'Tentar novamente' }).click();
  await expect(dialog).toBeVisible();
  await expect.poll(() => page.evaluate(() => Reflect.get(window, 'fixtureCatalogs'))).toBe(2);
  await page.keyboard.press('Escape');
  await page.locator('.feature-permissions-disclosure > summary').click();
  const ended = page.getByText('Encerrados (1)', { exact: true });
  await ended.click();
  await expect(page.getByText('Estado incerto', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ver detalhes' })).toBeVisible();
  await page.evaluate((id) => {
    window.dispatchEvent(
      new CustomEvent('orqst-owned-pty-lifecycle', {
        detail: {
          terminalId: id,
          evidence: { transport: 'connected', process: 'exited', firstFrame: false, exitCode: 0 },
        },
      }),
    );
  }, terminalId);
  await expect(page.getByRole('article', { name: 'T-001 OpenCode' })).toHaveCount(0);
  await expect(page.getByText('Encerrados (2)', { exact: true })).toBeVisible();
  await expect(page.getByText('Encerrado', { exact: true })).toBeVisible();
  if (evidence) await page.screenshot({ path: resolve(evidence, 'ended-1440.png') });
  await page.setViewportSize({ width: 1280, height: 800 });
  if (evidence) await page.screenshot({ path: resolve(evidence, 'ended-1280.png') });
  if (evidence) {
    const approved = await readFile(
      'docs/design/v6/source/ORQST_workspace_v6_features.html',
      'utf8',
    );
    await page.route('**/spec-l3-v6', (route) =>
      route.fulfill({ contentType: 'text/html', body: approved }),
    );
    await page.goto('/spec-l3-v6');
    await page.screenshot({ path: resolve(evidence, 'v6-1280.png') });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.screenshot({ path: resolve(evidence, 'v6-1440.png') });
  }
});
