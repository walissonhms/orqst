// Synthetic-only profile and provisioning checks; never invokes OpenCode or native storage.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { TerminalAuthority } from '../packages/core/src/terminal/authority.js';
import { TerminalSupervisor, terminalPolicy } from '../packages/core/src/terminal/supervisor.js';
import { TerminalNativeBroker } from '../packages/core/src/terminal/native-broker.js';
import { createRequire } from 'node:module';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { build, type PluginBuild } from 'esbuild';
import {
  managedCodexSettings,
  terminalExecutableSha256,
  type ManagedCodexConfig,
} from '../packages/core/src/terminal/codex-profile.js';
import { terminalDigest } from '../packages/core/src/terminal/authority.js';
import {
  managedOpenCodeConfigSchema,
  openCodeTerminalProfiles,
  openCodeTerminalEnvironment,
} from '../packages/core/src/terminal/opencode-profile.js';
import { reviewedProviderMcpBinaries } from '../packages/core/src/terminal/provider-mcp-config.js';
import type { TerminalSelection } from '../apps/desktop/src/terminal-selection.js';

function configFixture() {
  return managedOpenCodeConfigSchema.parse({
    version: 3,
    provider: 'opencode',
    trust: 'native-same-user',
    executable: {
      path: '/synthetic/opencode',
      sha256: reviewedProviderMcpBinaries.opencode.sha256,
    },
    executableVersion: '2.2.5',
    node: { path: '/synthetic/node', sha256: 'a'.repeat(64) },
    project: '/synthetic/project',
    state: '/synthetic/private-state',
    authentication: {
      mode: 'reuse-existing',
      sharedNativeConfiguration: true,
      nativeIdentity: {
        HOME: '/synthetic/home',
        XDG_DATA_HOME: '/synthetic/data',
        XDG_CONFIG_HOME: '/synthetic/config',
        XDG_STATE_HOME: '/synthetic/state',
        XDG_CACHE_HOME: '/synthetic/cache',
        OPENCODE_DB: '/synthetic/data/native.db',
        OPENCODE_CONFIG_DIR: '/synthetic/config/native',
      },
    },
    interactive: { sharedNativeSessions: true, nativeStartupAuthorized: false },
  });
}

test('OpenCode execution requires all startup acknowledgments and preserves exact identity selectors', () => {
  const config = configFixture();
  assert.throws(() => openCodeTerminalProfiles(config), /authorization/);
  config.interactive.nativeStartupAuthorized = true;
  assert.throws(() => openCodeTerminalProfiles(config), /authorization/);
  config.interactive.nativeDatabaseMigrationsAcknowledged = true;
  assert.throws(() => openCodeTerminalProfiles(config), /authorization/);
  config.interactive.nativeStartupActivityAcknowledged = true;
  const profile = openCodeTerminalProfiles(config)[0]!;
  assert.deepEqual(profile.argv, ['--standalone']);
  assert.match(profile.permissions, /pending migrations UNKNOWN/);
  assert.match(profile.permissions, /exit proves TUI only/);
  const environment = openCodeTerminalEnvironment(config);
  for (const [key, value] of Object.entries(config.authentication.nativeIdentity))
    assert.equal(environment[key as keyof typeof environment], value);
  assert.deepEqual(
    Object.keys(environment).sort(),
    [
      ...Object.keys(config.authentication.nativeIdentity),
      'TMPDIR',
      'PATH',
      'LANG',
      'LC_ALL',
      'TERM',
    ].sort(),
  );
  for (const extra of [
    { argv: ['--resume'] },
    { token: 'SYNTHETIC' },
    { executableVersion: 'future' },
    { authentication: { ...config.authentication, nativeIdentity: { HOME: 'relative' } } },
  ])
    assert.throws(() => managedOpenCodeConfigSchema.parse({ ...config, ...extra }));
});

test('OpenCode MCP factory produces v2 inline environment and rejects composition/relay drift', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'orqst-opencode-mcp-fixture-')));
  try {
    const config = configFixture();
    config.interactive = {
      sharedNativeSessions: true,
      nativeStartupAuthorized: true,
      nativeDatabaseMigrationsAcknowledged: true,
      nativeStartupActivityAcknowledged: true,
      mcp: true,
      mergedMcpAcknowledged: true,
    };
    const relay = join(root, 'relay.cjs');
    writeFileSync(relay, '// SYNTHETIC relay, never executed here\n', { mode: 0o600 });
    const mcp = {
      serverName: 'orqst_' + 'a'.repeat(32),
      socketPath: join(root, 'absent.sock'),
      capabilityFile: join(root, 'absent.cap'),
      relay: { path: relay, sha256: terminalDigest(readFileSync(relay)) },
    };
    assert.throws(() => openCodeTerminalProfiles(config), /mismatch/);
    assert.equal(openCodeTerminalProfiles(config, mcp)[0]!.id, 'opencode-terminal-v1');
    const environment = openCodeTerminalEnvironment(config, mcp);
    const server = JSON.parse(environment.OPENCODE_CONFIG_CONTENT!).mcp.servers[mcp.serverName];
    assert.deepEqual(server.command, [config.node.path, relay]);
    assert.deepEqual(server.timeout, { startup: 10000, catalog: 10000, execution: 125000 });
    assert.equal(server.protocol, 'legacy');
    writeFileSync(relay, '// SYNTHETIC drift\n');
    assert.throws(() => openCodeTerminalProfiles(config, mcp), /changed/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('OpenCode provisioning defaults to blocked review; rejects invalid grants before creating state', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'orqst-opencode-setup-fixture-')));
  try {
    const home = join(root, 'native-home'),
      project = join(root, 'project');
    for (const path of [home, project]) mkdirSync(path, { mode: 0o700 });
    const db = join(home, 'SYNTHETIC-UNREADABLE.db');
    writeFileSync(db, 'SYNTHETIC-NEVER-OPEN', { mode: 0o000 });
    const node = realpathSync(process.execPath);
    const plugin = {
      name: 'synthetic-node-hash-only',
      setup(builder: PluginBuild) {
        builder.onLoad({ filter: /provider-mcp-config\.ts$/ }, (args) => ({
          contents: readFileSync(args.path, 'utf8').replace(
            reviewedProviderMcpBinaries.opencode.sha256,
            terminalExecutableSha256(node),
          ),
          loader: 'ts',
        }));
      },
    };
    const setup = join(root, 'setup.cjs'),
      driver = join(root, 'driver.cjs'),
      selectionDriver = join(root, 'selection.cjs');
    for (const [entry, outfile] of [
      ['scripts/setup-opencode-terminal.ts', setup],
      ['packages/core/src/terminal/managed-files.ts', driver],
      ['apps/desktop/src/terminal-selection.ts', selectionDriver],
    ] as const)
      await build({
        entryPoints: [entry],
        outfile,
        bundle: true,
        platform: 'node',
        format: 'cjs',
        target: 'node24',
        plugins: [plugin],
        logLevel: 'silent',
      });
    const state = join(root, 'review');
    const args = [
      setup,
      '--executable',
      node,
      '--executable-version',
      '2.2.5',
      '--project',
      project,
      '--state',
      state,
      '--acknowledge-shared-native-config',
      '--acknowledge-shared-native-sessions',
    ];
    const env = { HOME: home, OPENCODE_DB: db };
    const before = readdirSync(root, { recursive: true });
    for (const flags of [
      ['--authorize-native-startup'],
      ['--acknowledge-database-migrations'],
      ['--interactive-mcp'],
    ])
      assert.throws(() => execFileSync(node, [...args, ...flags], { env, stdio: 'pipe' }));
    for (const rejected of [
      { OPENCODE_CONFIG: db },
      { OPENCODE_CONFIG_CONTENT: '{}' },
      { OPENCODE_TEST_HOME: home },
      { XDG_DATA_HOME: 'relative' },
    ])
      assert.throws(() =>
        execFileSync(node, args, { env: { ...env, ...rejected }, stdio: 'pipe' }),
      );
    assert.deepEqual(readdirSync(root, { recursive: true }), before);
    execFileSync(node, args, { env, stdio: 'pipe' });
    const inspect = createRequire(import.meta.url)(
      driver,
    ) as typeof import('../packages/core/src/terminal/managed-files.js');
    const selected = inspect.inspectManagedTerminalFiles([join(state, 'terminal.json')])[0]!;
    assert.equal(selected.blocker, 'opencode_startup_required');
    assert.equal(readdirSync(state).includes('terminal.sqlite'), false);
    assert.equal(readdirSync(state).includes('desktop-communication.sqlite'), false);
    const selectionModule = createRequire(import.meta.url)(selectionDriver) as {
      TerminalSelection: typeof TerminalSelection;
      inspectTerminalSelection: typeof import('../apps/desktop/src/terminal-selection.js').inspectTerminalSelection;
    };
    const selection = new selectionModule.TerminalSelection();
    assert.equal(
      await selection.review({
        current: () => true,
        choose: async () => [join(state, 'terminal.json')],
        confirm: async (detail) => {
          const reviewed = JSON.parse(detail)[0];
          assert.equal(reviewed.blocker, 'opencode_startup_required');
          assert.equal(reviewed.config.interactive.nativeStartupAuthorized, false);
          assert.equal(reviewed.config.authentication.nativeIdentity.OPENCODE_DB, db);
          return true;
        },
      }),
      'reviewed',
    );
    assert.deepEqual(selection.take(), [join(state, 'terminal.json')]);
    assert.deepEqual(readdirSync(state).sort(), ['terminal.json', 'tmp']);
    assert.throws(() => execFileSync(node, args, { env, stdio: 'pipe' })); // No adoption.
    const authorized = join(root, 'authorized');
    execFileSync(
      node,
      args
        .map((value) => (value === state ? authorized : value))
        .concat([
          '--authorize-native-startup',
          '--acknowledge-database-migrations',
          '--acknowledge-native-startup-activity',
        ]),
      { env, stdio: 'pipe' },
    );
    assert.equal(
      inspect.inspectManagedTerminalFiles([join(authorized, 'terminal.json')])[0]!.blocker,
      undefined,
    );
    assert.equal(
      JSON.parse(
        selectionModule.inspectTerminalSelection([
          join(state, 'terminal.json'),
          join(authorized, 'terminal.json'),
        ]).detail,
      ).length,
      2,
    );
    // A valid Codex reuse manifest remains a different provider, even with the same binary pin.
    const codexState = join(root, 'codex-review');
    mkdirSync(codexState, { mode: 0o700 });
    for (const name of ['tmp', 'home', 'codex']) mkdirSync(join(codexState, name), { mode: 0o700 });
    const codexFile = join(codexState, 'terminal.json');
    const codexConfig: ManagedCodexConfig = {
      version: 1,
      trust: 'native-same-user',
      executable: { path: node, sha256: terminalExecutableSha256(node) },
      node: { path: node, sha256: terminalExecutableSha256(node) },
      executableVersion: 'SYNTHETIC',
      project,
      state: codexState,
      authentication: {
        mode: 'reuse-existing',
        home,
        codexHome: home,
        sharedNativeConfiguration: true,
      },
    };
    writeFileSync(join(codexState, 'codex/config.toml'), managedCodexSettings(codexConfig), {
      mode: 0o600,
    });
    writeFileSync(codexFile, JSON.stringify(codexConfig), { mode: 0o600 });
    assert.throws(
      () => selectionModule.inspectTerminalSelection([join(state, 'terminal.json'), codexFile]),
      /one provider/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('OpenCode native broker requires focused confirmation before dispatch and presents the selected identity', async () => {
  const config = configFixture();
  config.interactive = {
    sharedNativeSessions: true,
    nativeStartupAuthorized: true,
    nativeDatabaseMigrationsAcknowledged: true,
    nativeStartupActivityAcknowledged: true,
  };
  const profile = openCodeTerminalProfiles(config)[0]!;
  const keys = generateKeyPairSync('ed25519');
  const authority = new TerminalAuthority(new Map([['desktop-managed', keys.publicKey]]));
  let starts = 0,
    focused = false,
    accept = false,
    confirmations = 0;
  const supervisor = new TerminalSupervisor(
    authority,
    {
      validate: () => true,
      start: (_profile, events) => {
        starts++;
        events.started();
        return { write() {}, resize() {}, signal() {}, dispose() {} };
      },
    },
    [profile],
  );
  const document = {};
  const broker = new TerminalNativeBroker(
    authority,
    supervisor,
    'desktop-managed',
    keys.privateKey,
    document,
    {
      current: (_document, requireFocus) => !requireFocus || focused,
      confirm: async (_document, details) => {
        confirmations++;
        assert.match(details.profile.permissions, /SYNTHETIC|synthetic/);
        assert.ok(
          details.profile.permissions.includes(config.authentication.nativeIdentity.OPENCODE_DB!),
        );
        assert.ok(JSON.stringify({ ...details, policy: terminalPolicy }, null, 2).length < 4096);
        return accept;
      },
    },
  );
  try {
    const request = { version: 1, action: 'start', profileId: profile.id };
    assert.equal((await broker.dispatch(document, request)).status, 'denied');
    assert.equal(confirmations, 0);
    focused = true;
    assert.equal((await broker.dispatch(document, request)).status, 'cancelled');
    assert.equal(starts, 0);
    accept = true;
    assert.equal((await broker.dispatch(document, request)).status, 'ok');
    assert.equal(starts, 1);
    assert.equal(confirmations, 2);
  } finally {
    broker.close();
    supervisor.shutdown();
  }
});
