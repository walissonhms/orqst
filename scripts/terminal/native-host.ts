// Explicit acceptance entry point only. This process owns exactly one disposable fixture PTY.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import type { IPty, spawn } from 'node-pty';
import { syntheticCommandSchema } from './native-channel.js';

assert.deepEqual(process.argv.slice(2), ['--authorize-synthetic-pty']);
assert.match(process.version, /^v24\./);
assert.equal(process.platform, 'darwin');
assert.equal(process.arch, 'arm64');
assert.ok(process.send);
const root = process.cwd();
const backend = createRequire(join(root, 'host.cjs'))(join(root, 'node-pty/lib/index.js')) as {
  spawn: typeof spawn;
};
let exited = false;
let outputBytes = 0;
let ready = false;
let tail = '';
const send = (value: object) => {
  if (!process.connected) return;
  try {
    const writable = process.send!(value, (error) => {
      if (!error && !exited) child?.resume();
    });
    if (!writable) child?.pause();
  } catch {
    // Parent loss never authorizes arbitrary PID cleanup; fixture has its own watchdog.
  }
};
const child: IPty = backend.spawn(process.execPath, [join(root, 'synthetic-fixture.mjs')], {
  name: 'xterm-256color',
  cols: 80,
  rows: 24,
  cwd: root,
  env: { HOME: root, CODEX_HOME: root, TMPDIR: root, LANG: 'C', LC_ALL: 'C' },
});
child.onData((text) => {
  outputBytes += Buffer.byteLength(text);
  if (outputBytes > 256 * 1024 || text.length > 64 * 1024) {
    child!.kill('SIGKILL'); // Fixed fixture cleanup authorized only by this lab's flag.
    return;
  }
  tail = (tail + text).slice(-128);
  if (!ready && tail.includes('SYNTHETIC:READY:80x24')) {
    ready = true;
    send({ type: 'started' });
  }
  send({ type: 'data', text });
});
child.onExit(({ exitCode, signal }) => {
  exited = true;
  send({ type: 'exit', exitCode, ...(signal === undefined ? {} : { signal }) });
  if (process.connected) process.disconnect();
});
process.on('message', (raw: unknown) => {
  if (exited || !ready) return;
  const parsed = syntheticCommandSchema.safeParse(raw);
  if (!parsed.success) return;
  const request = parsed.data;
  if (request.action === 'write') child!.write(request.text);
  if (request.action === 'resize') child!.resize(request.columns, request.rows);
  if (request.action === 'signal') child!.kill(request.signal);
});
// Resume a backpressured fixture so its independent 8s watchdog can finish after parent loss.
process.on('disconnect', () => child?.resume());
setTimeout(() => process.exit(exited ? 0 : 45), 12_000).unref();
