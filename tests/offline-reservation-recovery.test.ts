import { releaseKernelReservation } from '../packages/core/src/terminal/kernel-release.js';
import { acquireAdmissionMutation } from '../packages/core/src/terminal/admission-mutation.js';
import {
  beginKernelRelease,
  reconcileKernelRelease,
} from '../packages/core/src/terminal/kernel-release-files.js';
import { snapshotKernelReservation } from '../packages/core/src/terminal/kernel-reservation-snapshot.js';
import {
  createLifecycleReceipt,
  armLifecycleReceipt,
} from '../packages/core/src/managed-codex/lifecycle-receipt.js';
import { createKernelLifecycleReceipt } from '../packages/core/src/managed-codex/kernel-lifecycle-receipt.js';
import { closeSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { build } from 'esbuild';
// SYNTHETIC: disposable files/SQLite only. No runtime, Core, PTY, auth DB or reboot.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import {
  chmodSync,
  unlinkSync,
  existsSync,
  fsyncSync,
  fstatSync,
  lstatSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test, { mock } from 'node:test';
import { comparePhysicalFiles } from '../packages/core/src/terminal/offline-physical-binding.js';
import { stableId } from '@orqst/shared';
import { desktopAgentsAdmission } from '../packages/core/src/managed-codex/desktop-admission.js';
import { inspectDesktopAdmission } from '../packages/core/src/managed-codex/desktop-admission-inspection.js';
import { openTerminalJournal } from '../packages/database/src/terminal-journal.js';
import { committedTerminalImage } from '../packages/database/src/offline-terminal-journal.js';
import { terminalDigest } from '../packages/core/src/terminal/authority.js';
import { terminalEnrollmentFile } from '../packages/core/src/terminal/enrollment-files.js';
import { managedCodexConfigSchema } from '../packages/core/src/terminal/codex-profile.js';
import { managedOpenCodeConfigSchema } from '../packages/core/src/terminal/opencode-profile.js';
import { reviewedProviderMcpBinaries } from '../packages/core/src/terminal/provider-mcp-config.js';
import {
  administrativeRecoveryBytes,
  administrativeIntentDigest,
  administrativeIntentBytes,
  administrativeIntentSchema,
  administrativeRecoveryIntent,
  type AdministrativeRecoveryIntent,
  OfflineReservationRecovery,
  type AdministrativeRecoveryChallenge,
} from '../packages/core/src/terminal/offline-recovery.js';
import {
  RECOVERY_GATE,
  snapshotOfflineReservation,
  OfflineEnrollmentBindingChanged,
} from '../packages/core/src/terminal/offline-recovery-files.js';
import { administrativeBlockedOutcome } from '../apps/desktop/src/tauri-offline-recovery.js';

function fixture(
  wal = false,
  journalNow?: () => number,
  twoSources = false,
  admissionName = 'preferences',
) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'orqst-SYNTHETIC-offline-')));
  const directory = join(root, admissionName);
  const recoveryRoot = join(root, 'captures');
  const project = join(root, 'project');
  const model = join(root, 'model.json');
  for (const path of [directory, recoveryRoot, project]) mkdirSync(path, { mode: 0o700 });
  writeFileSync(model, 'SYNTHETIC-NO-CREDENTIAL', { mode: 0o600 });
  const otherModel = join(root, 'other-model.json');
  writeFileSync(otherModel, 'SYNTHETIC-NO-CREDENTIAL', { mode: 0o600 });
  const owner = randomUUID();
  const epoch = randomUUID();
  const firstBoot = randomUUID();
  let boot = firstBoot;
  const workspaceId = stableId('workspace', project);
  const keys = generateKeyPairSync('ed25519');
  const executable = realpathSync('/usr/bin/true'); // Metadata only; never launched.
  const configs = [0, 1].map((slot) => {
    const state = join(root, `state-${slot}`);
    mkdirSync(state, { mode: 0o700 });
    const common = {
      trust: 'native-same-user',
      identity: { terminalId: randomUUID() },
      project,
      state,
      node: { path: executable, sha256: '0'.repeat(64) },
      model: {
        value: slot ? 'synthetic-selected' : 'synthetic/model',
        source: 'native-config',
        files: [
          { path: slot ? model : otherModel, sha256: terminalDigest('SYNTHETIC-NO-CREDENTIAL') },
          ...(slot && twoSources
            ? [{ path: otherModel, sha256: terminalDigest('SYNTHETIC-NO-CREDENTIAL') }]
            : []),
        ],
      },
      preparation: {
        observerDatabase: join(root, 'NEVER-OPEN.sqlite'),
        preferencesDirectory: directory,
        workspaceId,
        featureId: null,
        fence: 'SYNTHETIC',
      },
      interactive: { sharedNativeSessions: true },
    };
    return slot === 0
      ? managedOpenCodeConfigSchema.parse({
          ...common,
          version: 3,
          provider: 'opencode',
          executableVersion: reviewedProviderMcpBinaries.opencode.version,
          executable: { path: executable, sha256: reviewedProviderMcpBinaries.opencode.sha256 },
          authentication: {
            mode: 'reuse-existing',
            nativeIdentity: { HOME: join(root, 'DO-NOT-OPEN-AUTH') },
            sharedNativeConfiguration: true,
          },
          interactive: { ...common.interactive, nativeStartupAuthorized: false },
        })
      : managedCodexConfigSchema.parse({
          ...common,
          version: 1,
          executableVersion: 'SYNTHETIC-NO-PROVIDER',
          executable: { path: executable, sha256: '0'.repeat(64) },
          authentication: {
            mode: 'reuse-existing',
            home: join(root, 'DO-NOT-OPEN-AUTH'),
            codexHome: join(root, 'DO-NOT-OPEN-AUTH/.codex'),
            sharedNativeConfiguration: true,
          },
        });
  });
  const manifests = configs.map((config, slot) => {
    const path = join(root, `manifest-${slot}.json`);
    writeFileSync(path, JSON.stringify(config), { mode: 0o600 });
    return path;
  });
  const input = {
    version: 1,
    epoch,
    opId: randomUUID(),
    expectedRevision: 0,
    workspaceId,
    featureId: null,
  };
  const member = {
    slot: 1,
    terminalId: configs[1]!.identity!.terminalId,
    provider: 'codex',
    requestedModel: 'synthetic-selected',
    workspaceId,
    featureId: null,
    admissionRevision: 1,
    bindingDigest: terminalEnrollmentFile(manifests[1]!, configs[1]!).bindingDigest,
    status: 'uncertain',
  };
  const intent = { version: 1, owner, input, manifestFile: manifests[1], member };
  const intentFile = join(directory, `enrollment-${owner}-${input.opId}.json`);
  const receiptFile = intentFile.replace(/\.json$/, '.receipt.json');
  const receipt = {
    version: 1,
    owner,
    receipt: {
      ...input,
      revision: 1,
      status: 'ready',
      reason: 'admitted',
      member: { ...member, status: 'ready' },
    },
  };
  const marker = join(directory, 'active-pair.json');
  const markerBytes = JSON.stringify({ version: 1, owner, manifests: [manifests[0]] }); // legacy, no epoch
  writeFileSync(marker, markerBytes, { mode: 0o600 });
  writeFileSync(intentFile, JSON.stringify(intent), { mode: 0o600 });
  writeFileSync(receiptFile, JSON.stringify(receipt), { mode: 0o600 });
  const databases = configs.map((config) => {
    const file = join(config.state, 'terminal.sqlite');
    const db = new DatabaseSync(file);
    chmodSync(file, 0o600);
    if (wal) db.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0');
    const journal = openTerminalJournal(
      db,
      (action) => {
        db.exec('BEGIN IMMEDIATE');
        try {
          const result = action();
          db.exec('COMMIT');
          return result;
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
      },
      epoch,
      false,
      journalNow,
    );
    return { file, db, journal };
  });
  const attemptId = randomUUID();
  databases[0]!.journal.prepare({
    instanceId: attemptId,
    clientId: 'SYNTHETIC',
    projectId: terminalDigest(project),
    manifestDigest: 'a'.repeat(64),
  });
  const reviews: AdministrativeRecoveryChallenge[] = [];
  const fullReviews: string[] = [];
  let reviewHook: ((challenge: Readonly<AdministrativeRecoveryChallenge>) => void) | undefined;
  let readingHook: (() => void) | undefined;
  let nativeDeadline: number | undefined;
  let revalidationHook: (() => number | null) | undefined;
  let cancel = false;
  let fault: string | undefined;
  let boundaryHook: ((stage: string) => void) | undefined;
  let syncHook: (() => void) | undefined;
  let syncCount = 0;
  let failSync = -1;
  let failSyncFile: string | undefined;
  let clock = 1;
  const dependencies = {
    bootUUID: () => boot,
    mutationExecutor: async () => ({
      boot,
      pid: process.pid,
      ppid: process.ppid,
      uid: process.getuid!(),
      startSec: 1,
      startUsec: 0,
      sid: 1,
      pgid: 1,
    }),
    mutationOwnerExists: async () => false,
    now: () => clock,
    sync: (fd: number) => {
      if (
        ++syncCount === failSync ||
        (failSyncFile &&
          existsSync(failSyncFile) &&
          fstatSync(fd).ino === lstatSync(failSyncFile).ino)
      )
        throw new Error('SYNTHETIC fsync failure');
      fsyncSync(fd);
      syncHook?.();
    },
    boundary: (stage: string) => {
      boundaryHook?.(stage);
      if (stage === fault) throw new Error(`SYNTHETIC ${stage} fsync/write failure`);
    },
  };
  const authority = {
    publicKey: keys.publicKey,
    review: async (
      intent: Readonly<AdministrativeRecoveryIntent>,
      fullReview: string,
      fingerprint: string,
    ) => {
      assert.equal(Object.isFrozen(intent), true);
      assert.equal('nonce' in intent, false);
      assert.equal('expiresAt' in intent, false);
      assert.equal(administrativeIntentDigest(intent, fullReview), fingerprint);
      fullReviews.push(fullReview);
      readingHook?.();
      nativeDeadline = clock + 30_000;
      return !cancel;
    },
    sign: async (challenge: Readonly<AdministrativeRecoveryChallenge>) => {
      reviews.push({ ...challenge });
      reviewHook?.(challenge);
      return {
        signature: sign(null, administrativeRecoveryBytes(challenge), keys.privateKey).toString(
          'base64url',
        ),
        validUntil: nativeDeadline!,
      };
    },
    revalidate: async () => (revalidationHook ? revalidationHook() : nativeDeadline!),
  };
  const recovery = new OfflineReservationRecovery(authority, dependencies);
  return {
    root,
    directory,
    recoveryRoot,
    configs,
    marker,
    markerBytes,
    epoch,
    owner,
    firstBoot,
    intentFile,
    receiptFile,
    intent,
    receipt,
    manifests,
    databases,
    attemptId,
    reviews,
    fullReviews,
    recovery,
    authority,
    dependencies,
    reading: (hook: typeof readingHook) => {
      readingHook = hook;
    },
    revalidation: (hook: typeof revalidationHook) => {
      revalidationHook = hook;
    },
    advance: (milliseconds: number) => {
      clock += milliseconds;
    },
    failSyncAt: (count: number) => {
      syncCount = 0;
      failSync = count;
    },
    changeBoot: () => {
      boot = randomUUID();
    },
    review: (hook: typeof reviewHook) => {
      reviewHook = hook;
    },
    cancel: () => {
      cancel = true;
    },
    allow: () => {
      cancel = false;
      reviewHook = undefined;
    },
    failFileSync: (file: string) => {
      failSyncFile = file;
    },
    clearFault: () => {
      failSyncFile = undefined;
      fault = undefined;
      failSync = -1;
    },
    boundary: (hook: typeof boundaryHook) => {
      boundaryHook = hook;
    },
    synced: (hook: typeof syncHook) => {
      syncHook = hook;
    },
    fault: (stage: string) => {
      fault = stage;
    },
    capture: () => recovery.capture(directory, recoveryRoot),
    close: () => {
      for (const { db } of databases) db.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

test('offline finalization refuses a live admission mutation owner before review', async () => {
  const f = fixture(true);
  try {
    const capture = await f.capture();
    f.changeBoot();
    const next = new OfflineReservationRecovery(f.authority, f.dependencies);
    await next.release(capture.bundle);
    await acquireAdmissionMutation(
      f.directory,
      await f.dependencies.mutationExecutor(),
      async () => true,
    );
    const fenced = new OfflineReservationRecovery(f.authority, {
      ...f.dependencies,
      mutationOwnerExists: async () => true,
    });
    const count = f.reviews.length;
    await assert.rejects(fenced.finalize(capture.bundle), /mutation in progress/);
    assert.equal(f.reviews.length, count);
    assert.equal(readFileSync(f.marker, 'utf8'), f.markerBytes);
  } finally {
    f.close();
  }
});

test('different kernel boot + full prepared OpenCode/zero-attempt Codex archives honestly, then explicit finalize', async () => {
  const f = fixture(true);
  try {
    const before = f.databases.map(({ file }) => [readFileSync(file), readFileSync(`${file}-wal`)]);
    const capture = await f.capture();
    assert.ok(existsSync(join(capture.bundle, 'snapshot.json')));
    assert.equal(lstatSync(join(capture.bundle, 'snapshot.json')).mode & 0o777, 0o600);
    f.changeBoot();
    // A new administrative transaction after a simulated boot; same independently trusted key.
    const next = new OfflineReservationRecovery(f.authority, f.dependencies);
    const result = await next.release(capture.bundle);
    assert.equal(result.reason, 'non_dispatch');
    assert.equal(result.fence, 'external_kernel_boot_fence');
    assert.equal(result.admissionBlocked, true);
    assert.ok(existsSync(join(f.directory, RECOVERY_GATE)));
    assert.equal(readFileSync(f.marker, 'utf8'), f.markerBytes);
    assert.ok(!existsSync(join(f.directory, `recovered-${capture.operationId}.marker.json`)));
    const archive = JSON.parse(readFileSync(join(capture.bundle, 'archive.json'), 'utf8'));
    assert.equal(archive.current.journals[0].logical.attempts[0].state, 'prepared');
    assert.equal(archive.current.journals[0].logical.attempts[0].exit, undefined);
    assert.equal(archive.current.journals[1].logical.attempts.length, 0);
    assert.equal(archive.authority, 'administrative_recovery');
    for (const [slot, { file }] of f.databases.entries()) {
      assert.deepEqual(readFileSync(file), before[slot]![0]);
      assert.deepEqual(readFileSync(`${file}-wal`), before[slot]![1]);
    }
    assert.equal((await next.finalize(capture.bundle)).status, 'finalized');
    assert.equal(
      readFileSync(join(f.directory, `recovered-${capture.operationId}.marker.json`), 'utf8'),
      f.markerBytes,
    );
    assert.ok(!existsSync(f.marker));
    assert.ok(!existsSync(join(f.directory, RECOVERY_GATE)));
    assert.equal(f.reviews.length, 3);
    assert.match(f.fullReviews[1]!, /prepared/);
    assert.ok(f.fullReviews[1]!.includes(f.receiptFile));
    assert.match(f.fullReviews[2]!, /heldMarker/);
    assert.match(f.fullReviews[2]!, /final_commit_original_marker_retained/);
    await assert.rejects(next.release(capture.bundle));
    await assert.rejects(next.finalize(capture.bundle));
  } finally {
    f.close();
  }
});

test('same boot, sleep or app relaunch never supplies the kernel fence', async () => {
  const f = fixture();
  try {
    const capture = await f.capture();
    const relaunched = new OfflineReservationRecovery(f.authority, f.dependencies);
    await assert.rejects(relaunched.release(capture.bundle), /Different kernel boot/);
    assert.equal(readFileSync(f.marker, 'utf8'), f.markerBytes);
    assert.equal(f.reviews.length, 1);
  } finally {
    f.close();
  }
});

test('WAL checkpoint byte changes preserve exactly the same committed logical snapshot', async () => {
  const f = fixture(true);
  try {
    const capture = await f.capture();
    const before = readFileSync(f.databases[0]!.file);
    for (const { db } of f.databases) db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    assert.notDeepEqual(readFileSync(f.databases[0]!.file), before);
    f.changeBoot();
    assert.equal((await f.recovery.release(capture.bundle)).status, 'release_prepared');
  } finally {
    f.close();
  }
});

for (const phase of ['before_capture', 'after_capture', 'during_release_review'] as const)
  test(`late legacy controller starting ${phase} denies without exit/reclassification`, async () => {
    const f = fixture(true);
    try {
      const dispatch = () => f.databases[0]!.journal.transition(f.attemptId, 'starting');
      if (phase === 'before_capture') {
        dispatch();
        await assert.rejects(f.capture(), /non-dispatch/);
      } else {
        const capture = await f.capture();
        if (phase === 'after_capture') dispatch();
        else
          f.review((challenge) => {
            if (challenge.phase === 'release') dispatch();
          });
        f.changeBoot();
        await assert.rejects(f.recovery.release(capture.bundle));
      }
      assert.equal(readFileSync(f.marker, 'utf8'), f.markerBytes);
      assert.equal(f.databases[0]!.journal.read(f.attemptId)!.state, 'starting');
    } finally {
      f.close();
    }
  });

for (const fault of [
  'owner',
  'epoch',
  'manifest',
  'enrollment',
  'unknown',
  'corrupt',
  'append_uncertain',
  'schema',
] as const)
  test(`post-fence ${fault} change preserves marker and denies recovery`, async () => {
    const f = fixture(true);
    try {
      const capture = await f.capture();
      f.changeBoot();
      if (fault === 'owner')
        writeFileSync(
          f.marker,
          JSON.stringify({ version: 1, owner: randomUUID(), manifests: [f.manifests[0]] }),
        );
      if (fault === 'epoch')
        f.databases[0]!.db.prepare('UPDATE terminal_owner SET epoch=?').run(randomUUID());
      if (fault === 'manifest')
        writeFileSync(f.manifests[0]!, readFileSync(f.manifests[0]!, 'utf8') + '\n');
      if (fault === 'enrollment')
        writeFileSync(f.intentFile.replace('.json', '-new.json'), '{}', { mode: 0o600 });
      if (fault === 'unknown')
        f.databases[0]!.db.exec(
          "PRAGMA ignore_check_constraints=ON; UPDATE terminal_attempts SET state='unknown'",
        );
      if (fault === 'corrupt') writeFileSync(`${f.databases[0]!.file}-wal`, 'SYNTHETIC-CORRUPT');
      if (fault === 'append_uncertain')
        writeFileSync(
          f.receiptFile,
          JSON.stringify({
            ...f.receipt,
            receipt: {
              ...f.receipt.receipt,
              status: 'uncertain',
              reason: 'effect_uncertain',
              member: { ...f.receipt.receipt.member, status: 'uncertain' },
            },
          }),
        );
      if (fault === 'schema') f.databases[0]!.db.exec('UPDATE terminal_schema SET version=99');
      const marker = readFileSync(f.marker);
      await assert.rejects(f.recovery.release(capture.bundle));
      assert.deepEqual(readFileSync(f.marker), marker);
      assert.ok(existsSync(join(f.directory, RECOVERY_GATE)));
    } finally {
      f.close();
    }
  });

for (const stage of ['gate', 'capture', 'archive', 'receipt'] as const)
  test(`${stage} write/fsync failure retains effective administrative reservation and evidence`, async () => {
    const f = fixture();
    try {
      if (stage === 'gate' || stage === 'capture') {
        f.fault(stage);
        await assert.rejects(f.capture(), /SYNTHETIC/);
        assert.equal(readFileSync(f.marker, 'utf8'), f.markerBytes);
      } else {
        const capture = await f.capture();
        f.changeBoot();
        f.fault(stage);
        await assert.rejects(f.recovery.release(capture.bundle), /SYNTHETIC/);
        assert.equal(readFileSync(f.marker, 'utf8'), f.markerBytes);
        await assert.rejects(f.recovery.release(capture.bundle)); // no retry after uncertain effects
      }
      assert.equal(existsSync(join(f.directory, RECOVERY_GATE)), stage !== 'capture');
    } finally {
      f.close();
    }
  });

for (const phase of ['capture', 'release'] as const)
  test(`native ${phase} cancellation leaves original marker`, async () => {
    const f = fixture();
    try {
      if (phase === 'capture') {
        f.cancel();
        await assert.rejects(f.capture(), /approval/);
      } else {
        const capture = await f.capture();
        f.changeBoot();
        f.cancel();
        await assert.rejects(f.recovery.release(capture.bundle), /approval/);
        assert.ok(existsSync(join(f.directory, RECOVERY_GATE)));
      }
      assert.equal(readFileSync(f.marker, 'utf8'), f.markerBytes);
    } finally {
      f.close();
    }
  });

test('untrusted administrative key and generic runtime-domain signatures cannot authorize release', async () => {
  const f = fixture();
  try {
    const capture = await f.capture();
    f.changeBoot();
    const other = generateKeyPairSync('ed25519');
    const recovery = new OfflineReservationRecovery(
      { ...f.authority, publicKey: other.publicKey },
      f.dependencies,
    );
    await assert.rejects(recovery.release(capture.bundle), /Untrusted administrative/);
    const runtime = new OfflineReservationRecovery(
      { ...f.authority, sign: async () => ({ signature: 'true', validUntil: 30_001 }) },
      f.dependencies,
    );
    await assert.rejects(runtime.release(capture.bundle), /approval/);
    assert.equal(readFileSync(f.marker, 'utf8'), f.markerBytes);
  } finally {
    f.close();
  }
});

test('concurrent release obtains one persisted lock/attempt and never repeats review or effects', async () => {
  const f = fixture();
  try {
    const capture = await f.capture();
    f.changeBoot();
    const results = await Promise.allSettled([
      f.recovery.release(capture.bundle),
      f.recovery.release(capture.bundle),
    ]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(f.reviews.length, 2);
  } finally {
    f.close();
  }
});

for (const fault of ['symlink', 'privacy', 'budget', 'replaced_inode', 'capture_corrupt'] as const)
  test(`${fault} source or bundle fails closed`, async () => {
    const f = fixture();
    try {
      if (fault === 'capture_corrupt') {
        const capture = await f.capture();
        f.changeBoot();
        writeFileSync(join(capture.bundle, 'snapshot.json'), '{}');
        await assert.rejects(f.recovery.release(capture.bundle), /corrupt/);
      } else if (fault === 'replaced_inode') {
        f.review((challenge) => {
          if (challenge.phase === 'capture') {
            const replacement = `${f.marker}.replacement`;
            writeFileSync(replacement, f.markerBytes, { mode: 0o600 });
            renameSync(replacement, f.marker);
          }
        });
        await assert.rejects(f.capture(), /changed/);
      } else {
        if (fault === 'privacy') chmodSync(f.marker, 0o644);
        if (fault === 'budget') writeFileSync(f.marker, 'x'.repeat(16385));
        if (fault === 'symlink') {
          renameSync(f.marker, `${f.marker}.original`);
          symlinkSync(`${f.marker}.original`, f.marker);
        }
        await assert.rejects(f.capture());
      }
      assert.ok(existsSync(f.marker));
      assert.ok(!existsSync(join(f.root, 'NEVER-OPEN.sqlite')));
      assert.ok(!existsSync(join(f.root, 'DO-NOT-OPEN-AUTH')));
    } finally {
      f.close();
    }
  });

test('enrolled source inode drift refuses before review after only derived-0, with a fixed diagnostic', async () => {
  const f = fixture(true);
  try {
    const before = [
      f.marker,
      f.intentFile,
      f.receiptFile,
      ...f.manifests,
      ...f.databases.flatMap(({ file }) => [file, `${file}-wal`]),
    ].map((file) => [file, readFileSync(file)] as const);
    // Same content and manifest, different model-source inode: the frozen digest must still deny.
    const model = join(f.root, 'model.json');
    const bytes = readFileSync(model);
    renameSync(model, `${model}.preserved`);
    writeFileSync(model, bytes, { mode: 0o600 });
    await assert.rejects(f.capture(), (error: unknown) => {
      assert.ok(error instanceof OfflineEnrollmentBindingChanged);
      assert.deepEqual(administrativeBlockedOutcome(error), {
        status: 'blocked',
        outcome: 'unconfirmed',
        failure: { stage: 'inspection', code: 'enrollment_binding_changed' },
      });
      return true;
    });
    assert.equal(f.fullReviews.length, 0);
    assert.equal(f.reviews.length, 0);
    const bundle = join(f.recoveryRoot, readdirSync(f.recoveryRoot)[0]!);
    const inspection = readdirSync(bundle).find((name) => name.startsWith('inspection-'))!;
    assert.deepEqual(readdirSync(join(bundle, inspection)), ['derived-0.sqlite']);
    assert.ok(!existsSync(join(bundle, 'capture.json')));
    assert.ok(!existsSync(join(f.directory, RECOVERY_GATE)));
    for (const [file, original] of before) assert.deepEqual(readFileSync(file), original);
  } finally {
    f.close();
  }
});

test('pure WAL validation rejects truncated/corrupt/uncommitted frames and preserves source buffers', () => {
  const f = fixture(true);
  try {
    const base = readFileSync(f.databases[0]!.file);
    const wal = readFileSync(`${f.databases[0]!.file}-wal`);
    const original = Buffer.from(wal);
    assert.ok(committedTerminalImage(base, wal).length > base.length);
    assert.deepEqual(wal, original);
    for (const cut of [1, 16, 31, wal.length - 1])
      assert.throws(() => committedTerminalImage(base, wal.subarray(0, cut)));
    const corrupt = Buffer.from(wal);
    corrupt[corrupt.length - 1] = corrupt[corrupt.length - 1]! ^ 1;
    assert.throws(() => committedTerminalImage(base, corrupt), /checksum/);
    const badSalt = Buffer.from(wal);
    badSalt[40] = badSalt[40]! ^ 1;
    assert.throws(() => committedTerminalImage(base, badSalt), /binding/);
    const frameSize = wal.readUInt32BE(8) + 24;
    assert.equal(wal.readUInt32BE(36), 0);
    assert.throws(
      () => committedTerminalImage(base, wal.subarray(0, 32 + frameSize)),
      /Uncommitted/,
    );
  } finally {
    f.close();
  }
});

test('synthetic native approval releases exact kernel reservation once and records scoped absence', async () => {
  const f = fixture();
  try {
    writeFileSync(
      f.marker,
      JSON.stringify({ version: 1, owner: f.owner, epoch: f.epoch, manifests: [f.manifests[0]] }),
      { mode: 0o600 },
    );
    f.databases[0]!.journal.transition(f.attemptId, 'starting');
    const binding = {
      instanceId: f.attemptId,
      epoch: f.epoch,
      manifestDigest: 'a'.repeat(64),
      configDigest: terminalDigest(readFileSync(f.manifests[0]!)),
    };
    const fd = createLifecycleReceipt(f.configs[0]!.state, binding);
    const lifecycle = armLifecycleReceipt(fd, binding.configDigest);
    await lifecycle.record({ type: 'started' });
    closeSync(fd);
    const core = {
      boot: randomUUID(),
      pid: 100,
      ppid: 1,
      uid: 501,
      startSec: 1,
      startUsec: 1,
      sid: 100,
      pgid: 100,
    };
    const host = { ...core, pid: 101, ppid: 100, startUsec: 2 };
    const leader = { ...host, pid: 102, ppid: 101, startUsec: 3, sid: 102, pgid: 102 };
    const writer = createKernelLifecycleReceipt(f.configs[0]!.state, {
      ...binding,
      owner: f.owner,
    });
    writer.core(core);
    writer.host(host);
    writer.leader(leader);
    writer.close();
    const before = lstatSync(f.marker, { bigint: true });
    const scratch1 = join(f.root, 'kernel-one');
    const scratch2 = join(f.root, 'kernel-two');
    mkdirSync(scratch1, { mode: 0o700 });
    mkdirSync(scratch2, { mode: 0o700 });
    let scans = 0;
    let reviews = 0;
    const result = await releaseKernelReservation(f.directory, scratch1, scratch2, {
      mutationExecutor: async () => ({
        ...core,
        pid: process.pid,
        ppid: process.ppid,
        uid: process.getuid!(),
      }),
      mutationOwnerExists: async () => true,
      scan: async (identities, sessions) => {
        scans++;
        assert.equal(identities.length, 3);
        assert.deepEqual(sessions, [102]);
        return { processCount: 10, intervalMs: 100, scans: 2 };
      },
      review: async (intent) => {
        reviews++;
        assert.equal(intent.limitation, 'descendants_not_validated');
        return true;
      },
      revalidate: async () => true,
      rename: async (lock) => {
        renameSync(f.marker, join(f.directory, lock.destination));
      },
    });
    assert.equal(scans, 2);
    assert.equal(reviews, 1);
    assert.equal(result.reason, 'absence_proven');
    assert.equal(result.limitation, 'descendants_not_validated');
    assert.equal(
      lstatSync(join(f.directory, result.archivedMarker), { bigint: true }).ino,
      before.ino,
    );
    assert.equal(existsSync(f.marker), false);
    const name = `release-${before.dev}-${before.ino}-${terminalDigest(f.markerBytes)}.lock`;
    // The fixture updates marker bytes above, so find the exact stored lock from its directory.
    const lock = readdirSync(f.directory).find(
      (entry) => entry.startsWith('release-') && entry.endsWith('.lock'),
    )!;
    assert.notEqual(lock, name);
    assert.equal(reconcileKernelRelease(f.directory, lock).status, 'released');
    assert.equal(f.databases[0]!.journal.read(f.attemptId)?.state, 'starting');
  } finally {
    f.close();
  }
});

test('legacy missing kernel identity does not create a per-marker release lock', async () => {
  const f = fixture();
  try {
    const first = join(f.root, 'legacy-kernel-one');
    const second = join(f.root, 'legacy-kernel-two');
    mkdirSync(first, { mode: 0o700 });
    mkdirSync(second, { mode: 0o700 });
    await assert.rejects(
      releaseKernelReservation(f.directory, first, second, {
        mutationExecutor: f.dependencies.mutationExecutor,
        mutationOwnerExists: f.dependencies.mutationOwnerExists,
        scan: async () => {
          throw new Error('Unexpected scan');
        },
        review: async () => {
          throw new Error('Unexpected review');
        },
        revalidate: async () => false,
        rename: async () => {
          throw new Error('Unexpected rename');
        },
      }),
    );
    assert.equal(
      readdirSync(f.directory).some(
        (name) => name.startsWith('release-') && name.endsWith('.lock'),
      ),
      false,
    );
    assert.equal(readFileSync(f.marker, 'utf8'), f.markerBytes);
    const offline = join(f.root, 'legacy-still-offline');
    mkdirSync(offline, { mode: 0o700 });
    assert.doesNotThrow(() => snapshotOfflineReservation(f.directory, offline));
  } finally {
    f.close();
  }
});

test('private helper completes one synthetic native review through its inherited pipe', async () => {
  if (process.platform !== 'darwin') return;
  const f = fixture(false, undefined, false, 'managed-agents');
  try {
    writeFileSync(
      f.marker,
      JSON.stringify({ version: 1, owner: f.owner, epoch: f.epoch, manifests: [f.manifests[0]] }),
      { mode: 0o600 },
    );
    f.databases[0]!.journal.transition(f.attemptId, 'starting');
    const binding = {
      instanceId: f.attemptId,
      epoch: f.epoch,
      manifestDigest: 'a'.repeat(64),
      configDigest: terminalDigest(readFileSync(f.manifests[0]!)),
    };
    const fd = createLifecycleReceipt(f.configs[0]!.state, binding);
    const lifecycle = armLifecycleReceipt(fd, binding.configDigest);
    await lifecycle.record({ type: 'started' });
    closeSync(fd);
    const core = {
      boot: randomUUID(),
      pid: 100,
      ppid: 1,
      uid: 501,
      startSec: 1,
      startUsec: 1,
      sid: 100,
      pgid: 100,
    };
    const host = { ...core, pid: 101, ppid: 100, startUsec: 2 };
    const leader = { ...host, pid: 102, ppid: 101, startUsec: 3, sid: 102, pgid: 102 };
    const receipt = createKernelLifecycleReceipt(f.configs[0]!.state, {
      ...binding,
      owner: f.owner,
    });
    receipt.core(core);
    receipt.host(host);
    receipt.leader(leader);
    receipt.close();
    const script = join(f.root, 'synthetic-release-helper.cjs');
    await build({
      entryPoints: ['apps/desktop/src/tauri-kernel-release-host.ts'],
      outfile: script,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'node24',
    });
    const requests: string[] = [];
    const result = await new Promise<{ ok: boolean }>((resolve, reject) => {
      const child = spawn(process.execPath, [script, f.root], { stdio: ['pipe', 'pipe', 'pipe'] });
      let buffer = '';
      const timeout = setTimeout(() => {
        child.kill();
        reject(new Error('Synthetic helper timed out'));
      }, 5000);
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        buffer += chunk;
        for (let end = buffer.indexOf('\n'); end >= 0; end = buffer.indexOf('\n')) {
          const frame = JSON.parse(buffer.slice(0, end)) as {
            kind: string;
            id: string;
            operation: string;
            lock?: { destination: string };
            ok?: boolean;
          };
          buffer = buffer.slice(end + 1);
          if (frame.kind === 'complete') {
            clearTimeout(timeout);
            resolve({ ok: frame.ok === true });
            continue;
          }
          requests.push(frame.operation);
          let value: unknown = null;
          if (frame.operation === 'executor')
            value = { ...core, pid: process.pid, ppid: process.ppid, uid: process.getuid!() };
          else if (frame.operation === 'scan')
            value = { processCount: 10, intervalMs: 100, scans: 2 };
          else if (frame.operation === 'review' || frame.operation === 'revalidate') value = true;
          else if (frame.operation === 'rename' && frame.lock) {
            renameSync(f.marker, join(f.directory, frame.lock.destination));
            value = true;
          }
          child.stdin.write(JSON.stringify({ kind: 'reply', id: frame.id, value }) + '\n');
        }
      });
      child.once('error', reject);
    });
    assert.equal(result.ok, true);
    assert.deepEqual(requests, ['executor', 'scan', 'review', 'scan', 'revalidate', 'rename']);
    assert.equal(existsSync(f.marker), false);
  } finally {
    f.close();
  }
});

test('kernel snapshot binds every recorded dispatch and preserves unknown journal state', async () => {
  const f = fixture();
  try {
    writeFileSync(
      f.marker,
      JSON.stringify({ version: 1, owner: f.owner, epoch: f.epoch, manifests: [f.manifests[0]] }),
      { mode: 0o600 },
    );
    f.databases[0]!.journal.transition(f.attemptId, 'starting');
    const binding = {
      instanceId: f.attemptId,
      epoch: f.epoch,
      manifestDigest: 'a'.repeat(64),
      configDigest: terminalDigest(readFileSync(f.manifests[0]!)),
    };
    const fd = createLifecycleReceipt(f.configs[0]!.state, binding);
    const lifecycle = armLifecycleReceipt(fd, binding.configDigest);
    await lifecycle.record({ type: 'started' });
    closeSync(fd);
    const core = {
      boot: randomUUID(),
      pid: 100,
      ppid: 1,
      uid: 501,
      startSec: 1,
      startUsec: 1,
      sid: 100,
      pgid: 100,
    };
    const host = { ...core, pid: 101, ppid: 100, startUsec: 2 };
    const leader = { ...host, pid: 102, ppid: 101, startUsec: 3, sid: 102, pgid: 102 };
    const writer = createKernelLifecycleReceipt(f.configs[0]!.state, {
      ...binding,
      owner: f.owner,
    });
    writer.core(core);
    writer.host(host);
    writer.leader(leader);
    writer.close();
    const scratch = join(f.root, 'kernel-scratch');
    mkdirSync(scratch, { mode: 0o700 });
    const result = snapshotKernelReservation(f.directory, scratch);
    assert.equal(result.receipts.length, 1);
    assert.deepEqual(result.receipts[0]!.core, core);
    assert.equal(result.snapshot.journals[0]!.logical.attempts[0]!.state, 'starting');
    assert.equal(result.snapshot.journals[0]!.logical.attempts[0]!.exit, undefined);
    const other = join(f.root, 'offline-scratch');
    mkdirSync(other, { mode: 0o700 });
    assert.throws(() => snapshotOfflineReservation(f.directory, other), /lifecycle/);
  } finally {
    f.close();
  }
});

test('offline snapshot refuses an active kernel lock on the same marker', () => {
  const f = fixture();
  try {
    beginKernelRelease(f.directory);
    const scratch = join(f.root, 'offline-kernel-fence');
    mkdirSync(scratch, { mode: 0o700 });
    assert.throws(
      () => snapshotOfflineReservation(f.directory, scratch),
      /Kernel reservation recovery/,
    );
    assert.equal(readFileSync(f.marker, 'utf8'), f.markerBytes);
  } finally {
    f.close();
  }
});

test('full source directory membership detects a lifecycle receipt instead of treating absence as exit', () => {
  const f = fixture();
  try {
    writeFileSync(join(f.configs[0]!.state, 'lifecycle-SYNTHETIC.jsonl'), 'SYNTHETIC', {
      mode: 0o600,
    });
    const scratch = join(f.root, 'scratch');
    mkdirSync(scratch, { mode: 0o700 });
    assert.throws(() => snapshotOfflineReservation(f.directory, scratch), /lifecycle/);
    assert.deepEqual(readdirSync(f.recoveryRoot), []);
  } finally {
    f.close();
  }
});

for (const syncNumber of [2, 3, 4, 5, 6, 7])
  test(`capture fsync syscall failure ${syncNumber} keeps original reservation before publishing any incomplete capture`, async () => {
    const f = fixture();
    try {
      f.failSyncAt(syncNumber);
      await assert.rejects(f.capture(), /fsync failure/);
      assert.equal(readFileSync(f.marker, 'utf8'), f.markerBytes);
      assert.equal(existsSync(join(f.directory, RECOVERY_GATE)), syncNumber >= 6);
      assert.throws(() => desktopAgentsAdmission(f.directory));
    } finally {
      f.close();
    }
  });

for (const syncNumber of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
  test(`release fsync syscall failure ${syncNumber} preserves evidence and requires fresh explicit authority`, async () => {
    const f = fixture();
    try {
      const capture = await f.capture();
      f.changeBoot();
      f.failSyncAt(syncNumber);
      await assert.rejects(f.recovery.release(capture.bundle), /fsync failure/);
      assert.ok(
        existsSync(f.marker) ||
          existsSync(join(f.directory, `recovered-${capture.operationId}.marker.json`)),
      );
      assert.ok(existsSync(join(f.directory, RECOVERY_GATE)));
      assert.throws(() => desktopAgentsAdmission(f.directory));
      if (syncNumber >= 3 && syncNumber <= 6) {
        const reviews = f.reviews.length;
        assert.equal((await f.recovery.release(capture.bundle)).status, 'release_prepared');
        assert.ok(f.reviews.length > reviews); // Known control-only failure is not approval.
      } else await assert.rejects(f.recovery.release(capture.bundle));
    } finally {
      f.close();
    }
  });

test('gate blocks new and already-constructed admission, owned append and prepared retirement finalizers', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'orqst-SYNTHETIC-recovery-gate-')));
  try {
    const epoch = randomUUID();
    const early = desktopAgentsAdmission(root, ['/SYNTHETIC/initial.json'], epoch);
    early.claim();
    const finishRetire = early.prepareRelease({ fixture: 'SYNTHETIC' });
    writeFileSync(join(root, RECOVERY_GATE), '{}', { mode: 0o600 });
    assert.throws(() => early.preflight());
    assert.throws(() => early.claim());
    assert.throws(() => early.assertOwner());
    assert.throws(() => finishRetire());
    assert.throws(() => early.prepareRelease({}));
    assert.throws(() =>
      inspectDesktopAdmission(root, {
        owner: early.owner,
        epoch,
        initialFiles: ['/SYNTHETIC/initial.json'],
      }),
    );
    assert.ok(existsSync(join(root, 'active-pair.json')));
    assert.throws(() => desktopAgentsAdmission(root));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('late new-controller claim cannot cross the sticky gate even when constructed before reservation', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'orqst-SYNTHETIC-late-controller-')));
  try {
    const early = desktopAgentsAdmission(root);
    writeFileSync(join(root, RECOVERY_GATE), '{}', { mode: 0o600 });
    assert.throws(() => early.claim());
    assert.ok(!existsSync(join(root, 'active-pair.json')));
    assert.throws(() => inspectDesktopAdmission(root));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

for (const state of ['running', 'ownership_lost', 'exited', 'start_failed'] as const)
  test(`historical ${state} is not relabeled non-dispatch`, async () => {
    const f = fixture();
    try {
      const journal = f.databases[0]!.journal;
      if (state === 'start_failed') journal.transition(f.attemptId, state);
      else {
        journal.transition(f.attemptId, 'starting');
        if (state === 'running') journal.transition(f.attemptId, state);
        else if (state === 'exited') journal.transition(f.attemptId, state, { exitCode: 0 });
        else journal.transition(f.attemptId, state);
      }
      await assert.rejects(f.capture(), /non-dispatch/);
      assert.equal(journal.read(f.attemptId)!.state, state);
      assert.equal(readFileSync(f.marker, 'utf8'), f.markerBytes);
    } finally {
      f.close();
    }
  });

for (const change of ['journal', 'enrollment', 'held_marker', 'archive', 'receipt'] as const)
  test(`finalize denies changed ${change} after marker archive`, async () => {
    const f = fixture();
    try {
      const capture = await f.capture();
      f.changeBoot();
      await f.recovery.release(capture.bundle);
      if (change === 'journal') f.databases[0]!.journal.transition(f.attemptId, 'starting');
      if (change === 'enrollment')
        writeFileSync(join(f.directory, 'enrollment-SYNTHETIC-new.json'), '{}', { mode: 0o600 });
      if (change === 'held_marker')
        writeFileSync(join(f.directory, `recovered-${capture.operationId}.marker.json`), '{}');
      if (change === 'archive') writeFileSync(join(capture.bundle, 'archive.json'), '{}');
      if (change === 'receipt') writeFileSync(join(capture.bundle, 'receipt.json'), '{}');
      await assert.rejects(f.recovery.finalize(capture.bundle));
      assert.ok(existsSync(join(f.directory, RECOVERY_GATE)));
      assert.throws(() => desktopAgentsAdmission(f.directory));
    } finally {
      f.close();
    }
  });

test('expired capture review cannot authorize any gate or release', async () => {
  const f = fixture();
  try {
    f.review(() => f.advance(30_001));
    await assert.rejects(f.capture(), /expired/);
    assert.equal(readFileSync(f.marker, 'utf8'), f.markerBytes);
    assert.ok(!existsSync(join(f.directory, RECOVERY_GATE)));
  } finally {
    f.close();
  }
});

test('changing unsigned snapshotHash cannot repair a corrupted administrative capture signature', async () => {
  const f = fixture();
  try {
    const capture = await f.capture();
    f.changeBoot();
    const file = join(capture.bundle, 'snapshot.json');
    const saved = readFileSync(file, 'utf8') + '\n';
    writeFileSync(file, saved);
    const recordFile = join(capture.bundle, 'capture.json');
    const record = JSON.parse(readFileSync(recordFile, 'utf8'));
    record.snapshotHash = terminalDigest(saved);
    writeFileSync(recordFile, JSON.stringify(record));
    await assert.rejects(f.recovery.release(capture.bundle), /corrupt/);
    assert.equal(readFileSync(f.marker, 'utf8'), f.markerBytes);
  } finally {
    f.close();
  }
});

test('an existing or symlinked operation lock is never reclaimed', async () => {
  const f = fixture();
  try {
    const capture = await f.capture();
    f.changeBoot();
    symlinkSync(f.marker, join(f.directory, 'offline-recovery-operation.lock'));
    await assert.rejects(f.recovery.release(capture.bundle));
    assert.equal(readFileSync(f.marker, 'utf8'), f.markerBytes);
    assert.throws(() => desktopAgentsAdmission(f.directory));
  } finally {
    f.close();
  }
});

test('prior uncertain runtime archive fails capture closed', async () => {
  const f = fixture();
  try {
    writeFileSync(join(f.directory, `retired-${f.owner}-SYNTHETIC.json`), '{}', { mode: 0o600 });
    await assert.rejects(f.capture(), /uncertain/);
    assert.equal(readFileSync(f.marker, 'utf8'), f.markerBytes);
  } finally {
    f.close();
  }
});

test('entry budget bounds enumeration before any gate or original file mutation', async () => {
  const f = fixture();
  try {
    for (let index = 0; index < 257; index++)
      writeFileSync(join(f.directory, `SYNTHETIC-${index}`), '', { mode: 0o600 });
    await assert.rejects(f.capture(), /entry budget/);
    assert.equal(readFileSync(f.marker, 'utf8'), f.markerBytes);
    assert.ok(!existsSync(join(f.directory, RECOVERY_GATE)));
  } finally {
    f.close();
  }
});

test('private capture includes original bytes while complete native review omits database content', async () => {
  const f = fixture();
  try {
    const secret = 'SYNTHETIC-PRIVATE-CONTENT-NEVER-LOG';
    f.databases[0]!.db.exec('CREATE TABLE synthetic_content (body TEXT)');
    f.databases[0]!.db.prepare('INSERT INTO synthetic_content VALUES (?)').run(secret);
    const capture = await f.capture();
    assert.ok(!f.fullReviews[0]!.includes(secret));
    const snapshot = JSON.parse(readFileSync(join(capture.bundle, 'snapshot.json'), 'utf8'));
    const base = snapshot.files.find(
      (file: { path: string }) => file.path === f.databases[0]!.file,
    );
    assert.ok(Buffer.from(base.bytes, 'base64').includes(Buffer.from(secret)));
    assert.equal(lstatSync(join(capture.bundle, 'snapshot.json')).mode & 0o777, 0o600);
    assert.equal(lstatSync(capture.bundle).mode & 0o777, 0o700);
  } finally {
    f.close();
  }
});

test('exclusive archive write failure cannot move or release the original marker', async () => {
  const f = fixture();
  try {
    const capture = await f.capture();
    f.changeBoot();
    writeFileSync(join(capture.bundle, 'archive.json'), 'SYNTHETIC-PRESERVED', { mode: 0o600 });
    await assert.rejects(f.recovery.release(capture.bundle));
    assert.equal(readFileSync(f.marker, 'utf8'), f.markerBytes);
    assert.equal(readFileSync(join(capture.bundle, 'archive.json'), 'utf8'), 'SYNTHETIC-PRESERVED');
    assert.ok(existsSync(join(f.directory, RECOVERY_GATE)));
  } finally {
    f.close();
  }
});

test('identical-byte held marker inode replacement cannot finalize recovery', async () => {
  const f = fixture();
  try {
    const capture = await f.capture();
    f.changeBoot();
    await f.recovery.release(capture.bundle);
    f.fault('after_marker');
    await assert.rejects(f.recovery.finalize(capture.bundle));
    f.clearFault();
    const held = join(f.directory, `recovered-${capture.operationId}.marker.json`);
    const replacement = `${held}.SYNTHETIC`;
    writeFileSync(replacement, readFileSync(held), { mode: 0o600 });
    renameSync(replacement, held);
    await assert.rejects(f.recovery.finalize(capture.bundle), /identity/);
    assert.ok(existsSync(join(f.directory, RECOVERY_GATE)));
  } finally {
    f.close();
  }
});

for (const mode of ['cancel', 'expired'] as const)
  test(`explicit release review after ${mode} uses a new nonce and no inherited consent`, async () => {
    const f = fixture();
    try {
      const capture = await f.capture();
      f.changeBoot();
      if (mode === 'cancel') f.cancel();
      else f.review(() => f.advance(30_001));
      await assert.rejects(f.recovery.release(capture.bundle), /approval/);
      const denied = f.reviews.at(-1)!;
      assert.ok(!existsSync(join(capture.bundle, 'archive.json')));
      assert.equal(readFileSync(f.marker, 'utf8'), f.markerBytes);
      assert.ok(existsSync(join(f.directory, RECOVERY_GATE)));
      f.allow();
      const next = new OfflineReservationRecovery(f.authority, f.dependencies);
      const result = await next.release(capture.bundle);
      assert.equal(result.status, 'release_prepared');
      assert.notEqual(f.reviews.at(-1)!.nonce, denied.nonce);
      assert.equal((await next.finalize(capture.bundle)).status, 'finalized');
    } finally {
      f.close();
    }
  });

for (const stage of ['capture', 'gate'] as const)
  test(`signed capture interrupted at ${stage} has an explicit continuation`, async () => {
    const f = fixture();
    try {
      f.fault(stage);
      await assert.rejects(f.capture());
      const bundle = join(f.recoveryRoot, readdirSync(f.recoveryRoot)[0]!);
      assert.ok(existsSync(join(bundle, 'capture.json')));
      assert.ok(existsSync(join(bundle, 'snapshot.json')));
      assert.equal(readFileSync(f.marker, 'utf8'), f.markerBytes);
      f.clearFault();
      const next = new OfflineReservationRecovery(f.authority, f.dependencies);
      assert.equal((await next.continueCapture(bundle)).admissionBlocked, true);
      f.changeBoot();
      assert.equal((await next.release(bundle)).status, 'release_prepared');
    } finally {
      f.close();
    }
  });

test('partial pre-gate capture does not publish a gate or consume the original reservation', async () => {
  const f = fixture();
  try {
    f.fault('capture');
    await assert.rejects(f.capture());
    const bundle = join(f.recoveryRoot, readdirSync(f.recoveryRoot)[0]!);
    writeFileSync(join(bundle, 'capture.json'), '{');
    const next = new OfflineReservationRecovery(f.authority, f.dependencies);
    await assert.rejects(next.continueCapture(bundle), /missing_or_partial_capture/);
    assert.ok(!existsSync(join(f.directory, RECOVERY_GATE)));
    assert.equal(readFileSync(f.marker, 'utf8'), f.markerBytes);
    f.clearFault();
    const fresh = await f.capture();
    assert.notEqual(fresh.bundle, bundle);
    assert.equal(readFileSync(join(bundle, 'capture.json'), 'utf8'), '{');
  } finally {
    f.close();
  }
});

test('legacy gate with partial capture remains ambiguous and is never adopted or erased', async () => {
  const f = fixture();
  try {
    f.fault('gate');
    await assert.rejects(f.capture());
    const gate = readFileSync(join(f.directory, RECOVERY_GATE));
    const bundle = join(f.recoveryRoot, readdirSync(f.recoveryRoot)[0]!);
    writeFileSync(join(bundle, 'capture.json'), '{');
    const next = new OfflineReservationRecovery(f.authority, f.dependencies);
    await assert.rejects(next.continueCapture(bundle), /missing_or_partial_capture/);
    await assert.rejects(next.continueRelease(bundle), /missing_or_partial_capture/);
    assert.deepEqual(readFileSync(join(f.directory, RECOVERY_GATE)), gate);
    assert.equal(readFileSync(f.marker, 'utf8'), f.markerBytes);
  } finally {
    f.close();
  }
});

for (const stage of ['archive', 'receipt'] as const)
  for (const caller of ['same_returned_helper', 'new_boot_helper'] as const)
    test(`explicit continuation of durable ${stage} from ${caller} neither overwrites nor invents exit`, async () => {
      const f = fixture();
      try {
        const capture = await f.capture();
        f.changeBoot();
        f.fault(stage);
        await assert.rejects(f.recovery.release(capture.bundle));
        const archived = readFileSync(join(capture.bundle, 'archive.json'));
        const blocked = new OfflineReservationRecovery(f.authority, f.dependencies);
        await assert.rejects(
          blocked.continueRelease(capture.bundle),
          /same_boot_helper_fence_required/,
        );
        f.clearFault();
        let next = f.recovery;
        if (caller === 'new_boot_helper') {
          f.changeBoot();
          next = new OfflineReservationRecovery(f.authority, f.dependencies);
        }
        const reviewCount = f.reviews.length;
        const result = await next.continueRelease(capture.bundle);
        assert.equal(result.status, 'release_prepared');
        assert.equal(f.reviews.length, reviewCount + 1);
        assert.deepEqual(readFileSync(join(capture.bundle, 'archive.json')), archived);
        assert.equal(f.databases[0]!.journal.read(f.attemptId)!.state, 'prepared');
        assert.ok(existsSync(join(f.directory, RECOVERY_GATE)));
        assert.equal((await next.finalize(capture.bundle)).status, 'finalized');
        await assert.rejects(next.continueRelease(capture.bundle));
        await assert.rejects(next.finalize(capture.bundle));
      } finally {
        f.close();
      }
    });

for (const mode of ['cancel', 'expired'] as const)
  test(`finalization ${mode} retains admission and permits a new explicit native review`, async () => {
    const f = fixture();
    try {
      const capture = await f.capture();
      f.changeBoot();
      await f.recovery.release(capture.bundle);
      if (mode === 'cancel') f.cancel();
      else f.review(() => f.advance(30_001));
      await assert.rejects(f.recovery.finalize(capture.bundle), /approval/);
      assert.ok(existsSync(join(f.directory, RECOVERY_GATE)));
      assert.ok(!existsSync(join(capture.bundle, 'finalized.json')));
      f.allow();
      const next = new OfflineReservationRecovery(f.authority, f.dependencies);
      assert.equal((await next.finalize(capture.bundle)).status, 'finalized');
    } finally {
      f.close();
    }
  });

test('finalization continues after durable authority and interrupted lock unlink fsync on a new boot', async () => {
  const f = fixture();
  try {
    const capture = await f.capture();
    f.changeBoot();
    await f.recovery.release(capture.bundle);
    const interrupted = new OfflineReservationRecovery(f.authority, {
      ...f.dependencies,
      sync: (fd) => {
        if (
          fstatSync(fd).isDirectory() &&
          existsSync(join(f.directory, `recovered-${capture.operationId}.marker.json`)) &&
          !existsSync(join(f.directory, 'offline-recovery-operation.lock')) &&
          existsSync(join(f.directory, RECOVERY_GATE))
        )
          throw new Error('SYNTHETIC fsync failure');
        fsyncSync(fd);
      },
    });
    await assert.rejects(interrupted.finalize(capture.bundle), /namespace_commit_observed/);
    assert.ok(existsSync(join(capture.bundle, 'finalized.json')));
    assert.ok(!existsSync(join(f.directory, 'offline-recovery-operation.lock')));
    assert.ok(existsSync(join(f.directory, RECOVERY_GATE)));
    f.clearFault();
    f.changeBoot();
    const next = new OfflineReservationRecovery(f.authority, f.dependencies);
    assert.equal((await next.finalize(capture.bundle)).status, 'finalized');
  } finally {
    f.close();
  }
});

test('a later boot between release and finalize requires fresh finalization approval', async () => {
  const f = fixture();
  try {
    const capture = await f.capture();
    f.changeBoot();
    const receipt = await f.recovery.release(capture.bundle);
    f.changeBoot();
    const next = new OfflineReservationRecovery(f.authority, f.dependencies);
    assert.equal((await next.finalize(capture.bundle)).status, 'finalized');
    assert.equal(f.reviews.at(-1)!.phase, 'finalize');
    assert.notEqual(f.reviews.at(-1)!.currentBoot, receipt.currentBoot);
  } finally {
    f.close();
  }
});

test('owner change after archive blocks continuation before another approval', async () => {
  const f = fixture();
  try {
    const capture = await f.capture();
    f.changeBoot();
    f.fault('archive');
    await assert.rejects(f.recovery.release(capture.bundle));
    f.clearFault();
    writeFileSync(
      f.marker,
      JSON.stringify({ version: 1, owner: randomUUID(), manifests: [f.manifests[0]] }),
    );
    const reviews = f.reviews.length;
    await assert.rejects(f.recovery.continueRelease(capture.bundle));
    assert.equal(f.reviews.length, reviews);
    assert.ok(existsSync(join(f.directory, RECOVERY_GATE)));
  } finally {
    f.close();
  }
});

test('concurrent continuations on a later boot admit one fresh review', async () => {
  const f = fixture();
  try {
    const capture = await f.capture();
    f.changeBoot();
    f.fault('archive');
    await assert.rejects(f.recovery.release(capture.bundle));
    f.clearFault();
    f.changeBoot();
    const first = new OfflineReservationRecovery(f.authority, f.dependencies);
    const second = new OfflineReservationRecovery(f.authority, f.dependencies);
    const reviews = f.reviews.length;
    const results = await Promise.allSettled([
      first.continueRelease(capture.bundle),
      second.continueRelease(capture.bundle),
    ]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(f.reviews.length, reviews + 1);
  } finally {
    f.close();
  }
});

test('partial archive is preserved and cannot authorize continuation or marker removal', async () => {
  const f = fixture();
  try {
    const capture = await f.capture();
    f.changeBoot();
    f.fault('archive');
    await assert.rejects(f.recovery.release(capture.bundle));
    f.clearFault();
    writeFileSync(join(capture.bundle, 'archive.json'), '{');
    await assert.rejects(f.recovery.continueRelease(capture.bundle));
    assert.equal(readFileSync(join(capture.bundle, 'archive.json'), 'utf8'), '{');
    assert.equal(readFileSync(f.marker, 'utf8'), f.markerBytes);
  } finally {
    f.close();
  }
});

for (const file of ['archive.json', 'receipt-prepared.json'] as const)
  test(`continuation must re-fsync complete but uncertain ${file} before moving the marker`, async () => {
    const f = fixture();
    try {
      const capture = await f.capture();
      f.changeBoot();
      const path = join(capture.bundle, file);
      f.failFileSync(path);
      await assert.rejects(f.recovery.release(capture.bundle), /fsync/);
      const bytes = readFileSync(path);
      await assert.rejects(f.recovery.continueRelease(capture.bundle), /fsync/);
      assert.equal(readFileSync(f.marker, 'utf8'), f.markerBytes);
      assert.deepEqual(readFileSync(path), bytes);
      f.clearFault();
      assert.equal((await f.recovery.continueRelease(capture.bundle)).status, 'release_prepared');
    } finally {
      f.close();
    }
  });

test('capture continuation confirms signed file durability before publishing a gate', async () => {
  const f = fixture();
  try {
    f.review((challenge) => f.failFileSync(join(challenge.bundle, 'capture.json')));
    await assert.rejects(f.capture(), /fsync/);
    const bundle = join(f.recoveryRoot, readdirSync(f.recoveryRoot)[0]!);
    f.allow();
    const next = new OfflineReservationRecovery(f.authority, f.dependencies);
    await assert.rejects(next.continueCapture(bundle), /fsync/);
    assert.ok(!existsSync(join(f.directory, RECOVERY_GATE)));
    f.clearFault();
    assert.equal((await next.continueCapture(bundle)).admissionBlocked, true);
  } finally {
    f.close();
  }
});

test('finalization re-fsyncs the exact released receipt before removing admission controls', async () => {
  const f = fixture();
  try {
    const capture = await f.capture();
    f.changeBoot();
    await f.recovery.release(capture.bundle);
    f.failFileSync(join(capture.bundle, 'receipt.json'));
    await assert.rejects(f.recovery.finalize(capture.bundle), /fsync/);
    assert.ok(existsSync(join(f.directory, RECOVERY_GATE)));
    assert.ok(existsSync(join(f.directory, 'offline-recovery-operation.lock')));
    f.clearFault();
    const next = new OfflineReservationRecovery(f.authority, f.dependencies);
    assert.equal((await next.finalize(capture.bundle)).status, 'finalized');
  } finally {
    f.close();
  }
});

test('replacement of the retained operation lease cannot inherit continuation ownership', async () => {
  const f = fixture();
  try {
    const capture = await f.capture();
    f.changeBoot();
    f.fault('archive');
    await assert.rejects(f.recovery.release(capture.bundle));
    f.clearFault();
    const name = readdirSync(capture.bundle).find((name) => /^operation-.*\.lock$/.test(name))!;
    const file = join(capture.bundle, name);
    const replacement = file + '.replacement';
    writeFileSync(replacement, readFileSync(file), { mode: 0o600 });
    renameSync(replacement, file);
    await assert.rejects(f.recovery.continueRelease(capture.bundle), /operation_lease_changed/);
    assert.equal(readFileSync(f.marker, 'utf8'), f.markerBytes);
  } finally {
    f.close();
  }
});

for (const state of ['capture_only', 'cancelled_release'] as const)
  test(`explicit pre-effect abort from ${state} preserves the original global reservation`, async () => {
    const f = fixture();
    try {
      const capture = await f.capture();
      if (state === 'cancelled_release') {
        f.changeBoot();
        f.cancel();
        await assert.rejects(f.recovery.release(capture.bundle));
        f.allow();
      }
      const before = f.databases.map(({ file }) => readFileSync(file));
      const result = await f.recovery.abort(capture.bundle);
      assert.equal(result.originalReservationPreserved, true);
      assert.equal(readFileSync(f.marker, 'utf8'), f.markerBytes);
      for (const [index, { file }] of f.databases.entries())
        assert.deepEqual(readFileSync(file), before[index]);
      assert.ok(!existsSync(join(f.directory, RECOVERY_GATE)));
      assert.throws(() => desktopAgentsAdmission(f.directory)); // The original reservation still blocks Open.
      await assert.rejects(f.recovery.continueCapture(capture.bundle), /operation_aborted/);
      await assert.rejects(f.recovery.release(capture.bundle), /operation_aborted/);
    } finally {
      f.close();
    }
  });

test('abort cancellation is not permission to remove controls and can be reviewed again explicitly', async () => {
  const f = fixture();
  try {
    const capture = await f.capture();
    f.cancel();
    await assert.rejects(f.recovery.abort(capture.bundle), /approval/);
    assert.ok(existsSync(join(f.directory, RECOVERY_GATE)));
    assert.ok(!existsSync(join(capture.bundle, 'aborted.json')));
    f.allow();
    const next = new OfflineReservationRecovery(f.authority, f.dependencies);
    assert.equal((await next.abort(capture.bundle)).status, 'aborted');
    assert.equal(readFileSync(f.marker, 'utf8'), f.markerBytes);
  } finally {
    f.close();
  }
});

test('an archive effect forbids aborting controls even before marker rename', async () => {
  const f = fixture();
  try {
    const capture = await f.capture();
    f.changeBoot();
    f.fault('archive');
    await assert.rejects(f.recovery.release(capture.bundle));
    f.clearFault();
    await assert.rejects(f.recovery.abort(capture.bundle), /abort_denied_after_release_effect/);
    assert.ok(existsSync(join(f.directory, RECOVERY_GATE)));
    assert.equal(readFileSync(f.marker, 'utf8'), f.markerBytes);
  } finally {
    f.close();
  }
});

test('partial admission control is preserved without treating matching operation path as ownership', async () => {
  const f = fixture();
  try {
    const capture = await f.capture();
    writeFileSync(join(f.directory, RECOVERY_GATE), '{');
    await assert.rejects(f.recovery.continueCapture(capture.bundle));
    await assert.rejects(f.recovery.abort(capture.bundle));
    assert.equal(readFileSync(join(f.directory, RECOVERY_GATE), 'utf8'), '{');
    assert.equal(readFileSync(f.marker, 'utf8'), f.markerBytes);
  } finally {
    f.close();
  }
});

test('retention counterexample: current prepared-only snapshot does not prove no historical dispatch', async () => {
  let timestamp = 1;
  const f = fixture(false, () => timestamp);
  try {
    const journal = f.databases[0]!.journal;
    journal.transition(f.attemptId, 'starting');
    journal.transition(f.attemptId, 'exited', { exitCode: 0 });
    timestamp += 31 * 86400_000;
    journal.prepare({
      instanceId: randomUUID(),
      clientId: 'SYNTHETIC-RETENTION',
      projectId: terminalDigest(f.configs[0]!.project),
      manifestDigest: 'a'.repeat(64),
    });
    assert.equal(journal.read(f.attemptId), undefined);
    const capture = await f.capture();
    const snapshot = JSON.parse(readFileSync(join(capture.bundle, 'snapshot.json'), 'utf8'));
    assert.equal(snapshot.journals[0].logical.attempts.length, 1);
    assert.equal(snapshot.journals[0].logical.attempts[0].state, 'prepared');
  } finally {
    f.close();
  }
});

test('a release signature cannot serve as explicit finalization consent', async () => {
  const f = fixture();
  try {
    const capture = await f.capture();
    f.changeBoot();
    await f.recovery.release(capture.bundle);
    const archive = JSON.parse(readFileSync(join(capture.bundle, 'archive.json'), 'utf8'));
    const next = new OfflineReservationRecovery(
      {
        ...f.authority,
        sign: async () => ({ signature: archive.signature as string, validUntil: 30_001 }),
      },
      f.dependencies,
    );
    await assert.rejects(next.finalize(capture.bundle), /approval/);
    assert.ok(existsSync(join(f.directory, RECOVERY_GATE)));
    assert.ok(!existsSync(join(capture.bundle, 'finalized.json')));
  } finally {
    f.close();
  }
});

test('valid SQLite WAL reuse with stale physical tail is conservatively unsupported, not historical non-dispatch proof', async () => {
  const f = fixture(true);
  try {
    const { db, journal, file } = f.databases[0]!;
    for (let index = 0; index < 20; index++)
      journal.prepare({
        instanceId: randomUUID(),
        clientId: 'SYNTHETIC-WAL-REUSE',
        projectId: terminalDigest(f.configs[0]!.project),
        manifestDigest: 'a'.repeat(64),
      });
    db.exec('PRAGMA wal_checkpoint(PASSIVE)');
    journal.prepare({
      instanceId: randomUUID(),
      clientId: 'SYNTHETIC-WAL-RESET',
      projectId: terminalDigest(f.configs[0]!.project),
      manifestDigest: 'a'.repeat(64),
    });
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM terminal_attempts').get()!.count, 22);
    assert.throws(
      () => committedTerminalImage(readFileSync(file), readFileSync(`${file}-wal`)),
      /frame binding/,
    );
    await assert.rejects(f.capture(), /frame binding/);
    assert.equal(readFileSync(f.marker, 'utf8'), f.markerBytes);
    assert.ok(!existsSync(join(f.directory, RECOVERY_GATE)));
  } finally {
    f.close();
  }
});

// The legacy claim's actual primitive is an exclusive wx write, not an advisory gate.
function legacyClaim(f: ReturnType<typeof fixture>, bytes = 'SYNTHETIC-FUTURE-OWNER') {
  writeFileSync(f.marker, bytes, { flag: 'wx', mode: 0o600, flush: true });
}

test('original marker continuously blocks legacy claim(wx) until final authorized commit', async () => {
  const f = fixture();
  try {
    const blocked: string[] = [];
    f.review((challenge) => {
      assert.equal(readFileSync(f.marker, 'utf8'), f.markerBytes);
      assert.throws(() => legacyClaim(f), /EEXIST/);
      blocked.push(challenge.phase);
    });
    f.boundary((stage) => {
      if (['archive', 'receipt', 'commit_prepared', 'before_marker'].includes(stage)) {
        assert.equal(readFileSync(f.marker, 'utf8'), f.markerBytes);
        assert.throws(() => legacyClaim(f), /EEXIST/);
        blocked.push(stage);
      }
      if (stage === 'after_marker') {
        assert.ok(existsSync(join(f.directory, RECOVERY_GATE))); // Unpatched claimant ignores it.
        legacyClaim(f);
      }
    });
    const capture = await f.capture();
    f.changeBoot();
    assert.equal((await f.recovery.release(capture.bundle)).status, 'release_prepared');
    assert.equal(
      JSON.parse(readFileSync(join(capture.bundle, 'receipt.json'), 'utf8')).status,
      'release_prepared',
    );
    assert.equal((await f.recovery.finalize(capture.bundle)).releaseCommitted, true);
    assert.deepEqual(blocked, [
      'capture',
      'release',
      'archive',
      'receipt',
      'finalize',
      'commit_prepared',
      'before_marker',
    ]);
    assert.equal(readFileSync(f.marker, 'utf8'), 'SYNTHETIC-FUTURE-OWNER');
    assert.equal(
      readFileSync(join(f.directory, `recovered-${capture.operationId}.marker.json`), 'utf8'),
      f.markerBytes,
    );
  } finally {
    f.close();
  }
});

for (const stage of [
  'commit_prepared',
  'before_marker',
  'after_marker',
  'commit_receipt',
  'after_lock',
  'after_gate',
] as const)
  for (const caller of ['returned_helper', 'later_boot_helper'] as const)
    test(`final commit continuation at ${stage} from ${caller} preserves phase and marker identity`, async () => {
      const f = fixture();
      try {
        const capture = await f.capture();
        f.changeBoot();
        await f.recovery.release(capture.bundle);
        const prepared = readFileSync(join(capture.bundle, 'receipt.json'));
        f.fault(stage);
        await assert.rejects(f.recovery.finalize(capture.bundle));
        const committed = !['commit_prepared', 'before_marker'].includes(stage);
        if (committed) {
          assert.ok(!existsSync(f.marker));
          assert.equal(
            readFileSync(join(f.directory, `recovered-${capture.operationId}.marker.json`), 'utf8'),
            f.markerBytes,
          );
          const stranger = new OfflineReservationRecovery(f.authority, f.dependencies);
          await assert.rejects(
            stranger.finalize(capture.bundle),
            /same_boot_helper_fence_required/,
          );
        } else {
          assert.equal(readFileSync(f.marker, 'utf8'), f.markerBytes);
          assert.throws(() => legacyClaim(f), /EEXIST/);
        }
        assert.deepEqual(readFileSync(join(capture.bundle, 'receipt.json')), prepared);
        assert.equal(JSON.parse(prepared.toString()).status, 'release_prepared');
        f.clearFault();
        let next = f.recovery;
        if (caller === 'later_boot_helper') {
          f.changeBoot();
          next = new OfflineReservationRecovery(f.authority, f.dependencies);
        }
        assert.equal((await next.finalize(capture.bundle)).releaseCommitted, true);
        assert.equal(f.databases[0]!.journal.read(f.attemptId)!.state, 'prepared');
        await assert.rejects(next.finalize(capture.bundle), /already_finalized/);
      } finally {
        f.close();
      }
    });

for (const stage of ['after_marker', 'commit_receipt', 'after_lock', 'after_gate'] as const)
  test(`future legacy owner after commit survives interrupted ${stage} and explicit completion`, async () => {
    const f = fixture();
    try {
      const capture = await f.capture();
      f.changeBoot();
      await f.recovery.release(capture.bundle);
      f.boundary((point) => {
        if (point === 'after_marker') {
          legacyClaim(f);
          writeFileSync(join(f.directory, 'enrollment-SYNTHETIC-FUTURE.json'), 'SYNTHETIC-FUTURE', {
            mode: 0o600,
          });
          // No historical revalidation may mistake future records for pre-commit facts.
          f.databases[0]!.journal.transition(f.attemptId, 'starting');
        }
      });
      f.fault(stage);
      await assert.rejects(f.recovery.finalize(capture.bundle), /namespace_commit_observed/);
      const future = lstatSync(f.marker, { bigint: true });
      f.clearFault();
      f.boundary(undefined);
      const result = await f.recovery.finalize(capture.bundle);
      assert.equal(result.releaseCommitted, true);
      assert.equal(readFileSync(f.marker, 'utf8'), 'SYNTHETIC-FUTURE-OWNER');
      assert.equal(lstatSync(f.marker, { bigint: true }).ino, future.ino);
      assert.equal(
        readFileSync(join(f.directory, 'enrollment-SYNTHETIC-FUTURE.json'), 'utf8'),
        'SYNTHETIC-FUTURE',
      );
      await assert.rejects(f.recovery.finalize(capture.bundle), /already_finalized/);
      assert.equal(lstatSync(f.marker, { bigint: true }).ino, future.ino);
    } finally {
      f.close();
    }
  });

test('new future controls created after old gate unlink are never deleted by completion or replay', async () => {
  const f = fixture();
  try {
    const capture = await f.capture();
    f.changeBoot();
    await f.recovery.release(capture.bundle);
    f.boundary((stage) => {
      if (stage === 'after_marker') legacyClaim(f);
      if (stage === 'after_gate') {
        writeFileSync(join(f.directory, RECOVERY_GATE), 'SYNTHETIC-NEW-GATE', {
          flag: 'wx',
          mode: 0o600,
        });
        writeFileSync(join(f.directory, 'offline-recovery-operation.lock'), 'SYNTHETIC-NEW-LOCK', {
          flag: 'wx',
          mode: 0o600,
        });
      }
    });
    assert.equal((await f.recovery.finalize(capture.bundle)).releaseCommitted, true);
    const future = readFileSync(f.marker);
    f.boundary(undefined);
    await assert.rejects(f.recovery.finalize(capture.bundle), /already_finalized/);
    assert.deepEqual(readFileSync(f.marker), future);
    assert.equal(readFileSync(join(f.directory, RECOVERY_GATE), 'utf8'), 'SYNTHETIC-NEW-GATE');
    assert.equal(
      readFileSync(join(f.directory, 'offline-recovery-operation.lock'), 'utf8'),
      'SYNTHETIC-NEW-LOCK',
    );
  } finally {
    f.close();
  }
});

test('changed source owner during final native review cannot reach the final commit', async () => {
  const f = fixture();
  try {
    const capture = await f.capture();
    f.changeBoot();
    await f.recovery.release(capture.bundle);
    const replacement = JSON.stringify({
      version: 1,
      owner: randomUUID(),
      manifests: [f.manifests[0]],
    });
    f.review((challenge) => {
      if (challenge.phase === 'finalize') writeFileSync(f.marker, replacement);
    });
    await assert.rejects(f.recovery.finalize(capture.bundle), /pre_commit_source_changed/);
    assert.equal(readFileSync(f.marker, 'utf8'), replacement);
    assert.ok(!existsSync(join(f.directory, `recovered-${capture.operationId}.marker.json`)));
    assert.ok(existsSync(join(f.directory, RECOVERY_GATE)));
  } finally {
    f.close();
  }
});

test('changed control after commit is preserved by exact identity and does not authorize touching a future marker', async () => {
  const f = fixture();
  try {
    const capture = await f.capture();
    f.changeBoot();
    await f.recovery.release(capture.bundle);
    f.boundary((stage) => {
      if (stage === 'after_marker') {
        legacyClaim(f);
        const path = join(f.directory, RECOVERY_GATE);
        renameSync(path, path + '.SYNTHETIC-old');
        writeFileSync(path, 'SYNTHETIC-FOREIGN-CONTROL', { mode: 0o600, flag: 'wx' });
      }
    });
    const result = await f.recovery.finalize(capture.bundle);
    assert.equal(result.releaseCommitted, true);
    assert.equal(result.cleanup, 'changed_controls_preserved');
    assert.equal(readFileSync(f.marker, 'utf8'), 'SYNTHETIC-FUTURE-OWNER');
    assert.equal(
      readFileSync(join(f.directory, RECOVERY_GATE), 'utf8'),
      'SYNTHETIC-FOREIGN-CONTROL',
    );
  } finally {
    f.close();
  }
});

test('partial final intent cannot commit or erase the continuously present original reservation', async () => {
  const f = fixture();
  try {
    const capture = await f.capture();
    f.changeBoot();
    await f.recovery.release(capture.bundle);
    writeFileSync(join(capture.bundle, 'finalized.json'), '{', { mode: 0o600 });
    await assert.rejects(f.recovery.finalize(capture.bundle), /incomplete_or_legacy_commit_intent/);
    assert.equal(readFileSync(f.marker, 'utf8'), f.markerBytes);
    assert.throws(() => legacyClaim(f), /EEXIST/);
    assert.equal(readFileSync(join(capture.bundle, 'finalized.json'), 'utf8'), '{');
  } finally {
    f.close();
  }
});

test('partial post-commit observation is retained while a fresh explicit observation completes without touching future owner', async () => {
  const f = fixture();
  try {
    const capture = await f.capture();
    f.changeBoot();
    await f.recovery.release(capture.bundle);
    f.boundary((stage) => {
      if (stage === 'after_marker') legacyClaim(f);
    });
    f.fault('after_marker');
    await assert.rejects(f.recovery.finalize(capture.bundle), /namespace_commit_observed/);
    f.clearFault();
    f.boundary(undefined);
    const partial = join(capture.bundle, `commit-observed-${randomUUID()}.json`);
    writeFileSync(partial, '{', { mode: 0o600 });
    assert.equal((await f.recovery.finalize(capture.bundle)).releaseCommitted, true);
    assert.equal(readFileSync(partial, 'utf8'), '{');
    assert.equal(readFileSync(f.marker, 'utf8'), 'SYNTHETIC-FUTURE-OWNER');
  } finally {
    f.close();
  }
});

for (const stage of ['commit_prepared', 'before_marker', 'slow_fsync'] as const)
  test(`final commit rejects proof expiring at exact deadline during ${stage}`, async () => {
    const f = fixture();
    try {
      const capture = await f.capture();
      f.changeBoot();
      await f.recovery.release(capture.bundle);
      let approved = false;
      f.review((challenge) => {
        approved = challenge.phase === 'finalize';
      });
      if (stage === 'slow_fsync') {
        f.synced(() => {
          if (approved) {
            approved = false;
            f.advance(30_000);
          }
        });
      } else
        f.boundary((point) => {
          if (point === stage) f.advance(30_000);
        });
      await assert.rejects(f.recovery.finalize(capture.bundle), /expired/);
      assert.equal(readFileSync(f.marker, 'utf8'), f.markerBytes);
      assert.ok(!existsSync(join(f.directory, `recovered-${capture.operationId}.marker.json`)));
      assert.ok(!existsSync(join(capture.bundle, 'completion.json')));
      const reviews = f.reviews.length;
      f.boundary(undefined);
      f.synced(undefined);
      assert.equal((await f.recovery.finalize(capture.bundle)).releaseCommitted, true);
      assert.equal(f.reviews.length, reviews + 1);
      assert.notEqual(f.reviews.at(-1)!.nonce, f.reviews.at(-2)!.nonce);
    } finally {
      f.close();
    }
  });

test('proof deadline passing after namespace commit preserves truthful completion without retry', async () => {
  const f = fixture();
  try {
    const capture = await f.capture();
    f.changeBoot();
    await f.recovery.release(capture.bundle);
    f.boundary((stage) => {
      if (stage === 'after_marker') {
        f.advance(30_000);
        legacyClaim(f);
      }
    });
    const result = await f.recovery.finalize(capture.bundle);
    assert.equal(result.releaseCommitted, true);
    assert.equal(result.status, 'finalized');
    assert.equal(
      JSON.parse(readFileSync(join(capture.bundle, 'completion.json'), 'utf8')).status,
      'finalized',
    );
    assert.equal(readFileSync(f.marker, 'utf8'), 'SYNTHETIC-FUTURE-OWNER');
    const reviews = f.reviews.length;
    await assert.rejects(f.recovery.finalize(capture.bundle), /already_finalized/);
    assert.equal(f.reviews.length, reviews);
    assert.equal(readFileSync(f.marker, 'utf8'), 'SYNTHETIC-FUTURE-OWNER');
  } finally {
    f.close();
  }
});

test('changed exact helper lease immediately before namespace commit preserves original marker', async () => {
  const f = fixture();
  try {
    const capture = await f.capture();
    f.changeBoot();
    await f.recovery.release(capture.bundle);
    f.boundary((stage) => {
      if (stage === 'before_marker') {
        const lease = readdirSync(capture.bundle).find((name) => name.startsWith('operation-'))!;
        writeFileSync(join(capture.bundle, lease), 'SYNTHETIC-UNKNOWN-HELPER', { mode: 0o600 });
      }
    });
    await assert.rejects(f.recovery.finalize(capture.bundle), /operation_lease_changed/);
    assert.equal(readFileSync(f.marker, 'utf8'), f.markerBytes);
    assert.ok(!existsSync(join(f.directory, `recovered-${capture.operationId}.marker.json`)));
  } finally {
    f.close();
  }
});

for (const reading of [20_000, 40_000, 60_000])
  test(`SYNTHETIC ${reading}ms full intent reading precedes fresh proof without consuming its 30 seconds`, async () => {
    const f = fixture();
    try {
      f.reading(() => f.advance(reading));
      const capture = await f.capture();
      const proof = f.reviews[0]!;
      assert.equal(proof.expiresAt, reading + 30_001);
      assert.equal(proof.version, 2);
      assert.equal(
        proof.intentDigest,
        administrativeIntentDigest(administrativeRecoveryIntent(proof), f.fullReviews[0]!),
      );
      assert.ok(existsSync(join(capture.bundle, 'capture.json')));
    } finally {
      f.close();
    }
  });

test('the explicit semantic tuple covers every strict intent field and exact complete review bytes', async () => {
  const f = fixture();
  try {
    await f.capture();
    const intent = administrativeRecoveryIntent(f.reviews[0]!);
    const fullReview = f.fullReviews[0]!;
    const tuple = JSON.parse(administrativeIntentBytes(intent)) as unknown[];
    assert.deepEqual(tuple, [
      'orqst.administrative-recovery-intent',
      1,
      intent.domain,
      intent.version,
      intent.operationId,
      intent.phase,
      intent.owner,
      intent.epoch,
      intent.beforeBoot,
      intent.currentBoot,
      intent.snapshotDigest,
      intent.currentDigest,
      intent.directory,
      intent.bundle,
    ]);
    const fingerprint = administrativeIntentDigest(intent, fullReview);
    for (const key of Object.keys(intent) as (keyof typeof intent)[]) {
      const changed = { ...intent, [key]: key === 'version' ? 1 : `${intent[key]}-changed` };
      if (administrativeIntentSchema.safeParse(changed).success)
        assert.notEqual(administrativeIntentDigest(changed, fullReview), fingerprint);
      else assert.throws(() => administrativeIntentDigest(changed, fullReview));
    }
    assert.throws(() =>
      administrativeIntentBytes({ ...intent, nonce: randomUUID() } as typeof intent),
    );
    const review = JSON.parse(fullReview) as Record<string, unknown>;
    assert.equal(
      review.rawSnapshotDigest,
      JSON.parse(
        readFileSync(
          join(f.recoveryRoot, readdirSync(f.recoveryRoot)[0]!, 'snapshot.json'),
          'utf8',
        ),
      ).rawDigest,
    );
    for (const key of [
      'intent',
      'transaction',
      'files',
      'metadataRecords',
      'membership',
      'journals',
      'rawSnapshotDigest',
    ]) {
      assert.notEqual(
        administrativeIntentDigest(intent, JSON.stringify({ ...review, [key]: 'SYNTHETIC-drift' })),
        fingerprint,
      );
    }
    assert.notEqual(administrativeIntentDigest(intent, fullReview + '\n'), fingerprint);
  } finally {
    f.close();
  }
});

for (const invalid of [NaN, Infinity, -Infinity, null])
  test(`non-finite or absent native revalidation deadline ${invalid} cannot publish a gate`, async () => {
    const f = fixture();
    try {
      f.revalidation(() => invalid);
      await assert.rejects(f.capture(), /expired/);
      assert.equal(readFileSync(f.marker, 'utf8'), f.markerBytes);
      assert.equal(existsSync(join(f.directory, RECOVERY_GATE)), false);
    } finally {
      f.close();
    }
  });

for (const stage of ['capture', 'abort', 'release'] as const)
  test(`expiry during ${stage} durability preserves the original reservation and denies subsequent effects`, async () => {
    const f = fixture();
    try {
      if (stage === 'capture') {
        f.boundary((point) => {
          if (point === 'capture') f.advance(30_000);
        });
        await assert.rejects(f.capture(), /expired/);
        assert.equal(existsSync(join(f.directory, RECOVERY_GATE)), false);
      } else {
        const capture = await f.capture();
        if (stage === 'abort') {
          let approved = false;
          f.review(() => {
            approved = true;
          });
          f.synced(() => {
            if (approved) {
              approved = false;
              f.advance(30_000);
            }
          });
          await assert.rejects(f.recovery.abort(capture.bundle), /expired/);
        } else {
          f.changeBoot();
          f.boundary((point) => {
            if (point === 'archive') f.advance(30_000);
          });
          await assert.rejects(f.recovery.release(capture.bundle), /expired/);
          assert.equal(existsSync(join(capture.bundle, 'receipt.json')), false);
        }
        assert.equal(existsSync(join(f.directory, RECOVERY_GATE)), true);
      }
      assert.equal(readFileSync(f.marker, 'utf8'), f.markerBytes);
    } finally {
      f.close();
    }
  });

test('format one historical capture remains verifiable while every new phase issues version two', async () => {
  const f = fixture();
  try {
    const capture = await f.capture();
    const file = join(capture.bundle, 'capture.json');
    const envelope = JSON.parse(readFileSync(file, 'utf8'));
    const { intentDigest, ...fields } = envelope.challenge as AdministrativeRecoveryChallenge;
    assert.ok(intentDigest);
    const legacy: AdministrativeRecoveryChallenge = { ...fields, version: 1 };
    const historical = await f.authority.sign(legacy); // Explicit synthetic old-format fixture only.
    writeFileSync(
      file,
      JSON.stringify({ ...envelope, challenge: legacy, signature: historical.signature }),
    );
    f.changeBoot();
    assert.equal((await f.recovery.release(capture.bundle)).status, 'release_prepared');
    assert.equal(f.reviews.at(-1)!.version, 2);
    assert.ok(f.reviews.at(-1)!.intentDigest);
    assert.equal((await f.recovery.finalize(capture.bundle)).releaseCommitted, true);
  } finally {
    f.close();
  }
});

test('an unauthenticated partial inspection cannot continue or abort and remains byte-for-byte preserved', async () => {
  const f = fixture();
  try {
    f.cancel();
    await assert.rejects(f.capture());
    const bundle = join(f.recoveryRoot, readdirSync(f.recoveryRoot)[0]!);
    const paths = readdirSync(bundle).flatMap((name) =>
      readdirSync(join(bundle, name)).map((file) => join(bundle, name, file)),
    );
    const before = paths.map((path) => ({
      path,
      bytes: readFileSync(path),
      inode: lstatSync(path).ino,
    }));
    assert.equal(existsSync(join(bundle, 'capture.json')), false);
    for (const operation of ['continueCapture', 'abort', 'release', 'finalize'] as const)
      await assert.rejects(f.recovery[operation](bundle), /missing_or_partial_capture/);
    for (const file of before) {
      assert.deepEqual(readFileSync(file.path), file.bytes);
      assert.equal(lstatSync(file.path).ino, file.inode);
    }
    assert.equal(readFileSync(f.marker, 'utf8'), f.markerBytes);
  } finally {
    f.close();
  }
});

test('a shorter native grant survives repeated checks and cumulative sign plus fsync delay cannot commit', async () => {
  const f = fixture();
  try {
    const capture = await f.capture();
    f.changeBoot();
    await f.recovery.release(capture.bundle);
    let checks = 0;
    f.review((challenge) => {
      if (challenge.phase === 'finalize') f.advance(20_000);
    });
    // The first native remainder narrows the proof ceiling to 29 seconds from click.
    // A later overly generous callback must never move that retained deadline forward.
    f.revalidation(() => (++checks === 1 ? 29_001 : 100_000));
    f.boundary((stage) => {
      if (stage === 'before_marker') f.advance(9_000);
    });
    await assert.rejects(f.recovery.finalize(capture.bundle), /expired/);
    assert.ok(checks >= 2);
    assert.equal(readFileSync(f.marker, 'utf8'), f.markerBytes);
    assert.equal(
      existsSync(join(f.directory, `recovered-${capture.operationId}.marker.json`)),
      false,
    );
  } finally {
    f.close();
  }
});

// SYNTHETIC historical preimage evidence. Source CONTENT is never inspected by recovery.
function historicalFixture(twoSources = false, replaceSource = true) {
  const f = fixture(false, undefined, twoSources);
  const file = f.configs[1]!.model!.files[0]!.path;
  const historical = `${lstatSync(file).dev}:${lstatSync(file).ino}`;
  const digest = (path: string) => terminalDigest(readFileSync(path));
  const evidence = {
    kind: 'orqst.offline-recovery.historical-binding-evidence',
    version: 1,
    marker: { owner: f.owner, sha256: digest(f.marker) },
    enrollment: {
      opId: f.intent.input.opId,
      epoch: f.epoch,
      intentSha256: digest(f.intentFile),
      receiptSha256: digest(f.receiptFile),
    },
    member: {
      slot: 1,
      terminalId: f.intent.member.terminalId,
      manifestSha256: digest(f.manifests[1]!),
      manifestIdentity: `${lstatSync(f.manifests[1]!).dev}:${lstatSync(f.manifests[1]!).ino}`,
      frozenBindingDigest: f.intent.member.bindingDigest,
    },
    historicalModelSource: { index: 0, path: file, identity: historical },
    modelSources: f.configs[1]!.model!.files.map(({ path }) => ({
      path,
      identity: `${lstatSync(path).dev}:${lstatSync(path).ino}`,
    })),
  };
  const evidenceFile = join(f.root, 'SYNTHETIC-historical-evidence.json');
  const save = () => writeFileSync(evidenceFile, JSON.stringify(evidence), { mode: 0o600 });
  const replace = () => {
    const next = `${file}.replacement`;
    writeFileSync(next, 'SYNTHETIC-NO-CREDENTIAL', { mode: 0o600 });
    renameSync(next, file);
  };
  save();
  if (replaceSource) replace();
  return {
    ...f,
    file,
    evidence,
    evidenceFile,
    save,
    replace,
    captureHistorical: () => f.recovery.capture(f.directory, f.recoveryRoot, evidenceFile),
  };
}

test('historical single inode full preimage captures, persists and revalidates across boots/phases', async () => {
  const f = historicalFixture();
  try {
    await assert.rejects(f.capture(), /enrollment binding/);
    const captured = await f.captureHistorical();
    const snapshot = JSON.parse(readFileSync(join(captured.bundle, 'snapshot.json'), 'utf8'));
    assert.equal(
      snapshot.historicalBinding.evidenceSha256,
      terminalDigest(readFileSync(f.evidenceFile)),
    );
    assert.equal(snapshot.journals[1].bindingDigest, f.intent.member.bindingDigest);
    assert.match(f.fullReviews[0]!, /CONTENT was NOT inspected/);
    assert.match(f.fullReviews[0]!, /NO launch/);
    assert.equal(
      lstatSync(join(captured.bundle, 'historical-binding-evidence.json')).mode & 0o777,
      0o600,
    );
    unlinkSync(f.evidenceFile);
    f.changeBoot();
    f.replace();
    const reload = new OfflineReservationRecovery(f.authority, f.dependencies);
    await reload.release(captured.bundle);
    const releaseRaw = f.reviews.at(-1)!.currentDigest;
    assert.notEqual(releaseRaw, snapshot.rawDigest);
    f.replace();
    await reload.finalize(captured.bundle);
    assert.equal(existsSync(f.marker), false);
    assert.notEqual(f.reviews.at(-1)!.currentDigest, releaseRaw);
  } finally {
    f.close();
  }
});

for (const mutation of [
  'inode',
  'device',
  'path',
  'index',
  'marker',
  'intent',
  'receipt',
  'manifest',
  'binding',
  'extra',
  'baseline',
] as const) {
  test(`historical evidence denies synthetic ${mutation} mismatch`, async () => {
    const f = historicalFixture();
    try {
      if (mutation === 'inode')
        f.evidence.historicalModelSource.identity = `${lstatSync(f.file).dev}:1`;
      if (mutation === 'device')
        f.evidence.historicalModelSource.identity = `1:${lstatSync(f.file).ino}`;
      if (mutation === 'path') f.evidence.historicalModelSource.path += '-wrong';
      if (mutation === 'index') f.evidence.historicalModelSource.index = 1;
      if (mutation === 'marker') f.evidence.marker.sha256 = 'a'.repeat(64);
      if (mutation === 'intent') f.evidence.enrollment.intentSha256 = 'a'.repeat(64);
      if (mutation === 'receipt') f.evidence.enrollment.receiptSha256 = 'a'.repeat(64);
      if (mutation === 'manifest') f.evidence.member.manifestSha256 = 'a'.repeat(64);
      if (mutation === 'binding') f.evidence.member.frozenBindingDigest = 'a'.repeat(64);
      if (mutation === 'baseline')
        f.evidence.modelSources[0]!.identity = `${lstatSync(f.file).dev}:1`;
      f.save();
      if (mutation === 'extra')
        writeFileSync(f.evidenceFile, JSON.stringify({ ...f.evidence, extra: true }));
      await assert.rejects(f.captureHistorical());
      assert.equal(f.reviews.length, 0);
      assert.equal(existsSync(join(f.directory, RECOVERY_GATE)), false);
    } finally {
      f.close();
    }
  });
}
for (const stage of ['review', 'sign', 'revalidate'] as const) {
  test(`historical capture denies current metadata replacement during ${stage}`, async () => {
    const f = historicalFixture();
    try {
      if (stage === 'review') f.reading(f.replace);
      if (stage === 'sign') f.review(f.replace);
      if (stage === 'revalidate')
        f.revalidation(() => {
          f.replace();
          return 30_001;
        });
      await assert.rejects(f.captureHistorical(), /capture_source_changed/);
      assert.equal(existsSync(join(f.directory, RECOVERY_GATE)), false);
    } finally {
      f.close();
    }
  });
}
for (const kind of [
  'mode',
  'symlink',
  'oversize',
  'utf8',
  'missing',
  'source-mode',
  'source-symlink',
  'source-missing',
] as const) {
  test(`historical evidence/current source rejects ${kind}`, async () => {
    const f = historicalFixture();
    try {
      if (kind === 'mode') chmodSync(f.evidenceFile, 0o644);
      if (kind === 'symlink') {
        renameSync(f.evidenceFile, `${f.evidenceFile}.real`);
        symlinkSync(`${f.evidenceFile}.real`, f.evidenceFile);
      }
      if (kind === 'oversize') writeFileSync(f.evidenceFile, ' '.repeat(4097));
      if (kind === 'utf8') writeFileSync(f.evidenceFile, Buffer.from([0xff]));
      if (kind === 'missing') unlinkSync(f.evidenceFile);
      if (kind === 'source-mode') chmodSync(f.file, 0o666);
      if (kind === 'source-symlink') {
        renameSync(f.file, `${f.file}.real`);
        symlinkSync(`${f.file}.real`, f.file);
      }
      if (kind === 'source-missing') unlinkSync(f.file);
      await assert.rejects(f.captureHistorical());
      assert.equal(f.reviews.length, 0);
    } finally {
      f.close();
    }
  });
}
test('historical signed capture cannot adopt altered persisted evidence or partial capture', async () => {
  const f = historicalFixture();
  try {
    const captured = await f.captureHistorical();
    f.changeBoot();
    const saved = join(captured.bundle, 'historical-binding-evidence.json');
    writeFileSync(saved, `${readFileSync(saved, 'utf8')}\n`);
    const reload = new OfflineReservationRecovery(f.authority, f.dependencies);
    await assert.rejects(reload.release(captured.bundle), /historical evidence changed/);
    unlinkSync(join(captured.bundle, 'capture.json'));
    await assert.rejects(reload.continueCapture(captured.bundle), /missing_or_partial_capture/);
    assert.ok(existsSync(f.marker));
  } finally {
    f.close();
  }
});

test('historical evidence rejects two model source inode deltas', async () => {
  const f = historicalFixture(true);
  try {
    const other = f.configs[1]!.model!.files[1]!.path;
    const next = `${other}.replacement`;
    writeFileSync(next, 'SYNTHETIC-NO-CREDENTIAL', { mode: 0o600 });
    renameSync(next, other);
    await assert.rejects(f.captureHistorical(), /additional source drift/);
    assert.equal(f.reviews.length, 0);
  } finally {
    f.close();
  }
});
for (const source of ['manifest', 'state', 'project'] as const) {
  test(`historical evidence cannot cover another ${source} identity delta`, async () => {
    const f = historicalFixture();
    try {
      const path = source === 'manifest' ? f.manifests[1]! : f.configs[1]![source];
      renameSync(path, `${path}.preserved`);
      if (source === 'manifest')
        writeFileSync(path, readFileSync(`${path}.preserved`), { mode: 0o600 });
      else mkdirSync(path, { mode: 0o700 });
      await assert.rejects(f.captureHistorical());
      assert.equal(f.reviews.length, 0);
    } finally {
      f.close();
    }
  });
}
for (const field of ['node', 'executable', 'model', 'preparation'] as const) {
  test(`historical full preimage rejects modified parsed ${field}`, async () => {
    const f = historicalFixture();
    try {
      const config = JSON.parse(readFileSync(f.manifests[1]!, 'utf8'));
      if (field === 'model') config.model.files[0].sha256 = 'a'.repeat(64);
      else if (field === 'preparation') config.preparation.fence = 'SYNTHETIC-CHANGED';
      else config[field].sha256 = 'b'.repeat(64);
      writeFileSync(f.manifests[1]!, JSON.stringify(config));
      f.evidence.member.manifestSha256 = terminalDigest(readFileSync(f.manifests[1]!));
      f.save();
      await assert.rejects(f.captureHistorical(), /preimage/);
    } finally {
      f.close();
    }
  });
}
test('historical metadata evidence does not assert current model source content', async () => {
  const f = historicalFixture();
  try {
    writeFileSync(f.file, 'SYNTHETIC-CONTENT-DIFFERENT-AND-UNINSPECTED');
    const captured = await f.captureHistorical();
    assert.ok(existsSync(join(captured.bundle, 'capture.json')));
    assert.match(f.fullReviews[0]!, /CONTENT was NOT inspected or validated/);
  } finally {
    f.close();
  }
});
test('historical evidence copy fsync failure preserves partial material without capture/gate', async () => {
  const f = historicalFixture();
  try {
    f.failSyncAt(2);
    await assert.rejects(f.captureHistorical(), /fsync/);
    const bundle = join(f.recoveryRoot, readdirSync(f.recoveryRoot)[0]!);
    assert.ok(existsSync(join(bundle, 'historical-binding-evidence.json')));
    assert.equal(existsSync(join(bundle, 'capture.json')), false);
    assert.equal(existsSync(join(f.directory, RECOVERY_GATE)), false);
    await assert.rejects(f.recovery.continueCapture(bundle), /missing_or_partial_capture/);
  } finally {
    f.close();
  }
});
for (const phase of ['release', 'finalize'] as const) {
  test(`historical ${phase} denies metadata replacement during fresh review`, async () => {
    const f = historicalFixture();
    try {
      const captured = await f.captureHistorical();
      f.changeBoot();
      if (phase === 'finalize') await f.recovery.release(captured.bundle);
      f.reading(f.replace);
      await assert.rejects(f.recovery[phase](captured.bundle), /changed/);
      assert.ok(existsSync(f.marker));
    } finally {
      f.close();
    }
  });
}
test('unread model source size/time changes within review are not administrative evidence', async () => {
  const f = historicalFixture();
  try {
    const original = lstatSync(f.file);
    f.reading(() => writeFileSync(f.file, 'SYNTHETIC-UNINSPECTED-CONTENT-OF-A-DIFFERENT-SIZE'));
    const captured = await f.captureHistorical();
    assert.equal(lstatSync(f.file).ino, original.ino);
    assert.notEqual(lstatSync(f.file).size, original.size);
    f.changeBoot();
    await f.recovery.release(captured.bundle);
    await f.recovery.finalize(captured.bundle);
  } finally {
    f.close();
  }
});
test('historical evidence refuses a redundant already-current binding', async () => {
  const f = historicalFixture(false, false);
  try {
    await assert.rejects(f.captureHistorical(), /redundant/);
  } finally {
    f.close();
  }
});
test('historical inode candidate still requires the complete frozen SHA', async () => {
  const f = historicalFixture();
  try {
    const wrong = `${lstatSync(f.file).dev}:1`;
    f.evidence.historicalModelSource.identity = wrong;
    f.evidence.modelSources[0]!.identity = wrong;
    f.save();
    await assert.rejects(f.captureHistorical(), /preimage does not match/);
  } finally {
    f.close();
  }
});
for (const critical of ['mode', 'nlink', 'symlink'] as const) {
  test(`historical capture denies ${critical} change during review`, async () => {
    const f = historicalFixture();
    try {
      f.reading(() => {
        if (critical === 'mode') chmodSync(f.file, 0o400);
        if (critical === 'nlink') linkSync(f.file, `${f.file}.link`);
        if (critical === 'symlink') {
          renameSync(f.file, `${f.file}.real`);
          symlinkSync(`${f.file}.real`, f.file);
        }
      });
      await assert.rejects(f.captureHistorical());
      assert.equal(existsSync(join(f.directory, RECOVERY_GATE)), false);
    } finally {
      f.close();
    }
  });
}
test('persisted historical evidence metadata remains strict even for unchanged bytes', async () => {
  const f = historicalFixture();
  try {
    const captured = await f.captureHistorical();
    f.changeBoot();
    chmodSync(join(captured.bundle, 'historical-binding-evidence.json'), 0o400);
    await assert.rejects(f.recovery.release(captured.bundle), /evidence must be private/);
    assert.ok(existsSync(f.marker));
  } finally {
    f.close();
  }
});

// SYNTHETIC kernel stat namespace, not a mount/volume continuity certificate.
// Builtin mocks exercise the production readers, serializer, service and signatures together.
function deviceNamespace() {
  const originalLstat = fs.lstatSync;
  const originalFstat = fs.fstatSync;
  let enabled = false;
  let offset = 100n;
  let unmapped: string | undefined;
  const device = originalLstat(tmpdir()).dev;
  const map = <T extends { dev: number | bigint }>(info: T): T => {
    if (!enabled || BigInt(info.dev) !== BigInt(device)) return info;
    const result = Object.assign(Object.create(Object.getPrototypeOf(info)), info) as T;
    result.dev = typeof info.dev === 'bigint' ? info.dev + offset : info.dev + Number(offset);
    return result;
  };
  const lstat = mock.method(fs, 'lstatSync', (...args: Parameters<typeof originalLstat>) =>
    args[0] === unmapped ? originalLstat(...args)! : map(originalLstat(...args)!),
  );
  const fstat = mock.method(fs, 'fstatSync', (...args: Parameters<typeof originalFstat>) =>
    map(originalFstat(...args)),
  );
  syncBuiltinESMExports();
  return {
    enable: () => {
      enabled = true;
    },
    unmap: (path: string) => {
      unmapped = path;
    },
    // A later external reboot is a different generation, never a renewed consent.
    setOffset: (value: number) => {
      offset = BigInt(value);
    },
    restore: () => {
      lstat.mock.restore();
      fstat.mock.restore();
      syncBuiltinESMExports();
    },
  };
}

for (const historical of [false, true]) {
  test(`cross-boot device difference completes existing transaction with historical capsule=${historical}`, async () => {
    const f = historicalFixture();
    // Without a capsule, restore the original source via a fresh fixture instead.
    const plain = historical ? undefined : fixture();
    const selected = plain ?? f;
    const namespace = deviceNamespace();
    try {
      const captured = historical ? await f.captureHistorical() : await selected.capture();
      const signedBytes = readFileSync(join(captured.bundle, 'snapshot.json'));
      const saved = JSON.parse(signedBytes.toString());
      selected.changeBoot();
      namespace.enable();
      const recovery = new OfflineReservationRecovery(selected.authority, selected.dependencies);
      await recovery.release(captured.bundle);
      assert.equal(readFileSync(selected.marker, 'utf8'), selected.markerBytes);
      const archive = JSON.parse(readFileSync(join(captured.bundle, 'archive.json'), 'utf8'));
      assert.equal(archive.current.logicalDigest, saved.logicalDigest);
      assert.notEqual(archive.current.rawDigest, saved.rawDigest);
      assert.equal(archive.current.physicalDifference.bindings.length, 2);
      assert.equal(archive.current.physicalDifference.historicalDevice, saved.files[0].identity[0]);
      assert.notEqual(archive.current.physicalDifference.currentDevice, saved.files[0].identity[0]);
      assert.deepEqual(readFileSync(join(captured.bundle, 'snapshot.json')), signedBytes);
      assert.match(selected.fullReviews.at(-1)!, /does NOT prove filesystem or volume continuity/);
      // Actual legacy admission primitive remains continuously excluded until final commit.
      assert.throws(
        () => writeFileSync(selected.marker, 'SYNTHETIC old claimant', { flag: 'wx', mode: 0o600 }),
        /EEXIST/,
      );
      const future = JSON.stringify({ version: 1, owner: randomUUID(), manifests: [] });
      selected.boundary((stage) => {
        if (stage === 'after_marker')
          writeFileSync(selected.marker, future, { flag: 'wx', mode: 0o600 });
      });
      await recovery.finalize(captured.bundle);
      assert.equal(readFileSync(selected.marker, 'utf8'), future);
      await assert.rejects(recovery.finalize(captured.bundle), /already_finalized/);
      assert.equal(readFileSync(selected.marker, 'utf8'), future);
      assert.equal(selected.reviews.length, 3);
    } finally {
      namespace.restore();
      plain?.close();
      f.close();
    }
  });
}

for (const mutation of [
  'cancel',
  'signature',
  'snapshot',
  'manifest',
  'evidence',
  'other_model',
  'within_release',
  'within_finalize',
] as const) {
  test(`cross-boot device admission denies ${mutation} and retains old reservation`, async () => {
    const f = historicalFixture();
    const namespace = deviceNamespace();
    try {
      const captured = await f.captureHistorical();
      f.changeBoot();
      namespace.enable();
      const recovery = new OfflineReservationRecovery(f.authority, f.dependencies);
      if (mutation === 'cancel') f.cancel();
      if (mutation === 'signature') {
        const file = join(captured.bundle, 'capture.json');
        const capture = JSON.parse(readFileSync(file, 'utf8'));
        capture.signature = 'a'.repeat(86);
        writeFileSync(file, JSON.stringify(capture));
      }
      if (mutation === 'snapshot') writeFileSync(join(captured.bundle, 'snapshot.json'), '{}');
      if (mutation === 'manifest')
        writeFileSync(f.manifests[0]!, `${readFileSync(f.manifests[0]!, 'utf8')} `);
      if (mutation === 'evidence')
        writeFileSync(
          join(captured.bundle, 'historical-binding-evidence.json'),
          `${readFileSync(f.evidenceFile, 'utf8')} `,
        );
      if (mutation === 'other_model') {
        const file = f.configs[0]!.model!.files[0]!.path;
        writeFileSync(`${file}.replacement`, 'SYNTHETIC-NO-CREDENTIAL', { mode: 0o600 });
        renameSync(`${file}.replacement`, file);
      }
      if (mutation === 'within_release')
        f.review((challenge) => {
          if (challenge.phase === 'release') f.replace();
        });
      if (mutation === 'within_finalize') {
        await recovery.release(captured.bundle);
        f.review((challenge) => {
          if (challenge.phase === 'finalize') f.replace();
        });
        await assert.rejects(recovery.finalize(captured.bundle));
      } else await assert.rejects(recovery.release(captured.bundle));
      assert.equal(readFileSync(f.marker, 'utf8'), f.markerBytes);
      assert.equal(existsSync(join(captured.bundle, 'finalized.json')), false);
      assert.ok(existsSync(join(f.directory, RECOVERY_GATE)));
      if (mutation !== 'within_finalize')
        assert.equal(existsSync(join(captured.bundle, 'archive.json')), false);
    } finally {
      namespace.restore();
      f.close();
    }
  });
}

test('cross-boot physical comparison denies mixed mapping, other bytes, metadata and duplicate records', () => {
  const f = fixture();
  try {
    const scratch = join(f.root, 'SYNTHETIC-inspect');
    mkdirSync(scratch, { mode: 0o700 });
    const saved = snapshotOfflineReservation(f.directory, scratch);
    for (const mutation of ['mixed', 'bytes', 'mode', 'inode', 'duplicate'] as const) {
      const snapshot = structuredClone(saved);
      if (mutation === 'duplicate') snapshot.files.push(snapshot.files[0]!);
      assert.throws(() =>
        comparePhysicalFiles(snapshot, (path) => {
          const original = saved.files.find((file) => file.path === path)!;
          const current = structuredClone(original);
          current.identity[0] = String(BigInt(original.identity[0]!) + 100n);
          if (path === saved.files[1]!.path) {
            if (mutation === 'mixed') current.identity[0] = original.identity[0]!;
            if (mutation === 'bytes') current.bytes += 'AAAA';
            if (mutation === 'mode') current.identity[3] = '0';
            if (mutation === 'inode') current.identity[1] = '1';
          }
          return current;
        }),
      );
    }
  } finally {
    f.close();
  }
});

test('same-boot device mismatch cannot acquire administrative cross-boot authority', async () => {
  const f = historicalFixture();
  const namespace = deviceNamespace();
  try {
    const captured = await f.captureHistorical();
    namespace.enable();
    await assert.rejects(f.recovery.release(captured.bundle));
    assert.equal(f.reviews.length, 1);
    assert.equal(readFileSync(f.marker, 'utf8'), f.markerBytes);
  } finally {
    namespace.restore();
    f.close();
  }
});

for (const action of ['abort', 'continueCapture'] as const) {
  test(`cross-boot physical archive admission cannot authorize ${action}`, async () => {
    const f = historicalFixture();
    const namespace = deviceNamespace();
    try {
      const captured = await f.captureHistorical();
      f.changeBoot();
      namespace.enable();
      const recovery = new OfflineReservationRecovery(f.authority, f.dependencies);
      await assert.rejects(recovery[action](captured.bundle));
      assert.equal(f.reviews.length, 1);
      assert.equal(readFileSync(f.marker, 'utf8'), f.markerBytes);
      assert.ok(existsSync(join(f.directory, RECOVERY_GATE)));
    } finally {
      namespace.restore();
      f.close();
    }
  });
}

// A second external reboot is a new physical generation, not a renewed consent for the
// already released archive. The final commit must refuse before its approval and rename.
for (const historical of [false, true]) {
  test(`second device generation refuses final commit before approval/rename capsule=${historical}`, async () => {
    const f = historicalFixture();
    const plain = historical ? undefined : fixture();
    const selected = plain ?? f;
    const namespace = deviceNamespace();
    try {
      const captured = historical ? await f.captureHistorical() : await selected.capture();
      selected.changeBoot();
      namespace.enable();
      const recovery = new OfflineReservationRecovery(selected.authority, selected.dependencies);
      await recovery.release(captured.bundle);
      const archiveBytes = readFileSync(join(captured.bundle, 'archive.json'));
      const reviews = selected.reviews.length;
      const gate = readFileSync(join(selected.directory, RECOVERY_GATE));
      const lock = readFileSync(join(selected.directory, 'offline-recovery-operation.lock'));
      const held = join(selected.directory, `recovered-${captured.operationId}.marker.json`);
      // The device generation changes again before the separately approved final commit.
      selected.changeBoot();
      namespace.setOffset(200);
      await assert.rejects(
        recovery.finalize(captured.bundle),
        /pre_commit_physical_source_changed/,
      );
      assert.equal(selected.reviews.length, reviews);
      assert.equal(readFileSync(selected.marker, 'utf8'), selected.markerBytes);
      assert.equal(existsSync(held), false);
      assert.equal(existsSync(join(captured.bundle, 'finalized.json')), false);
      assert.equal(existsSync(join(captured.bundle, 'completion.json')), false);
      assert.deepEqual(readFileSync(join(captured.bundle, 'archive.json')), archiveBytes);
      assert.deepEqual(readFileSync(join(selected.directory, RECOVERY_GATE)), gate);
      assert.deepEqual(
        readFileSync(join(selected.directory, 'offline-recovery-operation.lock')),
        lock,
      );
    } finally {
      namespace.restore();
      plain?.close();
      f.close();
    }
  });
}

test('released physical archive completes final commit in the same boot context', async () => {
  const f = historicalFixture();
  const namespace = deviceNamespace();
  try {
    const captured = await f.captureHistorical();
    f.changeBoot();
    namespace.enable();
    const recovery = new OfflineReservationRecovery(f.authority, f.dependencies);
    await recovery.release(captured.bundle);
    await recovery.finalize(captured.bundle);
    assert.equal(existsSync(f.marker), false);
    assert.ok(existsSync(join(f.directory, `recovered-${captured.operationId}.marker.json`)));
    assert.ok(existsSync(join(captured.bundle, 'completion.json')));
    assert.equal(f.reviews.length, 3);
  } finally {
    namespace.restore();
    f.close();
  }
});

test('final commit physical pin does not block permitted model source drift outside files', async () => {
  // With no declared device difference the existing contract allows currentSources drift.
  const f = historicalFixture();
  try {
    const captured = await f.captureHistorical();
    f.changeBoot();
    const recovery = new OfflineReservationRecovery(f.authority, f.dependencies);
    await recovery.release(captured.bundle);
    f.replace();
    await recovery.finalize(captured.bundle);
    assert.equal(existsSync(f.marker), false);
    assert.ok(existsSync(join(captured.bundle, 'completion.json')));
  } finally {
    f.close();
  }
});

for (const stage of ['before_release', 'before_finalize', 'both'] as const) {
  test(`cross-boot capsule permits fresh selected inode between phases: ${stage}`, async () => {
    const f = historicalFixture(true);
    const namespace = deviceNamespace();
    try {
      const captured = await f.captureHistorical();
      const signed = readFileSync(join(captured.bundle, 'snapshot.json'));
      f.changeBoot();
      namespace.enable();
      if (stage !== 'before_finalize') f.replace();
      const recovery = new OfflineReservationRecovery(f.authority, f.dependencies);
      await recovery.release(captured.bundle);
      const releaseRaw = f.reviews.at(-1)!.currentDigest;
      assert.equal(readFileSync(f.marker, 'utf8'), f.markerBytes);
      if (stage !== 'before_release') f.replace();
      await recovery.finalize(captured.bundle);
      assert.equal(f.reviews.length, 3);
      if (stage !== 'before_release') assert.notEqual(f.reviews.at(-1)!.currentDigest, releaseRaw);
      assert.deepEqual(readFileSync(join(captured.bundle, 'snapshot.json')), signed);
      assert.ok(existsSync(join(captured.bundle, 'completion.json')));
    } finally {
      namespace.restore();
      f.close();
    }
  });
}

for (const phase of ['release', 'finalize'] as const) {
  for (const point of ['review', 'sign', 'revalidate', 'sync', 'commit'] as const) {
    if (point === 'commit' && phase !== 'finalize') continue;
    test(`cross-boot capsule selected inode change during ${phase} ${point} denies`, async () => {
      const f = historicalFixture(true);
      const namespace = deviceNamespace();
      try {
        const captured = await f.captureHistorical();
        f.changeBoot();
        namespace.enable();
        f.replace(); // Real combination: selected source already changed before release.
        const recovery = new OfflineReservationRecovery(f.authority, f.dependencies);
        if (phase === 'finalize') await recovery.release(captured.bundle);
        let changed = false;
        let signed = false;
        const mutate = () => {
          if (!changed) {
            changed = true;
            f.replace();
          }
        };
        if (point === 'review') f.reading(mutate);
        f.review(() => {
          signed = true;
          if (point === 'sign') mutate();
        });
        if (point === 'revalidate')
          f.revalidation(() => {
            mutate();
            return 30_001;
          });
        if (point === 'sync')
          f.synced(() => {
            if (signed) mutate();
          });
        if (point === 'commit')
          f.boundary((stage) => {
            if (stage === 'before_marker') mutate();
          });
        await assert.rejects(recovery[phase](captured.bundle));
        assert.ok(changed);
        assert.equal(readFileSync(f.marker, 'utf8'), f.markerBytes);
        assert.ok(existsSync(join(f.directory, RECOVERY_GATE)));
        assert.equal(
          existsSync(join(f.directory, `recovered-${captured.operationId}.marker.json`)),
          false,
        );
        assert.equal(existsSync(join(captured.bundle, 'completion.json')), false);
      } finally {
        namespace.restore();
        f.close();
      }
    });
  }
}

test('cross-boot capsule still denies a second model inode delta after selected replacement', async () => {
  const f = historicalFixture(true);
  const namespace = deviceNamespace();
  try {
    const captured = await f.captureHistorical();
    f.changeBoot();
    namespace.enable();
    f.replace();
    const other = f.configs[1]!.model!.files[1]!.path;
    writeFileSync(`${other}.replacement`, 'SYNTHETIC-NO-CREDENTIAL', { mode: 0o600 });
    renameSync(`${other}.replacement`, other);
    await assert.rejects(
      f.recovery.release(captured.bundle),
      /enrollment binding|additional source drift/,
    );
    assert.equal(f.reviews.length, 1);
    assert.equal(readFileSync(f.marker, 'utf8'), f.markerBytes);
    assert.equal(existsSync(join(captured.bundle, 'archive.json')), false);
  } finally {
    namespace.restore();
    f.close();
  }
});

for (const mutation of ['device', 'mode', 'nlink', 'symlink', 'missing'] as const) {
  test(`cross-boot capsule fresh selected source still denies ${mutation}`, async () => {
    const f = historicalFixture(true);
    const namespace = deviceNamespace();
    try {
      const captured = await f.captureHistorical();
      f.changeBoot();
      namespace.enable();
      f.replace();
      if (mutation === 'device') namespace.unmap(f.file);
      if (mutation === 'mode') chmodSync(f.file, 0o666);
      if (mutation === 'nlink') linkSync(f.file, `${f.file}.link`);
      if (mutation === 'symlink') {
        renameSync(f.file, `${f.file}.real`);
        symlinkSync(`${f.file}.real`, f.file);
      }
      if (mutation === 'missing') unlinkSync(f.file);
      await assert.rejects(f.recovery.release(captured.bundle), (error) => {
        if (mutation === 'device' || mutation === 'missing') {
          assert.ok(error instanceof OfflineEnrollmentBindingChanged);
          assert.deepEqual(administrativeBlockedOutcome(error), {
            status: 'blocked',
            outcome: 'unconfirmed',
            failure: { stage: 'inspection', code: 'enrollment_binding_changed' },
          });
        }
        return true;
      });
      assert.equal(f.reviews.length, 1);
      assert.equal(readFileSync(f.marker, 'utf8'), f.markerBytes);
      assert.ok(existsSync(join(f.directory, RECOVERY_GATE)));
      assert.equal(existsSync(join(captured.bundle, 'archive.json')), false);
    } finally {
      namespace.restore();
      f.close();
    }
  });
}
