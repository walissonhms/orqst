// Offline administrative comparison only. Never imported by runtime launch/claim validation.
import { lstatSync, realpathSync } from 'node:fs';
import { dirname, parse } from 'node:path';
import { z } from 'zod';
import { terminalDigest } from './authority.js';
import { terminalEnrollmentPreimage, type TerminalEnrollmentFile } from './enrollment-files.js';
import { offlineModelSourceMetadata } from './offline-historical-binding.js';
import type { OfflineReservationSnapshot } from './offline-recovery-files.js';

const device = z.string().regex(/^(0|[1-9][0-9]*)$/);
export const physicalDifferenceSchema = z.strictObject({
  kind: z.literal('administrative_device_difference'),
  historicalDevice: device,
  currentDevice: device,
  bindings: z
    .array(
      z.strictObject({
        slot: z.number().int().min(0).max(7),
        identities: z
          .array(
            z.strictObject({
              path: z.string().startsWith('/').max(2048),
              identity: z.array(z.string()).length(5).nullable(),
            }),
          )
          .min(5)
          .max(13),
      }),
    )
    .min(1)
    .max(8),
});
export type PhysicalDifference = z.infer<typeof physicalDifferenceSchema>;
export type DeviceDifference = Pick<PhysicalDifference, 'historicalDevice' | 'currentDevice'>;

/** A declared device substitution for a full historical preimage, never filesystem equivalence. */
export function historicalIdentity(identity: string | null, difference?: DeviceDifference) {
  if (!identity || !difference) return identity;
  const [device, inode] = identity.split(':');
  return `${device === difference.currentDevice ? difference.historicalDevice : device}:${inode}`;
}

/** Compare every byte/hash and all other physical fields BEFORE proposing administrative consent.
 * One uniform difference is supported. A mixed device layout requires a different reviewed contract.
 */
export function comparePhysicalFiles(
  saved: OfflineReservationSnapshot,
  read: (path: string) => OfflineReservationSnapshot['files'][number],
): DeviceDifference | undefined {
  if (read(saved.files[0]!.path).identity[0] === saved.files[0]!.identity[0]) return undefined;
  const pairs = new Set<string>();
  const paths = new Set<string>();
  for (const original of saved.files) {
    if (
      paths.has(original.path) ||
      terminalDigest(Buffer.from(original.bytes, 'base64')) !== original.sha256
    )
      throw new Error('Recovery historical file record changed');
    paths.add(original.path);
    const current = read(original.path);
    pairs.add(JSON.stringify([original.identity[0], current.identity[0]]));
    if (
      JSON.stringify({
        ...current,
        identity: [original.identity[0], ...current.identity.slice(1)],
      }) !== JSON.stringify(original)
    )
      throw new Error('Recovery physical comparison requires exact preserved files');
  }
  const changed = [...pairs]
    .map((pair) => JSON.parse(pair) as [string, string])
    .filter(([old, current]) => old !== current);
  if (!changed.length) return undefined;
  if (pairs.size !== 1 || changed.length !== 1)
    throw new Error('Recovery mixed physical device mapping');
  const [historicalDevice, currentDevice] = changed[0]!;
  return { historicalDevice, currentDevice };
}

/** Metadata only, using the existing root/current-owner and canonical/no-symlink policy.
 * Directories omit mutable size/times; model source content is never opened.
 */
export function offlineBindingMetadata(binding: TerminalEnrollmentFile) {
  const { config } = binding;
  const paths = [
    binding.file,
    config.state,
    config.project,
    config.executable.path,
    config.node.path,
  ];
  const identities = paths.map((path, index) => {
    const info = lstatSync(path, { bigint: true });
    if (
      realpathSync(path) !== path ||
      info.isSymbolicLink() ||
      info.mode & 0o022n ||
      (info.uid !== BigInt(process.getuid!()) && (index < 3 || info.uid !== 0n)) ||
      (index === 1 || index === 2 ? !info.isDirectory() : !info.isFile() || info.nlink !== 1n)
    )
      throw new Error('Untrusted offline enrollment metadata');
    let parent = dirname(path);
    while (parent !== parse(parent).root) {
      const ancestor = lstatSync(parent, { bigint: true });
      if (ancestor.isSymbolicLink() || (ancestor.mode & 0o022n && !(ancestor.mode & 0o1000n)))
        throw new Error('Untrusted offline enrollment ancestor');
      parent = dirname(parent);
    }
    return { path, identity: [info.dev, info.ino, info.mode, info.uid, info.nlink].map(String) };
  });
  return [
    ...identities,
    ...offlineModelSourceMetadata(config.model?.files.map(({ path }) => path) ?? []),
  ];
}

export function physicalBindingDigest(
  binding: TerminalEnrollmentFile,
  source: Buffer,
  difference: DeviceDifference,
) {
  const current = offlineModelSourceMetadata(
    binding.config.model?.files.map(({ path }) => path) ?? [],
  );
  return terminalDigest(
    terminalEnrollmentPreimage(
      binding.config,
      binding.identities.map((identity) => historicalIdentity(identity, difference)),
      source,
      current.map(({ path, identity }) => [
        path,
        historicalIdentity(identity ? `${identity[0]}:${identity[1]}` : null, difference),
      ]),
    ),
  );
}
