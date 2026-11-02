// All Analytics inputs are synthetic; no native session or private content is loaded.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '@orqst/database';
import { modelAnalyticsQuerySchema, type AgentEvent, type Usage } from '@orqst/protocol';
import { meta, normalized, record, token } from './fixtures.js';

const time = (minute: number) => new Date(Date.UTC(2026, 10, 2, 12, minute)).toISOString();
const usage = (input: number, output = 0, cached = 0): Usage => ({
  input,
  output,
  cached,
  total: input + output,
});
function event(
  id: string,
  minute: number,
  payload: AgentEvent['payload'],
  extra: Partial<AgentEvent> = {},
): AgentEvent {
  return {
    schemaVersion: 1,
    id,
    type: payload.usage ? 'agent.tokens.updated' : 'session.updated',
    timestamp: time(minute),
    adapter: 'codex',
    machineId: 'synthetic-machine',
    workspaceId: 'synthetic-project',
    sessionId: 'synthetic-session',
    agentId: 'synthetic-agent',
    correlation: { turnId: `synthetic-turn-${minute}` },
    source: {
      file: 'synthetic.jsonl',
      offset: minute * 100,
      line: minute + 1,
      hash: `synthetic-hash-${id}`,
      recordType: 'token_usage_record',
    },
    payload,
    ...extra,
  };
}
const snapshot = (id: string, minute: number, value: Usage, model?: string) =>
  event(id, minute, {
    usage: value,
    usageKind: 'session_cumulative',
    model,
    responseId: `synthetic-response-${id}`,
  });

test('Analytics contracts reject ambiguous windows and unsupported filters', () => {
  assert.deepEqual(modelAnalyticsQuerySchema.parse({}), {});
  assert.equal(modelAnalyticsQuerySchema.parse({ model: null }).model, null);
  assert.equal(
    modelAnalyticsQuerySchema.parse({ model: ' synthetic-model ' }).model,
    'synthetic-model',
  );
  for (const query of [
    { from: time(2), to: time(2) },
    { from: time(3), to: time(2) },
    { from: '2026-11-02' },
    { from: '2026-11-02T00:00:00' },
    { model: '' },
    { adapter: 'unverified' },
    { provider: 'inferred-vendor' },
  ])
    assert.equal(modelAnalyticsQuerySchema.safeParse(query).success, false);
});

test('canonical deltas reconcile with v1, prefer thread sources and ignore mirrors/increments/replay', () => {
  const store = new Store(':memory:');
  try {
    const initial = snapshot('initial', 0, usage(0), 'model-a');
    const mirror = {
      ...snapshot('mirror', 1, usage(100, 20, 40), 'model-a'),
      source: { ...initial.source, recordType: 'event_msg:token_count' },
    };
    const native = snapshot('native', 1, usage(100, 20, 50), 'model-a');
    const final = snapshot('final', 2, usage(250, 40, 100), 'model-a');
    const response = event('response', 3, {
      model: 'model-a',
      usage: usage(9999),
      usageKind: 'response_incremental',
    });
    const turn = event('turn', 3, {
      model: 'model-a',
      usage: usage(9999),
      usageKind: 'turn_cumulative',
    });
    const events = [
      initial,
      mirror,
      native,
      { ...mirror, id: 'later-mirror', timestamp: time(2) },
      final,
      response,
      turn,
      snapshot('stale', 1, usage(9999), 'model-a'),
    ];
    events.forEach((value) => store.ingest(value));
    const before = store.modelAnalytics();
    events.forEach((value) => store.ingest(value));
    assert.deepEqual(store.modelAnalytics(), before);
    assert.deepEqual(before.usage, store.totals());
    assert.deepEqual(before.usage, usage(250, 40, 100));
    const known = before.models.find((row) => row.model === 'model-a');
    assert.deepEqual(known?.usage, usage(250, 40, 100));
    assert.equal(known?.sessions, 1);
    assert.equal(before.sessions, 1);
    assert.equal(known?.contributions[0]?.end.eventId, 'native');
    assert.equal(known?.contributions[0]?.end.source.hash, 'synthetic-hash-native');
    assert.equal(known?.contributions[0]?.end.responseId, 'synthetic-response-native');
    assert.equal(known?.contributions[0]?.end.turnId, 'synthetic-turn-1');
    assert.equal(known?.contributions[0]?.quality, 'observed');
    assert.equal(before.coverage.complete, false);
    assert.equal(store.cursor(), events.length);
  } finally {
    store.close();
  }
});

test('a first positive cumulative snapshot never assigns historical usage to its last model', () => {
  const store = new Store(':memory:');
  try {
    store.ingest(snapshot('first', 1, usage(100, 20, 40), 'last-model'));
    const report = store.modelAnalytics();
    assert.deepEqual(report.usage, store.totals());
    const unknown = report.models.find((row) => row.model === null);
    assert.deepEqual(unknown?.usage, usage(100, 20, 40));
    assert.equal(unknown?.contributions[0]?.attribution, 'unbounded_snapshot');
    assert.equal(unknown?.contributions[0]?.interval.from, null);
    assert.equal(report.models.find((row) => row.model === 'last-model')?.usage, null);
    assert.equal(store.modelAnalytics({ model: 'last-model' }).usage, null);
    assert.deepEqual(store.modelAnalytics({ model: null }).usage, report.usage);
  } finally {
    store.close();
  }
});

test('switches, missing models and changes back to the same model remain unidentified', () => {
  const store = new Store(':memory:');
  try {
    [
      snapshot('zero', 0, usage(0), 'a'),
      snapshot('a', 1, usage(10), 'a'),
      snapshot('switch', 2, usage(30), 'b'),
      snapshot('b', 3, usage(60), 'b'),
      snapshot('missing', 4, usage(100)),
      snapshot('b-again', 5, usage(150), 'b'),
      event('change-away', 6, { model: 'c' }),
      event('change-back', 7, { model: 'b' }),
      snapshot('switched-back', 8, usage(210), 'b'),
    ].forEach((value) => store.ingest(value));
    const report = store.modelAnalytics();
    assert.deepEqual(report.usage, store.totals());
    assert.equal(report.models.find((row) => row.model === 'a')?.usage?.total, 10);
    assert.equal(report.models.find((row) => row.model === 'b')?.usage?.total, 30);
    assert.equal(report.models.find((row) => row.model === 'c')?.usage, null);
    const unknown = report.models.find((row) => row.model === null);
    assert.equal(unknown?.usage?.total, 170);
    assert.deepEqual(
      unknown?.contributions.map((value) => value.attribution),
      ['unbounded_snapshot', 'model_changed', 'model_missing', 'model_missing', 'model_changed'],
    );
    assert.deepEqual(
      unknown?.contributions.at(-1)?.modelEvidence.map((value) => value.eventId),
      ['change-away', 'change-back'],
    );
    assert.equal(report.sessions, 1);
    assert.equal(report.basis.comparison, 'descriptive_only');
  } finally {
    store.close();
  }
});

test('periods use contained observed intervals, exclude the upper endpoint and never interpolate', () => {
  const store = new Store(':memory:');
  try {
    [0, 10, 20, 30].forEach((minute) =>
      store.ingest(snapshot(`t${minute}`, minute, usage(minute * 10), 'a')),
    );
    assert.equal(store.modelAnalytics({ from: time(10), to: time(30) }).usage?.total, 100);
    const crossing = store.modelAnalytics({ from: time(5), to: time(25) });
    assert.equal(crossing.usage?.total, 100);
    assert.ok(crossing.coverage.gaps.some((gap) => gap.reason === 'window_boundary'));
    assert.equal(store.modelAnalytics({ from: time(21), to: time(29) }).usage, null);
    assert.equal(store.modelAnalytics({ from: time(21), to: time(29) }).sessions, 0);
    assert.equal(store.modelAnalytics({ to: time(10) }).usage?.total, 0);
    assert.equal(
      store.modelAnalytics({ from: '2026-11-02T09:10:00-03:00', to: time(30) }).usage?.total,
      100,
    );
    assert.equal(store.modelAnalytics({ from: time(31) }).usage, null);
  } finally {
    store.close();
  }
});

test('workspace, agent, adapter and model scopes filter observed data without guessing the vendor', () => {
  const store = new Store(':memory:');
  try {
    for (const [sessionId, workspaceId, agentId, adapter, modelId, total] of [
      ['one', 'project-one', 'agent-one', 'codex', 'same-model', 10],
      ['two', 'project-two', 'agent-two', 'manual', 'same-model', 20],
    ] as const) {
      for (const minute of [0, 1])
        store.ingest({
          ...snapshot(`${sessionId}-${minute}`, minute, usage(minute * total), modelId),
          sessionId,
          workspaceId,
          agentId,
          adapter,
        });
    }
    assert.equal(store.modelAnalytics().usage?.total, 30);
    assert.equal(store.modelAnalytics().sessions, 2);
    const scoped = store.modelAnalytics({
      workspaceId: 'project-two',
      agentId: 'agent-two',
      adapter: 'manual',
      model: 'same-model',
    });
    assert.equal(scoped.usage?.total, 20);
    assert.equal(scoped.models[0]?.provider, null);
    assert.equal(scoped.models[0]?.contributions[0]?.workspaceId, 'project-two');
    assert.equal(scoped.models[0]?.contributions[0]?.sessionMode, 'observed');
    assert.equal(store.modelAnalytics({ workspaceId: "' OR 1=1 --" }).sessions, 0);
    const override = store.workspace('/synthetic/override', 'Synthetic override');
    assert.ok(store.associate('one', override));
    assert.equal(store.modelAnalytics({ workspaceId: 'project-one' }).usage, null);
    assert.equal(store.modelAnalytics({ workspaceId: override }).usage?.total, 10);
  } finally {
    store.close();
  }
});

test('unreported metrics stay unavailable, measured zero stays observed, and content is not returned', () => {
  const store = new Store(':memory:');
  try {
    store.ingest(event('context', 0, { model: 'a', text: 'SYNTHETIC_PRIVATE_TEXT' }));
    store.ingest(event('done', 1, { status: 'completed', result: 'SYNTHETIC_PRIVATE_RESULT' }));
    let report = store.modelAnalytics();
    assert.equal(report.usage, null);
    assert.equal(report.models[0]?.usage, null);
    assert.equal(report.sessions, 1);
    assert.equal(report.coverage.gaps[0]?.reason, 'usage_not_reported');
    assert.equal(report.unavailable.successRate, 'task_outcomes_not_recorded');
    assert.equal(report.unavailable.cost, 'verified_prices_and_billing_not_recorded');
    assert.equal(report.unavailable.duration, 'not_measured');
    assert.equal(report.unavailable.executions, 'not_recorded');
    assert.equal(JSON.stringify(report).includes('SYNTHETIC_PRIVATE'), false);
    store.ingest(snapshot('zero', 2, usage(0)));
    report = store.modelAnalytics();
    assert.deepEqual(report.usage, usage(0));
    assert.equal(
      report.models.find((row) => row.model === null)?.contributions[0]?.quality,
      'observed',
    );
  } finally {
    store.close();
  }
});

test('retention keeps v1 totals but does not reconstruct model attribution or invent provenance', () => {
  const store = new Store(':memory:', 1);
  try {
    store.ingest(snapshot('old-zero', 0, usage(0), 'a'));
    store.ingest(snapshot('old-usage', 1, usage(10), 'a'));
    store.ingest({
      ...snapshot('retained', 2, usage(30), 'b'),
      timestamp: '2026-11-04T12:00:00.000Z',
    });
    store.retain(Date.parse('2026-11-05T00:00:00Z'));
    let report = store.modelAnalytics();
    assert.deepEqual(report.usage, store.totals());
    assert.equal(report.models.find((row) => row.model === null)?.usage?.total, 30);
    assert.equal(report.models.find((row) => row.model === 'b')?.usage, null);
    assert.equal(store.modelAnalytics({ from: '2026-11-03T00:00:00Z' }).usage, null);
    store.retain(Date.parse('2026-11-06T00:00:00Z'));
    report = store.modelAnalytics();
    assert.equal(report.usage, null);
    assert.equal(store.totals().total, 30);
    assert.equal(report.coverage.gaps[0]?.reason, 'canonical_evidence_missing');
    assert.equal(report.coverage.sessionsWithCanonicalUsage, 1);
  } finally {
    store.close();
  }
});

test('inconsistent components and invalid usage are explicit gaps, never negative/fictional values', () => {
  const store = new Store(':memory:');
  try {
    store.ingest(snapshot('first', 0, usage(100, 0, 90), 'a'));
    store.ingest(snapshot('cache-decreased', 1, usage(110, 10, 80), 'a'));
    const report = store.modelAnalytics();
    assert.equal(report.usage?.total, 100);
    assert.equal(report.coverage.gaps[0]?.reason, 'non_monotonic_components');
    store.ingest(snapshot('invalid', 2, { input: 120, output: 10, cached: 130, total: 130 }, 'a'));
    const invalid = store.modelAnalytics();
    assert.equal(invalid.usage, null);
    assert.ok(invalid.coverage.gaps.some((gap) => gap.reason === 'invalid_usage'));
    assert.ok(invalid.coverage.gaps.some((gap) => gap.reason === 'canonical_evidence_missing'));
  } finally {
    store.close();
  }
});

test('reopening and replay preserve Analytics and do not change schema version 1', () => {
  const directory = mkdtempSync(join(tmpdir(), 'orqst-analytics-synthetic-'));
  const file = join(directory, 'analytics.db');
  const events = [snapshot('zero', 0, usage(0), 'a'), snapshot('used', 1, usage(20), 'a')];
  let store = new Store(file);
  try {
    events.forEach((value) => store.ingest(value));
    const report = store.modelAnalytics();
    store.close();
    store = new Store(file);
    events.forEach((value) => store.ingest(value));
    assert.deepEqual(store.modelAnalytics(), report);
    const readOnly = new DatabaseSync(file, { readOnly: true });
    try {
      assert.equal(readOnly.prepare('PRAGMA user_version').get()?.user_version, 1);
    } finally {
      readOnly.close();
    }
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('normalized Codex contexts support model deltas without reinterpreting task completion', () => {
  const store = new Store(':memory:');
  try {
    const records = [
      meta(),
      record('turn_context', { turn_id: 'synthetic-turn', model: 'synthetic-model' }),
      record('token_usage_record', {
        response_id: 'synthetic-zero',
        thread_token_usage: token(0, 0),
      }),
      record('token_usage_record', {
        response_id: 'synthetic-used',
        thread_token_usage: token(100, 20, 40),
        turn_token_usage: token(100, 20, 40),
        usage: token(100, 20, 40),
      }),
      record('event_msg', { type: 'task_complete' }),
    ].map((value, index) => ({ ...value, timestamp: time(index) }));
    normalized(records).forEach((value) => store.ingest(value));
    const report = store.modelAnalytics({ model: 'synthetic-model' });
    assert.deepEqual(report.usage, usage(100, 20, 40));
    assert.equal(report.models[0]?.contributions[0]?.end.turnId, 'synthetic-turn');
    assert.equal(report.unavailable.successRate, 'task_outcomes_not_recorded');
    assert.equal(report.unavailable.tokensPerCompletedTask, 'equivalent_tasks_not_recorded');
  } finally {
    store.close();
  }
});

test('source identity collisions fail closed instead of merging providers or machines', () => {
  const store = new Store(':memory:');
  try {
    store.ingest(snapshot('zero', 0, usage(0), 'a'));
    store.ingest({
      ...snapshot('collision', 1, usage(100), 'b'),
      machineId: 'synthetic-other-machine',
      agentId: 'synthetic-other-agent',
      adapter: 'manual',
    });
    const report = store.modelAnalytics();
    assert.equal(report.usage, null);
    assert.equal(report.coverage.gaps[0]?.reason, 'identity_conflict');
    assert.equal(store.totals().total, 100);
  } finally {
    store.close();
  }
});

test('activity between snapshots cannot produce invented period usage or duration', () => {
  const store = new Store(':memory:');
  try {
    store.ingest(snapshot('zero', 0, usage(0), 'a'));
    store.ingest(event('activity', 5, { text: 'Synthetic activity' }));
    store.ingest(snapshot('later', 10, usage(100), 'a'));
    const report = store.modelAnalytics({ from: time(4), to: time(6) });
    assert.equal(report.sessions, 1);
    assert.equal(report.usage, null);
    assert.equal(report.coverage.gaps[0]?.reason, 'no_contained_measurement');
    assert.equal(report.unavailable.duration, 'not_measured');
  } finally {
    store.close();
  }
});

test('incremental model evidence and simultaneous conflicting contexts prevent model attribution', () => {
  const store = new Store(':memory:');
  try {
    store.ingest(snapshot('zero', 0, usage(0), 'a'));
    store.ingest(
      event('incremental-b', 1, {
        model: 'b',
        usage: usage(10),
        usageKind: 'response_incremental',
      }),
    );
    store.ingest(snapshot('a-again', 2, usage(20), 'a'));
    store.ingest(event('simultaneous-b', 2, { model: 'b' }));
    store.ingest(snapshot('later-a', 3, usage(30), 'a'));
    const report = store.modelAnalytics();
    assert.equal(report.models.find((row) => row.model === 'a')?.usage, null);
    assert.equal(report.models.find((row) => row.model === 'b')?.usage, null);
    const unidentified = report.models.find((row) => row.model === null);
    assert.equal(unidentified?.usage?.total, 30);
    assert.ok(
      unidentified?.contributions[1]?.modelEvidence.some(
        (item) => item.eventId === 'incremental-b',
      ),
    );
    assert.ok(
      unidentified?.contributions[2]?.modelEvidence.some(
        (item) => item.eventId === 'simultaneous-b',
      ),
    );
    assert.deepEqual(report.usage, store.totals());
  } finally {
    store.close();
  }
});
