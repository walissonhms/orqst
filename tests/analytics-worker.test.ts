// Synthetic Analytics worker acceptance tests. No native session or ~/.orqst data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  ANALYTICS_READ_LIMITS,
  AnalyticsCapacityError,
  AnalyticsReadCapacityError,
  readModelAnalyticsSummary,
  Store,
} from '@orqst/database';
import type { AgentEvent } from '@orqst/protocol';
import {
  ANALYTICS_WORKER_LIMITS,
  AnalyticsQueries,
  AnalyticsQueryError,
} from '../apps/bridge/src/analytics.js';
import { createAnalyticsWorkerFixture } from './helpers/analytics-worker-fixture.js';

const at = (minute: number) => new Date(Date.UTC(2026, 10, 2, 12, minute)).toISOString();
const atSecond = (second: number) => new Date(Date.UTC(2026, 10, 2, 12, 0, second)).toISOString();

interface EventOptions {
  id: string;
  sessionId?: string;
  agentId?: string;
  workspaceId?: string;
  adapter?: AgentEvent['adapter'];
  model?: string;
  total?: number;
  timestamp?: string;
  recordType?: string;
  type?: AgentEvent['type'];
  text?: string;
}

function syntheticEvent(options: EventOptions): AgentEvent {
  const total = options.total ?? 0;
  return {
    schemaVersion: 1,
    id: options.id,
    type: options.type ?? 'agent.tokens.updated',
    timestamp: options.timestamp ?? at(0),
    adapter: options.adapter ?? 'codex',
    machineId: 'synthetic-worker-machine',
    workspaceId: options.workspaceId ?? 'synthetic-workspace',
    sessionId: options.sessionId ?? 'synthetic-session',
    agentId: options.agentId ?? 'synthetic-agent',
    correlation: { turnId: 'synthetic-turn' },
    source: {
      file: 'synthetic-worker.jsonl',
      offset: 0,
      line: 1,
      hash: `synthetic-hash-${options.id}`,
      recordType: options.recordType ?? 'token_usage_record',
    },
    payload:
      options.type === 'agent.message'
        ? { role: 'assistant', text: options.text ?? 'Synthetic message only' }
        : {
            ...(options.model === undefined ? {} : { model: options.model }),
            usage: { input: total, output: 0, cached: 0, total },
            usageKind: 'session_cumulative',
            ...(options.text === undefined ? {} : { text: options.text }),
          },
  };
}

function seedParity(store: Store): void {
  const a = {
    sessionId: 'synthetic-parity-a',
    agentId: 'synthetic-agent-a',
    workspaceId: 'synthetic-workspace-a',
  };
  store.ingest(syntheticEvent({ ...a, id: 'parity-a0', model: 'synthetic-alpha', total: 0 }));
  store.ingest(
    syntheticEvent({
      ...a,
      id: 'parity-a1-mirror',
      model: 'synthetic-alpha',
      total: 100,
      timestamp: at(1),
      recordType: 'event_msg:token_count',
    }),
  );
  store.ingest(
    syntheticEvent({
      ...a,
      id: 'parity-a1',
      model: 'synthetic-alpha',
      total: 100,
      timestamp: at(1),
    }),
  );
  // Deterministic replay: same ID must not add a second event or usage.
  store.ingest(
    syntheticEvent({
      ...a,
      id: 'parity-a1',
      model: 'synthetic-alpha',
      total: 100,
      timestamp: at(1),
    }),
  );
  store.ingest(
    syntheticEvent({
      sessionId: 'synthetic-parity-b',
      agentId: 'synthetic-agent-b',
      workspaceId: 'synthetic-workspace-b',
      adapter: 'manual',
      id: 'parity-b0',
      total: 50,
      timestamp: at(2),
    }),
  );
  store.ingest(
    syntheticEvent({
      sessionId: 'synthetic-parity-c',
      agentId: 'synthetic-agent-c',
      workspaceId: 'synthetic-workspace-c',
      id: 'parity-c0',
      model: 'synthetic-alpha',
      total: 10,
      timestamp: at(3),
    }),
  );
  store.ingest(
    syntheticEvent({
      sessionId: 'synthetic-parity-c',
      agentId: 'synthetic-agent-c',
      workspaceId: 'synthetic-workspace-c',
      id: 'parity-c1',
      model: 'synthetic-beta',
      total: 30,
      timestamp: at(4),
    }),
  );
  store.ingest(
    syntheticEvent({
      sessionId: 'synthetic-parity-d',
      agentId: 'synthetic-agent-d',
      workspaceId: 'synthetic-workspace-d',
      id: 'parity-d0',
      type: 'agent.message',
      timestamp: at(5),
    }),
  );
}

/**
 * Representative archive shape, inserted directly so the test measures the
 * reader/worker instead of spending seconds in Store.ingest. Every envelope is
 * still a validated synthetic AgentEvent; no captured content is used.
 */
function seedRepresentativeArchive(
  file: string,
  store: Store,
  sessionCount = 310,
  eventsPerSession = 184,
): void {
  const writer = new DatabaseSync(file);
  const base = Date.parse('2026-11-02T12:00:00.000Z');
  const workspaceId = 'synthetic-archive-workspace';
  const agentId = 'synthetic-archive-agent';
  try {
    writer.exec('PRAGMA foreign_keys=ON; BEGIN IMMEDIATE');
    writer
      .prepare('INSERT OR IGNORE INTO workspaces VALUES (?,?,?)')
      .run(workspaceId, 'Synthetic archive', '/synthetic/archive');
    writer
      .prepare('INSERT OR IGNORE INTO agents VALUES (?,?,?,?)')
      .run(agentId, store.machineId, 'Synthetic archive agent', 'codex');
    const session = writer.prepare(
      'INSERT INTO sessions (id,agent_id,workspace_id,cwd,status,started_at,last_activity,state_at,model,manual_workspace) VALUES (?,?,?,?,?,?,?,?,?,0)',
    );
    const usage = writer.prepare(
      'INSERT INTO token_usage (session_id,input,output,cached,total,source_priority,timestamp) VALUES (?,?,?,?,?,?,?)',
    );
    const event = writer.prepare(
      'INSERT INTO events (id,session_id,timestamp,type,envelope) VALUES (?,?,?,?,?)',
    );
    for (let sessionIndex = 0; sessionIndex < sessionCount; sessionIndex++) {
      const sessionId = `synthetic-archive-session-${sessionIndex}`;
      const model = `synthetic-archive-model-${sessionIndex % 4}`;
      const started = new Date(base + sessionIndex * 60_000).toISOString();
      const last = new Date(
        base + sessionIndex * 60_000 + (eventsPerSession - 1) * 1000,
      ).toISOString();
      session.run(
        sessionId,
        agentId,
        workspaceId,
        '/synthetic/archive',
        'completed',
        started,
        last,
        last,
        model,
      );
      for (let eventIndex = 0; eventIndex < eventsPerSession; eventIndex++) {
        const total = eventIndex * 10;
        const timestamp = new Date(base + sessionIndex * 60_000 + eventIndex * 1000).toISOString();
        const envelope: AgentEvent = {
          schemaVersion: 1,
          id: `synthetic-archive-${sessionIndex}-${eventIndex}`,
          type: 'agent.tokens.updated',
          timestamp,
          adapter: 'codex',
          machineId: store.machineId,
          workspaceId,
          sessionId,
          agentId,
          correlation: { turnId: `synthetic-archive-turn-${sessionIndex}` },
          source: {
            file: `synthetic-archive-${sessionIndex}.jsonl`,
            offset: eventIndex,
            line: eventIndex + 1,
            hash: `synthetic-archive-hash-${sessionIndex}-${eventIndex}`,
            recordType: 'token_usage_record',
          },
          payload: {
            model,
            usage: { input: total, output: 0, cached: 0, total },
            usageKind: 'session_cumulative',
            responseId: `synthetic-archive-response-${sessionIndex}-${eventIndex}`,
          },
        };
        event.run(envelope.id, sessionId, timestamp, envelope.type, JSON.stringify(envelope));
      }
      const finalTotal = (eventsPerSession - 1) * 10;
      usage.run(sessionId, finalTotal, 0, 0, finalTotal, 2, last);
    }
    writer.exec('COMMIT');
  } finally {
    writer.close();
  }
}

test('worker handles a representative 310-session/57k-event synthetic archive', async () => {
  const fixture = createAnalyticsWorkerFixture();
  const queries = new AnalyticsQueries(fixture.database);
  try {
    seedRepresentativeArchive(fixture.database, fixture.store);
    const started = performance.now();
    const report = await queries.query({});
    const elapsed = performance.now() - started;
    assert.equal(report.sessions, 310);
    assert.equal(report.models.filter((row) => row.model !== null).length, 4);
    assert.ok(report.models.some((row) => row.model === null));
    assert.ok((report.usage?.total ?? 0) > 0);
    assert.ok(elapsed < ANALYTICS_WORKER_LIMITS.timeoutMs);
  } finally {
    await queries.close();
    fixture.close();
  }
});

test('worker summary matches the synchronous library across replay, unknown model and scopes', async () => {
  const fixture = createAnalyticsWorkerFixture();
  const queries = new AnalyticsQueries(fixture.database);
  try {
    seedParity(fixture.store);
    const cases = [
      {},
      { from: at(0), to: at(5) },
      { workspaceId: 'synthetic-workspace-a' },
      { agentId: 'synthetic-agent-b' },
      { adapter: 'manual' as const },
      { model: 'synthetic-alpha' },
      { model: null },
    ];
    for (const query of cases) {
      const expected = fixture.store.modelAnalyticsSummary(query);
      const actual = await queries.query(query);
      assert.deepEqual(actual, expected, JSON.stringify(query));
    }
    assert.equal(fixture.store.modelAnalyticsSummary().sessions, 4);
    assert.equal(fixture.store.modelAnalyticsSummary({ model: null }).models[0]?.model, null);
  } finally {
    await queries.close();
    fixture.close();
  }
});

test('worker/library parity survives retention of the evidence detail', async () => {
  const fixture = createAnalyticsWorkerFixture();
  const queries = new AnalyticsQueries(fixture.database);
  try {
    seedParity(fixture.store);
    const removed = fixture.store.retain(Date.parse('2026-12-05T00:00:00.000Z'));
    assert.ok(removed > 0);
    const expected = fixture.store.modelAnalyticsSummary();
    const actual = await queries.query({});
    assert.deepEqual(actual, expected);
    assert.equal(actual.coverage.sessionsWithCanonicalUsage, 3);
  } finally {
    await queries.close();
    fixture.close();
  }
});

test('worker supports histories above the legacy 100-session and 1000-event limits', async () => {
  const sessions = createAnalyticsWorkerFixture();
  const sessionsQueries = new AnalyticsQueries(sessions.database);
  try {
    for (let index = 0; index < 101; index++)
      sessions.store.ingest(
        syntheticEvent({
          id: `bulk-session-${index}`,
          sessionId: `bulk-session-${index}`,
          agentId: 'bulk-agent',
          workspaceId: 'bulk-workspace',
          model: 'bulk-model',
          total: 1,
          timestamp: atSecond(index),
        }),
      );
    assert.throws(() => sessions.store.modelAnalyticsSummary(), AnalyticsCapacityError);
    const report = await sessionsQueries.query({});
    assert.equal(report.sessions, 101);
  } finally {
    await sessionsQueries.close();
    sessions.close();
  }

  const events = createAnalyticsWorkerFixture();
  const eventsQueries = new AnalyticsQueries(events.database);
  try {
    for (let index = 0; index < 1001; index++)
      events.store.ingest(
        syntheticEvent({
          id: `bulk-event-${index}`,
          sessionId: 'bulk-event-session',
          agentId: 'bulk-event-agent',
          workspaceId: 'bulk-event-workspace',
          model: 'bulk-event-model',
          total: index,
          timestamp: atSecond(index),
        }),
      );
    assert.throws(() => events.store.modelAnalyticsSummary(), AnalyticsCapacityError);
    const report = await eventsQueries.query({});
    assert.equal(report.sessions, 1);
  } finally {
    await eventsQueries.close();
    events.close();
  }
});

test('worker supports an envelope above the legacy 2 MiB evidence budget', async () => {
  const fixture = createAnalyticsWorkerFixture();
  const queries = new AnalyticsQueries(fixture.database);
  try {
    fixture.store.ingest(
      syntheticEvent({
        id: 'large-envelope',
        sessionId: 'large-envelope-session',
        agentId: 'large-envelope-agent',
        workspaceId: 'large-envelope-workspace',
        model: 'large-envelope-model',
        total: 1,
        text: 'x'.repeat(2 * 1024 * 1024 + 1024),
      }),
    );
    assert.throws(() => fixture.store.modelAnalyticsSummary(), AnalyticsCapacityError);
    const report = await queries.query({});
    assert.equal(report.sessions, 1);
  } finally {
    await queries.close();
    fixture.close();
  }
});

test('worker enforces one active query, timeout, cancellation and close', async () => {
  const fixture = createAnalyticsWorkerFixture();
  seedParity(fixture.store);

  const busy = new AnalyticsQueries(fixture.database);
  try {
    const first = busy.query({});
    await assert.rejects(
      busy.query({}),
      (error: unknown) => error instanceof AnalyticsQueryError && error.code === 'analytics_busy',
    );
    assert.equal((await first).sessions, 4);
  } finally {
    await busy.close();
  }

  const timeout = new AnalyticsQueries(fixture.database, { timeoutMs: 0 });
  try {
    const started = performance.now();
    await assert.rejects(
      timeout.query({}),
      (error: unknown) =>
        error instanceof AnalyticsQueryError && error.code === 'analytics_timeout',
    );
    // The deadline is a real end-to-end bound: rejection must not wait forever
    // for a worker that is slow to terminate.
    assert.ok(performance.now() - started < 2000);
  } finally {
    await timeout.close();
  }
  const retry = new AnalyticsQueries(fixture.database);
  try {
    assert.equal((await retry.query({})).sessions, 4);
  } finally {
    await retry.close();
  }

  const cancelled = new AnalyticsQueries(fixture.database);
  try {
    const controller = new AbortController();
    const pending = cancelled.query({}, controller.signal);
    controller.abort();
    await assert.rejects(
      pending,
      (error: unknown) =>
        error instanceof AnalyticsQueryError && error.code === 'analytics_cancelled',
    );
    // The slot may remain busy while termination drains; it must become usable
    // after cleanup, and a second concurrent reader must never start.
    let retried;
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        retried = await cancelled.query({});
        break;
      } catch (error) {
        if (error instanceof AnalyticsQueryError && error.code === 'analytics_busy') {
          await new Promise((resolveWait) => setTimeout(resolveWait, 10));
          continue;
        }
        throw error;
      }
    }
    assert.equal(retried?.sessions, 4);
  } finally {
    await cancelled.close();
  }

  const closing = new AnalyticsQueries(fixture.database);
  const pending = closing.query({});
  const close = closing.close();
  await assert.rejects(
    pending,
    (error: unknown) =>
      error instanceof AnalyticsQueryError && error.code === 'analytics_cancelled',
  );
  await close;
  await assert.rejects(
    closing.query({}),
    (error: unknown) =>
      error instanceof AnalyticsQueryError && error.code === 'analytics_cancelled',
  );

  const unavailable = new AnalyticsQueries(null);
  try {
    await assert.rejects(
      unavailable.query({}),
      (error: unknown) =>
        error instanceof AnalyticsQueryError && error.code === 'analytics_unavailable',
    );
  } finally {
    await unavailable.close();
  }

  fixture.close();
  assert.deepEqual(ANALYTICS_WORKER_LIMITS, { concurrency: 1, timeoutMs: 10000 });
});

test('worker keeps the main thread responsive and does not block the writer', async () => {
  const fixture = createAnalyticsWorkerFixture();
  const queries = new AnalyticsQueries(fixture.database);
  try {
    for (let index = 0; index < 101; index++)
      fixture.store.ingest(
        syntheticEvent({
          id: `responsive-${index}`,
          sessionId: `responsive-session-${index}`,
          agentId: 'responsive-agent',
          workspaceId: 'responsive-workspace',
          model: 'responsive-model',
          total: 1,
          timestamp: atSecond(index),
        }),
      );

    const pending = queries.query({});
    const winner = await Promise.race([
      pending.then(
        () => 'query',
        () => 'query',
      ),
      new Promise<string>((resolve) => setTimeout(() => resolve('timer'), 0)),
    ]);
    assert.equal(winner, 'timer');

    // The observer/store writer stays on the main thread. It must be able to
    // commit while the worker is reading its bounded WAL snapshot.
    fixture.store.ingest(
      syntheticEvent({
        id: 'responsive-new-event',
        sessionId: 'responsive-new-session',
        agentId: 'responsive-new-agent',
        workspaceId: 'responsive-new-workspace',
        model: 'responsive-new-model',
        total: 1,
        timestamp: atSecond(500),
      }),
    );
    assert.equal(fixture.store.sessions().length, 102);
    const report = await pending;
    assert.ok(report.sessions >= 101);
  } finally {
    await queries.close();
    fixture.close();
  }
});

test('read-only reader requires canonical path, schema 1 and WAL; writer remains usable', async () => {
  const fixture = createAnalyticsWorkerFixture();
  try {
    seedParity(fixture.store);
    assert.deepEqual(ANALYTICS_READ_LIMITS, {
      sessions: 5000,
      events: 250000,
      evidenceBytes: 256 * 1024 * 1024,
      recordBytes: 8 * 1024 * 1024,
      projectionBytes: 64 * 1024 * 1024,
      summaryBytes: 2 * 1024 * 1024,
    });
    const report = readModelAnalyticsSummary(fixture.database);
    assert.equal(report.sessions, 4);

    // A completed read transaction must not reserve a writer lock.
    fixture.store.ingest(
      syntheticEvent({
        id: 'after-reader',
        sessionId: 'after-reader-session',
        agentId: 'after-reader-agent',
        workspaceId: 'after-reader-workspace',
        model: 'after-reader-model',
        total: 1,
      }),
    );
    assert.equal(fixture.store.sessions().length, 5);

    const schema = new DatabaseSync(fixture.database, { readOnly: true });
    try {
      assert.equal(Number(schema.prepare('PRAGMA user_version').get()?.user_version), 1);
      assert.equal(
        String(schema.prepare('PRAGMA journal_mode').get()?.journal_mode).toLowerCase(),
        'wal',
      );
    } finally {
      schema.close();
    }

    const tightLimits = {
      ...ANALYTICS_READ_LIMITS,
      sessions: 1,
    } as unknown as typeof ANALYTICS_READ_LIMITS;
    assert.throws(
      () => readModelAnalyticsSummary(fixture.database, {}, tightLimits),
      AnalyticsReadCapacityError,
    );
    const tightSummary = {
      ...ANALYTICS_READ_LIMITS,
      summaryBytes: 1,
    } as unknown as typeof ANALYTICS_READ_LIMITS;
    assert.throws(
      () => readModelAnalyticsSummary(fixture.database, {}, tightSummary),
      AnalyticsReadCapacityError,
    );
  } finally {
    fixture.close();
  }

  const schemaDirectory = mkdtempSync(join(tmpdir(), 'orqst-schema-'));
  try {
    const file = join(schemaDirectory, 'schema.db');
    const store = new Store(file);
    store.close();
    const writer = new DatabaseSync(file);
    writer.exec('PRAGMA user_version=2');
    writer.close();
    assert.throws(
      () => readModelAnalyticsSummary(realpathSync(file)),
      /Unsupported Analytics database schema/,
    );
  } finally {
    rmSync(schemaDirectory, { recursive: true, force: true });
  }

  const walDirectory = mkdtempSync(join(tmpdir(), 'orqst-wal-'));
  try {
    const file = join(walDirectory, 'delete.db');
    const writer = new DatabaseSync(file);
    writer.exec('PRAGMA journal_mode=DELETE; PRAGMA user_version=1');
    writer.close();
    assert.throws(() => readModelAnalyticsSummary(realpathSync(file)), /Analytics requires WAL/);
  } finally {
    rmSync(walDirectory, { recursive: true, force: true });
  }

  const linkFixture = createAnalyticsWorkerFixture();
  try {
    const link = join(linkFixture.directory, 'linked.db');
    symlinkSync(linkFixture.database, link);
    assert.throws(() => readModelAnalyticsSummary(link), /must be canonical/);
  } finally {
    linkFixture.close();
  }
});

test('worker maps capacity overflow to analytics_capacity_exceeded', async () => {
  const fixture = createAnalyticsWorkerFixture();
  const queries = new AnalyticsQueries(fixture.database);
  try {
    const writer = new DatabaseSync(fixture.database);
    try {
      writer.exec('PRAGMA foreign_keys=ON');
      const stamp = '2026-11-02T12:00:00.000Z';
      writer
        .prepare('INSERT OR IGNORE INTO workspaces VALUES (?,?,?)')
        .run('raw-workspace', 'Raw workspace', '/synthetic/raw');
      writer
        .prepare('INSERT OR IGNORE INTO agents VALUES (?,?,?,?)')
        .run('raw-agent', fixture.store.machineId, 'Raw agent', 'codex');
      const session = writer.prepare(
        'INSERT INTO sessions (id,agent_id,workspace_id,cwd,status,started_at,last_activity,state_at) VALUES (?,?,?,?,?,?,?,?)',
      );
      const usage = writer.prepare(
        'INSERT INTO token_usage (session_id,input,output,cached,total,source_priority,timestamp) VALUES (?,?,?,?,?,?,?)',
      );
      writer.exec('BEGIN IMMEDIATE');
      for (let index = 0; index <= ANALYTICS_READ_LIMITS.sessions; index++) {
        session.run(
          `raw-session-${index}`,
          'raw-agent',
          'raw-workspace',
          '/synthetic/raw',
          'unknown',
          stamp,
          stamp,
          stamp,
        );
        usage.run(`raw-session-${index}`, 1, 0, 0, 1, 2, stamp);
      }
      writer.exec('COMMIT');
    } finally {
      writer.close();
    }

    await assert.rejects(
      queries.query({}),
      (error: unknown) =>
        error instanceof AnalyticsQueryError && error.code === 'analytics_capacity_exceeded',
    );
  } finally {
    await queries.close();
    fixture.close();
  }
});
