// In-memory synthetic journal and backend only. No files, processes, Core or PTY.
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';
import type { TerminalJournal } from '@orqst/protocol';
import {
  TerminalAuthority,
  terminalChallengeBytes,
  terminalDigest,
} from '../packages/core/src/terminal/authority.js';
import {
  TerminalSupervisor,
  terminalPolicy,
  type TerminalStartBinding,
} from '../packages/core/src/terminal/supervisor.js';

function fixture(binding?: TerminalStartBinding) {
  const keys = generateKeyPairSync('ed25519');
  const authority = new TerminalAuthority(new Map([['synthetic-native', keys.publicKey]]));
  const journalDigests: string[] = [];
  const backendDigests: string[] = [];
  const journal: TerminalJournal = {
    epoch: authority.epoch,
    assertOwner() {},
    withOwner: (effect) => effect(),
    prepare: (record) => {
      journalDigests.push(record.manifestDigest);
    },
    preflightStart() {},
    transition() {},
    read: () => undefined,
    release() {},
  };
  let valid = true;
  const profile = {
    id: 'synthetic-profile',
    projectId: 'synthetic-project',
    executable: '/synthetic/never-executed',
    executableSha256: terminalDigest('synthetic'),
    executableVersion: 'synthetic',
    argv: ['--model', 'synthetic-model'],
    cwd: '/synthetic',
    environmentProfile: 'synthetic',
    permissions: 'synthetic',
  };
  const supervisor = new TerminalSupervisor(
    authority,
    {
      validate: () => valid,
      start: (_profile, events, identity) => {
        assert.ok(identity);
        backendDigests.push(identity.manifestDigest);
        events.started();
        events.exit(0);
        return { write() {}, resize() {}, signal() {}, dispose() {} };
      },
    },
    [profile],
    journal,
    binding,
  );
  const prepare = () => supervisor.prepare('synthetic-native', profile.id);
  const launch = (prepared: ReturnType<typeof prepare>) =>
    supervisor.launch(prepared.attemptId, {
      challengeId: prepared.challenge.challengeId,
      signature: sign(null, terminalChallengeBytes(prepared.challenge), keys.privateKey).toString(
        'base64url',
      ),
    });
  return {
    supervisor,
    prepare,
    launch,
    journalDigests,
    backendDigests,
    invalidate: () => {
      valid = false;
    },
  };
}

test('legacy Start digest bytes are unchanged and propagate challenge → journal → backend identity', () => {
  const f = fixture();
  try {
    const prepared = f.prepare();
    const legacy = terminalDigest(JSON.stringify([prepared.profile, terminalPolicy]));
    assert.equal(prepared.challenge.digest, legacy);
    assert.deepEqual(f.journalDigests, [legacy]);
    f.launch(prepared);
    assert.deepEqual(f.backendDigests, [legacy]);
  } finally {
    f.supervisor.shutdown();
  }
});

test('Core enrollment digest and revision independently change the complete Start evidence chain', () => {
  const digests: string[] = [];
  for (const binding of [
    { version: 1 as const, bindingDigest: 'a'.repeat(64), admissionRevision: 1 },
    { version: 1 as const, bindingDigest: 'a'.repeat(64), admissionRevision: 2 },
    { version: 1 as const, bindingDigest: 'b'.repeat(64), admissionRevision: 1 },
  ]) {
    const f = fixture(binding);
    try {
      const prepared = f.prepare();
      const expected = terminalDigest(
        JSON.stringify(['orqst.terminal-start', 1, prepared.profile, terminalPolicy, binding]),
      );
      assert.equal(prepared.challenge.digest, expected);
      assert.notEqual(expected, terminalDigest(JSON.stringify([prepared.profile, terminalPolicy])));
      assert.deepEqual(f.journalDigests, [expected]);
      f.launch(prepared);
      assert.deepEqual(f.backendDigests, [expected]);
      digests.push(expected);
    } finally {
      f.supervisor.shutdown();
    }
  }
  assert.equal(new Set(digests).size, 3);
});

test('external binding mutation cannot rewrite grants; binding never replaces launch validation', () => {
  const binding: TerminalStartBinding = {
    version: 1,
    bindingDigest: 'c'.repeat(64),
    admissionRevision: 1,
  };
  const frozen = { ...binding };
  const f = fixture(binding);
  try {
    binding.bindingDigest = 'd'.repeat(64);
    binding.admissionRevision = 999;
    const prepared = f.prepare();
    assert.equal(
      prepared.challenge.digest,
      terminalDigest(
        JSON.stringify(['orqst.terminal-start', 1, prepared.profile, terminalPolicy, frozen]),
      ),
    );
    f.invalidate();
    f.launch(prepared);
    assert.equal(f.supervisor.snapshot(prepared.attemptId).state, 'start_failed');
    assert.deepEqual(f.backendDigests, []);
  } finally {
    f.supervisor.shutdown();
  }
});

test('invalid enrollment Start bindings fail closed before journal preparation or backend effect', () => {
  for (const invalid of [
    null,
    { version: 2, bindingDigest: 'a'.repeat(64), admissionRevision: 1 },
    { version: 1, bindingDigest: 'A'.repeat(64), admissionRevision: 1 },
    { version: 1, bindingDigest: 'a'.repeat(63), admissionRevision: 1 },
    ...[0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1].map((admissionRevision) => ({
      version: 1,
      bindingDigest: 'a'.repeat(64),
      admissionRevision,
    })),
  ])
    assert.throws(
      () => fixture(invalid as TerminalStartBinding),
      /Invalid terminal enrollment start binding/,
    );
});
