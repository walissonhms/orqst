import { z } from 'zod';
import { artifactReferenceSchema, observedSessionIdentitySchema } from './lifecycle.js';

export const artifactTextLimit = 32_768;
export const artifactExtractionRequestSchema = z
  .object({
    contractVersion: z.literal(1),
    sequence: z.number().int().positive(),
    eventId: artifactReferenceSchema.shape.evidence.shape.eventId,
    sessionId: observedSessionIdentitySchema.shape.sessionRef.shape.nativeSessionId,
    machineId: observedSessionIdentitySchema.shape.sessionRef.shape.machineId,
    adapter: z.enum(['codex', 'claude', 'opencode', 'manual']),
    workspaceId: observedSessionIdentitySchema.shape.workspaceId,
    agentId: observedSessionIdentitySchema.shape.observedAgent.shape.id,
    sourceHash: artifactReferenceSchema.shape.evidence.shape.source.shape.hash,
  })
  .strict();
export type ArtifactExtractionRequest = z.infer<typeof artifactExtractionRequestSchema>;

/** A manually selected retained message, never a claim of automatic document detection. */
export const extractedArtifactSchema = z
  .object({
    contract: z.literal('orqst.artifacts'),
    contractVersion: z.literal(1),
    selection: z.literal('manual_message'),
    eventSchemaVersion: z.literal(1),
    reference: artifactReferenceSchema,
    original: z
      .object({
        text: z
          .string()
          .min(1)
          .max(artifactTextLimit)
          .refine((text) => new TextEncoder().encode(text).byteLength <= artifactTextLimit),
        representation: z.literal('retained_redacted_text'),
        completeness: z.literal('not_verified'),
      })
      .strict(),
  })
  .strict();
export type ExtractedArtifact = z.infer<typeof extractedArtifactSchema>;

export const artifactExtractionResultSchema = z.discriminatedUnion('availability', [
  z.object({ availability: z.literal('available'), value: extractedArtifactSchema }).strict(),
  z
    .object({
      availability: z.literal('unavailable'),
      reason: z.enum([
        'event_not_retained',
        'identity_mismatch',
        'unsupported_adapter',
        'not_artifact_message',
        'content_limit',
      ]),
    })
    .strict(),
]);
export type ArtifactExtractionResult = z.infer<typeof artifactExtractionResultSchema>;
