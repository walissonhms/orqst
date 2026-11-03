// Synthetic compact evidence only. No local cache, credentials or native session reads.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '@orqst/database';
import { sessionModelHistoryLimits as limits } from '@orqst/protocol';
import { readSessionModelHistory } from '../packages/database/src/model-history.js';
import { fetchSessionModelHistory } from '../apps/dashboard/src/model-history.js';
import { meta, normalized, record, token } from './fixtures.js';

function fixture(models: (string | null)[] = ['synthetic-model']) {
  const store = new Store(':memory:');
  store.ingest(normalized([meta()])[0]!);
  models.forEach((model, index) => {
    const events = normalized([
      meta(),
      model === null
        ? record('token_usage_record', { thread_token_usage: token(10, 1) }, index + 1)
        : record('turn_context', { model }, index + 1),
    ]);
    store.ingest(events[1]!);
  });
  return store;
}
function db(store: Store) {
  return (store as unknown as { db: DatabaseSync }).db;
}
function mutate(store: Store, change: (metadata: Record<string, unknown>) => void) {
  const row = db(store)
    .prepare('SELECT sequence,metadata FROM analytics_evidence ORDER BY sequence LIMIT 1')
    .get()!;
  const metadata = JSON.parse(String(row.metadata)) as Record<string, unknown>;
  change(metadata);
  db(store)
    .prepare('UPDATE analytics_evidence SET metadata=? WHERE sequence=?')
    .run(JSON.stringify(metadata), row.sequence!);
}

test('bounded history preserves repeated carried identifiers, null and ingestion order without paths', () => {
  const store = new Store(':memory:');
  try {
    const events = normalized([
      meta(),
      record('token_usage_record', { thread_token_usage: token(10, 1) }, 1),
      record('turn_context', { model: '<img src=x onerror=synthetic()>' }, 2),
      record('event_msg', { type: 'task_started' }, 3),
      record('token_usage_record', { thread_token_usage: token(20, 2) }, 4),
    ]);
    events.forEach((event) => store.ingest(event));
    const result = store.sessionModelHistory('synthetic-session');
    assert.equal(result.availability, 'available');
    if (result.availability !== 'available') return;
    assert.deepEqual(
      result.value.entries.map((entry) => entry.model),
      [
        '<img src=x onerror=synthetic()>',
        '<img src=x onerror=synthetic()>',
        '<img src=x onerror=synthetic()>',
        null,
      ],
    );
    assert.equal(result.value.coverage, 'partial');
    assert.equal(result.value.basis, 'normalized_event_carried_identifier');
    assert.equal(result.value.entries[0]!.normalizedEventAt, events[4]!.timestamp);
    assert.deepEqual(Object.keys(result.value.entries[0]!.source).sort(), ['hash', 'recordType']);
    for (const privateValue of [
      'synthetic.jsonl',
      '/synthetic/project',
      'synthetic-machine',
      'input_tokens',
    ])
      assert.equal(JSON.stringify(result).includes(privateValue), false);
    // Independent from retained envelopes and workspace reassociation.
    db(store).exec('DELETE FROM events');
    const workspace = store.workspace('/synthetic/reassociated', 'Synthetic');
    store.associate('synthetic-session', workspace);
    db(store).exec('PRAGMA query_only=ON');
    assert.deepEqual(store.sessionModelHistory('synthetic-session'), result);
  } finally {
    store.close();
  }
});

test('absence, null-only window, unsupported adapter and schema stay distinct', () => {
  const store = fixture([null]);
  try {
    const result = store.sessionModelHistory('synthetic-session');
    assert.equal(result.availability, 'available');
    if (result.availability === 'available') assert.equal(result.value.entries[0]!.model, null);
    assert.deepEqual(store.sessionModelHistory('missing'), {
      availability: 'unavailable',
      reason: 'session_not_found',
    });
    db(store).exec('DELETE FROM analytics_evidence');
    assert.deepEqual(store.sessionModelHistory('synthetic-session'), {
      availability: 'unavailable',
      reason: 'evidence_missing',
    });
    db(store).exec("UPDATE agents SET adapter='claude'");
    assert.deepEqual(store.sessionModelHistory('synthetic-session'), {
      availability: 'unavailable',
      reason: 'unsupported_adapter',
    });
  } finally {
    store.close();
  }
  const legacy = new DatabaseSync(':memory:');
  try {
    legacy.exec('PRAGMA user_version=1');
    assert.deepEqual(readSessionModelHistory(legacy, 'synthetic'), {
      availability: 'unavailable',
      reason: 'unsupported_schema',
    });
    assert.equal(legacy.prepare('PRAGMA user_version').get()!.user_version, 1);
    assert.equal(legacy.prepare('SELECT count(*) AS n FROM sqlite_schema').get()!.n, 0);
    legacy.exec('PRAGMA user_version=2');
    assert.deepEqual(readSessionModelHistory(legacy, 'synthetic'), {
      availability: 'unavailable',
      reason: 'unsupported_schema',
    });
  } finally {
    legacy.close();
  }
});

test('every row must match canonical identity before any entries are returned', () => {
  for (const key of ['machineId', 'agentId', 'sessionId', 'adapter']) {
    const store = fixture(['synthetic-old', 'synthetic-new']);
    try {
      mutate(store, (metadata) => {
        metadata[key] = key === 'adapter' ? 'claude' : 'synthetic-other';
      });
      const result = store.sessionModelHistory('synthetic-session');
      assert.equal(result.availability, 'unavailable', key);
      assert.equal('value' in result, false);
    } finally {
      store.close();
    }
  }
});

test('malformed JSON, schema, hashes, timestamps, unsafe numbers and extra payload fail closed', () => {
  const changes: ((m: Record<string, unknown>) => void)[] = [
    (m) => {
      m.timestamp = 'not-a-date';
    },
    (m) => {
      m.timestamp = '2026-11-02T14:00:00.000Z';
    },
    (m) => {
      (m.source as Record<string, unknown>).hash = 'bad';
    },
    (m) => {
      (m.source as Record<string, unknown>).offset = Number.MAX_SAFE_INTEGER + 1;
    },
    (m) => {
      (m.source as Record<string, unknown>).line = -1;
    },
    (m) => {
      (m.source as Record<string, unknown>).recordType = 'unknown-private-record';
    },
    (m) => {
      (m.payload as Record<string, unknown>).private = 'synthetic-private';
    },
    (m) => {
      (m.payload as Record<string, unknown>).model = 'x'.repeat(201);
    },
  ];
  for (const change of changes) {
    const store = fixture();
    try {
      mutate(store, change);
      assert.deepEqual(store.sessionModelHistory('synthetic-session'), {
        availability: 'unavailable',
        reason: 'invalid_evidence',
      });
    } finally {
      store.close();
    }
  }
  const store = fixture();
  try {
    db(store).exec("UPDATE analytics_evidence SET metadata='synthetic-private invalid JSON'");
    assert.deepEqual(store.sessionModelHistory('synthetic-session'), {
      availability: 'unavailable',
      reason: 'invalid_evidence',
    });
  } finally {
    store.close();
  }
});

test('window and byte admission are bounded before JSON materialization; responses never truncate', () => {
  const store = fixture(Array.from({ length: 40 }, (_, index) => `synthetic-${index}`));
  try {
    const result = store.sessionModelHistory('synthetic-session');
    assert.equal(result.availability, 'available');
    if (result.availability === 'available') {
      assert.equal(result.value.entries.length, limits.records);
      assert.equal(result.value.entries[0]!.model, 'synthetic-39');
      assert.equal(result.value.entries.at(-1)!.model, 'synthetic-8');
    }
    db(store)
      .prepare('UPDATE analytics_evidence SET metadata=?')
      .run('x'.repeat(limits.recordBytes + 1));
    assert.deepEqual(store.sessionModelHistory('synthetic-session'), {
      availability: 'unavailable',
      reason: 'evidence_limit',
    });
    db(store).prepare('UPDATE analytics_evidence SET metadata=?').run('x'.repeat(10000));
    assert.deepEqual(store.sessionModelHistory('synthetic-session'), {
      availability: 'unavailable',
      reason: 'evidence_limit',
    });
  } finally {
    store.close();
  }
  const largeResponse = fixture(Array.from({ length: 32 }, () => '界'.repeat(200)));
  try {
    assert.deepEqual(largeResponse.sessionModelHistory('synthetic-session'), {
      availability: 'unavailable',
      reason: 'evidence_limit',
    });
  } finally {
    largeResponse.close();
  }
});

test('client admits real HTTP bytes before JSON, validates identity/order and rejects extra fields', async () => {
  const original = globalThis.fetch;
  const store = fixture(['synthetic-first', 'synthetic-second']);
  const result = store.sessionModelHistory('synthetic-session');
  store.close();
  const response = (value: unknown) =>
    new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
  try {
    globalThis.fetch = async () => response(result);
    assert.deepEqual(
      await fetchSessionModelHistory('synthetic-session', new AbortController().signal),
      result,
    );
    await assert.rejects(fetchSessionModelHistory('other-session', new AbortController().signal));
    globalThis.fetch = async () => response({ ...result, private: 'synthetic' });
    await assert.rejects(
      fetchSessionModelHistory('synthetic-session', new AbortController().signal),
    );
    if (result.availability === 'available') {
      result.value.entries.reverse();
      globalThis.fetch = async () => response(result);
      await assert.rejects(
        fetchSessionModelHistory('synthetic-session', new AbortController().signal),
      );
    }
    // Deliberately dishonest Content-Length and malformed JSON: byte error must win.
    globalThis.fetch = async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array(limits.responseBytes));
            controller.enqueue(new Uint8Array(1));
            controller.close();
          },
        }),
        { headers: { 'content-type': 'application/json', 'content-length': '1' } },
      );
    await assert.rejects(
      fetchSessionModelHistory('synthetic-session', new AbortController().signal),
      /response limit/,
    );
    let cancelled = false;
    globalThis.fetch = async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          cancel() {
            cancelled = true;
          },
        }),
        {
          headers: { 'content-type': 'text/plain' },
        },
      );
    await assert.rejects(
      fetchSessionModelHistory('synthetic-session', new AbortController().signal),
      /Invalid model history response/,
    );
    assert.equal(cancelled, true);
  } finally {
    globalThis.fetch = original;
  }
});

test('local history route keeps cookie/origin protection and rejects source/query authority', async () => {
  const { createLocalServer } = await import('../apps/bridge/src/server.js');
  const store = fixture();
  const server = createLocalServer(
    store,
    {
      port: 0,
      dataDir: '/synthetic/unused',
      sessionsDir: '/synthetic/unused',
      dashboardDir: '/synthetic/unused',
      retentionDays: 30,
      pollMs: 500,
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
    const port = await server.listen();
    const base = `http://127.0.0.1:${port}`;
    const path = '/api/sessions/synthetic-session/model-history';
    assert.equal((await fetch(base + path)).status, 401);
    const bootstrap = await fetch(base + '/api/bootstrap');
    const cookie = bootstrap.headers.get('set-cookie')!.split(';')[0]!;
    const headers = { cookie };
    const response = await fetch(base + path, { headers });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const body: unknown = await response.json();
    assert.deepEqual(body, store.sessionModelHistory('synthetic-session'));
    assert.equal((await fetch(base + path + '?path=/synthetic/private', { headers })).status, 400);
    assert.equal(
      (await fetch(base + path, { headers: { ...headers, origin: 'https://untrusted.invalid' } }))
        .status,
      403,
    );
    assert.equal(
      (await fetch(base + path, { headers: { ...headers, 'sec-fetch-site': 'cross-site' } }))
        .status,
      403,
    );
    assert.equal((await fetch(base + path, { method: 'POST', headers })).status, 404);
  } finally {
    await server.close();
    store.close();
  }
});
