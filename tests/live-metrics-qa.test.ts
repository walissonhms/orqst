// Independent Live Metrics QA. Synthetic events and disposable databases only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { SESSION_METRICS_LIMITS, Store } from '@orqst/database';
import {
  sessionMetricsResultSchema,
  type AgentEvent,
  type SessionMetrics,
  type SessionMetricsResult,
  type Usage,
} from '@orqst/protocol';
import { createLocalServer } from '../apps/bridge/src/server.js';
import { readSessionMetrics } from '../packages/database/src/live-metrics.js';

const hash = 'a'.repeat(64);
const T1 = '2026-11-02T10:00:00.000Z';
const T2 = '2026-11-02T11:00:00.000Z';
const T3 = '2026-11-02T12:00:00.000Z';
const usage: Usage = { input: 100, output: 20, cached: 10, total: 120 };

function event(overrides: Partial<AgentEvent> & { id: string }): AgentEvent {
  return {
    schemaVersion: 1,
    type: 'agent.tokens.updated',
    timestamp: T1,
    adapter: 'codex',
    machineId: 'synthetic-machine',
    workspaceId: 'synthetic-workspace',
    sessionId: 'synthetic-session',
    agentId: 'synthetic-agent',
    correlation: { turnId: 'synthetic-turn' },
    source: {
      file: 'synthetic/live-metrics.jsonl',
      offset: 10,
      line: 3,
      hash,
      recordType: 'token_usage_record',
    },
    payload: { usage, usageKind: 'session_cumulative', responseId: 'synthetic-response' },
    ...overrides,
  };
}

function tokens(id: string, overrides: Partial<AgentEvent> & { usage?: Usage } = {}): AgentEvent {
  const { usage: value, ...rest } = overrides;
  return event({
    id,
    payload: {
      usage: value ?? usage,
      usageKind: 'session_cumulative',
      responseId: 'synthetic-response',
    },
    ...rest,
  });
}

/** A metric-bearing record without usage: admitted to analytics_evidence, never a candidate. */
function modelOnly(id: string, timestamp: string, sessionId: string): AgentEvent {
  return event({
    id,
    type: 'agent.updated',
    timestamp,
    sessionId,
    payload: { model: 'synthetic-model' },
  });
}

function activity(id: string, timestamp: string, sessionId: string): AgentEvent {
  return event({
    id,
    type: 'agent.message',
    timestamp,
    sessionId,
    payload: { role: 'assistant', text: 'Synthetic activity' },
  });
}

function available(result: SessionMetricsResult): SessionMetrics {
  assert.equal(result.availability, 'available', JSON.stringify(result));
  if (result.availability !== 'available') throw new Error('unreachable');
  return result.value;
}

function unavailable(result: SessionMetricsResult, reason: string): void {
  assert.equal(result.availability, 'unavailable', JSON.stringify(result));
  if (result.availability !== 'unavailable') return;
  assert.equal(result.reason, reason);
}

function withStore<T>(action: (store: Store) => T): T {
  const store = new Store(':memory:');
  try {
    return action(store);
  } finally {
    store.close();
  }
}

test('absence is unavailable while a recorded zero snapshot is confirmed zero', () => {
  withStore((store) => {
    const absent = 'session-absent-usage';
    store.ingest(activity('activity-only', T2, absent));

    // SessionView.usage is a zero default and must never be read as a measurement.
    const view = store.sessions().find((session) => session.id === absent)!;
    assert.deepEqual(view.usage, { input: 0, output: 0, cached: 0, total: 0 });
    unavailable(store.sessionMetrics(absent), 'usage_not_recorded');

    const zero = 'session-confirmed-zero';
    store.ingest(
      tokens('zero-usage', {
        sessionId: zero,
        usage: { input: 0, output: 0, cached: 0, total: 0 },
      }),
    );
    const value = available(store.sessionMetrics(zero));
    assert.deepEqual(value.usage, { input: 0, output: 0, cached: 0, total: 0 });
    assert.equal(value.normalization, 'codex_session_snapshot');
    assert.equal(value.fieldPresence, 'not_preserved');

    unavailable(store.sessionMetrics('session-never-observed'), 'session_not_found');
  });
});

test('metric time is the token evidence time, never lastActivity', () => {
  withStore((store) => {
    const sessionId = 'session-time';
    store.ingest(tokens('time-usage', { sessionId, timestamp: T1 }));
    store.ingest(activity('time-activity', T3, sessionId));

    const view = store.sessions().find((session) => session.id === sessionId)!;
    assert.equal(view.lastActivity, T3);
    const value = available(store.sessionMetrics(sessionId));
    assert.equal(value.evidence.occurredAt, T1);
    assert.notEqual(value.evidence.occurredAt, view.lastActivity);
    assert.deepEqual(value.evidence.observedAt, {
      availability: 'unavailable',
      reason: 'not_recorded',
    });
    assert.equal(value.evidence.sourceVerification, 'not_rechecked');
    assert.equal(value.evidence.kind, 'compact_evidence');
    // The compact row keeps metadata only: no full retained event, no event.type.
    assert.equal(Object.hasOwn(value.evidence, 'type'), false);
    assert.equal(Object.hasOwn(value, 'event'), false);
  });
});

test('newest matching candidate wins before identity is rejected, never an older convenient one', () => {
  withStore((store) => {
    const sessionId = 'session-identity';
    store.ingest(tokens('identity-valid', { sessionId, timestamp: T1 }));
    // Same timestamp, total and priority, later sequence, divergent identity.
    store.ingest(tokens('identity-conflict', { sessionId, timestamp: T1, agentId: 'other-agent' }));

    unavailable(store.sessionMetrics(sessionId), 'identity_conflict');
  });
});

test('mirror priority follows the Store row instead of a hardcoded preference', () => {
  withStore((store) => {
    // Mirror first, modern second with the same timestamp/total: modern wins the row.
    const modern = 'session-modern-wins';
    store.ingest(
      tokens('mirror-old', {
        sessionId: modern,
        timestamp: T1,
        source: {
          file: 'synthetic/live-metrics.jsonl',
          offset: 1,
          line: 1,
          hash,
          recordType: 'event_msg:token_count',
        },
      }),
    );
    store.ingest(tokens('modern-new', { sessionId: modern, timestamp: T1 }));
    const modernValue = available(store.sessionMetrics(modern));
    assert.equal(modernValue.evidence.eventId, 'modern-new');
    assert.equal(modernValue.evidence.source.recordType, 'token_usage_record');

    // Modern first, then a newer mirror with a larger total: the row follows the mirror.
    const mirror = 'session-mirror-wins';
    store.ingest(tokens('modern-first', { sessionId: mirror, timestamp: T1 }));
    store.ingest(
      tokens('mirror-larger', {
        sessionId: mirror,
        timestamp: T1,
        usage: { input: 120, output: 20, cached: 10, total: 140 },
        source: {
          file: 'synthetic/live-metrics.jsonl',
          offset: 2,
          line: 2,
          hash,
          recordType: 'event_msg:token_count',
        },
      }),
    );
    const mirrorValue = available(store.sessionMetrics(mirror));
    assert.equal(mirrorValue.evidence.eventId, 'mirror-larger');
    assert.equal(mirrorValue.evidence.source.recordType, 'event_msg:token_count');
    assert.equal(mirrorValue.usage.total, 140);

    // Equal total and timestamp: the higher priority row survives, the mirror is not chosen.
    const tie = 'session-priority-tie';
    store.ingest(tokens('tie-modern', { sessionId: tie, timestamp: T1 }));
    store.ingest(
      tokens('tie-mirror', {
        sessionId: tie,
        timestamp: T1,
        source: {
          file: 'synthetic/live-metrics.jsonl',
          offset: 3,
          line: 3,
          hash,
          recordType: 'event_msg:token_count',
        },
      }),
    );
    assert.equal(available(store.sessionMetrics(tie)).evidence.eventId, 'tie-modern');
  });
});

test('historical evidence workspace survives a manual association', () => {
  withStore((store) => {
    const sessionId = 'session-workspace';
    store.ingest(tokens('workspace-usage', { sessionId, workspaceId: 'workspace-historical' }));
    const manual = store.workspace('/synthetic/manual', 'Manual');
    assert.equal(store.associate(sessionId, manual), true);

    assert.equal(store.sessions().find((session) => session.id === sessionId)!.workspaceId, manual);
    const value = available(store.sessionMetrics(sessionId));
    assert.equal(value.identity.sourceWorkspaceId, 'workspace-historical');
    assert.notEqual(value.identity.sourceWorkspaceId, manual);
  });
});

test('normalized snapshot reports cache/total as normalization, not provider presence', () => {
  withStore((store) => {
    const sessionId = 'session-normalized';
    // Codex normalizer default: missing cached -> 0 and missing total -> input + output.
    store.ingest(
      tokens('normalized-usage', {
        sessionId,
        usage: { input: 40, output: 2, cached: 0, total: 42 },
      }),
    );
    const value = available(store.sessionMetrics(sessionId));
    assert.equal(value.normalization, 'codex_session_snapshot');
    assert.equal(value.fieldPresence, 'not_preserved');
    assert.deepEqual(value.usage, { input: 40, output: 2, cached: 0, total: 42 });
    assert.equal(value.usage.total, value.usage.input + value.usage.output);
    assert.ok(value.usage.cached <= value.usage.input);
  });
});

test('retention removes events but the compact evidence still proves the metric', () => {
  const dir = mkdtempSync(join(tmpdir(), 'orqst-live-metrics-qa-retain-'));
  const path = join(dir, 'orqst.sqlite');
  const store = new Store(path);
  try {
    const sessionId = 'session-retention';
    store.ingest(tokens('retained-usage', { sessionId, timestamp: T1 }));
    store.ingest(activity('retained-activity', T3, sessionId));
    const before = available(store.sessionMetrics(sessionId));

    // retentionDays=30: a cutoff of 2026-11-05 removes the 2026-11-02 events.
    assert.ok(store.retain(Date.parse('2026-12-05T00:00:00.000Z')) > 0);
    assert.equal(store.recentEvents(50).length, 0);
    const after = available(store.sessionMetrics(sessionId));
    assert.deepEqual(after, before);
    assert.equal(after.evidence.occurredAt, T1);

    // Losing the compact row is unavailable: nothing is reconstructed from other tables.
    const side = new DatabaseSync(path);
    try {
      side.exec('PRAGMA busy_timeout=5000');
      side.prepare('DELETE FROM analytics_evidence WHERE session_id=?').run(sessionId);
    } finally {
      side.close();
    }
    unavailable(store.sessionMetrics(sessionId), 'evidence_missing');
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('replay and duplicate records never duplicate or sum cumulative totals', () => {
  withStore((store) => {
    const sessionId = 'session-replay';
    const original = tokens('replay-usage', { sessionId, timestamp: T1 });
    assert.ok(store.ingest(original));
    assert.equal(store.ingest(original), undefined);
    // A second source record carrying the same cumulative snapshot.
    store.ingest(
      tokens('replay-copy', {
        sessionId,
        timestamp: T1,
        source: {
          file: 'synthetic/live-metrics.jsonl',
          offset: 11,
          line: 4,
          hash,
          recordType: 'token_usage_record',
        },
      }),
    );

    const value = available(store.sessionMetrics(sessionId));
    assert.deepEqual(value.usage, usage);
    assert.equal(value.usage.total, value.usage.input + value.usage.output);
    assert.deepEqual(store.totals(), { input: 100, output: 20, cached: 10, total: 120 });
    // Newest duplicate wins; totals are not added twice.
    assert.equal(value.evidence.eventId, 'replay-copy');
  });
});

test('byte admission happens before metadata materialization and fails closed', () => {
  withStore((store) => {
    // One record above the per-record budget.
    const oversized = 'session-record-bytes';
    store.ingest(
      tokens('oversized-usage', {
        sessionId: oversized,
        source: {
          file: `synthetic/${'x'.repeat(SESSION_METRICS_LIMITS.recordBytes)}.jsonl`,
          offset: 0,
          line: 1,
          hash,
          recordType: 'token_usage_record',
        },
      }),
    );
    unavailable(store.sessionMetrics(oversized), 'evidence_limit');

    // Individually admissible records that together exceed the aggregate budget.
    const aggregate = 'session-evidence-bytes';
    // Each record stays under the per-record budget; only the aggregate can reject them.
    const filler = 'y'.repeat(12000);
    for (let index = 0; index < 22; index += 1)
      store.ingest(
        tokens(`aggregate-${index}`, {
          sessionId: aggregate,
          timestamp: `2026-11-02T10:${String(index).padStart(2, '0')}:00.000Z`,
          usage: { input: 100 + index, output: 20, cached: 10, total: 120 + index },
          source: {
            file: `synthetic/${filler}-${index}.jsonl`,
            offset: index,
            line: index + 1,
            hash,
            recordType: 'token_usage_record',
          },
        }),
      );
    unavailable(store.sessionMetrics(aggregate), 'evidence_limit');
  });
});

test('at most 256 newest compact records are inspected and proof outside the window is unavailable', () => {
  withStore((store) => {
    const inside = 'session-window-inside';
    store.ingest(tokens('window-usage-inside', { sessionId: inside, timestamp: T1 }));
    for (let index = 0; index < SESSION_METRICS_LIMITS.records - 1; index += 1)
      store.ingest(modelOnly(`inside-filler-${index}`, T2, inside));
    assert.equal(available(store.sessionMetrics(inside)).evidence.eventId, 'window-usage-inside');

    const outside = 'session-window-outside';
    store.ingest(tokens('window-usage-outside', { sessionId: outside, timestamp: T1 }));
    for (let index = 0; index < SESSION_METRICS_LIMITS.records; index += 1)
      store.ingest(modelOnly(`outside-filler-${index}`, T2, outside));
    // The newest 256 rows exclude the proof; there is no fallback to events or JSONL.
    unavailable(store.sessionMetrics(outside), 'evidence_limit');
  });
});

test('compact columns are validated against metadata and corrupt rows fail closed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'orqst-live-metrics-qa-tamper-'));
  const path = join(dir, 'orqst.sqlite');
  const store = new Store(path);
  try {
    const sessionId = 'session-tamper';
    store.ingest(tokens('tamper-usage', { sessionId, timestamp: T1 }));
    assert.equal(available(store.sessionMetrics(sessionId)).evidence.eventId, 'tamper-usage');

    const side = new DatabaseSync(path);
    try {
      side.exec('PRAGMA busy_timeout=5000');
      side.prepare('UPDATE analytics_evidence SET timestamp=? WHERE id=?').run(T2, 'tamper-usage');
    } finally {
      side.close();
    }
    unavailable(store.sessionMetrics(sessionId), 'invalid_evidence');
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('unsupported adapters, invalid usage rows and incremental usage stay unavailable', () => {
  withStore((store) => {
    const claude = 'session-claude';
    store.ingest(
      tokens('claude-usage', { sessionId: claude, adapter: 'claude', agentId: 'claude-agent' }),
    );
    unavailable(store.sessionMetrics(claude), 'unsupported_adapter');

    const incremental = 'session-incremental';
    store.ingest(
      event({
        id: 'incremental-usage',
        sessionId: incremental,
        agentId: 'incremental-agent',
        payload: { usage, usageKind: 'response_incremental', responseId: 'synthetic-response' },
      }),
    );
    unavailable(store.sessionMetrics(incremental), 'usage_not_recorded');

    const cached = 'session-cached-above-input';
    store.ingest(
      tokens('cached-usage', {
        sessionId: cached,
        agentId: 'cached-agent',
        usage: { input: 5, output: 1, cached: 9, total: 6 },
      }),
    );
    unavailable(store.sessionMetrics(cached), 'invalid_evidence');

    const total = 'session-total-mismatch';
    store.ingest(
      tokens('total-usage', {
        sessionId: total,
        agentId: 'total-agent',
        usage: { input: 5, output: 1, cached: 0, total: 99 },
      }),
    );
    unavailable(store.sessionMetrics(total), 'invalid_evidence');
  });
});

test('reads stay consistent inside a caller transaction and leave no open transaction', () => {
  withStore((store) => {
    const sessionId = 'session-transaction';
    store.ingest(tokens('transaction-usage', { sessionId, timestamp: T1 }));
    const inside = store.transaction(() => store.sessionMetrics(sessionId));
    assert.equal(available(inside).evidence.occurredAt, T1);
    assert.equal(
      store.transaction(() => 7),
      7,
    );

    // A read outside a transaction must not leave a dangling transaction behind.
    available(store.sessionMetrics(sessionId));
    store.ingest(tokens('transaction-later', { sessionId: 'session-later', timestamp: T2 }));
    assert.equal(
      store.sessions().some((session) => session.id === 'session-later'),
      true,
    );
  });
});

interface Trace {
  statements: string[];
  reads: string[];
}

/** Read-only wrapper used by QA to observe which SQL the bounded query prepares and runs. */
function traced(
  db: DatabaseSync,
  afterCanonicalRead?: () => void,
): { database: DatabaseSync; trace: Trace } {
  const trace: Trace = { statements: [], reads: [] };
  let firstRead = true;
  const database = {
    get isTransaction(): boolean {
      return db.isTransaction;
    },
    exec(sql: string) {
      return db.exec(sql);
    },
    prepare(sql: string) {
      trace.statements.push(sql);
      const statement = db.prepare(sql);
      return {
        get(...params: SQLInputValue[]) {
          trace.reads.push(sql);
          const row = statement.get(...params);
          if (firstRead) {
            firstRead = false;
            afterCanonicalRead?.();
          }
          return row;
        },
        all(...params: SQLInputValue[]) {
          trace.reads.push(sql);
          return statement.all(...params);
        },
        run(...params: SQLInputValue[]) {
          return statement.run(...params);
        },
      };
    },
  } as unknown as DatabaseSync;
  return { database, trace };
}

const materialization = 'timestamp,metadata FROM analytics_evidence';

test('byte admission never materializes metadata when the budget fails', () => {
  const dir = mkdtempSync(join(tmpdir(), 'orqst-live-metrics-qa-budget-'));
  const path = join(dir, 'orqst.sqlite');
  const store = new Store(path);
  let reader: DatabaseSync | undefined;
  try {
    const oversized = 'session-trace-oversized';
    store.ingest(
      tokens('trace-oversized-usage', {
        sessionId: oversized,
        source: {
          file: `synthetic/${'x'.repeat(SESSION_METRICS_LIMITS.recordBytes)}.jsonl`,
          offset: 0,
          line: 1,
          hash,
          recordType: 'token_usage_record',
        },
      }),
    );
    reader = new DatabaseSync(path);
    const rejected = traced(reader);
    unavailable(readSessionMetrics(rejected.database, oversized), 'evidence_limit');
    // Sizes were read; the metadata column never crossed into JS and was never parsed.
    assert.equal(
      rejected.trace.statements.some((sql) => sql.includes('length(CAST(metadata')),
      true,
    );
    assert.equal(
      rejected.trace.reads.some((sql) => sql.includes(materialization)),
      false,
    );

    const valid = 'session-trace-valid';
    store.ingest(tokens('trace-valid-usage', { sessionId: valid, timestamp: T1 }));
    const admitted = traced(reader);
    assert.equal(
      available(readSessionMetrics(admitted.database, valid)).evidence.eventId,
      'trace-valid-usage',
    );
    assert.equal(
      admitted.trace.reads.some((sql) => sql.includes(materialization)),
      true,
    );
  } finally {
    reader?.close();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a concurrent external writer cannot mix the canonical row with newer evidence', () => {
  const dir = mkdtempSync(join(tmpdir(), 'orqst-live-metrics-qa-concurrent-'));
  const path = join(dir, 'orqst.sqlite');
  const store = new Store(path);
  let reader: DatabaseSync | undefined;
  let writer: DatabaseSync | undefined;
  try {
    const sessionId = 'session-concurrent';
    store.ingest(tokens('concurrent-usage', { sessionId, timestamp: T1 }));
    reader = new DatabaseSync(path);
    writer = new DatabaseSync(path);
    writer.exec('PRAGMA busy_timeout=5000');

    const metadata = (id: string, timestamp: string, value: Usage): string =>
      JSON.stringify({
        id,
        timestamp,
        machineId: 'synthetic-machine',
        agentId: 'synthetic-agent',
        adapter: 'codex',
        sessionId,
        workspaceId: 'synthetic-workspace',
        source: {
          file: 'synthetic/live-metrics.jsonl',
          offset: 99,
          line: 99,
          hash,
          recordType: 'token_usage_record',
        },
        correlation: { turnId: 'synthetic-turn' },
        payload: { model: null, usage: value, usageKind: 'session_cumulative', responseId: null },
      });

    // Commit a replacement snapshot after the canonical row was read but before the
    // evidence window is read. A consistent read snapshot must still answer with T1.
    const concurrent = traced(reader, () => {
      writer!
        .prepare(
          `INSERT INTO token_usage VALUES (?,?,?,?,?,?,?) ON CONFLICT(session_id) DO UPDATE SET
           input=excluded.input,output=excluded.output,cached=excluded.cached,total=excluded.total,
           source_priority=excluded.source_priority,timestamp=excluded.timestamp`,
        )
        .run(sessionId, 500, 50, 0, 550, 2, T2);
      writer!.prepare('DELETE FROM analytics_evidence WHERE id=?').run('concurrent-usage');
      writer!
        .prepare(
          `INSERT INTO analytics_evidence(sequence,id,session_id,timestamp,metadata)
           SELECT COALESCE(MAX(sequence),0)+1,?,?,?,? FROM analytics_evidence`,
        )
        .run(
          'concurrent-replacement',
          sessionId,
          T2,
          metadata('concurrent-replacement', T2, { input: 500, output: 50, cached: 0, total: 550 }),
        );
    });
    const result = readSessionMetrics(concurrent.database, sessionId);
    const value = available(result);
    assert.equal(value.evidence.eventId, 'concurrent-usage');
    assert.equal(value.evidence.occurredAt, T1);
    assert.deepEqual(value.usage, usage);

    // The committed writer state is visible only to a fresh read.
    const after = available(readSessionMetrics(reader, sessionId));
    assert.equal(after.evidence.eventId, 'concurrent-replacement');
    assert.equal(after.evidence.occurredAt, T2);
    assert.equal(after.usage.total, 550);
  } finally {
    writer?.close();
    reader?.close();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('schema rejects leaked provider fields and forged availability envelopes', () => {
  const value = {
    contract: 'orqst.live-metrics',
    contractVersion: 1,
    identity: {
      sessionRef: { machineId: 'm', adapterId: 'codex', nativeSessionId: 's' },
      agentId: 'a',
      sourceWorkspaceId: 'w',
    },
    usage,
    usageKind: 'session_cumulative',
    normalization: 'codex_session_snapshot',
    fieldPresence: 'not_preserved',
    evidence: {
      kind: 'compact_evidence',
      eventId: 'e',
      sequence: 1,
      occurredAt: T1,
      observedAt: { availability: 'unavailable', reason: 'not_recorded' },
      sourceVerification: 'not_rechecked',
      source: { file: 'f', offset: 0, line: 1, hash, recordType: 'token_usage_record' },
      turnId: null,
      responseId: null,
    },
  };
  assert.equal(
    sessionMetricsResultSchema.safeParse({ availability: 'available', value }).success,
    true,
  );
  for (const invalid of [
    { availability: 'available', value: { ...value, cost: 0 } },
    { availability: 'available', value: { ...value, usage: { ...usage, cached: 999 } } },
    { availability: 'available', value: { ...value, usage: { ...usage, total: 1 } } },
    { availability: 'available', value: { ...value, usageKind: 'response_incremental' } },
    { availability: 'available', value: { ...value, normalization: 'provider_reported' } },
    { availability: 'available', value: { ...value, fieldPresence: 'explicit' } },
    {
      availability: 'available',
      value: { ...value, evidence: { ...value.evidence, kind: 'event' } },
    },
    { availability: 'unavailable', reason: 'zero' },
    { availability: 'unavailable', reason: 'evidence_missing', usage },
  ])
    assert.equal(
      sessionMetricsResultSchema.safeParse(invalid).success,
      false,
      JSON.stringify(invalid),
    );
});

async function withServer<T>(
  action: (context: { origin: string; cookie: string; store: Store }) => Promise<T>,
): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'orqst-live-metrics-qa-http-'));
  const store = new Store(':memory:');
  const server = createLocalServer(
    store,
    {
      port: 0,
      dataDir: dir,
      sessionsDir: dir,
      dashboardDir: dir,
      retentionDays: 30,
      pollMs: 1000,
      dev: false,
    },
    {
      diagnostics: {
        files: 0,
        malformed: 0,
        skipped: 0,
        oversized: 0,
        errors: 0,
        lastScan: null,
        scanning: false,
      },
    },
  );
  try {
    const origin = `http://127.0.0.1:${await server.listen()}`;
    const bootstrap = await fetch(origin + '/api/bootstrap');
    const cookie = bootstrap.headers.get('set-cookie')!.split(';')[0]!;
    return await action({ origin, cookie, store });
  } finally {
    await server.close();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

test('HTTP metrics endpoint is authenticated, parameterless and keeps the hardened headers', async () => {
  await withServer(async ({ origin, cookie, store }) => {
    store.ingest(tokens('http-usage', { sessionId: 'http-session', timestamp: T1 }));

    const response = await fetch(`${origin}/api/sessions/http-session/metrics`, {
      headers: { Cookie: cookie },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.match(response.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/);
    const body = await response.json();
    const parsed = sessionMetricsResultSchema.safeParse(body);
    assert.equal(parsed.success, true);
    assert.equal(available(parsed.data!).evidence.occurredAt, T1);

    for (const query of ['?after=1', '?a=1&a=2', '?sessionId=other']) {
      const rejected = await fetch(`${origin}/api/sessions/http-session/metrics${query}`, {
        headers: { Cookie: cookie },
      });
      assert.equal(rejected.status, 400, query);
      assert.deepEqual(await rejected.json(), { error: 'invalid_metrics_request' });
    }

    // A bare trailing '?' carries no parameter and stays a valid request.
    const bare = await fetch(`${origin}/api/sessions/http-session/metrics?`, {
      headers: { Cookie: cookie },
    });
    assert.equal(bare.status, 200);

    assert.equal((await fetch(`${origin}/api/sessions/http-session/metrics`)).status, 401);
    assert.equal(
      (
        await fetch(`${origin}/api/sessions/http-session/metrics`, {
          headers: { Cookie: cookie, Origin: 'http://evil.invalid' },
        })
      ).status,
      403,
    );
    assert.notEqual(
      (
        await fetch(`${origin}/api/sessions/http-session/metrics`, {
          method: 'POST',
          headers: { Cookie: cookie, 'Content-Type': 'application/json' },
          body: '{}',
        })
      ).status,
      200,
    );

    const missing = await fetch(`${origin}/api/sessions/http-unknown/metrics`, {
      headers: { Cookie: cookie },
    });
    assert.equal(missing.status, 200);
    unavailable(sessionMetricsResultSchema.parse(await missing.json()), 'session_not_found');
  });
});

test('HTTP decodes session identifiers and rejects malformed encodings without a 5xx', async () => {
  await withServer(async ({ origin, cookie, store }) => {
    const sessionId = 'http/session with space';
    store.ingest(tokens('encoded-usage', { sessionId, timestamp: T1 }));
    const encoded = await fetch(`${origin}/api/sessions/${encodeURIComponent(sessionId)}/metrics`, {
      headers: { Cookie: cookie },
    });
    assert.equal(encoded.status, 200);
    assert.equal(
      available(sessionMetricsResultSchema.parse(await encoded.json())).evidence.occurredAt,
      T1,
    );

    const malformed = await fetch(`${origin}/api/sessions/%E0%A4%A/metrics`, {
      headers: { Cookie: cookie },
    });
    assert.equal(malformed.status, 400);
  });
});
