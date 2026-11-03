// Developer-only integration of the experimental library with the fixed native fixture.
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import type { IPty, spawn } from 'node-pty';
import {
  TerminalAuthority,
  terminalChallengeBytes,
  terminalDigest,
  type TerminalChallenge,
} from '../../packages/core/src/terminal/authority.js';
import {
  TerminalSupervisor,
  type TerminalProfile,
} from '../../packages/core/src/terminal/supervisor.js';
import { OUTPUT_LIMIT, TAIL_LIMIT } from './probe.js';

/** Called only after accept-terminal-pty's exact synthetic authorization gate. */
export async function probeOwnedSyntheticPty(
  spawnPty: typeof spawn,
  node: string,
  fixture: string,
  home: string,
): Promise<string[]> {
  const keys = generateKeyPairSync('ed25519');
  const authority = new TerminalAuthority(new Map([['synthetic-native-client', keys.publicKey]]));
  // Synthetic stand-in for a native confirmation. Never exposed as an application signer.
  const proof = (challenge: TerminalChallenge) => ({
    challengeId: challenge.challengeId,
    signature: sign(null, terminalChallengeBytes(challenge), keys.privateKey).toString('base64url'),
  });
  const executableSha256 = terminalDigest(readFileSync(node));
  const fixtureSha256 = terminalDigest(readFileSync(fixture));
  const profile: TerminalProfile = {
    id: 'fixed-synthetic-node-v1',
    projectId: 'disposable-owned-probe',
    executable: node,
    executableSha256,
    executableVersion: process.version,
    argv: [fixture],
    cwd: home,
    environmentProfile: 'private-home-explicit-env-v1',
    permissions: 'Cooperative synthetic Node fixture; no sandbox or descendant guarantee',
  };
  let pty: IPty | undefined;
  let exited = false;
  let exitCode: number | undefined;
  let disposeExit: (() => void) | undefined;
  const expectedProfile = JSON.stringify(profile);
  const supervisor = new TerminalSupervisor(
    authority,
    {
      validate: (value) =>
        JSON.stringify(value) === expectedProfile &&
        terminalDigest(readFileSync(node)) === executableSha256 &&
        terminalDigest(readFileSync(fixture)) === fixtureSha256,
      start: (_profile, events) => {
        const child = spawnPty(node, [fixture], {
          name: 'xterm-256color',
          cols: 80,
          rows: 24,
          cwd: home,
          env: { HOME: home, CODEX_HOME: home, TMPDIR: home, LANG: 'C', LC_ALL: 'C' },
        });
        pty = child;
        // Cleanup evidence is independent of the experimental supervisor's listener lifetime.
        const cleanupExit = child.onExit((event) => {
          exited = true;
          exitCode = event.exitCode;
        });
        disposeExit = () => cleanupExit.dispose();
        let readiness = '';
        let ready = false;
        const data = child.onData((text) => {
          events.data(text);
          if (!ready) {
            readiness = (readiness + text).slice(-128);
            // Explicit instrumentation of this hash-checked synthetic fixture only.
            if (readiness.includes('SYNTHETIC:READY:80x24')) {
              ready = true;
              events.started();
            }
          }
        });
        const exit = child.onExit((event) => events.exit(event.exitCode, event.signal));
        return {
          write: (text) => child.write(text),
          resize: (cols, rows) => child.resize(cols, rows),
          signal: (signal) => child.kill(signal),
          dispose: () => {
            data.dispose();
            exit.dispose();
          },
        };
      },
    },
    [profile],
  );
  const prepared = supervisor.prepare('synthetic-native-client', profile.id);
  let attachment = '';
  let lease = '';
  let cursor = 0;
  let tail = '';
  const deadline = Date.now() + 5000;
  const waitFor = async (predicate: () => boolean) => {
    while (!predicate()) {
      if (Date.now() >= deadline) throw new Error('Owned synthetic PTY deadline exceeded');
      if (exited) throw new Error('Owned synthetic PTY exited before expected evidence');
      await delay(10);
    }
  };
  const marker = async (value: string) => {
    await waitFor(() => {
      const output = supervisor.read(prepared.attemptId, attachment, cursor);
      assert.equal(output.gap, false);
      cursor = output.nextCursor;
      assert.ok(cursor <= OUTPUT_LIMIT);
      tail = (tail + output.bytes.toString()).slice(-TAIL_LIMIT);
      return tail.includes(`SYNTHETIC:${value}`);
    });
  };
  try {
    assert.equal(pty, undefined);
    assert.throws(() => supervisor.launch(prepared.attemptId, { clicked: true }));
    supervisor.launch(prepared.attemptId, proof(prepared.challenge));
    assert.throws(() => supervisor.launch(prepared.attemptId, proof(prepared.challenge)));
    await waitFor(() => supervisor.snapshot(prepared.attemptId).state === 'running');
    const id = prepared.attemptId;
    attachment = supervisor.attach(
      id,
      proof(supervisor.requestAttach('synthetic-native-client', id)),
    );
    lease = supervisor.enableInput(id, attachment, proof(supervisor.requestInput(id, attachment)));
    supervisor.write(id, attachment, lease, 0, 'ping\n');
    await marker('PONG');
    assert.throws(() => supervisor.write(id, attachment, lease, 0, 'ping\n'));
    supervisor.resize(id, attachment, 101, 37);
    supervisor.write(id, attachment, lease, 1, 'size\n');
    await marker('SIZE:101x37');
    supervisor.write(id, attachment, lease, 2, '\x03');
    await marker('CTRL_C_BYTE');
    assert.equal(supervisor.snapshot(id).state, 'running');
    const delayed = supervisor.requestInput(id, attachment);
    supervisor.revokeInput(id, attachment);
    assert.throws(() => supervisor.enableInput(id, attachment, proof(delayed)));
    assert.throws(() => supervisor.write(id, attachment, lease, 3, 'ping\n'));
    const oldAttachment = attachment;
    supervisor.detach(id, attachment);
    assert.equal(supervisor.snapshot(id).state, 'running');
    attachment = supervisor.attach(
      id,
      proof(supervisor.requestAttach('synthetic-native-client', id)),
    );
    assert.notEqual(attachment, oldAttachment);
    const oldLease = lease;
    lease = supervisor.enableInput(id, attachment, proof(supervisor.requestInput(id, attachment)));
    assert.throws(() => supervisor.write(id, attachment, oldLease, 0, 'ping\n'));
    const paste = supervisor.requestPaste(id, attachment, lease, 0, 'ping\n');
    assert.throws(() => supervisor.paste(id, attachment, lease, 0, 'exit\n', proof(paste)));
    tail = '';
    supervisor.paste(id, attachment, lease, 0, 'ping\n', proof(paste));
    await marker('PONG');
    const stop = supervisor.requestStop('synthetic-native-client', id, 'SIGTERM');
    assert.throws(() => supervisor.stop(id, 'SIGKILL', proof(stop)));
    supervisor.stop(id, 'SIGTERM', proof(stop));
    await waitFor(() => supervisor.snapshot(id).state === 'exited');
    assert.equal(supervisor.snapshot(id).exit?.exitCode, 0);
    assert.equal(exited, true);
    assert.equal(exitCode, 0);
    return [
      'signed-start-before-spawn',
      'start-replay-denied',
      'owned-lifecycle',
      'leased-sequenced-input',
      'owned-resize',
      'ctrl-c-is-not-exit',
      'blur-revokes-pending-input',
      'detach-preserves-process',
      'reattach-requires-fresh-lease',
      'exact-paste-grant',
      'scoped-stop-confirmed-exit',
    ];
  } finally {
    await cleanup();
  }

  async function cleanup(): Promise<void> {
    try {
      if (pty && !exited) {
        // Authorized by the explicit developer synthetic flag, never a runtime fallback.
        pty.resume();
        pty.kill('SIGKILL');
        const cleanupDeadline = Date.now() + 2000;
        while (!exited && Date.now() < cleanupDeadline) await delay(10);
      }
    } finally {
      disposeExit?.();
    }
    if (pty && !exited) throw new Error('Owned synthetic PTY cleanup unconfirmed');
  }
}
