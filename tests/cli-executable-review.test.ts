import assert from 'node:assert/strict';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  cliPublisherIdentities,
  publishCliExecutableReview,
  readCliExecutableReview,
  reviewedVersionInstallRoot,
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
  assert.equal(signatureContinuity(baseline, update, signed), 'signature_continuity');
  assert.equal(
    signatureContinuity(baseline, update, { ...signed, teamId: 'AAAAAAAAAA' }),
    undefined,
  );
  assert.equal(
    signatureContinuity(baseline, update, { ...signed, identifier: 'other' }),
    undefined,
  );
  assert.equal(signatureContinuity(baseline, update, { ...signed, notarized: false }), undefined);
  assert.equal(signatureContinuity(baseline, update, undefined), undefined);
  assert.equal(
    signatureContinuity(baseline, { ...update, path: update.path + '.new' }, signed),
    undefined,
  );
  assert.equal(
    signatureContinuity({ ...baseline, signature: undefined }, update, signed),
    undefined,
  );
});

test('a reviewed launcher can switch version directories inside its trusted install root', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'orqst-synthetic-cli-versions-')));
  try {
    const installRoot = join(root, 'releases');
    const oldBin = join(installRoot, '0.162.1-aarch64-apple-darwin', 'bin');
    const newBin = join(installRoot, '0.169.0-aarch64-apple-darwin', 'bin');
    const path = join(newBin, 'codex');
    const previousPath = join(oldBin, 'codex');
    const launcher = join(root, 'codex');

    for (const bin of [oldBin, newBin]) mkdirSync(bin, { recursive: true, mode: 0o755 });
    writeFileSync(previousPath, Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 1]), { mode: 0o700 });
    writeFileSync(path, Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 2]), { mode: 0o700 });
    symlinkSync(previousPath, launcher);
    assert.equal(reviewedVersionInstallRoot(previousPath, launcher, baseline.version), installRoot);
    assert.equal(reviewedVersionInstallRoot(previousPath, launcher, '0.161.0'), undefined);
    const previous = {
      ...baseline,
      path: previousPath,
      sha256: terminalExecutableSha256(previousPath),
      launcher,
      installRoot,
    };
    publishCliExecutableReview(root, 'codex', undefined, previous);

    unlinkSync(launcher);
    symlinkSync(path, launcher);
    const candidate = { path, sha256: terminalExecutableSha256(path), launcher };
    const source = signatureContinuity(previous, candidate, signed);
    assert.equal(source, 'signature_continuity_version_dir');
    const next = {
      ...candidate,
      version: '0.169.0',
      source,
      signature: signed,
      installRoot,
      previousPath,
      previousSha256: previous.sha256,
    };
    publishCliExecutableReview(root, 'codex', readCliExecutableReview(root, 'codex'), next);
    assert.deepEqual(readCliExecutableReview(root, 'codex'), next);
    assert.equal(
      signatureContinuity(previous, candidate, { ...signed, teamId: 'AAAAAAAAAA' }),
      undefined,
    );
    assert.equal(
      signatureContinuity(previous, candidate, { ...signed, identifier: 'other' }),
      undefined,
    );
    assert.equal(
      signatureContinuity(previous, candidate, { ...signed, notarized: false }),
      undefined,
    );
    assert.equal(
      signatureContinuity({ ...previous, installRoot: undefined }, candidate, signed),
      undefined,
    );

    const alternate = join(root, 'alias');
    symlinkSync(path, alternate);
    assert.equal(
      signatureContinuity(previous, { ...candidate, launcher: alternate }, signed),
      undefined,
    );

    chmodSync(newBin, 0o775);
    assert.equal(signatureContinuity(previous, candidate, signed), undefined);
    chmodSync(newBin, 0o755);

    const outsideBin = join(root, 'releases-other', '0.170.0', 'bin');
    mkdirSync(outsideBin, { recursive: true });
    const outside = join(outsideBin, 'codex');
    writeFileSync(outside, 'synthetic');
    const escape = join(installRoot, '0.170.0');
    symlinkSync(join(outsideBin, '..'), escape);
    unlinkSync(launcher);
    symlinkSync(join(escape, 'bin/codex'), launcher);
    assert.equal(signatureContinuity(previous, { ...candidate, path: outside }, signed), undefined);
    assert.equal(
      signatureContinuity(previous, { ...candidate, path: join(escape, 'bin/codex') }, signed),
      undefined,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
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
