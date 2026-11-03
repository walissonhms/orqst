import {
  emptyUsage,
  type AnalyticsEvidence,
  type AnalyticsGap,
  type ModelAnalyticsQuery,
  type ModelAnalyticsReport,
  type ModelAnalyticsSummary,
  type ModelAnalyticsEvolution,
  type ModelAnalyticsRow,
  type ModelUsageContribution,
  type StoredEvent,
  type Usage,
} from '@orqst/protocol';

/** Only metric, identity and provenance fields are needed to replay attribution. */
export type AnalyticsEvent = Pick<
  StoredEvent,
  'id' | 'timestamp' | 'machineId' | 'agentId' | 'adapter' | 'sequence' | 'source'
> & {
  correlation: Pick<StoredEvent['correlation'], 'turnId'>;
  payload: Pick<StoredEvent['payload'], 'model' | 'usage' | 'usageKind' | 'responseId'>;
};

export interface AnalyticsSession {
  id: string;
  machineId: string;
  workspaceId: string;
  agentId: string;
  adapter: StoredEvent['adapter'];
  canonical: { usage: Usage; timestamp: string; priority: number } | null;
  events: AnalyticsEvent[];
}

const priority = (event: AnalyticsEvent) =>
  event.source.recordType === 'token_usage_record' ? 2 : 1;
const model = (event: AnalyticsEvent) => event.payload.model?.trim() || null;
const evidence = (event: AnalyticsEvent): AnalyticsEvidence => ({
  eventId: event.id,
  sequence: event.sequence,
  timestamp: event.timestamp,
  source: event.source,
  model: model(event),
  usageKind: event.payload.usageKind ?? null,
  responseId: event.payload.responseId ?? null,
  turnId: event.correlation.turnId ?? null,
});
const validUsage = (usage: Usage) =>
  Object.values(usage).every((value) => Number.isSafeInteger(value) && value >= 0) &&
  usage.cached <= usage.input &&
  usage.total === usage.input + usage.output;
const sameUsage = (left: Usage, right: Usage) =>
  left.input === right.input &&
  left.output === right.output &&
  left.cached === right.cached &&
  left.total === right.total;
function add(left: Usage, right: Usage): Usage {
  const sum = {
    input: left.input + right.input,
    output: left.output + right.output,
    cached: left.cached + right.cached,
    total: left.total + right.total,
  };
  if (!validUsage(sum))
    throw new RangeError('Analytics token aggregate exceeds safe integer range');
  return sum;
}
function intervalModels(
  events: AnalyticsEvent[],
  start: AnalyticsEvent,
  end: AnalyticsEvent,
): AnalyticsEvent[] {
  // Closed boundaries are conservative when simultaneous records cannot establish model order.
  // Binary search avoids rescanning the entire model history for every usage interval.
  let lower = 0;
  let upper = events.length;
  const from = Date.parse(start.timestamp);
  const to = Date.parse(end.timestamp);
  while (lower < upper) {
    const middle = Math.floor((lower + upper) / 2);
    if (Date.parse(events[middle]!.timestamp) < from) lower = middle + 1;
    else upper = middle;
  }
  const result: AnalyticsEvent[] = [];
  for (let index = lower; index < events.length; index++) {
    const event = events[index]!;
    if (Date.parse(event.timestamp) > to) break;
    if (event.id !== start.id && event.id !== end.id) result.push(event);
  }
  return result;
}

/** Read-only projection. It neither replaces v1 accounting nor persists derived attribution. */
export function aggregateModelAnalytics(
  sessions: AnalyticsSession[],
  query: ModelAnalyticsQuery,
): ModelAnalyticsReport {
  const from = query.from ? Date.parse(query.from) : -Infinity;
  const to = query.to ? Date.parse(query.to) : Infinity;
  const inWindow = (timestamp: string) => {
    const time = Date.parse(timestamp);
    return time >= from && time < to;
  };
  const rows = new Map<string, ModelAnalyticsRow & { sessionIds: Set<string> }>();
  const gaps: AnalyticsGap[] = [];
  let unidentifiedContributions = 0;
  function row(session: AnalyticsSession, modelId: string | null) {
    const key = JSON.stringify([session.adapter, modelId]);
    let value = rows.get(key);
    if (!value) {
      value = {
        adapter: session.adapter,
        provider: null,
        model: modelId,
        sessions: 0,
        sessionIds: new Set(),
        usage: null,
        contributions: [],
      };
      rows.set(key, value);
    }
    value.sessionIds.add(session.id);
    value.sessions = value.sessionIds.size;
    return value;
  }
  for (const session of sessions) {
    const gap = (reason: AnalyticsGap['reason'], events: AnalyticsEvent[] = []) =>
      gaps.push({ sessionId: session.id, reason, eventIds: events.map((event) => event.id) });
    const conflicts = session.events.filter(
      (event) =>
        event.machineId !== session.machineId ||
        event.agentId !== session.agentId ||
        event.adapter !== session.adapter,
    );
    if (conflicts.length) {
      row(session, null);
      gap('identity_conflict', conflicts);
      continue;
    }
    const observations = session.events.filter(
      (event) => inWindow(event.timestamp) && model(event) !== null,
    );
    observations.forEach((event) => row(session, model(event)));
    if (!observations.length) row(session, null);
    if (!session.canonical) {
      gap('usage_not_reported');
      continue;
    }
    // Replay the existing v1 admission rule in persisted sequence order, including source priority.
    // Equal-time replacements are one snapshot, not additional consumption.
    const chain: AnalyticsEvent[] = [];
    for (const event of session.events) {
      const usage = event.payload.usage;
      if (!usage || event.payload.usageKind !== 'session_cumulative') continue;
      if (!validUsage(usage)) {
        gap('invalid_usage', [event]);
        continue;
      }
      const previous = chain.at(-1);
      const previousUsage = previous?.payload.usage;
      if (
        previous &&
        previousUsage &&
        (event.timestamp < previous.timestamp ||
          usage.total < previousUsage.total ||
          (usage.total === previousUsage.total && priority(event) < priority(previous)))
      )
        continue;
      if (previous && event.timestamp === previous.timestamp) chain.pop();
      chain.push(event);
    }
    const latest = chain.at(-1);
    if (
      !latest?.payload.usage ||
      !sameUsage(latest.payload.usage, session.canonical.usage) ||
      latest.timestamp !== session.canonical.timestamp ||
      priority(latest) !== session.canonical.priority
    ) {
      gap('canonical_evidence_missing');
      continue;
    }
    const declarations = session.events
      .filter((event) => model(event) !== null)
      .sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));
    const gapCount = gaps.length;
    let contributed = false;
    for (let index = 0; index < chain.length; index++) {
      const end = chain[index]!;
      if (!inWindow(end.timestamp)) continue;
      const start = chain[index - 1];
      if (query.from && (!start || Date.parse(start.timestamp) < from)) {
        gap('window_boundary', start ? [start, end] : [end]);
        continue;
      }
      const current = end.payload.usage!;
      const baseline = start?.payload.usage ?? emptyUsage();
      const usage: Usage = {
        input: current.input - baseline.input,
        output: current.output - baseline.output,
        cached: current.cached - baseline.cached,
        total: current.total - baseline.total,
      };
      if (
        !validUsage(usage) ||
        (start && Date.parse(start.timestamp) > Date.parse(end.timestamp))
      ) {
        gap('non_monotonic_components', start ? [start, end] : [end]);
        continue;
      }
      const modelEvidence = start ? intervalModels(declarations, start, end) : [];
      const models = new Set([...(start ? [model(start)] : []), model(end)]);
      modelEvidence.forEach((event) => models.add(model(event)));
      const attribution: ModelUsageContribution['attribution'] = !start
        ? 'unbounded_snapshot'
        : models.has(null)
          ? 'model_missing'
          : models.size > 1
            ? 'model_changed'
            : 'consistent_snapshot_models';
      const modelId = attribution === 'consistent_snapshot_models' ? model(end) : null;
      const contribution: ModelUsageContribution = {
        machineId: session.machineId,
        sessionId: session.id,
        workspaceId: session.workspaceId,
        agentId: session.agentId,
        adapter: session.adapter,
        sessionMode: 'observed',
        model: modelId,
        attribution,
        quality: 'observed',
        usage,
        interval: { from: start?.timestamp ?? null, to: end.timestamp },
        start: start ? evidence(start) : null,
        end: evidence(end),
        modelEvidence: modelEvidence.map(evidence),
      };
      if (modelId === null) unidentifiedContributions++;
      const value = row(session, modelId);
      value.usage = add(value.usage ?? emptyUsage(), usage);
      value.contributions.push(contribution);
      contributed = true;
    }
    if (!contributed && gaps.length === gapCount) gap('no_contained_measurement');
  }
  const selected = [...rows.values()]
    .filter((value) => query.model === undefined || value.model === query.model)
    .sort(
      (left, right) =>
        (right.usage?.total ?? -1) - (left.usage?.total ?? -1) ||
        JSON.stringify([left.adapter, left.model]).localeCompare(
          JSON.stringify([right.adapter, right.model]),
        ),
    );
  const sessionIds = new Set(selected.flatMap((value) => [...value.sessionIds]));
  return {
    contract: 'orqst.model-analytics',
    contractVersion: 1,
    query,
    basis: {
      tokens: 'retained_canonical_snapshot_deltas',
      period: 'fully_contained_intervals_half_open',
      workspace: 'current_session_assignment',
      sessions: 'observed_sessions_non_additive_across_models',
      comparison: 'descriptive_only',
    },
    usage: selected.reduce<Usage | null>(
      (total, value) => (value.usage ? add(total ?? emptyUsage(), value.usage) : total),
      null,
    ),
    sessions: sessionIds.size,
    models: selected.map((value) => ({
      adapter: value.adapter,
      provider: value.provider,
      model: value.model,
      sessions: value.sessions,
      usage: value.usage,
      contributions: value.contributions,
    })),
    coverage: {
      scope: 'before_model_filter',
      complete: false,
      reason: 'source_coverage_unverified',
      sessions: sessions.length,
      sessionsWithCanonicalUsage: sessions.filter((session) => session.canonical).length,
      unidentifiedContributions,
      gaps,
    },
    unavailable: {
      provider: 'not_recorded',
      reasoningTokens: 'not_recorded',
      executions: 'not_recorded',
      duration: 'not_measured',
      successRate: 'task_outcomes_not_recorded',
      tokensPerExecution: 'executions_not_recorded',
      tokensPerCompletedTask: 'equivalent_tasks_not_recorded',
      cost: 'verified_prices_and_billing_not_recorded',
      taskEquivalence: 'not_recorded',
    },
  };
}

/** Explicit aggregate allowlist; no individual source or captured content leaves the reader. */
export function summarizeModelAnalytics(report: ModelAnalyticsReport): ModelAnalyticsSummary {
  const gaps = new Map<AnalyticsGap['reason'], number>();
  for (const gap of report.coverage.gaps) gaps.set(gap.reason, (gaps.get(gap.reason) ?? 0) + 1);
  return {
    contract: report.contract,
    contractVersion: report.contractVersion,
    query: report.query,
    basis: report.basis,
    usage: report.usage,
    sessions: report.sessions,
    models: report.models.map(({ adapter, provider, model, sessions, usage }) => ({
      adapter,
      provider,
      model,
      sessions,
      usage,
    })),
    coverage: {
      scope: report.coverage.scope,
      complete: report.coverage.complete,
      reason: report.coverage.reason,
      sessions: report.coverage.sessions,
      sessionsWithCanonicalUsage: report.coverage.sessionsWithCanonicalUsage,
      unidentifiedContributions: report.coverage.unidentifiedContributions,
      gaps: [...gaps].map(([reason, count]) => ({ reason, count })),
    },
    unavailable: report.unavailable,
  };
}

/** Fold one session at a time so full evidence/contributions never accumulate across history. */
export function aggregateModelAnalyticsSummary(
  sessions: Iterable<AnalyticsSession>,
  query: ModelAnalyticsQuery,
  observe?: (report: ModelAnalyticsReport) => void,
): ModelAnalyticsSummary {
  const result = summarizeModelAnalytics(aggregateModelAnalytics([], query));
  const rows = new Map<string, ModelAnalyticsSummary['models'][number]>();
  const gaps = new Map<AnalyticsGap['reason'], number>();
  for (const session of sessions) {
    const report = aggregateModelAnalytics([session], query);
    observe?.(report);
    const next = summarizeModelAnalytics(report);
    if (next.usage) result.usage = add(result.usage ?? emptyUsage(), next.usage);
    result.sessions += next.sessions;
    result.coverage.sessions += next.coverage.sessions;
    result.coverage.sessionsWithCanonicalUsage += next.coverage.sessionsWithCanonicalUsage;
    result.coverage.unidentifiedContributions += next.coverage.unidentifiedContributions;
    for (const gap of next.coverage.gaps)
      gaps.set(gap.reason, (gaps.get(gap.reason) ?? 0) + gap.count);
    for (const row of next.models) {
      const key = JSON.stringify([row.adapter, row.model]);
      const previous = rows.get(key);
      if (!previous) rows.set(key, row);
      else {
        previous.sessions += row.sessions;
        if (row.usage) previous.usage = add(previous.usage ?? emptyUsage(), row.usage);
      }
    }
  }
  result.models = [...rows.values()].sort(
    (left, right) =>
      (right.usage?.total ?? -1) - (left.usage?.total ?? -1) ||
      JSON.stringify([left.adapter, left.model]).localeCompare(
        JSON.stringify([right.adapter, right.model]),
      ),
  );
  result.coverage.gaps = [...gaps].map(([reason, count]) => ({ reason, count }));
  return result;
}

/** Interval-end observations, never interpolated daily consumption. At most 64 UTC bins. */
export function aggregateModelAnalyticsEvolution(
  sessions: Iterable<AnalyticsSession>,
  query: ModelAnalyticsQuery,
): ModelAnalyticsEvolution {
  const dayMs = 86400000;
  let bucketDays = 1;
  let buckets = new Map<number, Usage>();
  let undistributedUsage: Usage | null = null;
  let first = Infinity;
  let last = -Infinity;
  const summary = aggregateModelAnalyticsSummary(sessions, query, (report) => {
    for (const row of report.models) {
      for (const contribution of row.contributions) {
        if (contribution.interval.from === null) {
          undistributedUsage = add(undistributedUsage ?? emptyUsage(), contribution.usage);
          continue;
        }
        const day = Math.floor(Date.parse(contribution.interval.to) / dayMs);
        first = Math.min(first, day);
        last = Math.max(last, day);
        while (Math.floor(last / bucketDays) - Math.floor(first / bucketDays) >= 64) {
          bucketDays *= 2;
          const merged = new Map<number, Usage>();
          for (const [start, usage] of buckets) {
            const key = Math.floor(start / bucketDays) * bucketDays;
            merged.set(key, add(merged.get(key) ?? emptyUsage(), usage));
          }
          buckets = merged;
        }
        const key = Math.floor(day / bucketDays) * bucketDays;
        buckets.set(key, add(buckets.get(key) ?? emptyUsage(), contribution.usage));
      }
    }
  });
  const series: ModelAnalyticsEvolution['buckets'] = [];
  if (Number.isFinite(first)) {
    for (
      let start = Math.floor(first / bucketDays) * bucketDays;
      start <= last;
      start += bucketDays
    ) {
      series.push({
        from: new Date(start * dayMs).toISOString(),
        to: new Date((start + bucketDays) * dayMs).toISOString(),
        usage: buckets.get(start) ?? null,
      });
    }
  }
  return {
    contract: 'orqst.model-analytics-evolution',
    contractVersion: 1,
    summary,
    bucketDays,
    buckets: series,
    undistributedUsage,
  };
}
