import { requireCliGrant } from './terminal/require-cli-grant.js';
import { serializeInteractiveTerminalConfig } from '../packages/core/src/terminal/interactive-profile.js';
// Provisioning only: never executes the selected binary or reads credentials/history.
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import {
  managedCodexConfigSchema,
  assertSeparateTerminalState,
  managedCodexSettings,
  terminalDirectory,
  terminalExecutableSha256,
  validateManagedCodexConfig,
} from '../packages/core/src/terminal/codex-profile.js';
import { discoverLocalClis } from '../packages/core/src/terminal/local-cli.js';

async function main() {
  process.umask(0o077);
  const { values } = parseArgs({
    options: {
      executable: { type: 'string' },
      'cli-policy-directory': { type: 'string' },
      'executable-version': { type: 'string' },
      project: { type: 'string' },
      state: { type: 'string' },
      authentication: { type: 'string', default: 'reuse-existing' },
      'acknowledge-shared-native-config': { type: 'boolean' },
      interactive: { type: 'boolean' },
      'interactive-mcp': { type: 'boolean' },
      'acknowledge-shared-native-sessions': { type: 'boolean' },
      'user-home': { type: 'string' },
      'codex-home': { type: 'string' },
    },
  });
  // Default policy must not silently create a new authentication identity.
  if (
    values.authentication !== 'separate-login' &&
    !(values.authentication === 'reuse-existing' && values['acknowledge-shared-native-config'])
  )
    throw new Error(
      'Existing authentication shares native user configuration and may start configured MCP servers. No state created. Structured reuse requires --acknowledge-shared-native-config; the legacy profile requires --authentication separate-login. Never copy or link credentials.',
    );
  if (
    (values.interactive || values['acknowledge-shared-native-sessions']) &&
    !(
      values.interactive &&
      values['acknowledge-shared-native-sessions'] &&
      values.authentication === 'reuse-existing'
    )
  )
    throw new Error(
      'No state created. --interactive requires reuse-existing and --acknowledge-shared-native-sessions. Codex may write new sessions in its native home.',
    );
  if (values.interactive && !values['cli-policy-directory'])
    throw new Error(
      'No state created. Interactive setup requires --cli-policy-directory and prior native CLI authorization.',
    );
  if (!values['executable-version'] || !values.project || !values.state)
    throw new Error(
      'Required: --executable-version VERSION --project PROJECT --state NEW_PRIVATE_DIRECTORY; --executable ABSOLUTE_NATIVE_BINARY is optional only for a unique PATH candidate',
    );
  if (
    values['interactive-mcp'] &&
    (!values.interactive || !/^(codex-cli )?0\.162\.1$/.test(values['executable-version']))
  )
    throw new Error(
      'No state created. --interactive-mcp requires --interactive and reviewed Codex 0.162.1; synthetic composition only, native acceptance pending.',
    );
  const discovery = values.executable ? undefined : discoverLocalClis(process.env.PATH ?? '')[0]!;
  const candidates = discovery?.candidates ?? [];
  if (!values.executable && (discovery?.inspection !== 'complete' || candidates.length !== 1))
    throw new Error('Select an explicit --executable; PATH has no unique Codex candidate');
  const executable = realpathSync(values.executable ?? candidates[0]!.canonical);
  const node = realpathSync(process.execPath);
  const project = realpathSync(values.project);
  terminalDirectory(project);
  const state = join(
    realpathSync(resolve(values.state, '..')),
    resolve(values.state).split('/').pop()!,
  );
  const config = managedCodexConfigSchema.parse({
    version: 1,
    trust: 'native-same-user',
    executable: { path: executable, sha256: terminalExecutableSha256(executable) },
    executableVersion: values['executable-version'],
    node: { path: node, sha256: terminalExecutableSha256(node) },
    project,
    state,
    ...(values.interactive
      ? {
          interactive: {
            sharedNativeSessions: true,
            ...(values['interactive-mcp'] ? { mcp: true } : {}),
          },
        }
      : {}),
    ...(values.authentication === 'reuse-existing'
      ? {
          authentication: {
            mode: 'reuse-existing',
            home: realpathSync(values['user-home'] ?? homedir()),
            codexHome: realpathSync(
              values['codex-home'] ?? process.env.CODEX_HOME ?? join(homedir(), '.codex'),
            ),
            sharedNativeConfiguration: true,
          },
        }
      : {}),
  });
  if (config.authentication) {
    terminalDirectory(config.authentication.home);
    terminalDirectory(config.authentication.codexHome);
  }
  assertSeparateTerminalState(project, state);
  const binding = values.interactive
    ? await requireCliGrant({
        directory: realpathSync(values['cli-policy-directory']!),
        provider: 'codex',
        mode: values['interactive-mcp'] ? 'mcp' : 'tui',
        executable: config.executable.path,
        version: config.executableVersion,
        sha256: config.executable.sha256,
        project,
      })
    : undefined;
  mkdirSync(state, { mode: 0o700 }); // Existing roots are never adopted or overwritten.
  for (const directory of ['home', 'codex', 'tmp'])
    mkdirSync(join(state, directory), { mode: 0o700 });
  writeFileSync(join(state, 'codex/config.toml'), managedCodexSettings(config), {
    flag: 'wx',
    mode: 0o600,
  });
  validateManagedCodexConfig(config);
  writeFileSync(
    join(state, 'terminal.json'),
    binding
      ? serializeInteractiveTerminalConfig(config, binding)
      : JSON.stringify(config, null, 2) + '\n',
    {
      flag: 'wx',
      mode: 0o600,
    },
  );
  console.log(
    `Provisioned ${join(state, 'terminal.json')}. No provider executed. ${config.authentication ? (config.interactive ? 'Interactive native reuse opt-in: native login/config/session root stay shared. New session writes and credential refresh are possible only after a separately confirmed start. Real-provider compatibility remains unvalidated.' : 'Structured runtime only: native login/config stay shared; no login or credential access performed.') : 'Open Desktop with --terminal-config=PATH; login and start require separate native confirmation.'}`,
  );
}
void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
