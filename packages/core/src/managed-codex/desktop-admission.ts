import { randomUUID } from 'node:crypto';
import { lstatSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { terminalDirectory, terminalFile } from '../terminal/codex-profile.js';

/** Sticky process admission across client restarts. No TTL, PID probe or automatic takeover. */
export function desktopAgentsAdmission(directory: string, manifests: readonly string[] = []) {
  try {
    mkdirSync(directory, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  terminalDirectory(directory, true);
  const file = join(directory, 'active-pair.json');
  try {
    lstatSync(file); // Includes dangling symlinks; never treat those as an empty slot.
    throw new Error('Previous Desktop pair requires evidence-backed reconciliation');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const owner = JSON.stringify({ version: 1, owner: randomUUID(), manifests }) + '\n';
  let claimed = false;
  return {
    claim() {
      if (claimed) return;
      writeFileSync(file, owner, { flag: 'wx', mode: 0o600, flush: true });
      claimed = true;
    },
    release() {
      if (!claimed) return;
      if (terminalFile(file, true).toString('utf8') !== owner)
        throw new Error('Desktop pair admission owner changed');
      unlinkSync(file);
      claimed = false;
    },
  };
}
