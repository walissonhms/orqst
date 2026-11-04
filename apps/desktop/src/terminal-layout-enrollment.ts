import { terminalLayoutRecordSchema, type TerminalLayoutRecord } from '@orqst/protocol';

/** Extend saved visual metadata after an explicit membership CAS; never restore execution. */
export function appendTerminalLayout(
  previous: TerminalLayoutRecord,
  members: string[],
): TerminalLayoutRecord {
  if (previous.order.some((id) => !members.includes(id)))
    throw new Error('Enrollment cannot replace layout members');
  const added = members.filter((id) => !previous.order.includes(id));
  return terminalLayoutRecordSchema.parse({
    ...previous,
    order: [...previous.order, ...added],
    shown: [...previous.shown, ...added],
  });
}
