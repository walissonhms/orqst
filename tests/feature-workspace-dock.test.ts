import assert from 'node:assert/strict';
import test from 'node:test';
import { dockPanes, workspacePanes } from '../apps/dashboard/src/feature-workspace-dock.js';

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

test('workspace projection preserves tab order and distinguishes minimized from off-page without private data', () => {
  const first = {
    slot: 2,
    label: 'Backend',
    provider: 'codex',
    minimized: true,
    visible: false,
    active: false,
    maximized: false,
  };
  const second = { ...first, slot: 0, label: 'Review', minimized: false, active: true };
  assert.deepEqual(workspacePanes({ panes: [first, second] }), [first, second]);
  assert.deepEqual(
    workspacePanes({
      panes: [
        { ...first, terminalId: 'private' },
        { ...second, visible: 'yes' },
      ],
    }),
    [],
  );
  assert.deepEqual(workspacePanes({ panes: [first, first] }), [first]);
  assert.deepEqual(workspacePanes(undefined), []);
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
