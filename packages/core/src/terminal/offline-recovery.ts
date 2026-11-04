import { execFileSync } from 'node:child_process';
import { randomUUID, verify, type KeyObject } from 'node:crypto';
import { fsyncSync, lstatSync, mkdirSync, mkdtempSync, renameSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { terminalDigest } from './authority.js';
import { terminalDirectory } from './codex-profile.js';
import {
  readRecoveryFile,
  RECOVERY_GATE,
  RECOVERY_LIMIT,
  snapshotOfflineReservation,
  syncRecoveryDirectory,
  writeRecoveryFile,
  assertHeldRecoverySnapshot,
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
  phase: 'capture' | 'release';
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
    stage: 'gate' | 'capture' | 'archive' | 'before_marker' | 'after_marker' | 'receipt',
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
export class OfflineReservationRecovery {
  private used = new Set<string>();
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
  ) {
    const fullReview = JSON.stringify(
      {
        action:
          challenge.phase === 'capture'
            ? 'Capture privately before a kernel reboot; retain admission'
            : 'Archive non-dispatch evidence and release after external kernel fence; no process exit claim',
        challenge,
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
    this.write(join(directory, RECOVERY_GATE), JSON.stringify(gate));
    this.dependencies.boundary?.('gate');
    if (
      this.boot() !== beforeBoot ||
      this.snapshot(directory, bundle).rawDigest !== snapshot.rawDigest
    )
      throw new Error('Recovery changed before durable capture');
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
    exact(join(directory, RECOVERY_GATE), gate);
    if (
      this.boot() !== beforeBoot ||
      this.snapshot(directory, bundle).rawDigest !== snapshot.rawDigest
    )
      throw new Error('Recovery changed after durable capture');
    return {
      operationId,
      bundle,
      owner: challenge.owner,
      epoch: challenge.epoch,
      beforeBoot,
      snapshotDigest: challenge.snapshotDigest,
    };
  }

  async release(bundle: string) {
    terminalDirectory(bundle, true);
    const capture = captureSchema.parse(sourceJSON(join(bundle, 'capture.json')));
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
    const currentBoot = this.boot();
    if (currentBoot === before.beforeBoot) throw new Error('Different kernel boot required');
    const directory = before.directory;
    terminalDirectory(directory, true);
    const gate = {
      version: 1,
      operationId: capture.operationId,
      owner: before.owner,
      epoch: before.epoch,
      bundle,
      beforeBoot: before.beforeBoot,
    };
    exact(join(directory, RECOVERY_GATE), gate);
    // Exclusive persisted attempt; cancellation/uncertainty is never automatically retried.
    this.write(
      join(bundle, 'release-attempt.json'),
      JSON.stringify({ currentBoot, nonce: randomUUID() }),
    );
    this.write(
      join(directory, 'offline-recovery-operation.lock'),
      JSON.stringify({ operationId: capture.operationId }),
    );
    const current = this.snapshot(directory, bundle);
    if (current.logicalDigest !== before.currentDigest)
      throw new Error('Recovery logical snapshot changed');
    const assertCurrent = () => {
      exact(join(directory, RECOVERY_GATE), gate);
      exact(join(directory, 'offline-recovery-operation.lock'), {
        operationId: capture.operationId,
      });
      if (
        this.boot() !== currentBoot ||
        this.snapshot(directory, bundle).rawDigest !== current.rawDigest
      )
        throw new Error('Recovery changed after fence/review');
    };
    const challenge: AdministrativeRecoveryChallenge = {
      ...before,
      phase: 'release',
      nonce: randomUUID(),
      expiresAt: this.dependencies.now() + 30_000,
      currentBoot,
      currentDigest: current.rawDigest,
    };
    const signature = await this.approve(challenge, current);
    assertCurrent();
    const archive = {
      version: 1,
      authority: 'administrative_recovery',
      reason: 'non_dispatch',
      fence: 'external_kernel_boot_fence',
      operationId: capture.operationId,
      capture,
      current,
      challenge,
      signature,
      // prepared remains prepared. No exit, old-owner signature or provider claim.
    };
    const archivePath = join(bundle, 'archive.json');
    this.write(archivePath, JSON.stringify(archive));
    this.dependencies.boundary?.('archive');
    exact(archivePath, archive);
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
      currentBoot,
    };
    this.write(join(bundle, 'receipt-prepared.json'), JSON.stringify(prepared));
    this.dependencies.boundary?.('before_marker');
    assertCurrent();
    const held = join(directory, `recovered-${capture.operationId}.marker.json`);
    try {
      lstatSync(held);
      throw new Error('Recovery held marker already exists');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    // The gate still blocks admission if rename/fsync or any subsequent write is uncertain.
    renameSync(join(directory, 'active-pair.json'), held);
    this.dependencies.boundary?.('after_marker');
    this.sync(directory);
    assertHeldRecoverySnapshot(directory, current);
    const receipt = {
      ...prepared,
      status: 'released',
      heldMarkerHash: readRecoveryFile(held).sha256,
      heldMarkerIdentity: readRecoveryFile(held).identity,
    };
    this.write(join(bundle, 'receipt.json'), JSON.stringify(receipt));
    this.dependencies.boundary?.('receipt');
    // Intentionally keep gate and operation lock. Explicit finalization is a separate action.
    return { ...receipt, bundle, admissionBlocked: true as const };
  }

  /** Explicit completion only; no launch. Never called from release or startup. */
  finalize(bundle: string) {
    const capture = captureSchema.parse(sourceJSON(join(bundle, 'capture.json')));
    const before = capture.challenge;
    const receipt = sourceJSON(join(bundle, 'receipt.json')) as Record<string, unknown>;
    const archive = readRecoveryFile(join(bundle, 'archive.json'), RECOVERY_LIMIT);
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
      .parse(JSON.parse(Buffer.from(archive.bytes, 'base64').toString('utf8')));
    if (
      before.bundle !== bundle ||
      receipt.status !== 'released' ||
      receipt.operationId !== capture.operationId ||
      receipt.archiveHash !== archive.sha256 ||
      receipt.currentBoot !== this.boot() ||
      receipt.beforeBoot !== before.beforeBoot ||
      receipt.reason !== 'non_dispatch' ||
      receipt.fence !== 'external_kernel_boot_fence' ||
      receipt.owner !== before.owner ||
      receipt.epoch !== before.epoch ||
      record.operationId !== capture.operationId ||
      JSON.stringify(record.capture) !== JSON.stringify(capture) ||
      record.challenge.owner !== before.owner ||
      record.challenge.epoch !== before.epoch ||
      record.challenge.bundle !== bundle ||
      record.challenge.directory !== before.directory ||
      record.challenge.beforeBoot !== before.beforeBoot ||
      record.challenge.currentBoot !== receipt.currentBoot ||
      record.challenge.currentBoot === before.beforeBoot ||
      record.challenge.snapshotDigest !== before.snapshotDigest ||
      record.challenge.currentDigest !== record.current.rawDigest ||
      !verify(
        null,
        administrativeRecoveryBytes(record.challenge),
        this.authority.publicKey,
        Buffer.from(record.signature, 'base64url'),
      ) ||
      !verify(
        null,
        administrativeRecoveryBytes(before),
        this.authority.publicKey,
        Buffer.from(capture.signature, 'base64url'),
      )
    )
      throw new Error('Recovery completion unavailable');
    const directory = before.directory;
    const held = readRecoveryFile(join(directory, `recovered-${capture.operationId}.marker.json`));
    if (held.sha256 !== receipt.heldMarkerHash) throw new Error('Recovery held marker changed');
    if (JSON.stringify(held.identity) !== JSON.stringify(receipt.heldMarkerIdentity))
      throw new Error('Recovery held marker identity changed');
    const originalMarker = record.current.files.find(
      (file) => file.path === join(directory, 'active-pair.json'),
    );
    if (
      JSON.stringify(held.identity.slice(0, 6)) !==
      JSON.stringify(originalMarker?.identity.slice(0, 6))
    )
      throw new Error('Recovery original marker identity changed');
    if (
      held.sha256 !==
      record.current.files.find((file) => file.path === join(directory, 'active-pair.json'))?.sha256
    )
      throw new Error('Recovery held marker differs from signed source');
    assertHeldRecoverySnapshot(directory, record.current);
    try {
      lstatSync(join(directory, 'active-pair.json'));
      throw new Error('Recovery owner reappeared');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    exact(join(directory, RECOVERY_GATE), {
      version: 1,
      operationId: capture.operationId,
      owner: before.owner,
      epoch: before.epoch,
      bundle,
      beforeBoot: before.beforeBoot,
    });
    exact(join(directory, 'offline-recovery-operation.lock'), { operationId: capture.operationId });
    this.write(
      join(bundle, 'finalized.json'),
      JSON.stringify({
        operationId: capture.operationId,
        receiptHash: readRecoveryFile(join(bundle, 'receipt.json')).sha256,
      }),
    );
    unlinkSync(join(directory, 'offline-recovery-operation.lock'));
    this.sync(directory);
    unlinkSync(join(directory, RECOVERY_GATE));
    this.sync(directory);
    return { operationId: capture.operationId, status: 'finalized' as const };
  }
}
