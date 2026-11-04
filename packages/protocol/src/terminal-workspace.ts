import { z } from 'zod';
import { TERMINAL_SLOT_CEILING } from './terminal-capacity.js';

export const terminalDisplayNameSchema = z
  .string()
  .min(1)
  .max(48)
  .refine((value) => value.trim().length > 0 && !/[\p{Cc}\p{Cf}\p{Cs}]/u.test(value));
const ids = z
  .array(z.uuid())
  .max(TERMINAL_SLOT_CEILING)
  .refine((value) => new Set(value).size === value.length);

/** Visual metadata only. Deliberately excludes process bindings, paths, grants and output. */
export const terminalLayoutRecordSchema = z
  .strictObject({
    version: z.literal(1),
    order: ids.min(1),
    shown: ids,
    active: z.uuid(),
    maximized: z.uuid().nullable(),
    axis: z.enum(['columns', 'rows']),
    columns: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
    percent: z.number().int().min(25).max(75),
    names: z
      .array(z.strictObject({ id: z.uuid(), name: terminalDisplayNameSchema }))
      .max(TERMINAL_SLOT_CEILING),
  })
  .refine(
    (value) =>
      value.shown.every((id) => value.order.includes(id)) &&
      value.order.includes(value.active) &&
      (value.maximized === null || value.shown.includes(value.maximized)) &&
      value.names.every(({ id }) => value.order.includes(id)) &&
      new Set(value.names.map(({ id }) => id)).size === value.names.length,
    'Invalid layout identities',
  );
export type TerminalLayoutRecord = z.infer<typeof terminalLayoutRecordSchema>;
