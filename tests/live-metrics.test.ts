// Synthetic normalization-to-query checks; no provider sessions or installed storage.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '@orqst/database';
import { meta, normalized, record } from './fixtures.js';

test('Codex normalized defaults remain qualified snapshots, including explicit input/output zero', () => {
  for (const input of [0, 100]) {
    const store = new Store(':memory:');
    try {
      const events = normalized([
        meta(),
        record('token_usage_record', {
          thread_token_usage: { input_tokens: input, output_tokens: 0 },
        }),
      ]);
      events.forEach((event) => store.ingest(event));
      const result = store.sessionMetrics('synthetic-session');
      assert.equal(result.availability, 'available');
      if (result.availability !== 'available') return;
      assert.deepEqual(result.value.usage, { input, output: 0, cached: 0, total: input });
      assert.equal(result.value.normalization, 'codex_session_snapshot');
      assert.equal(result.value.fieldPresence, 'not_preserved');
      assert.equal(result.value.evidence.kind, 'compact_evidence');
      assert.equal(result.value.evidence.eventId, events[1]?.id);
      assert.equal('type' in result.value.evidence, false);
    } finally {
      store.close();
    }
  }
});

test('normalization cannot supply missing input/output as confirmed zeros', () => {
  const store = new Store(':memory:');
  try {
    normalized([
      meta(),
      record('token_usage_record', { thread_token_usage: { total_tokens: 0 } }),
    ]).forEach((event) => store.ingest(event));
    assert.deepEqual(store.sessionMetrics('synthetic-session'), {
      availability: 'unavailable',
      reason: 'usage_not_recorded',
    });
  } finally {
    store.close();
  }
});
