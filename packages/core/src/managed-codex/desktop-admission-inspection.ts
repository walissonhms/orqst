import { readOwnedExitPending } from '../terminal/exit-pending.js';
import { lstatSync } from 'node:fs';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { z } from 'zod';
import { terminalDirectory, terminalFile } from '../terminal/codex-profile.js';
import { assertNoOfflineRecovery } from './offline-recovery-gate.js';

const path = z
  .string()
  .startsWith('/')
  .max(2048)
  .refine((value) => !value.includes('\0'));
const manifests = z.array(path).max(8);
export const desktopAdmissionMarkerSchema = z.strictObject({
  version: z.literal(1),
  owner: z.uuid(),
  manifests,
  epoch: z.uuid().optional(),
});
/** Private owned-Core evidence only. Never accept these fields from a renderer. */
export const desktopAdmissionContextSchema = z.strictObject({
  owner: z.uuid(),
  epoch: z.uuid(),
  initialFiles: manifests.min(1),
});
export type DesktopAdmissionContext = z.infer<typeof desktopAdmissionContextSchema>;
export class DesktopAdmissionRefused extends Error {
  constructor(readonly code: 'capacity_reserved' | 'admission_invalid' | 'owned_exit_pending') {
    super('Previous Desktop pair requires evidence-backed reconciliation');
  }
}

/** Passive, bounded inspection. No mkdir, Store, claim, cleanup, PID probe or takeover. */
export function inspectDesktopAdmission(directory: string, current?: DesktopAdmissionContext) {
  try {
    if (current) desktopAdmissionContextSchema.parse(current);
    try {
      lstatSync(directory);
    } catch (error) {
      if (current || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      if (!isAbsolute(directory) || join(dirname(directory), basename(directory)) !== directory)
        throw error;
      terminalDirectory(dirname(directory), true);
      const ancestor = lstatSync(dirname(directory), { bigint: true });
      return JSON.stringify([ancestor.dev.toString(), ancestor.ino.toString(), 'absent-directory']);
    }
    terminalDirectory(directory, true);
    assertNoOfflineRecovery(directory);
    const parent = lstatSync(directory, { bigint: true });
    if (!parent.isDirectory() || parent.uid !== BigInt(process.getuid!()) || parent.mode & 0o077n)
      throw new Error();
    const file = join(directory, 'active-pair.json');
    let before;
    try {
      before = lstatSync(file, { bigint: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const after = lstatSync(directory, { bigint: true });
      if (
        parent.dev !== after.dev ||
        parent.ino !== after.ino ||
        parent.mode !== after.mode ||
        parent.uid !== after.uid
      )
        throw error;
      return JSON.stringify([parent.dev.toString(), parent.ino.toString(), null]);
    }
    if (!before.isFile() || before.nlink !== 1n) throw new Error();
    // Reuse the canonical/O_NOFOLLOW/private owner/mode and bounded-read implementation.
    const marker = desktopAdmissionMarkerSchema.parse(
      JSON.parse(terminalFile(file, true, 16 * 1024, before).toString('utf8')),
    );
    const after = lstatSync(file, { bigint: true });
    const parentAfter = lstatSync(directory, { bigint: true });
    if (
      parent.dev !== parentAfter.dev ||
      parent.ino !== parentAfter.ino ||
      parent.mode !== parentAfter.mode ||
      parent.uid !== parentAfter.uid ||
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeNs !== after.mtimeNs ||
      before.ctimeNs !== after.ctimeNs ||
      before.mode !== after.mode ||
      before.uid !== after.uid ||
      after.nlink !== 1n
    )
      throw new Error();
    if (
      !current ||
      marker.owner !== current.owner ||
      marker.epoch !== current.epoch ||
      JSON.stringify(marker.manifests) !== JSON.stringify(current.initialFiles)
    ) {
      if (!current && marker.epoch && readOwnedExitPending(directory, marker.owner, marker.epoch))
        throw new DesktopAdmissionRefused('owned_exit_pending');
      throw new DesktopAdmissionRefused('capacity_reserved');
    }
    return JSON.stringify([
      parent.dev.toString(),
      parent.ino.toString(),
      before.dev.toString(),
      before.ino.toString(),
      before.mtimeNs.toString(),
      before.ctimeNs.toString(),
    ]);
  } catch (error) {
    if (error instanceof DesktopAdmissionRefused) throw error;
    throw new DesktopAdmissionRefused('admission_invalid');
  }
}
