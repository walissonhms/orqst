import { z } from 'zod';

/** Transport ceiling, distinct from the explicitly configured Desktop selection limit. */
export const TERMINAL_SLOT_CEILING = 8;
export const DEFAULT_TERMINAL_SLOTS = 2;
export const terminalSlotLimitSchema = z.number().int().min(1).max(TERMINAL_SLOT_CEILING);
export function terminalSlotLimit(value: unknown = DEFAULT_TERMINAL_SLOTS): number {
  return terminalSlotLimitSchema.parse(value);
}
/** Per supervisor/journal domain, not a machine/workspace quota. Each Desktop slot
 * has its own domain, so N separately authorized slots may share one project. */
export const terminalAdmissionLimits = Object.freeze({ activeInstances: 2, perProject: 1 });
export const terminalIdentitySchema = z.strictObject({ terminalId: z.uuid() });
