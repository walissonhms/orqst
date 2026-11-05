import { serializeInteractiveTerminalConfig } from '../packages/core/src/terminal/interactive-profile.js';
// Provisioning only; never executes a provider or reads native credentials/configuration/sessions.
import { randomUUID } from 'node:crypto';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  assertSeparateTerminalState,
  terminalDirectory,
  terminalExecutableSha256,
} from '../packages/core/src/terminal/codex-profile.js';
import {
  managedClaudeConfigSchema,
  validateManagedClaudeConfig,
} from '../packages/core/src/terminal/interactive-profile.js';
import { reviewedProviderMcpBinaries } from '../packages/core/src/terminal/provider-mcp-config.js';

if (!/^v24\./.test(process.version))
  throw new Error('Claude terminal provisioning requires Node 24');
process.umask(0o077);
const { values } = parseArgs({
  options: {
    executable: { type: 'string' },
    'executable-version': { type: 'string' },
    project: { type: 'string' },
    state: { type: 'string' },
    'user-home': { type: 'string' },
    'claude-config-directory': { type: 'string' },
    'acknowledge-shared-native-config': { type: 'boolean' },
    'acknowledge-shared-native-sessions': { type: 'boolean' },
    'interactive-mcp': { type: 'boolean' },
    'acknowledge-strict-mcp': { type: 'boolean' },
  },
});
if (
  !values.executable ||
  values['executable-version'] !== reviewedProviderMcpBinaries.claude.version ||
  !values.project ||
  !values.state ||
  !values['acknowledge-shared-native-config'] ||
  !values['acknowledge-shared-native-sessions']
)
  throw new Error(
    'No state created. Required: --executable NATIVE_BINARY --executable-version 2.1.178 --project PROJECT --state NEW_DIRECTORY --acknowledge-shared-native-config --acknowledge-shared-native-sessions. Native identity/configuration/hooks/plugins and new session writes stay shared; no sandbox or automatic login.',
  );
if (!!values['interactive-mcp'] !== !!values['acknowledge-strict-mcp'])
  throw new Error(
    'No state created. --interactive-mcp and --acknowledge-strict-mcp must be selected together. Strict selection excludes native MCP definitions; project/enterprise approvals can still block this version.',
  );
const executable = realpathSync(values.executable);
const executableHash = terminalExecutableSha256(executable);
if (executableHash !== reviewedProviderMcpBinaries.claude.sha256)
  throw new Error('No state created. Claude binary has no exact reviewed launch contract.');
const node = realpathSync(process.execPath);
const project = realpathSync(values.project);
const state = join(realpathSync(dirname(resolve(values.state))), basename(resolve(values.state)));
const nativeConfig = values['claude-config-directory'] ?? process.env.CLAUDE_CONFIG_DIR;
const config = managedClaudeConfigSchema.parse({
  version: 2,
  provider: 'claude',
  trust: 'native-same-user',
  executable: { path: executable, sha256: executableHash },
  executableVersion: values['executable-version'],
  node: { path: node, sha256: terminalExecutableSha256(node) },
  project,
  state,
  sessionId: randomUUID(),
  authentication: {
    mode: 'reuse-existing',
    home: realpathSync(values['user-home'] ?? homedir()),
    ...(nativeConfig ? { claudeConfigDirectory: realpathSync(nativeConfig) } : {}),
    sharedNativeConfiguration: true,
  },
  interactive: {
    sharedNativeSessions: true,
    ...(values['interactive-mcp'] ? { mcp: true, strictMcpAcknowledged: true } : {}),
  },
});
terminalDirectory(project);
terminalDirectory(config.authentication.home);
if (config.authentication.claudeConfigDirectory)
  terminalDirectory(config.authentication.claudeConfigDirectory);
assertSeparateTerminalState(project, state);
mkdirSync(state, { mode: 0o700 }); // Never adopt/overwrite an existing directory.
mkdirSync(join(state, 'tmp'), { mode: 0o700 });
validateManagedClaudeConfig(config);
writeFileSync(join(state, 'terminal.json'), serializeInteractiveTerminalConfig(config), {
  flag: 'wx',
  mode: 0o600,
});
console.log(
  `Provisioned ${join(state, 'terminal.json')}. No provider executed. Open Desktop with --terminal-config=PATH; one new UUID and one dispatch per manifest. Native start confirmation remains required. Login/MCP/inference acceptance pending.`,
);
