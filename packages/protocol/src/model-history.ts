import { z } from 'zod';
import { sessionMetricsRequestSchema } from './live-metrics.js';

export const sessionModelHistoryRequestSchema = sessionMetricsRequestSchema;
export const sessionModelHistoryLimits = Object.freeze({
  records: 32,
  recordBytes: 16 * 1024,
  evidenceBytes: 256 * 1024,
  responseBytes: 24 * 1024,
});
export const sessionModelHistoryResultSchema = z.discriminatedUnion('availability', [
  z
    .object({
      availability: z.literal('available'),
      value: z
        .object({
          contract: z.literal('orqst.session-model-history'),
          contractVersion: z.literal(1),
          sessionId: sessionModelHistoryRequestSchema.shape.sessionId,
          adapter: z.literal('codex'),
          coverage: z.literal('partial'),
          basis: z.literal('normalized_event_carried_identifier'),
          sourceVerification: z.literal('not_rechecked'),
          entries: z
            .array(
              z
                .object({
                  sequence: z.number().int().positive().safe(),
                  normalizedEventAt: z.iso.datetime({ offset: true }),
                  model: z.string().min(1).max(200).nullable(),
                  source: z
                    .object({
                      hash: z.string().regex(/^[a-f0-9]{64}$/),
                      recordType: z.enum([
                        'turn_context',
                        'event_msg:task_started',
                        'event_msg:token_count',
                        'token_usage_record',
                      ]),
                    })
                    .strict(),
                })
                .strict(),
            )
            .min(1)
            .max(sessionModelHistoryLimits.records),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      availability: z.literal('unavailable'),
      reason: z.enum([
        'session_not_found',
        'unsupported_adapter',
        'unsupported_schema',
        'evidence_missing',
        'evidence_limit',
        'invalid_evidence',
        'identity_conflict',
      ]),
    })
    .strict(),
]);
export type SessionModelHistoryResult = z.infer<typeof sessionModelHistoryResultSchema>;
