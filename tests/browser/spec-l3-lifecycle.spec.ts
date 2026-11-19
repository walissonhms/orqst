import { expect, test } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { TauriStudio } from '@orqst/protocol';

const workspaceId = 'a'.repeat(64);
const featureId = '00000000-0000-4000-8000-000000000001';
const terminalId = '00000000-0000-4000-8000-000000000002';
const savedId = '00000000-0000-4000-8000-000000000003';
const releasedId = '00000000-0000-4000-8000-000000000004';
const modelId = 'b'.repeat(64);

test('L3 projects the submit before the native reply and preserves failure on that card', async ({
  page,
}, info) => {
  await page.addInitScript(
    ({ workspaceId, featureId, terminalId, savedId, releasedId, modelId }) => {
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
        terminalIds: [terminalId, savedId, releasedId],
        terminalDisplays: [
          { terminalId, displayId: 'T-001' },
          { terminalId: savedId, displayId: 'T-002' },
          { terminalId: releasedId, displayId: 'T-003', released: true },
        ],
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
        request: async () => {
          const observedAt = Date.now();
          return {
            status: 'ok',
            snapshot,
            canvas: {
              observedAt,
              entries: [{ slot: 0, terminalId, state: 'running', startedAt: observedAt - 1 }],
            },
          };
        },
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
    { workspaceId, featureId, terminalId, savedId, releasedId, modelId },
  );
  const integrated = process.env.ORQST_SPEC_INTEGRATED_CAPTURES;
  const evidence = process.env.ORQST_SPEC_L3_SCREENSHOTS;
  async function capture(state: string, width: 1440 | 1280) {
    if (evidence || integrated) {
      await page.mouse.move(0, 0);
      await page.evaluate(
        () =>
          new Promise<void>((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
          }),
      );
    }
    if (integrated)
      await page.screenshot({
        animations: 'disabled',
        path: resolve(integrated, width === 1440 ? '1440x900' : '1280x800', state + '.png'),
      });
    else if (evidence)
      await page.screenshot({
        path: resolve(evidence, `${state}-${width}.png`),
        animations: 'disabled',
      });
  }
  if (evidence) await mkdir(evidence, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/studio');
  await expect(page.getByRole('button', { name: /^Feature sintética/ })).toBeVisible();
  await expect.poll(() => page.evaluate(() => Reflect.get(window, 'fixtureCatalogs'))).toBe(1);
  const live = page.locator(`[data-pane-id="${terminalId}"]`);
  await expect(live).toBeVisible();
  await page.evaluate((id) => {
    window.dispatchEvent(
      new CustomEvent('orqst-owned-pty-lifecycle', {
        detail: {
          terminalId: id,
          evidence: { transport: 'connected', process: 'live', firstFrame: true },
        },
      }),
    );
  }, terminalId);
  await expect(live).toHaveAttribute('data-lifecycle', 'unknown');
  await expect(live.locator('.ts-open')).toHaveCount(0);
  await capture('live-pty', 1440);
  await page.setViewportSize({ width: 1280, height: 800 });
  await capture('live-pty', 1280);
  await page.setViewportSize({ width: 1440, height: 900 });

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
  await capture('starting', 1440);
  if (!evidence && !integrated) await page.screenshot({ path: info.outputPath('starting.png') });
  await page.setViewportSize({ width: 1280, height: 800 });
  await capture('starting', 1280);

  await page.evaluate(() => Reflect.get(window, 'refuseFixtureOpen')());
  await expect(card.getByText('Catálogo mudou', { exact: true })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Tentar novamente' })).toBeEnabled();
  await expect(card.getByRole('button', { name: 'Alterar CLI' })).toBeEnabled();
  await expect(card.getByRole('button', { name: 'Ver logs' })).toBeEnabled();
  await capture('failed', 1280);
  await page.setViewportSize({ width: 1440, height: 900 });
  await capture('failed', 1440);

  await card.getByRole('button', { name: 'Ver logs' }).click();
  await expect(card.getByText('catalog_changed')).toBeVisible();
  await card.getByRole('button', { name: 'Tentar novamente' }).click();
  await expect(dialog).toBeVisible();
  await expect.poll(() => page.evaluate(() => Reflect.get(window, 'fixtureCatalogs'))).toBe(2);
  await page.keyboard.press('Escape');
  const ended = page.getByRole('button', { name: 'Encerrados (2)', exact: true });
  await ended.click();
  await expect(page.getByText('Estado incerto', { exact: true })).toBeVisible();
  const uncertainRow = page.locator('.pane-lifecycle-ended > ul > li').filter({ hasText: 'T-002' });
  const recovery = uncertainRow.getByText('Ver detalhes', { exact: true });
  await expect(recovery).toBeVisible();
  await expect(uncertainRow.getByRole('button', { name: 'Remover da Feature' })).toHaveCount(0);
  await recovery.click();
  await expect(
    uncertainRow.getByText('A propriedade desta sessão ainda não foi verificada.'),
  ).toBeVisible();
  await capture('recovery', 1440);
  await recovery.click();
  await expect(page.getByRole('button', { name: 'Remover da Feature' })).toBeVisible();
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
  await expect(page.getByRole('button', { name: 'Encerrados (3)', exact: true })).toBeVisible();
  await expect(page.locator('.ts-dock + .pane-lifecycle-dock .pane-lifecycle-ended')).toBeVisible();
  const endedRows = page.locator('.pane-lifecycle-ended > ul').getByRole('listitem');
  await expect(endedRows.filter({ hasText: 'T-001' })).toContainText('Encerrado');
  await expect(endedRows.filter({ hasText: 'T-003' })).toContainText('Encerrado');
  await capture('ended', 1440);
  await page.setViewportSize({ width: 1280, height: 800 });
  await capture('ended', 1280);
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
