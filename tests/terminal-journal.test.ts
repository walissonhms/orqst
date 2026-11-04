// Synthetic metadata and in-memory backend only; never execute a provider or inspect user data.
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Store, TERMINAL_JOURNAL_LIMITS } from '@orqst/database';
import { terminalAttemptSchema, type TerminalJournal } from '@orqst/protocol';
import { openTerminalJournal } from '../packages/database/src/terminal-journal.js';
import {
  TerminalAuthority,
  terminalChallengeBytes,
  terminalDigest,
  type TerminalChallenge,
} from '../packages/core/src/terminal/authority.js';
import {
  TerminalSupervisor,
  type TerminalEvents,
  type TerminalBackend,
  type TerminalProfile,
} from '../packages/core/src/terminal/supervisor.js';

const profile: TerminalProfile = {
  id: 'synthetic-journal-v1',
  projectId: 'synthetic-project',
  executable: '/synthetic/not-executed',
  executableSha256: terminalDigest('synthetic'),
  executableVersion: 'synthetic-v1',
  argv: ['synthetic-sensitive-argument'],
  cwd: '/synthetic/not-opened',
  environmentProfile: 'no-credentials',
  permissions: 'synthetic-backend-only',
};
function record(projectId = profile.projectId) {
  return {
    instanceId: randomUUID(),
    clientId: 'synthetic-native',
    projectId,
    manifestDigest: terminalDigest('synthetic'),
  };
}
function fixture(action: (file: string, store: Store) => void) {
  const root = mkdtempSync(join(tmpdir(), 'orqst-synthetic-journal-'));
  const file = join(root, 'journal.db');
  const store = new Store(file);
  try {
    action(file, store);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
}
function supervisor(
  store: Store,
  options: {
    recover?: boolean;
    failStart?: boolean;
    syncExit?: boolean;
    now?: () => number;
    journal?: (journal: TerminalJournal) => TerminalJournal;
  } = {},
) {
  const keys = generateKeyPairSync('ed25519');
  const authority = new TerminalAuthority(
    new Map([['synthetic-native', keys.publicKey]]),
    options.now,
  );
  const journal = store.terminalJournal(authority.epoch, { recover: options.recover ?? false });
  const signals: string[] = [];
  const writes: string[] = [];
  let events: TerminalEvents | undefined;
  let starts = 0;
  const backend: TerminalBackend = {
    validate: () => true,
    start: (_profile, callbacks) => {
      starts++;
      events = callbacks;
      if (options.syncExit) callbacks.exit(17);
      if (options.failStart) throw new Error('synthetic start uncertainty');
      return {
        write: (text) => writes.push(text),
        resize: () => {},
        signal: (signal) => signals.push(signal),
        dispose: () => {},
      };
    },
  };
  const instance = new TerminalSupervisor(
    authority,
    backend,
    [profile],
    options.journal?.(journal) ?? journal,
  );
  const proof = (challenge: TerminalChallenge) => ({
    challengeId: challenge.challengeId,
    signature: sign(null, terminalChallengeBytes(challenge), keys.privateKey).toString('base64url'),
  });
  const prepare = () => instance.prepare('synthetic-native', profile.id);
  const launch = () => {
    const prepared = prepare();
    instance.launch(prepared.attemptId, proof(prepared.challenge));
    return prepared.attemptId;
  };
  return {
    authority,
    instance,
    journal,
    proof,
    prepare,
    launch,
    signals,
    writes,
    starts: () => starts,
    events: () => {
      assert.ok(events);
      return events;
    },
  };
}

test('observer startup does not initialize the opt-in journal; explicit journal preserves observer schema', () =>
  fixture((file, store) => {
    const raw = new DatabaseSync(file);
    try {
      assert.equal(
        raw.prepare("SELECT 1 FROM sqlite_master WHERE name='terminal_attempts'").get(),
        undefined,
      );
      const version = raw.prepare('PRAGMA user_version').get()?.user_version;
      const journal = store.terminalJournal(randomUUID(), { recover: false });
      assert.equal(raw.prepare('PRAGMA user_version').get()?.user_version, version);
      assert.equal(raw.prepare('SELECT version FROM terminal_schema').get()?.version, 2);
      assert.equal(statSync(file).mode & 0o777, 0o600);
      const input = record();
      journal.prepare(input);
      assert.equal(journal.read(input.instanceId)?.state, 'prepared');
      assert.throws(() =>
        journal.prepare({ ...input, instanceId: randomUUID(), prompt: 'secret' } as typeof input),
      );
      journal.release();
    } finally {
      raw.close();
    }
  }));

test('a separate synthetic writer exiting abruptly leaves recoverable committed WAL facts', () => {
  const root = mkdtempSync(join(tmpdir(), 'orqst-synthetic-journal-crash-'));
  const file = join(root, 'journal.db');
  try {
    const child = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        fileURLToPath(new URL('./helpers/terminal-journal-crash.ts', import.meta.url)),
        file,
      ],
      {
        cwd: fileURLToPath(new URL('..', import.meta.url)),
        env: { LANG: 'C', LC_ALL: 'C', TMPDIR: root },
        timeout: 10_000,
        maxBuffer: 4096,
      },
    );
    assert.equal(child.status, 73, String(child.stderr));
    assert.equal(child.error, undefined);
    const store = new Store(file);
    const raw = new DatabaseSync(file);
    try {
      const journal = store.terminalJournal(randomUUID(), { recover: true });
      const records = raw
        .prepare('SELECT metadata FROM terminal_attempts ORDER BY project_id')
        .all()
        .map((row) => terminalAttemptSchema.parse(JSON.parse(String(row.metadata))));
      assert.deepEqual(
        records.map((value) => value.state),
        ['start_failed', 'ownership_lost'],
      );
      assert.equal(store.sessions().length, 0);
      journal.release();
    } finally {
      raw.close();
      store.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('restart recovers committed preparation/start/running facts without adoption or relaunch', () =>
  fixture((file, store) => {
    const epoch = randomUUID();
    const old = store.terminalJournal(epoch, { recover: false });
    const prepared = record('prepared');
    const starting = record('starting');
    const running = record('running');
    for (const input of [prepared, starting, running]) old.prepare(input);
    old.transition(starting.instanceId, 'starting');
    old.transition(running.instanceId, 'starting');
    old.transition(running.instanceId, 'running');
    const reopened = new Store(file);
    try {
      assert.throws(
        () => reopened.terminalJournal(randomUUID(), { recover: false }),
        /already owned/,
      );
      assert.throws(() => reopened.terminalJournal(epoch, { recover: true }), /already owned/);
      const recovered = reopened.terminalJournal(randomUUID(), { recover: true });
      assert.equal(recovered.read(prepared.instanceId)?.state, 'start_failed');
      assert.equal(recovered.read(starting.instanceId)?.state, 'ownership_lost');
      assert.equal(recovered.read(running.instanceId)?.state, 'ownership_lost');
      assert.throws(() => old.assertOwner(), /ownership/);
      assert.throws(
        () => old.transition(running.instanceId, 'exited', { exitCode: 0 }),
        /ownership/,
      );
      const blocked = record('new-project');
      recovered.prepare(blocked);
      assert.throws(() => recovered.transition(blocked.instanceId, 'starting'), /admission/);
      assert.equal(recovered.read(blocked.instanceId)?.state, 'prepared');
      recovered.release();
    } finally {
      reopened.close();
    }
  }));

test('fencing revokes old input/stop/attachments and late callbacks cannot erase uncertainty', () =>
  fixture((_file, store) => {
    const first = supervisor(store);
    const id = first.launch();
    first.events().started();
    const attachment = first.instance.attach(
      id,
      first.proof(first.instance.requestAttach('synthetic-native', id)),
    );
    const lease = first.instance.enableInput(
      id,
      attachment,
      first.proof(first.instance.requestInput(id, attachment)),
    );
    const stopProof = first.proof(first.instance.requestStop('synthetic-native', id, 'SIGTERM'));
    const recovered = store.terminalJournal(randomUUID(), { recover: true });
    assert.throws(() => first.instance.write(id, attachment, lease, 0, 'synthetic-input'));
    assert.throws(() => first.instance.stop(id, 'SIGTERM', stopProof));
    assert.throws(() => first.instance.read(id, attachment, 0));
    first.events().started();
    first.events().exit(0);
    assert.equal(first.instance.snapshot(id).state, 'ownership_lost');
    assert.equal(recovered.read(id)?.state, 'ownership_lost');
    assert.deepEqual(first.writes, []);
    assert.deepEqual(first.signals, []);
    const blocked = record();
    recovered.prepare(blocked);
    assert.throws(() => recovered.transition(blocked.instanceId, 'starting'), /admission/);
    first.instance.shutdown();
    recovered.assertOwner();
    recovered.release();
  }));

test('journal commit failure prevents start, consumes the grant and never retries', () =>
  fixture((_file, store) => {
    const s = supervisor(store, {
      journal: (journal) => ({
        ...journal,
        transition: (_id, state) => {
          if (state === 'starting') throw new Error('synthetic disk failure');
        },
      }),
    });
    const prepared = s.prepare();
    const proof = s.proof(prepared.challenge);
    assert.throws(() => s.instance.launch(prepared.attemptId, proof), /disk failure/);
    assert.equal(s.starts(), 0);
    assert.throws(() => s.instance.launch(prepared.attemptId, proof), /authorization/);
    assert.equal(s.starts(), 0);
    s.instance.shutdown();
  }));

test('uncommitted outer transactions cannot hide admission or roll back a backend effect', () =>
  fixture((_file, store) => {
    const s = supervisor(store);
    assert.throws(() => store.transaction(() => s.prepare()), /independent commit/);
    const prepared = s.prepare();
    assert.throws(
      () =>
        store.transaction(() => s.instance.launch(prepared.attemptId, s.proof(prepared.challenge))),
      /independent commit/,
    );
    assert.equal(s.starts(), 0);
    assert.equal(s.journal.read(prepared.attemptId)?.state, 'prepared');
    s.instance.shutdown();
  }));

test('consent that expires during durable admission cannot dispatch a backend start', () =>
  fixture((_file, store) => {
    let now = 0;
    const s = supervisor(store, {
      now: () => now,
      journal: (journal) => ({
        ...journal,
        withOwner: (effect) => {
          now = 30_000;
          return journal.withOwner(effect);
        },
      }),
    });
    const id = s.launch();
    assert.equal(s.starts(), 0);
    assert.equal(s.journal.read(id)?.state, 'ownership_lost');
    assert.deepEqual(s.signals, []);
    s.instance.shutdown();
  }));

test('uncertain starts, confirmed synchronous exits and explicit shutdown retain their evidence', () =>
  fixture((_file, store) => {
    const uncertain = supervisor(store, { failStart: true });
    const id = uncertain.launch();
    assert.equal(uncertain.journal.read(id)?.state, 'ownership_lost');
    uncertain.instance.shutdown();
    // A new epoch cannot remove the lost project reservation.
    const next = store.terminalJournal(randomUUID(), { recover: false });
    assert.equal(next.read(id)?.state, 'ownership_lost');
    next.release();
  }));

test('confirmed exit is persisted with no input/output/argv/lease content', () =>
  fixture((file, store) => {
    const s = supervisor(store, { syncExit: true, failStart: true });
    const id = s.launch();
    assert.equal(s.instance.snapshot(id).state, 'exited');
    assert.deepEqual(s.journal.read(id)?.exit, { exitCode: 17 });
    s.instance.shutdown();
    const raw = new DatabaseSync(file);
    try {
      const data = String(
        raw.prepare('SELECT metadata FROM terminal_attempts WHERE instance_id=?').get(id)?.metadata,
      );
      assert.deepEqual(
        Object.keys(JSON.parse(data)).sort(),
        [
          'instanceId',
          'epoch',
          'clientId',
          'projectId',
          'manifestDigest',
          'state',
          'createdAt',
          'updatedAt',
          'exit',
        ].sort(),
      );
      assert.ok(!data.includes('synthetic-sensitive-argument'));
      assert.ok(!data.includes(profile.cwd));
      assert.equal(store.events().length, 0);
      assert.equal(store.sessions().length, 0);
    } finally {
      raw.close();
    }
  }));

test('strict transition evidence rejects fabricated exit, replay and malformed metadata', () =>
  fixture((_file, store) => {
    const journal = store.terminalJournal(randomUUID(), { recover: false });
    const input = record();
    journal.prepare(input);
    assert.throws(() => journal.transition(input.instanceId, 'exited', { exitCode: 0 }));
    journal.transition(input.instanceId, 'starting');
    assert.throws(() => journal.transition(input.instanceId, 'exited'));
    assert.throws(() => journal.transition(input.instanceId, 'running', { exitCode: 0 }));
    journal.transition(input.instanceId, 'exited', { exitCode: 2, signal: 15 });
    assert.throws(() => journal.transition(input.instanceId, 'running'));
    assert.throws(() =>
      terminalAttemptSchema.parse({ ...journal.read(input.instanceId), pid: 123 }),
    );
    journal.release();
  }));

test('failed schema/recovery validation rolls back takeover and retains the old owner', () =>
  fixture((file, store) => {
    const journal = store.terminalJournal(randomUUID(), { recover: false });
    const input = record();
    journal.prepare(input);
    const raw = new DatabaseSync(file);
    try {
      raw.prepare('UPDATE terminal_schema SET version=3').run();
      assert.throws(() => store.terminalJournal(randomUUID(), { recover: true }), /schema/);
      journal.assertOwner();
      raw.prepare('UPDATE terminal_schema SET version=2').run();
      assert.throws(
        () =>
          raw
            .prepare("UPDATE terminal_attempts SET state='exited' WHERE instance_id=?")
            .run(input.instanceId),
        /CHECK/,
      );
      assert.equal(journal.read(input.instanceId)?.state, 'prepared');
      raw
        .prepare(
          "UPDATE terminal_attempts SET metadata=json_set(metadata,'$.unexpected','synthetic') WHERE instance_id=?",
        )
        .run(input.instanceId);
      assert.throws(() => store.terminalJournal(randomUUID(), { recover: true }));
      journal.assertOwner();
      raw
        .prepare(
          "UPDATE terminal_attempts SET metadata=json_remove(metadata,'$.unexpected') WHERE instance_id=?",
        )
        .run(input.instanceId);
      journal.release();
    } finally {
      raw.close();
    }
  }));

test('retention prunes only expired terminal facts; capacity never prunes lost ownership', () => {
  const raw = new DatabaseSync(':memory:');
  let now = 0;
  const transaction = <T>(action: () => T): T => {
    if (raw.isTransaction) return action();
    raw.exec('BEGIN IMMEDIATE');
    try {
      const result = action();
      raw.exec('COMMIT');
      return result;
    } catch (error) {
      raw.exec('ROLLBACK');
      throw error;
    }
  };
  try {
    const journal = openTerminalJournal(raw, transaction, randomUUID(), false, () => now);
    const expired = record('expired');
    const lost = record('lost');
    journal.prepare(expired);
    journal.transition(expired.instanceId, 'start_failed');
    journal.prepare(lost);
    journal.transition(lost.instanceId, 'starting');
    journal.transition(lost.instanceId, 'ownership_lost');
    now = TERMINAL_JOURNAL_LIMITS.retentionMs + 1;
    journal.prepare(record('new'));
    assert.equal(journal.read(expired.instanceId), undefined);
    assert.equal(journal.read(lost.instanceId)?.state, 'ownership_lost');
    const metadata = journal.read(lost.instanceId)!;
    transaction(() => {
      const insert = raw.prepare('INSERT INTO terminal_attempts VALUES (?,?,?,?,?,?)');
      for (let index = 2; index < TERMINAL_JOURNAL_LIMITS.attempts; index++) {
        const id = randomUUID();
        insert.run(
          id,
          metadata.epoch,
          'lost',
          'ownership_lost',
          0,
          JSON.stringify({ ...metadata, instanceId: id }),
        );
      }
    });
    assert.throws(() => journal.prepare(record()), /capacity/);
    assert.equal(
      Number(raw.prepare('SELECT COUNT(*) AS count FROM terminal_attempts').get()?.count),
      TERMINAL_JOURNAL_LIMITS.attempts,
    );
    journal.release();
  } finally {
    raw.close();
  }
});

test('v1 upgrade preserves historical metadata and owner fencing while v2 retains signal-only exits', () =>
  fixture((file, store) => {
    const first = store.terminalJournal(randomUUID(), { recover: false });
    const lost = record();
    first.prepare(lost);
    first.transition(lost.instanceId, 'starting');
    first.release();
    const raw = new DatabaseSync(file);
    try {
      const before = raw
        .prepare('SELECT metadata FROM terminal_attempts WHERE instance_id=?')
        .get(lost.instanceId)?.metadata;
      raw.prepare('UPDATE terminal_schema SET version=1').run();
      const current = store.terminalJournal(randomUUID(), { recover: false });
      assert.equal(raw.prepare('SELECT version FROM terminal_schema').get()?.version, 2);
      assert.equal(
        raw
          .prepare('SELECT metadata FROM terminal_attempts WHERE instance_id=?')
          .get(lost.instanceId)?.metadata,
        before,
      );
      raw.prepare('UPDATE terminal_schema SET version=1').run();
      assert.throws(() => store.terminalJournal(randomUUID(), { recover: false }), /owned/);
      assert.equal(raw.prepare('SELECT version FROM terminal_schema').get()?.version, 1);
      current.assertOwner();
      raw.prepare('UPDATE terminal_schema SET version=2').run();
      const exited = { ...record(), projectId: 'synthetic-other-project' };
      current.prepare(exited);
      current.transition(exited.instanceId, 'starting');
      assert.throws(() => current.transition(exited.instanceId, 'exited', { exitCode: null }));
      assert.throws(() =>
        current.transition(exited.instanceId, 'exited', { exitCode: null, signal: 0 }),
      );
      current.transition(exited.instanceId, 'exited', { exitCode: null, signal: 'SIGTERM' });
      current.release();
      const reopened = store.terminalJournal(randomUUID(), { recover: false });
      assert.deepEqual(reopened.read(exited.instanceId)?.exit, {
        exitCode: null,
        signal: 'SIGTERM',
      });
      assert.equal(reopened.read(lost.instanceId)?.state, 'ownership_lost');
      reopened.release();
    } finally {
      raw.close();
    }
  }));

test('durable admission preflight rejects before proof consumption or starting effects', () =>
  fixture((_file, store) => {
    const f = supervisor(store);
    const occupied = record();
    f.journal.prepare(occupied);
    f.journal.transition(occupied.instanceId, 'starting');
    const attempt = f.prepare();
    const proof = f.proof(attempt.challenge);
    assert.throws(() => f.instance.launch(attempt.attemptId, proof), /durable admission/);
    assert.equal(f.journal.read(attempt.attemptId)?.state, 'prepared');
    assert.equal(f.starts(), 0);
    f.journal.transition(occupied.instanceId, 'exited', { exitCode: 0 });
    // Same proof remains valid: the refusal had no dispatch or authority consumption.
    assert.doesNotThrow(() => f.instance.launch(attempt.attemptId, proof));
    assert.equal(f.starts(), 1);
    f.events().exit(0);
    f.instance.shutdown();
  }));
