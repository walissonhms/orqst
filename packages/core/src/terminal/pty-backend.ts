import { z } from 'zod';
import {
  createKernelLifecycleReceipt,
  type KernelProcessIdentity,
} from '../managed-codex/kernel-lifecycle-receipt.js';
import { fork } from 'node:child_process';
import { join } from 'node:path';
import { closeSync, lstatSync } from 'node:fs';
import { terminalDigest } from './authority.js';
import { createLifecycleReceipt } from '../managed-codex/lifecycle-receipt.js';
import type { TerminalBackend, TerminalProfile } from './supervisor.js';
import { terminalFile } from './codex-profile.js';
import {
  interactiveTerminalEnvironment,
  interactiveTerminalProfiles,
  readInteractiveTerminalConfig,
} from './interactive-profile.js';
import { managedTerminalEventSchema } from './pty-channel.js';
import type { TerminalMcpLaunch } from './mcp-launch.js';

export function managedTerminalBackend(
  file: string,
  host: string,
  mcp?: TerminalMcpLaunch,
  kernel?: { owner: string; query(pid: number): Promise<KernelProcessIdentity> },
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
      // Native Claude/OpenCode manifests are single-dispatch, including failed starts.
      dispatched = true;
      const receipt = createLifecycleReceipt(config.state, {
        ...identity,
        configDigest: terminalDigest(source),
      });
      let kernelReceipt: ReturnType<typeof createKernelLifecycleReceipt> | undefined;
      try {
        kernelReceipt = kernel
          ? createKernelLifecycleReceipt(config.state, {
              ...identity,
              owner: kernel.owner,
              configDigest: terminalDigest(source),
            })
          : undefined;
      } catch (error) {
        closeSync(receipt);
        throw error;
      }
      let child;
      try {
        child = fork(
          host,
          [
            file,
            profile.id,
            ...(mcp ? [JSON.stringify(mcp)] : []),
            ...(kernel ? ['--kernel-receipt'] : []),
          ],
          {
            execPath: config.node.path,
            execArgv: [],
            cwd: config.state,
            env: interactiveTerminalEnvironment(config, mcp),
            stdio: ['ignore', 'ignore', 'ignore', 'ipc', receipt],
          },
        );
      } catch (error) {
        kernelReceipt?.close();
        throw error;
      } finally {
        closeSync(receipt);
      }
      let kernelPhase: 'awaiting' | 'host-query' | 'leader' | 'leader-query' | 'done' = 'awaiting';
      let receiptClosed = false;
      const closeKernelReceipt = () => {
        if (!receiptClosed) {
          receiptClosed = true;
          kernelReceipt?.close();
        }
      };
      let exited = false;
      let disposed = false;
      const lost = () => {
        closeKernelReceipt();
        if (!disposed && !exited) events.lost();
      };
      const message = (raw: unknown) => {
        if (disposed) return;
        if (kernel && kernelReceipt) {
          const awaiting = z.strictObject({ type: z.literal('awaiting-spawn') }).safeParse(raw);
          const leader = z
            .strictObject({
              type: z.literal('kernel-identity-request'),
              pid: z.number().int().positive().max(2_147_483_647),
            })
            .safeParse(raw);
          if (awaiting.success && kernelPhase === 'awaiting' && child.pid) {
            kernelPhase = 'host-query';
            void kernel
              .query(child.pid)
              .then((identity) => {
                if (
                  disposed ||
                  receiptClosed ||
                  identity.pid !== child.pid ||
                  identity.ppid !== process.pid ||
                  identity.uid !== process.getuid?.()
                )
                  throw new Error('Host identity unavailable');
                kernelReceipt.host(identity);
                kernelPhase = 'leader';
                send({ action: 'spawn' });
              })
              .catch(lost);
            return;
          }
          if (leader.success && kernelPhase === 'leader') {
            kernelPhase = 'leader-query';
            void kernel
              .query(leader.data.pid)
              .then((identity) => {
                if (disposed || receiptClosed) throw new Error('Leader identity unavailable');
                kernelReceipt.leader(identity);
                kernelPhase = 'done';
                closeKernelReceipt();
                send({ action: 'kernel-identity-confirmed' });
              })
              .catch(() => {
                closeKernelReceipt();
                try {
                  send({ action: 'kernel-identity-unavailable' });
                } catch {
                  lost();
                }
              });
            return;
          }
        }
        const parsed = managedTerminalEventSchema.safeParse(raw);
        if (!parsed.success) return lost();
        const value = parsed.data;
        if (value.type === 'started') events.started();
        if (value.type === 'data') events.data(value.text);
        if (value.type === 'exit') {
          exited = true;
          events.exit(value.exitCode, value.signal);
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
        write: (text) => send({ action: 'write', text }),
        resize: (columns, rows) => send({ action: 'resize', columns, rows }),
        signal: (signal) => send({ action: 'signal', signal }),
        dispose: () => {
          disposed = true;
          closeKernelReceipt();
          child.off('message', message);
          child.off('disconnect', lost);
          child.off('exit', lost);
          if (child.connected) child.disconnect();
        },
      };
    },
  };
}
