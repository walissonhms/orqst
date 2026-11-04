// Synthetic geometry/messages only; no provider, Electron process or persisted session.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseTerminalViewAction,
  terminalPaneBounds,
  terminalViewActions,
} from '../apps/desktop/src/terminal-layout.js';

test('layout messages reject commands, identities, malformed ratios and coercion', () => {
  for (const action of terminalViewActions) assert.equal(parseTerminalViewAction(action), action);
  for (const percent of [25, 50, 75])
    assert.deepEqual(parseTerminalViewAction({ percent }), { percent });
  for (const raw of [
    'start',
    'stop',
    'write',
    'input',
    'tab-c',
    null,
    undefined,
    [],
    50,
    { percent: 24 },
    { percent: 76 },
    { percent: 50.5 },
    { percent: NaN },
    { percent: Infinity },
    { percent: '50' },
    { percent: 50, instanceId: 'other' },
    { percent: 50, command: 'start' },
    { toString: () => 'hide' },
  ])
    assert.equal(parseTerminalViewAction(raw), undefined);
});

test('both split axes preserve exact pixel coverage across odd sizes and ratios', () => {
  for (const width of [1, 801, 1281])
    for (const height of [1, 601, 901])
      for (const percent of [25, 37, 50, 63, 75])
        for (const axis of ['columns', 'rows'] as const) {
          const a = terminalPaneBounds(width, height, 0, 2, axis, percent);
          const b = terminalPaneBounds(width, height, 1, 2, axis, percent);
          assert.equal(a.width * a.height + b.width * b.height, width * height);
          assert.deepEqual({ x: a.x, y: a.y }, { x: 0, y: 0 });
          if (axis === 'columns') {
            assert.equal(a.x + a.width, b.x);
            assert.equal(b.x + b.width, width);
            assert.equal(a.height, height);
            assert.equal(b.height, height);
          } else {
            assert.equal(a.y + a.height, b.y);
            assert.equal(b.y + b.height, height);
            assert.equal(a.width, width);
            assert.equal(b.width, width);
          }
        }
});

test('a single visible tab always fills the parent regardless of split preference', () => {
  for (const axis of ['columns', 'rows'] as const)
    for (const percent of [25, 75])
      assert.deepEqual(terminalPaneBounds(1281, 901, 0, 1, axis, percent), {
        x: 0,
        y: 0,
        width: 1281,
        height: 901,
      });
});

test('N tab actions are bounded data and cannot carry process operations or extra fields', () => {
  for (const tab of [0, 2, 7]) assert.deepEqual(parseTerminalViewAction({ tab }), { tab });
  for (const raw of [
    { tab: 8 },
    { tab: -1 },
    { tab: 0.5 },
    { tab: '2' },
    { tab: 2, command: 'start' },
    { tab: 2, percent: 50 },
  ])
    assert.equal(parseTerminalViewAction(raw), undefined);
});
