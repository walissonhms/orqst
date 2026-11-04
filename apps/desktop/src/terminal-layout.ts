import { TERMINAL_SLOT_CEILING } from '@orqst/protocol';
/** Layout-only messages carry no process identity, command or authorization proof. */
export const terminalViewActions = [
  'dashboard',
  'hide',
  'tab-a',
  'tab-b',
  'split-columns',
  'split-rows',
  'maximize',
  'restore',
  'focus-other',
  'show-all',
  'move-earlier',
  'move-later',
] as const;
export type TerminalColumns = 0 | 1 | 2 | 3;
export type TerminalViewAction =
  | (typeof terminalViewActions)[number]
  | { percent: number }
  | { tab: number }
  | { columns: TerminalColumns }
  | { moveTo: number }
  | { name: string };
export interface TerminalLayoutPreferences {
  axis: 'columns' | 'rows';
  percent: number;
  columns: TerminalColumns;
  order: number[];
  shown: number[];
  active: number;
  maximized: number | null;
  names: string[];
}
export interface TerminalLayoutState extends TerminalLayoutPreferences {
  visible: number[];
  count: number;
  persisted: boolean;
  suspended?: boolean;
  workspaceChrome?: boolean;
}
export function terminalDisplayName(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= 48 &&
    !/[\p{Cc}\p{Cf}\p{Cs}]/u.test(value)
  );
}
function slot(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value < TERMINAL_SLOT_CEILING
  );
}
export function parseTerminalViewAction(value: unknown): TerminalViewAction | undefined {
  if (typeof value === 'string') return terminalViewActions.find((action) => action === value);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 1) return;
  if (slot(record.tab)) return { tab: record.tab };
  if (slot(record.moveTo)) return { moveTo: record.moveTo };
  if ([0, 1, 2, 3].includes(record.columns as number))
    return { columns: record.columns as TerminalColumns };
  if (terminalDisplayName(record.name)) return { name: record.name.trim() };
  if (
    typeof record.percent === 'number' &&
    Number.isInteger(record.percent) &&
    record.percent >= 25 &&
    record.percent <= 75
  )
    return { percent: record.percent };
}

/** Integer pixel partitions cover the window exactly, including odd dimensions. */
export function terminalPaneBounds(
  width: number,
  height: number,
  position: number,
  count: number,
  axis: TerminalLayoutState['axis'],
  percent: number,
) {
  if (count === 1) return { x: 0, y: 0, width, height };
  const extent = axis === 'columns' ? width : height;
  const boundary = Math.floor((extent * percent) / 100);
  const start = position === 0 ? 0 : boundary;
  const size = position === 0 ? boundary : extent - boundary;
  return axis === 'columns'
    ? { x: start, y: 0, width: size, height }
    : { x: 0, y: start, width, height: size };
}

/** Compact windows page through intact documents instead of shrinking terminals indefinitely. */
export function terminalGridPage(
  width: number,
  height: number,
  shown: number[],
  active: number,
  columns: TerminalColumns,
  axis: TerminalLayoutPreferences['axis'],
) {
  const maximumColumns = Math.max(1, Math.floor(width / 440));
  const effectiveColumns = axis === 'rows' ? 1 : Math.min(columns || 3, maximumColumns);
  const capacity = effectiveColumns * Math.max(1, Math.floor(height / 400));
  const start = Math.floor(Math.max(0, shown.indexOf(active)) / capacity) * capacity;
  return { visible: shown.slice(start, start + capacity), columns: effectiveColumns };
}

export function terminalGridBounds(
  width: number,
  height: number,
  position: number,
  count: number,
  axis: TerminalLayoutPreferences['axis'],
  percent: number,
  columns: number,
) {
  if (count <= 2 && (columns >= count || axis === 'rows'))
    return terminalPaneBounds(width, height, position, count, axis, percent);
  const row = Math.floor(position / columns);
  const rows = Math.ceil(count / columns);
  const rowColumns = Math.min(columns, count - row * columns);
  const column = position % columns;
  const x = Math.floor((width * column) / rowColumns);
  const y = Math.floor((height * row) / rows);
  return {
    x,
    y,
    width: Math.floor((width * (column + 1)) / rowColumns) - x,
    height: Math.floor((height * (row + 1)) / rows) - y,
  };
}
