import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addPane,
  arrange,
  containRect,
  dropIndex,
  GAP,
  linkPath,
  MIN_PANE,
  minimize,
  removePane,
  reorder,
  resizeSplit,
  restoreAll,
  toggleMaximize,
  updatePane,
  type ArrangementMode,
  type ArrangementState,
  type Rect,
} from '../apps/dashboard/src/terminal-arrangement.js';

const view: Rect = { x: 0, y: 0, width: 1200, height: 800 };

function stateWith(count: number, mode: ArrangementMode = 'mosaic'): ArrangementState {
  let state: ArrangementState = { mode, panes: [], maximized: null, weights: {} };
  for (let index = 0; index < count; index++) state = addPane(state, `p${index}`);
  return state;
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

function inside(rect: Rect, outer: Rect): boolean {
  const e = 0.001;
  return (
    rect.x >= outer.x - e &&
    rect.y >= outer.y - e &&
    rect.x + rect.width <= outer.x + outer.width + e &&
    rect.y + rect.height <= outer.y + outer.height + e
  );
}

test('tiled modes place every visible pane without overlap inside the view', () => {
  for (const mode of ['mosaic', 'columns', 'rows', 'list'] as const) {
    const placed = arrange(stateWith(6, mode), view);
    assert.equal(placed.length, 6, mode);
    for (const pane of placed) assert.ok(inside(pane.rect, view), `${mode} ${pane.id} inside`);
    for (let i = 0; i < placed.length; i++)
      for (let j = i + 1; j < placed.length; j++)
        assert.ok(!overlaps(placed[i]!.rect, placed[j]!.rect), `${mode} ${i}/${j} overlap`);
  }
});

test('mosaic honours large and wide sizes and keeps the grid dense', () => {
  let state = stateWith(5);
  state = updatePane(state, 'p0', { size: 'large' });
  state = updatePane(state, 'p1', { size: 'wide' });
  const placed = arrange(state, view);
  const large = placed.find((pane) => pane.id === 'p0')!.rect;
  const small = placed.find((pane) => pane.id === 'p4')!.rect;
  assert.ok(large.width > small.width * 1.9);
  assert.ok(large.height > small.height * 1.9);
  for (let i = 0; i < placed.length; i++)
    for (let j = i + 1; j < placed.length; j++)
      assert.ok(!overlaps(placed[i]!.rect, placed[j]!.rect));
});

test('minimized panes are not placed and restore brings them back', () => {
  let state = minimize(stateWith(3), 'p1');
  assert.deepEqual(
    arrange(state, view).map((pane) => pane.id),
    ['p0', 'p2'],
  );
  state = restoreAll(state);
  assert.equal(arrange(state, view).length, 3);
});

test('maximize covers the view in any mode and minimizing it clears maximize', () => {
  for (const mode of ['mosaic', 'columns', 'list', 'free'] as const) {
    const state = toggleMaximize(stateWith(3, mode), 'p2');
    assert.deepEqual(arrange(state, view), [{ id: 'p2', rect: view, compact: false, z: 3 }]);
    assert.equal(minimize(state, 'p2').maximized, null);
  }
});

test('focus mode shows the first visible pane when none is chosen', () => {
  const placed = arrange(minimize(stateWith(3, 'focus'), 'p0'), view);
  assert.deepEqual(
    placed.map((pane) => pane.id),
    ['p1'],
  );
});

test('reorder moves a pane to the drop position', () => {
  const state = reorder(stateWith(4), 'p0', 2);
  assert.deepEqual(
    [...state.panes].sort((a, b) => a.order - b.order).map((pane) => pane.id),
    ['p1', 'p2', 'p0', 'p3'],
  );
  assert.equal(reorder(state, 'missing', 0), state);
});

test('dropIndex finds the pane under the pointer', () => {
  const state = stateWith(4, 'columns');
  const placed = arrange(state, view);
  const third = placed[2]!.rect;
  assert.equal(dropIndex(placed, state, third.x + 5, third.y + 5), 2);
  assert.equal(dropIndex(placed, state, -10, -10), -1);
});

test('resizeSplit moves space between neighbours and respects the minimum size', () => {
  const state = stateWith(2, 'columns');
  const wider = arrange(resizeSplit(state, view, 0, 200), view);
  assert.ok(wider[0]!.rect.width > wider[1]!.rect.width);
  const extreme = arrange(resizeSplit(state, view, 0, 5000), view);
  assert.ok(extreme[1]!.rect.width >= MIN_PANE.width - 0.5);
  assert.ok(Math.abs(extreme[0]!.rect.width + extreme[1]!.rect.width + GAP - view.width) < 0.5);
});

test('free mode keeps saved geometry inside the view', () => {
  const state = updatePane(stateWith(2, 'free'), 'p0', {
    free: { x: 5000, y: -40, width: 50, height: 9000 },
  });
  const rect = arrange(state, view).find((pane) => pane.id === 'p0')!.rect;
  assert.ok(inside(rect, view));
  assert.ok(rect.width >= MIN_PANE.width);
  assert.deepEqual(containRect(rect, view), rect);
});

test('free mode z-order follows the stack', () => {
  const placed = arrange(stateWith(3, 'free'), view, ['p2', 'p0']);
  const z = Object.fromEntries(placed.map((pane) => [pane.id, pane.z]));
  assert.ok(z.p0! > z.p2!);
});

test('removing a pane clears its weight and maximize', () => {
  let state = toggleMaximize(stateWith(2, 'columns'), 'p1');
  state = { ...state, weights: { p0: 1, p1: 2 } };
  const removed = removePane(state, 'p1');
  assert.equal(removed.maximized, null);
  assert.deepEqual(removed.weights, { p0: 1 });
  assert.equal(removed.panes.length, 1);
});

test('linkPath connects facing edges', () => {
  const left: Rect = { x: 0, y: 0, width: 100, height: 100 };
  const right: Rect = { x: 300, y: 0, width: 100, height: 100 };
  assert.match(linkPath(left, right), /^M 100 50 C .* 300 50$/);
  const below: Rect = { x: 0, y: 300, width: 100, height: 100 };
  assert.match(linkPath(left, below), /^M 50 100 C .* 50 300$/);
});

test('linkPath arcs over the headers of adjacent panes', () => {
  const a: Rect = { x: 0, y: 0, width: 100, height: 100 };
  const b: Rect = { x: 108, y: 0, width: 100, height: 100 };
  assert.match(linkPath(a, b), /^M 50 16 C 50 -20, 158 -20, 158 16$/);
});
