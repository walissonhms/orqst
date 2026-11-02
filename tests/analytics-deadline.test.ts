// Deterministic lifecycle tests: no SQLite, native sessions or worker scheduling required.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import type { ModelAnalyticsSummary } from '@orqst/protocol';
import {
  AnalyticsQueries,
  AnalyticsQueryError,
  type AnalyticsWorker,
} from '../apps/bridge/src/analytics.js';

class DelayedWorker extends EventEmitter implements AnalyticsWorker {
  calls = 0;
  private release!: (code: number) => void;
  private termination = new Promise<number>((resolve) => {
    this.release = resolve;
  });
  terminate(): Promise<number> {
    this.calls++;
    return this.termination;
  }
  finish(): void {
    this.release(0);
  }
}
const code = (expected: string) => (error: unknown) =>
  error instanceof AnalyticsQueryError && error.code === expected;
// The service only transports the worker's summary; attribution has separate real-worker tests.
const report = { contract: 'orqst.model-analytics' } as ModelAnalyticsSummary;

test(
  'a result before deadline times out while cleanup is delayed and keeps the slot',
  { timeout: 1000 },
  async () => {
    const worker = new DelayedWorker();
    const queries = new AnalyticsQueries('/synthetic-unused', {
      timeoutMs: 20,
      workerFactory: () => worker,
    });
    try {
      const pending = queries.query({});
      worker.emit('message', { report });
      assert.equal(worker.calls, 1);
      // Termination is deliberately never resolved until AFTER the timeout response.
      await assert.rejects(pending, code('analytics_timeout'));
      await assert.rejects(queries.query({}), code('analytics_busy'));
      let closed = false;
      const closing = queries.close().then(() => {
        closed = true;
      });
      await Promise.resolve();
      assert.equal(closed, false);
      assert.equal(worker.calls, 1);
      worker.finish();
      await closing;
      assert.equal(closed, true);
    } finally {
      worker.finish();
      await queries.close();
    }
  },
);

test('a result resolves only after confirmed cleanup within the deadline', async () => {
  const worker = new DelayedWorker();
  const queries = new AnalyticsQueries('/synthetic-unused', { workerFactory: () => worker });
  try {
    let settled = false;
    const pending = queries.query({}).then((value) => {
      settled = true;
      return value;
    });
    worker.emit('message', { report });
    await Promise.resolve();
    assert.equal(settled, false);
    await assert.rejects(queries.query({}), code('analytics_busy'));
    worker.finish();
    assert.deepEqual(await pending, report);
  } finally {
    worker.finish();
    await queries.close();
  }
});

test('shutdown cancels a pending success but awaits delayed cleanup independently', async () => {
  const worker = new DelayedWorker();
  const queries = new AnalyticsQueries('/synthetic-unused', { workerFactory: () => worker });
  const pending = queries.query({});
  worker.emit('message', { report });
  let closed = false;
  const closing = queries.close().then(() => {
    closed = true;
  });
  await assert.rejects(pending, code('analytics_cancelled'));
  assert.equal(closed, false);
  await assert.rejects(queries.query({}), code('analytics_cancelled'));
  worker.finish();
  await closing;
  assert.equal(closed, true);
});
