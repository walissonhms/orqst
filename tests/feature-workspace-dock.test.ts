import assert from 'node:assert/strict';
import test from 'node:test';
import { dockPanes } from '../apps/dashboard/src/feature-workspace-dock.js';

test('dock shows only valid hidden panes without private identifiers', () => {
  assert.deepEqual(
    dockPanes({
      hidden: [
        { slot: 1, label: 'Backend', provider: 'codex' },
        { slot: 3, label: 'Review', provider: 'claude' },
      ],
      count: 4,
    }),
    [
      { slot: 1, label: 'Backend', provider: 'codex' },
      { slot: 3, label: 'Review', provider: 'claude' },
    ],
  );
});

test('dock rejects duplicate, out-of-range and malformed entries', () => {
  assert.deepEqual(
    dockPanes({
      hidden: [
        { slot: 1, label: 'A', provider: 'codex' },
        { slot: 1, label: 'B', provider: 'codex' },
        { slot: 9, label: 'C', provider: 'codex' },
        { slot: -1, label: 'D', provider: 'codex' },
        { slot: 2, label: 3, provider: 'codex' },
        { slot: 3, label: 'E', provider: 'codex', terminalId: 'private' },
      ],
    }),
    [{ slot: 1, label: 'A', provider: 'codex' }],
  );
  assert.deepEqual(dockPanes(undefined), []);
  assert.deepEqual(dockPanes({ hidden: 'no' }), []);
});
