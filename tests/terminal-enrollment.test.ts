// Synthetic handles only: no Core child, provider, PTY, authentication or process signal.
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Store } from '@orqst/database';
import type { TerminalEnrollmentInput } from '@orqst/protocol';
import {
  TerminalAuthority,
  terminalChallengeBytes,
  terminalDigest,
  type TerminalChallenge,
} from '../packages/core/src/terminal/authority.js';
import { desktopAgentsAdmission } from '../packages/core/src/managed-codex/desktop-admission.js';
import {
  ManagedTerminalPair,
  type TerminalPairAdmission,
} from '../packages/core/src/terminal/managed-pair.js';
import type { TerminalEvents } from '../packages/core/src/terminal/supervisor.js';

function fixture(capacity = 3, wrap = (value: TerminalPairAdmission) => value) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'orqst-synthetic-enrollment-')));
  const keys = generateKeyPairSync('ed25519');
  let now = Date.now();
  const authority = new TerminalAuthority(
    new Map([['desktop-managed', keys.publicKey]]),
    () => now,
  );
  const directory = join(root, 'admission');
  const admission = desktopAgentsAdmission(directory, ['/synthetic/original.json']);
  const stores: Store[] = [];
  const events: TerminalEvents[] = [];
  const writes: string[][] = [[], [], []];
  let starts = 0;
  let signals = 0;
  let creates = 0;
  const makeSlot = (slot: number, provider: 'codex' | 'claude' = 'codex') => {
    creates++;
    const store = new Store(join(root, `slot-${slot}.sqlite`));
    stores.push(store);
    return {
      profiles: [
        {
          id: `${provider}-terminal-v1`,
          projectId: 'synthetic-workspace',
          executable: '/synthetic/never-executed',
          executableSha256: terminalDigest('synthetic'),
          executableVersion: 'synthetic',
          argv: ['--model', `synthetic-${provider}`],
          cwd: '/synthetic',
          environmentProfile: 'synthetic',
          permissions: 'synthetic',
        },
      ],
      journal: store.terminalJournal(authority.epoch, { recover: false }),
      backend: {
        validate: () => true,
        start: (_profile: unknown, handlers: TerminalEvents) => {
          starts++;
          events[slot] = handlers;
          handlers.started();
          return {
            write: (text: string) => writes[slot]!.push(text),
            resize() {},
            signal() {
              signals++;
            },
            dispose() {},
          };
        },
      },
    };
  };
  const pair = new ManagedTerminalPair(authority, [makeSlot(0)], wrap(admission), capacity);
  const proof = (challenge: TerminalChallenge) => ({
    challengeId: challenge.challengeId,
    signature: sign(null, terminalChallengeBytes(challenge), keys.privateKey).toString('base64url'),
  });
  const call = (slot: number, operation: string, ...args: unknown[]) =>
    pair.dispatch(slot, { id: randomUUID(), operation, args });
  const launch = (slot: number, provider = 'codex') => {
    const prepared = call(slot, 'prepare', 'desktop-managed', `${provider}-terminal-v1`) as {
      attemptId: string;
      challenge: TerminalChallenge;
    };
    call(slot, 'launch', prepared.attemptId, proof(prepared.challenge));
    return prepared.attemptId;
  };
  const input = (expectedRevision = 0): TerminalEnrollmentInput => ({
    version: 1,
    epoch: authority.epoch,
    opId: randomUUID(),
    expectedRevision,
    workspaceId: terminalDigest('synthetic-workspace'),
    featureId: randomUUID(),
  });
  const candidate = (request: TerminalEnrollmentInput, slot = 1) => ({
    member: {
      terminalId: randomUUID(),
      provider: 'claude' as const,
      requestedModel: 'synthetic-claude',
      workspaceId: request.workspaceId,
      featureId: request.featureId,
      bindingDigest: terminalDigest(`synthetic-binding-${slot}`),
    },
    create: () => makeSlot(slot, 'claude'),
  });
  return {
    root,
    directory,
    pair,
    call,
    proof,
    launch,
    input,
    candidate,
    events,
    writes,
    counts: () => ({ starts, signals, creates }),
    advance: (milliseconds: number) => {
      now += milliseconds;
    },
    close() {
      pair.close();
      for (const store of stores) store.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

test('append keeps the same Pair, old instance, scrollback and input lease; ready admits without launching', () => {
  const f = fixture();
  try {
    const originalPair = f.pair;
    const attempt = f.launch(0);
    const attach = f.call(0, 'requestAttach', 'desktop-managed', attempt) as TerminalChallenge;
    const attachment = f.call(0, 'attach', attempt, f.proof(attach));
    const keyboard = f.call(0, 'requestInput', attempt, attachment) as TerminalChallenge;
    const lease = f.call(0, 'enableInput', attempt, attachment, f.proof(keyboard));
    f.events[0]!.data('before');
    f.call(0, 'write', attempt, attachment, lease, 0, 'one');
    const request = f.input();
    const receipt = f.pair.enroll(request, '/synthetic/new.json', () => f.candidate(request));
    assert.equal(receipt.status, 'ready');
    assert.equal(receipt.member?.slot, 1);
    assert.equal(receipt.member?.requestedModel, 'synthetic-claude');
    assert.equal(receipt.revision, 1);
    assert.equal(f.pair, originalPair);
    assert.deepEqual(f.counts(), { starts: 1, signals: 0, creates: 2 });
    assert.equal((f.call(0, 'snapshot', attempt) as { instanceId: string }).instanceId, attempt);
    f.events[0]!.data('-after');
    const output = f.call(0, 'read', attempt, attachment, 0) as { bytes: number[] };
    assert.equal(Buffer.from(output.bytes).toString(), 'before-after');
    f.call(0, 'write', attempt, attachment, lease, 1, 'two');
    assert.deepEqual(f.writes[0], ['one', 'two']);
    assert.throws(() => f.call(1, 'snapshot', attempt), /Unknown terminal/);
    const second = f.launch(1, 'claude');
    assert.notEqual(second, attempt);
    assert.equal(f.counts().starts, 2);
    const another = f.input(1);
    assert.equal(
      f.pair.enroll(another, '/synthetic/third.json', () => f.candidate(another, 2)).status,
      'ready',
    );
    // Enrollment never renews the original keyboard lease.
    f.advance(120_001);
    assert.throws(
      () => f.call(0, 'write', attempt, attachment, lease, 2, 'expired'),
      /authorization/,
    );
    assert.equal(f.counts().signals, 0);
    f.events[0]!.exit(0);
    f.events[1]!.exit(0);
    const retire = f.pair.prepareRetire();
    f.pair.retire(f.proof(retire.challenge));
    const archive = readdirSync(f.directory).find((name) => name.startsWith('retired-'))!;
    const persisted = JSON.parse(readFileSync(join(f.directory, archive), 'utf8'));
    assert.equal(persisted.enrollments.length, 4); // Two reservations and two ready receipts.
    assert.equal(persisted.admission.manifests[0], '/synthetic/original.json');
  } finally {
    f.close();
  }
});

test('opId replay returns one frozen receipt, inspect is read-only, and rebinding is denied', () => {
  const f = fixture();
  try {
    const request = f.input();
    const receipt = f.pair.enroll(request, '/synthetic/new.json', () => f.candidate(request));
    const never = () => {
      throw new Error('must not inspect or create on replay');
    };
    for (let repeat = 0; repeat < 3; repeat++) {
      assert.deepEqual(f.pair.enroll(request, '/synthetic/new.json', never), receipt);
      assert.deepEqual(f.pair.enrollmentInspect(request.opId).receipt, receipt);
    }
    receipt.member!.terminalId = randomUUID();
    assert.notEqual(
      f.pair.enrollmentInspect(request.opId).receipt?.member?.terminalId,
      receipt.member!.terminalId,
    );
    for (const change of [
      { workspaceId: terminalDigest('other') },
      { featureId: randomUUID() },
      { expectedRevision: 1 },
    ])
      assert.throws(
        () => f.pair.enroll({ ...request, ...change }, '/synthetic/new.json', never),
        /rebound/,
      );
    assert.throws(() => f.pair.enroll(request, '/synthetic/rebound.json', never), /rebound/);
    assert.throws(
      () => f.pair.enroll({ ...request, epoch: randomUUID() }, '/synthetic/new.json', never),
      /epoch/,
    );
    assert.equal(f.counts().creates, 2);
    assert.equal(
      readdirSync(f.directory).filter((name) => name.startsWith('enrollment-')).length,
      2,
    );
  } finally {
    f.close();
  }
});

test('CAS, capacity and validation refuse before effects without advancing revision', () => {
  const f = fixture(2);
  try {
    const stale = f.input(9);
    assert.equal(
      f.pair.enroll(stale, '/synthetic/stale.json', () => {
        throw new Error('not reached');
      }).reason,
      'revision_conflict',
    );
    assert.equal(f.pair.enrollmentInspect().revision, 0);
    const invalid = f.input();
    assert.equal(
      f.pair.enroll(invalid, '/synthetic/invalid.json', () => {
        throw new Error('invalid profile');
      }).status,
      'rejected',
    );
    assert.equal(existsSync(join(f.directory, 'active-pair.json')), false);
    const request = f.input();
    f.pair.enroll(request, '/synthetic/new.json', () => f.candidate(request));
    const overflow = f.input(1);
    assert.equal(
      f.pair.enroll(overflow, '/synthetic/full.json', () => {
        throw new Error('not reached');
      }).reason,
      'capacity',
    );
    assert.equal(f.pair.enrollmentInspect().revision, 1);
    assert.equal(f.counts().creates, 2);
  } finally {
    f.close();
  }
});

for (const failure of ['reservation', 'journal', 'receipt'] as const)
  test(`${failure} failure retains UUID, reservation and evidence; previous slot remains usable`, () => {
    const f = fixture(3, (admission) => ({
      ...admission,
      reserveEnrollment(record) {
        const finish = admission.reserveEnrollment!(record);
        if (failure === 'reservation') throw new Error('synthetic failure after reservation fsync');
        return (receipt) => {
          if (failure === 'receipt') {
            const reservation = readdirSync(f.directory).find((name) =>
              name.endsWith(`${record.input.opId}.json`),
            )!;
            writeFileSync(
              join(f.directory, reservation.replace(/\.json$/, '.receipt.json')),
              'partial',
              { mode: 0o600 },
            );
            // Production exclusive receipt creation must refuse this preserved partial file.
          }
          finish(receipt);
        };
      },
    }));
    try {
      const original = f.launch(0);
      const request = f.input();
      const candidate = f.candidate(request);
      const receipt = f.pair.enroll(request, '/synthetic/uncertain.json', () => ({
        ...candidate,
        create() {
          if (failure === 'journal') {
            writeFileSync(join(f.root, 'synthetic-partial-journal'), 'partial', { mode: 0o600 });
            throw new Error('synthetic journal initialization failure');
          }
          return candidate.create();
        },
      }));
      assert.equal(receipt.status, 'uncertain');
      assert.equal(receipt.member?.terminalId, candidate.member.terminalId);
      assert.equal(receipt.member?.slot, 1);
      assert.equal(f.pair.enrollmentInspect().reservedSlots, 2);
      assert.equal(f.pair.enrollmentInspect().revision, 1);
      const before = readdirSync(f.directory);
      assert.deepEqual(
        f.pair.enroll(request, '/synthetic/uncertain.json', () => {
          throw new Error('never retry');
        }),
        receipt,
      );
      assert.deepEqual(f.pair.enrollmentInspect(request.opId).receipt, receipt);
      assert.deepEqual(readdirSync(f.directory), before);
      assert.throws(() => desktopAgentsAdmission(f.directory), /reconciliation/);
      assert.throws(() => f.pair.prepareRetire(), /Uncertain enrollment/);
      assert.throws(
        () => f.call(1, 'prepare', 'desktop-managed', 'claude-terminal-v1'),
        /slot|uncertain/,
      );
      assert.equal((f.call(0, 'snapshot', original) as { state: string }).state, 'running');
      const attachment = f.call(
        0,
        'requestAttach',
        'desktop-managed',
        original,
      ) as TerminalChallenge;
      assert.ok(attachment.challengeId);
      const next = f.input(1);
      assert.equal(
        f.pair.enroll(next, '/synthetic/blocked.json', () => {
          throw new Error('not reached');
        }).reason,
        'effect_uncertain',
      );
      assert.equal(f.counts().signals, 0);
    } finally {
      f.close();
    }
  });

test('enrollment operation budget never evicts an old receipt', () => {
  const f = fixture();
  try {
    const request = f.input();
    const receipt = f.pair.enroll(request, '/synthetic/once.json', () => f.candidate(request));
    for (let i = 1; i < 128; i++) {
      const stale = f.input();
      assert.equal(
        f.pair.enroll(stale, '/synthetic/stale.json', () => {
          throw new Error('not reached');
        }).status,
        'rejected',
      );
    }
    assert.throws(
      () =>
        f.pair.enroll(f.input(1), '/synthetic/over-budget.json', () => {
          throw new Error('not reached');
        }),
      /budget/,
    );
    assert.deepEqual(
      f.pair.enroll(request, '/synthetic/once.json', () => {
        throw new Error('not reached');
      }),
      receipt,
    );
    assert.deepEqual(f.pair.enrollmentInspect(request.opId).receipt, receipt);
  } finally {
    f.close();
  }
});

test('eight admitted slots retain every long-path reservation in the bounded retirement archive', () => {
  const f = fixture(8);
  try {
    for (let slot = 1; slot < 8; slot++) {
      const request = f.input(slot - 1);
      const receipt = f.pair.enroll(request, `/synthetic/${'x'.repeat(1900)}/${slot}.json`, () =>
        f.candidate(request, slot),
      );
      assert.equal(receipt.status, 'ready');
    }
    const review = f.pair.prepareRetire();
    f.pair.retire(f.proof(review.challenge));
    const archive = readdirSync(f.directory).find((name) => name.startsWith('retired-'))!;
    const bytes = readFileSync(join(f.directory, archive));
    assert.ok(bytes.byteLength > 16 * 1024);
    assert.ok(bytes.byteLength <= 1024 * 1024);
    assert.equal(JSON.parse(bytes.toString()).enrollments.length, 14);
    assert.equal(existsSync(join(f.directory, 'active-pair.json')), false);
    assert.equal(f.counts().starts, 0);
  } finally {
    f.close();
  }
});

test('oversized retirement evidence fails before archive write and retains the admission marker', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'orqst-synthetic-archive-budget-')));
  try {
    const admission = desktopAgentsAdmission(root);
    admission.claim();
    const marker = readFileSync(join(root, 'active-pair.json'));
    assert.throws(
      () => admission.prepareRelease({ synthetic: 'x'.repeat(1024 * 1024) }),
      /archive budget/,
    );
    assert.deepEqual(readdirSync(root), ['active-pair.json']);
    assert.deepEqual(readFileSync(join(root, 'active-pair.json')), marker);
    assert.throws(() => desktopAgentsAdmission(root), /reconciliation/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

for (const alteration of ['changed', 'oversized'] as const)
  test(`${alteration} retirement archive cannot release the owner marker`, () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'orqst-synthetic-archive-tamper-')));
    try {
      const admission = desktopAgentsAdmission(root);
      admission.claim();
      const marker = readFileSync(join(root, 'active-pair.json'));
      const finish = admission.prepareRelease({ synthetic: 'no process dispatched' });
      const archive = readdirSync(root).find((name) => name.startsWith('retired-'))!;
      writeFileSync(
        join(root, archive),
        alteration === 'changed' ? 'changed' : 'x'.repeat(1024 * 1024 + 1),
        { mode: 0o600 },
      );
      assert.throws(finish, /archive changed|Untrusted terminal file/);
      assert.deepEqual(readFileSync(join(root, 'active-pair.json')), marker);
      assert.throws(() => desktopAgentsAdmission(root), /reconciliation/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
