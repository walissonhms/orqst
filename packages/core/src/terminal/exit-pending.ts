import {
  closeSync,
  constants,
  fsyncSync,
  lstatSync,
  openSync,
  writeFileSync,
  renameSync,
  opendirSync,
} from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { terminalDirectory, terminalFile } from './codex-profile.js';
import { ownedShutdownInventorySchema } from './owned-shutdown.js';

export const ownedExitPendingSchema = z
  .strictObject({
    version: z.literal(1),
    status: z.literal('leader_exited_retirement_pending'),
    owner: z.uuid(),
    evidence: ownedShutdownInventorySchema,
  })
  .refine(
    (value) =>
      value.evidence.attempts.some((attempt) => attempt.state === 'exited' && !!attempt.exit) &&
      value.evidence.attempts.every(
        (attempt) =>
          attempt.epoch === value.evidence.epoch &&
          (['prepared', 'start_failed'].includes(attempt.state) ||
            (attempt.state === 'exited' && !!attempt.exit)),
      ),
    'Owned exit evidence required',
  );

/** Passive bounded evidence only; never signals, retires, deletes a reservation or adopts a PID. */
export function readOwnedExitPending(directory: string, owner: string, epoch: string) {
  terminalDirectory(directory, true);
  const file = join(directory, `exit-pending-${z.uuid().parse(owner)}.json`);
  let info;
  try {
    info = lstatSync(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  if (!info.isFile() || info.nlink !== 1) throw new Error('Unsafe owned exit marker');
  const record = ownedExitPendingSchema.parse(
    JSON.parse(terminalFile(file, true, 256 * 1024).toString('utf8')),
  );
  if (record.owner !== owner || record.evidence.epoch !== epoch)
    throw new Error('Owned exit marker scope changed');
  return record;
}

/** Core owner only. Exclusive durable append: the original active-pair and receipts stay intact. */
export function preserveOwnedExitPending(
  directory: string,
  value: unknown,
  assertOwner: () => void,
) {
  assertOwner();
  terminalDirectory(directory, true);
  const record = ownedExitPendingSchema.parse(value);
  const existing = readOwnedExitPending(directory, record.owner, record.evidence.epoch);
  if (existing) {
    if (JSON.stringify(existing) !== JSON.stringify(record))
      throw new Error('Owned exit evidence changed');
    return existing;
  }
  const file = join(directory, `exit-pending-${record.owner}.json`);
  const bytes = JSON.stringify(record) + '\n';
  if (Buffer.byteLength(bytes) > 256 * 1024) throw new Error('Owned exit marker limit');
  const fd = openSync(
    file,
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    writeFileSync(fd, bytes);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  const parent = openSync(
    directory,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  try {
    fsyncSync(parent);
  } finally {
    closeSync(parent);
  }
  assertOwner();
  return readOwnedExitPending(directory, record.owner, record.evidence.epoch)!;
}

export const pendingOwnedExitNoticeSchema = z.strictObject({
  id: z.uuid(),
  code: z.literal('owned_exit_pending'),
  principalCount: z.number().int().positive().max(1024),
});
export const maximumPendingOwnedExits = 64;
const admissionIdentity = z.object({ owner: z.uuid(), epoch: z.uuid() });
const syncPendingDirectory = (directory: string) => {
  const fd = openSync(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
};

/** Bounded deterministic notices. Preserved reservations are never adopted or automatically deleted. */
export function inspectPendingOwnedExits(directory: string) {
  try {
    terminalDirectory(directory, true);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const names: string[] = [];
  const handle = opendirSync(directory);
  try {
    for (let entries = 0; ; entries++) {
      if (entries >= 4096) throw new Error('Pending directory entry budget');
      const entry = handle.readSync();
      if (!entry) break;
      if (/^pending-pair-[0-9a-f-]{36}\.json$/.test(entry.name)) names.push(entry.name);
      if (names.length > maximumPendingOwnedExits) throw new Error('Pending reservation limit');
    }
  } finally {
    handle.closeSync();
  }
  return names.sort().map((name) => {
    const file = join(directory, name),
      info = lstatSync(file);
    if (!info.isFile() || info.nlink !== 1) throw new Error('Unsafe pending reservation');
    const reservation = admissionIdentity.parse(
      JSON.parse(terminalFile(file, true).toString('utf8')),
    );
    if (name !== `pending-pair-${reservation.owner}.json`)
      throw new Error('Pending reservation identity');
    const marker = readOwnedExitPending(directory, reservation.owner, reservation.epoch);
    if (!marker) throw new Error('Pending exit evidence missing');
    return pendingOwnedExitNoticeSchema.parse({
      id: reservation.owner,
      code: 'owned_exit_pending',
      principalCount: marker.evidence.attempts.filter((a) => a.state === 'exited').length,
    });
  });
}

/** Core-owned namespace handoff, never retirement. Rename and fsync stay in one verified directory. */
export function detachOwnedExitPending(
  directory: string,
  expectedMarker: string,
  assertOwner: () => void,
  operations = { rename: renameSync, sync: syncPendingDirectory },
) {
  terminalDirectory(directory, true);
  const identity = admissionIdentity.parse(JSON.parse(expectedMarker));
  if (!readOwnedExitPending(directory, identity.owner, identity.epoch))
    throw new Error('Durable pending exit required');
  const source = join(directory, 'active-pair.json'),
    target = join(directory, `pending-pair-${identity.owner}.json`);
  let existing: Buffer | undefined;
  try {
    existing = terminalFile(target, true);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (existing) {
    if (existing.toString('utf8') !== expectedMarker)
      throw new Error('Pending reservation changed');
    // A repeated ACK may arrive after a new owner claims active-pair. Never touch that new owner.
    let active: Buffer | undefined;
    try {
      active = terminalFile(source, true);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (active?.toString('utf8') === expectedMarker)
      throw new Error('Duplicate pending reservation namespace');
    operations.sync(directory);
    return;
  }
  if (inspectPendingOwnedExits(directory).length >= maximumPendingOwnedExits)
    throw new Error('Pending reservation limit');
  assertOwner();
  if (terminalFile(source, true).toString('utf8') !== expectedMarker)
    throw new Error('Active reservation changed');
  operations.rename(source, target);
  operations.sync(directory);
  // No deletion, retired archive or release receipt. Only the same bytes in the pending namespace.
  if (terminalFile(target, true).toString('utf8') !== expectedMarker)
    throw new Error('Pending reservation durability unconfirmed');
}
