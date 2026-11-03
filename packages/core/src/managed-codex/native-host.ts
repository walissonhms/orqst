// Separate Node owner keeps its fixed deadline if Core/IPC disappears. Never part of observer startup.
import { spawn } from 'node:child_process';
import { z } from 'zod';
import { managedCodexEnvironment, readManagedCodexConfig } from '../terminal/codex-profile.js';

process.umask(0o077);
if (
  !process.send ||
  process.argv.length !== 3 ||
  !/^v24\./.test(process.version) ||
  process.platform !== 'darwin' ||
  process.arch !== 'arm64' ||
  process.getuid?.() === 0
)
  throw new Error('Private managed Codex host only');
const config = readManagedCodexConfig(process.argv[2]!);
const child = spawn(
  config.executable.path,
  ['-c', 'cli_auth_credentials_store="file"', 'app-server', '--listen', 'stdio://'],
  {
    cwd: config.project,
    env: managedCodexEnvironment(config),
    stdio: ['pipe', 'pipe', 'ignore'],
  },
);
let exited = false;
let escalation: ReturnType<typeof setTimeout> | undefined;
const send = (value: object) => {
  if (!process.connected) return;
  try {
    if (!process.send!(value, () => child.stdout.resume())) child.stdout.pause();
  } catch {
    child.stdout.resume();
  }
};
child.on('spawn', () => send({ type: 'started' }));
child.stdout.on('data', (bytes: Buffer) => {
  for (let offset = 0; offset < bytes.length; offset += 32 * 1024)
    send({ type: 'data', base64: bytes.subarray(offset, offset + 32 * 1024).toString('base64') });
});
child.stdin.on('error', () => send({ type: 'lost' }));
child.on('error', () => {
  send({ type: 'lost' });
  finish();
});
child.on('exit', (code, signal) => {
  if (code !== null || signal !== null) send({ type: 'exit', code, signal });
  finish();
});
function finish() {
  exited = true;
  clearTimeout(lifetime);
  clearTimeout(escalation);
  if (process.connected) process.disconnect();
}
const command = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('send'),
    line: z
      .string()
      .min(1)
      .max(128 * 1024),
  }),
  z.strictObject({ action: z.literal('signal'), signal: z.enum(['SIGTERM', 'SIGKILL']) }),
]);
process.on('message', (raw: unknown) => {
  if (exited) return;
  const parsed = command.safeParse(raw);
  if (!parsed.success) return;
  if (parsed.data.action === 'signal') child.kill(parsed.data.signal);
  else if (child.stdin.writableLength + Buffer.byteLength(parsed.data.line) <= 256 * 1024)
    child.stdin.write(parsed.data.line);
  else send({ type: 'lost' });
});
// Disconnect revokes controls; only the already-disclosed lifetime can later signal this handle.
process.on('disconnect', () => child.stdout.resume());
const lifetime = setTimeout(
  () => {
    if (exited) return;
    child.stdout.resume();
    child.kill('SIGTERM');
    escalation = setTimeout(() => {
      if (!exited) child.kill('SIGKILL');
    }, 5000);
  },
  30 * 60 * 1000,
);
