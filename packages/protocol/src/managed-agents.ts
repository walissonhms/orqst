import { z } from 'zod';
import { communicationMessageSchema, communicationPaneSchema } from './pane-communication.js';

const slot = z.number().int().min(0).max(1);
export const managedAgentsRequestSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('snapshot'), version: z.literal(1) }),
  z.strictObject({ action: z.literal('retire'), version: z.literal(1) }),
  z.strictObject({
    action: z.literal('start'),
    version: z.literal(1),
    slot,
    model: z.string().trim().min(1).max(128),
  }),
  z.strictObject({
    action: z.literal('delegate'),
    version: z.literal(1),
    text: z.string().min(1).max(2048),
    task: z.string().min(1).max(1024),
  }),
  z.strictObject({ action: z.literal('stop'), version: z.literal(1), slot }),
]);
export type ManagedAgentsRequest = z.infer<typeof managedAgentsRequestSchema>;
export const managedAgentsSnapshotSchema = z.strictObject({
  project: z.string().max(2048),
  admission: z.enum(['unclaimed', 'reserved', 'retired']),
  canRetire: z.boolean(),
  slots: z
    .array(
      z
        .strictObject({
          instanceId: z.uuid(),
          state: z.enum([
            'prepared',
            'starting',
            'running',
            'exited',
            'start_failed',
            'ownership_lost',
          ]),
          pane: communicationPaneSchema.nullable(),
          nativeThreadId: z.string().max(200).nullable(),
          reportedModel: z.string().max(128).nullable(),
          startupPhase: z.string().max(32),
          launchFailure: z.string().max(32).nullable(),
          available: z.boolean(),
        })
        .nullable(),
    )
    .length(2),
  messages: z
    .array(
      communicationMessageSchema
        .pick({
          messageId: true,
          taskId: true,
          correlationId: true,
          sourcePaneId: true,
          targetPaneId: true,
          deliveryState: true,
          taskState: true,
        })
        .extend({ resultText: z.string().max(16384).nullable() }),
    )
    .max(16),
  root: z
    .strictObject({
      taskId: z.uuid(),
      correlationId: z.uuid(),
      state: z.enum(['running', 'completed', 'outcome_unknown']),
      resultText: z.string().max(16384).nullable(),
    })
    .nullable(),
});
export type ManagedAgentsSnapshot = z.infer<typeof managedAgentsSnapshotSchema>;
export const managedAgentsReplySchema = z.strictObject({
  status: z.enum(['ok', 'cancelled', 'busy', 'denied', 'unavailable']),
  snapshot: managedAgentsSnapshotSchema.optional(),
  empty: z.boolean().optional(),
});
export type ManagedAgentsReply = z.infer<typeof managedAgentsReplySchema>;
export interface DesktopManagedAgents {
  readonly contractVersion: 1;
  open(): Promise<void>;
}
