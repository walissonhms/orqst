import { z } from 'zod';
import { modelAnalyticsSummarySchema } from './analytics-export.js';

const dayMs = 86400000;
const usage = modelAnalyticsSummarySchema.shape.usage;

/** Separate projection: aggregate/export v1 and observed event streams stay unchanged. */
export const modelAnalyticsEvolutionSchema = z
  .object({
    contract: z.literal('orqst.model-analytics-evolution'),
    contractVersion: z.literal(1),
    summary: modelAnalyticsSummarySchema,
    bucketDays: z.number().int().positive().max(4194304),
    buckets: z
      .array(
        z
          .object({
            from: z.iso.datetime(),
            to: z.iso.datetime(),
            usage,
          })
          .strict(),
      )
      .max(64),
    undistributedUsage: usage,
  })
  .strict()
  .refine((report) => {
    if (!Number.isInteger(Math.log2(report.bucketDays))) return false;
    if (
      !report.buckets.every((bucket, index) => {
        const from = Date.parse(bucket.from);
        return (
          from % (report.bucketDays * dayMs) === 0 &&
          Date.parse(bucket.to) - from === report.bucketDays * dayMs &&
          (index === 0 || report.buckets[index - 1]!.to === bucket.from)
        );
      })
    )
      return false;
    const measured = [
      report.undistributedUsage,
      ...report.buckets.map((bucket) => bucket.usage),
    ].filter((item) => item !== null);
    return report.summary.usage === null
      ? measured.length === 0
      : measured.length > 0 &&
          (['input', 'output', 'cached', 'total'] as const).every((field) => {
            const sum = measured.reduce((total, item) => total + item[field], 0);
            return Number.isSafeInteger(sum) && sum === report.summary.usage![field];
          });
  });
export type ModelAnalyticsEvolution = z.infer<typeof modelAnalyticsEvolutionSchema>;
