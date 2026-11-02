import { z } from 'zod';
import type { AgentEvent, Usage } from './index.js';

/** Explicit instants; clients resolve calendar presets and time zones before querying. */
export const modelAnalyticsQuerySchema = z
  .object({
    from: z.iso.datetime({ offset: true }).optional(),
    to: z.iso.datetime({ offset: true }).optional(),
    workspaceId: z.string().min(1).optional(),
    agentId: z.string().min(1).optional(),
    adapter: z.enum(['codex', 'claude', 'opencode', 'manual']).optional(),
    // null selects unidentified attribution, omission selects every model.
    model: z.string().trim().min(1).nullable().optional(),
  })
  .strict()
  .refine((query) => !query.from || !query.to || Date.parse(query.from) < Date.parse(query.to), {
    message: 'from must precede to',
  });
export type ModelAnalyticsQuery = z.infer<typeof modelAnalyticsQuerySchema>;

export interface AnalyticsEvidence {
  eventId: string;
  sequence: number;
  timestamp: string;
  source: AgentEvent['source'];
  model: string | null;
  usageKind: AgentEvent['payload']['usageKind'] | null;
  responseId: string | null;
  turnId: string | null;
}

export interface ModelUsageContribution {
  machineId: string;
  sessionId: string;
  workspaceId: string;
  agentId: string;
  adapter: AgentEvent['adapter'];
  sessionMode: 'observed';
  model: string | null;
  attribution:
    'consistent_snapshot_models' | 'unbounded_snapshot' | 'model_missing' | 'model_changed';
  quality: 'observed';
  usage: Usage;
  // A null start means an all-history cumulative snapshot with unknown time distribution.
  interval: { from: string | null; to: string };
  start: AnalyticsEvidence | null;
  end: AnalyticsEvidence;
  modelEvidence: AnalyticsEvidence[];
}

export interface ModelAnalyticsRow {
  adapter: AgentEvent['adapter'];
  // The CLI adapter does not establish the model vendor or billing provider.
  provider: null;
  model: string | null;
  sessions: number;
  usage: Usage | null;
  contributions: ModelUsageContribution[];
}

export interface AnalyticsGap {
  sessionId: string;
  reason:
    | 'usage_not_reported'
    | 'canonical_evidence_missing'
    | 'window_boundary'
    | 'no_contained_measurement'
    | 'invalid_usage'
    | 'identity_conflict'
    | 'non_monotonic_components';
  eventIds: string[];
}

export interface ModelAnalyticsReport {
  contract: 'orqst.model-analytics';
  contractVersion: 1;
  query: ModelAnalyticsQuery;
  basis: {
    tokens: 'retained_canonical_snapshot_deltas';
    period: 'fully_contained_intervals_half_open';
    workspace: 'current_session_assignment';
    sessions: 'observed_sessions_non_additive_across_models';
    comparison: 'descriptive_only';
  };
  usage: Usage | null;
  sessions: number;
  models: ModelAnalyticsRow[];
  coverage: {
    scope: 'before_model_filter';
    complete: false;
    reason: 'source_coverage_unverified';
    sessions: number;
    sessionsWithCanonicalUsage: number;
    unidentifiedContributions: number;
    gaps: AnalyticsGap[];
  };
  unavailable: {
    provider: 'not_recorded';
    reasoningTokens: 'not_recorded';
    executions: 'not_recorded';
    duration: 'not_measured';
    successRate: 'task_outcomes_not_recorded';
    tokensPerExecution: 'executions_not_recorded';
    tokensPerCompletedTask: 'equivalent_tasks_not_recorded';
    cost: 'verified_prices_and_billing_not_recorded';
    taskEquivalence: 'not_recorded';
  };
}
