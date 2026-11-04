import { terminalIdentitySchema } from '@orqst/protocol';
// Explicit native Desktop profiles only. External observation never imports this entry.
import { join, relative } from 'node:path';
import { z } from 'zod';
import { terminalToolPath, terminalToolPathSchema } from './local-cli-path.js';
import {
  assertSeparateTerminalState,
  managedCodexConfigSchema,
  managedCodexEnvironment,
  managedCodexProfiles,
  terminalDirectory,
  terminalExecutableSha256,
  terminalFile,
  validateManagedCodexConfig,
  type ManagedCodexConfig,
} from './codex-profile.js';
import { terminalDigest } from './authority.js';
import {
  claudeInteractiveMcpConfiguration,
  reviewedProviderMcpBinaries,
} from './provider-mcp-config.js';
import type { TerminalMcpLaunch } from './mcp-launch.js';
import type { TerminalProfile } from './supervisor.js';

import {
  managedOpenCodeConfigSchema,
  validateManagedOpenCodeConfig,
  openCodeTerminalProfiles,
  openCodeTerminalEnvironment,
  type ManagedOpenCodeConfig,
} from './opencode-profile.js';

const path = z
  .string()
  .min(1)
  .max(2048)
  .startsWith('/')
  .refine((value) => !value.includes('\0'));
const binary = z.strictObject({ path, sha256: z.string().regex(/^[a-f0-9]{64}$/) });
export const managedClaudeConfigSchema = z.strictObject({
  version: z.literal(2),
  provider: z.literal('claude'),
  trust: z.literal('native-same-user'),
  executable: binary,
  executableVersion: z.literal(reviewedProviderMcpBinaries.claude.version),
  node: binary,
  toolPath: terminalToolPathSchema.optional(),
  identity: terminalIdentitySchema.optional(),
  project: path,
  state: path,
  sessionId: z.uuid(),
  authentication: z.strictObject({
    mode: z.literal('reuse-existing'),
    home: path,
    claudeConfigDirectory: path.optional(),
    sharedNativeConfiguration: z.literal(true),
  }),
  interactive: z.strictObject({
    sharedNativeSessions: z.literal(true),
    mcp: z.literal(true).optional(),
    strictMcpAcknowledged: z.literal(true).optional(),
  }),
});
export type ManagedClaudeConfig = z.infer<typeof managedClaudeConfigSchema>;
export type InteractiveTerminalConfig =
  ManagedCodexConfig | ManagedClaudeConfig | ManagedOpenCodeConfig;

export function interactiveProvider(
  config: InteractiveTerminalConfig,
): 'codex' | 'claude' | 'opencode' {
  return config.version !== 1 ? config.provider : 'codex';
}

export function validateManagedClaudeConfig(config: ManagedClaudeConfig): void {
  managedClaudeConfigSchema.parse(config);
  terminalToolPath(config.toolPath);
  if (config.executable.sha256 !== reviewedProviderMcpBinaries.claude.sha256)
    throw new Error('No reviewed launch contract for this exact Claude binary');
  if (!!config.interactive.mcp !== !!config.interactive.strictMcpAcknowledged)
    throw new Error('Claude MCP requires explicit strict-MCP exclusion acknowledgment');
  terminalDirectory(config.project);
  terminalDirectory(config.state, true);
  terminalDirectory(join(config.state, 'tmp'), true);
  assertSeparateTerminalState(config.project, config.state);
  for (const directory of [
    config.authentication.home,
    config.authentication.claudeConfigDirectory,
  ]) {
    if (!directory) continue;
    terminalDirectory(directory);
    const inside = relative(config.state, directory);
    if (inside !== '..' && !inside.startsWith('../'))
      throw new Error('Native identity cannot be inside managed state');
  }
  for (const executable of [config.executable, config.node])
    if (terminalExecutableSha256(executable.path) !== executable.sha256)
      throw new Error('Terminal executable changed');
}

export function readInteractiveTerminalConfig(file: string): InteractiveTerminalConfig {
  const raw: unknown = JSON.parse(terminalFile(file, true).toString('utf8'));
  if (typeof raw === 'object' && raw !== null && 'version' in raw && raw.version === 3) {
    const config = managedOpenCodeConfigSchema.parse(raw);
    validateManagedOpenCodeConfig(config);
    return config;
  }
  if (typeof raw === 'object' && raw !== null && 'version' in raw && raw.version === 2) {
    const config = managedClaudeConfigSchema.parse(raw);
    validateManagedClaudeConfig(config);
    return config;
  }
  const config = managedCodexConfigSchema.parse(raw);
  validateManagedCodexConfig(config);
  return config;
}

export function interactiveTerminalProfiles(
  config: InteractiveTerminalConfig,
  mcp?: TerminalMcpLaunch,
): TerminalProfile[] {
  if (config.version === 1) return managedCodexProfiles(config, mcp);
  if (config.version === 3) return openCodeTerminalProfiles(config, mcp);
  if (!!config.interactive.mcp !== !!mcp || (!!mcp && !config.interactive.strictMcpAcknowledged))
    throw new Error('Claude MCP composition/acknowledgment mismatch');
  if (
    mcp &&
    terminalDigest(terminalFile(mcp.relay.path, false, 16 * 1024 * 1024)) !== mcp.relay.sha256
  )
    throw new Error('MCP relay changed');
  const candidate = mcp
    ? claudeInteractiveMcpConfiguration({
        executableVersion: config.executableVersion,
        executableSha256: config.executable.sha256,
        nodePath: config.node.path,
        sessionId: config.sessionId,
        mcp,
      })
    : undefined;
  return [
    {
      id: 'claude-terminal-v1',
      projectId: terminalDigest(config.project),
      executable: config.executable.path,
      executableSha256: config.executable.sha256,
      executableVersion: config.executableVersion,
      cwd: config.project,
      argv: candidate?.argv ?? ['--session-id', config.sessionId],
      environmentProfile: 'claude-native-identity-no-inherited-credentials-v1',
      permissions:
        `Tool PATH: ${terminalToolPath(config.toolPath)}. ` +
        'Native same-user Claude process, NOT a container or read-only sandbox. Native HOME/config/Keychain identity, hooks, plugins, policy and session writes stay shared. Credential refresh is provider-owned. One dispatch per manifest with a new UUID; existing UUIDs are rejected by the reviewed CLI. No prompt, resume, adoption, permission bypass or automatic login. 30 minute owned-process deadline; no descendant containment. ' +
        (mcp
          ? 'Only supplied MCP servers are selected: native MCP definitions are excluded. Strict startup/project approval can block Claude 2.1.178. ORQST task grant requires separate native authorization. '
          : 'Native MCP definitions may start. ') +
        'Login, native focus, MCP tool/timeout behavior and inference acceptance remain unvalidated.',
    },
  ];
}

export function interactiveTerminalEnvironment(
  config: InteractiveTerminalConfig,
  mcp?: TerminalMcpLaunch,
): Record<string, string> {
  if (config.version === 1) return managedCodexEnvironment(config);
  if (config.version === 3) return openCodeTerminalEnvironment(config, mcp);
  return {
    HOME: config.authentication.home,
    ...(config.authentication.claudeConfigDirectory
      ? { CLAUDE_CONFIG_DIR: config.authentication.claudeConfigDirectory }
      : {}),
    TMPDIR: join(config.state, 'tmp'),
    PATH: terminalToolPath(config.toolPath),
    LANG: 'en_US.UTF-8',
    LC_ALL: 'en_US.UTF-8',
    TERM: 'xterm-256color',
    DISABLE_AUTOUPDATER: '1',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    ...(config.interactive.mcp ? { MCP_TIMEOUT: '10000', MCP_TOOL_TIMEOUT: '125000' } : {}),
  };
}
