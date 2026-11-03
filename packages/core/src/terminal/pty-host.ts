// Separate pinned Node process owns its PTY; never load the addon into Electron's ABI.
import type { spawn as spawnPty } from 'node-pty';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import {
  managedCodexEnvironment,
  managedCodexProfiles,
  readManagedCodexConfig,
} from './codex-profile.js';
import { managedTerminalCommandSchema } from './pty-channel.js';

process.umask(0o077);
if (!process.send || process.argv.length !== 4 || !/^v24\./.test(process.version))
  throw new Error('Private Node host only');
const config = readManagedCodexConfig(process.argv[2]!);
const profile = managedCodexProfiles(config).find((value) => value.id === process.argv[3]);
if (!profile) throw new Error('Unknown fixed terminal profile');
const { spawn } = createRequire(__filename)(join(__dirname, 'terminal-pty/lib/index.js')) as {
  spawn: typeof spawnPty;
};
const child = spawn(profile.executable, [...profile.argv], {
  cwd: profile.cwd,
  env: managedCodexEnvironment(config),
  name: 'xterm-256color',
  cols: 80,
  rows: 24,
});
let exited = false;
const send = (value: object) => {
  if (!process.connected) return;
  try {
    if (
      !process.send!(value, (error) => {
        if (!error && !exited) child.resume();
      })
    )
      child.pause();
  } catch {
    child.resume();
  }
};
child.onData((text) => {
  // Bound each IPC message; no transcript or provider-content logging.
  for (let offset = 0; offset < text.length;) {
    let end = Math.min(text.length, offset + 16 * 1024);
    const last = text.charCodeAt(end - 1);
    if (end < text.length && last >= 0xd800 && last <= 0xdbff) end--;
    send({ type: 'data', text: text.slice(offset, end) });
    offset = end;
  }
});
child.onExit(({ exitCode, signal }) => {
  exited = true;
  clearTimeout(lifetime);
  clearTimeout(escalation);
  send({ type: 'exit', exitCode, ...(signal === undefined ? {} : { signal }) });
  if (process.connected) process.disconnect();
});
// Successful PTY creation is OS process evidence, NOT provider readiness or authentication.
send({ type: 'started' });
process.on('message', (raw: unknown) => {
  if (exited) return;
  const parsed = managedTerminalCommandSchema.safeParse(raw);
  if (!parsed.success) return;
  const request = parsed.data;
  if (request.action === 'write') child.write(request.text);
  if (request.action === 'resize') child.resize(request.columns, request.rows);
  if (request.action === 'signal') child.kill(request.signal);
});
process.on('disconnect', () => child.resume());
let escalation: ReturnType<typeof setTimeout> | undefined;
const lifetime = setTimeout(
  () => {
    if (exited) return;
    child.resume();
    child.kill('SIGTERM');
    escalation = setTimeout(() => {
      if (!exited) child.kill('SIGKILL');
    }, 5000);
  },
  30 * 60 * 1000,
);
