import assert from 'node:assert/strict';
import test from 'node:test';
import {
  openFeatureTerminalIds,
  unassignedTerminalCount,
} from '../apps/dashboard/src/feature-counts.js';
import type { OwnedPaneEvidence } from '../apps/dashboard/src/terminal-lifecycle.js';
import type { FeatureCanvasEvidence, FeatureNativeSnapshot } from '@orqst/protocol';

function snapshot(
  slots: Array<{ slot: number; terminalId: string }>,
  features: Array<{ terminalIds: string[] }>,
) {
  return {
    slots: slots.map((slot, index) => ({ ...slot, slot: index, provider: 'codex' })),
    features,
  } as unknown as FeatureNativeSnapshot;
}

test('only real terminal identities are counted as unassigned', () => {
  assert.equal(
    unassignedTerminalCount(
      snapshot(
        [
          { slot: 0, terminalId: 'a' },
          { slot: 1, terminalId: 'b' },
        ],
        [{ terminalIds: ['a'] }],
      ),
    ),
    1,
  );
  assert.equal(
    unassignedTerminalCount(
      snapshot(
        [
          { slot: 0, terminalId: 'a' },
          { slot: 1, terminalId: 'b' },
        ],
        [{ terminalIds: ['a', 'b'] }],
      ),
    ),
    0,
  );
});

test('a Feature referencing an unknown terminal never inflates the count', () => {
  assert.equal(
    unassignedTerminalCount(
      snapshot([{ slot: 0, terminalId: 'a' }], [{ terminalIds: ['missing'] }]),
    ),
    1,
  );
  assert.equal(unassignedTerminalCount(snapshot([{ slot: 0, terminalId: 'a' }], [])), 1);
});

test('the Feature count reconciles live, exited, missing and reused Core slots', () => {
  const scoped = snapshot(
    [
      { slot: 0, terminalId: 'live' },
      { slot: 1, terminalId: 'exited' },
      { slot: 2, terminalId: 'admitted' },
      { slot: 3, terminalId: 'reused' },
      { slot: 4, terminalId: 'new' },
      { slot: 5, terminalId: 'closed' },
    ],
    [{ terminalIds: ['live', 'exited', 'admitted', 'reused', 'new', 'closed'] }],
  );
  scoped.slots[5]!.closed = true;
  const canvas = {
    observedAt: 100,
    entries: [
      { slot: 0, terminalId: 'live', state: 'running', startedAt: 80 },
      { slot: 1, terminalId: 'exited', state: 'running', startedAt: 80 },
      { slot: 3, terminalId: 'retired', state: 'running', startedAt: 80 },
    ],
  } satisfies FeatureCanvasEvidence;
  const owned = new Map<string, OwnedPaneEvidence>([
    ['new', { transport: 'connected', process: 'live' }],
    ['exited', { transport: 'connected', process: 'exited' }],
    ['closed', { transport: 'connected', process: 'live' }],
  ]);
  assert.deepEqual([...openFeatureTerminalIds(scoped, canvas, owned)], ['live', 'new']);
});
