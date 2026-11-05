/**
 * Pure terminal arrangement model for the Studio.
 *
 * It computes where each terminal pane goes for a given mode. The same rectangles are
 * meant to drive both the DOM preview and, later, native terminal Webview bounds.
 */

export const arrangementModes = ['mosaic', 'columns', 'rows', 'focus', 'list', 'free'] as const;
export type ArrangementMode = (typeof arrangementModes)[number];

/** Relative size inside mosaic: small = 1 cell, large = 2×2 cells, wide = 2×1 cells. */
export const paneSizes = ['small', 'wide', 'large'] as const;
export type PaneSize = (typeof paneSizes)[number];

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ArrangedPane {
  id: string;
  order: number;
  size: PaneSize;
  minimized: boolean;
  /** Last free-mode geometry, in viewport pixels. */
  free?: Rect;
}

export interface ArrangementState {
  mode: ArrangementMode;
  panes: ArrangedPane[];
  /** Pane shown in focus mode or maximized over any other mode. */
  maximized: string | null;
  /** Split ratios for columns/rows mode, one weight per visible pane. */
  weights: Record<string, number>;
}

export interface PlacedPane {
  id: string;
  rect: Rect;
  /** Compact panes show only the header line (list mode). */
  compact: boolean;
  z: number;
}

export const GAP = 8;
export const LIST_ROW = 44;
export const MIN_PANE = { width: 260, height: 160 };

export function visiblePanes(state: ArrangementState): ArrangedPane[] {
  return state.panes.filter((pane) => !pane.minimized).sort((a, b) => a.order - b.order);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Mosaic: dense grid with size spans, filled row by row (first-fit). */
function mosaic(panes: ArrangedPane[], view: Rect): PlacedPane[] {
  if (panes.length === 0) return [];
  const columns = clamp(Math.floor((view.width + GAP) / (MIN_PANE.width + GAP)), 1, 4);
  const spanOf = (size: PaneSize) =>
    columns === 1
      ? { w: 1, h: 1 }
      : size === 'large'
        ? { w: 2, h: 2 }
        : size === 'wide'
          ? { w: 2, h: 1 }
          : { w: 1, h: 1 };
  const occupied: boolean[][] = [];
  const isFree = (row: number, col: number, w: number, h: number) => {
    if (col + w > columns) return false;
    for (let r = row; r < row + h; r++)
      for (let c = col; c < col + w; c++) if (occupied[r]?.[c]) return false;
    return true;
  };
  const cells: { id: string; row: number; col: number; w: number; h: number }[] = [];
  for (const pane of panes) {
    const span = spanOf(pane.size);
    let placed = false;
    for (let row = 0; !placed; row++) {
      for (let col = 0; col < columns && !placed; col++) {
        if (!isFree(row, col, span.w, span.h)) continue;
        for (let r = row; r < row + span.h; r++) {
          occupied[r] ??= [];
          for (let c = col; c < col + span.w; c++) occupied[r]![c] = true;
        }
        cells.push({ id: pane.id, row, col, ...span });
        placed = true;
      }
    }
  }
  const rows = occupied.length;
  const cellW = (view.width - GAP * (columns - 1)) / columns;
  const cellH = Math.max(MIN_PANE.height, (view.height - GAP * (rows - 1)) / rows);
  return cells.map((cell, index) => ({
    id: cell.id,
    compact: false,
    z: index,
    rect: {
      x: view.x + cell.col * (cellW + GAP),
      y: view.y + cell.row * (cellH + GAP),
      width: cell.w * cellW + (cell.w - 1) * GAP,
      height: cell.h * cellH + (cell.h - 1) * GAP,
    },
  }));
}

/** Columns/rows: one strip per pane, sized by its weight. */
function strips(
  panes: ArrangedPane[],
  view: Rect,
  axis: 'columns' | 'rows',
  weights: Record<string, number>,
): PlacedPane[] {
  if (panes.length === 0) return [];
  const extent = (axis === 'columns' ? view.width : view.height) - GAP * (panes.length - 1);
  const total = panes.reduce((sum, pane) => sum + (weights[pane.id] ?? 1), 0);
  let cursor = axis === 'columns' ? view.x : view.y;
  return panes.map((pane, index) => {
    const size = (extent * (weights[pane.id] ?? 1)) / total;
    const rect =
      axis === 'columns'
        ? { x: cursor, y: view.y, width: size, height: view.height }
        : { x: view.x, y: cursor, width: view.width, height: size };
    cursor += size + GAP;
    return { id: pane.id, rect, compact: false, z: index };
  });
}

function list(panes: ArrangedPane[], view: Rect): PlacedPane[] {
  return panes.map((pane, index) => ({
    id: pane.id,
    compact: true,
    z: index,
    rect: { x: view.x, y: view.y + index * (LIST_ROW + GAP), width: view.width, height: LIST_ROW },
  }));
}

/** Default cascade position for a pane that has never been placed in free mode. */
export function cascade(index: number, view: Rect): Rect {
  const width = Math.min(640, view.width * 0.55);
  const height = Math.min(420, view.height * 0.6);
  const slot = index % 8;
  return {
    x: view.x + clamp(slot * 56, 0, view.width - width),
    y: view.y + clamp(slot * 36, 0, view.height - height),
    width,
    height,
  };
}

/** Keep a free rectangle inside the viewport and above the minimum size. */
export function containRect(rect: Rect, view: Rect): Rect {
  const width = clamp(rect.width, MIN_PANE.width, view.width);
  const height = clamp(rect.height, MIN_PANE.height, view.height);
  return {
    width,
    height,
    x: clamp(rect.x, view.x, view.x + view.width - width),
    y: clamp(rect.y, view.y, view.y + view.height - height),
  };
}

function free(panes: ArrangedPane[], view: Rect, stack: string[]): PlacedPane[] {
  return panes.map((pane, index) => ({
    id: pane.id,
    compact: false,
    z: Math.max(0, stack.indexOf(pane.id)),
    rect: containRect(pane.free ?? cascade(index, view), view),
  }));
}

/**
 * Place every visible pane. `stack` is the free-mode z-order (last = front).
 * A maximized pane covers the whole viewport in any mode; others stay placed beneath
 * it so restoring is instant.
 */
export function arrange(state: ArrangementState, view: Rect, stack: string[] = []): PlacedPane[] {
  const panes = visiblePanes(state);
  const focusId =
    state.mode === 'focus' ? (state.maximized ?? panes[0]?.id ?? null) : state.maximized;
  if (focusId && panes.some((pane) => pane.id === focusId)) {
    return [{ id: focusId, rect: { ...view }, compact: false, z: panes.length }];
  }
  switch (state.mode) {
    case 'mosaic':
    case 'focus':
      return mosaic(panes, view);
    case 'columns':
      return strips(panes, view, 'columns', state.weights);
    case 'rows':
      return strips(panes, view, 'rows', state.weights);
    case 'list':
      return list(panes, view);
    case 'free':
      return free(panes, view, stack);
  }
}

/** Move a pane to a new position in the visible order (drag to reorder). */
export function reorder(
  state: ArrangementState,
  id: string,
  targetIndex: number,
): ArrangementState {
  const ordered = [...state.panes].sort((a, b) => a.order - b.order);
  const from = ordered.findIndex((pane) => pane.id === id);
  if (from < 0) return state;
  const [moved] = ordered.splice(from, 1);
  ordered.splice(clamp(targetIndex, 0, ordered.length), 0, moved!);
  return { ...state, panes: ordered.map((pane, order) => ({ ...pane, order })) };
}

/** Index in the visible order whose rectangle contains the point, for drop targets. */
export function dropIndex(placed: PlacedPane[], state: ArrangementState, x: number, y: number) {
  const order = visiblePanes(state).map((pane) => pane.id);
  const hit = placed.find(
    ({ rect }) =>
      x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height,
  );
  return hit ? order.indexOf(hit.id) : -1;
}

/** Resize the split between visible strip `index` and `index + 1` by `delta` pixels. */
export function resizeSplit(
  state: ArrangementState,
  view: Rect,
  index: number,
  delta: number,
): ArrangementState {
  const panes = visiblePanes(state);
  const a = panes[index];
  const b = panes[index + 1];
  if (!a || !b) return state;
  const axis = state.mode === 'rows' ? 'rows' : 'columns';
  const extent = (axis === 'columns' ? view.width : view.height) - GAP * (panes.length - 1);
  const total = panes.reduce((sum, pane) => sum + (state.weights[pane.id] ?? 1), 0);
  const perPixel = total / extent;
  const wa = state.weights[a.id] ?? 1;
  const wb = state.weights[b.id] ?? 1;
  const minWeight = ((axis === 'columns' ? MIN_PANE.width : MIN_PANE.height) * total) / extent;
  const shift = clamp(delta * perPixel, minWeight - wa, wb - minWeight);
  return {
    ...state,
    weights: { ...state.weights, [a.id]: wa + shift, [b.id]: wb - shift },
  };
}

export function updatePane(
  state: ArrangementState,
  id: string,
  patch: Partial<Omit<ArrangedPane, 'id'>>,
): ArrangementState {
  return {
    ...state,
    panes: state.panes.map((pane) => (pane.id === id ? { ...pane, ...patch } : pane)),
  };
}

export function toggleMaximize(state: ArrangementState, id: string): ArrangementState {
  return { ...state, maximized: state.maximized === id ? null : id };
}

export function minimize(state: ArrangementState, id: string): ArrangementState {
  return {
    ...updatePane(state, id, { minimized: true }),
    maximized: state.maximized === id ? null : state.maximized,
  };
}

export function restoreAll(state: ArrangementState): ArrangementState {
  return { ...state, panes: state.panes.map((pane) => ({ ...pane, minimized: false })) };
}

export function addPane(state: ArrangementState, id: string): ArrangementState {
  const order = state.panes.reduce((max, pane) => Math.max(max, pane.order + 1), 0);
  return {
    ...state,
    panes: [...state.panes, { id, order, size: 'small', minimized: false }],
  };
}

export function removePane(state: ArrangementState, id: string): ArrangementState {
  const weights = { ...state.weights };
  delete weights[id];
  return {
    ...state,
    weights,
    maximized: state.maximized === id ? null : state.maximized,
    panes: state.panes.filter((pane) => pane.id !== id),
  };
}

/**
 * Curved link between the facing edges of two panes, like a node graph.
 * Anchors sit on the edge midpoints closest to the other pane.
 */
export function linkPath(from: Rect, to: Rect): string {
  const fc = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
  const tc = { x: to.x + to.width / 2, y: to.y + to.height / 2 };
  const horizontal = Math.abs(tc.x - fc.x) >= Math.abs(tc.y - fc.y);
  const a = horizontal
    ? { x: tc.x > fc.x ? from.x + from.width : from.x, y: fc.y }
    : { x: fc.x, y: tc.y > fc.y ? from.y + from.height : from.y };
  const b = horizontal
    ? { x: tc.x > fc.x ? to.x : to.x + to.width, y: tc.y }
    : { x: tc.x, y: tc.y > fc.y ? to.y : to.y + to.height };
  const r = (n: number) => Math.round(n * 10) / 10;
  const facing = horizontal ? Math.abs(b.x - a.x) : Math.abs(b.y - a.y);
  if (facing < 80) {
    // Neighbours: arc between header centres instead of a loop through the gap.
    const h1 = { x: fc.x, y: from.y + 16 };
    const h2 = { x: tc.x, y: to.y + 16 };
    const lift = Math.min(h1.y, h2.y) - 36;
    return `M ${r(h1.x)} ${r(h1.y)} C ${r(h1.x)} ${r(lift)}, ${r(h2.x)} ${r(lift)}, ${r(h2.x)} ${r(h2.y)}`;
  }
  const bend = Math.max(40, (horizontal ? Math.abs(b.x - a.x) : Math.abs(b.y - a.y)) / 2);
  const c1 = horizontal
    ? { x: a.x + Math.sign(b.x - a.x || 1) * bend, y: a.y }
    : { x: a.x, y: a.y + Math.sign(b.y - a.y || 1) * bend };
  const c2 = horizontal
    ? { x: b.x - Math.sign(b.x - a.x || 1) * bend, y: b.y }
    : { x: b.x, y: b.y - Math.sign(b.y - a.y || 1) * bend };
  return `M ${r(a.x)} ${r(a.y)} C ${r(c1.x)} ${r(c1.y)}, ${r(c2.x)} ${r(c2.y)}, ${r(b.x)} ${r(b.y)}`;
}
