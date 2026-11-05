// Offline administrative evidence only. Never imported by launch/enrollment/claim validators.
import { lstatSync, realpathSync } from 'node:fs';
import { z } from 'zod';
import { dirname, resolve } from 'node:path';
import { terminalDirectory, terminalFile } from './codex-profile.js';
import { terminalDigest } from './authority.js';
import { terminalEnrollmentPreimage, type TerminalEnrollmentFile } from './enrollment-files.js';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const path = z
  .string()
  .startsWith('/')
  .max(2048)
  .refine((value) => !value.includes('\0'));
const identity = z.string().regex(/^(0|[1-9][0-9]*):(0|[1-9][0-9]*)$/);
export const historicalBindingEvidenceSchema = z.strictObject({
  kind: z.literal('orqst.offline-recovery.historical-binding-evidence'),
  version: z.literal(1),
  marker: z.strictObject({ owner: z.uuid(), sha256: hash }),
  enrollment: z.strictObject({
    opId: z.uuid(),
    epoch: z.uuid(),
    intentSha256: hash,
    receiptSha256: hash,
  }),
  member: z.strictObject({
    slot: z.number().int().min(0).max(7),
    terminalId: z.uuid(),
    manifestSha256: hash,
    manifestIdentity: identity,
    frozenBindingDigest: hash,
  }),
  historicalModelSource: z.strictObject({ index: z.number().int().min(0).max(7), path, identity }),
  modelSources: z
    .array(z.strictObject({ path, identity: identity.nullable() }))
    .min(1)
    .max(8),
});
export type HistoricalBindingEvidence = z.infer<typeof historicalBindingEvidenceSchema>;
export const historicalBindingSnapshotSchema = z.strictObject({
  evidenceSha256: hash,
  evidence: historicalBindingEvidenceSchema,
  currentSources: z
    .array(z.strictObject({ path, identity: z.array(z.string()).length(5).nullable() }))
    .min(1)
    .max(8),
});
export type HistoricalBindingSnapshot = z.infer<typeof historicalBindingSnapshotSchema>;

/** Metadata only: never open model source bytes, auth files or sessions. */
export function offlineModelSourceMetadata(paths: readonly string[]) {
  return paths.map((path) => {
    if (resolve(path) !== path) throw new Error('Noncanonical offline model source');
    let parent = dirname(path);
    for (;;) {
      try {
        if (lstatSync(parent).isSymbolicLink())
          throw new Error('Offline model source ancestor is a symlink');
        terminalDirectory(parent);
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || parent === '/') throw error;
        parent = dirname(parent);
      }
    }
    let info;
    try {
      info = lstatSync(path, { bigint: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      return { path, identity: null };
    }
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      info.nlink !== 1n ||
      info.uid !== BigInt(process.getuid!()) ||
      info.mode & 0o022n ||
      realpathSync(path) !== path
    )
      throw new Error('Untrusted offline model source metadata');
    return {
      path,
      // Current critical metadata only. Unread content/size/times are not evidence.
      identity: [info.dev, info.ino, info.mode, info.uid, info.nlink].map(String),
    };
  });
}

/** Same serializer and complete frozen preimage; a candidate inode is never authority. */
export function verifyHistoricalBinding(
  evidence: HistoricalBindingEvidence,
  binding: TerminalEnrollmentFile,
  currentSources: ReturnType<typeof offlineModelSourceMetadata>,
  historicalIdentities = binding.identities,
) {
  evidence = historicalBindingEvidenceSchema.parse(evidence);
  const selected = evidence.historicalModelSource;
  const frozen = evidence.member.frozenBindingDigest;
  if (
    binding.bindingDigest === frozen ||
    binding.config.model?.files.length !== evidence.modelSources.length ||
    currentSources.length !== evidence.modelSources.length
  )
    throw new Error('Historical binding evidence is redundant or incomplete');
  const modelSources = evidence.modelSources.map((source, index): [string, string | null] => {
    const current = currentSources[index]!;
    const currentIdentity = current.identity
      ? `${current.identity[0]}:${current.identity[1]}`
      : null;
    if (source.path !== binding.config.model!.files[index]!.path || source.path !== current.path)
      throw new Error('Historical binding model source path changed');
    if (index === selected.index) {
      if (
        source.path !== selected.path ||
        source.identity !== selected.identity ||
        !currentIdentity ||
        currentIdentity === selected.identity ||
        current.identity![0] !== selected.identity.split(':')[0]
      )
        throw new Error('Historical binding requires exactly one inode on the same device');
    } else if (source.identity !== currentIdentity)
      throw new Error('Historical binding additional source drift');
    return [source.path, source.identity];
  });
  if (
    selected.index >= modelSources.length ||
    terminalDigest(
      terminalEnrollmentPreimage(
        binding.config,
        historicalIdentities,
        terminalFile(binding.file, true),
        modelSources,
      ),
    ) !== frozen
  )
    throw new Error('Historical enrollment preimage does not match');
}

/** Stable logical projection contains historical facts only; fresh metadata belongs in RAW. */
export function historicalBindingLogical(snapshot: HistoricalBindingSnapshot) {
  return { evidenceSha256: snapshot.evidenceSha256, evidence: snapshot.evidence };
}
