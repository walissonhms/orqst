import { z } from 'zod';
import {
  featureCreateSchema,
  featureUpdateSchema,
  featureViewStateSchema,
  workspaceFeatureSchema,
} from './features.js';

const base = { contractVersion: z.literal(1), generation: z.number().int().nonnegative().safe() };
const featureId = z.uuid();
/** Metadata/view only. No process bindings, paths, execution proofs, team grants or generic RPC. */
export const featureNativeRequestSchema = z.discriminatedUnion('action', [
  z.strictObject({ ...base, action: z.literal('snapshot') }),
  z.strictObject({
    ...base,
    action: z.literal('create'),
    input: featureCreateSchema.omit({ workspaceId: true }),
  }),
  z.strictObject({ ...base, action: z.literal('update'), featureId, input: featureUpdateSchema }),
  z.strictObject({
    ...base,
    action: z.literal('assign'),
    featureId,
    slot: z.number().int().min(0).max(7),
    expectedRevision: z.number().int().positive().safe(),
  }),
  z.strictObject({
    ...base,
    action: z.literal('select'),
    featureId: featureId.nullable(),
    expectedRevision: z.number().int().nonnegative().safe(),
  }),
  z.strictObject({
    ...base,
    action: z.literal('organize'),
    command: z.enum(['restore', 'show-all', 'columns-1', 'columns-2', 'columns-3']),
  }),
]);
export type FeatureNativeRequest = z.input<typeof featureNativeRequestSchema>;
export const featureNativeSnapshotSchema = z
  .strictObject({
    contractVersion: z.literal(1),
    storage: z.literal('core'),
    generation: base.generation,
    workspace: z.strictObject({
      id: featureViewStateSchema.shape.workspaceId,
      name: z.string().min(1).max(2048),
    }),
    features: z.array(workspaceFeatureSchema).max(1024),
    view: featureViewStateSchema,
    activeFeatureId: z.uuid().nullable(),
    slots: z
      .array(
        z.strictObject({
          slot: z.number().int().min(0).max(7),
          terminalId: z.uuid(),
          provider: z.enum(['codex', 'claude', 'opencode']),
        }),
      )
      .min(1)
      .max(8),
    layoutSaved: z.boolean(),
  })
  .refine((value) => {
    const assignments = value.features.flatMap((feature) => feature.terminalIds);
    return (
      value.view.workspaceId === value.workspace.id &&
      value.features.every((feature) => feature.workspaceId === value.workspace.id) &&
      new Set(value.features.map((feature) => feature.featureId)).size === value.features.length &&
      new Set(assignments).size === assignments.length &&
      value.slots.every((slot, index) => slot.slot === index) &&
      new Set(value.slots.map((slot) => slot.terminalId)).size === value.slots.length &&
      (value.activeFeatureId === null ||
        value.features.some((feature) => feature.featureId === value.activeFeatureId)) &&
      (value.view.featureId === null ||
        value.features.some((feature) => feature.featureId === value.view.featureId))
    );
  }, 'Invalid Feature snapshot scope');
export type FeatureNativeSnapshot = z.infer<typeof featureNativeSnapshotSchema>;
export const featureNativeReplySchema = z
  .strictObject({
    status: z.enum(['ok', 'denied', 'stale', 'busy', 'unavailable', 'archive_blocked']),
    snapshot: featureNativeSnapshotSchema.optional(),
  })
  .refine(
    (value) => value.status !== 'ok' || value.snapshot !== undefined,
    'Missing Feature snapshot',
  );
export type FeatureNativeReply = z.infer<typeof featureNativeReplySchema>;
export interface DesktopFeatures {
  readonly contractVersion: 1;
  request(input: FeatureNativeRequest): Promise<FeatureNativeReply>;
}
