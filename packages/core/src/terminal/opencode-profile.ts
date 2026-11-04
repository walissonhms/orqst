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
// Explicit Desktop opt-in only. Never opens native provider database or credential files.
import { dirname, join, relative } from 'node:path';
import { z } from 'zod';
import { terminalToolPath, terminalToolPathSchema } from './local-cli-path.js';
import {
  assertSeparateTerminalState,
  terminalDirectory,
  terminalExecutableSha256,
  terminalFile,
} from './codex-profile.js';
import { terminalDigest } from './authority.js';
import {
  opencodeNativeIdentitySchema,
  opencodeInteractiveLaunchPlan,
} from './opencode-launch-plan.js';
import { reviewedProviderMcpBinaries } from './provider-mcp-config.js';
import type { TerminalMcpLaunch } from './mcp-launch.js';
import type { TerminalProfile } from './supervisor.js';

const path = opencodeNativeIdentitySchema.shape.HOME;
const binary = z.strictObject({ path, sha256: z.string().regex(/^[a-f0-9]{64}$/) });
export const managedOpenCodeConfigSchema = z.strictObject({
  version: z.literal(3),
  provider: z.literal('opencode'),
  trust: z.literal('native-same-user'),
  executable: binary.extend({ sha256: z.literal(reviewedProviderMcpBinaries.opencode.sha256) }),
  executableVersion: z.literal(reviewedProviderMcpBinaries.opencode.version),
  node: binary,
  toolPath: terminalToolPathSchema.optional(),
  identity: terminalIdentitySchema.optional(),
  project: path,
  state: path,
  model: z.lazy(() => terminalModelSelectionSchema).optional(),
  preparation: z.lazy(() => terminalPreparationBindingSchema).optional(),
  authentication: z.strictObject({
    mode: z.literal('reuse-existing'),
    nativeIdentity: opencodeNativeIdentitySchema,
    sharedNativeConfiguration: z.literal(true),
  }),
  interactive: z.strictObject({
    sharedNativeSessions: z.literal(true),
    // Provisioning a review manifest is not permission to open writable native SQLite.
    nativeStartupAuthorized: z.boolean(),
    nativeDatabaseMigrationsAcknowledged: z.literal(true).optional(),
    nativeStartupActivityAcknowledged: z.literal(true).optional(),
    mcp: z.literal(true).optional(),
    mergedMcpAcknowledged: z.literal(true).optional(),
  }),
});
export type ManagedOpenCodeConfig = z.infer<typeof managedOpenCodeConfigSchema>;

/** Also used before provisioning; checks directories only, never the DB or its ledger. */
export function validateOpenCodeSelection(config: ManagedOpenCodeConfig): void {
  managedOpenCodeConfigSchema.parse(config);
  validateTerminalModelSelection(config.model);
  validateTerminalPreparationBinding(config.preparation, config.project);
  terminalToolPath(config.toolPath);
  const opted = config.interactive;
  if (
    opted.nativeStartupAuthorized !== !!opted.nativeDatabaseMigrationsAcknowledged ||
    opted.nativeStartupAuthorized !== !!opted.nativeStartupActivityAcknowledged ||
    !!opted.mcp !== !!opted.mergedMcpAcknowledged
  )
    throw new Error('OpenCode startup/MCP acknowledgment mismatch');
  terminalDirectory(config.project);
  assertSeparateTerminalState(config.project, config.state);
  for (const [name, value] of Object.entries(config.authentication.nativeIdentity)) {
    terminalDirectory(name === 'OPENCODE_DB' ? dirname(value) : value);
    const inside = relative(config.state, value);
    if (inside !== '..' && !inside.startsWith('../'))
      throw new Error('Native identity cannot be inside managed state');
  }
  const identity = config.authentication.nativeIdentity;
  // Do not provision inside provider-owned roots, including roots selected by default.
  for (const native of [
    join(identity.XDG_DATA_HOME ?? join(identity.HOME, '.local/share'), 'opencode'),
    join(identity.XDG_CONFIG_HOME ?? join(identity.HOME, '.config'), 'opencode'),
    join(identity.XDG_STATE_HOME ?? join(identity.HOME, '.local/state'), 'opencode'),
    join(identity.XDG_CACHE_HOME ?? join(identity.HOME, '.cache'), 'opencode'),
    ...(identity.OPENCODE_CONFIG_DIR ? [identity.OPENCODE_CONFIG_DIR] : []),
    ...(identity.OPENCODE_DB ? [dirname(identity.OPENCODE_DB)] : []),
  ])
    for (const inside of [relative(native, config.state), relative(config.state, native)])
      if (inside !== '..' && !inside.startsWith('../'))
        throw new Error('Managed state overlaps native OpenCode state');
  for (const executable of [config.executable, config.node])
    if (terminalExecutableSha256(executable.path) !== executable.sha256)
      throw new Error('Terminal executable changed');
}

export function validateManagedOpenCodeConfig(config: ManagedOpenCodeConfig): void {
  validateOpenCodeSelection(config);
  terminalDirectory(config.state, true);
  terminalDirectory(join(config.state, 'tmp'), true);
}

export function openCodeTerminalEnvironment(
  config: ManagedOpenCodeConfig,
  mcp?: TerminalMcpLaunch,
) {
  return {
    ...opencodeInteractiveLaunchPlan({
      executable: config.executable.path,
      executableVersion: config.executableVersion,
      executableSha256: config.executable.sha256,
      project: config.project,
      nativeIdentity: config.authentication.nativeIdentity,
      nodePath: config.node.path,
      ...(mcp ? { mcp } : {}),
    }).environment,
    PATH: terminalToolPath(config.toolPath),
    TMPDIR: join(config.state, 'tmp'),
  };
}

export function openCodeTerminalProfiles(
  config: ManagedOpenCodeConfig,
  mcp?: TerminalMcpLaunch,
): TerminalProfile[] {
  validateTerminalPreparationBinding(config.preparation, config.project);
  managedOpenCodeConfigSchema.parse(config);
  if (
    !config.interactive.nativeStartupAuthorized ||
    !config.interactive.nativeDatabaseMigrationsAcknowledged ||
    !config.interactive.nativeStartupActivityAcknowledged
  )
    throw new Error('OpenCode native startup requires explicit authorization');
  if (!!config.interactive.mcp !== !!mcp || (!!mcp && !config.interactive.mergedMcpAcknowledged))
    throw new Error('OpenCode MCP composition/acknowledgment mismatch');
  if (
    mcp &&
    terminalDigest(terminalFile(mcp.relay.path, false, 16 * 1024 * 1024)) !== mcp.relay.sha256
  )
    throw new Error('MCP relay changed');
  return [
    {
      id: 'opencode-terminal-v1',
      projectId: terminalDigest(config.project),
      executable: config.executable.path,
      executableSha256: config.executable.sha256,
      executableVersion: config.executableVersion,
      cwd: config.project,
      argv: ['--standalone', ...terminalModelArguments(config.model)],
      environmentProfile: 'opencode-native-identity-no-inherited-credentials-v1',
      permissions:
        `Tool PATH: ${terminalToolPath(config.toolPath)}. Native identity selectors: ${JSON.stringify(config.authentication.nativeIdentity)}. ORQST state: ${config.state}. ` +
        'Native same-user OpenCode, NOT a sandbox. Existing HOME/XDG/config/database identity is shared; no credentials are read or copied by ORQST. Startup opens writable SQLite, may change DB/sidecar permissions, WAL/pragmas, apply pending migrations and refresh credentials. Database/ledger NOT inspected; pending migrations UNKNOWN, no rollback guarantee. Native config, plugins, hooks, MCPs and startup activity may execute code/network/provider requests. No automatic ORQST task/login/resume/adoption. --standalone selects a private native server with generated authentication and stdin lease; existing service is not adopted. 30 minute owned TUI deadline; exit proves TUI only, descendant exit and concurrent DB compatibility UNVALIDATED; capacity remains sticky. One dispatch per manifest. ' +
        (mcp
          ? 'Inline ORQST MCP MERGES with native definitions; task grant requires separate native authorization. '
          : '') +
        'Login, new-session routing, native focus, MCP and inference acceptance NOT RUN.',
    },
  ];
}
