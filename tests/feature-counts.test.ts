import assert from 'node:assert/strict';
import test from 'node:test';
import { unassignedTerminalCount } from '../apps/dashboard/src/feature-counts.js';
import type { FeatureNativeSnapshot } from '@orqst/protocol';

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
