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
/** Stable workspace display identity. It never grants terminal or process authority. */
export const terminalDisplayIdSchema = z.string().regex(/^T-[0-9]{3,5}$/);
export function terminalDisplayId(ordinal: number) {
  return terminalDisplayIdSchema.parse(`T-${String(ordinal).padStart(3, '0')}`);
}

export const terminalIdentitySchema = z.strictObject({
  terminalId: z.uuid(),
  alias: z
    .string()
    .regex(/^P-[0-9a-f-]{36}$/i)
    .optional(),
  resumeSessionId: z.union([z.uuid(), z.string().regex(/^ses_[A-Za-z0-9]{1,96}$/)]).optional(),
});
