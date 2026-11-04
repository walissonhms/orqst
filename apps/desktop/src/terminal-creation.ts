import { terminalSlotLimit } from '@orqst/protocol';
// Native provisioning only. No process, credential or captured session reads.
import {
  validateTerminalPreparationBinding,
  type TerminalPreparationBinding,
} from '../../../packages/core/src/terminal/preparation-context.js';
import {
  validateTerminalModelSelection,
  type TerminalModelSelection,
} from '../../../packages/core/src/terminal/model-selection.js';
import { randomUUID } from 'node:crypto';
import { lstatSync, mkdirSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import {
  assertSeparateTerminalState,
  managedCodexConfigSchema,
  managedCodexSettings,
  terminalDirectory,
  terminalExecutableSha256,
  validateManagedCodexConfig,
} from '../../../packages/core/src/terminal/codex-profile.js';
import {
  managedClaudeConfigSchema,
  readInteractiveTerminalConfig,
  validateManagedClaudeConfig,
  type InteractiveTerminalConfig,
} from '../../../packages/core/src/terminal/interactive-profile.js';
import {
  managedOpenCodeConfigSchema,
  validateOpenCodeSelection,
  validateManagedOpenCodeConfig,
} from '../../../packages/core/src/terminal/opencode-profile.js';
import { reviewedProviderMcpBinaries } from '../../../packages/core/src/terminal/provider-mcp-config.js';
import {
  localCliPathDirectories,
  legacyTerminalPath,
  terminalToolPath,
} from '../../../packages/core/src/terminal/local-cli-path.js';
import type { LocalCliProvider } from '../../../packages/core/src/terminal/local-cli.js';

// Passive hash of the selected local native candidate; no version/login/provider command run.
export const reviewedDesktopCodexBinary = Object.freeze({
  version: '0.162.1',
  sha256: '74c6a6d263f40d65f99c27a815275f5b4ed0bcc2baecc396b4cf3255498bdfc0',
});

export interface TerminalCreationInput {
  count?: number;
  limit?: number;
  provider: LocalCliProvider;
  executable: string;
  companion?: {
    provider: LocalCliProvider;
    executable: string;
    model?: TerminalModelSelection;
  };
  node: string;
  project: string;
  parent: string;
  home: string;
  environment: NodeJS.ProcessEnv;
  mcp: boolean;
  openCodeStartupAuthorized?: boolean;
  model?: TerminalModelSelection;
  preparation?: TerminalPreparationBinding;
}

export interface TerminalCreationOverview {
  project: string;
  terminals: {
    id: string;
    provider: LocalCliProvider;
    model: string | null;
    role?: 'source' | 'worker';
  }[];
}

function overlaps(a: string, b: string): boolean {
  return [relative(a, b), relative(b, a)].some((path) => path !== '..' && !path.startsWith('../'));
}

/** Complete pre-write plan. Version labels are reviewed contracts, never --version evidence. */
export function prepareTerminalCreation(input: TerminalCreationInput) {
  const count = input.count ?? 2;
  if (!Number.isInteger(count) || count < 1 || count > terminalSlotLimit(input.limit))
    throw new Error('Terminal count exceeds configured capacity');
  if (input.mcp && count !== 2) throw new Error('MCP requires exactly two terminals');
  const members = Array.from({ length: count }, (_, index) =>
    index === 1 && input.companion ? input.companion : input,
  );
  if (
    input.companion &&
    (count !== 2 ||
      [input.provider, input.companion.provider].sort().join(',') !== 'codex,opencode')
  )
    throw new Error('Only the reviewed Codex/OpenCode pair can mix providers');
  if (input.openCodeStartupAuthorized && !members.some(({ provider }) => provider === 'opencode'))
    throw new Error('OpenCode startup consent is provider-specific');
  terminalDirectory(input.project);
  if (!input.preparation && readdirSync(input.project).length)
    throw new Error('Select an empty disposable project');
  const validateModels = () => {
    for (const member of members) validateTerminalModelSelection(member.model);
  };
  validateModels();
  validateTerminalPreparationBinding(input.preparation, input.project);
  const root = join(input.parent, `terminal-pair-${randomUUID()}`);
  const executables = members.map(({ executable }) => ({
    path: executable,
    sha256: terminalExecutableSha256(executable),
  }));
  const node = { path: input.node, sha256: terminalExecutableSha256(input.node) };
  const directories = new Set([input.parent, input.project, input.home]);
  const nativeRoots: string[] = [];
  const tools = localCliPathDirectories(input.environment.PATH ?? legacyTerminalPath, input.home, [
    dirname(input.node),
    ...members.map(({ executable }) => dirname(executable)),
  ]);
  if (tools.inspection !== 'complete') throw new Error('CLI tool PATH review is incomplete');
  const toolPath = terminalToolPath(tools.path);
  const toolDirectoryIdentities = () => {
    terminalToolPath(toolPath);
    return tools.directories.map(({ path }) => {
      const info = lstatSync(path);
      return { path, device: info.dev, inode: info.ino };
    });
  };
  const toolIdentities = JSON.stringify(toolDirectoryIdentities());
  const configs: InteractiveTerminalConfig[] = members.map(({ provider, model }, index) => {
    const slot = String.fromCharCode(65 + index);
    const executable = executables[index]!;
    const common = {
      identity: { terminalId: randomUUID() },
      trust: 'native-same-user',
      executable,
      node,
      toolPath,
      project: input.project,
      ...(model ? { model } : {}),
      ...(input.preparation ? { preparation: input.preparation } : {}),
      state: join(root, slot),
    };
    if (provider === 'codex') {
      if (executable.sha256 !== reviewedDesktopCodexBinary.sha256)
        throw new Error('No reviewed Codex binary');
      const codexHome = input.environment.CODEX_HOME ?? join(input.home, '.codex');
      directories.add(codexHome);
      nativeRoots.push(codexHome);
      return managedCodexConfigSchema.parse({
        ...common,
        version: 1,
        executableVersion: reviewedDesktopCodexBinary.version,
        authentication: {
          mode: 'reuse-existing',
          home: input.home,
          codexHome,
          sharedNativeConfiguration: true,
        },
        interactive: { sharedNativeSessions: true, ...(input.mcp ? { mcp: true } : {}) },
      });
    }
    if (provider === 'claude') {
      if (executable.sha256 !== reviewedProviderMcpBinaries.claude.sha256)
        throw new Error('No reviewed Claude binary');
      const claudeConfigDirectory = input.environment.CLAUDE_CONFIG_DIR;
      if (claudeConfigDirectory !== undefined) directories.add(claudeConfigDirectory);
      nativeRoots.push(claudeConfigDirectory ?? join(input.home, '.claude'));
      return managedClaudeConfigSchema.parse({
        ...common,
        version: 2,
        provider: 'claude',
        executableVersion: reviewedProviderMcpBinaries.claude.version,
        sessionId: randomUUID(),
        authentication: {
          mode: 'reuse-existing',
          home: input.home,
          ...(claudeConfigDirectory !== undefined ? { claudeConfigDirectory } : {}),
          sharedNativeConfiguration: true,
        },
        interactive: {
          sharedNativeSessions: true,
          ...(input.mcp ? { mcp: true, strictMcpAcknowledged: true } : {}),
        },
      });
    }
    for (const name of ['OPENCODE_TEST_HOME', 'OPENCODE_CONFIG', 'OPENCODE_CONFIG_CONTENT'])
      if (input.environment[name] !== undefined) throw new Error('Unsupported OpenCode selector');
    const nativeIdentity: Record<string, string> = { HOME: input.home };
    for (const name of [
      'XDG_CONFIG_HOME',
      'XDG_DATA_HOME',
      'XDG_STATE_HOME',
      'XDG_CACHE_HOME',
      'OPENCODE_CONFIG_DIR',
      'OPENCODE_DB',
    ]) {
      const value = input.environment[name];
      if (value !== undefined) {
        nativeIdentity[name] = value;
        directories.add(name === 'OPENCODE_DB' ? dirname(value) : value);
      }
    }
    const config = managedOpenCodeConfigSchema.parse({
      ...common,
      version: 3,
      provider: 'opencode',
      executableVersion: reviewedProviderMcpBinaries.opencode.version,
      authentication: { mode: 'reuse-existing', nativeIdentity, sharedNativeConfiguration: true },
      interactive: {
        sharedNativeSessions: true,
        nativeStartupAuthorized: input.openCodeStartupAuthorized === true,
        ...(input.openCodeStartupAuthorized
          ? {
              nativeDatabaseMigrationsAcknowledged: true,
              nativeStartupActivityAcknowledged: true,
            }
          : {}),
        ...(input.mcp ? { mcp: true, mergedMcpAcknowledged: true } : {}),
      },
    });
    validateOpenCodeSelection(config);
    return config;
  });
  assertSeparateTerminalState(input.project, root);
  for (const native of nativeRoots)
    if (overlaps(native, root)) throw new Error('Managed state overlaps native provider state');
  const homeInsideState = relative(root, input.home);
  if (homeInsideState !== '..' && !homeInsideState.startsWith('../'))
    throw new Error('Native home cannot be inside managed state');
  const directoryIdentities = () =>
    [...directories].map((path) => {
      terminalDirectory(path);
      const info = lstatSync(path);
      return { path, device: info.dev, inode: info.ino };
    });
  const identities = JSON.stringify(directoryIdentities());
  const snapshot = JSON.stringify(configs);
  const communication = input.mcp
    ? {
        communication: {
          sourceTerminalId: configs[0]!.identity!.terminalId,
          workerTerminalId: configs[1]!.identity!.terminalId,
          separateTaskGrantRequired: true,
        },
      }
    : {};
  // The common PATH is disclosed once; both persisted manifests contain the exact reviewed value.
  const review = JSON.stringify({
    ...communication,
    toolPath,
    terminals: configs.map((config) => {
      const terminal = { ...config };
      delete terminal.toolPath;
      return terminal;
    }),
  });
  // Full compact JSON avoids repeating directory inode metadata in the consent dialog.
  const detail = review.replace(/\p{Cf}/gu, (c) => `\\u{${c.codePointAt(0)!.toString(16)}}`);
  const pages =
    detail.length <= 4096
      ? [detail]
      : configs.map((config) =>
          JSON.stringify({ ...communication, toolPath, terminals: [config] }).replace(
            /\p{Cf}/gu,
            (c) => `\\u{${c.codePointAt(0)!.toString(16)}}`,
          ),
        );
  if (pages.some((page) => page.length > 4096))
    throw new Error('Creation review exceeds native display limit');
  let attempted = false;
  return {
    detail,
    pages,
    overview: {
      project: input.project,
      terminals: configs.map((config, index) => ({
        id: config.identity!.terminalId,
        provider: members[index]!.provider,
        model: config.model?.value ?? null,
        ...(input.mcp ? { role: index === 0 ? ('source' as const) : ('worker' as const) } : {}),
      })),
    } satisfies TerminalCreationOverview,
    root,
    provision(current: () => boolean): string[] {
      if (attempted || !current()) throw new Error('Creation unavailable');
      if (JSON.stringify(directoryIdentities()) !== identities)
        throw new Error('Creation directories changed');
      for (const binary of [...executables, node])
        if (terminalExecutableSha256(binary.path) !== binary.sha256)
          throw new Error('Creation executable changed');
      if (JSON.stringify(toolDirectoryIdentities()) !== toolIdentities)
        throw new Error('Tool PATH directory identity changed');
      if (JSON.stringify(configs) !== snapshot || !current()) throw new Error('Creation changed');
      validateModels();
      validateTerminalPreparationBinding(input.preparation, input.project);
      if (!input.preparation && readdirSync(input.project).length)
        throw new Error('Project is no longer empty');
      attempted = true; // Partial provisioning is retained; never delete/retry uncertain writes.
      const staging = root + '.pending';
      mkdirSync(staging, { mode: 0o700 });
      const files = configs.map((config, slot) => {
        const state = join(staging, String.fromCharCode(65 + slot));
        mkdirSync(state, { mode: 0o700 });
        for (const name of config.version === 1 ? ['home', 'codex', 'tmp'] : ['tmp'])
          mkdirSync(join(state, name), { mode: 0o700 });
        if (config.version === 1)
          writeFileSync(join(state, 'codex/config.toml'), managedCodexSettings(config), {
            flag: 'wx',
            mode: 0o600,
          });
        const stagedConfig = { ...config, state };
        if (stagedConfig.version === 1) validateManagedCodexConfig(stagedConfig);
        else if (stagedConfig.version === 2) validateManagedClaudeConfig(stagedConfig);
        else validateManagedOpenCodeConfig(stagedConfig);
        writeFileSync(join(state, 'terminal.json'), JSON.stringify(config, null, 2) + '\n', {
          flag: 'wx',
          mode: 0o600,
        });
        return join(config.state, 'terminal.json');
      });
      // Publish both completed slots together. Orphans point at the absent final root and fail validation.
      try {
        lstatSync(root);
        throw new Error('Creation destination already exists');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      validateModels();
      validateTerminalPreparationBinding(input.preparation, input.project);
      if (
        !current() ||
        JSON.stringify(directoryIdentities()) !== identities ||
        (!input.preparation && readdirSync(input.project).length)
      )
        throw new Error('Creation expired or changed before publication');
      renameSync(staging, root);
      for (const file of files) readInteractiveTerminalConfig(file);
      return files;
    },
  };
}
