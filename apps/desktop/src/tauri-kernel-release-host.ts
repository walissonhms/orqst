import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { terminalDirectory } from '../../../packages/core/src/terminal/codex-profile.js';
import { releaseKernelReservation } from '../../../packages/core/src/terminal/kernel-release.js';
import { kernelProcessIdentitySchema } from '../../../packages/core/src/managed-codex/kernel-lifecycle-receipt.js';

// Fixed native parent only; no renderer, network or process signalling.
process.umask(0o077);
if (process.platform !== 'darwin' || process.argv.length !== 3 || !/^v24\./.test(process.version))
  throw new Error('Private native recovery helper only');
const parent = process.argv[2]!;
const admission = join(parent, 'managed-agents');
let scratch: string;
try {
  terminalDirectory(parent, true);
  terminalDirectory(admission, true);
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'orqst-kernel-proof-')));
} catch {
  process.stdout.write(
    JSON.stringify({ kind: 'complete', ok: false, reason: 'unavailable', processes: [] }) + '\n',
  );
  process.exit(1);
}
const one = join(scratch, 'one');
const two = join(scratch, 'two');
// Snapshot expects distinct private existing directories.
import { mkdirSync } from 'node:fs';
mkdirSync(one, { mode: 0o700 });
mkdirSync(two, { mode: 0o700 });

const replySchema = z.strictObject({ kind: z.literal('reply'), id: z.uuid(), value: z.unknown() });
let pending: { id: string; resolve(value: unknown): void; reject(error: Error): void } | undefined;
let buffer = '';
let closed = false;
let live: { pid: number; startSec: number; startUsec: number; sid: number }[] = [];
function request(operation: string, input: object = {}) {
  if (closed || pending) return Promise.reject(new Error('Native recovery channel unavailable'));
  const id = randomUUID();
  return new Promise<unknown>((resolve, reject) => {
    pending = { id, resolve, reject };
    process.stdout.write(JSON.stringify({ kind: 'request', id, operation, ...input }) + '\n');
  });
}
function close() {
  closed = true;
  pending?.reject(new Error('Native recovery channel closed'));
  pending = undefined;
}
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk: string) => {
  buffer += chunk;
  if (buffer.length > 256 * 1024) return close();
  const end = buffer.indexOf('\n');
  if (end < 0) return;
  try {
    const reply = replySchema.parse(JSON.parse(buffer.slice(0, end)));
    buffer = buffer.slice(end + 1);
    if (buffer || !pending || reply.id !== pending.id) return close();
    const { resolve } = pending;
    pending = undefined;
    resolve(reply.value);
  } catch {
    close();
  }
});
process.stdin.on('end', close);
process.stdin.on('error', close);
process.stdout.on('error', close);

void releaseKernelReservation(admission, one, two, {
  mutationExecutor: async () => kernelProcessIdentitySchema.parse(await request('executor')),
  mutationOwnerExists: async (identity) => z.boolean().parse(await request('exists', { identity })),
  scan: async (identities, sessions) => {
    const value = await request('scan', { identities, sessions });
    const refusal = z
      .strictObject({
        reason: z.literal('live_processes'),
        processes: z
          .array(
            z.strictObject({
              pid: z.number().int().positive(),
              startSec: z.number().int().nonnegative(),
              startUsec: z.number().int().nonnegative(),
              sid: z.number().int().positive(),
            }),
          )
          .max(128),
      })
      .safeParse(value);
    if (refusal.success) {
      live = refusal.data.processes;
      throw new Error('Recorded session still has processes');
    }
    return z
      .strictObject({ processCount: z.number(), intervalMs: z.number(), scans: z.literal(2) })
      .parse(value);
  },
  review: async (intent) => z.boolean().parse(await request('review', { intent })),
  revalidate: async (intent) => z.boolean().parse(await request('revalidate', { intent })),
  rename: async (lock) => {
    if (!(await request('rename', { lock }))) throw new Error('Native marker rename unconfirmed');
  },
})
  .then(() => process.stdout.write(JSON.stringify({ kind: 'complete', ok: true }) + '\n'))
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : '';
    const reason = live.length
      ? 'live_processes'
      : message === 'Kernel release cancelled'
        ? 'cancelled'
        : message.includes('identity not recorded')
          ? 'missing_identity'
          : message.includes('mutation in progress')
            ? 'in_progress'
            : 'unavailable';
    process.stdout.write(
      JSON.stringify({ kind: 'complete', ok: false, reason, processes: live }) + '\n',
    );
  })
  .finally(() => {
    close();
    process.stdin.destroy();
    rmSync(scratch, { recursive: true, force: true });
  });
