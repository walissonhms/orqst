import { terminalLayoutRecordSchema, type TerminalLayoutRecord } from '@orqst/protocol';
import type { TerminalLayoutPreferences } from './terminal-layout.js';

/** Maps UUID metadata to reviewed slots, retaining unavailable members without enrolling them. */
export function featureLayout(
  identities: string[],
  members: string[],
  saved: TerminalLayoutRecord | null,
) {
  if (
    saved &&
    (saved.order.length !== members.length || saved.order.some((id) => !members.includes(id)))
  )
    throw new Error('Foreign Feature layout');
  const original = saved ?? {
    version: 1 as const,
    order: [...members],
    shown: [...members],
    active: members[0]!,
    maximized: null,
    axis: 'columns' as const,
    columns: 2 as const,
    percent: 50,
    names: [],
  };
  const slots = (ids: string[]) =>
    ids.flatMap((id) => (identities.includes(id) ? [identities.indexOf(id)] : []));
  const order = slots(original.order);
  const initial: TerminalLayoutPreferences = {
    axis: original.axis,
    columns: original.columns,
    percent: original.percent,
    order,
    shown: slots(original.shown),
    active: identities.indexOf(original.active),
    maximized: original.maximized === null ? null : identities.indexOf(original.maximized),
    names: identities.map((id) => original.names.find((name) => name.id === id)?.name ?? ''),
  };
  if (!order.includes(initial.active)) initial.active = order[0] ?? -1;
  if (initial.maximized !== null && !initial.shown.includes(initial.maximized))
    initial.maximized = null;
  return {
    initial,
    record(state: TerminalLayoutPreferences): TerminalLayoutRecord {
      if (!members.length || !state.order.length) throw new Error('No available Feature members');
      const available = state.order.map((slot) => identities[slot]!);
      if (
        available.some((id) => !members.includes(id)) ||
        new Set(available).size !== order.length ||
        available.length !== order.length
      )
        throw new Error('Changed Feature selection');
      const remaining = [...available];
      const result = terminalLayoutRecordSchema.parse({
        ...original,
        order: original.order.map((id) => (available.includes(id) ? remaining.shift()! : id)),
        shown: original.order.filter((id) =>
          available.includes(id)
            ? state.shown.includes(identities.indexOf(id))
            : original.shown.includes(id),
        ),
        active: identities[state.active],
        maximized: state.maximized === null ? null : identities[state.maximized],
        axis: state.axis,
        columns: state.columns,
        percent: state.percent,
        names: members.flatMap((id) => {
          const slot = identities.indexOf(id);
          const name =
            slot < 0 ? original.names.find((entry) => entry.id === id)?.name : state.names[slot];
          return name ? [{ id, name }] : [];
        }),
      });
      return result;
    },
  };
}
