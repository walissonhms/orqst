import { z } from 'zod';
import { communicationContentSchema, communicationPaneSchema } from './pane-communication.js';

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
const revision = z.number().int().nonnegative().safe();
const timestamp = z.number().int().nonnegative().safe();
const operation = z.literal('task.request');
const policyOperation = z.enum(['task.request', 'task.view']);

/** Cross-Feature rules are independent from the local Feature permission matrix. */
export const crossFeatureRuleSchema = z.strictObject({
  direction: z.enum(['outbound', 'inbound']),
  localTerminalId: z.uuid(),
  remoteFeatureId: z.uuid(),
  remoteTerminalId: z.uuid(),
  operation: policyOperation,
});
export const crossFeaturePolicySchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    rules: z.array(crossFeatureRuleSchema).max(256),
  })
  .superRefine(({ rules }, ctx) => {
    const keys = rules.map((rule) => JSON.stringify(rule));
    if (new Set(keys).size !== keys.length)
      ctx.addIssue({ code: 'custom', message: 'Duplicate cross-Feature rule' });
  });
export type CrossFeaturePolicy = z.infer<typeof crossFeaturePolicySchema>;
export const crossFeaturePolicyStateSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    workspaceId: id,
    featureId: z.uuid(),
    revision,
    policy: crossFeaturePolicySchema.nullable(),
  })
  .refine((state) => (state.revision === 0) === (state.policy === null));
export type CrossFeaturePolicyState = z.infer<typeof crossFeaturePolicyStateSchema>;

export const crossFeatureEndpointSchema = z.strictObject({
  featureId: z.uuid(),
  terminalId: z.uuid(),
  paneId: z.uuid(),
  binding: communicationPaneSchema.shape.binding.unwrap(),
});
/** The authority port must bind this entire value to a trusted native confirmation. */
export const crossFeatureGrantSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    grantId: z.uuid(),
    intentId: z.uuid(),
    intentDigest: z.string().regex(/^[a-f0-9]{64}$/),
    actorId: id,
    workspaceId: id,
    source: crossFeatureEndpointSchema,
    target: crossFeatureEndpointSchema,
    operation,
    nonce: z.uuid(),
    deadline: timestamp,
    sourceRevision: revision,
    targetRevision: revision,
  })
  .refine(
    (grant) =>
      grant.source.featureId !== grant.target.featureId &&
      grant.source.terminalId !== grant.target.terminalId &&
      grant.source.paneId !== grant.target.paneId,
  );
export type CrossFeatureGrant = z.infer<typeof crossFeatureGrantSchema>;
export const crossFeatureRequestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  messageId: z.uuid(),
  taskId: z.uuid(),
  idempotencyKey: id,
  payload: communicationContentSchema,
});
export type CrossFeatureRequest = z.infer<typeof crossFeatureRequestSchema>;

export const crossFeatureMessageSchema = z.strictObject({
  schemaVersion: z.literal(1),
  grant: crossFeatureGrantSchema,
  request: crossFeatureRequestSchema,
  state: z.enum(['queued', 'dispatching', 'outcome_unknown']),
  createdAt: timestamp,
  updatedAt: timestamp,
});
export type CrossFeatureMessage = z.infer<typeof crossFeatureMessageSchema>;
export const crossFeatureAuditSchema = z.strictObject({
  schemaVersion: z.literal(1),
  eventId: z.uuid(),
  sequence: z.number().int().positive().safe(),
  timestamp,
  actorId: id,
  workspaceId: id,
  sourceFeatureId: z.uuid(),
  targetFeatureId: z.uuid(),
  sourceTerminalId: z.uuid(),
  targetTerminalId: z.uuid(),
  sourcePaneId: z.uuid(),
  targetPaneId: z.uuid(),
  operation,
  grantId: z.uuid(),
  intentId: z.uuid(),
  messageId: z.uuid(),
  sourceRevision: revision,
  targetRevision: revision,
  outcome: z.enum(['admitted', 'dispatch_claimed', 'outcome_unknown']),
});
export type CrossFeatureAudit = z.infer<typeof crossFeatureAuditSchema>;

export const crossFeatureRouteSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    workspaceId: id,
    source: crossFeatureEndpointSchema,
    target: crossFeatureEndpointSchema,
  })
  .refine(
    (route) =>
      route.source.featureId !== route.target.featureId &&
      route.source.paneId !== route.target.paneId,
  );
export type CrossFeatureRoute = z.infer<typeof crossFeatureRouteSchema>;

/** Compact journal accounting, independent of captured message metadata. */
export interface CrossFeatureUsage {
  messageId: string;
  actorId: string;
  targetPaneId: string;
  state: CrossFeatureMessage['state'];
  createdAt: number;
}
