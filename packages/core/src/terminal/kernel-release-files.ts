import { randomUUID } from 'node:crypto';
import { basename, join } from 'node:path';
import { z } from 'zod';
import {
  readRecoveryFile,
  syncRecoveryDirectory,
  writeRecoveryFile,
} from './offline-recovery-files.js';

const identitySchema = z.strictObject({
  dev: z.string().regex(/^\d+$/),
  inode: z.string().regex(/^\d+$/),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
const releaseLockSchema = z.strictObject({
  version: z.literal(1),
  id: z.uuid(),
  marker: identitySchema,
  destination: z.string().regex(/^released-marker-[0-9a-f-]{36}\.json$/),
});
export type KernelReleaseLock = z.infer<typeof releaseLockSchema>;
const observationSchema = z.strictObject({
  version: z.literal(1),
  id: z.uuid(),
  status: z.enum(['released_durability_uncertain', 'uncertain']),
  marker: identitySchema,
  destination: z.string(),
  limitation: z.literal('descendants_not_validated'),
});

function markerIdentity(file: string) {
  const record = readRecoveryFile(file);
  return { dev: record.identity[0]!, inode: record.identity[1]!, sha256: record.sha256 };
}
function maybeIdentity(file: string) {
  try {
    return markerIdentity(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}
function equal(left: z.infer<typeof identitySchema> | null, right: z.infer<typeof identitySchema>) {
  return (
    !!left && left.dev === right.dev && left.inode === right.inode && left.sha256 === right.sha256
  );
}
function lockName(identity: z.infer<typeof identitySchema>) {
  return `release-${identity.dev}-${identity.inode}-${identity.sha256}.lock`;
}
function observationPath(directory: string, id: string) {
  return join(directory, `release-observation-${id}.json`);
}
function readLock(directory: string, file: string) {
  if (basename(file) !== file) throw new Error('Invalid release lock name');
  const lock = releaseLockSchema.parse(
    JSON.parse(
      Buffer.from(readRecoveryFile(join(directory, file)).bytes, 'base64').toString('utf8'),
    ),
  );
  if (lockName(lock.marker) !== file || lock.destination !== `released-marker-${lock.id}.json`)
    throw new Error('Release lock identity mismatch');
  return lock;
}

/** Lock one exact inode forever; an existing lock is never overwritten or removed. */
export function beginKernelRelease(directory: string) {
  const marker = markerIdentity(join(directory, 'active-pair.json'));
  const id = randomUUID();
  const lock = releaseLockSchema.parse({
    version: 1,
    id,
    marker,
    destination: `released-marker-${id}.json`,
  });
  const name = lockName(marker);
  writeRecoveryFile(join(directory, name), JSON.stringify(lock) + '\n');
  if (!equal(markerIdentity(join(directory, 'active-pair.json')), marker))
    throw new Error('Release marker changed after locking');
  return { lock, name };
}

/** Recheck the exact reviewed source immediately before calling the native exclusive rename. */
export function verifyKernelReleaseSource(directory: string, name: string) {
  const lock = readLock(directory, name);
  if (!equal(markerIdentity(join(directory, 'active-pair.json')), lock.marker))
    throw new Error('Release marker changed');
  return lock;
}

/** Crash reconciliation is evidence-only; it never renames, restores or removes a marker. */
export function reconcileKernelRelease(directory: string, name: string) {
  const lock = readLock(directory, name);
  const current = maybeIdentity(join(directory, 'active-pair.json'));
  if (equal(current, lock.marker)) return { status: 'review_required' as const, lock };
  const archived = maybeIdentity(join(directory, lock.destination));
  const status = equal(archived, lock.marker) ? 'released_durability_uncertain' : 'uncertain';
  const observation = observationSchema.parse({
    version: 1,
    id: lock.id,
    status,
    marker: lock.marker,
    destination: lock.destination,
    limitation: 'descendants_not_validated',
  });
  const path = observationPath(directory, lock.id);
  const existing = maybeIdentity(path);
  if (existing) {
    const bytes = Buffer.from(readRecoveryFile(path).bytes, 'base64').toString('utf8');
    if (bytes !== JSON.stringify(observation) + '\n')
      throw new Error('Release observation changed');
  } else {
    syncRecoveryDirectory(directory);
    writeRecoveryFile(path, JSON.stringify(observation) + '\n');
  }
  return { status, lock };
}
