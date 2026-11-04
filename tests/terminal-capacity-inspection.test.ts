// Synthetic journals only. No provider, credential, private root or live owner is used.
import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { openTerminalJournal } from '../packages/database/src/terminal-journal.js';
import { inspectTerminalCapacity } from '../scripts/terminal/capacity.js';

const digest = (value: string) => value.repeat(64).slice(0, 64);

function journal(action: (file: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'orqst-synthetic-capacity-'));
  const file = join(root, 'terminal.sqlite');
  try {
    action(file);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function seeded(file: string, release: boolean): void {
  const db = new DatabaseSync(file);
  try {
    const epoch = '6f1a3d1c-6a1c-4f2e-9a51-6a1b3f6c6f42';
    const lost = openTerminalJournal(db, (run) => run(), epoch, false);
    lost.prepare({
      instanceId: '0d7f9d1e-6b1a-4b70-9d6f-9d5b1c5c3f10',
      clientId: 'synthetic-a',
      projectId: 'synthetic-project',
      manifestDigest: digest('a'),
    });
    lost.transition('0d7f9d1e-6b1a-4b70-9d6f-9d5b1c5c3f10', 'starting');
    lost.transition('0d7f9d1e-6b1a-4b70-9d6f-9d5b1c5c3f10', 'ownership_lost');
    lost.prepare({
      instanceId: '5c4b3a29-1f0e-4d3c-8b7a-6f5e4d3c2b1a',
      clientId: 'synthetic-b',
      projectId: 'other-project',
      manifestDigest: digest('b'),
    });
    lost.transition('5c4b3a29-1f0e-4d3c-8b7a-6f5e4d3c2b1a', 'starting');
    lost.transition('5c4b3a29-1f0e-4d3c-8b7a-6f5e4d3c2b1a', 'exited', { exitCode: 0 });
    if (release) lost.release();
  } finally {
    db.close();
  }
}

test('capacity inspection reports quarantine reservations without releasing them', () => {
  journal((file) => {
    seeded(file, true);
    const before = readFileSync(file);
    const report = inspectTerminalCapacity(file, () => Date.now());
    assert.equal(report.schemaVersion, 2);
    assert.equal(report.ownerClaimed, false);
    assert.deepEqual(report.counts, { ownership_lost: 1, exited: 1 });
    assert.equal(report.reservations.length, 1);
    const reservation = report.reservations[0]!;
    assert.equal(reservation.state, 'ownership_lost');
    assert.equal(reservation.projectId, 'synthetic-project');
    assert.equal(reservation.exitRecorded, false);
    assert.ok(reservation.ageMs >= 0);
    assert.equal(report.capacity.active, 1);
    assert.equal(report.capacity.remainingGlobal, report.capacity.activeInstances - 1);
    assert.deepEqual(report.capacity.projects, [
      { projectId: 'synthetic-project', active: 1, remaining: 0 },
    ]);
    // Inspection is read-only: the journal bytes are unchanged.
    assert.deepEqual(readFileSync(file), before);
  });
});

test('a retained owner epoch is reported as a restart fence', () => {
  journal((file) => {
    seeded(file, false);
    const report = inspectTerminalCapacity(file);
    assert.equal(report.ownerClaimed, true);
    assert.equal(report.reservations[0]!.state, 'ownership_lost');
  });
});

test('inspection refuses missing, linked, relative and writable journal paths', () => {
  journal((file) => {
    seeded(file, true);
    assert.throws(() => inspectTerminalCapacity('relative/terminal.sqlite'), /absolute/);
    const missing = join(file, '..', 'absent.sqlite');
    assert.throws(() => inspectTerminalCapacity(missing));
    const link = `${file}.link`;
    symlinkSync(file, link);
    assert.throws(() => inspectTerminalCapacity(link), /non-symlink/);
    chmodSync(file, 0o666);
    assert.throws(() => inspectTerminalCapacity(file), /writable by another user/);
  });
});

test('an unsupported or foreign schema fails closed', () => {
  journal((file) => {
    const db = new DatabaseSync(file);
    db.exec(
      'CREATE TABLE terminal_schema (singleton INTEGER PRIMARY KEY CHECK(singleton=1), version INTEGER NOT NULL); INSERT INTO terminal_schema VALUES (1,3);',
    );
    db.close();
    assert.throws(() => inspectTerminalCapacity(file), /Unsupported terminal journal schema/);
  });
  journal((file) => {
    writeFileSync(file, 'not a journal');
    assert.throws(() => inspectTerminalCapacity(file));
  });
});

test('a version-1 journal stays readable without upgrading it', () => {
  journal((file) => {
    seeded(file, true);
    const db = new DatabaseSync(file);
    db.exec('UPDATE terminal_schema SET version=1 WHERE singleton=1');
    db.close();
    const before = readFileSync(file);
    const report = inspectTerminalCapacity(file);
    assert.equal(report.schemaVersion, 1);
    assert.equal(report.reservations.length, 1);
    assert.deepEqual(readFileSync(file), before);
  });
});

test('inspection leaves no WAL or shared-memory sidecar behind', () => {
  journal((file) => {
    seeded(file, true);
    inspectTerminalCapacity(file);
    assert.equal(existsSync(`${file}-shm`), false);
    assert.equal(existsSync(`${file}-wal`), false);
  });
});

test('pending WAL frames fail closed instead of reporting a stale snapshot', () => {
  journal((file) => {
    seeded(file, true);
    writeFileSync(`${file}-wal`, Buffer.from([1, 2, 3, 4]));
    assert.throws(() => inspectTerminalCapacity(file), /pending WAL frames/);
  });
});
