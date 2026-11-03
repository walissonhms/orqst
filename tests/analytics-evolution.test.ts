// Synthetic evidence only; no native session, installed store or running service.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, readModelAnalyticsEvolution, readModelAnalyticsSummary } from '@orqst/database';
import { modelAnalyticsEvolutionSchema, type AgentEvent, type Usage } from '@orqst/protocol';
import {
  aggregateModelAnalyticsEvolution,
  type AnalyticsSession,
} from '../packages/database/src/analytics.js';
import { AnalyticsQueries } from '../apps/bridge/src/analytics.js';

const usage = (total: number): Usage => ({ input: total, output: 0, cached: total / 2, total });
function event(
  index: number,
  timestamp: string,
  total: number,
  model = 'synthetic-alpha',
): AgentEvent {
  return {
    schemaVersion: 1,
    id: `synthetic-evolution-${index}`,
    type: 'agent.tokens.updated',
    timestamp,
    adapter: 'codex',
    machineId: 'SYNTHETIC_PRIVATE_MACHINE',
    workspaceId: 'synthetic-workspace',
    agentId: 'synthetic-agent',
    sessionId: 'SYNTHETIC_PRIVATE_SESSION',
    correlation: {},
    source: {
      file: '/SYNTHETIC_PRIVATE_PATH',
      line: index + 1,
      offset: index * 100,
      hash: 'SYNTHETIC_PRIVATE_HASH',
      recordType: 'token_usage_record',
    },
    payload: {
      usage: usage(total),
      usageKind: 'session_cumulative',
      model,
      text: 'SYNTHETIC_PRIVATE_MESSAGE',
      responseId: 'SYNTHETIC_PRIVATE_RESPONSE',
    },
  };
}
function fixture() {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'orqst-evolution-')));
  const file = join(directory, 'synthetic.db');
  const store = new Store(file);
  const events = [
    event(0, '2026-11-01T12:00:00Z', 50),
    event(1, '2026-11-02T00:00:00Z', 80),
    event(2, '2026-11-04T12:00:00Z', 100, 'synthetic-beta'),
    event(3, '2026-11-04T13:00:00Z', 110, 'synthetic-beta'),
    event(4, '2026-11-06T12:00:00Z', 110, 'synthetic-beta'),
  ];
  events.forEach((item) => store.ingest(item));
  return {
    store,
    file,
    events,
    close: () => {
      store.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

test('evolution reconciles mixed models, undistributed lifetime, missing windows and measured zero', async () => {
  const ctx = fixture();
  const workers = new AnalyticsQueries(ctx.file);
  try {
    const report = await workers.evolution({});
    assert.ok(modelAnalyticsEvolutionSchema.safeParse(report).success);
    assert.deepEqual(report.summary, readModelAnalyticsSummary(ctx.file));
    assert.deepEqual(report.summary.usage, usage(110));
    assert.deepEqual(report.undistributedUsage, usage(50));
    assert.equal(report.bucketDays, 1);
    assert.deepEqual(
      report.buckets.map((bucket) => bucket.usage?.total ?? null),
      [30, null, 30, null, 0],
    );
    assert.equal(report.buckets[0]!.from, '2026-11-02T00:00:00.000Z');
    assert.equal(JSON.stringify(report).includes('SYNTHETIC_PRIVATE'), false);
    const alpha = readModelAnalyticsEvolution(ctx.file, { model: 'synthetic-alpha' });
    assert.equal(alpha.summary.usage?.total, 30);
    assert.equal(alpha.undistributedUsage, null);
    assert.deepEqual(
      alpha.buckets.map((bucket) => bucket.usage?.total),
      [30],
    );
    const unknown = readModelAnalyticsEvolution(ctx.file, { model: null });
    assert.equal(unknown.summary.usage?.total, 70);
    assert.equal(unknown.undistributedUsage?.total, 50);
    assert.equal(unknown.buckets[0]!.usage?.total, 20);
    const period = { from: '2026-11-02T00:00:00Z', to: '2026-11-06T12:00:00Z' };
    const filtered = readModelAnalyticsEvolution(ctx.file, period);
    assert.equal(filtered.summary.usage?.total, 30);
    assert.equal(filtered.undistributedUsage, null);
    assert.equal(filtered.buckets.length, 1);
    assert.ok(filtered.summary.coverage.gaps.some((gap) => gap.reason === 'window_boundary'));
    for (const query of [
      { workspaceId: 'missing' },
      { agentId: 'missing' },
      { adapter: 'claude' as const },
    ]) {
      const empty = readModelAnalyticsEvolution(ctx.file, query);
      assert.equal(empty.summary.usage, null);
      assert.deepEqual(empty.buckets, []);
      assert.equal(empty.undistributedUsage, null);
    }
    ctx.events.forEach((item) => ctx.store.ingest(item));
    assert.deepEqual(readModelAnalyticsEvolution(ctx.file), report);
    ctx.store.retain(Date.parse('2027-01-01T00:00:00Z'));
    assert.deepEqual(readModelAnalyticsEvolution(ctx.file), report);
  } finally {
    await workers.close();
    ctx.close();
  }
});

test('adaptive windows stay bounded and deterministic across session order and long gaps', () => {
  const sessions: AnalyticsSession[] = [];
  for (let i = 0; i < 150; i++) {
    const base = Date.UTC(1900 + i, 0, 1);
    const events = [
      event(i * 2, new Date(base).toISOString(), 0),
      event(i * 2 + 1, new Date(base + 86400000).toISOString(), 10),
    ];
    sessions.push({
      id: `synthetic-${i}`,
      machineId: events[0]!.machineId,
      agentId: 'synthetic-agent',
      workspaceId: 'synthetic-workspace',
      adapter: 'codex',
      canonical: { usage: usage(10), timestamp: events[1]!.timestamp, priority: 2 },
      events: events.map((item, index) => ({ ...item, sequence: index + 1 })),
    });
  }
  const report = aggregateModelAnalyticsEvolution(sessions, {});
  assert.ok(report.buckets.length <= 64);
  assert.ok(report.bucketDays > 1);
  assert.equal(report.summary.usage?.total, 1500);
  assert.equal(
    report.buckets.reduce((total, bucket) => total + (bucket.usage?.total ?? 0), 0),
    1500,
  );
  const reversed = aggregateModelAnalyticsEvolution([...sessions].reverse(), {});
  assert.deepEqual(reversed.buckets, report.buckets);
  assert.equal(reversed.bucketDays, report.bucketDays);
  assert.ok(modelAnalyticsEvolutionSchema.safeParse(report).success);
  for (const mutation of [
    { ...report, bucketDays: 3 },
    { ...report, undistributedUsage: usage(2) },
    { ...report, buckets: [...report.buckets, report.buckets[0]] },
    { ...report, capturedText: 'private' },
  ])
    assert.equal(modelAnalyticsEvolutionSchema.safeParse(mutation).success, false);
});
