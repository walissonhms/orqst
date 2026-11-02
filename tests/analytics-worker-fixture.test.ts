// Synthetic only: proves the file-backed precondition for an Analytics worker.
// This file deliberately does not import or alter analytics-api.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { AgentEvent } from '@orqst/protocol';
import { createAnalyticsWorkerFixture } from './helpers/analytics-worker-fixture.js';

const event: AgentEvent = {
  schemaVersion: 1,
  id: 'synthetic-worker-fixture-event',
  type: 'agent.tokens.updated',
  timestamp: '2026-11-02T12:00:00.000Z',
  adapter: 'codex',
  machineId: 'synthetic-worker-machine',
  workspaceId: 'synthetic-worker-workspace',
  sessionId: 'synthetic-worker-session',
  agentId: 'synthetic-worker-agent',
  correlation: { turnId: 'synthetic-worker-turn' },
  source: {
    file: 'synthetic-worker.jsonl',
    offset: 0,
    line: 1,
    hash: 'synthetic-worker-hash',
    recordType: 'token_usage_record',
  },
  payload: {
    model: 'synthetic-worker-model',
    usage: { input: 0, output: 0, cached: 0, total: 0 },
    usageKind: 'session_cumulative',
    responseId: 'synthetic-worker-baseline',
  },
};

const next: AgentEvent = {
  ...event,
  id: 'synthetic-worker-fixture-event-2',
  timestamp: '2026-11-02T12:01:00.000Z',
  payload: {
    ...event.payload,
    usage: { input: 10, output: 2, cached: 5, total: 12 },
    responseId: 'synthetic-worker-response',
  },
};

test('file-backed Analytics fixture exposes committed WAL data to a read-only connection', () => {
  const fixture = createAnalyticsWorkerFixture();
  try {
    fixture.store.ingest(event);
    fixture.store.ingest(next);

    const reader = new DatabaseSync(fixture.database, { readOnly: true });
    try {
      const journal = reader.prepare('PRAGMA journal_mode').get() as { journal_mode: string };
      const count = reader.prepare('SELECT COUNT(*) AS count FROM events').get() as {
        count: number;
      };
      assert.equal(String(journal.journal_mode).toLowerCase(), 'wal');
      assert.equal(Number(count.count), 2);
    } finally {
      reader.close();
    }

    // The synchronous library contract remains the comparison baseline for the
    // future worker response.
    const report = fixture.store.modelAnalyticsSummary();
    assert.equal(report.sessions, 1);
    assert.equal(report.usage?.total, 12);
    assert.equal(
      report.models.find((row) => row.model === 'synthetic-worker-model')?.usage?.total,
      12,
    );
  } finally {
    fixture.close();
  }
  assert.equal(existsSync(fixture.directory), false);
});
