// Synthetic geometry/messages only; no provider, Electron process or persisted session.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseTerminalViewAction,
  terminalPaneBounds,
  terminalGridBounds,
  terminalGridPage,
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

test('visual commands reject process identities, injected names and arbitrary grid values', () => {
  for (const columns of [0, 1, 2, 3])
    assert.deepEqual(parseTerminalViewAction({ columns }), { columns });
  assert.deepEqual(parseTerminalViewAction({ name: '  Frontend  ' }), { name: 'Frontend' });
  assert.deepEqual(parseTerminalViewAction({ moveTo: 7 }), { moveTo: 7 });
  for (const raw of [
    { columns: '2' },
    { columns: 4 },
    { columns: NaN },
    { moveTo: 8 },
    { moveTo: 1, command: 'stop' },
    { name: '' },
    { name: ' ' },
    { name: 'x'.repeat(49) },
    { name: 'hidden\u202e' },
    { name: 'line\nbreak' },
    { name: 'ok', terminalId: 'other' },
  ])
    assert.equal(parseTerminalViewAction(raw), undefined);
});

test('grid covers each pixel once for 1–8 panes, uneven rows, both axes and odd dimensions', () => {
  for (const count of [1, 2, 3, 6, 8])
    for (const columns of [1, 2, 3])
      for (const axis of ['columns', 'rows'] as const) {
        const bounds = Array.from({ length: count }, (_, index) =>
          terminalGridBounds(1441, 1201, index, count, axis, 37, axis === 'rows' ? 1 : columns),
        );
        assert.equal(
          bounds.reduce((area, rect) => area + rect.width * rect.height, 0),
          1441 * 1201,
        );
        for (const [index, a] of bounds.entries()) {
          assert.ok(a.x >= 0 && a.y >= 0 && a.x + a.width <= 1441 && a.y + a.height <= 1201);
          for (const b of bounds.slice(index + 1))
            assert.ok(
              a.x + a.width <= b.x ||
                b.x + b.width <= a.x ||
                a.y + a.height <= b.y ||
                b.y + b.height <= a.y,
            );
        }
      }
});

test('compact paging keeps selected documents reachable without modifying the group', () => {
  const shown = [0, 1, 2, 3, 4, 5, 6, 7];
  for (const selected of shown) {
    assert.deepEqual(terminalGridPage(600, 700, shown, selected, 3, 'columns').visible, [selected]);
    assert.ok(
      terminalGridPage(1440, 900, shown, selected, 2, 'columns').visible.includes(selected),
    );
  }
  assert.equal(terminalGridPage(1440, 900, shown, 0, 0, 'columns').columns, 3);
  assert.deepEqual(shown, [0, 1, 2, 3, 4, 5, 6, 7]);
});
