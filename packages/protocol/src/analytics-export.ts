import { z } from 'zod';
import { modelAnalyticsQuerySchema, type ModelAnalyticsSummary } from './analytics.js';

export const analyticsExportLimits = Object.freeze({
  responseBytes: 2 * 1024 * 1024,
  outputBytes: 2 * 1024 * 1024,
  models: 5000,
  modelChars: 256,
});

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const usage = z
  .object({ input: count, output: count, cached: count, total: count })
  .strict()
  .refine((value) => value.cached <= value.input && value.total === value.input + value.output);

const modelRow = z
  .object({
    adapter: z.enum(['codex', 'claude', 'opencode', 'manual']),
    provider: z.null(),
    model: z.string().nullable(),
    sessions: count,
    usage: usage.nullable(),
  })
  .strict();

/** Existing summary shape; export-only model limits must not remove legitimate screen data. */
export const modelAnalyticsSummarySchema = z
  .object({
    contract: z.literal('orqst.model-analytics'),
    contractVersion: z.literal(1),
    query: modelAnalyticsQuerySchema,
    basis: z
      .object({
        tokens: z.literal('retained_canonical_snapshot_deltas'),
        period: z.literal('fully_contained_intervals_half_open'),
        workspace: z.literal('current_session_assignment'),
        sessions: z.literal('observed_sessions_non_additive_across_models'),
        comparison: z.literal('descriptive_only'),
      })
      .strict(),
    usage: usage.nullable(),
    sessions: count,
    models: z.array(modelRow),
    coverage: z
      .object({
        scope: z.literal('before_model_filter'),
        complete: z.literal(false),
        reason: z.literal('source_coverage_unverified'),
        sessions: count,
        sessionsWithCanonicalUsage: count,
        unidentifiedContributions: count,
        gaps: z
          .array(
            z
              .object({
                reason: z.enum([
                  'usage_not_reported',
                  'canonical_evidence_missing',
                  'window_boundary',
                  'no_contained_measurement',
                  'invalid_usage',
                  'identity_conflict',
                  'non_monotonic_components',
                ]),
                count,
              })
              .strict(),
          )
          .max(7),
      })
      .strict(),
    unavailable: z
      .object({
        provider: z.literal('not_recorded'),
        reasoningTokens: z.literal('not_recorded'),
        executions: z.literal('not_recorded'),
        duration: z.literal('not_measured'),
        successRate: z.literal('task_outcomes_not_recorded'),
        tokensPerExecution: z.literal('executions_not_recorded'),
        tokensPerCompletedTask: z.literal('equivalent_tasks_not_recorded'),
        cost: z.literal('verified_prices_and_billing_not_recorded'),
        taskEquivalence: z.literal('not_recorded'),
      })
      .strict(),
  })
  .strict() satisfies z.ZodType<ModelAnalyticsSummary>;

/** Export admission only; no defaults, coercion, individual evidence or silent stripping. */
export const modelAnalyticsExportSourceSchema = modelAnalyticsSummarySchema
  .extend({
    models: z
      .array(
        modelRow.extend({
          model: z
            .string()
            .min(1)
            .max(analyticsExportLimits.modelChars)
            .refine((text) => new TextDecoder().decode(new TextEncoder().encode(text)) === text)
            .nullable(),
        }),
      )
      .max(analyticsExportLimits.models),
  })
  .refine((report) => {
    const keys = report.models.map((row) => JSON.stringify([row.adapter, row.model]));
    const reasons = report.coverage.gaps.map((gap) => gap.reason);
    const measured = report.models.filter((row) => row.usage !== null);
    return (
      new Set(keys).size === keys.length &&
      new Set(reasons).size === reasons.length &&
      report.sessions <= report.coverage.sessions &&
      report.coverage.sessionsWithCanonicalUsage <= report.coverage.sessions &&
      report.models.every((row) => row.sessions <= report.sessions) &&
      (report.usage === null
        ? measured.length === 0
        : measured.length > 0 &&
          (['input', 'output', 'cached', 'total'] as const).every((key) => {
            const sum = measured.reduce((total, row) => total + row.usage![key], 0);
            return Number.isSafeInteger(sum) && sum === report.usage![key];
          }))
    );
  }) satisfies z.ZodType<ModelAnalyticsSummary>;
