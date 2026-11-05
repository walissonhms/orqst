import { serializeInteractiveTerminalConfig } from '../packages/core/src/terminal/interactive-profile.js';
// Provisioning only: no provider execution, native DB/config/credential reads or global writes.
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { terminalExecutableSha256 } from '../packages/core/src/terminal/codex-profile.js';
import {
  managedOpenCodeConfigSchema,
  validateOpenCodeSelection,
  validateManagedOpenCodeConfig,
} from '../packages/core/src/terminal/opencode-profile.js';

if (!/^v24\./.test(process.version)) throw new Error('OpenCode provisioning requires Node 24');
process.umask(0o077);
const { values } = parseArgs({
  options: {
    executable: { type: 'string' },
    'executable-version': { type: 'string' },
    project: { type: 'string' },
    state: { type: 'string' },
    'user-home': { type: 'string' },
    'acknowledge-shared-native-config': { type: 'boolean' },
    'acknowledge-shared-native-sessions': { type: 'boolean' },
    'authorize-native-startup': { type: 'boolean' },
    'acknowledge-database-migrations': { type: 'boolean' },
    'acknowledge-native-startup-activity': { type: 'boolean' },
    'interactive-mcp': { type: 'boolean' },
    'acknowledge-merged-mcp': { type: 'boolean' },
  },
});
if (
  !values.executable ||
  !values['executable-version'] ||
  !values.project ||
  !values.state ||
  !values['acknowledge-shared-native-config'] ||
  !values['acknowledge-shared-native-sessions']
)
  throw new Error(
    'No state created. Required: --executable NATIVE_BINARY --executable-version 2.2.5 --project PROJECT --state NEW_DIRECTORY --acknowledge-shared-native-config --acknowledge-shared-native-sessions. Review manifests remain launch-blocked by default.',
  );
for (const name of ['OPENCODE_TEST_HOME', 'OPENCODE_CONFIG', 'OPENCODE_CONFIG_CONTENT'])
  if (process.env[name] !== undefined)
    throw new Error('No state created. Unreviewed native identity/config-file selector');
const nativeIdentity: Record<string, string> = {
  HOME: values['user-home'] ?? process.env.HOME ?? homedir(),
};
for (const name of [
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_STATE_HOME',
  'XDG_CACHE_HOME',
  'OPENCODE_CONFIG_DIR',
  'OPENCODE_DB',
])
  if (process.env[name] !== undefined) nativeIdentity[name] = process.env[name];
const executable = realpathSync(values.executable);
const node = realpathSync(process.execPath);
const state = join(realpathSync(dirname(resolve(values.state))), basename(resolve(values.state)));
const config = managedOpenCodeConfigSchema.parse({
  version: 3,
  provider: 'opencode',
  trust: 'native-same-user',
  executable: { path: executable, sha256: terminalExecutableSha256(executable) },
  executableVersion: values['executable-version'],
  node: { path: node, sha256: terminalExecutableSha256(node) },
  project: realpathSync(values.project),
  state,
  authentication: { mode: 'reuse-existing', nativeIdentity, sharedNativeConfiguration: true },
  interactive: {
    sharedNativeSessions: true,
    nativeStartupAuthorized: !!values['authorize-native-startup'],
    ...(values['acknowledge-database-migrations']
      ? { nativeDatabaseMigrationsAcknowledged: true }
      : {}),
    ...(values['acknowledge-native-startup-activity']
      ? { nativeStartupActivityAcknowledged: true }
      : {}),
    ...(values['interactive-mcp'] ? { mcp: true } : {}),
    ...(values['acknowledge-merged-mcp'] ? { mergedMcpAcknowledged: true } : {}),
  },
});
validateOpenCodeSelection(config); // All selection/acknowledgment checks precede state creation.
mkdirSync(state, { mode: 0o700 }); // Never overwrite or adopt existing state.
mkdirSync(join(state, 'tmp'), { mode: 0o700 });
validateManagedOpenCodeConfig(config);
writeFileSync(join(state, 'terminal.json'), serializeInteractiveTerminalConfig(config), {
  flag: 'wx',
  mode: 0o600,
});
console.log(
  `Provisioned ${join(state, 'terminal.json')}. No provider executed. Native startup ${config.interactive.nativeStartupAuthorized ? 'opted in; signed Desktop confirmation still required' : 'BLOCKED; explicit startup/migration/activity authorization required'}. No database inspected, no inference acceptance.`,
);
