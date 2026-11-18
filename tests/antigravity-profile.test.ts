// Synthetic-only profile, discovery and provisioning checks; never invokes Antigravity or native storage.
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import {
  chmodSync,
  lstatSync,
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
import test, { after } from 'node:test';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { TerminalAuthority } from '../packages/core/src/terminal/authority.js';
import {
  antigravityTerminalEnvironment,
  antigravityTerminalProfiles,
  managedAntigravityConfigSchema,
  validateAntigravitySelection,
  validateManagedAntigravityConfig,
} from '../packages/core/src/terminal/antigravity-profile.js';
import { reviewedAntigravityBinary } from '../packages/core/src/terminal/antigravity-launch-plan.js';
import {
  managedCodexSettings,
  terminalExecutableSha256,
  type ManagedCodexConfig,
} from '../packages/core/src/terminal/codex-profile.js';
import {
  interactiveHub,
  interactiveMcp,
  interactiveProvider,
  interactiveTerminalEnvironment,
  interactiveTerminalProfiles,
} from '../packages/core/src/terminal/interactive-profile.js';
import { discoverLocalClis } from '../packages/core/src/terminal/local-cli.js';
import { discoverTerminalModels } from '../packages/core/src/terminal/model-selection.js';
import { TerminalNativeBroker } from '../packages/core/src/terminal/native-broker.js';
import { TerminalSupervisor, terminalPolicy } from '../packages/core/src/terminal/supervisor.js';
import { inspectReviewedExecutables } from '../apps/desktop/src/terminal-discovery.js';

const enUS = JSON.parse(
  readFileSync(new URL('../apps/dashboard/src/locales/en-US.json', import.meta.url), 'utf8'),
);
const ptBR = JSON.parse(
  readFileSync(new URL('../apps/dashboard/src/locales/pt-BR.json', import.meta.url), 'utf8'),
);

// Pin substitution exists only in this disposable test bundle. Production rejects Node as agy.
const bundle = realpathSync(mkdtempSync(join(tmpdir(), 'orqst-synthetic-antigravity-bundle-')));
after(() => rmSync(bundle, { recursive: true, force: true }));
await build({
  entryPoints: {
    creation: 'apps/desktop/src/terminal-creation.ts',
    managedFiles: 'packages/core/src/terminal/managed-files.ts',
  },
  outdir: bundle,
  entryNames: '[name]',
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  logLevel: 'silent',
  plugins: [
    {
      name: 'synthetic-antigravity-pin-only',
      setup(builder) {
        builder.onLoad({ filter: /antigravity-launch-plan\.ts$/ }, (args) => ({
          contents: readFileSync(args.path, 'utf8').replace(
            reviewedAntigravityBinary.sha256,
            terminalExecutableSha256(realpathSync(process.execPath)),
          ),
          loader: 'ts',
        }));
      },
    },
  ],
});
const { prepareTerminalCreation } = (await import(
  pathToFileURL(join(bundle, 'creation.mjs')).href
)) as typeof import('../apps/desktop/src/terminal-creation.js');
const { inspectManagedTerminalFiles } = (await import(
  pathToFileURL(join(bundle, 'managedFiles.mjs')).href
)) as typeof import('../packages/core/src/terminal/managed-files.js');

function configFixture() {
  return managedAntigravityConfigSchema.parse({
    version: 4,
    provider: 'antigravity',
    trust: 'native-same-user',
    executable: {
      path: '/synthetic/agy',
      sha256: reviewedAntigravityBinary.sha256,
    },
    executableVersion: reviewedAntigravityBinary.version,
    node: { path: '/synthetic/node', sha256: 'a'.repeat(64) },
    project: '/synthetic/project',
    state: '/synthetic/private-state',
    authentication: {
      mode: 'reuse-existing',
      home: '/synthetic/home',
      sharedNativeConfiguration: true,
    },
    interactive: { sharedNativeSessions: true },
  });
}

test('Antigravity profile enforces minimal environment allowlist, model drift checks and MCP refusal', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'orqst-antigravity-profile-')));
  try {
    const config = configFixture();
    assert.equal(interactiveProvider(config), 'antigravity');
    assert.equal(interactiveMcp(config), false);
    assert.equal(interactiveHub(config), false);

    const profile = antigravityTerminalProfiles(config)[0]!;
    assert.equal(profile.id, 'antigravity-terminal-v1');
    assert.deepEqual(profile.argv, []);
    assert.match(profile.permissions, /Per-session ORQST MCP relay is UNAVAILABLE/);

    const environment = antigravityTerminalEnvironment(config);
    assert.deepEqual(Object.keys(environment).sort(), [
      'HOME',
      'LANG',
      'LC_ALL',
      'PATH',
      'TERM',
      'TMPDIR',
    ]);
    assert.equal(environment.HOME, '/synthetic/home');
    assert.equal(environment.TMPDIR, '/synthetic/private-state/tmp');

    const mcp = {
      serverName: 'orqst_' + 'a'.repeat(32),
      socketPath: join(root, 'absent.sock'),
      capabilityFile: join(root, 'absent.cap'),
      relay: { path: join(root, 'relay.cjs'), sha256: 'b'.repeat(64) },
    };
    assert.throws(() => antigravityTerminalProfiles(config, mcp), /MCP/);
    assert.throws(() => antigravityTerminalEnvironment(config, mcp), /MCP/);
    assert.throws(() => interactiveTerminalProfiles(config, mcp), /MCP/);
    assert.throws(() => interactiveTerminalEnvironment(config, mcp), /MCP/);

    const home = join(root, 'home');
    const project = join(root, 'project');
    mkdirSync(join(home, '.gemini/antigravity-cli'), { recursive: true, mode: 0o700 });
    mkdirSync(project, { mode: 0o700 });
    const settings = join(home, '.gemini/antigravity-cli/settings.json');
    writeFileSync(settings, JSON.stringify({ model: 'gemini-2.5-pro' }), { mode: 0o600 });

    const discovered = discoverTerminalModels('antigravity', project, home, {});
    assert.equal(discovered.limited, true);
    assert.deepEqual(
      discovered.options.map((entry) => [
        entry.label,
        entry.selection.source,
        entry.selection.value,
      ]),
      [
        ['CLI default', 'cli-default', null],
        ['gemini-2.5-pro', 'native-config', 'gemini-2.5-pro'],
      ],
    );

    config.model = discovered.options[1]!.selection;
    assert.deepEqual(antigravityTerminalProfiles(config)[0]!.argv, ['--model', 'gemini-2.5-pro']);
    writeFileSync(settings, JSON.stringify({ model: 'gemini-2.5-flash' }), { mode: 0o600 });
    assert.throws(() => antigravityTerminalProfiles(config), /catalogue changed/);
    assert.throws(() => antigravityTerminalEnvironment(config), /catalogue changed/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Antigravity discovery refuses unreviewed or missing agy binaries with localized EN/PT reasons', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'orqst-antigravity-discovery-')));
  try {
    const bin = join(root, 'bin');
    mkdirSync(bin, { mode: 0o755 });

    const missing = inspectReviewedExecutables('antigravity', bin, undefined, [
      reviewedAntigravityBinary,
    ]);
    assert.deepEqual(missing, { executables: [], refusal: 'executable_not_found' });

    const agy = join(bin, 'agy');
    writeFileSync(
      agy,
      Buffer.concat([Buffer.from([0xcf, 0xfa, 0xed, 0xfe]), Buffer.from('SYNTHETIC-UNREVIEWED')]),
      { mode: 0o755 },
    );
    assert.equal(
      discoverLocalClis(bin).find((entry) => entry.provider === 'antigravity')?.lookup,
      'candidate_found',
    );
    const unreviewed = inspectReviewedExecutables(
      'antigravity',
      bin,
      undefined,
      [reviewedAntigravityBinary],
      terminalExecutableSha256,
    );
    assert.deepEqual(unreviewed, { executables: [], refusal: 'executable_unreviewed' });

    for (const locale of [enUS, ptBR]) {
      assert.equal(typeof locale.studio.tauri[`catalog_${missing.refusal}`], 'string');
      assert.equal(typeof locale.studio.tauri[`catalog_${unreviewed.refusal}`], 'string');
      assert.equal(typeof locale.terminalStudio.create[`reason_${missing.refusal}`], 'string');
      assert.equal(typeof locale.terminalStudio.create[`reason_${unreviewed.refusal}`], 'string');
      assert.equal(typeof locale.studio.tauri.mcpUnavailableAntigravity, 'string');
      assert.equal(typeof locale.managedTerminal.antigravityScope, 'string');
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Antigravity provisioning isolates private state from ~/.gemini and coexists in Studio hub selections', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'orqst-antigravity-provision-')));
  try {
    chmodSync(root, 0o700);
    const project = join(root, 'project');
    const parent = join(root, 'profile');
    const home = join(root, 'native');
    const gemini = join(home, '.gemini');
    for (const path of [project, parent, home, gemini]) mkdirSync(path, { mode: 0o700 });
    const node = realpathSync(process.execPath);
    const nodeSha = terminalExecutableSha256(node);

    // Overlap with ~/.gemini is refused before any state write.
    const overlapping = {
      ...configFixture(),
      executable: { path: node, sha256: reviewedAntigravityBinary.sha256 },
      node: { path: node, sha256: nodeSha },
      project,
      state: join(gemini, 'antigravity-state'),
      authentication: {
        mode: 'reuse-existing' as const,
        home,
        sharedNativeConfiguration: true as const,
      },
    };
    assert.throws(
      () => validateAntigravitySelection(overlapping, () => reviewedAntigravityBinary.sha256),
      /overlaps native Antigravity state/,
    );
    assert.throws(
      () => validateManagedAntigravityConfig(overlapping, () => '0'.repeat(64)),
      /overlaps|changed/,
    );

    // MCP opt-in during creation is refused for Antigravity.
    assert.throws(() =>
      prepareTerminalCreation({
        count: 1,
        provider: 'antigravity',
        executable: node,
        node,
        project,
        parent,
        home,
        environment: {},
        mcp: true,
      }),
    );

    const plan = prepareTerminalCreation({
      count: 1,
      provider: 'antigravity',
      executable: node,
      node,
      project,
      parent,
      home,
      environment: { SYNTHETIC_SECRET: 'never-forwarded' },
      mcp: false,
    });
    assert.doesNotMatch(plan.detail, /SYNTHETIC_SECRET|never-forwarded/);
    const [antigravityFile] = plan.provision(() => true);
    assert.ok(antigravityFile);
    assert.equal(lstatSync(antigravityFile).mode & 0o777, 0o600);
    assert.deepEqual(readdirSync(home), ['.gemini']);
    assert.deepEqual(readdirSync(gemini), []);
    assert.deepEqual(readdirSync(project), []);

    const inspected = inspectManagedTerminalFiles([antigravityFile]);
    assert.equal(inspected.length, 1);
    assert.equal(inspected[0]!.blocker, undefined);
    assert.deepEqual(readdirSync(inspected[0]!.config.state).sort(), ['terminal.json', 'tmp']);

    // Studio Feature selections allow hub-enabled Codex alongside MCP-unavailable Antigravity.
    const codexState = join(root, 'codex-hub');
    mkdirSync(codexState, { mode: 0o700 });
    for (const d of ['tmp', 'home', 'codex']) mkdirSync(join(codexState, d), { mode: 0o700 });
    const codexConfig: ManagedCodexConfig = {
      version: 1,
      trust: 'native-same-user',
      executable: { path: node, sha256: nodeSha },
      executableVersion: '0.162.1',
      node: { path: node, sha256: nodeSha },
      identity: { terminalId: randomUUID() },
      project,
      state: codexState,
      authentication: {
        mode: 'reuse-existing',
        home,
        codexHome: home,
        sharedNativeConfiguration: true,
      },
      interactive: { sharedNativeSessions: true, mcp: true, hub: true },
    };
    writeFileSync(join(codexState, 'codex/config.toml'), managedCodexSettings(codexConfig), {
      mode: 0o600,
    });
    const codexFile = join(codexState, 'terminal.json');
    writeFileSync(codexFile, JSON.stringify(codexConfig), { mode: 0o600 });

    const mixedHub = inspectManagedTerminalFiles([codexFile, antigravityFile], 8);
    assert.deepEqual(
      mixedHub.map(({ config }) => [interactiveProvider(config), interactiveHub(config)]),
      [
        ['codex', true],
        ['antigravity', false],
      ],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Antigravity native broker requires focused confirmation before dispatch and fits display limit', async () => {
  const config = configFixture();
  const profile = antigravityTerminalProfiles(config)[0]!;
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
        assert.match(details.profile.permissions, /Per-session ORQST MCP relay is UNAVAILABLE/);
        assert.ok(details.profile.permissions.includes(config.authentication.home));
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
