import { z } from 'zod';
import { observedSessionIdentitySchema, retainedObservationEvidenceSchema } from './lifecycle.js';

const identity = observedSessionIdentitySchema.shape.workspaceId;
const timestamp = z.iso.datetime({ offset: true });
const count = z.number().int().nonnegative().safe();
export const confirmedUsageSchema = z
  .object({ input: count, output: count, cached: count, total: count })
  .strict()
  .refine((value) => value.cached <= value.input && value.total === value.input + value.output);

/** The schema-2 allowlist, not a complete event or a provider field-presence record. */
export const compactMetricMetadataSchema = z
  .object({
    id: identity,
    timestamp,
    machineId: identity,
    agentId: identity,
    adapter: z.enum(['codex', 'claude', 'opencode', 'manual']),
    sessionId: identity,
    workspaceId: identity,
    source: retainedObservationEvidenceSchema.shape.source,
    correlation: z.object({ turnId: identity.nullable() }).strict(),
    payload: z
      .object({
        model: z.string().nullable(),
        usage: confirmedUsageSchema.nullable(),
        usageKind: z
          .enum(['session_cumulative', 'response_incremental', 'turn_cumulative'])
          .nullable(),
        responseId: identity.nullable(),
      })
      .strict(),
  })
  .strict();

export const sessionMetricsRequestSchema = z.object({ sessionId: identity }).strict();
export const sessionMetricsSchema = z
  .object({
    contract: z.literal('orqst.live-metrics'),
    contractVersion: z.literal(1),
    identity: z
      .object({
        sessionRef: observedSessionIdentitySchema.shape.sessionRef,
        agentId: identity,
        sourceWorkspaceId: identity,
      })
      .strict(),
    usage: confirmedUsageSchema,
    usageKind: z.literal('session_cumulative'),
    normalization: z.literal('codex_session_snapshot'),
    fieldPresence: z.literal('not_preserved'),
    evidence: z
      .object({
        kind: z.literal('compact_evidence'),
        eventId: identity,
        sequence: z.number().int().positive().safe(),
        occurredAt: timestamp,
        observedAt: retainedObservationEvidenceSchema.shape.observedAt,
        sourceVerification: z.literal('not_rechecked'),
        source: retainedObservationEvidenceSchema.shape.source,
        turnId: identity.nullable(),
        responseId: identity.nullable(),
      })
      .strict(),
  })
  .strict();
export type SessionMetrics = z.infer<typeof sessionMetricsSchema>;
export const sessionMetricsResultSchema = z.discriminatedUnion('availability', [
  z.object({ availability: z.literal('available'), value: sessionMetricsSchema }).strict(),
  z
    .object({
      availability: z.literal('unavailable'),
      reason: z.enum([
        'session_not_found',
        'usage_not_recorded',
        'unsupported_adapter',
        'evidence_missing',
        'evidence_limit',
        'invalid_evidence',
        'identity_conflict',
      ]),
    })
    .strict(),
]);
export type SessionMetricsResult = z.infer<typeof sessionMetricsResultSchema>;
