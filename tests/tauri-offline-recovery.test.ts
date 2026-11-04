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
import { TauriOfflineRecovery } from '../apps/desktop/src/tauri-offline-recovery.js';
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
  );
  const paths = recoveryLocations(parent),
    anchor = loadAdministrativeAnchor(parent);
  assert.deepEqual(anchor.installation, JSON.parse(preview));
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
  clock += 30_001;
  pipe.answer(ack(frame));
  assert.equal(await pending, false);
  pending = pipe.review('abort', 'SYNTHETIC', 'three');
  pipe.answer(old);
  assert.equal(await pending, false);
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

test('the actual review timer denies at 30 seconds without extending to the session deadline', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let frame: Record<string, unknown> = {};
  const pipe = new AdministrativeReviewPipe((value) => {
    frame = value as Record<string, unknown>;
  });
  const pending = pipe.review('capture', 'SYNTHETIC', 'binding');
  t.mock.timers.tick(30_000);
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
    reviews.push(frame);
    queueMicrotask(() => pipe.answer(ack(frame, approved)));
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
    );
    let frame: Record<string, unknown> = {};
    const pipe = new AdministrativeReviewPipe((value) => {
      frame = value as Record<string, unknown>;
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
  );
  const pipe = new AdministrativeReviewPipe((value) =>
    queueMicrotask(() => pipe.answer(ack(value as Record<string, unknown>))),
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
    /unconfirmed/,
  );
  const paths = recoveryLocations(parent),
    bundle = join(paths.bundles, readdirSync(paths.bundles)[0]!);
  assert.ok(existsSync(join(bundle, 'capture.json')));
  assert.ok(existsSync(join(bundle, 'snapshot.json')));
  assert.ok(existsSync(join(paths.admission, 'offline-recovery.json')));
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
    );
    const first = new AdministrativeReviewPipe((value) =>
      queueMicrotask(() => first.answer(ack(value as Record<string, unknown>))),
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
      phases.push(String(frame.action));
      if (frame.action === 'finalize' && !committed)
        assert.deepEqual(readFileSync(f.marker), f.before[0]);
      queueMicrotask(() => next.answer(ack(frame)));
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
