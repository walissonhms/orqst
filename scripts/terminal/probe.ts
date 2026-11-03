// Developer-only mechanics probe. No production module imports this file.
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import type { IPty } from 'node-pty';

export const OUTPUT_LIMIT = 256 * 1024;
export const TAIL_LIMIT = 4096;

export function requireSyntheticAuthorization(args: string[]): void {
  if (args.length !== 1 || args[0] !== '--authorize-synthetic-pty') {
    throw new Error(
      'Requires exactly --authorize-synthetic-pty; no executable or input is accepted.',
    );
  }
}

export class BoundedOutput {
  bytes = 0;
  tail = '';

  append(text: string): void {
    this.bytes += Buffer.byteLength(text);
    if (this.bytes > OUTPUT_LIMIT) throw new Error('Synthetic PTY output budget exceeded');
    this.tail = (this.tail + text).slice(-TAIL_LIMIT);
  }
}

export async function probeSyntheticPty(pty: IPty, mode: 'exit' | 'signal'): Promise<string[]> {
  const output = new BoundedOutput();
  let exited = false;
  let failure: Error | undefined;
  let exitCode: number | undefined;
  const dataListener = pty.onData((text) => {
    if (failure) return;
    try {
      output.append(text);
    } catch (error) {
      failure = error as Error;
    }
  });
  const exitListener = pty.onExit((event) => {
    exited = true;
    exitCode = event.exitCode;
  });
  const deadline = Date.now() + 5000;
  async function waitFor(test: () => boolean): Promise<void> {
    while (!test()) {
      if (failure) throw failure;
      if (Date.now() >= deadline) throw new Error('Synthetic PTY deadline exceeded');
      if (exited)
        throw new Error(
          `Synthetic PTY exited before expected evidence: ${JSON.stringify(output.tail)}`,
        );
      await delay(10);
    }
    if (failure) throw failure;
  }
  const marker = async (value: string) => waitFor(() => output.tail.includes(`SYNTHETIC:${value}`));
  async function cleanup(): Promise<void> {
    try {
      if (!exited) {
        pty.resume();
        pty.kill('SIGKILL');
        const cleanupDeadline = Date.now() + 2000;
        while (!exited && Date.now() < cleanupDeadline) await delay(10);
      }
    } finally {
      dataListener.dispose();
      exitListener.dispose();
    }
    if (!exited)
      throw new Error('Synthetic PTY cleanup unconfirmed; fixture watchdog remains active');
  }
  try {
    await marker('READY:80x24');
    if (mode === 'signal') {
      pty.kill('SIGTERM');
      await waitFor(() => exited);
      assert.ok(output.tail.includes('SYNTHETIC:SIGTERM'));
      assert.equal(exitCode, 0);
      return ['owned-handle-signal', 'confirmed-exit'];
    }
    pty.write('ping\n');
    await marker('PONG');
    pty.resize(101, 37);
    pty.write('size\n');
    await marker('SIZE:101x37');
    pty.write('\x03');
    await marker('CTRL_C_BYTE');
    // This fixture uses raw mode: a Ctrl+C byte is deliberately not a signal.
    assert.equal(exited, false);
    const beforePause = output.bytes;
    pty.pause();
    pty.write('burst\n');
    await delay(50);
    assert.equal(output.bytes, beforePause);
    pty.resume();
    await marker('BURST_END');
    assert.ok(output.bytes > 128 * 1024);
    assert.ok(output.tail.length <= TAIL_LIMIT);
    pty.write('exit\n');
    await waitFor(() => exited);
    assert.equal(exitCode, 0);
    return [
      'tty-and-environment',
      'input',
      'resize',
      'raw-ctrl-c',
      'pause-resume',
      'bounded-output',
      'confirmed-exit',
    ];
  } finally {
    await cleanup();
  }
}
