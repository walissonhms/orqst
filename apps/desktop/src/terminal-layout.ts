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
] as const;
export type TerminalViewAction =
  (typeof terminalViewActions)[number] | { percent: number } | { tab: number };
export interface TerminalLayoutState {
  axis: 'columns' | 'rows';
  percent: number;
  visible: number[];
  count: number;
}
export function parseTerminalViewAction(value: unknown): TerminalViewAction | undefined {
  if (typeof value === 'string') return terminalViewActions.find((action) => action === value);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length === 1 &&
    typeof record.tab === 'number' &&
    Number.isInteger(record.tab) &&
    record.tab >= 0 &&
    record.tab < TERMINAL_SLOT_CEILING
  )
    return { tab: record.tab };
  if (
    Object.keys(record).length === 1 &&
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
