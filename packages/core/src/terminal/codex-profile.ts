import { cliAuthorizationScope } from './cli-authorization-scope.js';
import {
  terminalModelSelectionSchema,
  terminalModelArguments,
  validateTerminalModelSelection,
} from './model-selection.js';
import {
  terminalPreparationBindingSchema,
  validateTerminalPreparationBinding,
} from './preparation-context.js';
import { terminalIdentitySchema } from '@orqst/protocol';
import {
  constants,
  closeSync,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, join, parse, relative } from 'node:path';
import { z } from 'zod';
import { terminalToolPath, terminalToolPathSchema } from './local-cli-path.js';
import { terminalDigest } from './authority.js';
import type { TerminalProfile } from './supervisor.js';
import { terminalMcpLaunchSchema, type TerminalMcpLaunch } from './mcp-launch.js';

const path = z.string().min(1).max(2048).refine(isAbsolute);
const binary = z.strictObject({ path, sha256: z.string().regex(/^[a-f0-9]{64}$/) });
export const managedCodexConfigSchema = z.strictObject({
  version: z.literal(1),
  trust: z.literal('native-same-user'),
  executable: binary,
  executableVersion: z.string().min(1).max(64),
  node: binary,
  toolPath: terminalToolPathSchema.optional(),
  identity: terminalIdentitySchema.optional(),
  project: path,
  state: path,
  model: z.lazy(() => terminalModelSelectionSchema).optional(),
  preparation: z.lazy(() => terminalPreparationBindingSchema).optional(),
  interactive: z
    .strictObject({ sharedNativeSessions: z.literal(true), mcp: z.literal(true).optional() })
    .optional(),
  // Optional extension: legacy manifests retain their separate-login behavior.
  authentication: z
    .strictObject({
      mode: z.literal('reuse-existing'),
      home: path,
      codexHome: path,
      sharedNativeConfiguration: z.literal(true),
    })
    .optional(),
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

export function terminalFile(
  path: string,
  privateFile = false,
  maximumBytes = 16 * 1024,
  expected?: { dev: bigint; ino: bigint },
): Buffer {
  const fd = openTerminalFile(path, privateFile, maximumBytes);
  try {
    if (expected) {
      const opened = fstatSync(fd, { bigint: true });
      if (opened.dev !== expected.dev || opened.ino !== expected.ino)
        throw new Error('Terminal file identity changed');
    }
    // Enforce the read budget even if a native writer grows the file after fstat.
    const buffer = Buffer.alloc(maximumBytes + 1);
    let length = 0;
    while (length < buffer.length) {
      const bytes = readSync(fd, buffer, length, buffer.length - length, null);
      if (bytes === 0) break;
      length += bytes;
    }
    if (length > maximumBytes) throw new Error('Terminal file read budget exceeded');
    return buffer.subarray(0, length);
  } finally {
    closeSync(fd);
  }
}

/** Finite native-file budget: reviewed standalone CLIs can exceed 256 MiB. */
export const terminalExecutableMaximumBytes = 512 * 1024 * 1024;

/** Bounded native executable hash; never execute a version/authentication command. */
export function terminalExecutableSha256(path: string): string {
  const fd = openTerminalFile(path, false, terminalExecutableMaximumBytes);
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
      if (position > terminalExecutableMaximumBytes)
        throw new Error('Terminal executable too large');
    }
    if (!position) throw new Error('Empty terminal executable');
    return hash.digest('hex');
  } finally {
    closeSync(fd);
  }
}

export function parseManagedCodexConfigFile(file: string): ManagedCodexConfig {
  return parseManagedCodexConfigBytes(terminalFile(file, true));
}

export function parseManagedCodexConfigBytes(bytes: Buffer): ManagedCodexConfig {
  if (bytes.length > 16 * 1024) throw new Error('Terminal config too large');
  return managedCodexConfigSchema.parse(JSON.parse(bytes.toString('utf8')));
}

export function readManagedCodexConfig(file: string): ManagedCodexConfig {
  const config = parseManagedCodexConfigFile(file);
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
  validateTerminalModelSelection(config.model);
  validateTerminalPreparationBinding(config.preparation, config.project);
  terminalToolPath(config.toolPath);
  terminalDirectory(config.project);
  terminalDirectory(config.state, true);
  assertSeparateTerminalState(config.project, config.state);
  if (config.interactive && !config.authentication)
    throw new Error('Interactive native reuse requires existing authentication');
  if (config.interactive?.mcp && !/^(codex-cli )?0\.162\.1$/.test(config.executableVersion))
    throw new Error('No reviewed interactive MCP configuration for this Codex version');
  if (config.authentication) {
    terminalDirectory(config.authentication.home);
    terminalDirectory(config.authentication.codexHome);
    // Credentials are exclusively the native CLI's responsibility. Check directories only.
    for (const shared of [config.authentication.home, config.authentication.codexHome]) {
      const inside = relative(config.state, shared);
      if (inside !== '..' && !inside.startsWith('../'))
        throw new Error('Existing authentication home cannot be inside managed state');
    }
  }
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

export function managedCodexProfiles(
  config: ManagedCodexConfig,
  mcp?: TerminalMcpLaunch,
): TerminalProfile[] {
  validateTerminalPreparationBinding(config.preparation, config.project);
  if (config.authentication && !config.interactive)
    throw new Error(
      'Existing authentication is supported only by the structured runtime unless interactive native session writes are acknowledged',
    );
  if (mcp && !config.interactive?.mcp) throw new Error('Interactive MCP not opted in');
  if (config.interactive?.mcp && !mcp) throw new Error('Interactive MCP composition required');
  const mcpArguments = mcp ? codexMcpArguments(config, mcp) : [];
  const common = {
    ...cliAuthorizationScope('codex', mcp ? 'mcp' : 'tui', !!config.authentication),
    projectId: terminalDigest(config.project),
    executable: config.executable.path,
    executableSha256: config.executable.sha256,
    executableVersion: config.executableVersion,
    cwd: config.project,
    permissions:
      `Tool PATH: ${terminalToolPath(config.toolPath)}. ` +
      'Native same-user process, NOT a container. Fixed read-only/on-request defaults; provider UI can change permissions. Network for provider/auth. 30 minute owned-process lifetime, then TERM/KILL; no descendant containment. No resume/adoption.',
  };
  if (config.authentication)
    return [
      {
        ...common,
        id: 'codex-terminal-v1',
        argv: [
          ...terminalModelArguments(config.model),
          '--no-daemon',
          '--sandbox',
          'read-only',
          '--ask-for-approval',
          'on-request',
          ...nativeCodexOverrides(config).flatMap((value) => ['-c', value]),
          ...mcpArguments,
        ],
        permissions: `Existing native login, config, MCPs, skills and session root are SHARED. Codex may refresh credentials and write NEW sessions; not ephemeral. No resume/adoption or automatic task. ${mcp ? 'Per-instance ORQST MCP connects to a private local relay; task delegation requires separate native authorization after both starts. Inherited MCPs remain enabled. ' : ''}${common.permissions}`,
      },
    ];
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
        ...terminalModelArguments(config.model),
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

/** Version-scoped inline table; never writes or replaces the user's native MCP configuration. */
function codexMcpArguments(config: ManagedCodexConfig, raw: TerminalMcpLaunch): string[] {
  const mcp = terminalMcpLaunchSchema.parse(raw);
  if (!/^(codex-cli )?0\.162\.1$/.test(config.executableVersion))
    throw new Error('Unreviewed Codex MCP version');
  if (terminalDigest(terminalFile(mcp.relay.path, false, 16 * 1024 * 1024)) !== mcp.relay.sha256)
    throw new Error('MCP relay changed');
  return [
    '-c',
    `mcp_servers.${mcp.serverName}={command=${JSON.stringify(config.node.path)},args=[${JSON.stringify(mcp.relay.path)}],env={ORQST_SOCKET_PATH=${JSON.stringify(mcp.socketPath)},ORQST_CAP_FILE=${JSON.stringify(mcp.capabilityFile)}},startup_timeout_sec=10,tool_timeout_sec=125,required=true}`,
  ];
}

export function managedCodexEnvironment(config: ManagedCodexConfig): Record<string, string> {
  return {
    HOME: config.authentication?.home ?? join(config.state, 'home'),
    CODEX_HOME: config.authentication?.codexHome ?? join(config.state, 'codex'),
    CODEX_SQLITE_HOME: join(config.state, 'codex'),
    TMPDIR: join(config.state, 'tmp'),
    XDG_CONFIG_HOME: join(config.state, 'home/.config'),
    XDG_CACHE_HOME: join(config.state, 'home/.cache'),
    PATH: terminalToolPath(config.toolPath),
    LANG: 'en_US.UTF-8',
    LC_ALL: 'en_US.UTF-8',
    TERM: 'xterm-256color',
  };
}

/** Do not force a credential backend when reusing the native user's identity. */
export function structuredCodexArguments(config: ManagedCodexConfig): string[] {
  if (!config.authentication)
    return ['-c', 'cli_auth_credentials_store="file"', 'app-server', '--listen', 'stdio://'];
  return [
    ...nativeCodexOverrides(config).flatMap((value) => ['-c', value]),
    'app-server',
    '--listen',
    'stdio://',
  ];
}

/** Overrides are not hard containment and do not disable inherited MCP tables. */
function nativeCodexOverrides(config: ManagedCodexConfig): string[] {
  return [
    `sqlite_home=${JSON.stringify(join(config.state, 'codex'))}`,
    `log_dir=${JSON.stringify(join(config.state, 'codex'))}`,
    'history.persistence="none"',
    'analytics.enabled=false',
    'feedback.enabled=false',
    'otel.exporter="none"',
    'otel.trace_exporter="none"',
    'otel.metrics_exporter="none"',
    'check_for_update_on_startup=false',
    'features.hooks=false',
    'features.remote_plugin=false',
    'features.shell_snapshot=false',
    'features.memories=false',
    'features.multi_agent=false',
    'notify=[]',
    'shell_environment_policy.inherit="none"',
  ];
}
