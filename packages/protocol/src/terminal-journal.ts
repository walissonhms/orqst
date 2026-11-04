import { z } from 'zod';

export const terminalStateSchema = z.enum([
  'prepared',
  'starting',
  'running',
  'exited',
  'start_failed',
  'ownership_lost',
]);
export type TerminalState = z.infer<typeof terminalStateSchema>;
const identifier = z.string().min(1).max(128);
const timestamp = z.number().int().nonnegative().safe();
export const terminalAttemptSchema = z
  .strictObject({
    instanceId: z.uuid(),
    epoch: z.uuid(),
    clientId: identifier,
    projectId: identifier,
    manifestDigest: z.string().regex(/^[a-f0-9]{64}$/),
    state: terminalStateSchema,
    createdAt: timestamp,
    updatedAt: timestamp,
    exit: z
      .strictObject({
        exitCode: z.number().int().safe().nullable(),
        signal: z
          .union([z.number().int().safe(), z.string().regex(/^SIG[A-Z0-9]{1,29}$/)])
          .optional(),
      })
      .optional(),
  })
  .superRefine((record, context) => {
    if (
      (record.state === 'exited') !== (record.exit !== undefined) ||
      record.updatedAt < record.createdAt ||
      (record.exit?.exitCode === null &&
        (record.exit.signal === undefined ||
          (typeof record.exit.signal === 'number' && record.exit.signal <= 0)))
    )
      context.addIssue({ code: 'custom', message: 'Invalid terminal lifecycle evidence' });
  });
export type TerminalAttempt = z.infer<typeof terminalAttemptSchema>;

/** Private synchronous writer boundary; never an observation/control API. */
export interface TerminalJournal {
  readonly epoch: string;
  assertOwner(): void;
  withOwner<T>(effect: () => T): T;
  prepare(
    record: Pick<TerminalAttempt, 'instanceId' | 'clientId' | 'projectId' | 'manifestDigest'>,
  ): void;
  preflightStart(instanceId: string): void;
  transition(instanceId: string, state: TerminalState, exit?: TerminalAttempt['exit']): void;
  read(instanceId: string): TerminalAttempt | undefined;
  release(): void;
}
