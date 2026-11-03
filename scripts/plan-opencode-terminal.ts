// Explicit passive review only. Never executes OpenCode or opens native configuration/databases.
import { lstatSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute } from 'node:path';
import { parseArgs } from 'node:util';
import {
  terminalDirectory,
  terminalExecutableSha256,
  terminalFile,
} from '../packages/core/src/terminal/codex-profile.js';
import { terminalDigest } from '../packages/core/src/terminal/authority.js';
import { opencodeInteractiveLaunchPlan } from '../packages/core/src/terminal/opencode-launch-plan.js';
import { reviewedProviderMcpBinaries } from '../packages/core/src/terminal/provider-mcp-config.js';

if (!/^v24\./.test(process.version)) throw new Error('OpenCode review requires Node 24');
const { values } = parseArgs({
  options: {
    executable: { type: 'string' },
    'executable-version': { type: 'string' },
    project: { type: 'string' },
    'user-home': { type: 'string' },
    relay: { type: 'string' },
    socket: { type: 'string' },
    'capability-file': { type: 'string' },
  },
});
if (!values.executable || !values.project || !values['executable-version'])
  throw new Error(
    'Required: --executable NATIVE_BINARY --executable-version 2.2.5 --project PROJECT',
  );
const executable = realpathSync(values.executable);
const hash = terminalExecutableSha256(executable);
if (
  values['executable-version'] !== reviewedProviderMcpBinaries.opencode.version ||
  hash !== reviewedProviderMcpBinaries.opencode.sha256
)
  throw new Error('No reviewed plan for this exact OpenCode binary/version');
const identity: Record<string, string> = {
  HOME: realpathSync(values['user-home'] ?? homedir()),
};
for (const name of [
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_STATE_HOME',
  'XDG_CACHE_HOME',
  'OPENCODE_CONFIG_DIR',
  'OPENCODE_DB',
]) {
  const selected = process.env[name];
  if (selected === undefined) continue;
  if (!isAbsolute(selected)) throw new Error(`Native identity selector ${name} must be absolute`);
  if (name === 'OPENCODE_DB') {
    const metadata = lstatSync(selected); // Never open/hash the database: it contains credentials.
    if (!metadata.isFile() || metadata.isSymbolicLink())
      throw new Error('Native database selector must name a regular file');
    identity[name] = selected;
  } else identity[name] = realpathSync(selected);
}
for (const [name, directory] of Object.entries(identity))
  if (name !== 'OPENCODE_DB') terminalDirectory(directory);
if (
  process.env.OPENCODE_TEST_HOME !== undefined ||
  process.env.OPENCODE_CONFIG !== undefined ||
  process.env.OPENCODE_CONFIG_CONTENT !== undefined
)
  throw new Error('Unreviewed native identity/config-file selector; no execution or state created');
const project = realpathSync(values.project);
terminalDirectory(project);
const relayFields = [values.relay, values.socket, values['capability-file']];
if (relayFields.some(Boolean) && !relayFields.every(Boolean))
  throw new Error('Optional MCP review requires --relay, --socket and --capability-file together');
const relay = values.relay ? realpathSync(values.relay) : undefined;
console.log(
  JSON.stringify(
    opencodeInteractiveLaunchPlan({
      executable,
      executableVersion: values['executable-version'],
      executableSha256: hash,
      project,
      nativeIdentity: identity,
      nodePath: realpathSync(process.execPath),
      ...(relay
        ? {
            mcp: {
              serverName: 'orqst_' + hash.slice(0, 32),
              socketPath: values.socket,
              capabilityFile: values['capability-file'],
              relay: {
                path: relay,
                sha256: terminalDigest(terminalFile(relay, false, 16 * 1024 * 1024)),
              },
            },
          }
        : {}),
    }),
    null,
    2,
  ),
);
