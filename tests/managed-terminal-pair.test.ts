// Synthetic owned handles and disposable journals. No provider or real authentication.
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Store } from '@orqst/database';
import {
  TerminalAuthority,
  terminalChallengeBytes,
  terminalDigest,
  type TerminalChallenge,
} from '../packages/core/src/terminal/authority.js';
import { desktopAgentsAdmission } from '../packages/core/src/managed-codex/desktop-admission.js';
import { ManagedTerminalPair } from '../packages/core/src/terminal/managed-pair.js';
import type { TerminalEvents } from '../packages/core/src/terminal/supervisor.js';

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'orqst-synthetic-pair-')));
  const keys = generateKeyPairSync('ed25519');
  const authority = new TerminalAuthority(new Map([['desktop-managed', keys.publicKey]]));
  const events: TerminalEvents[] = [];
  const writes: string[][] = [[], []];
  const stores: Store[] = [];
  const directory = join(root, 'admission');
  const pair = new ManagedTerminalPair(
    authority,
    [0, 1].map((slot) => {
      const state = join(root, `slot-${slot}`);
      mkdirSync(state, { mode: 0o700 });
      const store = new Store(join(state, 'terminal.sqlite'));
      stores.push(store);
      return {
        journal: store.terminalJournal(authority.epoch, { recover: false }),
        profiles: [
          {
            id: 'codex-terminal-v1',
            projectId: 'same-synthetic-workspace',
            executable: '/synthetic/never-executed',
            executableSha256: terminalDigest('synthetic'),
            executableVersion: 'synthetic',
            argv: [],
            cwd: '/synthetic',
            environmentProfile: 'synthetic',
            permissions: 'synthetic only',
          },
        ],
        backend: {
          validate: () => true,
          start: (_profile, handlers: TerminalEvents) => {
            events[slot] = handlers;
            handlers.started();
            return {
              write: (text: string) => writes[slot]!.push(text),
              resize() {},
              signal() {},
              dispose() {},
            };
          },
        },
      };
    }),
    desktopAgentsAdmission(directory),
  );
  const call = (slot: number, operation: string, args: unknown[]) =>
    pair.dispatch(slot, { id: randomUUID(), operation, args });
  const proof = (challenge: TerminalChallenge) => ({
    challengeId: challenge.challengeId,
    signature: sign(null, terminalChallengeBytes(challenge), keys.privateKey).toString('base64url'),
  });
  const prepare = (slot: number) =>
    call(slot, 'prepare', ['desktop-managed', 'codex-terminal-v1']) as {
      attemptId: string;
      challenge: TerminalChallenge;
    };
  const launch = (slot: number) => {
    const p = prepare(slot);
    call(slot, 'launch', [p.attemptId, proof(p.challenge)]);
    return p.attemptId;
  };
  return {
    pair,
    root,
    directory,
    events,
    writes,
    call,
    proof,
    prepare,
    launch,
    close() {
      pair.close();
      for (const store of stores) store.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

test('pair runs two independent synthetic terminals in the same workspace, fences and archives only after exits', () => {
  const f = fixture();
  try {
    assert.equal(existsSync(join(f.directory, 'active-pair.json')), false);
    const a = f.launch(0),
      b = f.launch(1);
    assert.notEqual(a, b);
    assert.throws(() => f.call(0, 'snapshot', [b]), /Unknown terminal/);
    assert.throws(() => f.call(2, 'snapshot', [a]), /slot/);
    const third = f.prepare(0);
    assert.throws(() => f.call(0, 'launch', [third.attemptId, f.proof(third.challenge)]), /limit/);
    assert.throws(() => desktopAgentsAdmission(f.directory), /reconciliation/);
    assert.throws(() => f.pair.prepareRetire(), /owned exit/);
    f.events[0]!.exit(0);
    assert.throws(() => f.pair.prepareRetire(), /owned exit/);
    f.events[1]!.exit(0);
    // An admission refusal is proof that the third prepared attempt was never dispatched.
    const retirement = f.pair.prepareRetire();
    f.pair.retire(f.proof(retirement.challenge));
    assert.doesNotThrow(() => desktopAgentsAdmission(f.directory));
  } finally {
    f.close();
  }
});

test('signed pair retirement preserves metadata and fences every old start before freeing capacity', () => {
  const f = fixture();
  try {
    f.launch(0);
    f.launch(1);
    f.events[0]!.exit(0);
    f.events[1]!.exit(0);
    const retirement = f.pair.prepareRetire();
    assert.throws(() => f.pair.retire({}), /proof/);
    f.pair.retire(f.proof(retirement.challenge));
    assert.equal(existsSync(join(f.directory, 'active-pair.json')), false);
    assert.equal(readdirSync(f.directory).filter((name) => name.startsWith('retired-')).length, 1);
    assert.throws(() => f.prepare(0), /fenced/);
    assert.doesNotThrow(() => desktopAgentsAdmission(f.directory));
  } finally {
    f.close();
  }
});

test('late exit and closing one document never recover lost ownership or release pair capacity', () => {
  const f = fixture();
  try {
    const a = f.launch(0);
    f.launch(1);
    f.pair.closeSlot(0);
    f.events[0]!.exit(0);
    assert.equal((f.call(0, 'snapshot', [a]) as { state: string }).state, 'ownership_lost');
    f.events[1]!.exit(0);
    assert.throws(() => f.pair.prepareRetire(), /Terminal journal ownership unavailable/);
    assert.throws(() => desktopAgentsAdmission(f.directory), /reconciliation/);
    assert.deepEqual(f.writes, [[], []]);
  } finally {
    f.close();
  }
});

test('closed slot journals cannot retire the shared marker even when their old exits were confirmed', () => {
  const f = fixture();
  try {
    f.launch(0);
    f.launch(1);
    f.events[0]!.exit(0);
    f.pair.closeSlot(0);
    f.events[1]!.exit(0);
    assert.throws(() => f.pair.prepareRetire(), /owner/i);
    assert.throws(() => desktopAgentsAdmission(f.directory), /reconciliation/);
  } finally {
    f.close();
  }
});
