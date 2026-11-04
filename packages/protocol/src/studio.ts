import { z } from 'zod';
import { TERMINAL_SLOT_CEILING } from './terminal-capacity.js';

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
// Tauri exposes only its existing homogeneous native preparation flow.
export const tauriStudioRequestSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('snapshot') }),
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
});
export type TauriStudioSnapshot = z.infer<typeof tauriStudioSnapshotSchema>;
export const tauriStudioReplySchema = z
  .strictObject({
    status: z.enum(['ok', 'denied', 'focus_required', 'busy', 'unavailable']),
    snapshot: tauriStudioSnapshotSchema.optional(),
  })
  .refine((reply) => reply.status !== 'ok' || reply.snapshot !== undefined);
export interface TauriStudio {
  readonly contractVersion: 1;
  request(request: TauriStudioRequest): Promise<z.infer<typeof tauriStudioReplySchema>>;
}
export interface DesktopStudio {
  readonly contractVersion: 1;
  request(request: StudioRequest): Promise<StudioReply>;
}
