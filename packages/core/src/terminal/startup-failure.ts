import { terminalPreparationFailureSchema, type TerminalPreparationFailure } from '@orqst/protocol';
import { z } from 'zod';

/** Strict inherited-IPC/stdout envelope; correlation never comes from a renderer. */
export const terminalStartupIdSchema = z.union([
  z.uuid(),
  z.string().regex(/^startup-[1-9][0-9]{0,19}$/),
]);
export const terminalStartupFailureSchema = z.strictObject({
  type: z.literal('startup-failure'),
  id: terminalStartupIdSchema,
  failure: terminalPreparationFailureSchema.refine(
    (failure) =>
      ['core_admission', 'core_startup'].includes(failure.stage) &&
      failure.effects === 'possible' &&
      [
        'capacity_reserved',
        'admission_invalid',
        'startup_failed',
        'startup_timeout',
        'startup_eof',
        'startup_protocol',
      ].includes(failure.code),
  ),
});
export class TerminalStartupError extends Error {
  constructor(readonly failure: TerminalPreparationFailure) {
    super('Managed Terminal Core startup unconfirmed; no retry');
  }
}
export function terminalStartupFailure(error: unknown): TerminalPreparationFailure {
  if (error instanceof TerminalStartupError) {
    const parsed = terminalStartupFailureSchema.shape.failure.safeParse(error.failure);
    if (parsed.success) return parsed.data;
  }
  return { stage: 'core_startup', code: 'startup_failed', effects: 'possible' };
}

export function terminalStartupHostFailure(id: string, error: unknown) {
  return {
    kind: 'failure' as const,
    id: terminalStartupIdSchema.parse(id),
    failure: terminalStartupFailure(error),
  };
}
