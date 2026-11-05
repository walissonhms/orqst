import { randomUUID } from 'node:crypto';
import { fsyncSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import {
  kernelProcessIdentitySchema,
  type KernelProcessIdentity,
} from '../managed-codex/kernel-lifecycle-receipt.js';
import { readRecoveryFile, writeRecoveryFile } from './offline-recovery-files.js';

const lockSchema = z.strictObject({
  version: z.literal(1),
  id: z.uuid(),
  owner: kernelProcessIdentitySchema,
  predecessor: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
});
type MutationLock = z.infer<typeof lockSchema>;
const ROOT = 'admission-mutation.lock';
const LIMIT = 128;

function readLock(directory: string, name: string) {
  try {
    const record = readRecoveryFile(join(directory, name), 4096);
    const bytes = Buffer.from(record.bytes, 'base64').toString('utf8');
    const lock = lockSchema.parse(JSON.parse(bytes));
    if (bytes !== JSON.stringify(lock) + '\n') throw new Error('Noncanonical mutation lock');
    return { lock, digest: record.sha256, bytes };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/** The caller must obtain identities and liveness through its private native authority. */
export async function acquireAdmissionMutation(
  directory: string,
  ownerInput: KernelProcessIdentity,
  exists: (identity: KernelProcessIdentity) => Promise<boolean>,
  executorPid = process.pid,
  sync: (fd: number) => void = fsyncSync,
) {
  const owner = kernelProcessIdentitySchema.parse(ownerInput);
  if (
    (executorPid !== process.pid && executorPid !== process.ppid) ||
    owner.pid !== executorPid ||
    owner.uid !== process.getuid?.()
  )
    throw new Error('Mutation lock owner identity mismatch');
  let name = ROOT;
  let predecessor: string | null = null;
  const chain: { name: string; bytes: string }[] = [];
  for (let depth = 0; depth < LIMIT; depth++) {
    const existing = readLock(directory, name);
    if (!existing) {
      const lock: MutationLock = { version: 1, id: randomUUID(), owner, predecessor };
      const bytes = JSON.stringify(lock) + '\n';
      // O_EXCL and fsync are mandatory; EEXIST or an uncertain write is never retried.
      writeRecoveryFile(join(directory, name), bytes, sync);
      const held = readLock(directory, name);
      if (!held || held.bytes !== bytes) throw new Error('Mutation lock changed');
      const validate = () => {
        for (const item of [...chain, { name, bytes }]) {
          if (readLock(directory, item.name)?.bytes !== item.bytes)
            throw new Error('Mutation lock chain changed');
        }
      };
      validate();
      return { lock, name, names: [...chain.map((item) => item.name), name], validate };
    }
    if (existing.lock.predecessor !== predecessor)
      throw new Error('Invalid mutation lock predecessor');
    chain.push({ name, bytes: existing.bytes });
    if (await exists(existing.lock.owner)) throw new Error('Admission mutation in progress');
    predecessor = existing.digest;
    name = `admission-mutation.${existing.digest}.lock`;
  }
  throw new Error('Mutation lock chain budget');
}
