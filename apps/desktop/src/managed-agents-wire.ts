import { z } from 'zod';
import { paneRoutingUpdateSchema } from '@orqst/protocol';
const slot = z.number().int().min(0).max(1);
const proof = z.strictObject({
  challengeId: z.uuid(),
  signature: z.string().regex(/^[A-Za-z0-9_-]{86}$/),
});
export const agentsHostRequestSchema = z.discriminatedUnion('operation', [
  z.strictObject({ id: z.uuid(), operation: z.literal('snapshot') }),
  z.strictObject({ id: z.uuid(), operation: z.literal('prepareRetire') }),
  z.strictObject({ id: z.uuid(), operation: z.literal('retire'), proof }),
  z.strictObject({
    id: z.uuid(),
    operation: z.literal('prepareRouting'),
    slot,
    update: paneRoutingUpdateSchema,
  }),
  z.strictObject({ id: z.uuid(), operation: z.literal('applyRouting'), changeId: z.uuid(), proof }),
  z.strictObject({
    id: z.uuid(),
    operation: z.literal('prepareStart'),
    slot,
    model: z.string().trim().min(1).max(128),
  }),
  z.strictObject({ id: z.uuid(), operation: z.literal('launch'), slot, proof }),
  z.strictObject({
    id: z.uuid(),
    operation: z.literal('prepareTask'),
    sourceSlot: slot.default(0),
    text: z.string().min(1).max(2048),
    task: z.string().min(1).max(1024),
  }),
  z.strictObject({
    id: z.uuid(),
    operation: z.literal('runTask'),
    taskId: z.uuid(),
    correlationId: z.uuid(),
    proof,
  }),
  z.strictObject({ id: z.uuid(), operation: z.literal('prepareStop'), slot }),
  z.strictObject({ id: z.uuid(), operation: z.literal('stop'), slot, proof }),
]);
export const agentsHostReplySchema = z.strictObject({
  id: z.uuid(),
  ok: z.boolean(),
  value: z.unknown(),
});
export type AgentsHostOperation = Omit<z.infer<typeof agentsHostRequestSchema>, 'id'>;
