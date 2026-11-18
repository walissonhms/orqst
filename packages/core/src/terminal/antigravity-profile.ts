import { cliExecutableVersion, hasCliExecutableReview } from './cli-executable-review.js';
import {
  terminalModelArguments,
  terminalModelSelectionSchema,
  validateTerminalModelSelection,
} from './model-selection.js';
import {
  terminalPreparationBindingSchema,
  validateTerminalPreparationBinding,
} from './preparation-context.js';
import { terminalIdentitySchema } from '@orqst/protocol';
// Explicit Desktop opt-in only. Never opens native provider database or credential files.
import { join, relative } from 'node:path';
import { z } from 'zod';
import { terminalToolPath, terminalToolPathSchema } from './local-cli-path.js';
import {
  assertSeparateTerminalState,
  terminalDirectory,
  terminalExecutableSha256,
} from './codex-profile.js';
import { terminalDigest } from './authority.js';
import {
  antigravityInteractiveLaunchPlan,
  reviewedAntigravityBinary,
} from './antigravity-launch-plan.js';
import type { TerminalMcpLaunch } from './mcp-launch.js';
import type { TerminalProfile } from './supervisor.js';

const path = z
  .string()
  .min(1)
  .max(2048)
  .startsWith('/')
  .refine((value) => !value.includes('\0'));
const binary = z.strictObject({ path, sha256: z.string().regex(/^[a-f0-9]{64}$/) });
const managedAntigravityConfig = z.strictObject({
  version: z.literal(4),
  provider: z.literal('antigravity'),
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
  authentication: z.strictObject({
    mode: z.literal('reuse-existing'),
    home: path,
    sharedNativeConfiguration: z.literal(true),
  }),
  interactive: z.strictObject({
    sharedNativeSessions: z.literal(true),
  }),
});
export const managedAntigravityConfigSchema = managedAntigravityConfig.refine(
  (value) =>
    value.preparation !== undefined ||
    (value.executableVersion === reviewedAntigravityBinary.version &&
      value.executable.sha256 === reviewedAntigravityBinary.sha256),
);
export type ManagedAntigravityConfig = z.infer<typeof managedAntigravityConfigSchema>;

/** Also used before provisioning; checks directories only, never ~/.gemini databases or auth. */
export function validateAntigravitySelection(
  config: ManagedAntigravityConfig,
  verifyExecutable = terminalExecutableSha256,
): void {
  managedAntigravityConfigSchema.parse(config);
  if (
    (config.executableVersion !== reviewedAntigravityBinary.version ||
      config.executable.sha256 !== reviewedAntigravityBinary.sha256) &&
    !hasCliExecutableReview('antigravity', config)
  )
    throw new Error('No reviewed antigravity executable');
  validateTerminalModelSelection(config.model);
  validateTerminalPreparationBinding(config.preparation, config.project);
  terminalToolPath(config.toolPath);
  terminalDirectory(config.project);
  assertSeparateTerminalState(config.project, config.state);
  terminalDirectory(config.authentication.home);
  const inside = relative(config.state, config.authentication.home);
  if (inside !== '..' && !inside.startsWith('../'))
    throw new Error('Native identity cannot be inside managed state');
  const nativeGemini = join(config.authentication.home, '.gemini');
  for (const overlap of [
    relative(nativeGemini, config.state),
    relative(config.state, nativeGemini),
  ])
    if (overlap !== '..' && !overlap.startsWith('../'))
      throw new Error('Managed state overlaps native Antigravity state');
  for (const executable of [config.executable, config.node])
    if (verifyExecutable(executable.path) !== executable.sha256)
      throw new Error('Terminal executable changed');
}

export function validateManagedAntigravityConfig(
  config: ManagedAntigravityConfig,
  verifyExecutable = terminalExecutableSha256,
): void {
  validateAntigravitySelection(config, verifyExecutable);
  terminalDirectory(config.state, true);
  terminalDirectory(join(config.state, 'tmp'), true);
}

export function antigravityTerminalEnvironment(
  config: ManagedAntigravityConfig,
  mcp?: TerminalMcpLaunch,
): Record<string, string> {
  if (mcp) throw new Error('Antigravity has no per-session MCP launch contract');
  validateTerminalModelSelection(config.model);
  return {
    ...antigravityInteractiveLaunchPlan(
      {
        executable: config.executable.path,
        executableVersion: config.executableVersion,
        executableSha256: config.executable.sha256,
        project: config.project,
        home: config.authentication.home,
        ...(config.model ? { model: config.model.value } : {}),
      },
      hasCliExecutableReview('antigravity', config),
    ).environment,
    PATH: terminalToolPath(config.toolPath),
    TMPDIR: join(config.state, 'tmp'),
  };
}

export function antigravityTerminalProfiles(
  config: ManagedAntigravityConfig,
  mcp?: TerminalMcpLaunch,
): TerminalProfile[] {
  validateTerminalPreparationBinding(config.preparation, config.project);
  managedAntigravityConfigSchema.parse(config);
  if (mcp) throw new Error('Antigravity has no per-session MCP launch contract');
  const argv = terminalModelArguments(config.model);
  return [
    {
      id: 'antigravity-terminal-v1',
      projectId: terminalDigest(config.project),
      executable: config.executable.path,
      executableSha256: config.executable.sha256,
      executableVersion: config.executableVersion,
      cwd: config.project,
      argv,
      environmentProfile: 'antigravity-native-identity-no-inherited-credentials-v1',
      cliAuthorizationScope: 'antigravity-native-v1:native-mcp-only',
      permissions:
        `Tool PATH: ${terminalToolPath(config.toolPath)}. Native HOME: ${config.authentication.home}. ORQST state: ${config.state}. ` +
        'Native same-user Antigravity (agy), NOT a sandbox. Existing HOME and ~/.gemini configuration, credentials, conversation SQLite database, plugins, skills, hooks and global MCP servers stay shared; no credentials are read or copied by ORQST. Startup writes under ~/.gemini/config and ~/.gemini/antigravity-cli and may refresh credentials or run configured hooks/MCPs. Per-session ORQST MCP relay is UNAVAILABLE because agy 1.5.10 only reads global ~/.gemini/config or workspace .agents plugins. No automatic ORQST prompt, resume, adoption or permission bypass. 30 minute owned-process deadline; no descendant containment. One dispatch per manifest. ' +
        (config.model?.value
          ? `Requested initial CLI model: ${JSON.stringify(config.model.value)} (unverified availability). `
          : '') +
        'Login, native focus and inference acceptance NOT RUN.',
    },
  ];
}
