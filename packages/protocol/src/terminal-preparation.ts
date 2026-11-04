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
export const terminalPreparationCatalogSchema = z.strictObject({
  contractVersion: z.literal(1),
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
              source: z.enum(['cli-default', 'native-config', 'cli-cache']),
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
