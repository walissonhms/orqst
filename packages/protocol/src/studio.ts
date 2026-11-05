import { z } from 'zod';
import { TERMINAL_SLOT_CEILING } from './terminal-capacity.js';
import {
  terminalCatalogRequestSchema,
  terminalSelectedRequestSchema,
  terminalMcpPairRequestSchema,
  terminalPreparationCatalogSchema,
} from './terminal-preparation.js';

// Local Desktop chrome only: no paths, process operations, provider prompts or grants.
export const studioRequestSchema = z.strictObject({
  action: z.enum(['snapshot', 'createMixed', 'create', 'select', 'resumeReview', 'open']),
});
export type StudioRequest = z.infer<typeof studioRequestSchema>;
export const studioSnapshotSchema = z.strictObject({
  count: z.number().int().min(0).max(TERMINAL_SLOT_CEILING),
  limit: z.number().int().min(1).max(TERMINAL_SLOT_CEILING),
  opened: z.boolean(),
  prepared: z.boolean(),
  canCreate: z.boolean(),
  canSelect: z.boolean(),
  busy: z.boolean(),
});
export type StudioSnapshot = z.infer<typeof studioSnapshotSchema>;
export const studioReplySchema = z.strictObject({
  status: z.enum(['ok', 'denied', 'focus_required', 'busy', 'unavailable']),
  snapshot: studioSnapshotSchema.optional(),
});
export type StudioReply = z.infer<typeof studioReplySchema>;
// Native preparation choices carry no paths, launch proofs or task grants.
export const tauriStudioRequestSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('snapshot') }),
  z.strictObject({ action: z.literal('report-catalog-scope-mismatch') }),
  terminalCatalogRequestSchema,
  terminalSelectedRequestSchema.extend({
    generation: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  }),
  terminalMcpPairRequestSchema.extend({
    generation: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  }),
  z.strictObject({
    action: z.literal('create'),
    generation: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    provider: z.enum(['codex', 'claude']),
    count: z.number().int().min(1).max(8),
  }),
  z.strictObject({
    action: z.literal('review'),
    generation: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  }),
]);
export type TauriStudioRequest = z.infer<typeof tauriStudioRequestSchema>;
export const tauriStudioSnapshotSchema = z.strictObject({
  generation: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  limit: z.literal(8),
  count: z.number().int().min(0).max(8),
  busy: z.boolean(),
  canCreate: z.boolean(),
  canReview: z.boolean(),
  selectionLocked: z.boolean(),
  liveEnrollment: z.boolean().optional(),
});
export type TauriStudioSnapshot = z.infer<typeof tauriStudioSnapshotSchema>;
// Bounded native diagnostics only; never include exception text, stderr or local identities.
export const terminalPreparationFailureSchema = z
  .strictObject({
    stage: z.enum([
      'bootstrap',
      'request',
      'catalog',
      'selection',
      'plan',
      'review',
      'revalidation',
      'commit',
      'provision',
      'inspection',
      'feature_assignment',
      'opening',
      'admission_preflight',
      'core_admission',
      'core_startup',
    ]),
    code: z.enum([
      'failed',
      'catalog_changed',
      'selection_unavailable',
      'capacity_exceeded',
      'review_too_large',
      'selection_blocked',
      'capacity_reserved',
      'owned_exit_pending',
      'admission_invalid',
      'startup_failed',
      'startup_timeout',
      'startup_eof',
      'startup_protocol',
    ]),
    effects: z.enum(['not_started', 'possible']),
  })
  .refine(
    (failure) =>
      failure.effects === 'possible' ||
      (!failure.code.startsWith('startup_') &&
        ![
          'bootstrap',
          'provision',
          'inspection',
          'feature_assignment',
          'opening',
          'core_admission',
          'core_startup',
        ].includes(failure.stage)),
  );
export type TerminalPreparationFailure = z.infer<typeof terminalPreparationFailureSchema>;
export const tauriStudioReplySchema = z.union([
  z.strictObject({ status: z.literal('catalog'), catalog: terminalPreparationCatalogSchema }),
  z
    .strictObject({
      status: z.enum(['ok', 'denied', 'focus_required', 'busy', 'unavailable']),
      snapshot: tauriStudioSnapshotSchema.optional(),
      failure: terminalPreparationFailureSchema.optional(),
    })
    .refine((reply) => reply.status !== 'ok' || reply.snapshot !== undefined)
    .refine((reply) => !reply.failure || ['denied', 'unavailable'].includes(reply.status)),
]);
export interface TauriStudio {
  readonly contractVersion: 1;
  request(request: TauriStudioRequest): Promise<z.infer<typeof tauriStudioReplySchema>>;
}
export interface DesktopStudio {
  readonly contractVersion: 1;
  request(request: StudioRequest): Promise<StudioReply>;
}
