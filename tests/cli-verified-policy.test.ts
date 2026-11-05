import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { terminalDigest } from '../packages/core/src/terminal/authority.js';
import {
  TerminalCliPolicyStore,
  type TerminalCliEvidence,
  type TerminalCliReview,
} from '../packages/core/src/terminal/cli-authorization.js';
import type { TerminalProfile } from '../packages/core/src/terminal/supervisor.js';

test('verified policy stores evidence and asks again for changed bytes, scope and epoch', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'orqst-verified-policy-')));
  const path = join(root, 'synthetic');
  const bytes = Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 1, 2, 3, 4]);
  writeFileSync(path, bytes, { mode: 0o700 });
  const store = new TerminalCliPolicyStore(root);
  let profile: TerminalProfile = {
    id: 'test',
    projectId: 'test',
    executable: path,
    executableSha256: terminalDigest(bytes),
    executableVersion: '0.162.1',
    argv: [],
    cwd: root,
    environmentProfile: 'synthetic',
    permissions: 'synthetic',
    cliAuthorizationScope: 'scope-a',
  };
  const signature = { valid: true, teamId: '2DC432GLL2', identifier: 'codex' };
  let valid = true;
  const verifier = {
    async verify() {
      return { ...signature, valid };
    },
  };
  let probes = 0;
  const reviews: TerminalCliReview[] = [];
  const probe = async (): Promise<TerminalCliEvidence> => {
    probes++;
    return {
      provider: 'codex',
      mode: 'tui',
      version: '0.162.1',
      contractRevision: 'codex-tui-0.162.1',
      sha256: profile.executableSha256,
      signature,
    };
  };
  const review = async (details: TerminalCliReview) => {
    reviews.push(details);
    return true;
  };
  const authorize = (epoch?: string) =>
    store.authorizeVerifiedCli(profile, 'codex', 'tui', verifier, probe, review, epoch);
  try {
    assert.equal(await authorize(), 'allowed');
    const firstEpoch = await store.verifiedEpoch(profile, 'codex', 'tui', verifier);
    assert.ok(firstEpoch);
    assert.equal(await authorize(firstEpoch), 'allowed');
    assert.equal(probes, 1);
    assert.equal(reviews.length, 1);
    const file = join(root, 'cli-authorizations', `${terminalDigest(path)}.json`);
    const stored = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(stored.version, 2);
    assert.deepEqual(stored.signature, signature);
    assert.equal(await authorize('00000000-0000-4000-8000-000000000000'), 'allowed');
    assert.equal(reviews.length, 2);
    assert.equal(reviews[1]!.previous?.version, 2);
    assert.equal(reviews[1]!.expectedEpoch, '00000000-0000-4000-8000-000000000000');
    assert.notEqual(
      reviews[1]!.previous!.authorizationEpoch,
      reviews[1]!.candidate.authorizationEpoch,
    );
    profile = { ...profile, cliAuthorizationScope: 'scope-b' };
    assert.equal(await authorize(), 'allowed');
    assert.equal(reviews.length, 3);
    assert.equal(reviews[2]!.candidate.cliAuthorizationScope, 'scope-b');
    assert.equal(
      reviews[2]!.previous?.version === 2 && reviews[2]!.previous.cliAuthorizationScope,
      'scope-a',
    );
    const updated = Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 9, 8, 7, 6]);
    writeFileSync(path, updated);
    profile = { ...profile, executableSha256: terminalDigest(updated) };
    assert.equal(await authorize(), 'allowed');
    assert.equal(reviews.length, 4);
    assert.notEqual(reviews[3]!.previous!.executableSha256, reviews[3]!.candidate.sha256);
    valid = false;
    assert.equal(await store.verifiedEpoch(profile, 'codex', 'tui', verifier), undefined);
    assert.equal(await authorize(), 'revoked');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('cancel and binary change during review cannot create authorization', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'orqst-verified-cancel-')));
  const path = join(root, 'synthetic');
  const bytes = Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 5, 6, 7, 8]);
  writeFileSync(path, bytes, { mode: 0o700 });
  const store = new TerminalCliPolicyStore(root);
  const profile: TerminalProfile = {
    id: 'test',
    projectId: 'test',
    executable: path,
    executableSha256: terminalDigest(bytes),
    executableVersion: '0.162.1',
    argv: [],
    cwd: root,
    environmentProfile: 'synthetic',
    permissions: 'synthetic',
    cliAuthorizationScope: 'scope',
  };
  const signature = { valid: true, teamId: '2DC432GLL2', identifier: 'codex' };
  const verifier = {
    async verify() {
      return signature;
    },
  };
  const probe = async (): Promise<TerminalCliEvidence> => ({
    provider: 'codex',
    mode: 'tui',
    version: '0.162.1',
    contractRevision: 'codex-tui-0.162.1',
    sha256: profile.executableSha256,
    signature,
  });
  try {
    assert.equal(
      await store.authorizeVerifiedCli(profile, 'codex', 'tui', verifier, probe, async () => false),
      'blocked',
    );
    assert.equal(await store.verifiedEpoch(profile, 'codex', 'tui', verifier), undefined);
    assert.equal(
      await store.authorizeVerifiedCli(profile, 'codex', 'tui', verifier, probe, async () => {
        writeFileSync(path, Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0]));
        return true;
      }),
      'revoked',
    );
    assert.equal(await store.verifiedEpoch(profile, 'codex', 'tui', verifier), undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('legacy policy is readable but requires a fresh verified review', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'orqst-verified-legacy-')));
  const executable = join(root, 'synthetic');
  const bytes = Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 3, 1, 4, 1]);
  writeFileSync(executable, bytes, { mode: 0o700 });
  const store = new TerminalCliPolicyStore(root);
  const profile: TerminalProfile = {
    id: 'test',
    projectId: 'test',
    executable,
    executableSha256: terminalDigest(bytes),
    executableVersion: '0.162.1',
    argv: [],
    cwd: root,
    environmentProfile: 'synthetic',
    permissions: 'synthetic',
    cliAuthorizationScope: 'scope',
  };
  const signature = { valid: true, teamId: '2DC432GLL2', identifier: 'codex' };
  const verifier = {
    async verify() {
      return signature;
    },
  };
  const probe = async (): Promise<TerminalCliEvidence> => ({
    provider: 'codex',
    mode: 'tui',
    version: '0.162.1',
    contractRevision: 'codex-tui-0.162.1',
    sha256: profile.executableSha256,
    signature,
  });
  try {
    assert.equal(await store.authorizeCli(profile, async () => true), 'allowed');
    assert.equal(await store.verifiedEpoch(profile, 'codex', 'tui', verifier), undefined);
    let previousVersion: number | undefined;
    assert.equal(
      await store.authorizeVerifiedCli(profile, 'codex', 'tui', verifier, probe, async (review) => {
        previousVersion = review.previous?.version;
        return true;
      }),
      'allowed',
    );
    assert.equal(previousVersion, 1);
    assert.equal(await store.authorizeCli(profile, async () => true), 'blocked');
    assert.ok(await store.verifiedEpoch(profile, 'codex', 'tui', verifier));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('concurrent authorizations in one host share the first review', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'orqst-verified-concurrent-')));
  const executable = join(root, 'synthetic');
  const bytes = Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 1, 3, 3, 7]);
  writeFileSync(executable, bytes, { mode: 0o700 });
  const first = new TerminalCliPolicyStore(root);
  const second = new TerminalCliPolicyStore(root);
  const profile: TerminalProfile = {
    id: 'test',
    projectId: 'test',
    executable,
    executableSha256: terminalDigest(bytes),
    executableVersion: '0.162.1',
    argv: [],
    cwd: root,
    environmentProfile: 'synthetic',
    permissions: 'synthetic',
    cliAuthorizationScope: 'scope',
  };
  const signature = { valid: true, teamId: '2DC432GLL2', identifier: 'codex' };
  const verifier = {
    async verify() {
      return signature;
    },
  };
  let reviews = 0;
  const probe = async (): Promise<TerminalCliEvidence> => ({
    provider: 'codex',
    mode: 'tui',
    version: '0.162.1',
    contractRevision: 'codex-tui-0.162.1',
    sha256: profile.executableSha256,
    signature,
  });
  let release!: () => void;
  const pause = new Promise<void>((resolve) => {
    release = resolve;
  });
  const review = async () => {
    reviews++;
    await pause;
    return true;
  };
  try {
    const a = first.authorizeVerifiedCli(profile, 'codex', 'tui', verifier, probe, review);
    const b = second.authorizeVerifiedCli(profile, 'codex', 'tui', verifier, probe, review);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(reviews, 1);
    release();
    assert.deepEqual(await Promise.all([a, b]), ['allowed', 'allowed']);
    assert.equal(reviews, 1);
  } finally {
    release();
    rmSync(root, { recursive: true, force: true });
  }
});
