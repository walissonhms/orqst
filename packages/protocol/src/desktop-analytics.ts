import { z } from 'zod';
import { modelAnalyticsQuerySchema } from './analytics.js';

const localQuery = modelAnalyticsQuerySchema.safeExtend({
  from: z.iso.datetime({ offset: true }).max(64).optional(),
  to: z.iso.datetime({ offset: true }).max(64).optional(),
  workspaceId: z.string().min(1).max(200).optional(),
  agentId: z.string().min(1).max(200).optional(),
  model: z.string().min(1).max(200).nullable().optional(),
});
export const analyticsReadingSchema = z
  .object({
    query: localQuery,
    ranking: z.enum(['tokens', 'sessions']),
    cursor: z.number().int().nonnegative().safe(),
    obtainedAt: z.iso.datetime(),
    readingId: z.uuid(),
    digest: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type AnalyticsReading = z.infer<typeof analyticsReadingSchema>;
export const analyticsNativeRequestSchema = z.discriminatedUnion('action', [
  z
    .object({
      contractVersion: z.literal(1),
      action: z.literal('context'),
      generation: z.number().int().positive().safe(),
      reading: analyticsReadingSchema.nullable(),
    })
    .strict(),
  z
    .object({
      contractVersion: z.literal(1),
      action: z.literal('save'),
      generation: z.number().int().positive().safe(),
      reading: analyticsReadingSchema,
      format: z.enum(['csv', 'markdown']),
    })
    .strict(),
]);
export type AnalyticsNativeRequest = z.infer<typeof analyticsNativeRequestSchema>;
export type AnalyticsSaveRequest = Extract<AnalyticsNativeRequest, { action: 'save' }>;
export type AnalyticsNativeResult = {
  status:
    | 'acknowledged'
    | 'saved'
    | 'cancelled'
    | 'failed'
    | 'write_failed'
    | 'stale'
    | 'unavailable'
    | 'busy';
};
export interface DesktopAnalytics {
  readonly contractVersion: 1;
  setReading(
    reading: AnalyticsReading | null,
  ): Promise<{ generation: number; status: 'acknowledged' | 'failed' }>;
  save(
    format: 'csv' | 'markdown',
    generation: number,
    reading: AnalyticsReading,
  ): Promise<AnalyticsNativeResult>;
}
