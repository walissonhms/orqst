// SYNTHETIC: temporary files and SQLite only; no AppData, native app, Core, PTY or provider.
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID, verify } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  linkSync,
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
import {
  installAdministrativeAnchor,
  loadAdministrativeAnchor,
  assertAdministrativeAnchor,
  recoveryLocations,
} from '../apps/desktop/src/offline-recovery-anchor.js';
import {
  AdministrativeReviewPipe,
  ADMIN_REVIEW_BYTES,
  administrativeRequestSchema,
  type AdministrativeAction,
} from '../apps/desktop/src/offline-recovery-wire.js';
import {
  administrativeBlockedOutcome,
  TauriOfflineRecovery,
} from '../apps/desktop/src/tauri-offline-recovery.js';
import { OfflineEnrollmentBindingChanged } from '../packages/core/src/terminal/offline-recovery-files.js';
import {
  administrativeRecoveryBytes,
  type AdministrativeRecoveryChallenge,
} from '../packages/core/src/terminal/offline-recovery.js';
import { terminalDigest } from '../packages/core/src/terminal/authority.js';
import { openTerminalJournal } from '../packages/database/src/terminal-journal.js';

function temporary(t: test.TestContext) {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'orqst-SYNTHETIC-native-recovery-')));
  chmodSync(parent, 0o700);
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  return parent;
}
const ack = (frame: Record<string, unknown>, approved = true) => ({
  kind: 'answer',
  session: frame.session,
  id: frame.id,
  nonce: frame.nonce,
  digest: frame.digest,
  approved,
});

// Explicit synthetic native grants; this helper never runs against the native app.
const fixtureGrant = async () => performance.now() + 30_000;

test('blocked diagnostics expose only a fixed typed code, never arbitrary errors or fields', () => {
  const generic = { status: 'blocked', outcome: 'unconfirmed' };
  for (const error of [
    new Error('/SYNTHETIC/private-path owner-key stderr'),
    { stage: 'inspection', code: 'enrollment_binding_changed' },
    null,
  ])
    assert.deepEqual(administrativeBlockedOutcome(error), generic);
  const typed = new OfflineEnrollmentBindingChanged();
  Object.assign(typed, { stage: '/SYNTHETIC/private', code: 'SYNTHETIC-secret' });
  assert.deepEqual(administrativeBlockedOutcome(typed), {
    ...generic,
    failure: { stage: 'inspection', code: 'enrollment_binding_changed' },
  });
});
function reply(pipe: AdministrativeReviewPipe, frame: Record<string, unknown>, approved = true) {
  if (frame.kind === 'review') return pipe.answer(ack(frame, approved));
  if (frame.kind === 'kernel-query') {
    return pipe.kernelAnswer({
      kind: 'kernel-answer',
      session: frame.session,
      id: frame.id,
      result:
        frame.operation === 'self'
          ? {
              boot: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
              pid: process.pid,
              ppid: process.ppid,
              uid: process.getuid!(),
              startSec: 1,
              startUsec: 0,
              sid: 1,
              pgid: 1,
            }
          : true,
    });
  }
  pipe.authorized({
    kind: 'authorized',
    session: frame.session,
    id: frame.id,
    nonce: frame.nonce,
    digest: frame.digest,
    requestNonce: frame.requestNonce,
    proofDigest: frame.proofDigest,
    remainingMs: 29_999,
  });
}
test('native installation signs the exact public preview and durably reloads an independent Ed25519 identity', async (t) => {
  const parent = temporary(t);
  let preview = '';
  await installAdministrativeAnchor(
    parent,
    async (detail) => {
      preview = detail;
      assert.equal(existsSync(recoveryLocations(parent).anchor), false);
      return true;
    },
    () => true,
    fixtureGrant,
  );
  const paths = recoveryLocations(parent),
    anchor = loadAdministrativeAnchor(parent);
  const { nonce, expiresAt, ...installedIntent } = anchor.installation;
  assert.ok(nonce);
  assert.ok(expiresAt);
  assert.deepEqual(installedIntent, JSON.parse(preview).review);
  assert.equal(anchor.privateKey.asymmetricKeyType, 'ed25519');
  assert.equal(lstatSync(paths.anchor).mode & 0o777, 0o700);
  assert.equal(lstatSync(join(paths.anchor, 'identity.json')).mode & 0o777, 0o600);
  assert.equal(preview.includes('PRIVATE KEY'), false);
  const envelope = JSON.parse(readFileSync(join(paths.anchor, 'identity.json'), 'utf8'));
  assert.ok(
    verify(
      null,
      Buffer.from(JSON.stringify(anchor.installation)),
      anchor.publicKey,
      Buffer.from(envelope.signature, 'base64url'),
    ),
  );
  assertAdministrativeAnchor(parent, anchor);
  await assert.rejects(
    installAdministrativeAnchor(
      parent,
      async () => assert.fail('must not rotate'),
      () => true,
      fixtureGrant,
    ),
  );
});

for (const condition of ['cancel', 'drop'] as const)
  test(`anchor ${condition} creates no key or directory`, async (t) => {
    const parent = temporary(t);
    let current = true;
    await assert.rejects(
      installAdministrativeAnchor(
        parent,
        async () => {
          if (condition === 'drop') current = false;
          return condition !== 'cancel';
        },
        () => current,
        fixtureGrant,
      ),
    );
    assert.deepEqual(readdirSync(parent), []);
  });

for (const condition of [
  'partial',
  'symlink',
  'hardlink',
  'mode',
  'wrong-key',
  'directory-mode',
  'inode',
] as const)
  test(`anchor ${condition} is rejected and preserved`, async (t) => {
    const parent = temporary(t);
    await installAdministrativeAnchor(
      parent,
      async () => true,
      () => true,
      fixtureGrant,
    );
    const paths = recoveryLocations(parent),
      file = join(paths.anchor, 'identity.json');
    const expected = loadAdministrativeAnchor(parent),
      original = readFileSync(file);
    if (condition === 'partial') writeFileSync(file, '{');
    if (condition === 'symlink' || condition === 'inode') {
      renameSync(file, file + '.original');
      if (condition === 'symlink') symlinkSync(file + '.original', file);
      else writeFileSync(file, original, { mode: 0o600 });
    }
    if (condition === 'hardlink') linkSync(file, file + '.link');
    if (condition === 'mode') chmodSync(file, 0o644);
    if (condition === 'directory-mode') chmodSync(paths.anchor, 0o750);
    if (condition === 'wrong-key') {
      const value = JSON.parse(original.toString());
      value.publicKey = generateKeyPairSync('ed25519').publicKey.export({
        type: 'spki',
        format: 'pem',
      });
      writeFileSync(file, JSON.stringify(value));
    }
    assert.throws(() => assertAdministrativeAnchor(parent, expected));
    assert.ok(existsSync(file));
    await assert.rejects(
      installAdministrativeAnchor(
        parent,
        async () => assert.fail('partial anchor must not repair'),
        () => true,
        fixtureGrant,
      ),
    );
  });

test('administrative wire accepts a full 64 KiB review, binds exact bytes and denies UTF8 overflow', async () => {
  let frame: Record<string, unknown> = {};
  const pipe = new AdministrativeReviewPipe((value) => {
    frame = value as Record<string, unknown>;
  });
  const detail = 'é'.repeat(ADMIN_REVIEW_BYTES / 2);
  const pending = pipe.review('capture', detail, 'SYNTHETIC-binding');
  assert.equal(frame.detail, detail);
  assert.equal(
    frame.digest,
    terminalDigest(
      JSON.stringify([pipe.session, frame.id, frame.nonce, 'capture', 'SYNTHETIC-binding', detail]),
    ),
  );
  pipe.answer(ack(frame));
  assert.equal(await pending, true);
  assert.throws(() => pipe.review('capture', detail + 'é', 'SYNTHETIC'));
  pipe.close();
});

for (const field of ['session', 'id', 'nonce', 'digest', 'extra'] as const)
  test(`wrong ${field} ACK closes the pipe without consent`, async () => {
    let frame: Record<string, unknown> = {};
    const pipe = new AdministrativeReviewPipe((value) => {
      frame = value as Record<string, unknown>;
    });
    const pending = pipe.review('capture', 'SYNTHETIC', 'binding');
    pipe.answer({ ...ack(frame), [field]: field === 'digest' ? '0'.repeat(64) : randomUUID() });
    assert.equal(await pending, false);
    assert.equal(pipe.current(), false);
    assert.throws(() => pipe.review('capture', 'SYNTHETIC', 'binding'));
  });

test('Cancel, expiry and close never authorize the next phase; replay cannot satisfy a fresh nonce', async () => {
  let frame: Record<string, unknown> = {},
    clock = 1;
  const pipe = new AdministrativeReviewPipe(
    (value) => {
      frame = value as Record<string, unknown>;
    },
    () => clock,
  );
  let pending = pipe.review('capture', 'SYNTHETIC', 'one');
  const old = ack(frame, false);
  pipe.answer(old);
  assert.equal(await pending, false);
  pending = pipe.review('abort', 'SYNTHETIC', 'two');
  clock += 300_001;
  pipe.answer(ack(frame));
  assert.equal(await pending, false);
  assert.throws(() => pipe.review('abort', 'SYNTHETIC', 'three'));
  pipe.answer(old);
  assert.equal(pipe.current(), false);
  const dropped = new AdministrativeReviewPipe(() => {});
  pending = dropped.review('capture', 'SYNTHETIC', 'four');
  dropped.close();
  assert.equal(await pending, false);
});

test('administrative total and escaped-frame budgets are independent of normal preparation limits', async () => {
  let frame: Record<string, unknown> = {};
  const pipe = new AdministrativeReviewPipe((value) => {
    frame = value as Record<string, unknown>;
  });
  assert.throws(() => pipe.review('capture', '\u0000'.repeat(64 * 1024), 'SYNTHETIC'));
  let successes = 0;
  const bounded = new AdministrativeReviewPipe((value) => {
    frame = value as Record<string, unknown>;
  });
  for (let i = 0; i < 9; i++) {
    try {
      const pending = bounded.review('capture', 'x'.repeat(64 * 1024), 'SYNTHETIC');
      bounded.answer(ack(frame));
      assert.equal(await pending, true);
      successes++;
    } catch {
      break;
    }
  }
  assert.equal(successes, 7);
});

test('private action schema accepts no renderer authority, paths, key, boot or source override', () => {
  const request = { kind: 'action', session: randomUUID(), id: 1, action: 'capture', bundle: null };
  assert.ok(administrativeRequestSchema.safeParse(request).success);
  for (const key of [
    'owner',
    'epoch',
    'bootUUID',
    'publicKey',
    'proof',
    'directory',
    'parent',
    'environment',
    'pid',
    'operNonce',
  ])
    assert.equal(
      administrativeRequestSchema.safeParse({ ...request, [key]: 'SYNTHETIC' }).success,
      false,
    );
});

test('the pre-consent read timer is bounded to 300 seconds without granting signing authority', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let frame: Record<string, unknown> = {};
  const pipe = new AdministrativeReviewPipe((value) => {
    frame = value as Record<string, unknown>;
  });
  const pending = pipe.review('capture', 'SYNTHETIC', 'binding');
  t.mock.timers.tick(300_000);
  assert.equal(await pending, false);
  pipe.answer(ack(frame));
  assert.equal(pipe.current(), false);
});

function reservation(t: test.TestContext, parent: string) {
  const paths = recoveryLocations(parent),
    state = join(parent, 'state'),
    project = join(parent, 'project');
  for (const path of [paths.admission, state, project]) mkdirSync(path, { mode: 0o700 });
  const epoch = randomUUID(),
    owner = randomUUID();
  const manifest = join(parent, 'manifest.json');
  const executable = join(parent, 'SYNTHETIC-NOT-EXECUTED');
  writeFileSync(executable, 'SYNTHETIC metadata only', { mode: 0o600 });
  writeFileSync(
    manifest,
    JSON.stringify({
      version: 1,
      trust: 'native-same-user',
      executable: { path: executable, sha256: 'a'.repeat(64) },
      executableVersion: 'SYNTHETIC',
      node: { path: executable, sha256: 'b'.repeat(64) },
      project,
      state,
      identity: { terminalId: randomUUID() },
    }),
    { mode: 0o600 },
  );
  const marker = join(paths.admission, 'active-pair.json');
  writeFileSync(marker, JSON.stringify({ version: 1, owner, epoch, manifests: [manifest] }), {
    mode: 0o600,
  });
  const file = join(state, 'terminal.sqlite'),
    db = new DatabaseSync(file);
  chmodSync(file, 0o600);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0');
  openTerminalJournal(
    db,
    (action) => {
      db.exec('BEGIN IMMEDIATE');
      try {
        const value = action();
        db.exec('COMMIT');
        return value;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    epoch,
    false,
  );
  t.after(() => db.close());
  return {
    marker,
    file,
    before: [readFileSync(marker), readFileSync(file), readFileSync(file + '-wal')],
  };
}

test('native composition installs separately, captures complete WAL with persisted anchor, and aborts with fresh phase review', async (t) => {
  const parent = temporary(t),
    f = reservation(t, parent);
  const reviews: Record<string, unknown>[] = [];
  let approved = true;
  const pipe = new AdministrativeReviewPipe((value) => {
    const frame = value as Record<string, unknown>;
    if (frame.kind === 'review') reviews.push(frame);
    queueMicrotask(() => reply(pipe, frame, approved));
  });
  const service = new TauriOfflineRecovery(parent, pipe, {
    bootUUID: () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  });
  let id = 0;
  const act = (action: AdministrativeAction, bundle: string | null = null) =>
    service.receive({ kind: 'action', session: pipe.session, id: ++id, action, bundle });
  await assert.rejects(act('capture'));
  assert.equal(reviews.length, 0);
  assert.equal(await act('install'), 'installed');
  assert.equal(await act('capture'), 'captured');
  const paths = recoveryLocations(parent),
    bundle = join(paths.bundles, readdirSync(paths.bundles)[0]!);
  const capture = JSON.parse(readFileSync(join(bundle, 'capture.json'), 'utf8')) as {
    challenge: AdministrativeRecoveryChallenge;
    signature: string;
  };
  assert.ok(
    verify(
      null,
      administrativeRecoveryBytes(capture.challenge),
      loadAdministrativeAnchor(parent).publicKey,
      Buffer.from(capture.signature, 'base64url'),
    ),
  );
  const snapshot = JSON.parse(readFileSync(join(bundle, 'snapshot.json'), 'utf8')) as {
    files: { path: string; bytes: string }[];
  };
  assert.equal(
    snapshot.files.find((file) => file.path === f.file + '-wal')?.bytes,
    f.before[2]!.toString('base64'),
  );
  approved = false;
  await assert.rejects(act('abort', bundle));
  assert.ok(existsSync(join(paths.admission, 'offline-recovery.json')));
  approved = true;
  assert.equal(await act('abort', bundle), 'aborted');
  assert.deepEqual(
    [readFileSync(f.marker), readFileSync(f.file), readFileSync(f.file + '-wal')],
    f.before,
  );
  assert.deepEqual(
    reviews.map((review) => review.action),
    ['install', 'capture', 'abort', 'abort'],
  );
  assert.equal(new Set(reviews.map((review) => review.nonce)).size, reviews.length);
  await assert.rejects(
    service.receive({ kind: 'action', session: pipe.session, id, action: 'capture', bundle: null }),
  );
  pipe.close();
});

for (const interruption of [
  'EOF-during-modal',
  'ACK-then-EOF-before-signature',
  'anchor-replaced-after-review',
  'Cancel-then-explicit-new-capture',
] as const)
  test(`${interruption} cannot inherit capture consent or erase the original reservation`, async (t) => {
    const parent = temporary(t),
      f = reservation(t, parent);
    await installAdministrativeAnchor(
      parent,
      async () => true,
      () => true,
      fixtureGrant,
    );
    let frame: Record<string, unknown> = {};
    const pipe = new AdministrativeReviewPipe((value) => {
      frame = value as Record<string, unknown>;
      if (frame.kind === 'authorize') queueMicrotask(() => reply(pipe, frame));
    });

    const service = new TauriOfflineRecovery(parent, pipe, {
      bootUUID: () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    });
    const pending = service.receive({
      kind: 'action',
      session: pipe.session,
      id: 1,
      action: 'capture',
      bundle: null,
    });
    await Promise.resolve();
    assert.equal(frame.action, 'capture');
    if (interruption === 'EOF-during-modal') {
      pipe.close();
      pipe.answer(ack(frame));
    }
    if (interruption === 'ACK-then-EOF-before-signature') {
      pipe.answer(ack(frame));
      pipe.close();
    }
    if (interruption === 'anchor-replaced-after-review') {
      const file = join(recoveryLocations(parent).anchor, 'identity.json');
      const saved = readFileSync(file);
      renameSync(file, file + '.preserved');
      writeFileSync(file, saved, { mode: 0o600 });
      pipe.answer(ack(frame));
    }
    if (interruption === 'Cancel-then-explicit-new-capture') pipe.answer(ack(frame, false));
    await assert.rejects(pending);
    const paths = recoveryLocations(parent);
    assert.equal(existsSync(join(paths.admission, 'offline-recovery.json')), false);
    for (const name of readdirSync(paths.bundles))
      assert.equal(existsSync(join(paths.bundles, name, 'capture.json')), false);
    assert.deepEqual(readFileSync(f.marker), f.before[0]);
    if (interruption === 'Cancel-then-explicit-new-capture') {
      const first = frame;
      const next = service.receive({
        kind: 'action',
        session: pipe.session,
        id: 2,
        action: 'capture',
        bundle: null,
      });
      await Promise.resolve();
      assert.notEqual(frame.nonce, first.nonce);
      pipe.answer(ack(frame));
      assert.equal(await next, 'captured');
    }
    pipe.close();
  });

test('pipe loss after signed capture starts preserves durable effects and reports uncertainty, never cancellation or helper exit', async (t) => {
  const parent = temporary(t),
    f = reservation(t, parent);
  await installAdministrativeAnchor(
    parent,
    async () => true,
    () => true,
    fixtureGrant,
  );
  const pipe = new AdministrativeReviewPipe((value) =>
    queueMicrotask(() => reply(pipe, value as Record<string, unknown>)),
  );
  const service = new TauriOfflineRecovery(parent, pipe, {
    bootUUID: () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    boundary: (stage) => {
      if (stage === 'capture') pipe.close();
    },
  });
  await assert.rejects(
    service.receive({
      kind: 'action',
      session: pipe.session,
      id: 1,
      action: 'capture',
      bundle: null,
    }),
    /expired|unconfirmed/,
  );
  const paths = recoveryLocations(parent),
    bundle = join(paths.bundles, readdirSync(paths.bundles)[0]!);
  assert.ok(existsSync(join(bundle, 'capture.json')));
  assert.ok(existsSync(join(bundle, 'snapshot.json')));
  assert.equal(existsSync(join(paths.admission, 'offline-recovery.json')), false);
  assert.deepEqual(readFileSync(f.marker), f.before[0]);
  assert.equal(pipe.current(), false);
});

for (const scenario of ['final-commit', 'future-controls', 'interrupted-commit'] as const)
  test(`durable native anchor spans fixture boots and ${scenario} preserves the exact old-operation boundary`, async (t) => {
    const parent = temporary(t),
      f = reservation(t, parent);
    await installAdministrativeAnchor(
      parent,
      async () => true,
      () => true,
      fixtureGrant,
    );
    const first = new AdministrativeReviewPipe((value) =>
      queueMicrotask(() => reply(first, value as Record<string, unknown>)),
    );
    const before = new TauriOfflineRecovery(parent, first, {
      bootUUID: () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    });
    assert.equal(
      await before.receive({
        kind: 'action',
        session: first.session,
        id: 1,
        action: 'capture',
        bundle: null,
      }),
      'captured',
    );
    const paths = recoveryLocations(parent),
      bundle = join(paths.bundles, readdirSync(paths.bundles)[0]!);
    const persisted = loadAdministrativeAnchor(parent).installation.fingerprint;
    first.close();
    const phases: string[] = [];
    let interrupted = false,
      committed = false;
    const next = new AdministrativeReviewPipe((value) => {
      const frame = value as Record<string, unknown>;
      if (frame.kind === 'review') phases.push(String(frame.action));
      if (frame.action === 'finalize' && !committed)
        assert.deepEqual(readFileSync(f.marker), f.before[0]);
      queueMicrotask(() => reply(next, frame));
    });
    const future = JSON.stringify({
      version: 1,
      owner: randomUUID(),
      manifests: ['/SYNTHETIC-FUTURE-UNREAD'],
    });
    const service = new TauriOfflineRecovery(parent, next, {
      bootUUID: () => 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      boundary: (stage) => {
        if (stage === 'before_marker') {
          assert.deepEqual(readFileSync(f.marker), f.before[0]);
          const intent = JSON.parse(readFileSync(join(bundle, 'finalized.json'), 'utf8'));
          assert.equal(intent.plan.status, 'commit_prepared');
          assert.equal(intent.challenge.currentDigest, terminalDigest(JSON.stringify(intent.plan)));
          assert.ok(
            verify(
              null,
              administrativeRecoveryBytes(intent.challenge),
              loadAdministrativeAnchor(parent).publicKey,
              Buffer.from(intent.signature, 'base64url'),
            ),
          );
        }
        if (stage !== 'after_marker') return;
        committed = true;
        writeFileSync(f.marker, future, { mode: 0o600, flag: 'wx' });
        if (scenario === 'future-controls') {
          const gate = join(paths.admission, 'offline-recovery.json');
          const saved = readFileSync(gate);
          renameSync(gate, gate + '.preserved');
          writeFileSync(gate, saved, { mode: 0o600, flag: 'wx' });
        }
        if (scenario === 'interrupted-commit' && !interrupted) {
          interrupted = true;
          throw new Error('SYNTHETIC interrupted receipt');
        }
      },
    });
    let id = 0;
    const act = (action: AdministrativeAction) =>
      service.receive({ kind: 'action', session: next.session, id: ++id, action, bundle });
    assert.equal(loadAdministrativeAnchor(parent).installation.fingerprint, persisted);
    assert.equal(await act('release'), 'release_prepared');
    assert.deepEqual(readFileSync(f.marker), f.before[0]);
    assert.equal(await act('continueRelease'), 'release_prepared');
    assert.deepEqual(readFileSync(f.marker), f.before[0]);
    if (scenario === 'interrupted-commit') await assert.rejects(act('finalize'));
    assert.equal(
      await act('finalize'),
      scenario === 'future-controls' ? 'finalized_controls_preserved' : 'finalized',
    );
    assert.equal(readFileSync(f.marker, 'utf8'), future);
    assert.equal(
      existsSync(join(paths.admission, 'offline-recovery.json')),
      scenario === 'future-controls',
    );
    await assert.rejects(act('finalize')); // Replay never authorizes touching the future owner.
    assert.equal(readFileSync(f.marker, 'utf8'), future);
    assert.ok(
      phases.includes('release') &&
        phases.includes('continueRelease') &&
        phases.includes('finalize'),
    );
    next.close();
  });

const authorizationAck = (frame: Record<string, unknown>, remainingMs = 29_999) => ({
  kind: 'authorized',
  session: frame.session,
  id: frame.id,
  nonce: frame.nonce,
  digest: frame.digest,
  requestNonce: frame.requestNonce,
  proofDigest: frame.proofDigest,
  remainingMs,
});

test('reading for 60 seconds grants no proof until a new explicit approval and native authorization', async () => {
  let clock = 0,
    frame: Record<string, unknown> = {};
  const pipe = new AdministrativeReviewPipe(
    (value) => {
      frame = value as Record<string, unknown>;
    },
    () => clock,
  );
  const preview = pipe.review('capture', 'SYNTHETIC complete intent', 'SYNTHETIC binding');
  clock = 60_000;
  assert.equal(frame.kind, 'review');
  pipe.answer(ack(frame));
  assert.equal(await preview, true);
  const signing = pipe.authorize('SYNTHETIC binding', 'SYNTHETIC fresh challenge');
  pipe.authorized(authorizationAck(frame, 29_000));
  assert.equal(await signing, 89_000);
  pipe.close();
});

test('native remaining time is transferred from helper sendTime, never ACK receiptTime', async () => {
  let clock = 0,
    frame: Record<string, unknown> = {};
  const pipe = new AdministrativeReviewPipe(
    (value) => {
      frame = value as Record<string, unknown>;
    },
    () => clock,
  );
  const preview = pipe.review('capture', 'SYNTHETIC', 'binding');
  pipe.answer(ack(frame));
  await preview;
  clock = 20_000;
  const signing = pipe.authorize('binding', 'challenge');
  clock = 21_000;
  pipe.authorized(authorizationAck(frame, 9_000));
  assert.equal(await signing, 29_000);
  pipe.close();
});

test('each revalidation has a fresh request nonce and rejects replay from check one into check two', async () => {
  let frame: Record<string, unknown> = {};
  const pipe = new AdministrativeReviewPipe((value) => {
    frame = value as Record<string, unknown>;
  });
  const preview = pipe.review('finalize', 'SYNTHETIC', 'binding');
  pipe.answer(ack(frame));
  await preview;
  let pending = pipe.authorize('binding', 'challenge');
  pipe.authorized(authorizationAck(frame));
  await pending;
  pending = pipe.authorize('binding', 'challenge', true);
  const first = frame,
    replay = authorizationAck(frame);
  pipe.authorized(replay);
  await pending;
  pending = pipe.authorize('binding', 'challenge', true);
  assert.notEqual(frame.requestNonce, first.requestNonce);
  assert.notEqual(frame.proofDigest, first.proofDigest);
  pipe.authorized(replay);
  assert.equal(await pending, null);
  assert.equal(pipe.current(), false);
});

for (const field of [
  'session',
  'id',
  'nonce',
  'digest',
  'requestNonce',
  'proofDigest',
  'extra',
  'remainingMs',
])
  test(`a changed ${field} authorization ACK cannot authorize signing`, async () => {
    let frame: Record<string, unknown> = {};
    const pipe = new AdministrativeReviewPipe((value) => {
      frame = value as Record<string, unknown>;
    });
    const preview = pipe.review('capture', 'SYNTHETIC', 'binding');
    pipe.answer(ack(frame));
    await preview;
    const pending = pipe.authorize('binding', 'challenge');
    pipe.authorized({
      ...authorizationAck(frame),
      [field]: field === 'remainingMs' ? 30_001 : randomUUID(),
    });
    assert.equal(await pending, null);
    assert.equal(pipe.current(), false);
  });

test('Cancel, details Back without approval, repeated signing and EOF never create or renew proof permission', async () => {
  let frame: Record<string, unknown> = {};
  const pipe = new AdministrativeReviewPipe((value) => {
    frame = value as Record<string, unknown>;
  });
  let pending = pipe.review('capture', 'SYNTHETIC', 'binding');
  // Back emits no ACK; neither it nor a pending preview authorizes a challenge.
  assert.equal(frame.kind, 'review');
  pipe.answer(ack(frame, false));
  assert.equal(await pending, false);
  assert.equal(await pipe.authorize('binding', 'challenge'), null);
  const fresh = new AdministrativeReviewPipe((value) => {
    frame = value as Record<string, unknown>;
  });
  pending = fresh.review('capture', 'SYNTHETIC', 'binding');
  fresh.answer(ack(frame));
  await pending;
  let signing = fresh.authorize('binding', 'challenge');
  fresh.authorized(authorizationAck(frame));
  await signing;
  assert.equal(await fresh.authorize('binding', 'challenge'), null);
  const dropped = new AdministrativeReviewPipe((value) => {
    frame = value as Record<string, unknown>;
  });
  pending = dropped.review('capture', 'SYNTHETIC', 'binding');
  dropped.answer(ack(frame));
  await pending;
  signing = dropped.authorize('binding', 'challenge');
  dropped.close();
  assert.equal(await signing, null);
});

test('a later review cannot restart the original 300 second session budget', async () => {
  let clock = 0,
    frame: Record<string, unknown> = {};
  const pipe = new AdministrativeReviewPipe(
    (value) => {
      frame = value as Record<string, unknown>;
    },
    () => clock,
  );
  let preview = pipe.review('capture', 'SYNTHETIC', 'first');
  clock = 290_000;
  pipe.answer(ack(frame, false));
  await preview;
  preview = pipe.review('capture', 'SYNTHETIC', 'second');
  clock = 300_000;
  pipe.answer(ack(frame));
  assert.equal(await preview, false);
  pipe.close();
});

for (const reading of [20_000, 60_000])
  test(`anchor installation keeps format one and starts its short proof after ${reading}ms reading`, async (t) => {
    const parent = temporary(t);
    let clock = 0,
      preview = '',
      signed = '';
    const installed = await installAdministrativeAnchor(
      parent,
      async (detail) => {
        preview = detail;
        clock += reading;
        return true;
      },
      () => true,
      async (challenge) => {
        signed = challenge;
        return clock + 29_000;
      },
      () => clock,
    );
    assert.equal(installed.version, 1);
    assert.equal(installed.expiresAt, reading + 30_000);
    assert.equal('nonce' in JSON.parse(preview).review, false);
    assert.deepEqual(JSON.parse(signed), installed);
    assert.equal(loadAdministrativeAnchor(parent).installation.fingerprint, installed.fingerprint);
  });

for (const point of ['sign', 'commit'] as const)
  test(`anchor ${point} expiry denies publication without regenerating or cleaning partial material`, async (t) => {
    const parent = temporary(t);
    let clock = 0,
      calls = 0;
    await assert.rejects(
      installAdministrativeAnchor(
        parent,
        async () => true,
        () => true,
        async () => {
          calls++;
          if ((point === 'sign' && calls === 1) || (point === 'commit' && calls === 2))
            clock += 30_000;
          return 30_000;
        },
        () => clock,
      ),
      /expired/,
    );
    const anchor = recoveryLocations(parent).anchor;
    assert.equal(existsSync(join(anchor, 'identity.json')), false);
    assert.equal(existsSync(anchor), point === 'commit');
  });

test('authorization near session expiry carries the absolute session cap through synchronous helper work', async () => {
  let clock = 0,
    frame: Record<string, unknown> = {};
  const pipe = new AdministrativeReviewPipe(
    (value) => {
      frame = value as Record<string, unknown>;
    },
    () => clock,
  );
  const preview = pipe.review('capture', 'SYNTHETIC', 'binding');
  clock = 299_000;
  pipe.answer(ack(frame));
  await preview;
  const signing = pipe.authorize('binding', 'challenge');
  pipe.authorized(authorizationAck(frame, 29_000));
  assert.equal(await signing, 300_000);
  const checking = pipe.authorize('binding', 'challenge', true);
  clock = 300_000;
  pipe.authorized(authorizationAck(frame, 29_000));
  assert.equal(await checking, null);
  pipe.close();
});
