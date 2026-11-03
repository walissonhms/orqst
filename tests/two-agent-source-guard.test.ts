// SYNTHETIC source metadata only; no provider or real session access.
import assert from 'node:assert/strict';
import {
  appendFileSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import {
  acceptanceSourceGuard,
  runSourceCheck,
  SourceGuardError,
} from '../scripts/terminal/two-agent-source-guard.js';

function reason(expected: string) {
  return (error: unknown) =>
    error instanceof SourceGuardError && error.diagnostic.reason === expected;
}

test('source guard rejects test rollouts in active or archived native sources without reading content', () => {
  const root = mkdtempSync(join(tmpdir(), 'orqst-synthetic-source-guard-'));
  try {
    writeFileSync(join(root, 'auth.json'), 'SYNTHETIC-SECRET', { mode: 0o000 });
    const verify = acceptanceSourceGuard([root, root]);
    verify(['synthetic-thread']);
    for (const source of ['sessions', 'archived_sessions']) {
      const directory = join(root, source, '2026');
      mkdirSync(directory, { recursive: true });
      const file = join(directory, 'rollout-synthetic-thread.jsonl');
      writeFileSync(file, 'SYNTHETIC-UNREADABLE-CONTENT', { mode: 0o000 });
      assert.throws(() => verify(['synthetic-thread']), reason('thread_materialized'));
      rmSync(file);
    }
    verify(['synthetic-thread']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('history change is inconclusive, symlinks fail, and diagnostics retain no private strings', () => {
  const root = mkdtempSync(join(tmpdir(), 'orqst-synthetic-secret-'));
  try {
    const history = join(root, 'history.jsonl');
    writeFileSync(history, 'SYNTHETIC-SECRET');
    const verify = acceptanceSourceGuard([root]);
    const child = spawnSync(process.execPath, [
      '-e',
      'require("node:fs").appendFileSync(process.argv[1], "x")',
      history,
    ]);
    assert.equal(child.status, 0);
    const records: object[] = [];
    assert.throws(
      () =>
        runSourceCheck(
          'pre-confirmation',
          () => verify(['synthetic-thread']),
          (record) => records.push(record),
        ),
      reason('history_changed'),
    );
    const record = records[0] as {
      diagnostic: { historyChanges: { mtime: boolean; ctime: boolean } };
    };
    assert.equal(typeof record.diagnostic.historyChanges.mtime, 'boolean');
    assert.equal(typeof record.diagnostic.historyChanges.ctime, 'boolean');
    assert.deepEqual(record, {
      phase: 'source-preservation',
      check: 'pre-confirmation',
      status: 'failed',
      diagnostic: {
        reason: 'history_changed',
        source: 'history',
        homeIndex: 0,
        entries: 0,
        entryLimit: 100000,
        depth: null,
        depthLimit: 8,
        historyChanges: {
          presence: false,
          inode: false,
          size: true,
          mtime: record.diagnostic.historyChanges.mtime,
          ctime: record.diagnostic.historyChanges.ctime,
        },
      },
    });
    assert.ok(!JSON.stringify(records).includes('SYNTHETIC'));
    const fresh = acceptanceSourceGuard([root]);
    symlinkSync(root, join(root, 'sessions'));
    assert.throws(() => fresh(['synthetic-thread']), reason('unsafe_directory'));
    rmSync(join(root, 'sessions'));
    mkdirSync(join(root, 'sessions'));
    symlinkSync(history, join(root, 'sessions', 'SYNTHETIC-SECRET'));
    assert.throws(() => fresh(['synthetic-thread']), reason('unsafe_entry'));
    appendFileSync(history, 'x');
    assert.throws(() => fresh(['synthetic-thread']), reason('history_changed'));
    const unknownRecords: object[] = [];
    assert.throws(
      () =>
        runSourceCheck(
          'cleanup',
          () => {
            throw new Error('SYNTHETIC-SECRET');
          },
          (record) => unknownRecords.push(record),
        ),
      reason('inspection_error'),
    );
    assert.ok(!JSON.stringify(unknownRecords).includes('SYNTHETIC'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('deduplicates directory aliases without increasing the global source entry budget', () => {
  const root = mkdtempSync(join(tmpdir(), 'orqst-synthetic-budget-'));
  try {
    const a = join(root, 'a');
    const b = join(root, 'b');
    for (const home of [a, b]) mkdirSync(join(home, 'sessions'), { recursive: true });
    const seed = join(root, 'synthetic');
    writeFileSync(seed, 'SYNTHETIC');
    for (let i = 0; i < 50001; i++) linkSync(seed, join(a, 'sessions', String(i)));
    acceptanceSourceGuard([a, `${a}/.`])(['synthetic-thread']);
    for (let i = 0; i < 49999; i++) linkSync(seed, join(b, 'sessions', String(i)));
    acceptanceSourceGuard([a, b])(['synthetic-thread']);
    mkdirSync(join(b, 'archived_sessions'));
    const extra = join(b, 'archived_sessions', 'extra');
    linkSync(seed, extra);
    assert.throws(
      () => acceptanceSourceGuard([a, b])(['synthetic-thread']),
      reason('budget_exceeded'),
    );
    rmSync(extra);
    renameSync(join(b, 'sessions'), join(a, 'archived_sessions'));
    acceptanceSourceGuard([a])(['synthetic-thread']);
    linkSync(seed, join(a, 'archived_sessions', 'extra'));
    assert.throws(
      () => acceptanceSourceGuard([a])(['synthetic-thread']),
      reason('budget_exceeded'),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('source guard rejects replaced homes, invalid inputs and excessive depth', () => {
  const root = mkdtempSync(join(tmpdir(), 'orqst-synthetic-source-depth-'));
  try {
    assert.throws(() => acceptanceSourceGuard([]), reason('invalid_input'));
    assert.throws(() => acceptanceSourceGuard([root, root, root]), reason('invalid_input'));
    const verify = acceptanceSourceGuard([root]);
    assert.throws(() => verify([]), reason('invalid_input'));
    assert.throws(() => verify(['../invalid']), reason('invalid_input'));
    mkdirSync(join(root, 'sessions', ...Array(9).fill('x')), { recursive: true });
    assert.throws(() => verify(['synthetic-thread']), reason('depth_exceeded'));
    rmSync(join(root, 'sessions'), { recursive: true });
    const home = join(root, 'home');
    mkdirSync(home);
    const verifyHome = acceptanceSourceGuard([home]);
    renameSync(home, join(root, 'previous-home'));
    mkdirSync(home);
    assert.throws(() => verifyHome(['synthetic-thread']), reason('home_changed'));
    rmSync(home, { recursive: true });
    symlinkSync(root, home);
    assert.throws(() => verifyHome(['synthetic-thread']), reason('unsafe_home'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('checks every physical home alias again and rejects unsafe baseline paths', () => {
  const root = mkdtempSync(join(tmpdir(), 'orqst-synthetic-source-alias-'));
  try {
    const home = join(root, 'home');
    mkdirSync(home);
    const link = join(root, 'alias');
    symlinkSync(root, link);
    const verify = acceptanceSourceGuard([home, join(link, 'home')]);
    verify(['synthetic-thread']);
    assert.throws(() => acceptanceSourceGuard([link]), reason('unsafe_home'));
    const other = join(root, 'other');
    mkdirSync(join(other, 'home'), { recursive: true });
    rmSync(link);
    symlinkSync(other, link);
    assert.throws(() => verify(['synthetic-thread']), reason('home_changed'));
    symlinkSync(join(root, 'absent'), join(home, 'history.jsonl'));
    assert.throws(() => acceptanceSourceGuard([home]), reason('unsafe_history'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
