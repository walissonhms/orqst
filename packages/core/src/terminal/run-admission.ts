import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { terminalDirectory } from './codex-profile.js';
import type { TerminalPairAdmission } from './managed-pair.js';

/** A Core can authorize only its own run. Historical reservation files are never opened. */
export function runTerminalAdmission(directory: string): TerminalPairAdmission & { owner: string } {
  try {
    mkdirSync(directory, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  terminalDirectory(directory, true);
  let active = true;
  const assertOwner = () => {
    if (!active) throw new Error('Terminal Core is retired');
  };
  return {
    owner: randomUUID(),
    claim: assertOwner,
    assertOwner,
    reserveEnrollment: () => {
      assertOwner();
      return assertOwner;
    },
    prepareRelease: () => {
      assertOwner();
      return () => {
        active = false;
      };
    },
  };
}
