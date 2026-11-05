import { fork } from 'node:child_process';
import { join } from 'node:path';
import { closeSync, lstatSync } from 'node:fs';
import { terminalDigest } from './authority.js';
import {
  createLifecycleReceipt,
  readLifecycleReceipt,
} from '../managed-codex/lifecycle-receipt.js';
import type { TerminalBackend, TerminalProfile } from './supervisor.js';
import { terminalFile } from './codex-profile.js';
import {
  interactiveTerminalEnvironment,
  interactiveTerminalProfiles,
  readInteractiveTerminalConfig,
} from './interactive-profile.js';
import { managedTerminalEventSchema } from './pty-channel.js';
import type { TerminalMcpLaunch } from './mcp-launch.js';
import { ownedClaudeSession } from './owned-claude-session.js';

export function managedTerminalBackend(
  file: string,
  host: string,
  mcp?: TerminalMcpLaunch,
): TerminalBackend {
  const config = readInteractiveTerminalConfig(file);
  const expected = interactiveTerminalProfiles(config, mcp);
  const source = terminalFile(file, true);
  let dispatched = false;
  return {
    validate: (profile) => {
      if (config.version !== 1 && dispatched) return false;
      if (!source.equals(terminalFile(file, true))) return false;
      const current = interactiveTerminalProfiles(readInteractiveTerminalConfig(file), mcp);
      if (JSON.stringify(current) !== JSON.stringify(expected)) return false;
      if (!expected.some((value) => JSON.stringify(value) === JSON.stringify(profile)))
        return false;
      // Metadata only: provider owns and reads its credentials. Never import or expose them.
      if (config.version === 1 && profile.id === 'codex-terminal-v1' && !config.authentication) {
        const auth = lstatSync(join(config.state, 'codex/auth.json'));
        if (
          !auth.isFile() ||
          auth.isSymbolicLink() ||
          auth.uid !== process.getuid?.() ||
          auth.mode & 0o077
        )
          return false;
      }
      return true;
    },
    start(profile: Readonly<TerminalProfile>, events, identity) {
      // Repeat at the last synchronous dispatch boundary. Same-user races remain disclosed.
      if (!this.validate(profile)) throw new Error('Managed profile changed');
      if (!identity) throw new Error('PTY lifecycle identity required');
      const sessionEvidence =
        config.version === 2
          ? ownedClaudeSession(config, { ...identity, configDigest: terminalDigest(source) })
          : undefined;
      // Native Claude/OpenCode manifests are single-dispatch, including failed starts.
      dispatched = true;
      const receipt = createLifecycleReceipt(config.state, {
        ...identity,
        configDigest: terminalDigest(source),
      });
      let child;
      try {
        child = fork(host, [file, profile.id, ...(mcp ? [JSON.stringify(mcp)] : [])], {
          execPath: config.node.path,
          execArgv: [],
          cwd: config.state,
          env: interactiveTerminalEnvironment(config, mcp),
          stdio: ['ignore', 'ignore', 'ignore', 'ipc', receipt],
        });
      } finally {
        closeSync(receipt);
      }
      let exited = false;
      let disposed = false;
      const lifecycle = () => {
        const receipt = readLifecycleReceipt(config.state, {
          ...identity,
          configDigest: terminalDigest(source),
        });
        if (!receipt.records) return undefined;
        const start = receipt.records.find((record) => record.type === 'started');
        const exit = receipt.records.find((record) => record.type === 'exit');
        return start ? { startedAt: start.at, ...(exit ? { exitedAt: exit.at } : {}) } : undefined;
      };
      const lost = () => {
        if (!disposed && !exited) events.lost();
      };
      const message = (raw: unknown) => {
        if (disposed) return;
        const parsed = managedTerminalEventSchema.safeParse(raw);
        if (!parsed.success) return lost();
        const value = parsed.data;
        if (value.type === 'started') events.started(lifecycle());
        if (value.type === 'data') events.data(value.text);
        if (value.type === 'exit') {
          exited = true;
          const evidence = lifecycle();
          events.exit(
            value.exitCode,
            value.signal,
            evidence?.exitedAt === undefined
              ? undefined
              : { ...evidence, exitedAt: evidence.exitedAt },
          );
        }
      };
      child.on('message', message);
      child.on('error', lost);
      child.on('disconnect', lost);
      child.on('exit', lost);
      const send = (value: object) => {
        if (disposed || !child.connected || !child.send(value, (error) => error && lost())) {
          lost();
          throw new Error('Managed terminal transport unavailable');
        }
      };
      return {
        ...(sessionEvidence ? { sessionEvidence } : {}),
        write: (text) => send({ action: 'write', text }),
        resize: (columns, rows) => send({ action: 'resize', columns, rows }),
        signal: (signal) => send({ action: 'signal', signal }),
        dispose: () => {
          disposed = true;
          child.off('message', message);
          child.off('disconnect', lost);
          child.off('exit', lost);
          if (child.connected) child.disconnect();
        },
      };
    },
  };
}
