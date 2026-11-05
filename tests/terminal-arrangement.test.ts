import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addPane,
  arrange,
  containRect,
  dropIndex,
  dropTarget,
  orderIndex,
  GAP,
  arcPath,
  LANE,
  lanePath,
  linkStyle,
  paneView,
  resizeFromEdge,
  resizeTrack,
  setOrchestrator,
  visiblePanes,
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

test('link style follows the mode and maximize', () => {
  assert.equal(linkStyle(stateWith(2, 'mosaic')), 'arc');
  assert.equal(linkStyle(stateWith(2, 'free')), 'arc');
  assert.equal(linkStyle(stateWith(2, 'rows')), 'lane');
  assert.equal(linkStyle(stateWith(2, 'list')), 'lane');
  assert.equal(linkStyle(stateWith(2, 'focus')), 'focus');
  assert.equal(linkStyle(toggleMaximize(stateWith(2, 'mosaic'), 'p0')), 'focus');
});

test('lane modes reserve a left gutter that panes never cover', () => {
  for (const mode of ['rows', 'list'] as const) {
    const state = stateWith(3, mode);
    assert.deepEqual(paneView(state, view), { ...view, x: LANE, width: view.width - LANE });
    for (const pane of arrange(state, view)) assert.ok(pane.rect.x >= LANE);
  }
});

test('arcPath bends up when there is room and down at the top edge', () => {
  const top: Rect = { x: 0, y: 0, width: 100, height: 100 };
  const topRight: Rect = { x: 300, y: 0, width: 100, height: 100 };
  const [, , c1y] = arcPath(top, topRight, view)
    .match(/C (\S+) (\S+),/)!
    .slice(0) as string[];
  assert.ok(Number(c1y) > 32, 'bends down below the headers');
  const low: Rect = { x: 0, y: 400, width: 100, height: 100 };
  const lowRight: Rect = { x: 300, y: 400, width: 100, height: 100 };
  const c = Number(arcPath(low, lowRight, view).match(/C \S+ (\S+),/)![1]);
  assert.ok(c < 400, 'bends up above the headers');
  assert.match(arcPath(top, topRight, view), /^M 50 32 C .* 350 32$/);
});

test('lanePath runs in the gutter between the two headers', () => {
  const a: Rect = { x: LANE, y: 0, width: 500, height: 44 };
  const b: Rect = { x: LANE, y: 104, width: 500, height: 44 };
  const path = lanePath(a, b, view);
  assert.match(path, new RegExp(`^M ${LANE - 2} 16 `));
  assert.match(path, new RegExp(`H ${LANE - 2}$`));
  assert.ok(path.includes('V '));
});

test('drag targets map to the full order even with minimized panes', () => {
  let state = minimize(stateWith(4), 'p0');
  const placed = arrange(state, view);
  const p3 = placed.find((pane) => pane.id === 'p3')!.rect;
  const target = dropTarget(placed, p3.x + 4, p3.y + 4);
  assert.equal(target, 'p3');
  state = reorder(state, 'p1', orderIndex(state, target!));
  assert.deepEqual(
    [...state.panes].sort((a, b) => a.order - b.order).map((pane) => pane.id),
    ['p0', 'p2', 'p3', 'p1'],
  );
});

test('dragging a mosaic border resizes the neighbouring tracks only', () => {
  const state = stateWith(4);
  const before = arrange(state, view);
  const wider = resizeTrack(state, view, 'cols', 0, 30);
  const after = arrange(wider, view);
  const w = (list: typeof before, id: string) => list.find((pane) => pane.id === id)!.rect.width;
  assert.ok(Math.abs(w(after, 'p0') - w(before, 'p0') - 30) < 0.5);
  assert.ok(Math.abs(w(after, 'p1') - w(before, 'p1') + 30) < 0.5);
  assert.ok(Math.abs(w(after, 'p2') - w(before, 'p2')) < 0.5);
  const clamped = arrange(resizeTrack(state, view, 'cols', 0, 9000), view);
  assert.ok(w(clamped, 'p1') >= MIN_PANE.width - 0.5);
  for (let i = 0; i < after.length; i++)
    for (let j = i + 1; j < after.length; j++) assert.ok(!overlaps(after[i]!.rect, after[j]!.rect));
});

test('free resize from any edge keeps the opposite edge fixed', () => {
  const rect: Rect = { x: 100, y: 100, width: 400, height: 300 };
  assert.deepEqual(resizeFromEdge(rect, 'w', -50, 0), { x: 50, y: 100, width: 450, height: 300 });
  assert.deepEqual(resizeFromEdge(rect, 'n', 0, 40), { x: 100, y: 140, width: 400, height: 260 });
  assert.deepEqual(resizeFromEdge(rect, 'se', 10, 20), { x: 100, y: 100, width: 410, height: 320 });
  const tiny = resizeFromEdge(rect, 'nw', 5000, 5000);
  assert.equal(tiny.width, MIN_PANE.width);
  assert.equal(tiny.x + tiny.width, 500);
});

test('the orchestrator is pinned first and cleared when removed', () => {
  let state = setOrchestrator(stateWith(3), 'p2');
  assert.equal(visiblePanes(state)[0]!.id, 'p2');
  assert.equal(setOrchestrator(state, 'p2').orchestrator, null);
  state = removePane(state, 'p2');
  assert.equal(state.orchestrator, null);
});
