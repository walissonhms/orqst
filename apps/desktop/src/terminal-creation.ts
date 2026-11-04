// Native-menu provisioning only. No process, credential, native config or session reads.
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
  provider: LocalCliProvider;
  executable: string;
  node: string;
  project: string;
  parent: string;
  home: string;
  environment: NodeJS.ProcessEnv;
  mcp: boolean;
}

function overlaps(a: string, b: string): boolean {
  return [relative(a, b), relative(b, a)].some((path) => path !== '..' && !path.startsWith('../'));
}

/** Complete pre-write plan. Version labels are reviewed contracts, never --version evidence. */
export function prepareTerminalCreation(input: TerminalCreationInput) {
  terminalDirectory(input.project);
  if (readdirSync(input.project).length) throw new Error('Select an empty disposable project');
  const root = join(input.parent, `terminal-pair-${randomUUID()}`);
  const executable = {
    path: input.executable,
    sha256: terminalExecutableSha256(input.executable),
  };
  const node = { path: input.node, sha256: terminalExecutableSha256(input.node) };
  const directories = new Set([input.parent, input.project, input.home]);
  const nativeRoots: string[] = [];
  const tools = localCliPathDirectories(input.environment.PATH ?? legacyTerminalPath, input.home, [
    dirname(input.node),
    dirname(input.executable),
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
  const configs: InteractiveTerminalConfig[] = ['A', 'B'].map((slot) => {
    const common = {
      trust: 'native-same-user',
      executable,
      node,
      toolPath,
      project: input.project,
      state: join(root, slot),
    };
    if (input.provider === 'codex') {
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
    if (input.provider === 'claude') {
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
        nativeStartupAuthorized: false,
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
  // The common PATH is disclosed once; both persisted manifests contain the exact reviewed value.
  const review = JSON.stringify({
    toolPath,
    terminals: configs.map((config) => {
      const terminal = { ...config };
      delete terminal.toolPath;
      return terminal;
    }),
  });
  // Full compact JSON avoids repeating directory inode metadata in the consent dialog.
  const detail = review.replace(/\p{Cf}/gu, (c) => `\\u{${c.codePointAt(0)!.toString(16)}}`);
  if (detail.length > 4096) throw new Error('Creation review exceeds native display limit');
  let attempted = false;
  return {
    detail,
    root,
    provision(current: () => boolean): string[] {
      if (attempted || !current()) throw new Error('Creation unavailable');
      if (JSON.stringify(directoryIdentities()) !== identities)
        throw new Error('Creation directories changed');
      for (const binary of [executable, node])
        if (terminalExecutableSha256(binary.path) !== binary.sha256)
          throw new Error('Creation executable changed');
      if (JSON.stringify(toolDirectoryIdentities()) !== toolIdentities)
        throw new Error('Tool PATH directory identity changed');
      if (JSON.stringify(configs) !== snapshot || !current()) throw new Error('Creation changed');
      if (readdirSync(input.project).length) throw new Error('Project is no longer empty');
      attempted = true; // Partial provisioning is retained; never delete/retry uncertain writes.
      const staging = root + '.pending';
      mkdirSync(staging, { mode: 0o700 });
      const files = configs.map((config) => {
        const state = join(staging, config.state.endsWith('/A') ? 'A' : 'B');
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
      if (
        !current() ||
        JSON.stringify(directoryIdentities()) !== identities ||
        readdirSync(input.project).length
      )
        throw new Error('Creation expired or changed before publication');
      renameSync(staging, root);
      for (const file of files) readInteractiveTerminalConfig(file);
      return files;
    },
  };
}
