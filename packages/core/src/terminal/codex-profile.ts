import {
  constants,
  closeSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, join, parse, relative } from 'node:path';
import { z } from 'zod';
import { terminalDigest } from './authority.js';
import type { TerminalProfile } from './supervisor.js';

const path = z.string().min(1).max(2048).refine(isAbsolute);
const binary = z.strictObject({ path, sha256: z.string().regex(/^[a-f0-9]{64}$/) });
export const managedCodexConfigSchema = z.strictObject({
  version: z.literal(1),
  trust: z.literal('native-same-user'),
  executable: binary,
  executableVersion: z.string().min(1).max(64),
  node: binary,
  project: path,
  state: path,
});
export type ManagedCodexConfig = z.infer<typeof managedCodexConfigSchema>;

export function assertSeparateTerminalState(project: string, state: string): void {
  const inside = relative(project, state);
  if (inside !== '..' && !inside.startsWith('../'))
    throw new Error('Managed state must be outside the project');
}

/** Canonical paths reject symlinks; same-user malicious replacement is outside this contract. */
export function terminalDirectory(path: string, privateDirectory = false): void {
  if (!isAbsolute(path) || realpathSync(path) !== path) throw new Error('Noncanonical directory');
  const info = lstatSync(path);
  if (!info.isDirectory() || info.uid !== process.getuid?.() || info.mode & 0o022)
    throw new Error('Untrusted terminal directory');
  if (privateDirectory && info.mode & 0o077) throw new Error('Terminal state is not private');
  // A writable project is expected; other users must not be able to replace its ancestors.
  let ancestor = dirname(path);
  while (ancestor !== parse(ancestor).root) {
    const parent = lstatSync(ancestor);
    if (parent.mode & 0o022 && !(parent.mode & 0o1000))
      throw new Error('Terminal ancestor is writable by other users');
    ancestor = dirname(ancestor);
  }
}

function openTerminalFile(path: string, privateFile: boolean, maximumBytes: number): number {
  if (!isAbsolute(path) || realpathSync(path) !== path) throw new Error('Noncanonical file');
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = fstatSync(fd);
    if (!info.isFile() || info.size > maximumBytes || info.mode & 0o022)
      throw new Error('Untrusted terminal file');
    if (info.uid !== 0 && info.uid !== process.getuid?.()) throw new Error('Untrusted file owner');
    if (privateFile && (info.uid !== process.getuid?.() || info.mode & 0o077))
      throw new Error('Terminal file is not private');
    let ancestor = dirname(path);
    while (ancestor !== parse(ancestor).root) {
      const parent = lstatSync(ancestor);
      if (parent.mode & 0o022 && !(parent.mode & 0o1000))
        throw new Error('Terminal file ancestor is writable by other users');
      ancestor = dirname(ancestor);
    }
    return fd;
  } catch (error) {
    closeSync(fd);
    throw error;
  }
}

export function terminalFile(path: string, privateFile = false): Buffer {
  const fd = openTerminalFile(path, privateFile, 16 * 1024);
  try {
    return readFileSync(fd);
  } finally {
    closeSync(fd);
  }
}

/** Bounded native executable hash; never execute a version/authentication command. */
export function terminalExecutableSha256(path: string): string {
  const fd = openTerminalFile(path, false, 256 * 1024 * 1024);
  try {
    if (!(fstatSync(fd).mode & 0o111)) throw new Error('Terminal file is not executable');
    const chunk = Buffer.alloc(64 * 1024);
    const hash = createHash('sha256');
    let position = 0;
    let bytes: number;
    while ((bytes = readSync(fd, chunk, 0, chunk.length, position)) !== 0) {
      if (
        position === 0 &&
        process.platform === 'darwin' &&
        ![
          0xfeedface, 0xcefaedfe, 0xfeedfacf, 0xcffaedfe, 0xcafebabe, 0xbebafeca, 0xcafebabf,
          0xbfbafeca,
        ].includes(chunk.readUInt32BE(0))
      )
        throw new Error('Select a native Mach-O executable, not a shell or JavaScript shim');
      hash.update(chunk.subarray(0, bytes));
      position += bytes;
      if (position > 256 * 1024 * 1024) throw new Error('Terminal executable too large');
    }
    if (!position) throw new Error('Empty terminal executable');
    return hash.digest('hex');
  } finally {
    closeSync(fd);
  }
}

export function readManagedCodexConfig(file: string): ManagedCodexConfig {
  const bytes = terminalFile(file, true);
  if (bytes.length > 16 * 1024) throw new Error('Terminal config too large');
  const config = managedCodexConfigSchema.parse(JSON.parse(bytes.toString('utf8')));
  validateManagedCodexConfig(config);
  return config;
}

export function managedCodexSettings(config: ManagedCodexConfig): string {
  return [
    'cli_auth_credentials_store = "file"',
    'sandbox_mode = "read-only"',
    'approval_policy = "on-request"',
    'check_for_update_on_startup = false',
    '[shell_environment_policy]',
    'inherit = "none"',
    `[projects.${JSON.stringify(config.project)}]`,
    'trust_level = "untrusted"',
    '',
  ].join('\n');
}

export function validateManagedCodexConfig(config: ManagedCodexConfig): void {
  managedCodexConfigSchema.parse(config);
  terminalDirectory(config.project);
  terminalDirectory(config.state, true);
  assertSeparateTerminalState(config.project, config.state);
  for (const directory of ['home', 'codex', 'tmp'])
    terminalDirectory(join(config.state, directory), true);
  if (
    terminalFile(join(config.state, 'codex/config.toml'), true).toString('utf8') !==
    managedCodexSettings(config)
  )
    throw new Error('Managed Codex settings changed');
  for (const executable of [config.executable, config.node]) {
    const info = lstatSync(executable.path);
    if (!(info.mode & 0o111) || terminalExecutableSha256(executable.path) !== executable.sha256)
      throw new Error('Terminal executable changed');
  }
}

export function managedCodexProfiles(config: ManagedCodexConfig): TerminalProfile[] {
  const common = {
    projectId: terminalDigest(config.project),
    executable: config.executable.path,
    executableSha256: config.executable.sha256,
    executableVersion: config.executableVersion,
    cwd: config.project,
    environmentProfile: 'managed-home-no-inherited-credentials-v1',
    permissions:
      'Native same-user process, NOT a container. Fixed read-only/on-request defaults; provider UI can change permissions. Network for provider/auth. 30 minute owned-process lifetime, then TERM/KILL; no descendant containment. No resume/adoption.',
  };
  return [
    {
      ...common,
      id: 'codex-login-v1',
      argv: ['-c', 'cli_auth_credentials_store="file"', 'login', '--device-auth'],
      permissions: `Separate device login only. ${common.permissions}`,
    },
    {
      ...common,
      id: 'codex-terminal-v1',
      argv: [
        '--no-daemon',
        '--sandbox',
        'read-only',
        '--ask-for-approval',
        'on-request',
        '-c',
        'cli_auth_credentials_store="file"',
      ],
    },
  ];
}

export function managedCodexEnvironment(config: ManagedCodexConfig): Record<string, string> {
  return {
    HOME: join(config.state, 'home'),
    CODEX_HOME: join(config.state, 'codex'),
    TMPDIR: join(config.state, 'tmp'),
    XDG_CONFIG_HOME: join(config.state, 'home/.config'),
    XDG_CACHE_HOME: join(config.state, 'home/.cache'),
    PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
    LANG: 'en_US.UTF-8',
    LC_ALL: 'en_US.UTF-8',
    TERM: 'xterm-256color',
  };
}
