import { z } from 'zod';
import { featureScopeSchema } from './features.js';
import { terminalDisplayNameSchema } from './terminal-workspace.js';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const terminalProviderSchema = z.enum(['codex', 'claude', 'opencode']);
const scope = {
  workspaceId: featureScopeSchema.shape.workspaceId,
  featureId: z.uuid().nullable(),
};
export const terminalCatalogRequestSchema = z.strictObject({
  action: z.literal('catalog'),
  ...scope,
});
export const terminalSelectedRequestSchema = z.strictObject({
  action: z.literal('create-selected'),
  ...scope,
  catalogId: digest,
  provider: terminalProviderSchema,
  modelId: digest,
  count: z.number().int().min(1).max(8),
});
export const terminalBatchRequestSchema = z.strictObject({
  action: z.literal('create-batch'),
  ...scope,
  catalogId: digest,
  requests: z
    .array(
      z.strictObject({
        id: z.uuid(),
        workspaceId: featureScopeSchema.shape.workspaceId,
        provider: terminalProviderSchema,
        modelId: digest.nullable(),
        name: terminalDisplayNameSchema,
        accountId: z.string().min(1).max(80).nullable().optional(),
      }),
    )
    .min(1)
    .max(8)
    .refine((items) => new Set(items.map((item) => item.id)).size === items.length),
});
export const terminalBatchItemSchema = z.strictObject({
  id: z.uuid(),
  status: z.enum(['accepted', 'refused', 'unknown']),
  reason: z.enum([
    'core_enrolled',
    'workspace_unsupported',
    'account_unsupported',
    'capacity_exceeded',
    'selection_unavailable',
    'catalog_changed',
    'review_cancelled',
    'context_changed',
    'preparation_failed',
    'capacity_reserved',
    'owned_exit_pending',
    'admission_invalid',
    'opening_uncertain',
    'not_attempted',
    'focus_required',
    'busy',
  ]),
  effects: z.enum(['not_started', 'possible']),
  terminalId: z.uuid().optional(),
  slot: z.number().int().min(0).max(7).optional(),
});
export const terminalBatchReplySchema = z
  .strictObject({
    status: z.literal('batch'),
    items: z.array(terminalBatchItemSchema).min(1).max(8),
  })
  .refine(({ items }) => {
    const terminalIds = items.flatMap((item) => (item.terminalId ? [item.terminalId] : []));
    const slots = items.filter((item) => item.status === 'accepted').map((item) => item.slot);
    return (
      new Set(items.map((item) => item.id)).size === items.length &&
      new Set(terminalIds).size === terminalIds.length &&
      new Set(slots).size === slots.length &&
      items.every((item) =>
        item.status === 'accepted'
          ? item.reason === 'core_enrolled' &&
            item.terminalId !== undefined &&
            item.slot !== undefined &&
            item.effects === 'possible'
          : item.status === 'unknown'
            ? item.effects === 'possible' &&
              item.reason !== 'core_enrolled' &&
              item.slot === undefined
            : item.effects === 'not_started' &&
              item.reason !== 'core_enrolled' &&
              item.terminalId === undefined &&
              item.slot === undefined,
      )
    );
  });
export type TerminalBatchRequest = z.infer<typeof terminalBatchRequestSchema>;
export type TerminalBatchItem = z.infer<typeof terminalBatchItemSchema>;
// Fresh bilateral opt-in only. Neither member, model nor direction is inferred.
export const terminalMcpPairRequestSchema = z.strictObject({
  action: z.literal('create-mcp-pair'),
  ...scope,
  catalogId: digest,
  sourceProvider: z.enum(['codex', 'opencode']),
  codexModelId: digest,
  openCodeModelId: digest,
});
export const terminalPreparationCatalogSchema = z.strictObject({
  contractVersion: z.literal(1),
  pendingOwnedExits: z
    .array(
      z.strictObject({
        id: z.uuid(),
        code: z.literal('owned_exit_pending'),
        principalCount: z.number().int().positive().max(1024),
      }),
    )
    .max(64)
    .optional(),
  ...scope,
  catalogId: digest,
  providers: z
    .array(
      z.strictObject({
        provider: terminalProviderSchema,
        status: z.enum(['available', 'unavailable']),
        reason: z.enum([
          'ready',
          'executable_not_found',
          'ambiguous_executable',
          'catalog_limited',
        ]),
        models: z
          .array(
            z.strictObject({
              id: digest,
              label: z.string().min(1).max(160),
              source: z.enum([
                'cli-default',
                'native-config',
                'cli-cache',
                'official-alias',
                'native-state',
              ]),
              isDefault: z.boolean(),
              availability: z.literal('unverified'),
            }),
          )
          .max(128),
      }),
    )
    .length(3),
});
export type TerminalPreparationCatalog = z.infer<typeof terminalPreparationCatalogSchema>;
export type TerminalSelectedRequest = z.infer<typeof terminalSelectedRequestSchema>;
