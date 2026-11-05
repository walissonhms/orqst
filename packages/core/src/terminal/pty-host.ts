// Separate pinned Node process owns its PTY; never load the addon into Electron's ABI.
import type { IPty, spawn as spawnPty } from 'node-pty';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { constants } from 'node:os';
import { armLifecycleReceipt } from '../managed-codex/lifecycle-receipt.js';
import { terminalDigest } from './authority.js';
import { terminalFile } from './codex-profile.js';
import {
  interactiveTerminalEnvironment,
  interactiveTerminalProfiles,
  readInteractiveTerminalConfig,
} from './interactive-profile.js';
import { managedTerminalCommandSchema } from './pty-channel.js';
import { terminalMcpLaunchSchema } from './mcp-launch.js';

process.umask(0o077);
if (!process.send || ![4, 5, 6].includes(process.argv.length) || !/^v24\./.test(process.version))
  throw new Error('Private Node host only');
async function start(): Promise<void> {
  const config = readInteractiveTerminalConfig(process.argv[2]!);
  const kernelMode = process.argv.at(-1) === '--kernel-receipt';
  const mcpArgument = process.argv[4] === '--kernel-receipt' ? undefined : process.argv[4];
  if (process.argv.length === 6 && !kernelMode) throw new Error('Invalid host arguments');
  const mcp = mcpArgument ? terminalMcpLaunchSchema.parse(JSON.parse(mcpArgument)) : undefined;
  if (!!config.interactive?.mcp !== !!mcp) throw new Error('MCP launch composition required');
  const profile = interactiveTerminalProfiles(config, mcp).find(
    (value) => value.id === process.argv[3],
  );
  if (!profile) throw new Error('Unknown fixed terminal profile');
  const receipt = armLifecycleReceipt(4, terminalDigest(terminalFile(process.argv[2]!, true)));
  if (kernelMode) {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => finish(false), 10_000);
      const onMessage = (value: unknown) => {
        if (value && typeof value === 'object' && 'action' in value && value.action === 'spawn')
          finish(true);
      };
      const onDisconnect = () => finish(false);
      function finish(allowed: boolean) {
        clearTimeout(timeout);
        process.off('message', onMessage);
        process.off('disconnect', onDisconnect);
        if (allowed) resolve();
        else reject(new Error('Host dispatch identity unavailable'));
      }
      process.on('message', onMessage);
      process.on('disconnect', onDisconnect);
      process.send!({ type: 'awaiting-spawn' }, (error) => error && finish(false));
    });
  }
  const { spawn } = createRequire(__filename)(join(__dirname, 'terminal-pty/lib/index.js')) as {
    spawn: typeof spawnPty;
  };
  let child: IPty;
  try {
    child = spawn(profile.executable, [...profile.argv], {
      cwd: profile.cwd,
      env: interactiveTerminalEnvironment(config, mcp),
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
    });
  } catch (error) {
    await receipt.record({ type: 'spawn_failed' });
    throw error;
  }
  if (kernelMode) child.pause();
  const started = receipt.record({ type: 'started' });
  let identityPending = kernelMode;
  let startedDurable = false;
  let reportedStarted = false;
  const deferredOutput: string[] = [];
  let deferredBytes = 0;
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
    if (identityPending) {
      deferredBytes += Buffer.byteLength(text);
      if (deferredBytes > 1024 * 1024) {
        if (process.connected) process.disconnect();
        return;
      }
      deferredOutput.push(text);
      return;
    }
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
    const name = signal
      ? Object.entries(constants.signals).find(([, value]) => value === signal)?.[0]
      : undefined;
    void receipt
      .record({ type: 'exit', code: signal ? null : exitCode, signal: name ?? null })
      .then(() => send({ type: 'exit', exitCode, ...(signal === undefined ? {} : { signal }) }))
      .catch(() => {}) // Receipt failure is uncertainty; never invent a confirmed exit.
      .finally(() => {
        if (process.connected) process.disconnect();
      });
  });
  const reportStarted = () => {
    if (!identityPending && startedDurable && !reportedStarted && !exited) {
      reportedStarted = true;
      send({ type: 'started' });
    }
  };
  // Successful PTY creation is OS process evidence, NOT provider readiness or authentication.
  void started
    .then(() => {
      startedDurable = true;
      reportStarted();
    })
    .catch(() => {
      if (process.connected) process.disconnect();
    });
  process.on('message', (raw: unknown) => {
    if (exited) return;
    if (
      identityPending &&
      raw &&
      typeof raw === 'object' &&
      'action' in raw &&
      (raw.action === 'kernel-identity-confirmed' || raw.action === 'kernel-identity-unavailable')
    ) {
      identityPending = false;
      reportStarted();
      for (const text of deferredOutput) {
        for (let offset = 0; offset < text.length;) {
          let end = Math.min(text.length, offset + 16 * 1024);
          const last = text.charCodeAt(end - 1);
          if (end < text.length && last >= 0xd800 && last <= 0xdbff) end--;
          send({ type: 'data', text: text.slice(offset, end) });
          offset = end;
        }
      }
      deferredOutput.length = 0;
      child.resume();
      return;
    }
    if (identityPending) return;
    const parsed = managedTerminalCommandSchema.safeParse(raw);
    if (!parsed.success) return;
    const request = parsed.data;
    if (request.action === 'write') child.write(request.text);
    if (request.action === 'resize') child.resize(request.columns, request.rows);
    if (request.action === 'signal') child.kill(request.signal);
  });
  process.on('disconnect', () => child.resume());
  let escalation: ReturnType<typeof setTimeout> | undefined;
  if (kernelMode) process.send!({ type: 'kernel-identity-request', pid: child.pid });
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
}
void start().catch(() => {
  if (process.connected) process.disconnect();
  process.exitCode = 1;
});
