import { z } from 'zod';

/** Native-owned pipe only. Never accepted from the renderer or an observed session. */
export const ownedTurnAlertSchema = z.strictObject({
  contractVersion: z.literal(1),
  kind: z.literal('owned-turn-alert'),
  epoch: z.uuid(),
  slot: z.number().int().min(0).max(7),
  terminalId: z.uuid(),
  turnId: z.uuid(),
  category: z.enum(['completed', 'failed', 'waiting_for_user']),
  silent: z.boolean(),
  observedAt: z.number().int().nonnegative().safe(),
});
