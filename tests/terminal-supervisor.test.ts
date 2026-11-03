import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';
import {
  TerminalAuthority,
  terminalChallengeBytes,
  terminalDigest,
  type TerminalChallenge,
} from '../packages/core/src/terminal/authority.js';
import { TerminalOutput } from '../packages/core/src/terminal/output.js';
import {
  TerminalSupervisor,
  type TerminalBackend,
  type TerminalEvents,
  type TerminalProfile,
} from '../packages/core/src/terminal/supervisor.js';

// In-memory synthetic doubles only. These automatic tests never create a process.
function setup() {
  let now = 1000;
  const keys = generateKeyPairSync('ed25519');
  const authority = new TerminalAuthority(new Map([['native-test', keys.publicKey]]), () => now);
  const proof = (challenge: TerminalChallenge) => ({
    challengeId: challenge.challengeId,
    signature: sign(null, terminalChallengeBytes(challenge), keys.privateKey).toString('base64url'),
  });
  const profile: TerminalProfile = {
    id: 'synthetic-v1',
    projectId: 'disposable-project',
    executable: '/synthetic/node',
    executableSha256: terminalDigest('synthetic-node'),
    executableVersion: 'synthetic-v1',
    argv: ['/synthetic/fixture'],
    cwd: '/synthetic/private',
    environmentProfile: 'empty-home-no-credentials',
    permissions: 'cooperative-fixture-only',
  };
  const writes: string[] = [];
  const sizes: number[][] = [];
  const signals: string[] = [];
  let events: TerminalEvents | undefined;
  let starts = 0;
  let disposed = 0;
  let valid = true;
  let throwingStart = false;
  let throwingWrite = false;
  let synchronousExit = false;
  const backend: TerminalBackend = {
    validate: () => valid,
    start: (_profile, listeners) => {
      starts++;
      events = listeners;
      if (throwingStart) throw new Error('sensitive backend diagnostic');
      if (synchronousExit) listeners.exit(17);
      return {
        write: (text) => {
          writes.push(text);
          if (throwingWrite) throw new Error('sensitive write diagnostic');
        },
        resize: (cols, rows) => sizes.push([cols, rows]),
        signal: (signal) => signals.push(signal),
        dispose: () => {
          disposed++;
        },
      };
    },
  };
  const supervisor = new TerminalSupervisor(authority, backend, [profile]);
  const launch = () => {
    const prepared = supervisor.prepare('native-test', profile.id);
    supervisor.launch(prepared.attemptId, proof(prepared.challenge));
    return prepared.attemptId;
  };
  const attach = (id: string) =>
    supervisor.attach(id, proof(supervisor.requestAttach('native-test', id)));
  const input = (id: string, attachment: string) =>
    supervisor.enableInput(id, attachment, proof(supervisor.requestInput(id, attachment)));
  return {
    authority,
    supervisor,
    profile,
    proof,
    launch,
    attach,
    input,
    writes,
    sizes,
    signals,
    events: () => {
      assert.ok(events);
      return events;
    },
    advance: (ms: number) => {
      now += ms;
    },
    starts: () => starts,
    disposed: () => disposed,
    invalidate: () => {
      valid = false;
    },
    throwOnStart: () => {
      throwingStart = true;
    },
    throwOnWrite: () => {
      throwingWrite = true;
    },
    exitDuringStart: () => {
      synchronousExit = true;
    },
  };
}

test('signed grants reject forged, mutated, wrong-operation, expired, revoked and replayed authority', () => {
  const s = setup();
  const binding = {
    operation: 'start' as const,
    target: 'attempt',
    digest: terminalDigest('manifest'),
  };
  const challenge = s.authority.prepare('native-test', binding);
  const proof = s.proof(challenge);
  assert.ok(Object.isFrozen(challenge));
  assert.throws(() => s.authority.consume({ ...proof, click: true }, binding));
  assert.throws(() => s.authority.consume({ ...proof, signature: 'a'.repeat(86) }, binding));
  assert.throws(() =>
    s.authority.consume(s.proof({ ...challenge, target: 'external-session' }), binding),
  );
  assert.throws(() => s.authority.consume(proof, { ...binding, operation: 'stop' }));
  assert.throws(() =>
    s.authority.consume(proof, { ...binding, digest: terminalDigest('different') }),
  );
  assert.equal(s.authority.consume(proof, binding), 'native-test');
  assert.throws(() => s.authority.consume(proof, binding));
  const expiring = s.authority.prepare('native-test', binding);
  s.advance(30_000);
  assert.throws(() => s.authority.consume(s.proof(expiring), binding));
  const revoked = s.authority.prepare('native-test', binding);
  s.authority.revoke('native-test');
  assert.throws(() => s.authority.consume(s.proof(revoked), binding));
  assert.throws(() => s.authority.prepare('native-test', binding));
  const other = setup();
  const otherChallenge = other.authority.prepare('native-test', binding);
  assert.throws(() => other.authority.consume(proof, binding));
  assert.throws(() => other.authority.consume(s.proof(otherChallenge), binding));
});

test('pending challenges and attempts are bounded without silently pruning uncertainty', () => {
  const s = setup();
  const binding = {
    operation: 'start' as const,
    target: 'attempt',
    digest: terminalDigest('manifest'),
  };
  for (let i = 0; i < 128; i++) s.authority.prepare('native-test', binding);
  assert.throws(() => s.authority.prepare('native-test', binding), /limit/);
  s.advance(30_000);
  s.authority.prepare('native-test', binding);
  const attempts = setup();
  for (let i = 0; i < 128; i++) attempts.supervisor.prepare('native-test', attempts.profile.id);
  assert.throws(() => attempts.supervisor.prepare('native-test', attempts.profile.id), /limit/);
  assert.equal(attempts.starts(), 0);
});

test('prepare freezes the exact profile, launch consumes authority and waits for backend evidence', () => {
  const s = setup();
  s.profile.argv = ['mutated-after-registration'];
  const prepared = s.supervisor.prepare('native-test', s.profile.id);
  assert.deepEqual(prepared.profile.argv, ['/synthetic/fixture']);
  assert.ok(Object.isFrozen(prepared.profile.argv));
  assert.equal(s.starts(), 0);
  assert.throws(() => s.supervisor.launch(prepared.attemptId, { click: true }));
  assert.equal(s.starts(), 0);
  s.supervisor.launch(prepared.attemptId, s.proof(prepared.challenge));
  assert.equal(s.supervisor.snapshot(prepared.attemptId).state, 'starting');
  assert.throws(() => s.attach(prepared.attemptId));
  s.events().started();
  assert.equal(s.supervisor.snapshot(prepared.attemptId).state, 'running');
  assert.throws(() => s.supervisor.launch(prepared.attemptId, s.proof(prepared.challenge)));
  assert.equal(s.starts(), 1);
  s.events().exit(0);
  assert.deepEqual(s.supervisor.snapshot(prepared.attemptId).exit, { exitCode: 0 });
  assert.equal(s.disposed(), 1);
});

test('changed profile, ambiguous spawn and early synchronous exit retain distinct evidence', () => {
  const changed = setup();
  const prepared = changed.supervisor.prepare('native-test', changed.profile.id);
  changed.invalidate();
  changed.supervisor.launch(prepared.attemptId, changed.proof(prepared.challenge));
  assert.equal(changed.supervisor.snapshot(prepared.attemptId).state, 'start_failed');
  assert.equal(changed.starts(), 0);
  const uncertain = setup();
  uncertain.throwOnStart();
  const lost = uncertain.launch();
  assert.equal(uncertain.supervisor.snapshot(lost).state, 'ownership_lost');
  assert.equal(uncertain.supervisor.snapshot(lost).exit, undefined);
  assert.throws(() => uncertain.launch(), /admission/);
  assert.throws(() => uncertain.supervisor.requestStop('native-test', lost, 'SIGKILL'));
  assert.deepEqual(uncertain.signals, []);
  const early = setup();
  early.exitDuringStart();
  const exited = early.launch();
  assert.equal(early.supervisor.snapshot(exited).state, 'exited');
  assert.equal(early.supervisor.snapshot(exited).exit?.exitCode, 17);
  assert.equal(early.disposed(), 1);
});

test('startup timeout loses ownership, reserves capacity and never signals automatically', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const s = setup();
  const id = s.launch();
  t.mock.timers.tick(10_000);
  assert.equal(s.supervisor.snapshot(id).state, 'ownership_lost');
  assert.equal(s.disposed(), 1);
  s.events().started();
  s.events().exit(0);
  assert.equal(s.supervisor.snapshot(id).state, 'ownership_lost');
  assert.deepEqual(s.signals, []);
  assert.throws(() => s.launch(), /admission/);
});

test('global and project admission slots are held until explicit exit evidence', () => {
  const s = setup();
  const events: TerminalEvents[] = [];
  const profiles = ['one', 'two', 'three', 'one'].map((projectId, index) => ({
    ...s.profile,
    id: `profile-${index}`,
    projectId,
  }));
  const supervisor = new TerminalSupervisor(
    s.authority,
    {
      validate: () => true,
      start: (_profile, event) => {
        events.push(event);
        event.started();
        return { write: () => {}, resize: () => {}, signal: () => {}, dispose: () => {} };
      },
    },
    profiles,
  );
  const prepare = (index: number) => supervisor.prepare('native-test', profiles[index]!.id);
  const first = prepare(0);
  supervisor.launch(first.attemptId, s.proof(first.challenge));
  const sameProject = prepare(3);
  assert.throws(
    () => supervisor.launch(sameProject.attemptId, s.proof(sameProject.challenge)),
    /admission/,
  );
  const second = prepare(1);
  supervisor.launch(second.attemptId, s.proof(second.challenge));
  const third = prepare(2);
  assert.throws(() => supervisor.launch(third.attemptId, s.proof(third.challenge)), /admission/);
  assert.equal(events.length, 2);
  events[0]!.exit(0);
  supervisor.launch(third.attemptId, s.proof(third.challenge));
  assert.equal(events.length, 3);
  events[1]!.exit(0);
  events[2]!.exit(0);
});

test('input requires exact attachment, fresh lease, expiry and strictly increasing sequences', () => {
  const s = setup();
  const id = s.launch();
  s.events().started();
  const attachment = s.attach(id);
  assert.throws(() => s.supervisor.write(id, attachment, 'no-lease', 0, 'x'));
  const lease = s.input(id, attachment);
  s.supervisor.write(id, attachment, lease, 0, '\x03');
  assert.deepEqual(s.signals, []);
  assert.throws(() => s.supervisor.write(id, attachment, lease, 0, 'replay'));
  assert.throws(() => s.supervisor.write(id, attachment, lease, 2, 'skip'));
  assert.throws(() => s.supervisor.write(id, attachment, lease, 1, '🌍'.repeat(1025)), /limit/);
  s.advance(120_000);
  assert.throws(() => s.supervisor.write(id, attachment, lease, 1, 'expired'));
  const renewed = s.input(id, attachment);
  assert.notEqual(renewed, lease);
  assert.throws(() => s.supervisor.write(id, attachment, lease, 0, 'delayed old lease'));
  s.supervisor.write(id, attachment, renewed, 0, 'new');
  s.supervisor.revokeInput(id, attachment);
  assert.throws(() => s.supervisor.write(id, attachment, renewed, 1, 'blurred'));
  const focused = s.input(id, attachment);
  const delayedAttach = s.proof(s.supervisor.requestAttach('native-test', id));
  const delayedInput = s.proof(s.supervisor.requestInput(id, attachment));
  s.supervisor.revokeInput(id, attachment);
  assert.throws(() => s.supervisor.enableInput(id, attachment, delayedInput));
  s.supervisor.detach(id, attachment);
  assert.equal(s.supervisor.snapshot(id).state, 'running');
  assert.throws(() => s.supervisor.attach(id, delayedAttach));
  assert.throws(() => s.supervisor.write(id, attachment, focused, 0, 'detached'));
  const reattached = s.attach(id);
  assert.notEqual(reattached, attachment);
  assert.throws(() => s.supervisor.write(id, reattached, focused, 0, 'reconnected'));
  const reconnectedLease = s.input(id, reattached);
  s.authority.revoke('native-test');
  assert.throws(() => s.supervisor.read(id, reattached, 0));
  assert.throws(() => s.supervisor.write(id, reattached, reconnectedLease, 0, 'revoked'));
  assert.deepEqual(s.writes, ['\x03', 'new']);
  s.events().exit(0);
});

test('paste binds exact bytes, lease and sequence; input and resize budgets reject floods', () => {
  const s = setup();
  const id = s.launch();
  s.events().started();
  const attachment = s.attach(id);
  const lease = s.input(id, attachment);
  const text = 'first\nsecond\n';
  const challenge = s.supervisor.requestPaste(id, attachment, lease, 0, text);
  const proof = s.proof(challenge);
  assert.throws(() => s.supervisor.paste(id, attachment, lease, 0, text + 'changed', proof));
  s.supervisor.paste(id, attachment, lease, 0, text, proof);
  assert.throws(() => s.supervisor.paste(id, attachment, lease, 1, text, proof));
  assert.throws(() =>
    s.supervisor.requestPaste(id, attachment, lease, 1, 'x'.repeat(16 * 1024 + 1)),
  );
  s.advance(1000);
  for (let i = 1; i <= 4; i++) s.supervisor.write(id, attachment, lease, i, 'x'.repeat(4096));
  assert.throws(() => s.supervisor.write(id, attachment, lease, 5, 'x'), /rate/);
  s.advance(1000);
  s.supervisor.write(id, attachment, lease, 5, 'x');
  assert.throws(() => s.supervisor.resize(id, attachment, 301, 24));
  for (let i = 0; i < 10; i++) s.supervisor.resize(id, attachment, 80, 24);
  assert.throws(() => s.supervisor.resize(id, attachment, 80, 24), /rate/);
  assert.equal(s.sizes.length, 10);
  assert.equal(s.writes[0], text);
  s.events().exit(0);
});

test('signal authority is distinct, single-use and does not fabricate process exit', () => {
  const s = setup();
  const id = s.launch();
  s.events().started();
  const challenge = s.supervisor.requestStop('native-test', id, 'SIGTERM');
  const proof = s.proof(challenge);
  assert.throws(() => s.supervisor.stop(id, 'SIGKILL', proof));
  s.supervisor.stop(id, 'SIGTERM', proof);
  assert.equal(s.supervisor.snapshot(id).state, 'running');
  assert.throws(() => s.supervisor.stop(id, 'SIGTERM', proof));
  assert.deepEqual(s.signals, ['SIGTERM']);
  s.events().exit(1, 15);
  assert.equal(s.supervisor.snapshot(id).state, 'exited');
  assert.deepEqual(s.supervisor.snapshot(id).exit, { exitCode: 1, signal: 15 });
  assert.throws(() => s.supervisor.stop(id, 'SIGTERM', proof));
  const next = s.launch();
  assert.notEqual(id, next);
  s.events().exit(0);
});

test('uncertain writes revoke authority and expose no backend diagnostic or retry path', () => {
  const s = setup();
  const id = s.launch();
  s.events().started();
  const attachment = s.attach(id);
  const lease = s.input(id, attachment);
  s.throwOnWrite();
  assert.throws(
    () => s.supervisor.write(id, attachment, lease, 0, 'accepted-before-error'),
    /^Error: Terminal effect uncertain; input revoked$/,
  );
  assert.equal(s.supervisor.snapshot(id).state, 'ownership_lost');
  assert.throws(() => s.supervisor.write(id, attachment, lease, 0, 'retry'));
  assert.equal(s.writes.length, 1);
  assert.equal(s.disposed(), 1);
  assert.deepEqual(s.signals, []);
});

test('output is an inert bounded byte ring with explicit eviction gaps and defensive copies', () => {
  const output = new TerminalOutput(8);
  output.append(Buffer.from('1234'));
  const read = output.read(0);
  read.bytes.fill(0);
  assert.equal(output.read(0).bytes.toString(), '1234');
  output.append(Buffer.from('567890'));
  assert.deepEqual(output.read(0), { bytes: Buffer.from('34567890'), gap: true, nextCursor: 10 });
  assert.equal(output.read(10).bytes.length, 0);
  assert.throws(() => output.read(11));
  assert.throws(() => output.read(-1));
  const s = setup();
  const id = s.launch();
  s.events().started();
  const attachment = s.attach(id);
  const hostile = '\x1b]52;c;clipboard\x07\x1b[31m<script>untrusted</script>';
  s.events().data(hostile);
  assert.equal(s.supervisor.read(id, attachment, 0).bytes.toString(), hostile);
  assert.deepEqual(s.writes, []);
  for (let i = 0; i < 20; i++) s.events().data('x'.repeat(64 * 1024));
  const tail = s.supervisor.read(id, attachment, 0);
  assert.equal(tail.gap, true);
  assert.equal(tail.bytes.length, 64 * 1024);
  s.events().exit(0);
  assert.equal(s.supervisor.read(id, attachment, tail.nextCursor).bytes.length, 64 * 1024);
});

test('oversized backend events and malformed exit evidence fail closed without signaling', () => {
  for (const event of ['data', 'exit'] as const) {
    const s = setup();
    const id = s.launch();
    s.events().started();
    if (event === 'data') s.events().data('x'.repeat(64 * 1024 + 1));
    else s.events().exit(Number.NaN);
    assert.equal(s.supervisor.snapshot(id).state, 'ownership_lost');
    assert.deepEqual(s.signals, []);
    assert.equal(s.disposed(), 1);
  }
});
