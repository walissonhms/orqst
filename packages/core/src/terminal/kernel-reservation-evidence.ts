import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { terminalAttemptSchema } from '@orqst/protocol';
import { terminalDirectory } from './codex-profile.js';
import { readRecoveryFile } from './offline-recovery-files.js';
import {
  lifecycleBindingSchema,
  readLifecycleReceipt,
} from '../managed-codex/lifecycle-receipt.js';
import { readKernelLifecycleReceipt } from '../managed-codex/kernel-lifecycle-receipt.js';

const uuid = z.uuid();
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const preparedSchema = z.strictObject({
  type: z.literal('prepared'),
  version: z.literal(1),
  binding: lifecycleBindingSchema,
  at: z.number().int().nonnegative().safe(),
});
type Attempt = z.infer<typeof terminalAttemptSchema>;

/**
 * Inspect one already-bound state directory, including receipts for pruned journal rows.
 * The caller must independently bind the directory/config digest to the marker and journal.
 */
export function inspectKernelMember(
  state: string,
  owner: string,
  epoch: string,
  configDigest: string,
  attempts: readonly Attempt[],
) {
  uuid.parse(owner);
  uuid.parse(epoch);
  digest.parse(configDigest);
  terminalDirectory(state, true);
  const names = () => {
    const values = readdirSync(state)
      .filter((name) => name.startsWith('lifecycle-'))
      .sort();
    if (values.length > 256) throw new Error('Kernel lifecycle budget');
    return values;
  };
  const initial = names();
  const ids = new Set<string>();
  const kernels = new Set<string>();
  for (const name of initial) {
    const match = /^lifecycle-(kernel-)?([0-9a-f-]{36})\.jsonl$/.exec(name);
    if (!match || !uuid.safeParse(match[2]).success) throw new Error('Unknown lifecycle evidence');
    (match[1] ? kernels : ids).add(match[2]!);
  }
  if (ids.size !== kernels.size || [...ids].some((id) => !kernels.has(id)))
    throw new Error('Kernel process identity not recorded');
  const journal = z.array(terminalAttemptSchema).max(10_000).parse(attempts);
  for (const attempt of journal) {
    if (attempt.epoch !== epoch) throw new Error('Kernel journal owner changed');
    if (attempt.state !== 'prepared' && !ids.has(attempt.instanceId))
      throw new Error('Kernel journal identity missing');
  }
  if (!ids.size) return [];
  const evidence = [...ids].sort().map((instanceId) => {
    const oldFile = join(state, `lifecycle-${instanceId}.jsonl`);
    const kernelFile = join(state, `lifecycle-kernel-${instanceId}.jsonl`);
    const legacy = readRecoveryFile(oldFile, 4096);
    const kernel = readRecoveryFile(kernelFile, 4096);
    const first = Buffer.from(legacy.bytes, 'base64').toString('utf8').split('\n')[0]!;
    const header = preparedSchema.parse(JSON.parse(first));
    if (
      header.binding.instanceId !== instanceId ||
      header.binding.epoch !== epoch ||
      header.binding.configDigest !== configDigest
    )
      throw new Error('Kernel lifecycle binding changed');
    const observed = readLifecycleReceipt(state, header.binding);
    const identity = readKernelLifecycleReceipt(state, { ...header.binding, owner });
    if (
      observed.status === 'missing' ||
      observed.status === 'invalid' ||
      identity.status !== 'complete'
    )
      throw new Error('Kernel process identity not recorded');
    if (!observed.records?.some((record) => record.type === 'armed'))
      throw new Error('Kernel lifecycle not armed');
    const attempt = journal.find((item) => item.instanceId === instanceId);
    if (
      attempt &&
      (attempt.manifestDigest !== header.binding.manifestDigest || attempt.state === 'prepared')
    )
      throw new Error('Kernel lifecycle and journal contradict');
    if (
      JSON.stringify(readRecoveryFile(oldFile, 4096)) !== JSON.stringify(legacy) ||
      JSON.stringify(readRecoveryFile(kernelFile, 4096)) !== JSON.stringify(kernel)
    )
      throw new Error('Kernel lifecycle changed during inspection');
    return {
      instanceId,
      legacy,
      kernel,
      core: identity.core,
      host: identity.host,
      leader: identity.leader,
    };
  });
  if (JSON.stringify(names()) !== JSON.stringify(initial))
    throw new Error('Kernel lifecycle membership changed');
  const core = JSON.stringify(evidence[0]!.core);
  if (evidence.some((item) => JSON.stringify(item.core) !== core))
    throw new Error('Kernel producer changed');
  return evidence;
}
