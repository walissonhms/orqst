// Separate Node owner keeps its fixed deadline if Core/IPC disappears. Never part of observer startup.
import { spawn } from 'node:child_process';
import { StartupCounters, hostCounterNames, reportHostStartup } from './startup-diagnostics.js';
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
  stdio: ['pipe', 'pipe', 'pipe'],
});
const counters = new StartupCounters(hostCounterNames);
const stopDiagnostics = reportHostStartup(counters, (frame, done) => {
  if (!process.connected) {
    done(new Error('IPC unavailable'));
    return;
  }
  process.send!(frame, done);
});
child.stderr.on('data', (bytes: Buffer) => counters.add('stderrBytes', bytes.length));
child.stderr.on('error', () => {}); // Optional diagnostics must not revoke the host lifetime.
let exited = false;
let spawned = false;
let escalation: ReturnType<typeof setTimeout> | undefined;
const send = (value: object) => {
  if (!process.connected) return;
  const isData = 'type' in value && value.type === 'data';
  try {
    counters.add('ipcQueued');
    if (isData) counters.add('ipcDataQueued');
    if (
      !process.send!(value, (error) => {
        counters.add('ipcCallbacks');
        if (isData) counters.add('ipcDataCallbacks');
        if (error) {
          counters.add('ipcErrors');
          if (isData) counters.add('ipcDataErrors');
        }
        child.stdout.resume();
      })
    ) {
      counters.add('ipcBackpressure');
      child.stdout.pause();
    }
  } catch {
    counters.add('ipcErrors');
    if (isData) counters.add('ipcDataErrors');
    child.stdout.resume();
  }
};
async function persist(value: Parameters<typeof receipt.record>[0]): Promise<boolean> {
  counters.add('receiptQueued');
  try {
    await receipt.record(value);
    counters.add('receiptCompleted');
    return true;
  } catch {
    counters.add('receiptErrors');
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
  counters.add('stdoutBytes', bytes.length);
  counters.add('stdoutChunks');
  let newlines = 0;
  for (const byte of bytes) if (byte === 10) newlines++;
  counters.add('stdoutNewlines', newlines);
  for (let offset = 0; offset < bytes.length; offset += 32 * 1024)
    send({ type: 'data', base64: bytes.subarray(offset, offset + 32 * 1024).toString('base64') });
});
child.stdin.on('error', () => {
  counters.add('stdinErrors');
  send({ type: 'lost' });
});
child.stdin.on('drain', () => counters.add('stdinDrains'));
child.on('error', async () => {
  send({ type: 'lost' });
  if (!spawned) {
    await persist({ type: 'spawn_failed' });
    finish();
  }
});
child.on('exit', async (code, signal) => {
  counters.add('exits');
  exited = true;
  clearTimeout(lifetime);
  clearTimeout(escalation);
  if ((code !== null || signal !== null) && (await persist({ type: 'exit', code, signal })))
    send({ type: 'exit', lifecycleVersion: 1, code, signal });
  finish();
});
function finish() {
  stopDiagnostics();
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
  counters.add('commands');
  const parsed = command.safeParse(raw);
  if (!parsed.success) {
    counters.add('rejected');
    return;
  }
  if (parsed.data.action === 'signal') child.kill(parsed.data.signal);
  else if (child.stdin.writableLength + Buffer.byteLength(parsed.data.line) <= 256 * 1024) {
    counters.add('accepted');
    counters.add('stdinBytes', Buffer.byteLength(parsed.data.line));
    if (
      !child.stdin.write(parsed.data.line, (error) => {
        counters.add('stdinCallbacks');
        if (error) counters.add('stdinErrors');
      })
    )
      counters.add('stdinBackpressure');
  } else {
    counters.add('rejected');
    send({ type: 'lost' });
  }
});
// Disconnect revokes controls; only the already-disclosed lifetime can later signal this handle.
process.on('disconnect', () => {
  stopDiagnostics();
  child.stdout.resume();
});
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
