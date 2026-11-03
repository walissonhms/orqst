// SYNTHETIC source metadata only; no provider or real session access.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { acceptanceSourceGuard } from '../scripts/terminal/two-agent-source-guard.js';

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
      assert.throws(() => verify(['synthetic-thread']), /materialized/);
      rmSync(file);
    }
    verify(['synthetic-thread']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('source guard treats concurrent history changes as inconclusive and never follows symlinks', () => {
  const root = mkdtempSync(join(tmpdir(), 'orqst-synthetic-source-guard-'));
  try {
    const verify = acceptanceSourceGuard([root]);
    writeFileSync(join(root, 'history.jsonl'), 'SYNTHETIC', { mode: 0o000 });
    assert.throws(() => verify(['synthetic-thread']), /inconclusive/);
    rmSync(join(root, 'history.jsonl'));
    symlinkSync(root, join(root, 'sessions'));
    assert.throws(() => verify(['synthetic-thread']), /Unsafe native source/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
