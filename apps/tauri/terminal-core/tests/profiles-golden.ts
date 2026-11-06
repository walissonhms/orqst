// SYNTHETIC golden fixtures for the Rust `profiles` port (lane L2). Evaluates the TypeScript
// functions in packages/core/src/terminal on clearly labeled synthetic files under a fixed
// disposable root and writes tests/golden/profiles.json. No real user file is read, no CLI
// is executed. Run from the repository root:
//   pnpm --filter @orqst/core exec tsx ../../apps/tauri/terminal-core/tests/profiles-golden.ts
import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ZodError } from 'zod';
import { terminalIdentity } from '../../../../packages/core/src/terminal/identity.js';
import {
  managedCodexConfigSchema,
  managedCodexEnvironment,
  managedCodexProfiles,
  managedCodexSettings,
  structuredCodexArguments,
  terminalExecutableSha256,
} from '../../../../packages/core/src/terminal/codex-profile.js';
import {
  interactiveTerminalEnvironment,
  interactiveTerminalProfiles,
  managedClaudeConfigSchema,
  readInteractiveTerminalConfig,
  type InteractiveTerminalConfig,
} from '../../../../packages/core/src/terminal/interactive-profile.js';
import { managedOpenCodeConfigSchema } from '../../../../packages/core/src/terminal/opencode-profile.js';
import { opencodeInteractiveLaunchPlan } from '../../../../packages/core/src/terminal/opencode-launch-plan.js';
import {
  claudeInteractiveMcpConfiguration,
  opencodeInteractiveMcpConfiguration,
} from '../../../../packages/core/src/terminal/provider-mcp-config.js';
import {
  localCliPathDirectories,
  terminalToolPath,
} from '../../../../packages/core/src/terminal/local-cli-path.js';
import {
  discoverLocalClis,
  localCliIntegrationPlan,
} from '../../../../packages/core/src/terminal/local-cli.js';
import {
  interactiveCliAdapter,
  interactiveCliStatus,
} from '../../../../packages/core/src/terminal/interactive-adapters.js';
import {
  discoverTerminalModels,
  openCodeModelConfiguration,
  terminalModelArguments,
  terminalModelSelectionSchema,
  validateTerminalModelSelection,
} from '../../../../packages/core/src/terminal/model-selection.js';
import {
  claudeOwnedHookFiles,
  ownedClaudeHookEvidence,
} from '../../../../packages/core/src/terminal/owned-claude-hooks.js';
import { ownedClaudeSession } from '../../../../packages/core/src/terminal/owned-claude-session.js';
import { inspectManagedTerminalFiles } from '../../../../packages/core/src/terminal/managed-files.js';
import { interactiveProvider } from '../../../../packages/core/src/terminal/interactive-profile.js';
import { managedTerminalBackend } from '../../../../packages/core/src/terminal/pty-backend.js';
import { terminalDigest } from '../../../../packages/core/src/terminal/authority.js';

const NOW = 1_793_959_200_000; // 2026-11-06T10:00:00.000Z, pinned for both languages.
Date.now = () => NOW;
const ROOT = '/private/tmp/orqst-l2-golden';
const OUT = join(dirname(fileURLToPath(import.meta.url)), 'golden', 'profiles.json');

type Fixture = { path: string; mode: number; base64?: string };
const fixtures: Fixture[] = [];
const dir = (path: string, mode = 0o755) => fixtures.push({ path: join(ROOT, path), mode });
const file = (path: string, content: string | Buffer, mode = 0o644) =>
  fixtures.push({
    path: join(ROOT, path),
    mode,
    base64: Buffer.from(content).toString('base64'),
  });
const macho = (name: string) =>
  Buffer.concat([
    Buffer.from([0xcf, 0xfa, 0xed, 0xfe]),
    Buffer.from(`SYNTHETIC ORQST golden fixture executable ${name}; never run\n`),
  ]);
function materialize(list: Fixture[]) {
  rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(ROOT, { mode: 0o755 });
  chmodSync(ROOT, 0o755);
  for (const entry of list) {
    if (entry.base64 === undefined) mkdirSync(entry.path, { mode: entry.mode });
    else writeFileSync(entry.path, Buffer.from(entry.base64, 'base64'));
    chmodSync(entry.path, entry.mode);
  }
}

// ---- Synthetic tree -------------------------------------------------------------------
const pendingModes: [string, number][] = [];
for (const d of ['bin', 'bin2', 'bin-open', 'project', 'project/.codex', 'project/.claude'])
  dir(d);
chmodLater('bin-open', 0o777);
for (const name of ['node', 'codex', 'claude', 'opencode']) file(`bin/${name}`, macho(name), 0o755);
file('bin2/codex', macho('codex-2'), 0o755);
file('bin2/notes.txt', 'SYNTHETIC not executable\n', 0o644);
file('bin/relay.cjs', '// SYNTHETIC ORQST golden relay fixture\n');
file('bin/shim', '#!/bin/sh\n# SYNTHETIC shim\n', 0o755);
file('project/.codex/config.toml', 'model = "gpt-synthetic-project"\n');
file('project/.claude/settings.json', '{"model":"claude-synthetic-project"}');
file('project/opencode.json', JSON.stringify({
  model: { providerID: 'synthetic', model: 'model-a', variant: 'high' },
  provider: { synthetic: { models: { 'model-b': {}, 'model-c': { disabled: true } } } },
  providers: { other: { models: { m1: {} } } },
}));
for (const d of ['home', 'home/.codex', 'home/.claude', 'home/.config', 'home/.config/opencode', 'home/.local', 'home/.local/state', 'home/.local/state/opencode'])
  dir(d);
const CODEX_TOML =
  '# SYNTHETIC\nmodel = "gpt-synthetic-a" # chosen\n\n  model="gpt-synthetic-\\u0062"\nmodel = "bad\ttab"\nmodel = "gpt-after-bad"\n';
file('home/.codex/config.toml', CODEX_TOML);
file(
  'home/.codex/models_cache.json',
  JSON.stringify({
    client_version: '0.162.1',
    fetched_at: new Date(NOW - 60_000).toISOString(),
    models: [
      { slug: 'gpt-synthetic-list', display_name: 'Synthetic List', visibility: 'list' },
      { slug: 'gpt-synthetic-hidden', visibility: 'hide' },
      { slug: 'gpt-synthetic-plain', visibility: 'list' },
    ],
  }),
);
file('home/.claude/settings.json', '{"model":"opus","other":1}');
file(
  'home/.config/opencode/opencode.json',
  JSON.stringify({ model: 'synthetic/model-z', providers: { '2': { models: { x: {} } } } }),
);
file(
  'home/.local/state/opencode/model.json',
  JSON.stringify({
    recent: [{ providerID: 'synthetic', modelID: 'recent-1' }],
    favorite: [{ providerID: 'synthetic', modelID: 'fav-1' }],
    variant: { 'synthetic/fav-1': 'max', 'synthetic/other': 'default' },
  }),
);
for (const s of ['state-codex', 'state-codex2', 'state-native', 'state-claude', 'state-claude2', 'state-opencode', 'manifests'])
  dir(s, 0o700);
for (const s of ['state-codex', 'state-codex2', 'state-native'])
  for (const d of ['home', 'codex', 'tmp']) dir(`${s}/${d}`, 0o700);
for (const s of ['state-claude', 'state-claude2', 'state-opencode']) dir(`${s}/tmp`, 0o700);
file('state-codex/codex/auth.json', '{"synthetic":true}', 0o600);
file('state-codex2/codex/auth.json', '{"synthetic":true}', 0o644);
function chmodLater(path: string, mode: number) {
  pendingModes.push([path, mode]);
}

// Pass 1: materialize executables to learn their hashes.
materialize(fixtures);
const sha = (name: string) => terminalExecutableSha256(join(ROOT, 'bin', name));
const relay = { path: join(ROOT, 'bin/relay.cjs'), sha256: terminalDigest('// SYNTHETIC ORQST golden relay fixture\n') };
const mcp = {
  serverName: 'orqst_0123456789abcdef0123456789abcdef',
  socketPath: join(ROOT, 'state-native/mcp.sock'),
  capabilityFile: join(ROOT, 'state-native/cap "quoted".json'),
  relay,
};
const binary = (name: string) => ({ path: join(ROOT, 'bin', name), sha256: sha(name) });
const codexSeparate = {
  version: 1,
  trust: 'native-same-user',
  executable: binary('codex'),
  executableVersion: 'codex-cli 0.162.1',
  node: binary('node'),
  project: join(ROOT, 'project'),
  state: join(ROOT, 'state-codex'),
};
const codexSeparate2 = { ...codexSeparate, state: join(ROOT, 'state-codex2') };
const codexNative = {
  ...codexSeparate,
  state: join(ROOT, 'state-native'),
  toolPath: join(ROOT, 'bin'),
  interactive: { sharedNativeSessions: true },
  authentication: {
    mode: 'reuse-existing',
    home: join(ROOT, 'home'),
    codexHome: join(ROOT, 'home/.codex'),
    sharedNativeConfiguration: true,
  },
};
const codexMcp = { ...codexNative, interactive: { sharedNativeSessions: true, mcp: true } };
const codexHub = { ...codexNative, interactive: { sharedNativeSessions: true, mcp: true, hub: true } };
const TUI = { version: '2.1.318', sha256: '677a2ea7bf576cedd20e191d973914ed8a41796f53a63b1923381ddc4d5b5e7d' };
const MCP178 = { version: '2.1.178', sha256: '473495d0c15d6616cd0870480db5eb8aa0402fe4f8ead3277a1b521e94110309' };
const claudeBase = {
  version: 2,
  provider: 'claude',
  trust: 'native-same-user',
  executable: { path: join(ROOT, 'bin/claude'), sha256: TUI.sha256 },
  executableVersion: TUI.version,
  node: binary('node'),
  project: join(ROOT, 'project'),
  state: join(ROOT, 'state-claude'),
  sessionId: '2f1c7a9e-3b4d-4c5e-8f60-718293a4b5c6',
  authentication: { mode: 'reuse-existing', home: join(ROOT, 'home'), sharedNativeConfiguration: true },
  interactive: { sharedNativeSessions: true },
};
const claudeHooks = { ...claudeBase, ownedHooks: true };
const claudeHubHooks = {
  ...claudeBase,
  ownedHooks: true,
  state: join(ROOT, 'state-claude2'),
  authentication: { ...claudeBase.authentication, claudeConfigDirectory: join(ROOT, 'home/.claude') },
  interactive: { sharedNativeSessions: true, mcp: true, strictMcpAcknowledged: true, hub: true },
};
const claudeMcp178 = {
  ...claudeBase,
  executable: { path: join(ROOT, 'bin/claude'), sha256: MCP178.sha256 },
  executableVersion: MCP178.version,
  interactive: { sharedNativeSessions: true, mcp: true, strictMcpAcknowledged: true },
};
const OPENCODE_SHA = 'abe4d88594bffb12b364375b8a6732d2d1f7a977195ed1a35c5c76f8e89c9e0e';
const opencodeBase = {
  version: 3,
  provider: 'opencode',
  trust: 'native-same-user',
  executable: { path: join(ROOT, 'bin/opencode'), sha256: OPENCODE_SHA },
  executableVersion: '2.2.5',
  node: binary('node'),
  project: join(ROOT, 'project'),
  state: join(ROOT, 'state-opencode'),
  authentication: {
    mode: 'reuse-existing',
    nativeIdentity: { XDG_STATE_HOME: join(ROOT, 'home/.local/state'), HOME: join(ROOT, 'home') },
    sharedNativeConfiguration: true,
  },
  interactive: {
    sharedNativeSessions: true,
    nativeStartupAuthorized: true,
    nativeDatabaseMigrationsAcknowledged: true,
    nativeStartupActivityAcknowledged: true,
  },
};
const opencodeMcp = {
  ...opencodeBase,
  interactive: { ...opencodeBase.interactive, mcp: true, mergedMcpAcknowledged: true },
};
const opencodeHub = {
  ...opencodeBase,
  interactive: { ...opencodeBase.interactive, mcp: true, mergedMcpAcknowledged: true, hub: true },
};

// Pass 2: generated private files that depend on the configs.
const parse = (config: object) =>
  ('version' in config && config.version === 3
    ? managedOpenCodeConfigSchema.parse(config)
    : 'version' in config && config.version === 2
      ? managedClaudeConfigSchema.parse(config)
      : managedCodexConfigSchema.parse(config)) as InteractiveTerminalConfig;
for (const [config, state] of [[codexSeparate, 'state-codex'], [codexSeparate2, 'state-codex2'], [codexNative, 'state-native']] as const)
  file(`${state}/codex/config.toml`, managedCodexSettings(managedCodexConfigSchema.parse(config)), 0o600);
for (const [config, state] of [[claudeHooks, 'state-claude'], [claudeHubHooks, 'state-claude2']] as const) {
  for (const [name, content] of Object.entries(claudeOwnedHookFiles(managedClaudeConfigSchema.parse(config))))
    file(`${state}/${name}`, content, 0o600);
  file(`${state}/claude-hook-events.jsonl`, '', 0o600);
}
const manifest = (name: string, value: unknown) => file(`manifests/${name}`, typeof value === 'string' ? value : JSON.stringify(value), 0o600);
manifest('codex.json', codexSeparate);
manifest('codex2.json', codexSeparate2);
manifest('native.json', codexNative);
manifest('claude.json', claudeBase);
manifest('broken.json', '{"version":1,');
manifest('unknown-key.json', { ...codexSeparate, extra: true });
manifest('public.json', codexSeparate);
fixtures.at(-1)!.mode = 0o644;
manifest('opencode.json', opencodeBase);
for (const [path, mode] of pendingModes) fixtures.find((f) => f.path === join(ROOT, path))!.mode = mode;
materialize(fixtures);

// ---- Cases -----------------------------------------------------------------------------
type Outcome = { ok: unknown } | { error: { kind: string; message?: string; code?: string } };
function outcome(run: () => unknown): Outcome {
  try {
    const value = run();
    return { ok: value === undefined ? null : value };
  } catch (error) {
    if (error instanceof ZodError || error instanceof SyntaxError) return { error: { kind: 'schema' } };
    const code = (error as NodeJS.ErrnoException).code;
    if (typeof code === 'string') return { error: { kind: 'io', code } };
    return { error: { kind: 'refused', message: (error as Error).message } };
  }
}
const cases: { name: string; fn: string; input: Record<string, unknown>; output: Outcome }[] = [];
const add = (name: string, fn: string, input: Record<string, unknown>, run: () => unknown) =>
  cases.push({ name, fn, input, output: outcome(run) });

add('identity legacy', 'identity', { state: '/x/"state"\n' }, () => terminalIdentity({ state: '/x/"state"\n' }));
add('identity explicit', 'identity', { state: '/x', identity: 'f81d4fae-7dec-41d0-a765-00a0c91e6bf6' }, () =>
  terminalIdentity({ state: '/x', identity: { terminalId: 'f81d4fae-7dec-41d0-a765-00a0c91e6bf6' } }));
add('codex settings', 'codexSettings', { config: { ...codexSeparate, project: '/p/"quoted"\\é' } }, () =>
  managedCodexSettings(managedCodexConfigSchema.parse({ ...codexSeparate, project: '/p/"quoted"\\é' })));
const profiles = (config: object, withMcp?: boolean) =>
  interactiveTerminalProfiles(parse(config), withMcp ? mcp : undefined);
for (const [name, config, withMcp] of [
  ['codex separate login', codexSeparate, false],
  ['codex native', codexNative, false],
  ['codex native mcp', codexMcp, true],
  ['codex native hub', codexHub, true],
  ['codex mcp not opted', codexNative, true],
  ['codex mcp required', codexMcp, false],
  ['codex auth without interactive', { ...codexNative, interactive: undefined }, false],
  ['codex mcp unreviewed version', { ...codexMcp, executableVersion: '0.163.0' }, true],
  ['codex mcp relay changed', codexMcp, 'relay'],
  ['codex native model stale', { ...codexNative, model: { value: 'gpt-synthetic-a', source: 'native-config', files: [{ path: join(ROOT, 'home/.codex/config.toml'), sha256: null }] } }, false],
  ['codex native model', { ...codexNative, model: { value: 'gpt-synthetic-a', source: 'native-config', files: [{ path: join(ROOT, 'home/.codex/config.toml'), sha256: terminalDigest(CODEX_TOML) }, { path: join(ROOT, 'missing.toml'), sha256: null }] } }, false],
  ['codex bad tool path', { ...codexNative, toolPath: join(ROOT, 'bin-open') }, false],
  ['claude tui', claudeBase, false],
  ['claude owned hooks', claudeHooks, false],
  ['claude hub hooks', claudeHubHooks, true],
  ['claude mcp 2.1.178', claudeMcp178, true],
  ['claude mcp mismatch', claudeMcp178, false],
  ['claude unreviewed hash', { ...claudeBase, executable: { path: join(ROOT, 'bin/claude'), sha256: sha('claude') } }, false],
  ['claude mcp unreviewed hash', { ...claudeMcp178, executable: { path: join(ROOT, 'bin/claude'), sha256: sha('claude') } }, true],
  ['claude hooks with pair mcp', { ...claudeMcp178, executableVersion: TUI.version, executable: { path: join(ROOT, 'bin/claude'), sha256: TUI.sha256 }, ownedHooks: true }, true],
  ['claude hooks changed', { ...claudeHooks, node: binary('codex') }, false],
  ['opencode', opencodeBase, false],
  ['opencode mcp', opencodeMcp, true],
  ['opencode hub', opencodeHub, true],
  ['opencode model', { ...opencodeBase, model: { value: 'synthetic/fav-1#max', source: 'native-state', files: [{ path: join(ROOT, 'home/.local/state/opencode/model.json'), openCodeModel: 'synthetic/fav-1#max', sha256: terminalDigest(JSON.stringify(['opencode-model-state', 'synthetic', 'fav-1', 'max'])) }] } }, false],
  ['opencode startup not authorized', { ...opencodeBase, interactive: { sharedNativeSessions: true, nativeStartupAuthorized: false } }, false],
  ['opencode mcp mismatch', opencodeMcp, false],
] as const) {
  const useMcp = withMcp === 'relay' ? { ...mcp, relay: { ...relay, sha256: '0'.repeat(64) } } : withMcp ? mcp : undefined;
  add(name, 'interactiveProfiles', { config, ...(useMcp ? { mcp: useMcp } : {}) }, () =>
    interactiveTerminalProfiles(parse(config), useMcp));
  add(`${name} environment`, 'interactiveEnvironment', { config, ...(useMcp ? { mcp: useMcp } : {}) }, () =>
    Object.entries(interactiveTerminalEnvironment(parse(config), useMcp)));
}
void profiles;
for (const config of [codexSeparate, codexNative])
  add('structured codex arguments', 'structuredCodexArguments', { config }, () =>
    structuredCodexArguments(managedCodexConfigSchema.parse(config)));
add('codex environment direct', 'codexEnvironment', { config: codexSeparate }, () =>
  Object.entries(managedCodexEnvironment(managedCodexConfigSchema.parse(codexSeparate))));
add('codex profiles direct', 'codexProfiles', { config: codexMcp, mcp }, () =>
  managedCodexProfiles(managedCodexConfigSchema.parse(codexMcp), mcp));

for (const name of ['codex.json', 'native.json', 'claude.json', 'broken.json', 'unknown-key.json', 'public.json', 'opencode.json', 'missing.json'])
  add(`read ${name}`, 'readProfiles', { file: join(ROOT, 'manifests', name) }, () =>
    interactiveTerminalProfiles(readInteractiveTerminalConfig(join(ROOT, 'manifests', name))));

const sid = claudeBase.sessionId;
for (const [name, raw] of [
  ['claude mcp review', { executableVersion: MCP178.version, executableSha256: MCP178.sha256, nodePath: '/n', sessionId: sid, mcp }],
  ['claude mcp review 318', { executableVersion: TUI.version, executableSha256: TUI.sha256, nodePath: '/n', sessionId: sid, mcp }],
  ['claude mcp review unreviewed', { executableVersion: '9', executableSha256: TUI.sha256, nodePath: '/n', sessionId: sid, mcp }],
  ['claude mcp review bad uuid', { executableVersion: TUI.version, executableSha256: TUI.sha256, nodePath: '/n', sessionId: 'x', mcp }],
] as const)
  add(name, 'claudeMcp', { raw }, () => claudeInteractiveMcpConfiguration(raw));
for (const [name, raw] of [
  ['opencode mcp review', { executableVersion: '2.2.5', executableSha256: OPENCODE_SHA, nodePath: '/n', mcp }],
  ['opencode mcp review unreviewed', { executableVersion: '2.2.6', executableSha256: OPENCODE_SHA, nodePath: '/n', mcp }],
] as const)
  add(name, 'opencodeMcp', { raw }, () => opencodeInteractiveMcpConfiguration(raw));
const identity = { HOME: '/h', XDG_CONFIG_HOME: '/h/c', OPENCODE_DB: '/h/db/x.db' };
for (const withMcp of [false, true]) {
  const raw = { executable: '/bin/oc', executableVersion: '2.2.5', executableSha256: OPENCODE_SHA, project: '/p', nativeIdentity: identity, nodePath: '/n', ...(withMcp ? { mcp } : {}) };
  add(`opencode launch plan ${withMcp}`, 'opencodeLaunchPlan', { raw }, () => opencodeInteractiveLaunchPlan(raw));
}

const bin = join(ROOT, 'bin');
const bin2 = join(ROOT, 'bin2');
const open = join(ROOT, 'bin-open');
for (const [name, searchPath, home, selected] of [
  ['path explicit env', `${bin}:relative:${open}:${bin}/:${join(ROOT, 'missing')}:${bin2}`, undefined, []],
  ['path gui minimal', '/usr/bin:/bin/', undefined, [bin2]],
  ['path selected unsafe', '', undefined, [open]],
  ['path selected noncanonical', '', undefined, [`${bin}/`]],
  ['path home relative', '', 'relative-home', []],
] as const) {
  add(name, 'pathDirectories', { searchPath, home, selected }, () => localCliPathDirectories(searchPath, home, selected));
  add(`${name} discovery`, 'discoverClis', { searchPath, home, selected }, () =>
    discoverLocalClis(searchPath, home, selected).map((d) => [d, localCliIntegrationPlan(d)]));
}
for (const reviewed of [undefined, bin, `${bin}:${bin2}`, `${bin}:${bin}`, `${bin}/`, open, '/', 'relative', `${bin}::${bin2}`, join(ROOT, 'missing'), ''])
  add(`tool path ${String(reviewed)}`, 'toolPath', reviewed === undefined ? {} : { reviewed }, () => terminalToolPath(reviewed));
for (const provider of ['codex', 'claude', 'opencode'] as const) {
  add(`status ${provider}`, 'cliStatus', { provider }, () => interactiveCliStatus(provider));
  for (const authentication of ['reuse-existing', 'separate-login'] as const)
    for (const ack of [false, true])
      add(`adapter ${provider} ${authentication} ${ack}`, 'adapter', { provider, authentication, ack }, () => {
        interactiveCliAdapter(provider, authentication, ack);
        return null;
      });
}

const home = join(ROOT, 'home');
const project = join(ROOT, 'project');
for (const [provider, environment] of [
  ['codex', {}],
  ['claude', {}],
  ['opencode', {}],
  ['opencode', { OPENCODE_CONFIG_DIR: join(ROOT, 'project'), XDG_STATE_HOME: join(ROOT, 'missing') }],
  ['codex', { CODEX_HOME: 'relative' }],
] as const) {
  const name = `models ${provider} ${JSON.stringify(environment)}`;
  add(name, 'discoverModels', { provider, project, home, environment }, () =>
    discoverTerminalModels(provider, project, home, environment));
  const discovered = outcome(() => discoverTerminalModels(provider, project, home, environment));
  if ('ok' in discovered)
    for (const option of (discovered.ok as { options: { selection: unknown }[] }).options) {
      const selection = terminalModelSelectionSchema.parse(option.selection);
      add(`${name} validate`, 'validateModel', { selection }, () => validateTerminalModelSelection(selection));
      add(`${name} arguments`, 'modelArguments', { selection }, () => terminalModelArguments(selection));
      add(`${name} opencode`, 'openCodeModel', { selection }, () => openCodeModelConfiguration(selection));
    }
}
const cacheSelection = { value: 'gpt-synthetic-list', source: 'cli-cache', expiresAt: NOW - 1, files: [{ path: join(ROOT, 'home/.codex/models_cache.json'), codexModel: 'gpt-synthetic-list', sha256: null }] };
add('model expired', 'validateModel', { selection: cacheSelection }, () => validateTerminalModelSelection(cacheSelection as never));
const wrongSha = { value: null, source: 'cli-default', files: [{ path: join(ROOT, 'home/.claude/settings.json'), sha256: '0'.repeat(64) }] };
add('model changed', 'validateModel', { selection: wrongSha }, () => validateTerminalModelSelection(wrongSha as never));
const badValue = { value: 'synthetic-no-slash', source: 'cli-default', files: [{ path: join(ROOT, 'missing'), sha256: null }] };
add('opencode bad value', 'openCodeModel', { selection: badValue }, () => openCodeModelConfiguration(badValue as never));

for (const config of [claudeHooks, claudeHubHooks])
  add('hook files', 'hookFiles', { config }, () => Object.entries(claudeOwnedHookFiles(managedClaudeConfigSchema.parse(config))));

for (const [name, list, limit] of [
  ['inspect pair', ['codex.json', 'codex2.json'], undefined],
  ['inspect native', ['native.json'], undefined],
  ['inspect duplicate', ['codex.json', 'codex.json'], 3],
  ['inspect capacity', ['codex.json', 'codex2.json', 'native.json'], undefined],
  ['inspect bad limit', ['codex.json'], 9],
  ['inspect empty', [], undefined],
] as const) {
  const files = list.map((n) => join(ROOT, 'manifests', n));
  add(name, 'inspectFiles', { files, ...(limit ? { limit } : {}) }, () =>
    inspectManagedTerminalFiles(files, limit).map(({ config, blocker }) => ({
      provider: interactiveProvider(config),
      terminalId: terminalIdentity(config).terminalId,
      blocker: blocker ?? null,
    })));
}

// Stateful readers: both languages write the same step contents, then poll.
const channel = join(ROOT, 'state-claude/claude-hook-events.jsonl');
const record = (promptId: string, event: string) =>
  JSON.stringify({ version: 1, sessionId: sid, promptId, event, at: NOW }) + '\n';
const p1 = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const p2 = 'b1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const hookSteps = [
  '',
  record(p1, 'prompt'),
  record(p1, 'prompt') + record(p1, 'progress'),
  record(p1, 'prompt') + record(p1, 'progress') + record(p1, 'permission_prompt'),
  record(p1, 'prompt') + record(p1, 'progress') + record(p1, 'permission_prompt') + record(p1, 'stop'),
  record(p1, 'prompt') + record(p1, 'progress') + record(p1, 'permission_prompt') + record(p1, 'stop') + record(p2, 'prompt') + '{"partial',
];
{
  const results: unknown[] = [];
  writeFileSync(channel, '');
  const poll = outcome(() => ownedClaudeHookEvidence(managedClaudeConfigSchema.parse(claudeHooks)));
  if ('ok' in poll) {
    const evidence = poll.ok as () => unknown;
    for (const step of hookSteps) {
      writeFileSync(channel, step);
      results.push(evidence());
    }
  }
  writeFileSync(channel, '');
  cases.push({ name: 'hook evidence', fn: 'hookEvidence', input: { config: claudeHooks, steps: hookSteps }, output: { ok: results } });
}
{
  const transcriptDir = join(home, '.claude/projects', project.replace(/[^a-zA-Z0-9-]/g, '-'));
  const line = (value: object) => JSON.stringify({ sessionId: sid, cwd: project, ...value }) + '\n';
  const u1 = 'c1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
  const assistant = (content: unknown[], stop: string | null, extra = {}) =>
    line({ type: 'assistant', timestamp: '2026-11-06T09:59:00.123Z', message: { content, stop_reason: stop }, ...extra });
  const s1 = line({ type: 'user', uuid: u1, message: { content: 'SYNTHETIC prompt' } });
  const s2 = s1 + assistant([{ type: 'tool_use', name: 'Read' }, { type: 'tool_use', name: 'sk-abcdefghijklmnop' }], 'tool_use');
  const s3 = s2 + assistant([{ type: 'tool_use', name: 'AskUserQuestion' }], 'tool_use');
  const s4 = s3 + assistant([{ type: 'text', text: 'SYNTHETIC done' }], 'end_turn') + '{"partial';
  const s5 = s3 + assistant([{ type: 'text', text: 'SYNTHETIC done' }], 'end_turn');
  const steps = [null, s1, s2, s3, s4, s5];
  const binding = {
    instanceId: 'd1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
    epoch: 'e1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
    manifestDigest: 'a'.repeat(64),
    configDigest: 'b'.repeat(64),
  };
  const results: unknown[] = [];
  const reader = ownedClaudeSession(managedClaudeConfigSchema.parse(claudeBase), binding);
  mkdirSync(transcriptDir, { recursive: true, mode: 0o755 });
  for (const step of steps) {
    if (step !== null) writeFileSync(join(transcriptDir, `${sid}.jsonl`), step, { mode: 0o600 });
    results.push(reader ? (reader() ?? null) : 'no-reader');
  }
  rmSync(join(home, '.claude/projects'), { recursive: true, force: true });
  rmSync(join(ROOT, `state-claude/session-binding-${binding.instanceId}.json`), { force: true });
  cases.push({ name: 'claude session', fn: 'claudeSession', input: { config: claudeBase, binding, steps }, output: { ok: results } });
}

for (const [name, manifestName, index, mutate] of [
  ['backend codex login profile', 'codex.json', 0, false],
  ['backend codex terminal profile', 'codex.json', 1, false],
  ['backend codex mutated', 'codex.json', 1, true],
  ['backend codex public auth', 'codex2.json', 1, false],
  ['backend native', 'native.json', 0, false],
] as const) {
  const path = join(ROOT, 'manifests', manifestName);
  const backend = managedTerminalBackend(path, '/nonexistent-host');
  const expected = interactiveTerminalProfiles(readInteractiveTerminalConfig(path));
  const profile = mutate ? { ...expected[index]!, argv: [] } : expected[index]!;
  add(name, 'backendValidate', { file: path, profile: JSON.stringify(profile) }, () => backend.validate(profile));
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(
  OUT,
  JSON.stringify({ synthetic: true, now: NOW, root: ROOT, fixtures, cases }, null, 1) + '\n',
);
rmSync(ROOT, { recursive: true, force: true });
console.log(`wrote ${cases.length} synthetic golden cases to ${OUT}`);
