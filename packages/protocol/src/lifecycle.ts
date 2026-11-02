import { z } from 'zod';

function hasControlCharacters(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
}

// Opaque identities are preserved, never trimmed or reconstructed from paths/prose.
const identitySchema = z
  .string()
  .min(1)
  .max(1024)
  .refine((value) => value.trim().length > 0 && !hasControlCharacters(value));
const unavailableIdentitySchema = z
  .object({ availability: z.literal('unavailable'), reason: z.literal('not_recorded') })
  .strict();
const availableIdentitySchema = z
  .object({ availability: z.literal('available'), value: identitySchema })
  .strict();

export const lifecycleRequestSchema = z
  .object({ sequence: z.number().int().positive(), contractVersion: z.literal(1) })
  .strict();

export const observedSessionIdentitySchema = z
  .object({
    sessionRef: z
      .object({
        machineId: identitySchema,
        adapterId: z.literal('codex'),
        nativeSessionId: identitySchema,
      })
      .strict(),
    workspaceId: identitySchema,
    observedAgent: z.object({ id: identitySchema, basis: z.literal('v1_agent_id') }).strict(),
    // The v1 agent ID is session-scoped, not proof of an independently owned worker.
    agentInstanceId: unavailableIdentitySchema,
  })
  .strict();

export const retainedObservationEvidenceSchema = z
  .object({
    kind: z.literal('retained_v1_event'),
    eventId: identitySchema,
    sequence: z.number().int().positive(),
    occurredAt: z.iso.datetime(),
    observedAt: z
      .object({ availability: z.literal('unavailable'), reason: z.literal('not_recorded') })
      .strict(),
    sourceVerification: z.literal('not_rechecked'),
    source: z
      .object({
        file: z
          .string()
          .min(1)
          .max(4096)
          .refine(
            (value) =>
              !/[\\:]/.test(value) &&
              !hasControlCharacters(value) &&
              value.split('/').every((part) => part !== '' && part !== '.' && part !== '..'),
          ),
        offset: z.number().int().nonnegative(),
        line: z.number().int().positive(),
        hash: z.string().regex(/^[a-f0-9]{64}$/),
        recordType: identitySchema,
      })
      .strict(),
  })
  .strict();

export const observedSessionEvidenceSchema = z
  .object({
    contract: z.literal('orqst.lifecycle'),
    contractVersion: z.literal(1),
    type: z.literal('observed_session.evidence'),
    mode: z.literal('observed'),
    identity: observedSessionIdentitySchema,
    evidence: retainedObservationEvidenceSchema,
    session: z
      .object({ state: z.literal('discoverable'), basis: z.literal('retained_history') })
      .strict(),
    turn: z
      .object({
        identity: z.discriminatedUnion('availability', [
          availableIdentitySchema,
          unavailableIdentitySchema,
        ]),
        state: z.discriminatedUnion('availability', [
          z
            .object({
              availability: z.literal('available'),
              value: z.enum(['running', 'waiting_for_user', 'completed', 'failed', 'interrupted']),
            })
            .strict(),
          z
            .object({
              availability: z.literal('unavailable'),
              reason: z.literal('no_turn_state_evidence'),
            })
            .strict(),
        ]),
      })
      .strict(),
    task: z
      .object({
        availability: z.literal('unavailable'),
        reason: z.literal('task_evidence_not_recorded'),
      })
      .strict(),
    process: z
      .object({
        availability: z.literal('unavailable'),
        reason: z.literal('process_not_observed'),
      })
      .strict(),
  })
  .strict();
export type ObservedSessionEvidence = z.infer<typeof observedSessionEvidenceSchema>;

/** An explicitly requested message reference, not an extracted or classified document. */
export const artifactReferenceSchema = z
  .object({
    contract: z.literal('orqst.lifecycle'),
    contractVersion: z.literal(1),
    type: z.literal('artifact.reference'),
    kind: z.literal('message_reference'),
    identity: observedSessionIdentitySchema,
    evidence: retainedObservationEvidenceSchema,
    turnIdentity: observedSessionEvidenceSchema.shape.turn.shape.identity,
    role: z.enum(['assistant', 'agent']),
    content: z
      .object({ availability: z.literal('unavailable'), reason: z.literal('reference_only') })
      .strict(),
  })
  .strict();
export type ArtifactReference = z.infer<typeof artifactReferenceSchema>;

export const observedSessionEvidenceResultSchema = z.discriminatedUnion('availability', [
  z.object({ availability: z.literal('available'), value: observedSessionEvidenceSchema }).strict(),
  z
    .object({
      availability: z.literal('unavailable'),
      reason: z.enum(['event_not_retained', 'unsupported_adapter']),
    })
    .strict(),
]);
export type ObservedSessionEvidenceResult = z.infer<typeof observedSessionEvidenceResultSchema>;

export const artifactReferenceResultSchema = z.discriminatedUnion('availability', [
  z.object({ availability: z.literal('available'), value: artifactReferenceSchema }).strict(),
  z
    .object({
      availability: z.literal('unavailable'),
      reason: z.enum(['event_not_retained', 'unsupported_adapter', 'not_artifact_message']),
    })
    .strict(),
]);
export type ArtifactReferenceResult = z.infer<typeof artifactReferenceResultSchema>;
