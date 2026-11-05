import { z } from 'zod';

export const composerOriginSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('user') }),
  z.strictObject({ kind: z.literal('terminal'), terminalId: z.uuid() }),
]);
export const composerMentionInputSchema = z.strictObject({
  from: composerOriginSchema,
  to: z
    .array(z.uuid())
    .min(1)
    .max(8)
    .refine((ids) => new Set(ids).size === ids.length),
  text: z.string().min(1).max(4000),
});
export const composerMentionOutcomeSchema = z.discriminatedUnion('delivery', [
  z.strictObject({
    terminalId: z.uuid(),
    delivery: z.literal('unsupported'),
    reason: z.literal('no_structured_route'),
  }),
  z.strictObject({
    terminalId: z.uuid(),
    delivery: z.literal('denied'),
    reason: z.enum(['not_member', 'cross_feature_denied', 'unknown_terminal']),
  }),
]);
export const composerMentionReplySchema = z.strictObject({
  id: z.uuid(),
  outcomes: z.array(composerMentionOutcomeSchema).min(1).max(8),
});
export const composerMentionRecordSchema = composerMentionInputSchema
  .extend({
    id: z.uuid(),
    at: z.number().int().nonnegative().safe(),
    workspaceId: z.string().min(1).max(128),
    featureId: z.uuid().nullable(),
    outcomes: z.array(composerMentionOutcomeSchema).min(1).max(8),
  })
  .refine(
    (value) =>
      value.to.length === value.outcomes.length &&
      value.to.every((id, index) => id === value.outcomes[index]?.terminalId),
  );
export type ComposerMentionInput = z.infer<typeof composerMentionInputSchema>;
export const communicationProjectionSchema = z.strictObject({
  events: z
    .array(
      z.strictObject({
        id: z.uuid(),
        from: z.uuid(),
        to: z.uuid(),
        kind: z.enum(['message', 'delegation', 'result']),
        at: z.number().int().nonnegative().safe(),
      }),
    )
    .max(50),
});
