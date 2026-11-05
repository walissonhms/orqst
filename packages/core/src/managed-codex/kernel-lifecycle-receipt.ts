import { closeSync, constants, fstatSync, fsyncSync, openSync, readSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { terminalDirectory } from '../terminal/codex-profile.js';
import { lifecycleBindingSchema } from './lifecycle-receipt.js';

const uint = z.number().int().nonnegative().safe();
export const kernelProcessIdentitySchema = z.strictObject({
  boot: z.uuid(),
  pid: uint.positive(),
  ppid: uint,
  uid: uint,
  startSec: uint,
  startUsec: uint.max(999_999),
  sid: uint.positive(),
  pgid: uint.positive(),
});
export type KernelProcessIdentity = z.infer<typeof kernelProcessIdentitySchema>;
const bindingSchema = lifecycleBindingSchema.extend({ owner: z.uuid() });
type Binding = z.infer<typeof bindingSchema>;
const entrySchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('prepared'), version: z.literal(1), binding: bindingSchema }),
  z.strictObject({ type: z.literal('core'), identity: kernelProcessIdentitySchema }),
  z.strictObject({ type: z.literal('host'), identity: kernelProcessIdentitySchema }),
  z.strictObject({ type: z.literal('leader'), identity: kernelProcessIdentitySchema }),
]);
const limit = 4096;
function receiptPath(directory: string, binding: Binding): string {
  return join(directory, `lifecycle-kernel-${binding.instanceId}.jsonl`);
}
function assertPrivate(fd: number) {
  const info = fstatSync(fd);
  if (
    !info.isFile() ||
    info.uid !== process.getuid?.() ||
    info.mode & 0o077 ||
    info.nlink !== 1 ||
    info.size > limit
  )
    throw new Error('Private kernel lifecycle receipt unavailable');
}
function append(fd: number, value: z.infer<typeof entrySchema>) {
  const bytes = Buffer.from(JSON.stringify(entrySchema.parse(value)) + '\n');
  assertPrivate(fd);
  if (fstatSync(fd).size + bytes.length > limit) throw new Error('Kernel receipt limit');
  let offset = 0;
  while (offset < bytes.length) {
    const written = writeSync(fd, bytes, offset, bytes.length - offset);
    if (!written) throw new Error('Kernel receipt write unavailable');
    offset += written;
  }
  fsyncSync(fd);
}
function later(child: KernelProcessIdentity, parent: KernelProcessIdentity): boolean {
  return (
    child.boot === parent.boot &&
    child.uid === parent.uid &&
    child.ppid === parent.pid &&
    (child.startSec > parent.startSec ||
      (child.startSec === parent.startSec && child.startUsec > parent.startUsec))
  );
}
function follows(leader: KernelProcessIdentity, host: KernelProcessIdentity): boolean {
  return later(leader, host) && leader.pid === leader.sid && leader.pid === leader.pgid;
}

/** New evidence is private and append-only. The caller must never retry an uncertain write. */
export function createKernelLifecycleReceipt(directory: string, raw: Binding) {
  const binding = bindingSchema.parse(raw);
  terminalDirectory(directory, true);
  const fd = openSync(
    receiptPath(directory, binding),
    constants.O_CREAT |
      constants.O_EXCL |
      constants.O_RDWR |
      constants.O_APPEND |
      constants.O_NOFOLLOW,
    0o600,
  );
  try {
    append(fd, { type: 'prepared', version: 1, binding });
    const dir = openSync(
      directory,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_DIRECTORY,
    );
    try {
      fsyncSync(dir);
    } finally {
      closeSync(dir);
    }
  } catch (error) {
    closeSync(fd);
    throw error;
  }
  let phase: 'prepared' | 'core' | 'host' | 'leader' | 'failed' | 'closed' = 'prepared';
  let core: KernelProcessIdentity | undefined;
  let host: KernelProcessIdentity | undefined;
  return {
    core(rawIdentity: unknown) {
      if (phase !== 'prepared') throw new Error('Kernel receipt order');
      const identity = kernelProcessIdentitySchema.parse(rawIdentity);
      phase = 'failed';
      append(fd, { type: 'core', identity });
      core = identity;
      phase = 'core';
    },
    host(rawIdentity: unknown) {
      if (phase !== 'core' || !core) throw new Error('Kernel receipt order');
      const identity = kernelProcessIdentitySchema.parse(rawIdentity);
      if (!later(identity, core)) throw new Error('Kernel process relationship unavailable');
      phase = 'failed';
      append(fd, { type: 'host', identity });
      host = identity;
      phase = 'host';
    },
    leader(rawIdentity: unknown) {
      if (phase !== 'host' || !host) throw new Error('Kernel receipt order');
      const identity = kernelProcessIdentitySchema.parse(rawIdentity);
      if (!follows(identity, host)) throw new Error('Kernel process relationship unavailable');
      phase = 'failed';
      append(fd, { type: 'leader', identity });
      phase = 'leader';
    },
    close() {
      if (phase !== 'closed') {
        phase = 'closed';
        closeSync(fd);
      }
    },
  };
}

/** Inspection is read-only; incomplete, altered, or malformed receipts never prove absence. */
export function readKernelLifecycleReceipt(directory: string, raw: Binding) {
  let fd: number | undefined;
  try {
    const binding = bindingSchema.parse(raw);
    terminalDirectory(directory, true);
    fd = openSync(receiptPath(directory, binding), constants.O_RDONLY | constants.O_NOFOLLOW);
    assertPrivate(fd);
    const before = fstatSync(fd, { bigint: true });
    const buffer = Buffer.alloc(limit + 1);
    const size = readSync(fd, buffer, 0, buffer.length, 0);
    const after = fstatSync(fd, { bigint: true });
    if (
      size > limit ||
      !size ||
      buffer[size - 1] !== 10 ||
      BigInt(size) !== before.size ||
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.uid !== after.uid ||
      before.mode !== after.mode ||
      before.nlink !== after.nlink ||
      before.mtimeNs !== after.mtimeNs ||
      before.ctimeNs !== after.ctimeNs
    )
      throw new Error('Invalid kernel receipt');
    const records = buffer
      .subarray(0, size - 1)
      .toString('utf8')
      .split('\n')
      .map((line) => {
        const value = entrySchema.parse(JSON.parse(line));
        if (JSON.stringify(value) !== line) throw new Error('Noncanonical kernel receipt');
        return value;
      });
    if (records.length !== 4) throw new Error('Incomplete kernel receipt');
    const [prepared, core, host, leader] = records;
    if (
      prepared?.type !== 'prepared' ||
      core?.type !== 'core' ||
      host?.type !== 'host' ||
      leader?.type !== 'leader' ||
      JSON.stringify(prepared.binding) !== JSON.stringify(binding) ||
      !later(host.identity, core.identity) ||
      !follows(leader.identity, host.identity)
    )
      throw new Error('Invalid kernel receipt');
    return {
      status: 'complete' as const,
      core: core.identity,
      host: host.identity,
      leader: leader.identity,
    };
  } catch {
    return { status: 'unavailable' as const };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
