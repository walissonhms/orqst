import { z } from 'zod';
import { terminalDisplayNameSchema } from './terminal-workspace.js';
import { TERMINAL_SLOT_CEILING } from './terminal-capacity.js';

export const featureScopeSchema = z.strictObject({
  workspaceId: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/),
  featureId: z.uuid(),
});
export type FeatureScope = z.infer<typeof featureScopeSchema>;
export const featureStatusSchema = z.enum([
  'planned',
  'active',
  'blocked',
  'completed',
  'archived',
]);
export type FeatureStatus = z.infer<typeof featureStatusSchema>;
export const featureCreateSchema = z.strictObject({
  workspaceId: featureScopeSchema.shape.workspaceId,
  name: terminalDisplayNameSchema,
  description: z.string().max(2048).default(''),
  status: featureStatusSchema.default('planned'),
});
export const featureUpdateSchema = z
  .strictObject({
    expectedRevision: z.number().int().positive().safe(),
    name: terminalDisplayNameSchema.optional(),
    description: z.string().max(2048).optional(),
    status: featureStatusSchema.optional(),
  })
  .refine(
    (value) =>
      value.name !== undefined || value.description !== undefined || value.status !== undefined,
    'Feature update is empty',
  );
export type FeatureCreate = z.input<typeof featureCreateSchema>;
export type FeatureUpdate = z.infer<typeof featureUpdateSchema>;
export const workspaceFeatureSchema = featureScopeSchema.extend({
  schemaVersion: z.literal(1),
  name: terminalDisplayNameSchema,
  description: z.string().max(2048),
  status: featureStatusSchema,
  revision: z.number().int().positive().safe(),
  terminalIds: z
    .array(z.uuid())
    .max(TERMINAL_SLOT_CEILING)
    .refine((ids) => new Set(ids).size === ids.length),
  createdAt: z.number().int().nonnegative().safe(),
  updatedAt: z.number().int().nonnegative().safe(),
});
export type WorkspaceFeature = z.infer<typeof workspaceFeatureSchema>;
export const featureConfigurationEventSchema = featureScopeSchema.extend({
  schemaVersion: z.literal(1),
  sequence: z.number().int().positive().safe(),
  action: z.enum([
    'feature.created',
    'feature.updated',
    'feature.archived',
    'feature.terminal_added',
  ]),
  revision: z.number().int().positive().safe(),
  timestamp: z.number().int().nonnegative().safe(),
  terminalId: z.uuid().nullable(),
});

/** Persisted visual context only; never a runtime activation or an authorization grant. */
export const featureViewStateSchema = z.strictObject({
  contractVersion: z.literal(1),
  storage: z.literal('core'),
  workspaceId: featureScopeSchema.shape.workspaceId,
  featureId: z.uuid().nullable(),
  revision: z.number().int().nonnegative().safe(),
});
export type FeatureViewState = z.infer<typeof featureViewStateSchema>;
export const featureViewSaveSchema = z.strictObject({
  expectedRevision: z.number().int().nonnegative().safe(),
  featureId: z.uuid().nullable(),
});
