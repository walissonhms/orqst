// Independent session model-history QA. Synthetic events and disposable databases only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { Store } from '@orqst/database';
import {
  sessionModelHistoryLimits,
  sessionModelHistoryResultSchema,
  type AgentEvent,
  type SessionModelHistoryResult,
  type Usage,
} from '@orqst/protocol';
import { createLocalServer } from '../apps/bridge/src/server.js';
import { readSessionModelHistory } from '../packages/database/src/model-history.js';

const T1 = '2026-11-02T10:00:00.000Z';
const T2 = '2026-11-02T11:00:00.000Z';
const hash = 'a'.repeat(64);
const usage: Usage = { input: 987654321, output: 123456789, cached: 111111111, total: 1111111110 };

function event(overrides: Partial<AgentEvent> & { id: string; sessionId: string }): AgentEvent {
  return {
    schemaVersion: 1,
    type: 'agent.updated',
    timestamp: T1,
    adapter: 'codex',
    machineId: 'synthetic-machine',
    workspaceId: 'synthetic-workspace',
    agentId: 'synthetic-agent',
    correlation: { turnId: 'synthetic-turn' },
    source: {
      file: 'synthetic/model-history.jsonl',
      offset: 10,
      line: 3,
      hash,
      recordType: 'turn_context',
    },
    payload: {},
    ...overrides,
  };
}

const modelEvent = (id: string, sessionId: string, model: string | undefined, timestamp = T1) =>
  event({ id, sessionId, timestamp, payload: model === undefined ? {} : { model } });

const usageEvent = (id: string, sessionId: string, timestamp = T1) =>
  event({
    id,
    sessionId,
    timestamp,
    type: 'agent.tokens.updated',
    source: {
      file: 'synthetic/model-history.jsonl',
      offset: 20,
      line: 4,
      hash,
      recordType: 'token_usage_record',
    },
    payload: { usage, usageKind: 'session_cumulative' },
  });

function available(result: SessionModelHistoryResult) {
  assert.equal(result.availability, 'available', JSON.stringify(result));
  if (result.availability !== 'available') throw new Error('unreachable');
  return result.value;
}

function unavailable(result: SessionModelHistoryResult, reason: string): void {
  assert.equal(result.availability, 'unavailable', JSON.stringify(result));
  if (result.availability === 'unavailable') assert.equal(result.reason, reason);
}

function withStore<T>(action: (store: Store) => T): T {
  const store = new Store(':memory:');
  try {
    return action(store);
  } finally {
    store.close();
  }
}

test('entries are normalized records in sequence order, not model changes', () => {
  withStore((store) => {
    const sessionId = 'session-history';
    store.ingest(modelEvent('h1', sessionId, 'synthetic-alpha', T2));
    store.ingest(modelEvent('h2', sessionId, 'synthetic-alpha', T1));
    store.ingest(usageEvent('h3', sessionId, T1));
    const value = available(store.sessionModelHistory(sessionId));
    assert.equal(value.contract, 'orqst.session-model-history');
    assert.equal(value.contractVersion, 1);
    assert.equal(value.sessionId, sessionId);
    assert.equal(value.adapter, 'codex');
    assert.equal(value.coverage, 'partial');
    assert.equal(value.basis, 'normalized_event_carried_identifier');
    assert.equal(value.sourceVerification, 'not_rechecked');
    // Newest sequence first even though h2 carries an older event timestamp.
    assert.deepEqual(
      value.entries.map((entry) => entry.sequence),
      [3, 2, 1],
    );
    assert.deepEqual(
      value.entries.map((entry) => entry.model),
      [null, 'synthetic-alpha', 'synthetic-alpha'],
    );
    // Repetitions are preserved: they are records, never a single "change".
    assert.equal(value.entries.filter((entry) => entry.model === 'synthetic-alpha').length, 2);
    // The time is the normalized event time, not a declaration time.
    assert.equal(value.entries[1]!.normalizedEventAt, T1);
    assert.equal(value.entries[0]!.normalizedEventAt, T1);
    assert.equal(value.entries[0]!.source.recordType, 'token_usage_record');
    assert.equal(value.entries[0]!.source.hash, hash);
  });
});

test('identity of every row is validated before returning, without filtering', () => {
  const dir = mkdtempSync(join(tmpdir(), 'orqst-model-history-qa-identity-'));
  const path = join(dir, 'orqst.sqlite');
  const store = new Store(path);
  try {
    const sessionId = 'session-identity';
    store.ingest(modelEvent('i1', sessionId, 'synthetic-alpha'));
    store.ingest(modelEvent('i2', sessionId, 'synthetic-beta'));
    assert.equal(available(store.sessionModelHistory(sessionId)).entries.length, 2);

    const side = new DatabaseSync(path);
    try {
      side.exec('PRAGMA busy_timeout=5000');
      // Agent identity diverges from the canonical session/agent row.
      side
        .prepare(
          `UPDATE analytics_evidence SET metadata=json_set(metadata,'$.agentId','other-agent') WHERE id=?`,
        )
        .run('i1');
    } finally {
      side.close();
    }
    unavailable(store.sessionModelHistory(sessionId), 'identity_conflict');

    // Column/metadata divergence fails closed as invalid evidence.
    const second = new DatabaseSync(path);
    try {
      second.exec('PRAGMA busy_timeout=5000');
      second.prepare('UPDATE analytics_evidence SET timestamp=? WHERE id=?').run(T2, 'i2');
    } finally {
      second.close();
    }
    unavailable(store.sessionModelHistory(sessionId), 'invalid_evidence');
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('byte admission happens before materializing metadata', () => {
  const dir = mkdtempSync(join(tmpdir(), 'orqst-model-history-qa-budget-'));
  const path = join(dir, 'orqst.sqlite');
  const store = new Store(path);
  let reader: DatabaseSync | undefined;
  try {
    const oversized = 'session-history-bytes';
    store.ingest(modelEvent('b1', oversized, 'x'.repeat(sessionModelHistoryLimits.recordBytes)));
    reader = new DatabaseSync(path);
    const trace = { statements: [] as string[], reads: [] as string[] };
    const database = {
      get isTransaction() {
        return reader!.isTransaction;
      },
      exec(sql: string) {
        return reader!.exec(sql);
      },
      prepare(sql: string) {
        trace.statements.push(sql);
        const statement = reader!.prepare(sql);
        return {
          get(...params: SQLInputValue[]) {
            trace.reads.push(sql);
            return statement.get(...params);
          },
          all(...params: SQLInputValue[]) {
            trace.reads.push(sql);
            return statement.all(...params);
          },
        };
      },
    } as unknown as DatabaseSync;
    unavailable(readSessionModelHistory(database, oversized), 'evidence_limit');
    assert.equal(
      trace.statements.some((sql) => sql.includes('length(CAST(metadata')),
      true,
    );
    // The metadata column is never read when admission fails.
    assert.equal(
      trace.reads.some((sql) => sql.includes('timestamp,metadata FROM analytics_evidence')),
      false,
    );
  } finally {
    reader?.close();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('window, aggregate budget and model length fail closed instead of truncating', () => {
  withStore((store) => {
    const sessionId = 'session-window';
    for (let index = 0; index < sessionModelHistoryLimits.records + 1; index += 1)
      store.ingest(
        modelEvent(
          `w${index}`,
          sessionId,
          `synthetic-${index}`,
          `2026-11-02T10:00:${String(index).padStart(2, '0')}.000Z`,
        ),
      );
    const value = available(store.sessionModelHistory(sessionId));
    assert.equal(value.entries.length, sessionModelHistoryLimits.records);
    assert.equal(value.coverage, 'partial');
    // The oldest record falls outside the bounded window.
    assert.equal(
      value.entries.some((entry) => entry.model === 'synthetic-0'),
      false,
    );

    const long = 'session-long-model';
    store.ingest(modelEvent('long', long, 'a'.repeat(201)));
    unavailable(store.sessionModelHistory(long), 'invalid_evidence');

    const aggregate = 'session-aggregate';
    // Each record stays under the per-record budget; only the aggregate can reject them.
    const filler = 'y'.repeat(12000);
    for (let index = 0; index < 22; index += 1)
      store.ingest(
        modelEvent(
          `a${index}`,
          aggregate,
          `${filler}${index}`,
          new Date(Date.UTC(2026, 10, 2, 10, index)).toISOString(),
        ),
      );
    unavailable(store.sessionModelHistory(aggregate), 'evidence_limit');
  });
});

test('unknown carriers, corruption and schema1 stay unavailable', () => {
  const dir = mkdtempSync(join(tmpdir(), 'orqst-model-history-qa-schema-'));
  const path = join(dir, 'orqst.sqlite');
  const store = new Store(path);
  try {
    const unknown = 'session-unknown-carrier';
    store.ingest(
      event({
        id: 'u1',
        sessionId: unknown,
        payload: { model: 'synthetic-alpha' },
        source: {
          file: 'synthetic/model-history.jsonl',
          offset: 1,
          line: 1,
          hash,
          recordType: 'response_item:message',
        },
      }),
    );
    unavailable(store.sessionModelHistory(unknown), 'invalid_evidence');

    const missing = 'session-no-evidence';
    store.ingest(
      event({
        id: 'm1',
        sessionId: missing,
        type: 'agent.message',
        payload: { role: 'assistant', text: 'x' },
      }),
    );
    unavailable(store.sessionModelHistory(missing), 'evidence_missing');
    unavailable(store.sessionModelHistory('session-never-observed'), 'session_not_found');

    const claude = 'session-claude';
    store.ingest(
      event({
        id: 'c1',
        sessionId: claude,
        adapter: 'claude',
        agentId: 'claude-agent',
        payload: { model: 'x' },
      }),
    );
    unavailable(store.sessionModelHistory(claude), 'unsupported_adapter');

    const corrupt = 'session-corrupt';
    store.ingest(modelEvent('k1', corrupt, 'synthetic-alpha'));
    const side = new DatabaseSync(path);
    try {
      side.exec('PRAGMA busy_timeout=5000');
      side.prepare('UPDATE analytics_evidence SET metadata=? WHERE id=?').run('{', 'k1');
    } finally {
      side.close();
    }
    unavailable(store.sessionModelHistory(corrupt), 'invalid_evidence');

    // Schema 1 has no compact evidence and must not be migrated on read.
    const side2 = new DatabaseSync(path);
    try {
      side2.exec('PRAGMA busy_timeout=5000');
      side2.exec('DROP TABLE analytics_evidence');
      side2.exec('PRAGMA user_version=1');
    } finally {
      side2.close();
    }
    unavailable(store.sessionModelHistory('session-history'), 'unsupported_schema');
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a concurrent external writer cannot mix session identity with newer evidence', () => {
  const dir = mkdtempSync(join(tmpdir(), 'orqst-model-history-qa-concurrent-'));
  const path = join(dir, 'orqst.sqlite');
  const store = new Store(path);
  let reader: DatabaseSync | undefined;
  let writer: DatabaseSync | undefined;
  try {
    const sessionId = 'session-concurrent';
    store.ingest(modelEvent('q1', sessionId, 'synthetic-alpha', T1));
    reader = new DatabaseSync(path);
    writer = new DatabaseSync(path);
    writer.exec('PRAGMA busy_timeout=5000');
    let fired = false;
    const database = {
      get isTransaction() {
        return reader!.isTransaction;
      },
      exec(sql: string) {
        return reader!.exec(sql);
      },
      prepare(sql: string) {
        const statement = reader!.prepare(sql);
        return {
          get(...params: SQLInputValue[]) {
            const row = statement.get(...params);
            if (!fired && sql.includes('FROM sessions s')) {
              fired = true;
              // Replace the compact row after the canonical session read.
              writer!.prepare('DELETE FROM analytics_evidence WHERE id=?').run('q1');
              writer!
                .prepare(
                  `INSERT INTO analytics_evidence(sequence,id,session_id,timestamp,metadata)
                   SELECT COALESCE(MAX(sequence),0)+1,?,?,?,json_object(
                     'id','q2','timestamp',?,'machineId','synthetic-machine','agentId','synthetic-agent',
                     'adapter','codex','sessionId',?,'workspaceId','synthetic-workspace',
                     'source',json_object('file','synthetic/model-history.jsonl','offset',1,'line',1,
                       'hash',?,'recordType','turn_context'),
                     'correlation',json_object('turnId',null),
                     'payload',json_object('model','synthetic-beta','usage',NULL,'usageKind',NULL,'responseId',NULL))
                   FROM analytics_evidence`,
                )
                .run('q2', sessionId, T2, T2, sessionId, hash);
            }
            return row;
          },
          all(...params: SQLInputValue[]) {
            return statement.all(...params);
          },
        };
      },
    } as unknown as DatabaseSync;
    const value = available(readSessionModelHistory(database, sessionId));
    assert.deepEqual(
      value.entries.map((entry) => entry.model),
      ['synthetic-alpha'],
    );
    // A fresh read sees the committed replacement.
    assert.deepEqual(
      available(store.sessionModelHistory(sessionId)).entries.map((entry) => entry.model),
      ['synthetic-beta'],
    );
  } finally {
    writer?.close();
    reader?.close();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('response never exposes paths, identities or token usage', () => {
  withStore((store) => {
    const sessionId = 'session-privacy';
    store.ingest(modelEvent('p1', sessionId, 'synthetic-alpha'));
    store.ingest(usageEvent('p2', sessionId));
    const value = available(store.sessionModelHistory(sessionId));
    const text = JSON.stringify(value);
    for (const secret of [
      'synthetic/model-history.jsonl',
      '/synthetic/model-history',
      'synthetic-workspace',
      'synthetic-machine',
      'synthetic-agent',
      'synthetic-turn',
      '987654321',
      '1111111110',
    ])
      assert.equal(text.includes(secret), false, secret);
    assert.equal(text.includes(hash), true);
    assert.equal(
      sessionModelHistoryResultSchema.safeParse({ availability: 'available', value }).success,
      true,
    );
  });
});

test('hostile identifiers are returned as data and stay inert for rendering', () => {
  withStore((store) => {
    const sessionId = 'session-hostile';
    const hostile = '<img src=x onerror="window.x=1">[l](javascript:alert) \u202e';
    store.ingest(modelEvent('x1', sessionId, hostile));
    const value = available(store.sessionModelHistory(sessionId));
    assert.equal(value.entries[0]!.model, hostile);
    assert.equal(typeof value.entries[0]!.model, 'string');
  });
});

test('HTTP model history is authenticated, queryless and hardened', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'orqst-model-history-qa-http-'));
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
    store.ingest(modelEvent('http1', 'http-session', 'synthetic-alpha'));
    const origin = `http://127.0.0.1:${await server.listen()}`;
    const cookie = (await fetch(origin + '/api/bootstrap')).headers
      .get('set-cookie')!
      .split(';')[0]!;

    const response = await fetch(`${origin}/api/sessions/http-session/model-history`, {
      headers: { Cookie: cookie },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.match(response.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/);
    const value = available(sessionModelHistoryResultSchema.parse(await response.json()));
    assert.equal(value.entries[0]!.model, 'synthetic-alpha');

    for (const query of ['?after=1', '?a=1&a=2'])
      assert.equal(
        (
          await fetch(`${origin}/api/sessions/http-session/model-history${query}`, {
            headers: { Cookie: cookie },
          })
        ).status,
        400,
        query,
      );
    assert.equal((await fetch(`${origin}/api/sessions/http-session/model-history`)).status, 401);
    assert.equal(
      (
        await fetch(`${origin}/api/sessions/http-session/model-history`, {
          headers: { Cookie: cookie, Origin: 'http://evil.invalid' },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(`${origin}/api/sessions/http-session/model-history`, {
          method: 'POST',
          headers: { Cookie: cookie, 'Content-Type': 'application/json' },
          body: '{}',
        })
      ).status,
      404,
    );
    const missing = await fetch(`${origin}/api/sessions/http-unknown/model-history`, {
      headers: { Cookie: cookie },
    });
    assert.equal(missing.status, 200);
    unavailable(sessionModelHistoryResultSchema.parse(await missing.json()), 'session_not_found');
  } finally {
    await server.close();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
