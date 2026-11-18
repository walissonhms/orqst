import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { lstatSync, realpathSync } from 'node:fs';
import { userInfo } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { terminalExecutableSha256 } from '../terminal/codex-profile.js';
import { reviewedClaudeTuiBinary } from '../terminal/interactive-profile.js';
import { processTransport, type StructuredProcessTransport } from './codex-process.js';

/** Reviewed Apple Silicon Claude CLI binary (2.1.318 >= 2.1.259 stream-json host contract). */
export const reviewedStructuredClaudeBinary = reviewedClaudeTuiBinary;

export const structuredClaudePermissionSettings = JSON.stringify({
  disableAllHooks: true,
  permissions: {
    defaultMode: 'default',
    ask: ['Bash', 'Edit', 'Write', 'NotebookEdit', 'WebFetch', 'WebSearch'],
  },
});

export interface ClaudeLaunch {
  executable: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  bare?: boolean;
  sessionId?: string;
}

export interface OwnedClaudeProcess {
  readonly sessionId: string;
  readonly transport: StructuredProcessTransport;
}

const localeKeys = ['LANG', 'LC_ALL', 'LC_CTYPE'] as const;

/**
 * Minimal child environment allowlist for structured Claude sessions.
 * Preserves the user's HOME (and optional absolute CLAUDE_CONFIG_DIR / TMPDIR) while
 * excluding parent API keys, OAuth tokens, host-session sockets, Electron Node flags and OTLP.
 */
export function structuredClaudeEnvironment(
  parent: NodeJS.ProcessEnv,
  overrides: Readonly<Record<string, string>> = {},
): Record<string, string> {
  const env: Record<string, string> = {
    HOME: parent.HOME && isAbsolute(parent.HOME) ? parent.HOME : userInfo().homedir,
    PATH:
      typeof parent.PATH === 'string' && parent.PATH.length > 0 && parent.PATH.length < 8192
        ? parent.PATH
        : '/usr/bin:/bin',
    LANG: 'en_US.UTF-8',
  };
  for (const key of localeKeys) {
    const value = parent[key];
    if (typeof value === 'string' && value.length > 0 && value.length < 256) env[key] = value;
  }
  for (const key of ['TMPDIR', 'CLAUDE_CONFIG_DIR'] as const) {
    const value = parent[key];
    if (typeof value === 'string' && value.length > 0 && value.length < 4096 && isAbsolute(value))
      env[key] = value;
  }
  return {
    ...env,
    DISABLE_AUTOUPDATER: '1',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    DISABLE_TELEMETRY: '1',
    DISABLE_ERROR_REPORTING: '1',
    CLAUDE_CODE_DISABLE_TERMINAL_TITLE: '1',
    CLAUDE_CODE_SKIP_PROMPT_HISTORY: '1',
    ...overrides,
  };
}

export function inspectStructuredClaudeExecutable(
  candidate: string,
  verify: (file: string) => string = terminalExecutableSha256,
):
  | { ok: true; executable: string; version: string; sha256: string }
  | {
      ok: false;
      reason: 'executable_not_found' | 'executable_unreviewed' | 'executable_inspection_failed';
    } {
  if (!candidate || !isAbsolute(candidate)) return { ok: false, reason: 'executable_not_found' };
  let canonical: string;
  try {
    canonical = realpathSync(candidate);
  } catch (error) {
    return {
      ok: false,
      reason:
        (error as NodeJS.ErrnoException).code === 'ENOENT'
          ? 'executable_not_found'
          : 'executable_inspection_failed',
    };
  }
  try {
    const sha256 = verify(canonical);
    if (sha256 !== reviewedStructuredClaudeBinary.sha256)
      return { ok: false, reason: 'executable_unreviewed' };
    return { ok: true, executable: canonical, ...reviewedStructuredClaudeBinary };
  } catch {
    return { ok: false, reason: 'executable_inspection_failed' };
  }
}

export function verifyClaudeManagedConfigAbsent(
  inspect: (path: string) => unknown = lstatSync,
): void {
  const paths =
    process.platform === 'darwin'
      ? [
          '/Library/Application Support/ClaudeCode',
          '/Library/Managed Preferences/com.anthropic.claudecode.plist',
          join(
            '/Library/Managed Preferences',
            userInfo().username,
            'com.anthropic.claudecode.plist',
          ),
        ]
      : ['/etc/claude-code'];
  for (const path of paths) {
    try {
      inspect(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    throw new Error('Claude managed configuration takes precedence over pilot policy');
  }
}

export function structuredClaudeArgs(
  sessionId: string,
  options: { bare?: boolean } = {},
): string[] {
  return [
    '-p',
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    ...(options.bare ? ['--bare'] : ['--setting-sources', 'user']),
    '--session-id',
    sessionId,
    '--no-session-persistence',
    '--permission-mode',
    'default',
    '--permission-prompt-tool',
    'stdio',
    '--permission-prompts',
    'host',
    '--strict-mcp-config',
    '--settings',
    structuredClaudePermissionSettings,
    '--allowedTools',
    'mcp__orqst__orqst_delegate_task',
    '--disallowedTools',
    'Agent,AskUserQuestion',
    '--disable-slash-commands',
    '--no-chrome',
  ];
}

/**
 * Spawn `claude -p --input-format stream-json --output-format stream-json` in an owned
 * POSIX process group. Closing stdin gives an idle session 1.2s to exit cleanly before
 * escalating to SIGTERM and SIGKILL on the process group.
 */
export function spawnClaudeStreamJson(options: ClaudeLaunch): OwnedClaudeProcess {
  if (!isAbsolute(options.executable) || !isAbsolute(options.cwd) || process.platform === 'win32')
    throw new Error('Structured Claude requires absolute paths and POSIX process groups');
  verifyClaudeManagedConfigAbsent();
  const sessionId = options.sessionId ?? randomUUID();
  const args = structuredClaudeArgs(sessionId, { bare: options.bare });
  const child = spawn(options.executable, args, {
    cwd: options.cwd,
    env: structuredClaudeEnvironment(options.env),
    stdio: ['pipe', 'pipe', 'ignore'],
    detached: true,
    windowsHide: true,
  });
  return {
    sessionId,
    transport: processTransport(child, 1200),
  };
}
