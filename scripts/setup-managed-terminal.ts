// Provisioning only: never executes the selected binary or reads credentials/history.
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { join, resolve } from 'node:path';
import {
  managedCodexConfigSchema,
  assertSeparateTerminalState,
  managedCodexSettings,
  terminalDirectory,
  terminalExecutableSha256,
  validateManagedCodexConfig,
} from '../packages/core/src/terminal/codex-profile.js';

process.umask(0o077);
const { values } = parseArgs({
  options: {
    executable: { type: 'string' },
    'executable-version': { type: 'string' },
    project: { type: 'string' },
    state: { type: 'string' },
  },
});
if (!values.executable || !values['executable-version'] || !values.project || !values.state)
  throw new Error(
    'Required: --executable ABSOLUTE_NATIVE_BINARY --executable-version VERSION --project PROJECT --state NEW_PRIVATE_DIRECTORY',
  );
const executable = realpathSync(values.executable);
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
});
assertSeparateTerminalState(project, state);
mkdirSync(state, { mode: 0o700 }); // Existing roots are never adopted or overwritten.
for (const directory of ['home', 'codex', 'tmp'])
  mkdirSync(join(state, directory), { mode: 0o700 });
writeFileSync(join(state, 'codex/config.toml'), managedCodexSettings(config), {
  flag: 'wx',
  mode: 0o600,
});
validateManagedCodexConfig(config);
writeFileSync(join(state, 'terminal.json'), JSON.stringify(config, null, 2) + '\n', {
  flag: 'wx',
  mode: 0o600,
});
console.log(
  `Provisioned ${join(state, 'terminal.json')}. No provider executed. Open Desktop with --terminal-config=PATH; login and start require separate native confirmation.`,
);
