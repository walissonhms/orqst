import { z } from 'zod';
import { featureScopeSchema } from './features.js';

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
