import { test, expect } from '@playwright/test';
import {
  featureNativeSnapshotSchema,
  inspectorCommandSchema,
  inspectorReplySchema,
  type FeatureNativeRequest,
} from '@orqst/protocol';
import { TerminalMessageHub } from '../../packages/core/src/terminal/mcp-hub.js';

const workspace = { id: 'synthetic', name: 'ORQST' };
const featureId = '00000000-0000-4000-8000-0000000000a1';
const otherFeatureId = '00000000-0000-4000-8000-0000000000a2';
const terminalIds = [
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000003',
  '00000000-0000-4000-8000-000000000004',
];
const slots = (['codex', 'claude', 'opencode', 'antigravity'] as const).map((provider, slot) => ({
  provider,
  slot,
  terminalId: terminalIds[slot]!,
  workspace,
  displayName: ['Orquestrador', 'Backend', 'Banco de dados', 'Revisão'][slot],
  selectedModel: ['gpt-6.2', 'opus', null, null][slot],
}));
const instant = Date.now();
const baseFeature = {
  workspaceId: workspace.id,
  schemaVersion: 1,
  status: 'active',
  description: '',
  createdAt: instant,
  updatedAt: instant,
  revision: 1,
};
const snapshot = featureNativeSnapshotSchema.parse({
  contractVersion: 1,
  storage: 'core',
  generation: 1,
  workspace,
  activeFeatureId: featureId,
  view: { contractVersion: 1, storage: 'core', featureId, workspaceId: workspace.id, revision: 1 },
  features: [
    {
      ...baseFeature,
      featureId,
      name: 'Autenticação',
      terminalIds,
      orchestratorTerminalId: terminalIds[0],
    },
    { ...baseFeature, featureId: otherFeatureId, name: 'Documentação', terminalIds: [] },
  ],
  slots,
  layoutSaved: true,
});
const read = { name: 'read_messages', arguments: {} };

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
]) {
  test(`Communication Inspector ${viewport.width}×${viewport.height}`, async ({ page }) => {
    const hub = new TerminalMessageHub(() =>
      slots.slice(0, 3).map((slot) => ({
        terminalId: slot.terminalId,
        alias: 'T-00' + (slot.slot + 1),
        name: slot.displayName!,
        provider: slot.provider,
        featureId,
        running: true,
      })),
    );
    for (const id of terminalIds.slice(0, 3)) hub.relayConnected(id, true);
    const originId = terminalIds[0]!;
    const targetId = terminalIds[1]!;
    const task = (await hub.call(originId, {
      name: 'delegate_task',
      arguments: { to: targetId, task: 'Revise a validação da sessão e envie o resultado.' },
    })) as { taskId: string };
    await hub.call(targetId, read);
    await hub.call(targetId, {
      name: 'submit_result',
      arguments: {
        taskId: task.taskId,
        status: 'done',
        summary: 'A validação da sessão passou na fixture.',
      },
    });
    await hub.call(originId, read);
    hub.ownerSend(featureId, terminalIds[2]!, 'Confira a migração do índice.');
    await page.setViewportSize(viewport);
    await page.exposeBinding('syntheticFeatureRequest', (source, request: FeatureNativeRequest) => {
      if (request.action === 'snapshot')
        return new URL(source.frame.url()).pathname === '/overview'
          ? { status: 'denied' }
          : { status: 'ok', snapshot };
      if (request.action === 'inspector')
        return {
          status: 'ok',
          snapshot,
          inspector: inspectorReplySchema.parse(
            hub.inspect(inspectorCommandSchema.parse(request.command)),
          ),
        };
      return { status: 'denied' };
    });
    await page.addInitScript(
      ({ workspaceId, featureId }) => {
        localStorage.setItem('i18nextLng', 'pt-BR');
        Object.defineProperty(window, 'orqstFeatures', {
          value: {
            contractVersion: 1,
            request: (request: unknown) => Reflect.get(window, 'syntheticFeatureRequest')(request),
          },
        });
        Object.defineProperty(window, 'orqstFeaturePermissions', {
          value: {
            read: async () => ({
              status: 'ok',
              permissions: {
                schemaVersion: 1,
                revision: 0,
                workspaceId,
                featureId,
                configuration: null,
              },
            }),
          },
        });
      },
      { workspaceId: workspace.id, featureId },
    );
    if (viewport.width === 1280) {
      await page.goto('/overview');
      await page.getByRole('link', { name: 'Comunicação', exact: true }).click();
      await expect(page).toHaveURL('/comunicacao');
    } else await page.goto('/comunicacao');
    await expect(page.getByRole('heading', { name: 'Comunicação', exact: true })).toBeVisible();
    const rows = page.locator('.communication-rows li');
    await expect(rows).toHaveCount(3);
    await expect(rows.filter({ hasText: 'Revise a validação' })).toContainText('Concluída');
    await expect(rows.filter({ hasText: 'Confira a migração' })).toContainText('Na fila');
    if (process.env.ORQST_SPEC_L4_SCREENSHOTS)
      await page.screenshot({
        path: `docs/development/spec-l4/communication-${viewport.width}x${viewport.height}.png`,
      });
    await page.getByRole('tab', { name: 'Fila' }).click();
    await expect(rows).toHaveCount(1);
    await page.getByRole('tab', { name: 'Auditoria' }).click();
    await expect(rows).toHaveCount(3);
    await expect(rows.filter({ hasText: 'Revise a validação' })).toHaveCount(0);
    await page.getByRole('tab', { name: 'Permissões' }).click();
    await expect(page.getByRole('table')).toBeVisible();
    await page.getByRole('tab', { name: 'Mensagens' }).click();
    await page.getByRole('button', { name: 'Delegar', exact: false }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Antigravity não tem MCP por sessão.')).toBeVisible();
    await expect(dialog.getByRole('radio', { name: /Antigravity/ })).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Outra Feature…' }).click();
    await expect(dialog.getByText('Envio entre Features exige autorização do Core.')).toBeVisible();
    await dialog.getByRole('button', { name: 'Esta Feature' }).click();
    await dialog.getByRole('searchbox', { name: 'Para' }).fill('backend');
    await dialog.getByRole('radio', { name: /T-002 Backend/ }).check();
    await expect(
      dialog.getByText('Entrega na fila do T-002 quando o turno atual terminar'),
    ).toBeVisible();
    await dialog
      .getByRole('textbox', { name: 'Mensagem' })
      .fill('Confira também a expiração do token.');
    if (process.env.ORQST_SPEC_L4_SCREENSHOTS)
      await page.screenshot({
        path: `docs/development/spec-l4/delegate-${viewport.width}x${viewport.height}.png`,
      });
    await dialog.getByRole('button', { name: 'Enviar', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(rows.filter({ hasText: 'Confira também a expiração' })).toContainText('Na fila');
  });
}
