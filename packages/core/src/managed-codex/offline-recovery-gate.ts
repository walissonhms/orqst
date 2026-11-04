import { lstatSync } from 'node:fs';
import { join } from 'node:path';

export const RECOVERY_GATE = 'offline-recovery.json';
export const RECOVERY_LOCK = 'offline-recovery-operation.lock';

/** Deny-only hook. Never parses authority from a file or removes a stale lock. */
export function assertNoOfflineRecovery(directory: string) {
  for (const name of [RECOVERY_GATE, RECOVERY_LOCK]) {
    try {
      lstatSync(join(directory, name));
      throw new Error('Desktop admission reserved for explicit offline recovery');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}
