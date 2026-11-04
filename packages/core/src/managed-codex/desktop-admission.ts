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
import type { TerminalPairAdmission } from '../terminal/managed-pair.js';
import { inspectDesktopAdmission } from './desktop-admission-inspection.js';

/** Sticky process admission across client restarts. No TTL, PID probe or automatic takeover. */
export function desktopAgentsAdmission(
  directory: string,
  manifests: readonly string[] = [],
  epoch?: string,
) {
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
  inspectDesktopAdmission(directory);
  const identity = randomUUID();
  const owner =
    JSON.stringify({ version: 1, owner: identity, manifests, ...(epoch ? { epoch } : {}) }) + '\n';
  let claimed = false;
  let retired = false;
  const enrollmentFiles = new Map<string, string>();
  const assertOwner = () => {
    if (!claimed || retired || terminalFile(file, true).toString('utf8') !== owner)
      throw new Error('Desktop pair admission owner changed');
    for (const [path, bytes] of enrollmentFiles)
      if (terminalFile(path, true).toString('utf8') !== bytes)
        throw new Error('Desktop enrollment admission changed');
  };
  return {
    owner: identity,
    assertOwner,
    preflight() {
      terminalDirectory(directory, true);
      if (claimed) return assertOwner();
      if (retired) throw new Error('Desktop admission retired');
      try {
        lstatSync(file);
        throw new Error('Desktop capacity already reserved');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    },
    claim() {
      if (retired) throw new Error('Desktop admission retired');
      if (claimed) return assertOwner();
      writeFileSync(file, owner, { flag: 'wx', mode: 0o600, flush: true });
      syncDirectory();
      claimed = true;
    },
    reserveEnrollment: ((record) => {
      assertOwner();
      const identity = (JSON.parse(owner) as { owner: string }).owner;
      const path = join(directory, `enrollment-${identity}-${record.input.opId}.json`);
      const bytes = JSON.stringify({ version: 1, owner: identity, ...record }) + '\n';
      // Exclusive append records, not replacement of the original files-set marker.
      // A partial write/fsync failure is preserved and the caller retains an uncertain slot.
      writeFileSync(path, bytes, { flag: 'wx', mode: 0o600, flush: true });
      syncDirectory();
      enrollmentFiles.set(path, bytes);
      assertOwner();
      return (receipt) => {
        assertOwner();
        const result = path.replace(/\.json$/, '.receipt.json');
        const content = JSON.stringify({ version: 1, owner: identity, receipt }) + '\n';
        writeFileSync(result, content, { flag: 'wx', mode: 0o600, flush: true });
        syncDirectory();
        enrollmentFiles.set(result, content);
        assertOwner();
      };
    }) satisfies NonNullable<TerminalPairAdmission['reserveEnrollment']>,
    prepareRelease(evidence: unknown) {
      assertOwner();
      // Every attempt is exclusive. A failed/partial archive is retained, never overwritten.
      const record = JSON.parse(owner) as { owner: string };
      const archive = join(directory, `retired-${record.owner}-${randomUUID()}.json`);
      const bytes =
        JSON.stringify({
          admission: record,
          enrollments: [...enrollmentFiles].map(([path, bytes]) => ({
            path,
            record: JSON.parse(bytes),
          })),
          retirementPreparedAt: Date.now(),
          evidence,
        }) + '\n';
      const archiveLimit = 1024 * 1024;
      if (Buffer.byteLength(bytes) > archiveLimit)
        throw new Error('Desktop retirement evidence exceeds archive budget');
      writeFileSync(archive, bytes, { flag: 'wx', mode: 0o600, flush: true });
      syncDirectory();
      assertOwner();
      // The caller must fence the runtime before invoking this marker-only finalizer.
      return () => {
        assertOwner();
        if (terminalFile(archive, true, archiveLimit).toString('utf8') !== bytes)
          throw new Error('Desktop retirement archive changed');
        unlinkSync(file);
        syncDirectory();
        claimed = false;
        retired = true;
      };
    },
  };
}
