import { z } from 'zod';
const absolute = z
  .string()
  .startsWith('/')
  .max(2048)
  .refine((value) => !value.includes('\0'));
/** Fixed native argv vector; this is never an action/renderer request. */
export function offlineRecoveryHelperArguments(args: readonly string[]) {
  if (args.length !== 1 && args.length !== 3)
    throw new Error('Invalid administrative helper arguments');
  const parent = absolute.parse(args[0]);
  if (args.length === 1) return { parent, historicalEvidenceFile: undefined };
  if (args[1] !== '--offline-recovery-binding-evidence')
    throw new Error('Invalid administrative helper arguments');
  return { parent, historicalEvidenceFile: absolute.parse(args[2]) };
}
