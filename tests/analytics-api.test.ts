// Synthetic backend fixtures only; no native history or running service is accessed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { request } from 'node:http';
import {
  AnalyticsCapacityError,
  MODEL_ANALYTICS_LIMITS,
  ANALYTICS_READ_LIMITS,
  Store,
} from '@orqst/database';
import type { AgentEvent, ModelAnalyticsQuery, ModelAnalyticsSummary } from '@orqst/protocol';
import { createLocalServer } from '../apps/bridge/src/server.js';

const time = (minute: number) => new Date(Date.UTC(2026, 10, 2, 12, minute)).toISOString();
function event(id: string, minute = 0, payload: AgentEvent['payload'] = {}): AgentEvent {
  return {
    schemaVersion: 1,
    id,
    type: 'session.updated',
    timestamp: time(minute),
    adapter: 'codex',
    machineId: 'synthetic-machine',
    workspaceId: 'synthetic-workspace',
    sessionId: 'SYNTHETIC_PRIVATE_SESSION',
    agentId: 'synthetic-agent',
    correlation: { turnId: 'SYNTHETIC_PRIVATE_TURN' },
    source: {
      file: '/SYNTHETIC_PRIVATE_PATH/history.jsonl',
      offset: 0,
      line: 1,
      hash: 'SYNTHETIC_PRIVATE_HASH',
      recordType: 'token_usage_record',
    },
    payload,
  };
}
function seed(store: Store) {
  for (const [minute, total] of [0, 10, 20, 30].entries())
    store.ingest(
      event(`SYNTHETIC_PRIVATE_EVENT-${minute}`, minute, {
        model: 'synthetic-model',
        usage: { input: total, output: 0, cached: total / 2, total },
        usageKind: 'session_cumulative',
        responseId: 'SYNTHETIC_PRIVATE_RESPONSE',
        text: 'SYNTHETIC_PRIVATE_PROMPT',
        result: 'SYNTHETIC_PRIVATE_RESULT',
        cwd: '/SYNTHETIC_PRIVATE_CWD',
      }),
    );
  store.ingest({
    ...event('SYNTHETIC_PRIVATE_UNKNOWN', 2, { text: 'SYNTHETIC_PRIVATE_MESSAGE' }),
    sessionId: 'SYNTHETIC_PRIVATE_UNKNOWN_SESSION',
    workspaceId: 'synthetic-other-workspace',
    agentId: 'synthetic-other-agent',
    adapter: 'manual',
  });
}
async function setup(existingStore?: Store) {
  const directory = existingStore ? null : mkdtempSync(join(tmpdir(), 'orqst-analytics-http-'));
  const store = existingStore ?? new Store(join(directory!, 'synthetic.db'));
  const app = createLocalServer(
    store,
    {
      port: 0,
      dataDir: '/synthetic-unused',
      sessionsDir: '/synthetic-unused',
      dashboardDir: '/synthetic-unused',
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
  const base = `http://127.0.0.1:${await app.listen()}`;
  const bootstrap = await fetch(base + '/api/bootstrap');
  const cookie = bootstrap.headers.get('set-cookie')!.split(';')[0]!;
  return {
    store,
    base,
    cookie,
    get: (query = '', headers: Record<string, string> = {}) =>
      fetch(base + '/api/analytics/models' + query, { headers: { Cookie: cookie, ...headers } }),
    close: async () => {
      await app.close();
      store.close();
      if (directory) rmSync(directory, { recursive: true, force: true });
    },
  };
}
async function summary(response: Response): Promise<ModelAnalyticsSummary> {
  assert.equal(response.status, 200);
  return (await response.json()) as ModelAnalyticsSummary;
}

test('Analytics HTTP inherits authentication, Host/Origin/fetch controls and security headers', async () => {
  const ctx = await setup();
  try {
    for (const cookie of ['', 'orqst_session=wrong', 'orqst_session=' + 'é'.repeat(64)]) {
      const response = await ctx.get('', { Cookie: cookie });
      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), { error: 'unauthorized' });
    }
    const rejectedHeaders: Array<Record<string, string>> = [
      { Origin: 'https://untrusted.invalid' },
      { 'Sec-Fetch-Site': 'cross-site' },
      { Origin: 'null' },
    ];
    for (const headers of rejectedHeaders) {
      const response = await ctx.get('', headers);
      assert.equal(response.status, 403, JSON.stringify(headers));
      assert.deepEqual(await response.json(), { error: 'forbidden_origin' });
    }
    // Node fetch replaces Host with the URL host; use the native client for this control.
    const hostStatus = await new Promise<number | undefined>((resolve, reject) => {
      const req = request(
        ctx.base + '/api/analytics/models',
        {
          headers: { Host: 'untrusted.invalid', Cookie: ctx.cookie },
        },
        (response) => {
          response.resume();
          response.on('end', () => resolve(response.statusCode));
        },
      );
      req.on('error', reject);
      req.end();
    });
    assert.equal(hostStatus, 403);
    const response = await ctx.get('', { Origin: ctx.base, 'Sec-Fetch-Site': 'same-origin' });
    const report = await summary(response);
    assert.equal(report.usage, null);
    assert.equal(report.sessions, 0);
    assert.deepEqual(report.models, []);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('x-frame-options'), 'DENY');
    assert.ok(response.headers.get('content-security-policy')?.includes("script-src 'self'"));
    assert.equal(response.headers.get('access-control-allow-origin'), null);
    assert.equal(
      (
        await fetch(ctx.base + '/api/analytics/models', {
          method: 'POST',
          headers: { Cookie: ctx.cookie },
        })
      ).status,
      404,
    );
  } finally {
    await ctx.close();
  }
});

test('Analytics HTTP returns only aggregates, preserves legacy semantics and scopes coverage before model', async () => {
  const ctx = await setup();
  try {
    seed(ctx.store);
    const before = ctx.store.totals();
    const report = await summary(await ctx.get());
    assert.deepEqual(report.usage, before);
    assert.equal(report.sessions, 2);
    assert.equal(report.models.find((row) => row.model === 'synthetic-model')?.usage?.total, 30);
    assert.equal(report.models.find((row) => row.adapter === 'manual')?.usage, null);
    assert.ok(report.models.every((row) => row.provider === null));
    assert.deepEqual(report.coverage.gaps, [{ reason: 'usage_not_reported', count: 1 }]);
    assert.equal(report.coverage.complete, false);
    assert.equal(report.unavailable.cost, 'verified_prices_and_billing_not_recorded');
    assert.equal(report.unavailable.successRate, 'task_outcomes_not_recorded');
    assert.equal(report.unavailable.executions, 'not_recorded');
    assert.equal(report.unavailable.duration, 'not_measured');
    assert.equal(JSON.stringify(report).includes('SYNTHETIC_PRIVATE'), false);
    assert.deepEqual(Object.keys(report).sort(), [
      'basis',
      'contract',
      'contractVersion',
      'coverage',
      'models',
      'query',
      'sessions',
      'unavailable',
      'usage',
    ]);
    for (const row of report.models)
      assert.deepEqual(Object.keys(row).sort(), [
        'adapter',
        'model',
        'provider',
        'sessions',
        'usage',
      ]);
    for (const query of [
      {},
      { model: null },
      { model: 'synthetic-model' },
      { from: time(1), to: time(3) },
      { workspaceId: 'synthetic-other-workspace' },
    ] satisfies ModelAnalyticsQuery[]) {
      const legacy = ctx.store.modelAnalytics(query);
      const aggregate = ctx.store.modelAnalyticsSummary(query);
      assert.deepEqual(aggregate.query, legacy.query);
      assert.deepEqual(aggregate.basis, legacy.basis);
      assert.deepEqual(aggregate.usage, legacy.usage);
      assert.deepEqual(aggregate.unavailable, legacy.unavailable);
      assert.equal(aggregate.sessions, legacy.sessions);
      assert.equal(aggregate.coverage.sessions, legacy.coverage.sessions);
      assert.equal(
        aggregate.coverage.unidentifiedContributions,
        legacy.coverage.unidentifiedContributions,
      );
      assert.equal(
        aggregate.coverage.gaps.reduce((sum, gap) => sum + gap.count, 0),
        legacy.coverage.gaps.length,
      );
    }
    const filtered = await summary(await ctx.get('?model=synthetic-model'));
    assert.equal(filtered.sessions, 1);
    assert.equal(filtered.coverage.sessions, 2);
    assert.deepEqual(filtered.coverage.gaps, report.coverage.gaps);
    assert.deepEqual(ctx.store.totals(), before);
    assert.equal(
      ctx.store.modelAnalytics().models.some((row) => row.contributions.length),
      true,
    );
    const snapshot = await fetch(ctx.base + '/api/snapshot', { headers: { Cookie: ctx.cookie } });
    assert.equal(snapshot.status, 200);
    assert.ok('events' in ((await snapshot.json()) as object));
  } finally {
    await ctx.close();
  }
});

test('Analytics HTTP accepts explicit half-open instants and exact scope/model/unidentified filters', async () => {
  const ctx = await setup();
  try {
    seed(ctx.store);
    const period = new URLSearchParams({ from: '2026-11-02T09:01:00-03:00', to: time(3) });
    const report = await summary(await ctx.get('?' + period));
    assert.equal(report.usage?.total, 10);
    assert.ok(report.coverage.gaps.some((gap) => gap.reason === 'window_boundary'));
    assert.equal(
      (await summary(await ctx.get('?to=' + encodeURIComponent(time(1))))).usage?.total,
      0,
    );
    assert.equal(
      (await summary(await ctx.get('?from=' + encodeURIComponent(time(4))))).usage,
      null,
    );
    for (const filter of [
      'workspaceId=synthetic-workspace',
      'agentId=synthetic-agent',
      'adapter=codex',
      'model=synthetic-model',
      'workspaceId=synthetic-workspace&agentId=synthetic-agent&adapter=codex&model=synthetic-model',
    ])
      assert.equal((await summary(await ctx.get('?' + filter))).usage?.total, 30);
    const unknown = await summary(await ctx.get('?unidentified=true'));
    assert.deepEqual(unknown.query, { model: null });
    assert.ok(unknown.models.every((row) => row.model === null));
    assert.equal(unknown.usage?.total, 0);
    for (const filter of [
      'workspaceId=missing',
      'agentId=missing',
      'model=missing',
      'adapter=claude',
      'workspaceId=' + encodeURIComponent("' OR 1=1 --"),
    ]) {
      const empty = await summary(await ctx.get('?' + filter));
      assert.equal(empty.usage, null);
      assert.equal(empty.sessions, 0);
    }
    const reassigned = ctx.store.workspace('/synthetic-new', 'Synthetic new workspace');
    assert.ok(ctx.store.associate('SYNTHETIC_PRIVATE_SESSION', reassigned));
    assert.equal((await summary(await ctx.get('?workspaceId=synthetic-workspace'))).usage, null);
    assert.equal((await summary(await ctx.get('?workspaceId=' + reassigned))).usage?.total, 30);
  } finally {
    await ctx.close();
  }
});

test('Analytics HTTP rejects duplicates, unknowns, invalid combinations and excessive values', async () => {
  const ctx = await setup();
  try {
    for (const query of [
      'model=a&model=a',
      'from=' + time(0) + '&from=' + time(1),
      'workspaceId=x&workspaceId=y',
      'agentId=x&agentId=x',
      'adapter=codex&adapter=codex',
      'to=x&to=y',
      'unidentified=true&unidentified=true',
      'provider=codex',
      'sessionId=private',
      'limit=1',
      'unknown=',
      'unidentified=false',
      'unidentified=1',
      'unidentified=',
      'unidentified=true&model=a',
      'from=2026-11-02',
      'to=2026-11-02T00:00:00',
      'from=invalid',
      'from=' + time(2) + '&to=' + time(1),
      'from=' + time(1) + '&to=' + time(1),
      'from=',
      'workspaceId=',
      'agentId=',
      'model=',
      'model=%20%20',
      'adapter=unknown',
      'model=' + 'x'.repeat(201),
      'workspaceId=' + 'x'.repeat(201),
      'agentId=' + 'x'.repeat(201),
      'from=' + 'x'.repeat(65),
      'to=' + 'x'.repeat(65),
      'model=' + '%41'.repeat(700),
    ]) {
      const response = await ctx.get('?' + query);
      assert.equal(response.status, 400, query);
      assert.deepEqual(await response.json(), { error: 'invalid_query' });
    }
    assert.equal((await ctx.get('?model=' + 'x'.repeat(200))).status, 200);
  } finally {
    await ctx.close();
  }
});

test('Analytics HTTP supports sessions above the legacy synchronous budget', async () => {
  const ctx = await setup();
  try {
    for (let index = 0; index < MODEL_ANALYTICS_LIMITS.sessions; index++)
      ctx.store.ingest({ ...event(`session-${index}`), sessionId: `synthetic-session-${index}` });
    assert.equal((await summary(await ctx.get())).sessions, MODEL_ANALYTICS_LIMITS.sessions);
    ctx.store.ingest({ ...event('excess-session'), sessionId: 'synthetic-excess-session' });
    assert.throws(() => ctx.store.modelAnalyticsSummary(), AnalyticsCapacityError);
    const response = await ctx.get();
    assert.equal(response.status, 200);
    assert.equal((await response.json()).sessions, MODEL_ANALYTICS_LIMITS.sessions + 1);
    assert.equal(ctx.store.modelAnalytics().sessions, MODEL_ANALYTICS_LIMITS.sessions + 1);
    assert.equal((await summary(await ctx.get('?workspaceId=missing'))).sessions, 0);
  } finally {
    await ctx.close();
  }
});

test('Analytics HTTP supports events above the legacy synchronous budget', async () => {
  const ctx = await setup();
  try {
    for (let index = 0; index < MODEL_ANALYTICS_LIMITS.events; index++)
      ctx.store.ingest({
        ...event(`record-${index}`, 0, { text: 'Synthetic message without model or usage' }),
        sessionId: `synthetic-session-${index % 2}`,
      });
    assert.equal((await ctx.get()).status, 200);
    for (const index of [0, 1]) {
      ctx.store.ingest({
        ...event(`in-period-${index}`, 2, { model: 'synthetic-model' }),
        sessionId: `synthetic-session-${index}`,
      });
      assert.equal((await ctx.get()).status, 200);
    }
    for (const query of ['', '?model=missing', '?from=' + encodeURIComponent(time(1))]) {
      const response = await ctx.get(query);
      assert.equal(response.status, 200);
    }
    assert.equal((await ctx.get('?workspaceId=missing')).status, 200);
    assert.equal(ctx.store.modelAnalytics().coverage.sessions, 2);
  } finally {
    await ctx.close();
  }
});

test('Analytics byte budgets admit larger messages and reject oversized records before JSON parsing', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'orqst-analytics-capacity-synthetic-'));
  const file = join(directory, 'synthetic.db');
  const store = new Store(file);
  const ctx = await setup(store);
  const db = new DatabaseSync(file);
  try {
    const input = event('byte-boundary', 0, { model: 'synthetic-model', text: '' });
    // The event schema removes no fields in this fixture; padding is measured in bytes.
    const padding = MODEL_ANALYTICS_LIMITS.evidenceBytes - Buffer.byteLength(JSON.stringify(input));
    input.payload.text = 'é'.repeat(Math.floor(padding / 2)) + 'x'.repeat(padding % 2);
    store.ingest(input);
    assert.equal(
      db.prepare('SELECT length(CAST(envelope AS BLOB)) AS bytes FROM events').get()?.bytes,
      MODEL_ANALYTICS_LIMITS.evidenceBytes,
    );
    assert.equal((await ctx.get()).status, 200);
    store.ingest({ ...event('additional-session'), sessionId: 'synthetic-second-session' });
    assert.equal((await ctx.get()).status, 200);
    // Deliberately invalid oversized JSON proves admission precedes SQLite json_type
    // and JSON.parse; otherwise this would be a parsing error rather than capacity.
    db.prepare('UPDATE events SET envelope=?').run(
      '!'.repeat(ANALYTICS_READ_LIMITS.recordBytes + 1),
    );
    assert.throws(() => store.modelAnalyticsSummary(), AnalyticsCapacityError);
    const response = await ctx.get();
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'analytics_capacity_exceeded' });
    assert.equal(db.prepare('PRAGMA user_version').get()?.user_version, 1);
  } finally {
    db.close();
    await ctx.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
