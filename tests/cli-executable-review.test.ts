import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  cliPublisherIdentities,
  publishCliExecutableReview,
  readCliExecutableReview,
  signatureContinuity,
  type CliExecutableReview,
} from '../packages/core/src/terminal/cli-executable-review.js';
import { terminalExecutableSha256 } from '../packages/core/src/terminal/codex-profile.js';
import { inspectCliCandidate } from '../apps/desktop/src/terminal-discovery.js';

const signed = { ...cliPublisherIdentities.codex, notarized: true };
const baseline: CliExecutableReview = {
  path: '/private/synthetic/codex',
  sha256: 'a'.repeat(64),
  version: '0.162.1',
  source: 'packaged_pin',
  signature: signed,
};
const update = { path: baseline.path, sha256: 'b'.repeat(64) };

test('signature continuity requires the same canonical path, Developer ID and ticket', () => {
  assert.equal(signatureContinuity(baseline, update, signed), true);
  assert.equal(signatureContinuity(baseline, update, { ...signed, teamId: 'AAAAAAAAAA' }), false);
  assert.equal(signatureContinuity(baseline, update, { ...signed, identifier: 'other' }), false);
  assert.equal(signatureContinuity(baseline, update, { ...signed, notarized: false }), false);
  assert.equal(signatureContinuity(baseline, update, undefined), false);
  assert.equal(
    signatureContinuity(baseline, { ...update, path: update.path + '.new' }, signed),
    false,
  );
  assert.equal(signatureContinuity({ ...baseline, signature: undefined }, update, signed), false);
});

test('manual evidence pins an unsigned native executable and fails closed for changed bytes and paths', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'orqst-synthetic-cli-review-')));
  try {
    const path = join(root, 'codex');
    const changedPath = join(root, 'different-codex');
    const initial = Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 1]);
    writeFileSync(path, initial, { mode: 0o700 });
    const review: CliExecutableReview = {
      path,
      sha256: terminalExecutableSha256(path),
      version: '0.170.0',
      source: 'native_review',
    };
    assert.equal(inspectCliCandidate('codex', path, root).decision, 'review');
    publishCliExecutableReview(root, 'codex', undefined, review);
    assert.deepEqual(readCliExecutableReview(root, 'codex'), review);
    assert.equal(inspectCliCandidate('codex', path, root).decision, 'exact');
    assert.throws(
      () => publishCliExecutableReview(root, 'codex', undefined, review),
      /review changed/,
    );
    symlinkSync(path, join(root, 'aliased'));
    assert.throws(() => inspectCliCandidate('codex', join(root, 'aliased'), root), /Noncanonical/);
    writeFileSync(changedPath, initial, { mode: 0o700 });
    assert.equal(inspectCliCandidate('codex', changedPath, root).decision, 'review');
    writeFileSync(path, Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 2]));
    assert.equal(inspectCliCandidate('codex', path, root).decision, 'review');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
