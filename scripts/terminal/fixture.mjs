// Synthetic PTY fixture only. Never interprets input as code or starts descendants.
import assert from 'node:assert/strict';

assert.equal(process.stdin.isTTY, true);
assert.equal(process.stdout.isTTY, true);
assert.equal(process.cwd(), process.env.HOME);
assert.equal(process.env.CODEX_HOME, process.env.HOME);
assert.equal(process.env.NODE_OPTIONS, undefined);
assert.equal(process.env.ORQST_SYNTHETIC_SECRET, undefined);
// CoreFoundation may add its own text encoding on macOS even with an explicit env.
const allowed = new Set([
  'HOME',
  'CODEX_HOME',
  'TMPDIR',
  'TERM',
  'LANG',
  'LC_ALL',
  'PWD',
  '__CF_USER_TEXT_ENCODING',
]);
assert.deepEqual(
  Object.keys(process.env).filter((key) => !allowed.has(key)),
  [],
);
process.stdin.setRawMode(true);
const emit = (text) => process.stdout.write(`SYNTHETIC:${text}\n`);
// Independent watchdog bounds survival even if the acceptance parent crashes.
setTimeout(() => process.exit(42), 8000);
process.on('SIGTERM', () => {
  emit('SIGTERM');
  process.exit(0);
});
let input = '';
process.stdin.on('data', (chunk) => {
  for (const byte of chunk.toString('utf8')) {
    if (byte === '\x03') {
      emit('CTRL_C_BYTE');
    } else if (byte === '\n') {
      const command = input;
      input = '';
      if (command === 'ping') emit('PONG');
      else if (command === 'size') emit(`SIZE:${process.stdout.columns}x${process.stdout.rows}`);
      else if (command === 'burst') {
        for (let i = 0; i < 128; i++) process.stdout.write('x'.repeat(1024) + '\n');
        emit('BURST_END');
      } else if (command === 'exit') process.exit(0);
      else process.exit(43);
    } else {
      input += byte;
      if (input.length > 16) process.exit(44);
    }
  }
});
emit(`READY:${process.stdout.columns}x${process.stdout.rows}`);
