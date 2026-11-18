import { z } from 'zod';

const featureId = z.uuid();
const terminalId = z.uuid();
const senderId = z.union([terminalId, z.literal('owner')]);
export const inspectorCommandSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('read'), featureId }),
  z.strictObject({
    kind: z.literal('send'),
    featureId,
    targetFeatureId: featureId,
    from: senderId,
    to: z
      .array(terminalId)
      .min(1)
      .max(3)
      .refine((ids) => new Set(ids).size === ids.length),
    text: z.string().trim().min(1).max(4000),
    task: z.boolean(),
  }),
  z.strictObject({ kind: z.literal('retry'), featureId, id: z.uuid() }),
]);

const inspectorRowSchema = z.strictObject({
  id: z.uuid(),
  from: senderId,
  to: terminalId,
  kind: z.enum(['message', 'task', 'result']),
  at: z.number().int().nonnegative().safe(),
  text: z.string().max(1200),
  truncated: z.boolean(),
  delivery: z.enum(['queued', 'delivered', 'target_ended', 'unknown']),
  task: z.enum(['queued', 'dequeued', 'done', 'failed', 'blocked']).optional(),
  taskId: z.uuid().optional(),
  retryable: z.boolean(),
});

export const inspectorReplySchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('ok'),
    featureId,
    rows: z.array(inspectorRowSchema).max(20),
    recipients: z.array(terminalId).max(8),
    senders: z.array(terminalId).max(8),
  }),
  z.strictObject({ status: z.literal('queued') }),
  z.strictObject({
    status: z.literal('refused'),
    code: z.enum([
      'unavailable',
      'sender_unassigned',
      'unknown_terminal',
      'not_permitted',
      'inbox_full',
      'rate_limited',
      'too_many_tasks',
      'chain_too_deep',
      'target_ended',
    ]),
  }),
]);

export type InspectorCommand = z.infer<typeof inspectorCommandSchema>;
export type InspectorReply = z.infer<typeof inspectorReplySchema>;
export type InspectorRow = z.infer<typeof inspectorRowSchema>;
