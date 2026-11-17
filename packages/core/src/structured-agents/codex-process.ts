import { spawn, type ChildProcess } from 'node:child_process';
import { isAbsolute } from 'node:path';
import type { CodexTransport } from '../managed-codex/channel.js';

/** Exact exit facts reported by Node for the owned child; never inferred. */
export interface StructuredProcessExit {
  code: number | null;
  signal: string | null;
}
export interface StructuredProcessTransport extends CodexTransport {
  readonly pid: number | undefined;
  readonly exited: Promise<StructuredProcessExit>;
  /** Close stdin, TERM the owned process group, then KILL after the grace period. */
  terminate(graceMs?: number): Promise<StructuredProcessExit>;
}

/**
 * Environment forwarded to the provider. Secrets from the parent (API keys, tokens, auth
 * sockets, loader variables) are not forwarded; the native CLI loads its own login.
 */
const forwarded = [
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'PATH',
  'TMPDIR',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'CODEX_HOME',
] as const;
export function structuredCodexEnvironment(
  parent: NodeJS.ProcessEnv,
  overrides: Readonly<Record<string, string>> = {},
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of forwarded) {
    const value = parent[key];
    if (typeof value === 'string' && value.length > 0 && value.length < 8192) env[key] = value;
  }
  return { ...env, ...overrides };
}

const live = new Set<StructuredProcessTransport>();
let exitHookInstalled = false;
function installExitHook(): void {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  // Best effort: if Core exits without a graceful stop, kill each owned group synchronously.
  process.once('exit', () => {
    for (const transport of live) transport.signal('SIGKILL');
  });
}

/**
 * Spawn `codex app-server --listen stdio://` in its own process group. stdout carries only
 * structured JSON lines; stderr is discarded (never persisted as diagnostics or content).
 */
export function spawnCodexAppServer(options: {
  executable: string;
  cwd: string;
  env: Record<string, string>;
}): StructuredProcessTransport {
  if (!isAbsolute(options.executable) || !isAbsolute(options.cwd))
    throw new Error('Structured Codex requires absolute executable and project paths');
  if (process.platform === 'win32') throw new Error('POSIX process groups required');
  const args = [
    'app-server',
    '--listen',
    'stdio://',
    '-c',
    'mcp_servers={}',
    '-c',
    'analytics.enabled=false',
    '--disable',
    'multi_agent',
    '--disable',
    'multi_agent_v2',
    '--disable',
    'apps',
    '--disable',
    'plugins',
    '--disable',
    'hooks',
  ];
  const child = spawn(options.executable, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ['pipe', 'pipe', 'ignore'],
    detached: true,
    windowsHide: true,
  });
  return processTransport(child);
}

/** Exported for synthetic tests that spawn a labeled fake app-server instead of Codex. */
export function processTransport(child: ChildProcess, eofGraceMs = 0): StructuredProcessTransport {
  let exitFacts: StructuredProcessExit | undefined;
  let listening: { data(chunk: Uint8Array): void; lost(): void } | undefined;
  let detached = false;
  const groupSignal = (signal: 'SIGTERM' | 'SIGKILL') => {
    if (child.pid === undefined) return;
    try {
      process.kill(-child.pid, signal);
    } catch {
      if (!exitFacts) {
        try {
          child.kill(signal);
        } catch {
          // The child can exit while the signal is being delivered.
        }
      }
    }
  };
  const exited = new Promise<StructuredProcessExit>((resolve) => {
    const finish = (code: number | null, signal: string | null) => {
      if (exitFacts) return;
      exitFacts = { code, signal };
      // The leader can exit independently of the tool children in its group.
      groupSignal('SIGKILL');
      live.delete(transport);
      resolve(exitFacts);
      listening?.lost();
    };
    child.once('exit', finish);
    child.once('error', () => finish(null, null));
  });
  let termination: Promise<StructuredProcessExit> | undefined;
  const transport: StructuredProcessTransport = {
    pid: child.pid,
    exited,
    send(line) {
      if (detached || !child.stdin || child.stdin.destroyed) throw new Error('stdin unavailable');
      if (child.stdin.writableLength > 64 * 1024) throw new Error('stdin backlog');
      child.stdin.write(line);
    },
    listen(data, lost) {
      listening = { data, lost };
      const onData = (chunk: Buffer) => listening?.data(chunk);
      child.stdout?.on('data', onData);
      child.stdin?.on('error', () => listening?.lost());
      child.stdout?.once('end', () => listening?.lost());
      child.stdout?.on('error', () => listening?.lost());
      return () => {
        child.stdout?.off('data', onData);
        listening = undefined;
      };
    },
    signal: groupSignal,
    detach() {
      detached = true;
      listening = undefined;
    },
    terminate(graceMs = 1500) {
      if (exitFacts) return exited;
      if (!termination) {
        child.stdin?.end();
        const term = eofGraceMs ? setTimeout(() => groupSignal('SIGTERM'), eofGraceMs) : undefined;
        if (!term) groupSignal('SIGTERM');
        const timer = setTimeout(() => groupSignal('SIGKILL'), eofGraceMs + graceMs);
        termination = exited.finally(() => {
          clearTimeout(term);
          clearTimeout(timer);
        });
      }
      return termination;
    },
  };
  live.add(transport);
  installExitHook();
  return transport;
}
