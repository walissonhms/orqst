import { execFileSync } from 'node:child_process';
import { randomUUID, verify, type KeyObject } from 'node:crypto';
import { fsyncSync, lstatSync, mkdirSync, mkdtempSync, renameSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { terminalDigest } from './authority.js';
import { terminalDirectory } from './codex-profile.js';
import {
  readRecoveryFile,
  RECOVERY_GATE,
  RECOVERY_LIMIT,
  snapshotOfflineReservation,
  syncRecoveryDirectory,
  syncRecoveryFile,
  writeRecoveryFile,
  offlineSnapshotSchema,
  type OfflineReservationSnapshot,
} from './offline-recovery-files.js';

/** No renderer override, wall-clock fallback, PID probe or userspace-restart inference. */
export function nativeKernelBootUUID(): string {
  if (process.platform !== 'darwin') throw new Error('Offline kernel fence requires macOS');
  const value = execFileSync('/usr/sbin/sysctl', ['-n', 'kern.bootsessionuuid'], {
    encoding: 'utf8',
    timeout: 2000,
    maxBuffer: 128,
    env: {},
    stdio: ['ignore', 'pipe', 'ignore'],
  })
    .trim()
    .toLowerCase();
  return z.uuid().parse(value);
}

export interface AdministrativeRecoveryChallenge {
  domain: 'orqst.administrative-recovery';
  version: 1;
  operationId: string;
  phase: 'capture' | 'release' | 'finalize' | 'abort';
  nonce: string;
  expiresAt: number;
  owner: string;
  epoch: string;
  beforeBoot: string;
  currentBoot: string;
  snapshotDigest: string;
  currentDigest: string;
  directory: string;
  bundle: string;
}
export function administrativeRecoveryBytes(challenge: AdministrativeRecoveryChallenge): Buffer {
  // Fixed tuple/order and independent domain; no TerminalAuthority runtime proof is accepted.
  return Buffer.from(
    JSON.stringify([
      challenge.domain,
      challenge.version,
      challenge.operationId,
      challenge.phase,
      challenge.nonce,
      challenge.expiresAt,
      challenge.owner,
      challenge.epoch,
      challenge.beforeBoot,
      challenge.currentBoot,
      challenge.snapshotDigest,
      challenge.currentDigest,
      challenge.directory,
      challenge.bundle,
    ]),
  );
}

export interface NativeAdministrativeRecovery {
  /** Trusted native administrative trust anchor, independently persisted across boots. */
  readonly publicKey: KeyObject;
  /** Native full review, Cancel by default. Returns signature only after explicit approval. */
  review(
    challenge: Readonly<AdministrativeRecoveryChallenge>,
    fullReview: string,
  ): Promise<string | null>;
}
interface RecoveryDependencies {
  // This injection is for fixtures/native composition, never an IPC request field.
  bootUUID(): string;
  now(): number;
  sync(fd: number): void;
  /** Test fault injection at durability boundaries. Production composition omits it. */
  boundary?(
    stage:
      | 'gate'
      | 'capture'
      | 'archive'
      | 'before_marker'
      | 'after_marker'
      | 'receipt'
      | 'commit_prepared'
      | 'commit_receipt'
      | 'after_lock'
      | 'after_gate',
  ): void;
}
const captureSchema = z.strictObject({
  version: z.literal(1),
  operationId: z.uuid(),
  snapshotHash: z.string().regex(/^[a-f0-9]{64}$/),
  challenge: z.strictObject({
    domain: z.literal('orqst.administrative-recovery'),
    version: z.literal(1),
    operationId: z.uuid(),
    phase: z.literal('capture'),
    nonce: z.uuid(),
    expiresAt: z.number().finite(),
    owner: z.uuid(),
    epoch: z.uuid(),
    beforeBoot: z.uuid(),
    currentBoot: z.uuid(),
    snapshotDigest: z.string().regex(/^[a-f0-9]{64}$/),
    currentDigest: z.string().regex(/^[a-f0-9]{64}$/),
    directory: z.string().startsWith('/'),
    bundle: z.string().startsWith('/'),
  }),
  signature: z.string().regex(/^[A-Za-z0-9_-]{86}$/),
});
function sourceJSON(file: string, limit?: number): unknown {
  return JSON.parse(Buffer.from(readRecoveryFile(file, limit).bytes, 'base64').toString('utf8'));
}
function exact(file: string, value: unknown) {
  if (JSON.stringify(sourceJSON(file, RECOVERY_LIMIT)) !== JSON.stringify(value))
    throw new Error('Recovery durable record changed');
}

/** Offline only. No Core, Store, journal owner acquisition, provider or automatic retry. */
export class OfflineRecoveryBlocked extends Error {
  constructor(
    readonly reason: string,
    readonly bundle: string,
  ) {
    super(`Offline recovery blocked: ${reason}; preserve bundle ${bundle}`);
  }
}

export class OfflineReservationRecovery {
  private used = new Set<string>();
  // Only a returned invocation in this exact helper may continue its own boot lease.
  private leases = new Map<string, { bytes: string; identity: string[]; active: boolean }>();
  private dependencies: RecoveryDependencies;
  constructor(
    private readonly authority: NativeAdministrativeRecovery,
    dependencies: Partial<RecoveryDependencies> = {},
  ) {
    if (
      authority.publicKey.type !== 'public' ||
      authority.publicKey.asymmetricKeyType !== 'ed25519'
    )
      throw new Error('Administrative Ed25519 trust anchor required');
    this.dependencies = {
      bootUUID: nativeKernelBootUUID,
      now: () => performance.now(),
      sync: fsyncSync,
      ...dependencies,
    };
  }
  private boot() {
    return z.uuid().parse(this.dependencies.bootUUID());
  }
  private write(file: string, bytes: string) {
    writeRecoveryFile(file, bytes, this.dependencies.sync);
  }
  private syncFile(file: string) {
    syncRecoveryFile(file, this.dependencies.sync);
  }
  private sync(directory: string) {
    syncRecoveryDirectory(directory, this.dependencies.sync);
  }
  private snapshot(directory: string, bundle: string) {
    const scratch = mkdtempSync(join(bundle, 'inspection-'));
    return snapshotOfflineReservation(directory, scratch);
  }
  private async approve(
    challenge: AdministrativeRecoveryChallenge,
    snapshot: OfflineReservationSnapshot,
    transaction?: Record<string, unknown>,
  ) {
    const fullReview = JSON.stringify(
      {
        action:
          challenge.phase === 'abort'
            ? 'Abort administrative recovery controls only; preserve the original reservation and every journal; no release or launch'
            : challenge.phase === 'finalize'
              ? 'Explicitly finalize verified administrative recovery; no launch or old process exit claim'
              : challenge.phase === 'capture'
                ? 'Capture privately before a kernel reboot; retain admission'
                : 'Prepare durable administrative evidence after external kernel fence; retain the original reservation until separate final commit approval; no process exit claim',
        challenge,
        transaction: transaction ?? null,
        files: snapshot.files.map((file) => ({
          path: file.path,
          identity: file.identity,
          sha256: file.sha256,
        })),
        metadataRecords: snapshot.files
          .filter(
            (file) =>
              !snapshot.journals.some(
                (journal) => file.path === journal.path || file.path === `${journal.path}-wal`,
              ),
          )
          .map((file) => ({
            path: file.path,
            record: JSON.parse(Buffer.from(file.bytes, 'base64').toString('utf8')) as unknown,
          })),
        membership: snapshot.membership,
        journals: snapshot.journals,
      },
      null,
      2,
    );
    if (Buffer.byteLength(fullReview) > 64 * 1024)
      throw new Error('Complete native recovery review exceeds budget');
    const signature = await this.authority.review(Object.freeze(challenge), fullReview);
    if (
      signature === null ||
      typeof signature !== 'string' ||
      !/^[A-Za-z0-9_-]{86}$/.test(signature) ||
      challenge.expiresAt <= this.dependencies.now() ||
      this.used.has(challenge.nonce) ||
      !verify(
        null,
        administrativeRecoveryBytes(challenge),
        this.authority.publicKey,
        Buffer.from(signature, 'base64url'),
      )
    )
      throw new Error('Administrative recovery approval denied/expired/consumed');
    this.used.add(challenge.nonce);
    return signature;
  }

  /** Trusted native paths only. Creates its own exclusive bundle and sticky gate. */
  async capture(directory: string, recoveryRoot: string) {
    terminalDirectory(directory, true);
    terminalDirectory(recoveryRoot, true);
    const operationId = randomUUID();
    const bundle = join(recoveryRoot, `offline-${operationId}`);
    mkdirSync(bundle, { mode: 0o700 });
    this.sync(recoveryRoot);
    const beforeBoot = this.boot();
    const snapshot = this.snapshot(directory, bundle);
    const bytes = JSON.stringify(snapshot);
    const marker = sourceJSON(join(directory, 'active-pair.json')) as { owner: string };
    const challenge: AdministrativeRecoveryChallenge = {
      domain: 'orqst.administrative-recovery',
      version: 1,
      operationId,
      phase: 'capture',
      nonce: randomUUID(),
      expiresAt: this.dependencies.now() + 30_000,
      owner: marker.owner,
      epoch: snapshot.journals[0]!.logical.epoch,
      beforeBoot,
      currentBoot: beforeBoot,
      snapshotDigest: terminalDigest(bytes),
      currentDigest: snapshot.logicalDigest,
      directory,
      bundle,
    };
    const signature = await this.approve(challenge, snapshot);
    const gate = {
      version: 1,
      operationId,
      owner: challenge.owner,
      epoch: challenge.epoch,
      bundle,
      beforeBoot,
    };
    // Publish no admission control until the signed recovery material is durable.
    // An interrupted/partial bundle before this point leaves only the original reservation.
    if (
      this.boot() !== beforeBoot ||
      this.snapshot(directory, bundle).rawDigest !== snapshot.rawDigest
    )
      throw new OfflineRecoveryBlocked('capture_source_changed', bundle);
    this.write(join(bundle, 'snapshot.json'), bytes);
    const capture = {
      version: 1 as const,
      operationId,
      snapshotHash: terminalDigest(bytes),
      challenge,
      signature,
    };
    this.write(join(bundle, 'capture.json'), JSON.stringify(capture));
    this.dependencies.boundary?.('capture');
    this.write(join(directory, RECOVERY_GATE), JSON.stringify(gate));
    this.dependencies.boundary?.('gate');
    exact(join(directory, RECOVERY_GATE), gate);
    if (
      this.boot() !== beforeBoot ||
      this.snapshot(directory, bundle).rawDigest !== snapshot.rawDigest
    )
      throw new OfflineRecoveryBlocked('capture_source_changed', bundle);
    return {
      operationId,
      bundle,
      owner: challenge.owner,
      epoch: challenge.epoch,
      beforeBoot,
      snapshotDigest: challenge.snapshotDigest,
    };
  }

  private captureRecord(bundle: string, aborting = false) {
    if (!aborting && this.present(join(bundle, 'aborted.json')))
      throw new OfflineRecoveryBlocked('operation_aborted_original_reservation_preserved', bundle);
    terminalDirectory(bundle, true);
    let capture: z.infer<typeof captureSchema>;
    try {
      capture = captureSchema.parse(sourceJSON(join(bundle, 'capture.json')));
    } catch {
      throw new OfflineRecoveryBlocked('missing_or_partial_capture_preserve_original', bundle);
    }
    const before = capture.challenge;
    if (
      before.bundle !== bundle ||
      before.operationId !== capture.operationId ||
      before.currentBoot !== before.beforeBoot ||
      !verify(
        null,
        administrativeRecoveryBytes(before),
        this.authority.publicKey,
        Buffer.from(capture.signature, 'base64url'),
      )
    )
      throw new Error('Untrusted administrative capture');
    const saved = readRecoveryFile(join(bundle, 'snapshot.json'), RECOVERY_LIMIT);
    if (saved.sha256 !== capture.snapshotHash || capture.snapshotHash !== before.snapshotDigest)
      throw new Error('Recovery capture corrupted');
    const snapshot = JSON.parse(Buffer.from(saved.bytes, 'base64').toString('utf8')) as {
      rawDigest?: unknown;
      logicalDigest?: unknown;
    };
    if (typeof snapshot.rawDigest !== 'string' || snapshot.logicalDigest !== before.currentDigest)
      throw new Error('Recovery capture binding changed');
    return { capture, before };
  }

  private gate(capture: z.infer<typeof captureSchema>) {
    return {
      version: 1,
      operationId: capture.operationId,
      owner: capture.challenge.owner,
      epoch: capture.challenge.epoch,
      bundle: capture.challenge.bundle,
      beforeBoot: capture.challenge.beforeBoot,
    };
  }

  private present(file: string) {
    try {
      lstatSync(file);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      return false;
    }
  }

  /** Per-boot exclusion, never a stale-PID takeover or proof of approval.
   * A different kernel boot positively fences previous helpers. Same-boot crash
   * without this exact retained invocation remains uncertain, even if no PID exists.
   */
  private lease(bundle: string, boot: string, continuation: boolean, operationId: string) {
    const file = join(bundle, `operation-${boot}.lock`);
    const previous = this.leases.get(file);
    if (previous) {
      if (previous.active || !continuation)
        throw new OfflineRecoveryBlocked(
          'operation_busy_or_explicit_continuation_required',
          bundle,
        );
      const current = readRecoveryFile(file);
      if (
        current.bytes !== Buffer.from(previous.bytes).toString('base64') ||
        JSON.stringify(current.identity) !== JSON.stringify(previous.identity)
      )
        throw new OfflineRecoveryBlocked('operation_lease_changed', bundle);
      previous.active = true;
      return { file, value: previous };
    }
    if (this.present(file))
      throw new OfflineRecoveryBlocked('same_boot_helper_fence_required', bundle);
    const bytes = JSON.stringify({ version: 1, operationId, boot, nonce: randomUUID() });
    this.write(file, bytes);
    const value = { bytes, identity: readRecoveryFile(file).identity, active: true };
    this.leases.set(file, value);
    return { file, value };
  }

  private endLease(lease: ReturnType<OfflineReservationRecovery['lease']>, remove: boolean) {
    lease.value.active = false;
    if (!remove) return;
    const current = readRecoveryFile(lease.file);
    if (
      JSON.stringify(current.identity) !== JSON.stringify(lease.value.identity) ||
      current.bytes !== Buffer.from(lease.value.bytes).toString('base64')
    )
      throw new OfflineRecoveryBlocked('operation_lease_changed', lease.file);
    unlinkSync(lease.file);
    this.leases.delete(lease.file);
    this.sync(dirname(lease.file));
  }

  /** Explicit completion of a durable signed capture interrupted before/after gate publication.
   * Partial legacy controls without this authenticated bundle are intentionally not adopted.
   */
  async continueCapture(bundle: string) {
    const { capture, before } = this.captureRecord(bundle);
    const boot = this.boot();
    const lease = this.lease(bundle, boot, true, capture.operationId);
    try {
      const current = this.snapshot(before.directory, bundle);
      if (current.logicalDigest !== before.currentDigest)
        throw new OfflineRecoveryBlocked('capture_source_changed', bundle);
      if (
        this.present(join(bundle, 'archive.json')) ||
        this.present(join(before.directory, 'offline-recovery-operation.lock'))
      )
        throw new OfflineRecoveryBlocked('release_continuation_required', bundle);
      const challenge = {
        ...before,
        nonce: randomUUID(),
        expiresAt: this.dependencies.now() + 30_000,
        currentBoot: boot,
        currentDigest: current.rawDigest,
      };
      const signature = await this.approve(challenge, current);
      if (
        this.boot() !== boot ||
        this.snapshot(before.directory, bundle).rawDigest !== current.rawDigest
      )
        throw new OfflineRecoveryBlocked('capture_source_changed', bundle);
      this.write(
        join(bundle, `capture-continuation-${challenge.nonce}.json`),
        JSON.stringify({ challenge, signature }),
      );
      this.syncFile(join(bundle, 'snapshot.json'));
      this.syncFile(join(bundle, 'capture.json'));
      const gateFile = join(before.directory, RECOVERY_GATE);
      if (!this.present(gateFile)) this.write(gateFile, JSON.stringify(this.gate(capture)));
      exact(gateFile, this.gate(capture));
      this.syncFile(gateFile);
      if (
        this.boot() !== boot ||
        this.snapshot(before.directory, bundle).rawDigest !== current.rawDigest
      )
        throw new OfflineRecoveryBlocked('capture_source_changed', bundle);
      return { operationId: capture.operationId, bundle, admissionBlocked: true as const };
    } finally {
      this.endLease(lease, true);
    }
  }

  /** Explicit pre-release abort. Removes only this operation's controls, never active-pair.json.
   * Incomplete/unknown capture or control ownership is not sufficient authority to abort.
   */
  async abort(bundle: string) {
    const { capture, before } = this.captureRecord(bundle, true);
    const boot = this.boot();
    const lease = this.lease(bundle, boot, true, capture.operationId);
    try {
      const directory = before.directory;
      const gateFile = join(directory, RECOVERY_GATE);
      const lockFile = join(directory, 'offline-recovery-operation.lock');
      const current = this.snapshot(directory, bundle);
      const assertCurrent = () => {
        if (
          this.boot() !== boot ||
          current.logicalDigest !== before.currentDigest ||
          this.snapshot(directory, bundle).rawDigest !== current.rawDigest
        )
          throw new OfflineRecoveryBlocked('abort_source_changed', bundle);
        exact(gateFile, this.gate(capture));
        if (this.present(lockFile)) exact(lockFile, { operationId: capture.operationId });
        for (const name of [
          'archive.json',
          'receipt-prepared.json',
          'receipt.json',
          'finalized.json',
        ])
          if (this.present(join(bundle, name)))
            throw new OfflineRecoveryBlocked('abort_denied_after_release_effect', bundle);
      };
      assertCurrent();
      const challenge: AdministrativeRecoveryChallenge = {
        ...before,
        phase: 'abort',
        nonce: randomUUID(),
        expiresAt: this.dependencies.now() + 30_000,
        currentBoot: boot,
        currentDigest: current.rawDigest,
      };
      const signature = await this.approve(challenge, current, {
        phase: 'pre_release_abort',
        gate: this.gate(capture),
        originalReservationPreserved: true,
      });
      assertCurrent();
      const abortedFile = join(bundle, 'aborted.json');
      const record = { operationId: capture.operationId, challenge, signature };
      if (!this.present(abortedFile)) this.write(abortedFile, JSON.stringify(record));
      else {
        // A previous abort interrupted during control cleanup still needs fresh approval.
        const previous = z
          .strictObject({
            operationId: z.uuid(),
            challenge: captureSchema.shape.challenge.extend({ phase: z.literal('abort') }),
            signature: captureSchema.shape.signature,
          })
          .parse(sourceJSON(abortedFile));
        const proof = previous.challenge;
        if (
          previous.operationId !== capture.operationId ||
          proof.operationId !== capture.operationId ||
          proof.directory !== directory ||
          proof.bundle !== bundle ||
          proof.owner !== before.owner ||
          proof.epoch !== before.epoch ||
          proof.beforeBoot !== before.beforeBoot ||
          proof.snapshotDigest !== before.snapshotDigest ||
          proof.currentDigest !== current.rawDigest ||
          !verify(
            null,
            administrativeRecoveryBytes(proof),
            this.authority.publicKey,
            Buffer.from(previous.signature, 'base64url'),
          )
        )
          throw new OfflineRecoveryBlocked('untrusted_abort_record', bundle);
        this.write(
          join(bundle, `abort-continuation-${challenge.nonce}.json`),
          JSON.stringify(record),
        );
      }
      this.syncFile(abortedFile);
      assertCurrent();
      if (this.present(lockFile)) unlinkSync(lockFile);
      this.sync(directory);
      unlinkSync(gateFile);
      this.sync(directory);
      return {
        operationId: capture.operationId,
        status: 'aborted' as const,
        originalReservationPreserved: true as const,
      };
    } finally {
      this.endLease(lease, true);
    }
  }

  async release(bundle: string) {
    return this.releaseTransaction(bundle, false);
  }

  /** A separate explicit native action, never called automatically after an error. */
  async continueRelease(bundle: string) {
    return this.releaseTransaction(bundle, true);
  }

  private async releaseTransaction(bundle: string, continuation: boolean) {
    const { capture, before } = this.captureRecord(bundle);
    const currentBoot = this.boot();
    if (currentBoot === before.beforeBoot) throw new Error('Different kernel boot required');
    const directory = before.directory;
    terminalDirectory(directory, true);
    exact(join(directory, RECOVERY_GATE), this.gate(capture));
    const lease = this.lease(bundle, currentBoot, continuation, capture.operationId);
    let cleanLease = false;
    let effect = false;
    try {
      const attempt = join(bundle, 'release-attempt.json');
      // Historical control is not consent. No nonce or signature is recovered from it.
      if (!this.present(attempt))
        this.write(attempt, JSON.stringify({ version: 2, operationId: capture.operationId }));
      else if (continuation) {
        const value = sourceJSON(attempt) as Record<string, unknown>;
        if (value.operationId !== capture.operationId || value.version !== 2)
          throw new OfflineRecoveryBlocked('legacy_or_partial_release_control', bundle);
      } else exact(attempt, { version: 2, operationId: capture.operationId });
      const lock = join(directory, 'offline-recovery-operation.lock');
      const lockValue = { operationId: capture.operationId };
      if (!this.present(lock)) this.write(lock, JSON.stringify(lockValue));
      exact(lock, lockValue);
      const archivePath = join(bundle, 'archive.json');
      const held = join(directory, `recovered-${capture.operationId}.marker.json`);
      let archive: ReturnType<OfflineReservationRecovery['archiveRecord']>;
      const continuingArchive = this.present(archivePath);
      if (continuingArchive) {
        effect = true;
        if (!continuation)
          throw new OfflineRecoveryBlocked('explicit_release_continuation_required', bundle);
        archive = this.archiveRecord(bundle, capture);
      } else {
        if (
          this.present(held) ||
          this.present(join(bundle, 'receipt-prepared.json')) ||
          this.present(join(bundle, 'receipt.json'))
        )
          throw new OfflineRecoveryBlocked('release_phase_without_archive', bundle);
        const current = this.snapshot(directory, bundle);
        if (current.logicalDigest !== before.currentDigest)
          throw new Error('Recovery logical snapshot changed');
        const challenge: AdministrativeRecoveryChallenge = {
          ...before,
          phase: 'release',
          nonce: randomUUID(),
          expiresAt: this.dependencies.now() + 30_000,
          currentBoot,
          currentDigest: current.rawDigest,
        };
        const signature = await this.approve(challenge, current);
        exact(join(directory, RECOVERY_GATE), this.gate(capture));
        exact(lock, lockValue);
        if (
          this.boot() !== currentBoot ||
          this.snapshot(directory, bundle).rawDigest !== current.rawDigest
        )
          throw new Error('Recovery changed after fence/review');
        const record = {
          version: 1,
          authority: 'administrative_recovery',
          reason: 'non_dispatch',
          fence: 'external_kernel_boot_fence',
          operationId: capture.operationId,
          capture,
          current,
          challenge,
          signature,
        };
        effect = true; // A partial archive is an uncertain effect and must never be overwritten.
        this.write(archivePath, JSON.stringify(record));
        this.dependencies.boundary?.('archive');
        archive = this.archiveRecord(bundle, capture);
      }
      const assertCurrent = () => {
        exact(join(directory, RECOVERY_GATE), this.gate(capture));
        exact(lock, lockValue);
        if (
          this.boot() !== currentBoot ||
          this.present(held) ||
          this.snapshot(directory, bundle).rawDigest !== archive.current.rawDigest
        )
          throw new Error('Recovery changed before final namespace commit');
      };
      assertCurrent();
      if (continuation && continuingArchive) {
        const markerPath = join(directory, 'active-pair.json');
        const marker = readRecoveryFile(markerPath);
        const transaction = {
          phase: 'archive_preparation_original_marker_retained',
          archiveHash: readRecoveryFile(archivePath, RECOVERY_LIMIT).sha256,
          historicalRelease: archive.challenge,
          marker: { path: markerPath, identity: marker.identity, sha256: marker.sha256 },
          preparedReceipt: this.present(join(bundle, 'receipt-prepared.json'))
            ? sourceJSON(join(bundle, 'receipt-prepared.json'))
            : null,
          completedReceipt: this.present(join(bundle, 'receipt.json'))
            ? sourceJSON(join(bundle, 'receipt.json'))
            : null,
        };
        const challenge: AdministrativeRecoveryChallenge = {
          ...before,
          phase: 'release',
          nonce: randomUUID(),
          expiresAt: this.dependencies.now() + 30_000,
          currentBoot,
          currentDigest: terminalDigest(
            JSON.stringify({ rawDigest: archive.current.rawDigest, transaction }),
          ),
        };
        const signature = await this.approve(challenge, archive.current, transaction);
        assertCurrent();
        this.write(
          join(bundle, `release-continuation-${challenge.nonce}.json`),
          JSON.stringify({ challenge, signature, transaction }),
        );
      }
      this.syncFile(archivePath);
      assertCurrent();
      const prepared = {
        version: 1,
        operationId: capture.operationId,
        status: 'archive_durable',
        archiveHash: readRecoveryFile(archivePath, RECOVERY_LIMIT).sha256,
        reason: 'non_dispatch',
        fence: 'external_kernel_boot_fence',
        owner: before.owner,
        epoch: before.epoch,
        beforeBoot: before.beforeBoot,
        currentBoot: archive.challenge.currentBoot,
      };
      const preparedFile = join(bundle, 'receipt-prepared.json');
      if (!this.present(preparedFile)) this.write(preparedFile, JSON.stringify(prepared));
      exact(preparedFile, prepared);
      this.syncFile(preparedFile);
      assertCurrent();
      const marker = this.sourceMarker(archive.current, directory);
      const receipt = {
        ...prepared,
        version: 2,
        status: 'release_prepared',
        sourceMarkerHash: marker.sha256,
        sourceMarkerIdentity: marker.identity,
      };
      const receiptFile = join(bundle, 'receipt.json');
      if (!this.present(receiptFile)) this.write(receiptFile, JSON.stringify(receipt));
      exact(receiptFile, receipt);
      this.syncFile(receiptFile);
      this.dependencies.boundary?.('receipt');
      assertCurrent();
      cleanLease = true;
      return { ...receipt, bundle, admissionBlocked: true as const };
    } catch (error) {
      // Cancellation/expiry before archive has no release effects. The sticky gate stays.
      if (!effect && !this.present(join(bundle, 'archive.json'))) cleanLease = true;
      throw error;
    } finally {
      this.endLease(lease, cleanLease);
    }
  }

  private archiveRecord(bundle: string, capture: z.infer<typeof captureSchema>) {
    const record = z
      .strictObject({
        version: z.literal(1),
        authority: z.literal('administrative_recovery'),
        reason: z.literal('non_dispatch'),
        fence: z.literal('external_kernel_boot_fence'),
        operationId: z.uuid(),
        capture: captureSchema,
        current: offlineSnapshotSchema,
        challenge: captureSchema.shape.challenge.extend({ phase: z.literal('release') }),
        signature: captureSchema.shape.signature,
      })
      .parse(sourceJSON(join(bundle, 'archive.json'), RECOVERY_LIMIT));
    const before = capture.challenge;
    if (
      record.operationId !== capture.operationId ||
      JSON.stringify(record.capture) !== JSON.stringify(capture) ||
      record.challenge.operationId !== capture.operationId ||
      record.challenge.owner !== before.owner ||
      record.challenge.epoch !== before.epoch ||
      record.challenge.bundle !== bundle ||
      record.challenge.directory !== before.directory ||
      record.challenge.beforeBoot !== before.beforeBoot ||
      record.challenge.currentBoot === before.beforeBoot ||
      record.challenge.snapshotDigest !== before.snapshotDigest ||
      record.challenge.currentDigest !== record.current.rawDigest ||
      record.current.logicalDigest !== before.currentDigest ||
      !verify(
        null,
        administrativeRecoveryBytes(record.challenge),
        this.authority.publicKey,
        Buffer.from(record.signature, 'base64url'),
      )
    )
      throw new OfflineRecoveryBlocked('untrusted_release_archive', bundle);
    // Recompute the complete signed projection even when the original marker still exists.
    if (
      terminalDigest(
        JSON.stringify({
          files: record.current.files,
          journals: record.current.journals,
          membership: record.current.membership,
        }),
      ) !== record.current.rawDigest
    )
      throw new OfflineRecoveryBlocked('archive_snapshot_changed', bundle);
    return record;
  }

  private sourceMarker(snapshot: OfflineReservationSnapshot, directory: string) {
    const marker = snapshot.files.find((file) => file.path === join(directory, 'active-pair.json'));
    if (!marker) throw new Error('Recovery signed original marker missing');
    return marker;
  }

  private observedHeldMarker(
    marker: ReturnType<OfflineReservationRecovery['sourceMarker']>,
    held: string,
  ) {
    const value = readRecoveryFile(held);
    // rename changes ctime. Device/inode/size/mode/uid/mtime and complete bytes remain exact.
    if (
      value.sha256 !== marker.sha256 ||
      JSON.stringify(value.identity.slice(0, 6)) !== JSON.stringify(marker.identity.slice(0, 6))
    )
      throw new Error('Recovery original held marker identity changed');
    return value;
  }

  /** Final namespace commit only after durable prepared records and a fresh phase signature.
   * Post-commit cleanup never reads, renames or unlinks active-pair.json again.
   */
  async finalize(bundle: string) {
    const { capture, before } = this.captureRecord(bundle);
    const archive = this.archiveRecord(bundle, capture);
    const directory = before.directory;
    const currentBoot = this.boot();
    if (currentBoot === before.beforeBoot) throw new Error('Different kernel boot required');
    const marker = this.sourceMarker(archive.current, directory);
    const heldPath = join(directory, `recovered-${capture.operationId}.marker.json`);
    const archiveHash = readRecoveryFile(join(bundle, 'archive.json'), RECOVERY_LIMIT).sha256;
    const receipt = {
      version: 2,
      operationId: capture.operationId,
      status: 'release_prepared',
      archiveHash,
      reason: 'non_dispatch',
      fence: 'external_kernel_boot_fence',
      owner: before.owner,
      epoch: before.epoch,
      beforeBoot: before.beforeBoot,
      currentBoot: archive.challenge.currentBoot,
      sourceMarkerHash: marker.sha256,
      sourceMarkerIdentity: marker.identity,
    };
    exact(join(bundle, 'receipt.json'), receipt);
    const receiptHash = readRecoveryFile(join(bundle, 'receipt.json')).sha256;
    const gateFile = join(directory, RECOVERY_GATE);
    const lockFile = join(directory, 'offline-recovery-operation.lock');
    const intentFile = join(bundle, 'finalized.json');
    const completionFile = join(bundle, 'completion.json');
    const fileSchema = offlineSnapshotSchema.shape.files.element;
    const planSchema = z.strictObject({
      version: z.literal(2),
      status: z.literal('commit_prepared'),
      operationId: z.uuid(),
      archiveHash: z.string(),
      receiptHash: z.string(),
      marker: fileSchema,
      heldPath: z.string(),
      controls: z.strictObject({ gate: fileSchema, lock: fileSchema }),
    });
    const intentSchema = z.strictObject({
      plan: planSchema,
      challenge: captureSchema.shape.challenge.extend({ phase: z.literal('finalize') }),
      signature: captureSchema.shape.signature,
    });
    const lease = this.lease(bundle, currentBoot, true, capture.operationId);
    let cleanLease = false;
    let namespaceAttempted = false;
    let namespaceObserved = false;
    try {
      let intent: z.infer<typeof intentSchema> | undefined;
      if (this.present(intentFile)) {
        try {
          intent = intentSchema.parse(sourceJSON(intentFile, RECOVERY_LIMIT));
        } catch {
          throw new OfflineRecoveryBlocked(
            'incomplete_or_legacy_commit_intent_preserve_marker',
            bundle,
          );
        }
        const { plan, challenge } = intent;
        if (
          plan.operationId !== capture.operationId ||
          plan.archiveHash !== archiveHash ||
          plan.receiptHash !== receiptHash ||
          plan.heldPath !== heldPath ||
          JSON.stringify(plan.marker) !== JSON.stringify(marker) ||
          plan.controls.gate.path !== gateFile ||
          plan.controls.lock.path !== lockFile ||
          JSON.stringify(
            JSON.parse(Buffer.from(plan.controls.gate.bytes, 'base64').toString('utf8')),
          ) !== JSON.stringify(this.gate(capture)) ||
          JSON.stringify(
            JSON.parse(Buffer.from(plan.controls.lock.bytes, 'base64').toString('utf8')),
          ) !== JSON.stringify({ operationId: capture.operationId }) ||
          challenge.operationId !== capture.operationId ||
          challenge.owner !== before.owner ||
          challenge.epoch !== before.epoch ||
          challenge.directory !== directory ||
          challenge.bundle !== bundle ||
          challenge.beforeBoot !== before.beforeBoot ||
          challenge.currentBoot === before.beforeBoot ||
          challenge.snapshotDigest !== before.snapshotDigest ||
          challenge.currentDigest !== terminalDigest(JSON.stringify(plan)) ||
          !verify(
            null,
            administrativeRecoveryBytes(challenge),
            this.authority.publicKey,
            Buffer.from(intent.signature, 'base64url'),
          )
        )
          throw new OfflineRecoveryBlocked('untrusted_commit_intent', bundle);
      }
      const heldBefore = this.present(heldPath);
      if (heldBefore && !intent)
        throw new OfflineRecoveryBlocked('held_marker_without_signed_final_commit', bundle);
      if (heldBefore) {
        this.observedHeldMarker(marker, heldPath);
        namespaceObserved = true;
      }
      // A replay cannot repeat the namespace mutation or clean a future owner's files.
      if (this.present(completionFile)) {
        const completeSchema = z.strictObject({
          version: z.literal(1),
          operationId: z.uuid(),
          status: z.literal('finalized'),
          intentHash: z.string(),
          observation: z.string(),
          observationHash: z.string(),
          cleanup: z.enum(['old_controls_removed', 'changed_controls_preserved']),
        });
        let complete: z.infer<typeof completeSchema>;
        try {
          complete = completeSchema.parse(sourceJSON(completionFile));
        } catch {
          throw new OfflineRecoveryBlocked('completion_record_uncertain_commit_preserved', bundle);
        }
        if (
          !intent ||
          !heldBefore ||
          complete.operationId !== capture.operationId ||
          complete.intentHash !== readRecoveryFile(intentFile, RECOVERY_LIMIT).sha256 ||
          !complete.observation.startsWith(join(bundle, 'commit-observed-')) ||
          !/^commit-observed-[a-f0-9-]+\.json$/.test(
            complete.observation.slice(bundle.length + 1),
          ) ||
          readRecoveryFile(complete.observation).sha256 !== complete.observationHash
        )
          throw new OfflineRecoveryBlocked('completion_record_uncertain_commit_preserved', bundle);
        throw new OfflineRecoveryBlocked('already_finalized_original_commit_preserved', bundle);
      }
      const assertPrepared = () => {
        if (
          this.boot() !== currentBoot ||
          this.present(heldPath) ||
          this.snapshot(directory, bundle).rawDigest !== archive.current.rawDigest
        )
          throw new OfflineRecoveryBlocked('pre_commit_source_changed', bundle);
        exact(gateFile, this.gate(capture));
        exact(lockFile, { operationId: capture.operationId });
        exact(join(bundle, 'receipt.json'), receipt);
        if (
          intent &&
          (JSON.stringify(readRecoveryFile(gateFile)) !==
            JSON.stringify(intent.plan.controls.gate) ||
            JSON.stringify(readRecoveryFile(lockFile)) !==
              JSON.stringify(intent.plan.controls.lock))
        )
          throw new OfflineRecoveryBlocked('pre_commit_control_identity_changed', bundle);
      };
      let plan: z.infer<typeof planSchema>;
      if (intent) plan = intent.plan;
      else {
        assertPrepared();
        plan = {
          version: 2,
          status: 'commit_prepared',
          operationId: capture.operationId,
          archiveHash,
          receiptHash,
          marker,
          heldPath,
          controls: { gate: readRecoveryFile(gateFile), lock: readRecoveryFile(lockFile) },
        };
      }
      if (!heldBefore) assertPrepared();
      const challenge: AdministrativeRecoveryChallenge & { phase: 'finalize' } = {
        ...before,
        phase: 'finalize',
        nonce: randomUUID(),
        expiresAt: this.dependencies.now() + 30_000,
        currentBoot,
        currentDigest: terminalDigest(JSON.stringify(plan)),
      };
      const signature = await this.approve(challenge, archive.current, {
        phase: heldBefore
          ? 'namespace_commit_observed_cleanup_only'
          : 'final_commit_original_marker_retained',
        snapshotScope: 'historical_pre_commit',
        plan,
        heldMarker: heldBefore ? this.observedHeldMarker(marker, heldPath) : null,
        actionAfterCommit: 'Never touch active-pair.json or revalidate future owner activity',
      });
      if (this.boot() !== currentBoot) throw new Error('Recovery kernel boot changed');
      if (!heldBefore) assertPrepared();
      const approval = { plan, challenge, signature };
      this.write(
        join(bundle, `finalization-approval-${challenge.nonce}.json`),
        JSON.stringify(approval),
      );
      if (!intent) {
        this.write(intentFile, JSON.stringify(approval));
        intent = approval;
      }
      if (!intent) throw new Error('Durable commit intent unavailable');
      // Every preparatory record is explicitly durable before the only marker-absent point.
      this.syncFile(join(bundle, 'archive.json'));
      this.syncFile(join(bundle, 'receipt-prepared.json'));
      this.syncFile(join(bundle, 'receipt.json'));
      this.syncFile(intentFile);
      if (!heldBefore) {
        this.dependencies.boundary?.('commit_prepared');
        assertPrepared();
        this.dependencies.boundary?.('before_marker');
        assertPrepared();
        const currentLease = readRecoveryFile(lease.file);
        if (
          currentLease.bytes !== Buffer.from(lease.value.bytes).toString('base64') ||
          JSON.stringify(currentLease.identity) !== JSON.stringify(lease.value.identity)
        )
          throw new OfflineRecoveryBlocked('operation_lease_changed', bundle);
        // Durability/source checks may outlast consent. Never extend or reuse its deadline.
        if (challenge.expiresAt <= this.dependencies.now())
          throw new OfflineRecoveryBlocked('final_commit_approval_expired', bundle);
        namespaceAttempted = true;
        // Protocol exclusion is marker-presence + legacy claim(wx), not an invented multi-file CAS.
        // Old pre-boot owners are dead; post-boot claimants cannot replace this present marker.
        renameSync(marker.path, heldPath);
        namespaceObserved = true;
        this.dependencies.boundary?.('after_marker');
      }
      namespaceAttempted = true;
      const held = this.observedHeldMarker(marker, heldPath);
      this.sync(directory);
      // Commit has already happened. New active markers and enrollments are future operations.
      const observation = join(bundle, `commit-observed-${randomUUID()}.json`);
      this.write(
        observation,
        JSON.stringify({
          version: 1,
          operationId: capture.operationId,
          status: 'release_committed',
          authority: 'administrative_recovery',
          reason: 'non_dispatch',
          fence: 'external_kernel_boot_fence',
          intentHash: readRecoveryFile(intentFile, RECOVERY_LIMIT).sha256,
          observedBoot: currentBoot,
          heldMarkerHash: held.sha256,
          heldMarkerIdentity: held.identity,
        }),
      );
      this.dependencies.boundary?.('commit_receipt');
      let changedControls = false;
      for (const [kind, control] of [
        ['lock', intent.plan.controls.lock],
        ['gate', intent.plan.controls.gate],
      ] as const) {
        if (!this.present(control.path)) continue;
        let current: ReturnType<typeof readRecoveryFile>;
        try {
          current = readRecoveryFile(control.path);
        } catch {
          changedControls = true;
          continue;
        }
        if (JSON.stringify(current) !== JSON.stringify(control)) {
          changedControls = true;
          continue;
        }
        unlinkSync(control.path);
        this.dependencies.boundary?.(kind === 'lock' ? 'after_lock' : 'after_gate');
        this.sync(directory);
      }
      this.sync(directory);
      const cleanup = changedControls
        ? ('changed_controls_preserved' as const)
        : ('old_controls_removed' as const);
      this.write(
        completionFile,
        JSON.stringify({
          version: 1,
          operationId: capture.operationId,
          status: 'finalized',
          intentHash: readRecoveryFile(intentFile, RECOVERY_LIMIT).sha256,
          observation,
          observationHash: readRecoveryFile(observation).sha256,
          cleanup,
        }),
      );
      cleanLease = true;
      return {
        operationId: capture.operationId,
        status: 'finalized' as const,
        releaseCommitted: true as const,
        cleanup,
      };
    } catch (error) {
      if (!namespaceAttempted) cleanLease = true;
      if (namespaceAttempted && !(error instanceof OfflineRecoveryBlocked))
        throw new OfflineRecoveryBlocked(
          namespaceObserved
            ? 'namespace_commit_observed_durability_or_cleanup_uncertain'
            : 'namespace_commit_result_uncertain',
          bundle,
        );
      throw error;
    } finally {
      this.endLease(lease, cleanLease);
    }
  }
}
