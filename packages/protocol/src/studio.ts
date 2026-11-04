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
export interface DesktopStudio {
  readonly contractVersion: 1;
  request(request: StudioRequest): Promise<StudioReply>;
}
