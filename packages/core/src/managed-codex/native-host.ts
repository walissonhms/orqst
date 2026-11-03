// Separate Node owner keeps its fixed deadline if Core/IPC disappears. Never part of observer startup.
import { spawn } from 'node:child_process';
import { z } from 'zod';
import { terminalDigest } from '../terminal/authority.js';
import { armLifecycleReceipt } from './lifecycle-receipt.js';
import {
  managedCodexEnvironment,
  readManagedCodexConfig,
  structuredCodexArguments,
  terminalFile,
} from '../terminal/codex-profile.js';

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
const receipt = armLifecycleReceipt(4, terminalDigest(terminalFile(process.argv[2]!, true)));
const child = spawn(config.executable.path, structuredCodexArguments(config), {
  cwd: config.project,
  env: managedCodexEnvironment(config),
  stdio: ['pipe', 'pipe', 'ignore'],
});
let exited = false;
let spawned = false;
let escalation: ReturnType<typeof setTimeout> | undefined;
const send = (value: object) => {
  if (!process.connected) return;
  try {
    if (!process.send!(value, () => child.stdout.resume())) child.stdout.pause();
  } catch {
    child.stdout.resume();
  }
};
async function persist(value: Parameters<typeof receipt.record>[0]): Promise<boolean> {
  try {
    await receipt.record(value);
    return true;
  } catch {
    send({ type: 'lost' });
    return false;
  }
}
child.on('spawn', async () => {
  spawned = true;
  if (await persist({ type: 'started' }))
    send({ type: 'started', lifecycleVersion: 1, processId: child.pid });
});
child.stdout.on('data', (bytes: Buffer) => {
  for (let offset = 0; offset < bytes.length; offset += 32 * 1024)
    send({ type: 'data', base64: bytes.subarray(offset, offset + 32 * 1024).toString('base64') });
});
child.stdin.on('error', () => send({ type: 'lost' }));
child.on('error', async () => {
  send({ type: 'lost' });
  if (!spawned) {
    await persist({ type: 'spawn_failed' });
    finish();
  }
});
child.on('exit', async (code, signal) => {
  exited = true;
  clearTimeout(lifetime);
  clearTimeout(escalation);
  if ((code !== null || signal !== null) && (await persist({ type: 'exit', code, signal })))
    send({ type: 'exit', lifecycleVersion: 1, code, signal });
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
