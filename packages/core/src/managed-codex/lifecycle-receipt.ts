import { closeSync, constants, fstatSync, fsyncSync, openSync, readSync, writeSync } from 'node:fs';
import { fsync, write } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { terminalDirectory } from '../terminal/codex-profile.js';

export const lifecycleBindingSchema = z.strictObject({
  instanceId: z.uuid(),
  epoch: z.uuid(),
  manifestDigest: z.string().regex(/^[a-f0-9]{64}$/),
  configDigest: z.string().regex(/^[a-f0-9]{64}$/),
});
export type LifecycleBinding = z.infer<typeof lifecycleBindingSchema>;
const timestamp = z.number().int().nonnegative().safe();
const headerSchema = z.strictObject({
  type: z.literal('prepared'),
  version: z.literal(1),
  binding: lifecycleBindingSchema,
  at: timestamp,
});
const recordSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('armed'), at: timestamp }),
  z.strictObject({ type: z.literal('started'), at: timestamp }),
  z.strictObject({ type: z.literal('spawn_failed'), at: timestamp }),
  z
    .strictObject({
      type: z.literal('exit'),
      at: timestamp,
      code: z.number().int().safe().nullable(),
      signal: z
        .string()
        .regex(/^SIG[A-Z0-9]{1,29}$/)
        .nullable(),
    })
    .refine((value) => value.code !== null || value.signal !== null),
]);
type Record = z.infer<typeof recordSchema>;
const maximumBytes = 4096;

function inspect(fd: number): Buffer {
  const info = fstatSync(fd);
  if (
    !info.isFile() ||
    info.uid !== process.getuid?.() ||
    info.mode & 0o077 ||
    info.nlink !== 1 ||
    info.size > maximumBytes
  )
    throw new Error('Private lifecycle receipt unavailable');
  const bytes = Buffer.alloc(maximumBytes + 1);
  const size = readSync(fd, bytes, 0, bytes.length, 0);
  if (size > maximumBytes) throw new Error('Lifecycle receipt limit');
  return bytes.subarray(0, size);
}
function append(fd: number, value: object): void {
  const bytes = Buffer.from(JSON.stringify(value) + '\n');
  if (fstatSync(fd).size + bytes.length > maximumBytes) throw new Error('Lifecycle receipt limit');
  let offset = 0;
  while (offset < bytes.length) {
    const written = writeSync(fd, bytes, offset, bytes.length - offset);
    if (!written) throw new Error('Lifecycle receipt write unavailable');
    offset += written;
  }
  fsyncSync(fd);
}
function file(state: string, binding: LifecycleBinding): string {
  lifecycleBindingSchema.parse(binding);
  terminalDirectory(state, true);
  return join(state, `lifecycle-${binding.instanceId}.jsonl`);
}

/** Exclusive pre-dispatch file. Only this descriptor is inherited; the host never opens a path. */
export function createLifecycleReceipt(state: string, binding: LifecycleBinding): number {
  const fd = openSync(
    file(state, binding),
    constants.O_CREAT |
      constants.O_EXCL |
      constants.O_RDWR |
      constants.O_APPEND |
      constants.O_NOFOLLOW,
    0o600,
  );
  try {
    inspect(fd);
    append(fd, headerSchema.parse({ type: 'prepared', version: 1, binding, at: Date.now() }));
    const directory = openSync(
      state,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_DIRECTORY,
    );
    try {
      fsyncSync(directory);
    } finally {
      closeSync(directory);
    }
    return fd;
  } catch (error) {
    closeSync(fd);
    // Never delete even an incomplete receipt or reuse its instance identity.
    throw error;
  }
}

/** Check the inherited receipt without changing it or accessing manifest paths. */
export function assertLifecycleConfig(fd: number, configDigest: string) {
  const bytes = inspect(fd).toString('utf8');
  if (!bytes.endsWith('\n') || bytes.split('\n').length !== 2)
    throw new Error('Lifecycle receipt already used');
  const header = headerSchema.parse(JSON.parse(bytes));
  if (header.binding.configDigest !== configDigest) throw new Error('Lifecycle config mismatch');
  return { bytes, header };
}

/** Host-only writer; persistence must precede spawn and lifecycle IPC. */
export function armLifecycleReceipt(fd: number, configDigest: string) {
  const { bytes, header } = assertLifecycleConfig(fd, configDigest);
  const armed = { type: 'armed', at: Math.max(header.at, Date.now()) };
  append(fd, armed); // Still before spawn: failure prevents any child dispatch.
  let previous = armed.at;
  let phase = 'armed';
  let size = Buffer.byteLength(bytes) + Buffer.byteLength(JSON.stringify(armed) + '\n');
  let pending = Promise.resolve();
  let failed = false;
  const record = (value: Omit<Record, 'at'> & { code?: number | null; signal?: string | null }) => {
    const next = recordSchema.parse({ ...value, at: Math.max(previous, Date.now()) });
    const allowed =
      phase === 'armed' ? ['started', 'spawn_failed'] : phase === 'started' ? ['exit'] : [];
    if (!allowed.includes(next.type)) throw new Error('Lifecycle receipt order');
    const encoded = Buffer.from(JSON.stringify(next) + '\n');
    size += encoded.length;
    if (size > maximumBytes) throw new Error('Lifecycle receipt limit');
    // Reserve sequence order now so a fast OS exit can queue behind its pending start.
    // This is admission to the write queue, not durability; any failed write poisons successors.
    phase = next.type;
    previous = next.at;
    const result = pending.then(async () => {
      if (failed) throw new Error('Lifecycle receipt writer unavailable');
      try {
        let offset = 0;
        while (offset < encoded.length) {
          const written = await new Promise<number>((resolve, reject) => {
            write(fd, encoded, offset, encoded.length - offset, (error, count) =>
              error ? reject(error) : resolve(count),
            );
          });
          if (!written) throw new Error('Lifecycle receipt write unavailable');
          offset += written;
        }
        await new Promise<void>((resolve, reject) =>
          fsync(fd, (error) => (error ? reject(error) : resolve())),
        );
      } catch (error) {
        failed = true;
        throw error;
      }
    });
    // Serial asynchronous I/O must never block the owned-process deadline event loop.
    pending = result.catch(() => {});
    return result;
  };
  return { record };
}

/** Explicit read-only evidence inspection; never opens a Store, adopts a PID or frees capacity. */
export function readLifecycleReceipt(state: string, binding: LifecycleBinding) {
  let fd: number | undefined;
  try {
    fd = openSync(
      file(state, binding),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const bytes = inspect(fd).toString('utf8');
    if (!bytes.endsWith('\n')) throw new Error('Partial lifecycle receipt');
    const lines = bytes.slice(0, -1).split('\n');
    if (lines.length > 4) throw new Error('Lifecycle receipt limit');
    const header = headerSchema.parse(JSON.parse(lines.shift()!));
    if (JSON.stringify(header.binding) !== JSON.stringify(lifecycleBindingSchema.parse(binding)))
      throw new Error('Lifecycle identity mismatch');
    const records = lines.map((line) => recordSchema.parse(JSON.parse(line)));
    let phase = 'prepared';
    let at = header.at;
    for (const record of records) {
      const allowed =
        phase === 'prepared'
          ? ['armed']
          : phase === 'armed'
            ? ['started', 'spawn_failed']
            : phase === 'started'
              ? ['exit']
              : [];
      if (!allowed.includes(record.type) || record.at < at)
        throw new Error('Lifecycle receipt order');
      phase = record.type;
      at = record.at;
    }
    return {
      status: phase === 'exit' ? ('recorded_exit' as const) : ('incomplete' as const),
      header,
      records,
    };
  } catch (error) {
    return {
      status:
        (error as NodeJS.ErrnoException).code === 'ENOENT'
          ? ('missing' as const)
          : ('invalid' as const),
    };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
