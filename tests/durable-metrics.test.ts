// Synthetic durable Analytics evidence tests. No installed database or native sessions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  ANALYTICS_READ_LIMITS,
  AnalyticsReadCapacityError,
  Store,
  readModelAnalyticsSummary,
} from '@orqst/database';
import type { AgentEvent, Usage } from '@orqst/protocol';
import { AnalyticsQueries, AnalyticsQueryError } from '../apps/bridge/src/analytics.js';

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
  const normalizedPayload =
    payload.usage && payload.usageKind === undefined
      ? { ...payload, usageKind: 'session_cumulative' as const }
      : payload;
  return {
    schemaVersion: 1,
    id,
    type: payload.usage ? 'agent.tokens.updated' : 'session.updated',
    timestamp: time(minute),
    adapter: 'codex',
    machineId: 'synthetic-machine',
    workspaceId: 'synthetic-workspace',
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
    payload: normalizedPayload,
    ...extra,
  };
}

// Schema 1 DDL snapshot: migration 2 must be tested from a real v1 archive,
// without depending on git or the current migration array at runtime.
const SCHEMA_1 = `
CREATE TABLE machines (id TEXT PRIMARY KEY, created_at TEXT NOT NULL);
CREATE TABLE workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL);
CREATE TABLE agents (id TEXT PRIMARY KEY, machine_id TEXT NOT NULL REFERENCES machines(id), name TEXT NOT NULL, adapter TEXT NOT NULL);
CREATE TABLE sessions (
 id TEXT PRIMARY KEY, agent_id TEXT NOT NULL REFERENCES agents(id), workspace_id TEXT NOT NULL REFERENCES workspaces(id), cwd TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'unknown', started_at TEXT NOT NULL, last_activity TEXT NOT NULL, state_at TEXT NOT NULL,
 task TEXT, result TEXT, model TEXT, parent_session_id TEXT, manual_workspace INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE events (sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, session_id TEXT NOT NULL REFERENCES sessions(id), timestamp TEXT NOT NULL, type TEXT NOT NULL, envelope TEXT NOT NULL);
CREATE INDEX events_session_sequence ON events(session_id, sequence);
CREATE INDEX events_timestamp ON events(timestamp);
CREATE TABLE messages (event_id TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE, session_id TEXT NOT NULL REFERENCES sessions(id), role TEXT NOT NULL, text TEXT NOT NULL);
CREATE TABLE token_usage (session_id TEXT PRIMARY KEY REFERENCES sessions(id), input INTEGER NOT NULL DEFAULT 0, output INTEGER NOT NULL DEFAULT 0, cached INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL DEFAULT 0, source_priority INTEGER NOT NULL DEFAULT 0, timestamp TEXT NOT NULL);
CREATE TABLE notifications (id TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE, session_id TEXT NOT NULL REFERENCES sessions(id), type TEXT NOT NULL, timestamp TEXT NOT NULL, is_read INTEGER NOT NULL DEFAULT 0);
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE synchronization_state (source TEXT PRIMARY KEY, offset INTEGER NOT NULL, line INTEGER NOT NULL, identity TEXT NOT NULL, anchor TEXT NOT NULL, state TEXT NOT NULL);
`;

function insertEvent(db: DatabaseSync, value: AgentEvent): void {
  db.prepare('INSERT INTO events (id,session_id,timestamp,type,envelope) VALUES (?,?,?,?,?)').run(
    value.id,
    value.sessionId,
    value.timestamp,
    value.type,
    JSON.stringify(value),
  );
}

function seedV1(db: DatabaseSync, events: AgentEvent[]): void {
  db.prepare('INSERT INTO machines VALUES (?,?)').run('synthetic-machine', time(0));
  db.prepare('INSERT INTO workspaces VALUES (?,?,?)').run(
    'synthetic-workspace',
    'Synthetic workspace',
    '/synthetic/workspace',
  );
  db.prepare('INSERT INTO agents VALUES (?,?,?,?)').run(
    'synthetic-agent',
    'synthetic-machine',
    'Synthetic agent',
    'codex',
  );
  db.prepare(
    'INSERT INTO sessions (id,agent_id,workspace_id,cwd,status,started_at,last_activity,state_at,task,result,model,parent_session_id,manual_workspace) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0)',
  ).run(
    'synthetic-session',
    'synthetic-agent',
    'synthetic-workspace',
    '/synthetic/private-cwd',
    'running',
    time(0),
    time(5),
    time(5),
    'SYNTHETIC_PRIVATE_TASK',
    'SYNTHETIC_PRIVATE_RESULT',
    'model-a',
    null,
  );
  db.prepare('INSERT INTO token_usage VALUES (?,?,?,?,?,?,?)').run(
    'synthetic-session',
    30,
    0,
    0,
    30,
    2,
    time(5),
  );
  db.prepare('INSERT INTO settings VALUES (?,?)').run(
    'machineId',
    JSON.stringify('synthetic-machine'),
  );
  db.prepare('INSERT INTO settings VALUES (?,?)').run('custom', JSON.stringify(42));
  db.prepare('INSERT INTO synchronization_state VALUES (?,?,?,?,?,?)').run(
    'synthetic-source',
    100,
    2,
    'synthetic-identity',
    'synthetic-anchor',
    '{}',
  );
  for (const value of events) insertEvent(db, value);
}

function createV1(file: string, events: AgentEvent[], conflict = false): void {
  const db = new DatabaseSync(file);
  try {
    db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
    db.exec(SCHEMA_1);
    db.exec('PRAGMA user_version=1');
    if (conflict) db.exec('CREATE TABLE analytics_evidence (x TEXT)');
    seedV1(db, events);
  } finally {
    db.close();
  }
}

function durableRows(file: string): Array<{ sequence: number; id: string; metadata: string }> {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return db
      .prepare('SELECT sequence,id,metadata FROM analytics_evidence ORDER BY sequence')
      .all()
      .map((row) => ({
        sequence: Number(row.sequence),
        id: String(row.id),
        metadata: String(row.metadata),
      }));
  } finally {
    db.close();
  }
}

function assertMetadataAllowlist(metadata: string): void {
  const value = JSON.parse(metadata) as Record<string, unknown>;
  assert.deepEqual(Object.keys(value).sort(), [
    'adapter',
    'agentId',
    'correlation',
    'id',
    'machineId',
    'payload',
    'sessionId',
    'source',
    'timestamp',
    'workspaceId',
  ]);
  assert.deepEqual(Object.keys(value.source as Record<string, unknown>).sort(), [
    'file',
    'hash',
    'line',
    'offset',
    'recordType',
  ]);
  assert.deepEqual(Object.keys(value.correlation as Record<string, unknown>), ['turnId']);
  assert.deepEqual(Object.keys(value.payload as Record<string, unknown>).sort(), [
    'model',
    'responseId',
    'usage',
    'usageKind',
  ]);
  const payloadUsage = (value.payload as Record<string, unknown>).usage;
  if (payloadUsage && typeof payloadUsage === 'object')
    assert.deepEqual(Object.keys(payloadUsage as Record<string, unknown>).sort(), [
      'cached',
      'input',
      'output',
      'total',
    ]);
  const serialized = JSON.stringify(value);
  for (const forbidden of [
    'SYNTHETIC_PRIVATE_TASK',
    'SYNTHETIC_PRIVATE_RESULT',
    'SYNTHETIC_PRIVATE_TEXT',
    '/synthetic/private-cwd',
    'arguments',
    'tool',
  ])
    assert.equal(serialized.includes(forbidden), false, forbidden);
}

test('migration 2 backfills only metric evidence, preserves v1 identity/checkpoints/totals, and reopens idempotently', () => {
  const directory = mkdtempSync(join(tmpdir(), 'orqst-durable-upgrade-'));
  const file = join(directory, 'orqst.db');
  const modelUsage = event('model-usage', 0, {
    model: 'model-a',
    usage: usage(10),
    usageKind: 'session_cumulative',
    text: 'SYNTHETIC_PRIVATE_TEXT',
    result: 'SYNTHETIC_PRIVATE_RESULT',
    cwd: '/synthetic/private-cwd',
  });
  const usageOnly = event('usage-only', 1, {
    usage: usage(5),
    usageKind: 'session_cumulative',
    text: 'SYNTHETIC_PRIVATE_TEXT',
  });
  const modelOnly = event('model-only', 2, { model: 'model-b' });
  const messageOnly = event(
    'message-only',
    3,
    { role: 'assistant', text: 'SYNTHETIC_PRIVATE_TEXT' },
    { type: 'agent.message' },
  );
  createV1(file, [modelUsage, usageOnly, modelOnly, messageOnly]);
  let store: Store | undefined;
  try {
    store = new Store(file);
    assert.equal(store.machineId, 'synthetic-machine');
    assert.equal(store.setting('custom', 0), 42);
    assert.deepEqual(
      { ...store.checkpoint('synthetic-source') },
      {
        offset: 100,
        line: 2,
        identity: 'synthetic-identity',
        anchor: 'synthetic-anchor',
        state: '{}',
      },
    );
    assert.equal(store.totals().total, 30);
    assert.equal(store.cursor(), 4);
    assert.deepEqual(
      store.events().map((value) => value.sequence),
      [1, 2, 3, 4],
    );
    assert.equal(store.sessions()[0]?.id, 'synthetic-session');
    assert.equal(store.sessions()[0]?.task, 'SYNTHETIC_PRIVATE_TASK');

    const raw = new DatabaseSync(file, { readOnly: true });
    try {
      assert.equal(Number(raw.prepare('PRAGMA user_version').get()?.user_version), 2);
      const columns = raw
        .prepare('PRAGMA table_info(analytics_evidence)')
        .all()
        .map((row) => String(row.name));
      assert.deepEqual(columns, ['sequence', 'id', 'session_id', 'timestamp', 'metadata']);
      const foreignKeys = raw
        .prepare('PRAGMA foreign_key_list(analytics_evidence)')
        .all()
        .map((row) => String(row.table));
      assert.equal(foreignKeys.includes('events'), false);
    } finally {
      raw.close();
    }

    const rows = durableRows(file);
    assert.deepEqual(
      rows.map((row) => row.id),
      ['model-usage', 'usage-only', 'model-only'],
    );
    assert.deepEqual(
      rows.map((row) => row.sequence),
      [1, 2, 3],
    );
    for (const row of rows) assertMetadataAllowlist(row.metadata);
    const byId = new Map(rows.map((row) => [row.id, JSON.parse(row.metadata) as AgentEvent]));
    assert.equal((byId.get('usage-only')?.payload as AgentEvent['payload']).model, null);
    assert.equal((byId.get('model-only')?.payload as AgentEvent['payload']).usage, null);

    store.close();
    store = new Store(file);
    assert.equal(durableRows(file).length, 3);
    assert.equal(store.totals().total, 30);
    assert.equal(store.cursor(), 4);
    assert.equal(store.setting('custom', 0), 42);
  } finally {
    store?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a failing migration 2 rolls back to schema 1 and leaves the v1 archive usable', () => {
  const directory = mkdtempSync(join(tmpdir(), 'orqst-durable-rollback-'));
  const file = join(directory, 'orqst.db');
  createV1(file, [event('rollback-event', 0, { model: 'model-a', usage: usage(10) })], true);
  try {
    assert.throws(() => new Store(file));
    const raw = new DatabaseSync(file, { readOnly: true });
    try {
      assert.equal(Number(raw.prepare('PRAGMA user_version').get()?.user_version), 1);
      assert.equal(Number(raw.prepare('SELECT COUNT(*) AS count FROM events').get()?.count), 1);
      assert.equal(
        Number(
          raw.prepare("SELECT COUNT(*) AS count FROM settings WHERE key='custom'").get()?.count,
        ),
        1,
      );
      assert.deepEqual(
        raw
          .prepare('PRAGMA table_info(analytics_evidence)')
          .all()
          .map((row) => String(row.name)),
        ['x'],
      );
    } finally {
      raw.close();
    }
    const repair = new DatabaseSync(file);
    repair.exec('DROP TABLE analytics_evidence');
    repair.close();
    const store = new Store(file);
    try {
      assert.equal(store.totals().total, 30);
      assert.equal(durableRows(file).length, 1);
    } finally {
      store.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('migration rollback after DDL handles a malformed envelope during backfill, then reopens', () => {
  const directory = mkdtempSync(join(tmpdir(), 'orqst-durable-malformed-'));
  const file = join(directory, 'orqst.db');
  createV1(file, [event('valid', 0, { model: 'model-a', usage: usage(10) })]);
  const writer = new DatabaseSync(file);
  try {
    writer
      .prepare('INSERT INTO events (id,session_id,timestamp,type,envelope) VALUES (?,?,?,?,?)')
      .run('malformed', 'synthetic-session', time(1), 'session.updated', '{');
  } finally {
    writer.close();
  }
  try {
    assert.throws(() => new Store(file));
    const raw = new DatabaseSync(file, { readOnly: true });
    try {
      assert.equal(Number(raw.prepare('PRAGMA user_version').get()?.user_version), 1);
      assert.equal(Number(raw.prepare('SELECT COUNT(*) AS count FROM events').get()?.count), 2);
      assert.equal(
        Number(
          raw.prepare("SELECT COUNT(*) AS count FROM settings WHERE key='custom'").get()?.count,
        ),
        1,
      );
      assert.equal(
        raw
          .prepare(
            "SELECT COUNT(*) AS count FROM sqlite_master WHERE name LIKE 'analytics_evidence%'",
          )
          .get()?.count,
        0,
      );
    } finally {
      raw.close();
    }
    const repair = new DatabaseSync(file);
    repair.prepare('DELETE FROM events WHERE id=?').run('malformed');
    repair.close();
    let store = new Store(file);
    try {
      assert.equal(store.totals().total, 30);
      assert.equal(durableRows(file).length, 1);
    } finally {
      store.close();
    }
    store = new Store(file);
    try {
      assert.equal(durableRows(file).length, 1);
    } finally {
      store.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

function alignCanonical(file: string, timestamp: string): void {
  const db = new DatabaseSync(file);
  db.prepare('UPDATE token_usage SET timestamp=?').run(timestamp);
  db.close();
}

test('retention before upgrade cannot reconstruct already-deleted history', () => {
  const directory = mkdtempSync(join(tmpdir(), 'orqst-durable-preretain-'));
  const file = join(directory, 'orqst.db');
  createV1(file, [
    event('old-model', 0, { model: 'model-old', usage: usage(10) }),
    event('recent-model', 4, { model: 'model-new', usage: usage(30) }),
  ]);
  alignCanonical(file, time(4));
  const before = new DatabaseSync(file);
  before.prepare('DELETE FROM events WHERE timestamp < ?').run(time(3));
  before.close();
  try {
    const store = new Store(file);
    try {
      assert.equal(store.totals().total, 30);
      assert.equal(durableRows(file).length, 1);
      assert.equal(durableRows(file)[0]?.id, 'recent-model');
      const report = store.modelAnalytics();
      assert.equal(JSON.stringify(report).includes('model-old'), false);
      assert.equal(report.sessions, 1);
      assert.equal(report.usage?.total, 30);
      assert.equal(report.models.find((row) => row.model === null)?.usage?.total, 30);
      assert.equal(report.models.find((row) => row.model === 'model-new')?.usage, null);
      assert.equal(
        report.models.find((row) => row.model === null)?.contributions[0]?.attribution,
        'unbounded_snapshot',
      );
      assert.equal(report.coverage.gaps.length, 0);
    } finally {
      store.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a pre-retained unbounded snapshot stays unidentified instead of guessing a model', () => {
  const directory = mkdtempSync(join(tmpdir(), 'orqst-durable-unbounded-'));
  const file = join(directory, 'orqst.db');
  createV1(file, [event('only-snapshot', 0, { usage: usage(30) })]);
  alignCanonical(file, time(0));
  try {
    const store = new Store(file);
    try {
      const report = store.modelAnalytics();
      const unidentified = report.models.find((row) => row.model === null);
      assert.equal(report.usage?.total, 30);
      assert.equal(unidentified?.usage?.total, 30);
      assert.equal(unidentified?.contributions[0]?.attribution, 'unbounded_snapshot');
      assert.equal(report.coverage.gaps.length, 0);
    } finally {
      store.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('all details pre-expurgated leave canonical_evidence_missing, not reconstructed usage', () => {
  const directory = mkdtempSync(join(tmpdir(), 'orqst-durable-allgone-'));
  const file = join(directory, 'orqst.db');
  createV1(file, [event('gone', 0, { model: 'model-a', usage: usage(30) })]);
  alignCanonical(file, time(0));
  const before = new DatabaseSync(file);
  before.exec('DELETE FROM events');
  before.close();
  try {
    const store = new Store(file);
    try {
      assert.equal(durableRows(file).length, 0);
      const report = store.modelAnalytics();
      assert.equal(report.usage, null);
      assert.equal(report.coverage.gaps[0]?.reason, 'canonical_evidence_missing');
      assert.equal(report.sessions, 1);
    } finally {
      store.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('durable evidence survives retention and preserves conservative model attribution', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'orqst-durable-retain-'));
  const file = join(directory, 'orqst.db');
  const store = new Store(file, 1);
  const queries = new AnalyticsQueries(realpathSync(file));
  try {
    store.ingest(event('old', 0, { model: 'model-a', usage: usage(0) }));
    store.ingest({
      ...event('recent', 4, { model: 'model-a', usage: usage(20) }),
      timestamp: '2026-11-04T12:00:00.000Z',
    });
    assert.equal(durableRows(file).length, 2);
    store.retain(Date.parse('2026-11-05T00:00:00Z'));
    assert.equal(store.events().length, 1);
    assert.equal(durableRows(file).length, 2);
    let report = store.modelAnalytics();
    assert.equal(report.usage?.total, 20);
    assert.equal(report.coverage.gaps.length, 0);
    store.retain(Date.parse('2026-11-06T00:00:00Z'));
    assert.equal(store.events().length, 0);
    assert.equal(durableRows(file).length, 2);
    report = store.modelAnalytics();
    assert.equal(report.usage?.total, 20);
    assert.equal(report.coverage.gaps.length, 0);

    assert.deepEqual(await queries.query({}), store.modelAnalyticsSummary({}));
    await queries.close();
    await assert.rejects(
      queries.query({}),
      (error: unknown) =>
        error instanceof AnalyticsQueryError && error.code === 'analytics_cancelled',
    );
  } finally {
    await queries.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('ingestion is atomic and idempotent across events and durable evidence, including after retain', () => {
  const directory = mkdtempSync(join(tmpdir(), 'orqst-durable-ingest-'));
  const file = join(directory, 'orqst.db');
  const store = new Store(file);
  try {
    const value = event('duplicate', 0, { model: 'model-a', usage: usage(10) });
    assert.ok(store.ingest(value));
    assert.equal(store.ingest(value), undefined);
    assert.equal(durableRows(file).length, 1);

    const mirror = {
      ...event('mirror', 1, { model: 'model-a', usage: usage(20) }),
      source: { ...value.source, recordType: 'event_msg:token_count' },
    };
    store.ingest(mirror);
    assert.equal(durableRows(file).length, 2);
    assert.equal(store.modelAnalytics().usage?.total, 20);

    store.retain(Date.parse('2026-12-05T00:00:00Z'));
    assert.equal(store.events().length, 0);
    assert.equal(store.ingest(value), undefined);
    assert.equal(durableRows(file).length, 2);
    store.ingest(event('after-retain', 2, { model: 'model-b', usage: usage(20) }));
    assert.equal(durableRows(file).length, 3);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('aborted compact insert rolls back event, session, token, evidence and checkpoint atomically', () => {
  const directory = mkdtempSync(join(tmpdir(), 'orqst-durable-atomic-'));
  const file = join(directory, 'orqst.db');
  const store = new Store(file);
  try {
    store.saveCheckpoint('stable-source', {
      offset: 7,
      line: 1,
      identity: 'stable-identity',
      anchor: 'stable-anchor',
      state: '{}',
    });
    const writer = new DatabaseSync(file);
    try {
      writer.exec(
        "CREATE TRIGGER abort_compact BEFORE INSERT ON analytics_evidence WHEN NEW.id='atomic-abort' BEGIN SELECT RAISE(ABORT,'synthetic abort'); END;",
      );
    } finally {
      writer.close();
    }
    assert.throws(() =>
      store.transaction(() => {
        store.saveCheckpoint('atomic-source', {
          offset: 99,
          line: 2,
          identity: 'atomic-identity',
          anchor: 'atomic-anchor',
          state: '{}',
        });
        store.ingest(event('atomic-abort', 0, { model: 'model-a', usage: usage(10) }));
      }),
    );
    assert.equal(store.events().length, 0);
    assert.equal(store.sessions().length, 0);
    assert.equal(store.totals().total, 0);
    assert.equal(store.cursor(), 0);
    assert.equal(durableRows(file).length, 0);
    assert.deepEqual(
      { ...store.checkpoint('stable-source') },
      {
        offset: 7,
        line: 1,
        identity: 'stable-identity',
        anchor: 'stable-anchor',
        state: '{}',
      },
    );
    assert.equal(store.checkpoint('atomic-source'), undefined);
    const raw = new DatabaseSync(file, { readOnly: true });
    try {
      assert.equal(
        Number(raw.prepare('SELECT COUNT(*) AS count FROM synchronization_state').get()?.count),
        1,
      );
    } finally {
      raw.close();
    }

    const repair = new DatabaseSync(file);
    repair.exec('DROP TRIGGER abort_compact');
    repair.close();
    store.ingest(event('atomic-ok', 1, { model: 'model-a', usage: usage(10) }));
    assert.equal(store.events().length, 1);
    assert.equal(store.sessions().length, 1);
    assert.equal(store.totals().total, 10);
    assert.equal(durableRows(file).length, 1);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('durable evidence never stores captured content and the read budget still counts message-only events', () => {
  const directory = mkdtempSync(join(tmpdir(), 'orqst-durable-budget-'));
  const file = join(directory, 'orqst.db');
  const store = new Store(file);
  try {
    store.ingest(
      event('metric', 0, {
        model: 'model-a',
        usage: usage(10),
        text: 'SYNTHETIC_PRIVATE_TEXT',
        result: 'SYNTHETIC_PRIVATE_RESULT',
        cwd: '/synthetic/private-cwd',
      }),
    );
    store.ingest(
      event(
        'message-1',
        1,
        { role: 'assistant', text: 'SYNTHETIC_PRIVATE_TEXT' },
        { type: 'agent.message' },
      ),
    );
    store.ingest(
      event(
        'message-2',
        2,
        { role: 'assistant', text: 'SYNTHETIC_PRIVATE_TEXT' },
        { type: 'agent.message' },
      ),
    );
    for (const row of durableRows(file)) assertMetadataAllowlist(row.metadata);
    assert.equal(JSON.stringify(durableRows(file)).includes('SYNTHETIC_PRIVATE'), false);

    const tight = {
      ...ANALYTICS_READ_LIMITS,
      events: 2,
    } as unknown as typeof ANALYTICS_READ_LIMITS;
    assert.throws(
      () => readModelAnalyticsSummary(realpathSync(file), {}, tight),
      AnalyticsReadCapacityError,
    );
    const enough = {
      ...ANALYTICS_READ_LIMITS,
      events: 3,
    } as unknown as typeof ANALYTICS_READ_LIMITS;
    assert.equal(readModelAnalyticsSummary(realpathSync(file), {}, enough).sessions, 1);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
