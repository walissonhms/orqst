// SYNTHETIC: disposable files/SQLite only. No runtime, Core, PTY, auth DB or reboot.
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  fsyncSync,
  lstatSync,
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
import test from 'node:test';
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
  OfflineReservationRecovery,
  type AdministrativeRecoveryChallenge,
} from '../packages/core/src/terminal/offline-recovery.js';
import {
  RECOVERY_GATE,
  snapshotOfflineReservation,
} from '../packages/core/src/terminal/offline-recovery-files.js';

function fixture(wal = false) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'orqst-SYNTHETIC-offline-')));
  const directory = join(root, 'preferences');
  const recoveryRoot = join(root, 'captures');
  const project = join(root, 'project');
  const model = join(root, 'model.json');
  for (const path of [directory, recoveryRoot, project]) mkdirSync(path, { mode: 0o700 });
  writeFileSync(model, 'SYNTHETIC-NO-CREDENTIAL', { mode: 0o600 });
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
        files: [{ path: model, sha256: terminalDigest('SYNTHETIC-NO-CREDENTIAL') }],
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
  let cancel = false;
  let fault: string | undefined;
  let syncCount = 0;
  let failSync = -1;
  let clock = 1;
  const dependencies = {
    bootUUID: () => boot,
    now: () => clock,
    sync: (fd: number) => {
      if (++syncCount === failSync) throw new Error('SYNTHETIC fsync failure');
      fsyncSync(fd);
    },
    boundary: (stage: string) => {
      if (stage === fault) throw new Error(`SYNTHETIC ${stage} fsync/write failure`);
    },
  };
  const authority = {
    publicKey: keys.publicKey,
    review: async (challenge: Readonly<AdministrativeRecoveryChallenge>, fullReview: string) => {
      reviews.push({ ...challenge });
      fullReviews.push(fullReview);
      reviewHook?.(challenge);
      return cancel
        ? null
        : sign(null, administrativeRecoveryBytes(challenge), keys.privateKey).toString('base64url');
    },
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
    assert.ok(!existsSync(f.marker));
    assert.equal(
      readFileSync(join(f.directory, `recovered-${capture.operationId}.marker.json`), 'utf8'),
      f.markerBytes,
    );
    const archive = JSON.parse(readFileSync(join(capture.bundle, 'archive.json'), 'utf8'));
    assert.equal(archive.current.journals[0].logical.attempts[0].state, 'prepared');
    assert.equal(archive.current.journals[0].logical.attempts[0].exit, undefined);
    assert.equal(archive.current.journals[1].logical.attempts.length, 0);
    assert.equal(archive.authority, 'administrative_recovery');
    for (const [slot, { file }] of f.databases.entries()) {
      assert.deepEqual(readFileSync(file), before[slot]![0]);
      assert.deepEqual(readFileSync(`${file}-wal`), before[slot]![1]);
    }
    assert.equal(next.finalize(capture.bundle).status, 'finalized');
    assert.ok(!existsSync(join(f.directory, RECOVERY_GATE)));
    assert.equal(f.reviews.length, 2);
    assert.match(f.fullReviews[1]!, /prepared/);
    assert.ok(f.fullReviews[1]!.includes(f.receiptFile));
    await assert.rejects(next.release(capture.bundle));
    assert.throws(() => next.finalize(capture.bundle));
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
    assert.equal((await f.recovery.release(capture.bundle)).status, 'released');
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

for (const stage of [
  'gate',
  'capture',
  'archive',
  'before_marker',
  'after_marker',
  'receipt',
] as const)
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
        if (stage === 'after_marker' || stage === 'receipt') {
          assert.ok(existsSync(join(f.directory, `recovered-${capture.operationId}.marker.json`)));
        } else assert.equal(readFileSync(f.marker, 'utf8'), f.markerBytes);
        await assert.rejects(f.recovery.release(capture.bundle)); // no retry after uncertain effects
      }
      assert.ok(existsSync(join(f.directory, RECOVERY_GATE)));
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
      { publicKey: other.publicKey, review: async () => 'x'.repeat(86) },
      f.dependencies,
    );
    await assert.rejects(recovery.release(capture.bundle), /Untrusted administrative/);
    const runtime = new OfflineReservationRecovery(
      { publicKey: f.authority.publicKey, review: async () => 'true' },
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
  test(`capture fsync syscall failure ${syncNumber} keeps original marker and sticky gate`, async () => {
    const f = fixture();
    try {
      f.failSyncAt(syncNumber);
      await assert.rejects(f.capture(), /fsync failure/);
      assert.equal(readFileSync(f.marker, 'utf8'), f.markerBytes);
      assert.ok(existsSync(join(f.directory, RECOVERY_GATE)));
      assert.throws(() => desktopAgentsAdmission(f.directory));
    } finally {
      f.close();
    }
  });

for (const syncNumber of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
  test(`release fsync syscall failure ${syncNumber} preserves evidence and forbids a second attempt`, async () => {
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
      await assert.rejects(f.recovery.release(capture.bundle));
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

for (const change of [
  'journal',
  'enrollment',
  'held_marker',
  'archive',
  'receipt',
  'boot',
] as const)
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
      if (change === 'boot') f.changeBoot();
      assert.throws(() => f.recovery.finalize(capture.bundle));
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
    const held = join(f.directory, `recovered-${capture.operationId}.marker.json`);
    const replacement = `${held}.SYNTHETIC`;
    writeFileSync(replacement, readFileSync(held), { mode: 0o600 });
    renameSync(replacement, held);
    assert.throws(() => f.recovery.finalize(capture.bundle), /identity/);
    assert.ok(existsSync(join(f.directory, RECOVERY_GATE)));
  } finally {
    f.close();
  }
});
