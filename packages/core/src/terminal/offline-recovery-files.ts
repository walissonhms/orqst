import {
  constants,
  closeSync,
  fsyncSync,
  fstatSync,
  lstatSync,
  openSync,
  opendirSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { z } from 'zod';
import { stableId } from '@orqst/shared';
import {
  committedTerminalImage,
  inspectOfflineTerminalImage,
  OFFLINE_JOURNAL_BYTES,
} from '@orqst/database';
import {
  terminalEnrollmentInputSchema,
  terminalEnrollmentMemberSchema,
  terminalEnrollmentReceiptSchema,
  terminalAttemptSchema,
} from '@orqst/protocol';
import { desktopAdmissionMarkerSchema } from '../managed-codex/desktop-admission-inspection.js';
export { RECOVERY_GATE } from '../managed-codex/offline-recovery-gate.js';
import { terminalDigest } from './authority.js';
import {
  assertSeparateTerminalState,
  managedCodexConfigSchema,
  terminalDirectory,
  terminalFile,
} from './codex-profile.js';
import { managedClaudeConfigSchema } from './interactive-profile.js';
import { managedOpenCodeConfigSchema } from './opencode-profile.js';
import { terminalEnrollmentFile } from './enrollment-files.js';
import {
  historicalBindingSnapshotSchema,
  historicalBindingLogical,
  offlineModelSourceMetadata,
  verifyHistoricalBinding,
  type HistoricalBindingEvidence,
  type HistoricalBindingSnapshot,
} from './offline-historical-binding.js';

import {
  comparePhysicalFiles,
  historicalIdentity,
  offlineBindingMetadata,
  physicalBindingDigest,
  physicalDifferenceSchema,
  type PhysicalDifference,
} from './offline-physical-binding.js';

export const RECOVERY_LIMIT = 64 * 1024 * 1024;

/** A frozen enrollment cannot be rebound to today's source identities. No private detail. */
export class OfflineEnrollmentBindingChanged extends Error {
  readonly stage = 'inspection';
  readonly code = 'enrollment_binding_changed';
  constructor() {
    super('Recovery manifest enrollment binding');
  }
}

function directoryNames(directory: string) {
  terminalDirectory(directory, true);
  const handle = opendirSync(directory);
  const names: string[] = [];
  try {
    for (let entry = handle.readSync(); entry !== null; entry = handle.readSync()) {
      names.push(entry.name);
      if (names.length > 256) throw new Error('Recovery directory entry budget');
    }
  } finally {
    handle.closeSync();
  }
  return names.sort();
}
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const fileRecordSchema = z.strictObject({
  path: z.string().startsWith('/').max(2048),
  identity: z.array(z.string()).length(7),
  sha256: digest,
  bytes: z.string().max(RECOVERY_LIMIT),
});
export const offlineSnapshotSchema = z.strictObject({
  version: z.literal(1),
  files: z.array(fileRecordSchema).min(3).max(48),
  journals: z
    .array(
      z.strictObject({
        path: z.string().startsWith('/').max(2048),
        slot: z.number().int().min(0).max(7),
        terminalId: z.uuid(),
        bindingDigest: digest,
        databaseIdentity: z.array(z.string()).length(4),
        stateNames: z.array(z.string()).max(256),
        shmIdentity: z.array(z.string()).length(7).nullable(),
        logical: z.strictObject({
          schemaVersion: z.literal(2),
          epoch: z.uuid(),
          definitions: z
            .array(z.record(z.string(), z.union([z.string(), z.number(), z.null()])))
            .max(16),
          attempts: z.array(terminalAttemptSchema).max(10_000),
        }),
      }),
    )
    .min(1)
    .max(8),
  membership: z.array(z.string()).max(256),
  historicalBinding: historicalBindingSnapshotSchema.optional(),
  physicalDifference: physicalDifferenceSchema.optional(),
  logicalDigest: digest,
  rawDigest: digest,
});

/** After marker rename, all other raw sources must still match the signed post-fence snapshot. */
export function assertHeldRecoverySnapshot(directory: string, value: unknown) {
  const snapshot = offlineSnapshotSchema.parse(value);
  if (
    terminalDigest(
      JSON.stringify({
        files: snapshot.files,
        journals: snapshot.journals,
        membership: snapshot.membership,
        ...(snapshot.historicalBinding ? { historicalBinding: snapshot.historicalBinding } : {}),
        ...(snapshot.physicalDifference ? { physicalDifference: snapshot.physicalDifference } : {}),
      }),
    ) !== snapshot.rawDigest
  )
    throw new Error('Recovery archived snapshot digest changed');
  if (
    snapshot.historicalBinding &&
    JSON.stringify(
      offlineModelSourceMetadata(
        snapshot.historicalBinding.currentSources.map((source) => source.path),
      ),
    ) !== JSON.stringify(snapshot.historicalBinding.currentSources)
  )
    throw new Error('Recovery held model source metadata changed');
  for (const file of snapshot.files) {
    if (file.path === join(directory, 'active-pair.json')) continue;
    if (JSON.stringify(readRecoveryFile(file.path, OFFLINE_JOURNAL_BYTES)) !== JSON.stringify(file))
      throw new Error('Recovery held source changed');
  }
  if (
    JSON.stringify(
      directoryNames(directory)
        .filter((name) => name.startsWith('enrollment-'))
        .sort(),
    ) !== JSON.stringify(snapshot.membership)
  )
    throw new Error('Recovery held enrollment changed');
  for (const journal of snapshot.journals) {
    if (
      JSON.stringify(directoryNames(dirname(journal.path))) !== JSON.stringify(journal.stateNames)
    )
      throw new Error('Recovery held journal directory changed');
    if (
      journal.shmIdentity &&
      JSON.stringify(recoveryIdentity(`${journal.path}-shm`)) !==
        JSON.stringify(journal.shmIdentity)
    )
      throw new Error('Recovery held SHM changed');
  }
  return snapshot;
}

export function syncRecoveryDirectory(directory: string, sync = fsyncSync) {
  terminalDirectory(directory, true);
  const fd = openSync(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    sync(fd);
  } finally {
    closeSync(fd);
  }
}

/** Same durability ordering as Desktop admission; failed exclusive writes are retained. */
export function writeRecoveryFile(file: string, bytes: string | Buffer, sync = fsyncSync) {
  terminalDirectory(dirname(file), true);
  if (Buffer.byteLength(bytes) > RECOVERY_LIMIT) throw new Error('Recovery write budget');
  const fd = openSync(
    file,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    writeFileSync(fd, bytes);
    sync(fd);
  } finally {
    closeSync(fd);
  }
  syncRecoveryDirectory(dirname(file), sync);
}

/** Re-establish durability after an interrupted write; readable complete bytes alone are insufficient. */
export function syncRecoveryFile(file: string, sync = fsyncSync) {
  const before = readRecoveryFile(file, RECOVERY_LIMIT);
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = fstatSync(fd, { bigint: true });
    if (String(info.dev) !== before.identity[0] || String(info.ino) !== before.identity[1])
      throw new Error('Recovery file changed before durability confirmation');
    sync(fd);
  } finally {
    closeSync(fd);
  }
  if (JSON.stringify(readRecoveryFile(file, RECOVERY_LIMIT)) !== JSON.stringify(before))
    throw new Error('Recovery file changed during durability confirmation');
  syncRecoveryDirectory(dirname(file), sync);
}

export function recoveryIdentity(file: string) {
  const info = lstatSync(file, { bigint: true });
  if (
    !info.isFile() ||
    info.nlink !== 1n ||
    info.uid !== BigInt(process.getuid!()) ||
    info.mode & 0o077n
  )
    throw new Error('Untrusted recovery file');
  return [info.dev, info.ino, info.size, info.mode, info.uid, info.mtimeNs, info.ctimeNs].map(
    String,
  );
}

export function readRecoveryFile(file: string, limit = 16 * 1024) {
  terminalDirectory(dirname(file), true);
  const before = recoveryIdentity(file);
  const bytes = terminalFile(file, true, limit, {
    dev: BigInt(before[0]!),
    ino: BigInt(before[1]!),
  });
  if (JSON.stringify(before) !== JSON.stringify(recoveryIdentity(file)))
    throw new Error('Recovery source changed during read');
  return {
    path: file,
    identity: before,
    sha256: terminalDigest(bytes),
    bytes: bytes.toString('base64'),
  };
}

function json(record: ReturnType<typeof readRecoveryFile>) {
  return JSON.parse(Buffer.from(record.bytes, 'base64').toString('utf8')) as unknown;
}
const intentSchema = z.strictObject({
  version: z.literal(1),
  owner: z.uuid(),
  input: terminalEnrollmentInputSchema,
  manifestFile: z.string().startsWith('/').max(2048),
  member: terminalEnrollmentMemberSchema,
});
const receiptSchema = z.strictObject({
  version: z.literal(1),
  owner: z.uuid(),
  receipt: terminalEnrollmentReceiptSchema,
});

/** No Store, live SQLite connection, provider file, executable or auth configuration is opened. */
export function snapshotOfflineReservation(
  directory: string,
  scratch: string,
  historical?: {
    evidence: HistoricalBindingEvidence;
    sha256: string;
    record: ReturnType<typeof readRecoveryFile>;
  },
  signedHistorical?: OfflineReservationSnapshot,
) {
  terminalDirectory(directory, true);
  terminalDirectory(scratch, true);
  if (directory === scratch) throw new Error('Recovery scratch overlaps source');
  const names = () => {
    const entries = directoryNames(directory)
      .filter((name) => name.startsWith('enrollment-'))
      .sort();
    if (entries.length > 256) throw new Error('Recovery enrollment budget');
    return entries;
  };
  const difference = signedHistorical
    ? comparePhysicalFiles(signedHistorical, (path) =>
        readRecoveryFile(path, OFFLINE_JOURNAL_BYTES),
      )
    : undefined;
  const physicalDifference: PhysicalDifference | undefined = difference
    ? { kind: 'administrative_device_difference', ...difference, bindings: [] }
    : undefined;
  let capturedBytes = 0;
  const take = (file: string, limit = 16 * 1024) => {
    const record = readRecoveryFile(file, Math.min(limit, RECOVERY_LIMIT - capturedBytes));
    capturedBytes += Buffer.from(record.bytes, 'base64').length;
    return record;
  };
  const membership = names();
  const files = [take(join(directory, 'active-pair.json'))];
  const marker = desktopAdmissionMarkerSchema.parse(json(files[0]!));
  if (historical) files.push(historical.record);
  if (!marker.manifests.length || new Set(marker.manifests).size !== marker.manifests.length)
    throw new Error('Recovery initial manifests incomplete');
  if (directoryNames(directory).some((name) => name.startsWith(`retired-${marker.owner}-`)))
    throw new Error('Recovery prior archive effect uncertain');
  const enrollmentFiles = membership.filter((name) =>
    name.startsWith(`enrollment-${marker.owner}-`),
  );
  const intents = enrollmentFiles
    .filter((name) => !name.endsWith('.receipt.json'))
    .map((name) => {
      const source = take(join(directory, name));
      files.push(source);
      const intent = intentSchema.parse(json(source));
      if (
        intent.owner !== marker.owner ||
        name !== `enrollment-${marker.owner}-${intent.input.opId}.json`
      )
        throw new Error('Recovery enrollment owner/name');
      const resultName = name.replace(/\.json$/, '.receipt.json');
      if (!enrollmentFiles.includes(resultName)) throw new Error('Recovery enrollment incomplete');
      const receiptFile = take(join(directory, resultName));
      files.push(receiptFile);
      const result = receiptSchema.parse(json(receiptFile));
      const receipt = result.receipt;
      if (result.owner !== marker.owner || receipt.status !== 'ready')
        throw new Error('Recovery enrollment uncertain');
      // Input/member comparisons are structural; the immutable intent remains historically uncertain.
      for (const field of Object.keys(intent.input) as Array<keyof typeof intent.input>)
        if (intent.input[field] !== receipt[field]) throw new Error('Recovery enrollment binding');
      if (JSON.stringify({ ...intent.member, status: 'ready' }) !== JSON.stringify(receipt.member))
        throw new Error('Recovery enrollment member changed');
      return intent;
    })
    .sort((a, b) => a.member.admissionRevision - b.member.admissionRevision);
  if (enrollmentFiles.length !== intents.length * 2)
    throw new Error('Recovery orphan enrollment receipt');
  const paths = [...marker.manifests];
  for (const [index, intent] of intents.entries()) {
    if (
      intent.input.expectedRevision !== index ||
      intent.member.admissionRevision !== index + 1 ||
      intent.member.slot !== marker.manifests.length + index ||
      intent.member.status !== 'uncertain'
    )
      throw new Error('Recovery enrollment revision/slot gap');
    paths.push(intent.manifestFile);
  }
  if (paths.length > 8 || new Set(paths).size !== paths.length)
    throw new Error('Recovery member budget/duplicate');
  const seenStates = new Set<string>();
  const seenTerminals = new Set<string>();
  let selectedProject: string | undefined;
  let historicalBinding: HistoricalBindingSnapshot | undefined;
  const bindings: ReturnType<typeof terminalEnrollmentFile>[] = [];
  const journals = paths.map((path, slot) => {
    const manifest = take(path);
    files.push(manifest);
    const raw = json(manifest);
    const config = z
      .union([managedCodexConfigSchema, managedClaudeConfigSchema, managedOpenCodeConfigSchema])
      .parse(raw);
    terminalDirectory(config.project);
    assertSeparateTerminalState(config.project, config.state);
    if (selectedProject && config.project !== selectedProject)
      throw new Error('Recovery mixed selection workspace');
    selectedProject = config.project;
    if (
      !config.identity ||
      seenStates.has(config.state) ||
      seenTerminals.has(config.identity.terminalId)
    )
      throw new Error('Recovery ambiguous member');
    seenStates.add(config.state);
    seenTerminals.add(config.identity.terminalId);
    terminalDirectory(config.state, true);
    for (const selected of [...seenStates].filter((state) => state !== config.state))
      for (const inside of [relative(selected, config.state), relative(config.state, selected)])
        if (inside === '' || (inside !== '..' && !inside.startsWith('../')))
          throw new Error('Recovery overlapping member state');
    for (const source of [directory, config.state]) {
      const inside = relative(source, scratch);
      if (inside === '' || (inside !== '..' && !inside.startsWith('../')))
        throw new Error('Recovery scratch overlaps source');
    }
    const stateNames = directoryNames(config.state);
    if (
      stateNames.some((name) => name.startsWith('lifecycle-') || name === 'terminal.sqlite-journal')
    )
      throw new Error('Recovery lifecycle/rollback uncertainty');
    const binding = terminalEnrollmentFile(path, config);
    bindings[slot] = binding;
    const intent = intents.find((entry) => entry.member.slot === slot);
    if (physicalDifference)
      physicalDifference.bindings.push({ slot, identities: offlineBindingMetadata(binding) });
    let bindingDigest = difference
      ? physicalBindingDigest(binding, Buffer.from(manifest.bytes, 'base64'), difference)
      : binding.bindingDigest;
    if (historical && historical.evidence.member.slot === slot) {
      const evidence = historical.evidence;
      const intentSource = files.find(
        (source) =>
          source.path ===
          join(directory, `enrollment-${marker.owner}-${evidence.enrollment.opId}.json`),
      );
      const receiptSource = files.find(
        (source) =>
          source.path ===
          join(directory, `enrollment-${marker.owner}-${evidence.enrollment.opId}.receipt.json`),
      );
      if (
        !intent ||
        evidence.marker.owner !== marker.owner ||
        evidence.marker.sha256 !== files[0]!.sha256 ||
        evidence.enrollment.opId !== intent.input.opId ||
        evidence.enrollment.epoch !== intent.input.epoch ||
        evidence.enrollment.intentSha256 !== intentSource?.sha256 ||
        evidence.enrollment.receiptSha256 !== receiptSource?.sha256 ||
        evidence.member.terminalId !== config.identity.terminalId ||
        evidence.member.manifestSha256 !== manifest.sha256 ||
        evidence.member.manifestIdentity !==
          historicalIdentity(`${manifest.identity[0]}:${manifest.identity[1]}`, difference) ||
        evidence.member.frozenBindingDigest !== intent.member.bindingDigest
      )
        throw new OfflineEnrollmentBindingChanged();
      const currentSources = offlineModelSourceMetadata(
        config.model?.files.map((file) => file.path) ?? [],
      );
      // A projected historical preimage cannot admit a source still on the old
      // device (or an arbitrary device). Require the declared current mapping first.
      if (
        difference &&
        currentSources.some((source, index) => {
          const original = evidence.modelSources[index]?.identity;
          if (!original || !source.identity) return false; // Full proof below checks presence.
          const device = original.split(':')[0]!;
          return (
            source.identity[0] !==
            (device === difference.historicalDevice ? difference.currentDevice : device)
          );
        })
      )
        throw new OfflineEnrollmentBindingChanged();
      const projectedSources = currentSources.map((source) => ({
        ...source,
        identity: source.identity
          ? [
              historicalIdentity(`${source.identity[0]}:${source.identity[1]}`, difference)!.split(
                ':',
              )[0]!,
              ...source.identity.slice(1),
            ]
          : null,
      }));
      try {
        verifyHistoricalBinding(
          evidence,
          binding,
          projectedSources,
          binding.identities.map((identity) => historicalIdentity(identity, difference)),
        );
      } catch (error) {
        if (difference) throw new OfflineEnrollmentBindingChanged();
        throw error;
      }
      // The selected CURRENT inode is reviewed afresh per phase. The complete signed
      // historical preimage above still permits exactly one same-device source delta.
      historicalBinding = { evidenceSha256: historical.sha256, evidence, currentSources };
      bindingDigest = evidence.member.frozenBindingDigest;
    }
    if (difference && signedHistorical?.journals[slot]?.bindingDigest !== bindingDigest)
      throw new OfflineEnrollmentBindingChanged();
    if (intent && intent.member.bindingDigest !== bindingDigest)
      throw new OfflineEnrollmentBindingChanged();
    if (
      intent &&
      (intent.member.terminalId !== config.identity.terminalId ||
        intent.member.provider !== (config.version === 1 ? 'codex' : config.provider) ||
        intent.member.workspaceId !== stableId('workspace', config.project) ||
        intent.member.workspaceId !== config.preparation?.workspaceId ||
        intent.member.featureId !== config.preparation?.featureId ||
        intent.member.requestedModel !== config.model?.value)
    )
      throw new Error('Recovery manifest enrollment binding');
    const base = take(join(config.state, 'terminal.sqlite'), OFFLINE_JOURNAL_BYTES);
    let wal: ReturnType<typeof take> | null;
    try {
      wal = take(`${base.path}-wal`, OFFLINE_JOURNAL_BYTES);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      wal = null;
    }
    const shmPath = `${base.path}-shm`;
    const shmIdentity = stateNames.includes('terminal.sqlite-shm')
      ? recoveryIdentity(shmPath)
      : null;
    files.push(base);
    if (wal) files.push(wal);
    const image = committedTerminalImage(
      Buffer.from(base.bytes, 'base64'),
      wal ? Buffer.from(wal.bytes, 'base64') : null,
    );
    const derived = join(scratch, `derived-${slot}.sqlite`);
    writeRecoveryFile(derived, image);
    const logical = inspectOfflineTerminalImage(derived);
    if (
      (marker.epoch && marker.epoch !== logical.epoch) ||
      intents.some((entry) => entry.input.epoch !== logical.epoch) ||
      logical.attempts.some((attempt) => attempt.projectId !== terminalDigest(config.project))
    )
      throw new Error('Recovery journal epoch/project mismatch');
    return {
      path: base.path,
      slot,
      terminalId: config.identity.terminalId,
      bindingDigest,
      databaseIdentity: [
        base.identity[0]!,
        base.identity[1]!,
        base.identity[3]!,
        base.identity[4]!,
      ],
      stateNames,
      shmIdentity,
      logical,
    };
  });
  if (historical && !historicalBinding) throw new OfflineEnrollmentBindingChanged();
  if (new Set(journals.map((journal) => journal.logical.epoch)).size !== 1)
    throw new Error('Recovery mixed journal owners');
  for (const file of files) {
    if (JSON.stringify(readRecoveryFile(file.path, OFFLINE_JOURNAL_BYTES)) !== JSON.stringify(file))
      throw new Error('Recovery source changed after inspection');
  }
  if (JSON.stringify(membership) !== JSON.stringify(names()))
    throw new Error('Recovery enrollment race');
  for (const journal of journals) {
    if (
      JSON.stringify(directoryNames(dirname(journal.path))) !== JSON.stringify(journal.stateNames)
    )
      throw new Error('Recovery journal directory changed');
    if (
      journal.shmIdentity &&
      JSON.stringify(recoveryIdentity(`${journal.path}-shm`)) !==
        JSON.stringify(journal.shmIdentity)
    )
      throw new Error('Recovery SHM metadata changed');
  }
  if (
    historicalBinding &&
    JSON.stringify(
      offlineModelSourceMetadata(historicalBinding.currentSources.map((source) => source.path)),
    ) !== JSON.stringify(historicalBinding.currentSources)
  )
    throw new Error('Recovery model source metadata changed');
  // Raw journal/WAL bytes and file metadata are captured separately from checkpoint-stable facts.
  const historicalFile = (file: ReturnType<typeof readRecoveryFile>) =>
    difference
      ? { ...file, identity: [difference.historicalDevice, ...file.identity.slice(1)] }
      : file;
  const logical = {
    ...(historicalBinding
      ? { historicalBinding: historicalBindingLogical(historicalBinding) }
      : {}),
    marker,
    membership,
    immutable: files
      .filter(
        (file) =>
          !journals.some(
            (journal) => file.path === journal.path || file.path === `${journal.path}-wal`,
          ),
      )
      .map(historicalFile),
    journals: journals.map((journal) => ({
      path: journal.path,
      slot: journal.slot,
      terminalId: journal.terminalId,
      bindingDigest: journal.bindingDigest,
      databaseIdentity: difference
        ? [difference.historicalDevice, ...journal.databaseIdentity.slice(1)]
        : journal.databaseIdentity,
      logical: journal.logical,
    })),
  };
  if (physicalDifference) {
    for (const entry of physicalDifference.bindings) {
      if (
        JSON.stringify(offlineBindingMetadata(bindings[entry.slot]!)) !==
        JSON.stringify(entry.identities)
      )
        throw new Error('Recovery enrollment metadata changed during inspection');
    }
    if (terminalDigest(JSON.stringify(logical)) !== signedHistorical!.logicalDigest)
      throw new Error('Recovery historical logical projection changed');
  }
  return offlineSnapshotSchema.parse({
    version: 1 as const,
    files,
    journals,
    membership,
    ...(historicalBinding ? { historicalBinding } : {}),
    ...(physicalDifference ? { physicalDifference } : {}),
    logicalDigest: terminalDigest(JSON.stringify(logical)),
    rawDigest: terminalDigest(
      JSON.stringify({
        files,
        journals,
        membership,
        ...(historicalBinding ? { historicalBinding } : {}),
        ...(physicalDifference ? { physicalDifference } : {}),
      }),
    ),
  });
}
export type OfflineReservationSnapshot = z.infer<typeof offlineSnapshotSchema>;
