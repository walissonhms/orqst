import assert from 'node:assert/strict';
import test from 'node:test';
import type { IPty } from 'node-pty';
import {
  BoundedOutput,
  OUTPUT_LIMIT,
  TAIL_LIMIT,
  probeSyntheticPty,
  requireSyntheticAuthorization,
} from '../scripts/terminal/probe.js';

test('developer PTY acceptance requires an exact explicit synthetic grant', () => {
  for (const args of [[], ['--authorize-synthetic-pty', 'codex'], ['--exec=node'], ['--help']]) {
    assert.throws(() => requireSyntheticAuthorization(args));
  }
  requireSyntheticAuthorization(['--authorize-synthetic-pty']);
});

test('synthetic output budgets count UTF-8 bytes and retain a bounded tail', () => {
  const output = new BoundedOutput();
  output.append('a'.repeat(TAIL_LIMIT));
  output.append('🌍');
  assert.equal(output.bytes, TAIL_LIMIT + 4);
  assert.equal(output.tail.length, TAIL_LIMIT);
  output.append('x'.repeat(OUTPUT_LIMIT - output.bytes));
  assert.equal(output.bytes, OUTPUT_LIMIT);
  assert.throws(() => output.append('x'), /budget exceeded/);
  assert.equal(output.tail.length, TAIL_LIMIT);
});

// A synthetic in-memory backend checks negative lifecycle paths without spawning.
function fakePty() {
  const signals: string[] = [];
  let onData: (text: string) => void = () => {};
  let onExit: (event: { exitCode: number }) => void = () => {};
  let disposed = 0;
  const pty: IPty = {
    pid: 1,
    cols: 80,
    rows: 24,
    process: 'synthetic-test-double',
    handleFlowControl: false,
    onData: (listener) => {
      onData = listener;
      return {
        dispose: () => {
          disposed++;
        },
      };
    },
    onExit: (listener) => {
      onExit = listener;
      return {
        dispose: () => {
          disposed++;
        },
      };
    },
    write: () => {},
    resize: () => {},
    clear: () => {},
    pause: () => {},
    resume: () => {},
    kill: (signal) => {
      signals.push(signal ?? 'SIGHUP');
      onExit({ exitCode: 1 });
    },
  };
  return {
    pty,
    signals,
    data: (text: string) => onData(text),
    exit: () => onExit({ exitCode: 1 }),
    disposed: () => disposed,
  };
}

test('early process exit fails evidence without signaling a stale handle', async () => {
  const fake = fakePty();
  const result = probeSyntheticPty(fake.pty, 'exit');
  fake.exit();
  await assert.rejects(result, /before expected evidence/);
  assert.deepEqual(fake.signals, []);
  assert.equal(fake.disposed(), 2);
});

test('excessive output fails and cleans up only its owned fixture handle', async () => {
  const fake = fakePty();
  const result = probeSyntheticPty(fake.pty, 'exit');
  fake.data('x'.repeat(OUTPUT_LIMIT + 1));
  await assert.rejects(result, /budget exceeded/);
  assert.deepEqual(fake.signals, ['SIGKILL']);
  assert.equal(fake.disposed(), 2);
});
