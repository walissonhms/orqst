import { join } from 'node:path';
import { z } from 'zod';
import { acquireAdmissionMutation } from './admission-mutation.js';
import { terminalDigest } from './authority.js';
import {
  beginKernelRelease,
  reconcileKernelReleases,
  verifyKernelReleaseSource,
  type KernelReleaseLock,
} from './kernel-release-files.js';
import { snapshotKernelReservation } from './kernel-reservation-snapshot.js';
import { readRecoveryFile, writeRecoveryFile } from './offline-recovery-files.js';
import type { KernelProcessIdentity } from '../managed-codex/kernel-lifecycle-receipt.js';

const scanSchema = z.strictObject({
  processCount: z.number().int().nonnegative().safe(),
  intervalMs: z.number().int().positive().max(10_000),
  scans: z.literal(2),
});
export interface KernelReleaseAuthority {
  /** Identity of the native process that actually executes rename, not its Node client. */
  mutationExecutor(): Promise<KernelProcessIdentity>;
  /** A native kernel query; reject errors rather than treating them as a dead holder. */
  mutationOwnerExists(identity: KernelProcessIdentity): Promise<boolean>;
  /** Native kernel queries; error or incomplete evidence rejects. */
  scan(
    identities: readonly KernelProcessIdentity[],
    sessions: readonly number[],
  ): Promise<z.infer<typeof scanSchema>>;
  /** Exactly one native Cancel-default review, bound to the immutable digest. */
  review(intent: Readonly<KernelReleaseIntent>): Promise<boolean>;
  /** Revalidate the same review, without renewing it or accepting renderer input. */
  revalidate(intent: Readonly<KernelReleaseIntent>): Promise<boolean>;
  /** Native RENAME_EXCL and post-rename inode/hash verification. */
  rename(lock: Readonly<KernelReleaseLock>): Promise<void>;
}
export interface KernelReleaseIntent {
  readonly domain: 'orqst.kernel-reservation-release';
  readonly version: 1;
  readonly operationId: string;
  readonly evidenceDigest: string;
  readonly marker: Readonly<KernelReleaseLock['marker']>;
  readonly destination: string;
  readonly sessions: readonly number[];
  readonly scans: Readonly<z.infer<typeof scanSchema>>;
  readonly limitation: 'descendants_not_validated';
}

/**
 * Private native composition only. No method grants renderer, HTTP, signal or
 * exit authority. The caller supplies separate empty private scratch directories.
 */
export async function releaseKernelReservation(
  directory: string,
  firstScratch: string,
  secondScratch: string,
  authority: KernelReleaseAuthority,
) {
  const executor = await authority.mutationExecutor();
  const mutation = await acquireAdmissionMutation(
    directory,
    executor,
    (identity) => authority.mutationOwnerExists(identity),
    executor.pid,
  );
  reconcileKernelReleases(directory);
  const { name, lock } = beginKernelRelease(directory);
  const first = snapshotKernelReservation(directory, firstScratch);
  if (
    first.snapshot.files[0]!.identity[0] !== lock.marker.dev ||
    first.snapshot.files[0]!.identity[1] !== lock.marker.inode ||
    first.snapshot.files[0]!.sha256 !== lock.marker.sha256
  )
    throw new Error('Kernel reservation changed');
  const identities = first.receipts.flatMap(({ core, host, leader }) => [core, host, leader]);
  const sessions = [...new Set(first.receipts.map(({ leader }) => leader.sid))].sort(
    (a, b) => a - b,
  );
  const scans = scanSchema.parse(await authority.scan(identities, sessions));
  const intent: KernelReleaseIntent = Object.freeze({
    domain: 'orqst.kernel-reservation-release',
    version: 1,
    operationId: lock.id,
    evidenceDigest: first.evidenceDigest,
    marker: Object.freeze({ ...lock.marker }),
    destination: lock.destination,
    sessions: Object.freeze([...sessions]),
    scans: Object.freeze({ ...scans }),
    limitation: 'descendants_not_validated',
  });
  if (!(await authority.review(intent))) throw new Error('Kernel release cancelled');
  const second = snapshotKernelReservation(directory, secondScratch);
  if (second.evidenceDigest !== intent.evidenceDigest)
    throw new Error('Kernel reservation changed');
  scanSchema.parse(await authority.scan(identities, sessions));
  if (!(await authority.revalidate(intent))) throw new Error('Kernel release approval expired');
  const checked = verifyKernelReleaseSource(directory, name);
  if (JSON.stringify(checked) !== JSON.stringify(lock))
    throw new Error('Kernel release lock changed');
  mutation.validate();
  // No retry or rollback after this effect boundary, including a lost acknowledgement.
  await authority.rename(lock);
  const archive = readRecoveryFile(join(directory, lock.destination));
  if (
    archive.identity[0] !== lock.marker.dev ||
    archive.identity[1] !== lock.marker.inode ||
    archive.sha256 !== lock.marker.sha256
  )
    throw new Error('Kernel release destination uncertain');
  const decision = {
    version: 1,
    status: 'released',
    reason: 'absence_proven',
    scope: 'original_sessions',
    limitation: 'descendants_not_validated',
    intent,
    intentDigest: terminalDigest(JSON.stringify(intent)),
    archivedMarker: lock.destination,
  };
  writeRecoveryFile(
    join(directory, `release-decision-${lock.id}.json`),
    JSON.stringify(decision) + '\n',
  );
  return decision;
}
