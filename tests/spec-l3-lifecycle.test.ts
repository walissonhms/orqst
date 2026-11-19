import assert from 'node:assert/strict';
import test from 'node:test';
import {
  projectBatchOutcome,
  projectPaneLifecycle,
  reconcileEndedTerminals,
  savedTerminalDisposition,
  type TerminalOpenCard,
} from '../apps/dashboard/src/terminal-lifecycle.js';
import { loadTerminalCatalog } from '../apps/dashboard/src/terminal-catalog-cache.js';
import type { TauriStudio, TauriStudioSnapshot } from '@orqst/protocol';

test('projects owned PTY and turn facts independently', () => {
  const live = { transport: 'connected', process: 'live', firstFrame: true } as const;
  assert.equal(projectPaneLifecycle({ ...live, firstFrame: false }).state, 'starting');
  assert.equal(projectPaneLifecycle(live).state, 'unknown');
  assert.equal(projectPaneLifecycle({ ...live, prompt: true }).state, 'ready');
  assert.equal(
    projectPaneLifecycle({ ...live, turn: 'waiting_for_user' }).state,
    'waiting_for_user',
  );
  assert.equal(projectPaneLifecycle({ ...live, turn: 'running' }).state, 'running');
  assert.deepEqual(projectPaneLifecycle({ ...live, turn: 'failed' }), { state: 'failed' });
  assert.equal(projectPaneLifecycle({ ...live, transport: 'lost' }).state, 'disconnected');
  assert.equal(projectPaneLifecycle({ ...live, process: 'exited', exitCode: 0 }).state, 'ended');
  assert.deepEqual(projectPaneLifecycle({ ...live, process: 'exited', exitCode: 23 }), {
    state: 'failed',
    failure: { reason: 'process_crashed', evidence: 'exit', retryable: true, exitCode: 23 },
  });
});

test('an enrollment ACK is not a PTY frame and uncertainty remains fenced on the same card', () => {
  const card: TerminalOpenCard = {
    id: 'synthetic',
    workspaceId: 'workspace',
    featureId: null,
    targetFeatureId: 'general',
    name: 'Test terminal',
    provider: 'codex',
    state: 'starting',
  };
  assert.deepEqual(
    projectBatchOutcome(card, {
      id: card.id,
      terminalId: 'terminal',
      slot: 0,
      status: 'accepted',
      reason: 'core_enrolled',
      effects: 'possible',
    }),
    { ...card, terminalId: 'terminal' },
  );
  const lost = projectBatchOutcome(card, undefined);
  assert.equal(lost.id, card.id);
  assert.equal(lost.state, 'failed');
  assert.equal(lost.failure?.retryable, false);
  const stale = projectBatchOutcome(card, {
    id: card.id,
    status: 'refused',
    reason: 'catalog_changed',
    effects: 'not_started',
  });
  assert.equal(stale.failure?.reason, 'catalog_changed');
  assert.equal(stale.failure?.retryable, true);
});

test('saved missing ownership stays uncertain and a connected terminal stays out of history', () => {
  assert.deepEqual(
    reconcileEndedTerminals(
      [
        { terminalId: 'historical', disposition: 'uncertain' },
        { terminalId: 'retained', disposition: 'uncertain' },
      ],
      new Set(['retained']),
    ),
    [{ terminalId: 'historical', disposition: 'uncertain' }],
  );
});

test('a cached scope coalesces reads for 10 minutes, then refreshes', async (t) => {
  let now = 1_000;
  let calls = 0;
  t.mock.method(Date, 'now', () => now);
  const scope = { workspaceId: 'workspace', featureId: null };
  const snapshot: TauriStudioSnapshot = {
    generation: 1,
    limit: 8,
    count: 0,
    canCreate: true,
    canReview: false,
    busy: false,
    selectionLocked: false,
    liveEnrollment: false,
  };
  const native: TauriStudio = {
    contractVersion: 1,
    async request() {
      calls++;
      return {
        status: 'catalog',
        snapshot,
        catalog: { contractVersion: 1, ...scope, catalogId: 'a'.repeat(64), providers: [] },
      };
    },
  };

  await Promise.all([loadTerminalCatalog(native, scope), loadTerminalCatalog(native, scope, true)]);
  assert.equal(calls, 1);
  now += 599_999;
  await loadTerminalCatalog(native, scope);
  assert.equal(calls, 1);
  now++;
  await loadTerminalCatalog(native, scope);
  assert.equal(calls, 2);
  await loadTerminalCatalog(native, scope, true);
  assert.equal(calls, 3);
});

test('Quit and relaunch distinguish durable release, missing ownership and a connected process', () => {
  const released = {
    terminalId: 'retired',
    disposition: savedTerminalDisposition(false, true),
    released: true,
  };
  const orphan = { terminalId: 'orphan', disposition: savedTerminalDisposition(false, false) };
  assert.equal(released.disposition, 'released');
  assert.equal(orphan.disposition, 'uncertain');
  assert.equal(savedTerminalDisposition(true, true), 'exit_confirmed');
  const live = { terminalId: 'connected', disposition: 'uncertain' } as const;
  assert.deepEqual(reconcileEndedTerminals([released, orphan, live], new Set([live.terminalId])), [
    released,
    orphan,
  ]);
});
