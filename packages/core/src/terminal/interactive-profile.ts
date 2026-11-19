import { cliExecutableVersion, hasCliExecutableReview } from './cli-executable-review.js';
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
  cachedTerminalExecutableSha256,
  terminalFile,
  validateManagedCodexConfig,
  type ManagedCodexConfig,
} from './codex-profile.js';
import { terminalDigest } from './authority.js';
import {
  claudeInteractiveMcpConfiguration,
  reviewedProviderMcpBinaries,
  reviewedClaudeMcpBinary,
} from './provider-mcp-config.js';
import type { TerminalMcpLaunch } from './mcp-launch.js';
import type { TerminalProfile } from './supervisor.js';
import { claudeOwnedHooksPath, validateClaudeOwnedHooks } from './owned-claude-hooks.js';

import {
  managedOpenCodeConfigSchema,
  validateManagedOpenCodeConfig,
  openCodeTerminalProfiles,
  openCodeTerminalEnvironment,
  type ManagedOpenCodeConfig,
} from './opencode-profile.js';
import {
  managedAntigravityConfigSchema,
  validateManagedAntigravityConfig,
  antigravityTerminalProfiles,
  antigravityTerminalEnvironment,
  type ManagedAntigravityConfig,
} from './antigravity-profile.js';
export { reviewedAntigravityBinary } from './antigravity-launch-plan.js';

const path = z
  .string()
  .min(1)
  .max(2048)
  .startsWith('/')
  .refine((value) => !value.includes('\0'));
const binary = z.strictObject({ path, sha256: z.string().regex(/^[a-f0-9]{64}$/) });
// Passive TUI review only; this does not revise the independent MCP contract.
// See docs/research/claude-code-tauri.md for source evidence and acceptance limits.
export const reviewedClaudeTuiBinary = Object.freeze({
  version: '2.1.318',
  sha256: '677a2ea7bf576cedd20e191d973914ed8a41796f53a63b1923381ddc4d5b5e7d',
});
const managedClaudeConfig = z.strictObject({
  version: z.literal(2),
  provider: z.literal('claude'),
  trust: z.literal('native-same-user'),
  executable: binary,
  executableVersion: cliExecutableVersion,
  node: binary,
  toolPath: terminalToolPathSchema.optional(),
  identity: terminalIdentitySchema.optional(),
  project: path,
  state: path,
  model: z.lazy(() => terminalModelSelectionSchema).optional(),
  preparation: z.lazy(() => terminalPreparationBindingSchema).optional(),
  sessionId: z.uuid(),
  ownedHooks: z.literal(true).optional(),
  authentication: z.strictObject({
    mode: z.literal('reuse-existing'),
    home: path,
    claudeConfigDirectory: path.optional(),
    sharedNativeConfiguration: z.literal(true),
  }),
  interactive: z
    .strictObject({
      sharedNativeSessions: z.literal(true),
      mcp: z.literal(true).optional(),
      strictMcpAcknowledged: z.literal(true).optional(),
      // Feature-scoped message hub (docs/design/mcp-n-terminals.md) instead of the pair.
      hub: z.literal(true).optional(),
    })
    .refine((value) => !value.hub || value.mcp, 'The message hub requires MCP'),
});
export const managedClaudeConfigSchema = managedClaudeConfig.refine(
  (value) =>
    value.preparation !== undefined ||
    value.executableVersion === reviewedClaudeTuiBinary.version ||
    value.executableVersion === reviewedProviderMcpBinaries.claude.version,
);
export type ManagedClaudeConfig = z.infer<typeof managedClaudeConfigSchema>;
export type InteractiveTerminalConfig =
  ManagedCodexConfig | ManagedClaudeConfig | ManagedOpenCodeConfig | ManagedAntigravityConfig;

export function interactiveProvider(
  config: InteractiveTerminalConfig,
): 'codex' | 'claude' | 'opencode' | 'antigravity' {
  return config.version !== 1 ? config.provider : 'codex';
}

export function interactiveMcp(config: InteractiveTerminalConfig): boolean {
  return config.version !== 4 && !!config.interactive?.mcp;
}

export function interactiveHub(config: InteractiveTerminalConfig): boolean {
  return config.version !== 4 && !!config.interactive?.hub;
}

function validateClaudeLaunchContract(config: ManagedClaudeConfig): boolean {
  const pin = config.interactive.mcp
    ? (reviewedClaudeMcpBinary(config.executableVersion, config.executable.sha256) ??
      reviewedProviderMcpBinaries.claude)
    : config.executableVersion === reviewedClaudeTuiBinary.version
      ? reviewedClaudeTuiBinary
      : reviewedProviderMcpBinaries.claude;
  const updated = hasCliExecutableReview('claude', config);
  if (
    !updated &&
    (config.executableVersion !== pin.version || config.executable.sha256 !== pin.sha256)
  )
    throw new Error(
      config.interactive.mcp
        ? 'No reviewed Claude MCP launch contract for this version/hash'
        : 'No reviewed launch contract for this exact Claude binary version/hash',
    );
  // Owner decision 2026-11-06: hub terminals keep owned hooks together with MCP.
  if (
    config.ownedHooks &&
    ((config.executableVersion !== '2.1.318' && !updated) ||
      (config.interactive.mcp && !config.interactive.hub))
  )
    throw new Error('Owned hooks require the reviewed Claude TUI contract');
  return updated;
}

export function validateManagedClaudeConfig(
  config: ManagedClaudeConfig,
  verifyExecutable = terminalExecutableSha256,
): void {
  managedClaudeConfigSchema.parse(config);
  validateTerminalModelSelection(config.model);
  validateTerminalPreparationBinding(config.preparation, config.project);
  terminalToolPath(config.toolPath);
  validateClaudeLaunchContract(config);
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
    if (verifyExecutable(executable.path) !== executable.sha256)
      throw new Error('Terminal executable changed');
}

export function readInteractiveTerminalConfig(
  file: string,
  verifyExecutable = cachedTerminalExecutableSha256,
): InteractiveTerminalConfig {
  const raw: unknown = JSON.parse(terminalFile(file, true).toString('utf8'));
  if (typeof raw === 'object' && raw !== null && 'version' in raw && raw.version === 4) {
    const config = managedAntigravityConfigSchema.parse(raw);
    validateManagedAntigravityConfig(config, verifyExecutable);
    return config;
  }
  if (typeof raw === 'object' && raw !== null && 'version' in raw && raw.version === 3) {
    const config = managedOpenCodeConfigSchema.parse(raw);
    validateManagedOpenCodeConfig(config, verifyExecutable);
    return config;
  }
  if (typeof raw === 'object' && raw !== null && 'version' in raw && raw.version === 2) {
    const config = managedClaudeConfigSchema.parse(raw);
    validateManagedClaudeConfig(config, verifyExecutable);
    validateClaudeOwnedHooks(config);
    return config;
  }
  const config = managedCodexConfigSchema.parse(raw);
  validateManagedCodexConfig(config, verifyExecutable);
  return config;
}

export function interactiveTerminalProfiles(
  config: InteractiveTerminalConfig,
  mcp?: TerminalMcpLaunch,
): TerminalProfile[] {
  validateTerminalPreparationBinding(config.preparation, config.project);
  if (config.version === 1) return managedCodexProfiles(config, mcp);
  if (config.version === 3) return openCodeTerminalProfiles(config, mcp);
  if (config.version === 4) return antigravityTerminalProfiles(config, mcp);
  const reviewedUpdate = validateClaudeLaunchContract(config);
  validateClaudeOwnedHooks(config);
  if (!!config.interactive.mcp !== !!mcp || (!!mcp && !config.interactive.strictMcpAcknowledged))
    throw new Error('Claude MCP composition/acknowledgment mismatch');
  if (
    mcp &&
    terminalDigest(terminalFile(mcp.relay.path, false, 16 * 1024 * 1024)) !== mcp.relay.sha256
  )
    throw new Error('MCP relay changed');
  const candidate = mcp
    ? claudeInteractiveMcpConfiguration(
        {
          executableVersion: config.executableVersion,
          executableSha256: config.executable.sha256,
          nodePath: config.node.path,
          sessionId: config.sessionId,
          mcp,
        },
        reviewedUpdate,
      )
    : undefined;
  const resume = config.identity?.resumeSessionId;
  if (resume && resume !== config.sessionId) throw new Error('Claude session identity changed');
  const sessionArgs = candidate?.argv ?? ['--session-id', config.sessionId];
  const argv = resume ? [...sessionArgs.slice(0, -2), '--resume', resume] : sessionArgs;
  return [
    {
      id: 'claude-terminal-v1',
      projectId: terminalDigest(config.project),
      executable: config.executable.path,
      executableSha256: config.executable.sha256,
      executableVersion: config.executableVersion,
      cwd: config.project,
      argv: [
        ...argv,
        ...(config.ownedHooks ? ['--settings', claudeOwnedHooksPath(config)] : []),
        ...terminalModelArguments(config.model),
      ],
      environmentProfile: 'claude-native-identity-no-inherited-credentials-v1',
      cliAuthorizationScope: `claude-native-v1:${mcp ? 'orqst-mcp-configured' : 'native-mcp'}${config.ownedHooks ? ':orqst-owned-hooks-v1' : ''}`,
      permissions:
        `Tool PATH: ${terminalToolPath(config.toolPath)}. ` +
        'Native same-user Claude process, NOT a container or read-only sandbox. Native HOME/config/Keychain identity, hooks, plugins, policy and session writes stay shared. Credential refresh is provider-owned. One dispatch per manifest. A reviewed Reopen may request an evidenced conversation. The PTY belongs to the current app run. Starts do not submit a prompt, bypass permissions or log in automatically. ' +
        (config.ownedHooks
          ? 'ORQST adds private metadata-only prompt/notification/stop hooks through an additional owned settings file; existing settings and policy remain effective. '
          : '') +
        (mcp
          ? 'Only supplied MCP servers are selected: native MCP definitions are excluded. Strict startup/project approval can block Claude. ' +
            (config.interactive.hub
              ? 'ORQST messaging: free between terminals of the same Feature, refused across Features; metadata-only audit; content from other terminals is untrusted data. '
              : 'ORQST task grant requires separate native authorization. ')
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
  if (config.version === 4) return antigravityTerminalEnvironment(config, mcp);
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
