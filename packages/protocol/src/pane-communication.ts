import { z } from 'zod';

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
const time = z.number().int().nonnegative().safe();
export const communicationLimits = Object.freeze({
  panes: 128,
  messages: 1024,
  auditEvents: 16384,
  queuedPerPane: 32,
  activeTasks: 4,
  admissionsPerMinute: 30,
  payloadBytes: 16384,
  maxDepth: 3,
  lifetimeMs: 900000,
  dispatchMs: 10000,
});
export const paneCapabilitiesSchema = z.strictObject({
  /** Required for the source to originate work and for the target adapter to accept submission. */
  canSend: z.boolean(),
  canQueueWhileBusy: z.boolean(),
  canAcknowledge: z.boolean(),
  canReportTaskCompletion: z.boolean(),
  /** Source may cancel its own never-dispatched queue items. No provider cancellation exists yet. */
  canCancel: z.boolean(),
});
export type PaneCapabilities = z.infer<typeof paneCapabilitiesSchema>;
export const paneHandleSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]{1,31}$/);
export const paneRoutingSchema = z.strictObject({
  handle: paneHandleSchema,
  role: z.enum(['worker', 'reviewer', 'orchestrator']),
  allowedTargetPaneIds: z.array(z.uuid()).max(32),
});
export const paneRoutingUpdateSchema = paneRoutingSchema.extend({
  name: z.string().trim().min(1).max(100),
});
export type PaneRoutingUpdate = z.infer<typeof paneRoutingUpdateSchema>;
export const communicationPaneSchema = z.strictObject({
  schemaVersion: z.literal(1),
  paneId: z.uuid(),
  /** Stable terminal metadata link only; live message targets still use paneId/binding. */
  terminalId: z.uuid().optional(),
  workspaceId: id,
  displayId: z.string().regex(/^T-[0-9]{3,}$/),
  name: z.string().trim().min(1).max(100),
  // Legacy native compositions retain their exact per-task grants. Routed panes also require this matrix.
  routing: paneRoutingSchema.nullable().default(null),
  provider: id,
  cliVersion: z.string().min(1).max(100).nullable(),
  model: z.string().min(1).max(128).nullable(),
  ownership: z.enum(['managed', 'external']),
  ownerId: id,
  creationReason: z.string().min(1).max(200),
  binding: z
    .strictObject({
      instanceId: z.uuid(),
      projectId: id,
      terminalEpoch: z.uuid(),
    })
    .nullable(),
  capabilities: paneCapabilitiesSchema,
  state: z.enum(['ready', 'busy', 'unavailable', 'closed']),
  createdAt: time,
});
export type CommunicationPane = z.infer<typeof communicationPaneSchema>;

/** Opaque local content identity, never a URL or filesystem path. No content is persisted here. */
export const communicationContentSchema = z.strictObject({
  id,
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  bytes: z.number().int().min(1).max(communicationLimits.payloadBytes),
});
export type CommunicationContent = z.infer<typeof communicationContentSchema>;
export const paneSendSchema = z.strictObject({
  schemaVersion: z.literal(1),
  messageId: z.uuid(),
  taskId: z.uuid(),
  correlationId: z.uuid(),
  workspaceId: id,
  sourcePaneId: z.uuid(),
  targetPaneId: z.uuid(),
  parentTaskId: z.uuid().nullable(),
  kind: z.literal('task.request'),
  payload: communicationContentSchema,
  deliveryPolicy: z.literal('queue-if-busy'),
  idempotencyKey: id,
  deadline: time,
});
export type PaneSend = z.infer<typeof paneSendSchema>;
export const communicationMessageSchema = paneSendSchema.extend({
  actorId: id,
  grantId: z.uuid(),
  depth: z.number().int().min(0).max(communicationLimits.maxDepth),
  deliveryState: z.enum([
    'queued',
    'dispatching',
    'accepted',
    'delivered',
    'delivery_failed',
    'target_closed',
    'delivery_unknown',
  ]),
  taskState: z.enum([
    'pending',
    'running',
    'waiting_approval',
    'completed',
    'failed',
    'cancelled',
    'outcome_unknown',
  ]),
  createdAt: time,
  updatedAt: time,
  attemptId: z.uuid().nullable(),
  result: communicationContentSchema.nullable(),
  evidenceId: id.nullable(),
  reason: z
    .enum([
      'admitted',
      'dispatch',
      'provider_evidence',
      'cancelled_before_dispatch',
      'deadline',
      'target_closed',
      'transport_uncertain',
      'core_recovery',
      'reauthorized',
      'payload_unavailable',
    ])
    .nullable(),
});
export type CommunicationMessage = z.infer<typeof communicationMessageSchema>;
export const communicationAuditSchema = z.strictObject({
  sequence: z.number().int().positive(),
  timestamp: time,
  actorId: id.nullable(),
  workspaceId: id,
  paneId: z.uuid(),
  messageId: z.uuid().nullable(),
  action: z.enum([
    'pane_registered',
    'pane_renamed',
    'pane_routing_changed',
    'pane_state',
    'admitted',
    'state_changed',
    'denied',
    'reauthorized',
  ]),
  deliveryState: communicationMessageSchema.shape.deliveryState.nullable(),
  taskState: communicationMessageSchema.shape.taskState.nullable(),
});
export type CommunicationAudit = z.infer<typeof communicationAuditSchema>;
export const paneProviderEvidenceSchema = z
  .strictObject({
    messageId: z.uuid(),
    taskId: z.uuid(),
    correlationId: z.uuid(),
    targetPaneId: z.uuid(),
    attemptId: z.uuid(),
    instanceId: z.uuid(),
    terminalEpoch: z.uuid(),
    evidenceId: id,
    event: z.enum(['accepted', 'delivered', 'started', 'waiting_approval', 'completed', 'failed']),
    result: communicationContentSchema.optional(),
  })
  .superRefine((value, context) => {
    if ((value.event === 'completed') !== (value.result !== undefined))
      context.addIssue({ code: 'custom', message: 'Only completion requires a result reference' });
  });
export type PaneProviderEvidence = z.infer<typeof paneProviderEvidenceSchema>;

/** Private single-writer persistence boundary. No HTTP/MCP caller receives this interface. */
export interface CommunicationTransaction {
  panes(): CommunicationPane[];
  messages(): CommunicationMessage[];
  savePane(pane: CommunicationPane): void;
  saveMessage(message: CommunicationMessage): void;
  audit(event: Omit<CommunicationAudit, 'sequence'>): void;
  events(
    after: number,
    scope?: { workspaceId: string; paneId: string; actorId: string },
  ): CommunicationAudit[];
}
export interface CommunicationJournal {
  readonly epoch: string;
  transaction<T>(action: (tx: CommunicationTransaction) => T): T;
}
