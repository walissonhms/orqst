import { assertNoOfflineRecovery } from '../managed-codex/offline-recovery-gate.js';
import { fsyncSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { basename, join } from 'node:path';
import { z } from 'zod';
import { terminalDigest } from './authority.js';
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
  previousRecovery: z.uuid().optional(),
});
export type KernelReleaseLock = z.infer<typeof releaseLockSchema>;
const decisionSchema = z.strictObject({
  version: z.literal(1),
  status: z.literal('released'),
  reason: z.literal('absence_proven'),
  scope: z.literal('original_sessions'),
  limitation: z.literal('descendants_not_validated'),
  intent: z.strictObject({
    domain: z.literal('orqst.kernel-reservation-release'),
    version: z.literal(1),
    operationId: z.uuid(),
    previousRecovery: z.uuid().nullable(),
    previousLock: z
      .string()
      .regex(/^release-[0-9]+-[0-9]+-[a-f0-9]{64}(?:-after-[0-9a-f-]{36})?\.lock$/)
      .nullable(),
    evidenceDigest: z.string().regex(/^[a-f0-9]{64}$/),
    marker: identitySchema,
    destination: z.string(),
    sessions: z.array(z.number().int().positive().safe()).min(1).max(128),
    scans: z.strictObject({
      processCount: z.number().int().nonnegative().safe(),
      intervalMs: z.number().int().positive().max(10_000),
      scans: z.literal(2),
    }),
    limitation: z.literal('descendants_not_validated'),
  }),
  intentDigest: z.string().regex(/^[a-f0-9]{64}$/),
  archivedMarker: z.string(),
});
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
function lockName(identity: z.infer<typeof identitySchema>, previousRecovery?: string) {
  return `release-${identity.dev}-${identity.inode}-${identity.sha256}${previousRecovery ? `-after-${previousRecovery}` : ''}.lock`;
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
  if (
    lockName(lock.marker, lock.previousRecovery) !== file ||
    lock.destination !== `released-marker-${lock.id}.json`
  )
    throw new Error('Release lock identity mismatch');
  return lock;
}

/** Lock one exact inode forever; an existing lock is never overwritten or removed. */
export function beginKernelRelease(
  directory: string,
  mutation?: { validate(): void },
  sync = fsyncSync,
) {
  assertNoOfflineRecovery(directory);
  const marker = markerIdentity(join(directory, 'active-pair.json'));
  let previousRecovery: string | undefined;
  let previousLock: string | undefined;
  if (mutation) {
    mutation.validate();
    for (let depth = 0; depth < 128; depth++) {
      const candidate = lockName(marker, previousRecovery);
      let previous: KernelReleaseLock;
      try {
        previous = readLock(directory, candidate);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') break;
        throw error;
      }
      if (previous.previousRecovery !== previousRecovery || !equal(previous.marker, marker))
        throw new Error('Recovery predecessor mismatch');
      previousRecovery = previous.id;
      previousLock = candidate;
      if (depth === 127) throw new Error('Recovery predecessor budget');
    }
  }
  const id = randomUUID();
  const lock = releaseLockSchema.parse({
    version: 1,
    id,
    marker,
    destination: `released-marker-${id}.json`,
    ...(previousRecovery ? { previousRecovery } : {}),
  });
  const name = lockName(marker, previousRecovery);
  writeRecoveryFile(join(directory, name), JSON.stringify(lock) + '\n', sync);
  if (!equal(markerIdentity(join(directory, 'active-pair.json')), marker))
    throw new Error('Release marker changed after locking');
  return { lock, name, ...(previousLock ? { previousLock } : {}) };
}

/** Recheck the exact reviewed source immediately before calling the native exclusive rename. */
export function verifyKernelReleaseSource(directory: string, name: string) {
  assertNoOfflineRecovery(directory);
  const lock = readLock(directory, name);
  if (!equal(markerIdentity(join(directory, 'active-pair.json')), lock.marker))
    throw new Error('Release marker changed');
  return lock;
}

/** Crash reconciliation is evidence-only; it never renames, restores or removes a marker. */
export function reconcileKernelRelease(directory: string, name: string) {
  const lock = readLock(directory, name);
  const completed = join(directory, `release-decision-${lock.id}.json`);
  if (maybeIdentity(completed)) {
    const bytes = Buffer.from(readRecoveryFile(completed).bytes, 'base64').toString('utf8');
    let decision: z.infer<typeof decisionSchema> | undefined;
    try {
      decision = decisionSchema.parse(JSON.parse(bytes));
    } catch (error) {
      if (!(error instanceof SyntaxError) && !(error instanceof z.ZodError)) throw error;
      // A partial exclusive decision is preserved. The inode-bound archive is
      // reconciled below without treating these incomplete bytes as authority.
    }
    if (decision) {
      const predecessor = decision.intent.previousLock
        ? readLock(directory, decision.intent.previousLock)
        : null;
      if (
        decision.intent.operationId !== lock.id ||
        decision.intent.previousRecovery !== (lock.previousRecovery ?? null) ||
        (decision.intent.previousLock === null) !== (lock.previousRecovery === undefined) ||
        (predecessor !== null &&
          (predecessor.id !== lock.previousRecovery || !equal(predecessor.marker, lock.marker))) ||
        !equal(decision.intent.marker, lock.marker) ||
        decision.intent.destination !== lock.destination ||
        decision.archivedMarker !== lock.destination ||
        terminalDigest(JSON.stringify(decision.intent)) !== decision.intentDigest ||
        !equal(maybeIdentity(join(directory, lock.destination)), lock.marker)
      )
        throw new Error('Release decision binding changed');
      return { status: 'released' as const, lock };
    }
  }
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
  let path = observationPath(directory, lock.id);
  for (let depth = 0; depth < 128; depth++) {
    const existing = maybeIdentity(path);
    if (!existing) {
      syncRecoveryDirectory(directory);
      writeRecoveryFile(path, JSON.stringify(observation) + '\n');
      return { status, lock };
    }
    const bytes = Buffer.from(readRecoveryFile(path).bytes, 'base64').toString('utf8');
    if (bytes === JSON.stringify(observation) + '\n') return { status, lock };
    path = join(directory, `release-observation-${lock.id}-after-${existing.sha256}.json`);
  }
  throw new Error('Release observation chain budget');
}

/** Bounded startup audit. Invalid or unreadable locks refuse the audit rather than being skipped. */
export function reconcileKernelReleases(directory: string) {
  let names: string[];
  try {
    names = readdirSync(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  if (names.length > 1024) throw new Error('Release evidence directory budget');
  return names
    .filter((name) => name.startsWith('release-') && name.endsWith('.lock'))
    .sort()
    .map((name) => reconcileKernelRelease(directory, name));
}
