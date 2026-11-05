import { z } from 'zod';
import {
  featureCreateSchema,
  featureUpdateSchema,
  featureViewStateSchema,
  workspaceFeatureSchema,
} from './features.js';
import { terminalDisplayNameSchema } from './terminal-workspace.js';
import {
  featurePermissionConfigurationSchema,
  featurePermissionStateSchema,
} from './feature-permissions.js';

const base = { contractVersion: z.literal(1), generation: z.number().int().nonnegative().safe() };
const featureId = z.uuid();
const logical = z.number().finite().min(0).max(32768);
const arrangementPaneSchema = z
  .strictObject({
    slot: z.number().int().min(0).max(7),
    terminalId: z.uuid(),
    visible: z.boolean(),
    z: z.number().int().min(0).max(255),
    rect: z
      .strictObject({
        x: logical,
        y: logical,
        width: logical.positive(),
        height: logical.positive(),
      })
      .nullable(),
  })
  .refine((pane) => pane.visible === (pane.rect !== null));
/** Metadata/view only. No process bindings, paths, execution proofs, team grants or generic RPC. */
export const featureNativeRequestSchema = z.discriminatedUnion('action', [
  z.strictObject({ ...base, action: z.literal('snapshot') }),
  z.strictObject({ ...base, action: z.literal('canvas') }),
  z
    .strictObject({
      ...base,
      action: z.literal('arrange'),
      layoutVersion: z.union([z.literal(1), z.literal(2)]),
      chrome: z
        .strictObject({
          sidebar: z.union([z.literal(0), z.literal(46), z.literal(155)]),
          top: z.union([z.literal(36), z.literal(81)]),
          bottom: z.literal(34),
        })
        .optional(),
      mode: z.enum(['mosaic', 'columns', 'rows', 'focus', 'list', 'free']),
      viewport: z.strictObject({
        width: z.number().int().positive().max(32768),
        height: z.number().int().positive().max(32768),
      }),
      panes: z.array(arrangementPaneSchema).max(8),
    })
    .refine(
      (value) =>
        ((value.layoutVersion === 1 && value.chrome === undefined) ||
          (value.layoutVersion === 2 && value.chrome !== undefined)) &&
        new Set(value.panes.map((pane) => pane.slot)).size === value.panes.length &&
        new Set(value.panes.map((pane) => pane.terminalId)).size === value.panes.length &&
        (value.mode !== 'list' || value.panes.every((pane) => !pane.visible)) &&
        (value.mode !== 'focus' || value.panes.filter((pane) => pane.visible).length <= 1),
    ),
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
  z.strictObject({
    ...base,
    action: z.literal('pane'),
    slot: z.number().int().min(0).max(7),
    terminalId: z.uuid(),
    command: z.enum(['focus', 'hide', 'maximize', 'restore', 'move-earlier', 'move-later']),
  }),
  z.strictObject({
    ...base,
    action: z.literal('renamePane'),
    slot: z.number().int().min(0).max(7),
    terminalId: z.uuid(),
    name: terminalDisplayNameSchema,
  }),
  z.strictObject({
    ...base,
    action: z.literal('movePane'),
    slot: z.number().int().min(0).max(7),
    terminalId: z.uuid(),
    beforeSlot: z.number().int().min(0).max(7),
    beforeTerminalId: z.uuid(),
  }),
]);
export type FeatureNativeRequest = z.input<typeof featureNativeRequestSchema>;
/** Accepted only on the inherited native-to-host pipe, never by feature_request. */
export const featurePermissionNativeRequestSchema = z.discriminatedUnion('action', [
  z.strictObject({
    ...base,
    action: z.literal('readPermissions'),
    featureId,
  }),
  z.strictObject({
    ...base,
    action: z.literal('savePermissions'),
    featureId,
    expectedRevision: z.number().int().nonnegative().safe(),
    expectedFeatureRevision: z.number().int().positive().safe(),
    expectedViewRevision: z.number().int().nonnegative().safe(),
    configuration: featurePermissionConfigurationSchema,
    reviewPlan: z.string().min(1).max(131072),
    reviewDigest: z.string().regex(/^[0-9a-f]{64}$/),
  }),
]);
export const featurePermissionNativeEnvelopeSchema = z.strictObject({
  kind: z.literal('feature-permission-request'),
  actorId: z.string().regex(/^native-[a-fA-F0-9-]{36}$/),
  id: z.uuid(),
  document: z.number().int().positive().safe(),
  source: z.literal('orqst-features://local/index.html'),
  request: featurePermissionNativeRequestSchema,
});

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
          workspace: z
            .strictObject({
              id: featureViewStateSchema.shape.workspaceId,
              name: z.string().min(1).max(2048),
            })
            .optional(),
          agentState: z
            .enum(['running', 'waiting_for_user', 'completed', 'failed', 'unknown'])
            .optional(),
          // A recorded selection, not a claim about the model actually used by the CLI.
          selectedModel: z
            .string()
            .min(1)
            .max(160)
            .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/#@+-]*$/)
            .nullable()
            .optional(),
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
      value.slots.every(
        (slot) =>
          !slot.workspace ||
          (slot.workspace.id === value.workspace.id &&
            slot.workspace.name === value.workspace.name),
      ) &&
      new Set(value.slots.map((slot) => slot.terminalId)).size === value.slots.length &&
      (value.activeFeatureId === null ||
        value.features.some((feature) => feature.featureId === value.activeFeatureId)) &&
      (value.view.featureId === null ||
        value.features.some((feature) => feature.featureId === value.view.featureId))
    );
  }, 'Invalid Feature snapshot scope');
export type FeatureNativeSnapshot = z.infer<typeof featureNativeSnapshotSchema>;
export const featureCanvasSessionEvidenceSchema = z.strictObject({
  session: z.strictObject({
    provider: z.literal('claude'),
    sessionId: z.uuid(),
    bindingEvidence: z.literal('claude-argv-receipt-transcript'),
  }),
  activities: z
    .array(
      z.strictObject({
        at: z.number().int().nonnegative().safe(),
        kind: z.literal('tool'),
        label: z.string().regex(/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/),
      }),
    )
    .max(3),
  agentState: z.enum(['running', 'completed', 'failed', 'unknown']),
  turnId: z.uuid().optional(),
});
/** Display-only owned PTY evidence, never a session status or execution grant. */
export const featureCanvasEvidenceSchema = z
  .strictObject({
    observedAt: z.number().int().nonnegative().safe(),
    entries: z
      .array(
        z.strictObject({
          slot: z.number().int().min(0).max(7),
          terminalId: z.uuid(),
          state: z.enum(['running', 'exited', 'unknown']),
          startedAt: z.number().int().nonnegative().safe().optional(),
          exitedAt: z.number().int().nonnegative().safe().optional(),
          session: featureCanvasSessionEvidenceSchema.shape.session.optional(),
          activities: featureCanvasSessionEvidenceSchema.shape.activities.optional(),
          agentState: featureCanvasSessionEvidenceSchema.shape.agentState.optional(),
          turnId: featureCanvasSessionEvidenceSchema.shape.turnId,
        }),
      )
      .max(8),
  })
  .refine(
    (value) =>
      new Set(value.entries.map((entry) => entry.slot)).size === value.entries.length &&
      new Set(value.entries.map((entry) => entry.terminalId)).size === value.entries.length &&
      value.entries.every(
        (entry) =>
          (entry.session === undefined
            ? entry.activities === undefined &&
              entry.agentState === undefined &&
              entry.turnId === undefined
            : entry.state !== 'unknown' &&
              entry.activities !== undefined &&
              entry.agentState !== undefined &&
              (entry.agentState === 'unknown' || entry.turnId !== undefined) &&
              entry.activities.every((activity) => activity.at <= value.observedAt)) &&
          (entry.state === 'unknown'
            ? entry.startedAt === undefined && entry.exitedAt === undefined
            : entry.startedAt !== undefined &&
              entry.startedAt <= value.observedAt &&
              (entry.state === 'running'
                ? entry.exitedAt === undefined
                : entry.exitedAt !== undefined &&
                  entry.exitedAt >= entry.startedAt &&
                  entry.exitedAt <= value.observedAt)),
      ),
  );
export type FeatureCanvasEvidence = z.infer<typeof featureCanvasEvidenceSchema>;
export const featureNativeReplySchema = z
  .strictObject({
    status: z.enum(['ok', 'denied', 'stale', 'busy', 'unavailable', 'unknown', 'archive_blocked']),
    snapshot: featureNativeSnapshotSchema.optional(),
    permissions: featurePermissionStateSchema.optional(),
    canvas: featureCanvasEvidenceSchema.optional(),
  })
  .refine(
    (value) => value.status !== 'ok' || value.snapshot !== undefined,
    'Missing Feature snapshot',
  )
  .refine(
    (value) =>
      !value.canvas ||
      (!!value.snapshot &&
        value.canvas.entries.every((entry) =>
          value.snapshot!.slots.some(
            (slot) =>
              slot.slot === entry.slot &&
              slot.terminalId === entry.terminalId &&
              (entry.session === undefined || entry.session.provider === slot.provider),
          ),
        )),
    'Canvas evidence outside snapshot scope',
  )
  .refine(
    (value) =>
      value.snapshot?.slots.every(
        (slot) =>
          !slot.agentState ||
          slot.agentState === 'unknown' ||
          value.canvas?.entries.some(
            (entry) =>
              entry.slot === slot.slot &&
              entry.terminalId === slot.terminalId &&
              entry.agentState === slot.agentState,
          ),
      ) ?? true,
    'Agent state requires matching owned turn evidence',
  );
export type FeatureNativeReply = z.infer<typeof featureNativeReplySchema>;

/** Private inherited pipe envelopes. Renderer commands accept only the inner request. */
export const featureNativeEnvelopeSchema = z.strictObject({
  kind: z.literal('feature-request'),
  id: z.uuid(),
  document: z.number().int().positive().safe(),
  source: z.string().min(1).max(4096),
  request: featureNativeRequestSchema,
});
export const featureNativeReplyEnvelopeSchema = z.strictObject({
  kind: z.literal('feature-reply'),
  id: z.uuid(),
  document: featureNativeEnvelopeSchema.shape.document,
  value: featureNativeReplySchema,
});
/** Passive native navigation only; deliberately separate from Core metadata requests. */
export const featurePreparationRequestSchema = z.strictObject({
  ...base,
  workspaceId: featureViewStateSchema.shape.workspaceId,
  featureId: featureId.nullable(),
  expectedRevision: z.number().int().nonnegative().safe(),
});
export type FeaturePreparationRequest = z.infer<typeof featurePreparationRequestSchema>;
export const featurePreparationReplySchema = z.strictObject({
  status: z.enum(['ok', 'denied', 'stale', 'busy', 'unavailable']),
});
export type FeaturePreparationReply = z.infer<typeof featurePreparationReplySchema>;

export interface DesktopFeatures {
  readonly contractVersion: 1;
  request(input: FeatureNativeRequest): Promise<FeatureNativeReply>;
  /** Passive native geometry; latest pending drag frame wins. */
  arrange?(
    input: Extract<FeatureNativeRequest, { action: 'arrange' }>,
  ): Promise<FeatureNativeReply>;
  showPreparationDrawer?(input: FeaturePreparationRequest): Promise<FeaturePreparationReply>;
}
