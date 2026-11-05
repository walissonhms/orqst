// Separate pinned Node process owns its PTY; never load the addon into Electron's ABI.
import type { IPty, spawn as spawnPty } from 'node-pty';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { constants } from 'node:os';
import { armLifecycleReceipt } from '../managed-codex/lifecycle-receipt.js';
import { terminalDigest } from './authority.js';
import { terminalFile } from './codex-profile.js';
import { systemCliSignatureVerifier } from './cli-system-signature.js';
import { TerminalCliPolicyStore } from './cli-authorization.js';
import { z } from 'zod';
import {
  interactiveProvider,
  interactiveTerminalEnvironment,
  interactiveTerminalProfiles,
  readInteractiveTerminalConfig,
} from './interactive-profile.js';
import { managedTerminalCommandSchema } from './pty-channel.js';
import { terminalMcpLaunchSchema } from './mcp-launch.js';

process.umask(0o077);
if (!process.send || process.argv.length !== 6 || !/^v24\./.test(process.version))
  throw new Error('Private Node host only');
async function start(): Promise<void> {
  const config = readInteractiveTerminalConfig(process.argv[2]!);
  const rawMcp: unknown = JSON.parse(process.argv[4]!);
  const mcp = rawMcp === null ? undefined : terminalMcpLaunchSchema.parse(rawMcp);
  const policy = z
    .strictObject({ directory: z.string().min(1).max(2048).startsWith('/'), epoch: z.uuid() })
    .parse(JSON.parse(process.argv[5]!));
  if (!!config.interactive?.mcp !== !!mcp) throw new Error('MCP launch composition required');
  const profile = interactiveTerminalProfiles(config, mcp).find(
    (value) => value.id === process.argv[3],
  );
  if (!profile) throw new Error('Unknown fixed terminal profile');
  const receipt = armLifecycleReceipt(4, terminalDigest(terminalFile(process.argv[2]!, true)));
  const { spawn } = createRequire(__filename)(join(__dirname, 'terminal-pty/lib/index.js')) as {
    spawn: typeof spawnPty;
  };
  let child: IPty;
  try {
    const currentEpoch = await new TerminalCliPolicyStore(policy.directory).verifiedEpoch(
      profile,
      interactiveProvider(config),
      config.interactive?.mcp ? 'mcp' : 'tui',
      systemCliSignatureVerifier,
    );
    if (currentEpoch !== policy.epoch)
      throw new Error('CLI authorization changed before PTY spawn');
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
  const started = receipt.record({ type: 'started' });
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
  // Successful PTY creation is OS process evidence, NOT provider readiness or authentication.
  void started
    .then(() => {
      if (!exited) send({ type: 'started' });
    })
    .catch(() => {
      if (process.connected) process.disconnect();
    });
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
}
void start().catch(() => {
  if (process.connected) process.disconnect();
  process.exitCode = 1;
});
