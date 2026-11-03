import { randomUUID } from 'node:crypto';
import {
  closeSync,
  constants,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
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
  const syncDirectory = () => {
    const fd = openSync(
      directory,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  };
  try {
    lstatSync(file); // Includes dangling symlinks; never treat those as an empty slot.
    throw new Error('Previous Desktop pair requires evidence-backed reconciliation');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const owner = JSON.stringify({ version: 1, owner: randomUUID(), manifests }) + '\n';
  let claimed = false;
  let retired = false;
  const assertOwner = () => {
    if (!claimed || retired || terminalFile(file, true).toString('utf8') !== owner)
      throw new Error('Desktop pair admission owner changed');
  };
  return {
    assertOwner,
    claim() {
      if (retired) throw new Error('Desktop admission retired');
      if (claimed) return assertOwner();
      writeFileSync(file, owner, { flag: 'wx', mode: 0o600, flush: true });
      syncDirectory();
      claimed = true;
    },
    prepareRelease(evidence: unknown) {
      assertOwner();
      // Every attempt is exclusive. A failed/partial archive is retained, never overwritten.
      const record = JSON.parse(owner) as { owner: string };
      const archive = join(directory, `retired-${record.owner}-${randomUUID()}.json`);
      const bytes =
        JSON.stringify({ admission: record, retirementPreparedAt: Date.now(), evidence }) + '\n';
      writeFileSync(archive, bytes, { flag: 'wx', mode: 0o600, flush: true });
      syncDirectory();
      assertOwner();
      // The caller must fence the runtime before invoking this marker-only finalizer.
      return () => {
        assertOwner();
        if (terminalFile(archive, true).toString('utf8') !== bytes)
          throw new Error('Desktop retirement archive changed');
        unlinkSync(file);
        syncDirectory();
        claimed = false;
        retired = true;
      };
    },
  };
}
