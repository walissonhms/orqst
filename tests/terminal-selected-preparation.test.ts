// Synthetic provisioning only: tiny Mach-O fixture is never executed as a provider.
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import {
  TerminalAuthority,
  terminalChallengeBytes,
} from '../packages/core/src/terminal/authority.js';
import { TerminalSupervisor } from '../packages/core/src/terminal/supervisor.js';
import {
  chmodSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import test, { after } from 'node:test';
import { randomUUID } from 'node:crypto';
import { build } from 'esbuild';
import { Store } from '../packages/database/src/index.js';
import { terminalExecutableSha256 } from '../packages/core/src/terminal/codex-profile.js';
import { reviewedDesktopCodexBinary } from '../apps/desktop/src/terminal-creation.js';
import { reviewedProviderMcpBinaries } from '../packages/core/src/terminal/provider-mcp-config.js';
import { reviewedClaudeTuiBinary } from '../packages/core/src/terminal/interactive-profile.js';
import { discoverLocalClis } from '../packages/core/src/terminal/local-cli.js';
import { featureConfigurationDatabase } from '../packages/core/src/terminal/feature-configuration.js';

const bundle = realpathSync(mkdtempSync(join(tmpdir(), 'orqst-synthetic-selected-bundle-')));
after(() => rmSync(bundle, { recursive: true, force: true }));
const binary = join(bundle, 'synthetic-binary');
writeFileSync(binary, Buffer.from([0xfe, 0xed, 0xfa, 0xcf, 0, 0, 0, 0]), { mode: 0o700 });
const hash = terminalExecutableSha256(binary);
await build({
  entryPoints: {
    preparation: 'apps/desktop/src/tauri-terminal-preparation.ts',
    profiles: 'packages/core/src/terminal/interactive-profile.ts',
    backend: 'packages/core/src/terminal/pty-backend.ts',
    discovery: 'apps/desktop/src/terminal-discovery.ts',
  },
  outdir: bundle,
  outExtension: { '.js': '.cjs' },
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'cjs',
  logLevel: 'silent',
  plugins: [
    {
      name: 'synthetic-binary-pins-only',
      setup(builder) {
        builder.onLoad(
          { filter: /(?:terminal-creation|provider-mcp-config|interactive-profile)\.ts$/ },
          (args) => ({
            contents: readFileSync(args.path, 'utf8')
              .replaceAll(reviewedDesktopCodexBinary.sha256, hash)
              .replaceAll(reviewedProviderMcpBinaries.claude.sha256, hash)
              .replaceAll(reviewedClaudeTuiBinary.sha256, hash)
              .replaceAll(reviewedProviderMcpBinaries.opencode.sha256, hash),
            loader: 'ts',
          }),
        );
      },
    },
  ],
});
const { prepareTauriTerminals } = (await import(
  pathToFileURL(join(bundle, 'preparation.cjs')).href
)) as typeof import('../apps/desktop/src/tauri-terminal-preparation.js');
const {
  readInteractiveTerminalConfig,
  interactiveTerminalProfiles,
  interactiveTerminalEnvironment,
} = (await import(
  pathToFileURL(join(bundle, 'profiles.cjs')).href
)) as typeof import('../packages/core/src/terminal/interactive-profile.js');

const { managedTerminalBackend } = (await import(
  pathToFileURL(join(bundle, 'backend.cjs')).href
)) as typeof import('../packages/core/src/terminal/pty-backend.js');
const { discoverTerminalExecutable } = (await import(
  pathToFileURL(join(bundle, 'discovery.cjs')).href
)) as typeof import('../apps/desktop/src/terminal-discovery.js');

function fixture(openCodeCopies = false) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'orqst-synthetic-selected-')));
  chmodSync(root, 0o700);
  const home = join(root, 'native');
  const parent = join(root, 'profiles');
  const project = join(root, 'actual-project');
  const preferencesDirectory = join(root, 'preferences');
  const bin = join(root, 'bin');
  for (const directory of [home, parent, project, preferencesDirectory, bin])
    mkdirSync(directory, { mode: 0o700 });
  mkdirSync(join(home, '.codex'), { mode: 0o700 });
  mkdirSync(join(home, '.claude'), { mode: 0o700 });
  mkdirSync(join(home, '.config'), { mode: 0o700 });
  mkdirSync(join(home, '.config/opencode'), { mode: 0o700 });
  for (const provider of ['codex', 'claude', 'opencode'])
    writeFileSync(join(bin, provider), readFileSync(binary), { mode: 0o700 });
  if (openCodeCopies) {
    const installer = join(home, '.opencode/bin');
    mkdirSync(installer, { recursive: true, mode: 0o700 });
    // Identical native bytes at another canonical installation, never a provider process.
    writeFileSync(join(installer, 'opencode'), readFileSync(binary), { mode: 0o700 });
  }
  writeFileSync(join(project, 'SYNTHETIC-EXISTING-SOURCE'), 'Preserve selected project', {
    mode: 0o600,
  });
  writeFileSync(join(home, '.codex/config.toml'), 'model = "synthetic-model"\n', { mode: 0o600 });
  writeFileSync(join(home, '.claude/settings.json'), '{"model":"synthetic-model"}', {
    mode: 0o600,
  });
  writeFileSync(join(home, '.config/opencode/opencode.json'), '{"model":"synthetic/model"}', {
    mode: 0o600,
  });
  const observerDatabase = join(root, 'observer.sqlite');
  const store = new Store(observerDatabase);
  const workspaceId = store.workspace(project, 'Synthetic selected project');
  store.close();
  const confirmations: string[] = [];
  const context = {
    home,
    parent,
    node: realpathSync(process.execPath),
    environment: { HOME: home, PATH: bin + ':/usr/bin:/bin' },
  };
  const trusted = { observerDatabase, preferencesDirectory };
  const ports = {
    current: () => true,
    choose: async () => {
      throw new Error('Finder must never participate');
    },
    confirm: async (
      key: string,
      detail: string,
      overview?: import('../apps/desktop/src/terminal-creation.js').TerminalCreationOverview,
    ) => {
      confirmations.push(key);
      if (overview) assert.equal(overview.project, project);
      assert.ok(detail.length <= 4096);
      return true;
    },
    commit: async () => true,
  };
  return {
    root,
    home,
    project,
    workspaceId,
    context,
    trusted,
    ports,
    confirmations,
    close: () => rmSync(root, { recursive: true, force: true }),
  };
}

for (const [provider, useDefault] of [
  ['codex', false],
  ['claude', false],
  ['opencode', false],
  ['opencode', true],
] as const) {
  test(`selected ${provider} ${useDefault ? 'default' : 'model'} reaches the launch profile without a file picker or alternate project`, async () => {
    const f = fixture(provider === 'opencode');
    try {
      const features = featureConfigurationDatabase(f.trusted.preferencesDirectory, f.workspaceId);
      const feature = features.create({ name: 'Synthetic selected Feature' });
      features.saveView({ expectedRevision: 0, featureId: feature.featureId });
      const result = await prepareTauriTerminals(
        { action: 'catalog', workspaceId: f.workspaceId, featureId: feature.featureId },
        f.context,
        f.ports,
        Date.now,
        f.trusted,
      );
      assert.equal(result.status, 'catalog');
      assert.ok(!JSON.stringify(result).includes(f.project));
      const cli = result.catalog.providers.find((entry) => entry.provider === provider)!;
      assert.equal(cli.status, 'available');
      assert.ok(cli.models.every((entry) => entry.availability === 'unverified'));
      const selected = cli.models.find((entry) =>
        useDefault
          ? entry.isDefault
          : entry.label === (provider === 'opencode' ? 'synthetic/model' : 'synthetic-model'),
      )!;
      const prepared = await prepareTauriTerminals(
        {
          action: 'create-selected',
          workspaceId: f.workspaceId,
          featureId: feature.featureId,
          catalogId: result.catalog.catalogId,
          provider,
          modelId: selected.id,
          count: 1,
        },
        f.context,
        f.ports,
        Date.now,
        f.trusted,
      );
      assert.equal(prepared.status, 'open');
      assert.deepEqual(f.confirmations, ['selected']);
      assert.deepEqual(readdirSync(f.project), ['SYNTHETIC-EXISTING-SOURCE']);
      const config = readInteractiveTerminalConfig(prepared.files[0]!);
      assert.equal(config.project, f.project);
      assert.equal(
        config.executable.path,
        join(f.context.environment.PATH.split(':')[0]!, provider),
      );
      const profile = interactiveTerminalProfiles(config)[0]!;
      const model = profile.argv.indexOf('--model');
      if (provider === 'opencode') {
        assert.deepEqual(profile.argv, ['--standalone']);
        const inline = interactiveTerminalEnvironment(config).OPENCODE_CONFIG_CONTENT;
        if (useDefault) assert.equal(inline, undefined);
        else
          assert.deepEqual(JSON.parse(inline!).model, { providerID: 'synthetic', model: 'model' });
      } else {
        assert.ok(model >= 0);
        assert.equal(profile.argv[model + 1], 'synthetic-model');
      }
      assert.equal(profile.cwd, f.project);
      assert.deepEqual(features.read(feature.featureId).terminalIds, [config.identity!.terminalId]);
      const backend = managedTerminalBackend(prepared.files[0]!, 'SYNTHETIC-NEVER-EXECUTED');
      assert.equal(backend.validate(profile), true);
      const keys = generateKeyPairSync('ed25519');
      const authority = new TerminalAuthority(new Map([['synthetic-native', keys.publicKey]]));
      let starts = 0;
      const supervisor = new TerminalSupervisor(
        authority,
        {
          validate: (value) => backend.validate(value),
          start: () => {
            starts++;
            throw new Error('Synthetic test must never spawn');
          },
        },
        [profile],
      );
      const attempt = supervisor.prepare('synthetic-native', profile.id);
      writeFileSync(
        join(
          f.home,
          provider === 'codex'
            ? '.codex/config.toml'
            : provider === 'claude'
              ? '.claude/settings.json'
              : '.config/opencode/opencode.json',
        ),
        'SYNTHETIC-DRIFT',
        { mode: 0o600 },
      );
      assert.throws(() => readInteractiveTerminalConfig(prepared.files[0]!), /catalogue changed/);
      supervisor.launch(attempt.attemptId, {
        challengeId: attempt.challenge.challengeId,
        signature: sign(null, terminalChallengeBytes(attempt.challenge), keys.privateKey).toString(
          'base64url',
        ),
      });
      assert.equal(supervisor.snapshot(attempt.attemptId).state, 'start_failed');
      assert.equal(starts, 0);
    } finally {
      f.close();
    }
  });
}

for (const choice of [null, 'sonnet', 'opus', 'haiku']) {
  test(`Claude TUI selected ${choice ?? 'default'} reaches the reviewed profile without spawn`, async () => {
    const f = fixture();
    try {
      const catalog = await prepareTauriTerminals(
        { action: 'catalog', workspaceId: f.workspaceId, featureId: null },
        f.context,
        f.ports,
        Date.now,
        f.trusted,
      );
      assert.equal(catalog.status, 'catalog');
      const cli = catalog.catalog.providers.find((entry) => entry.provider === 'claude')!;
      const selected = cli.models.find((entry) =>
        choice === null ? entry.isDefault : entry.label === choice,
      )!;
      assert.equal(selected.availability, 'unverified');
      const prepared = await prepareTauriTerminals(
        {
          action: 'create-selected',
          workspaceId: f.workspaceId,
          featureId: null,
          catalogId: catalog.catalog.catalogId,
          provider: 'claude',
          modelId: selected.id,
          count: 1,
        },
        f.context,
        f.ports,
        Date.now,
        f.trusted,
      );
      assert.equal(prepared.status, 'open');
      const config = readInteractiveTerminalConfig(prepared.files[0]!);
      assert.equal(config.version, 2);
      if (config.version !== 2) throw new Error('Expected Claude manifest');
      assert.equal(config.executableVersion, reviewedClaudeTuiBinary.version);
      assert.equal(config.interactive.mcp, undefined);
      assert.ok(config.sessionId);
      assert.equal(config.model!.value, choice);
      const profile = interactiveTerminalProfiles(config)[0]!;
      assert.deepEqual(profile.argv, [
        '--session-id',
        config.sessionId,
        ...(choice ? ['--model', choice] : []),
      ]);
      assert.equal(profile.cliAuthorizationScope, 'claude-native-v1:native-mcp');
      const backend = managedTerminalBackend(prepared.files[0]!, 'SYNTHETIC-NEVER-EXECUTED');
      assert.equal(backend.validate(profile), true);
      // The same selected path with different native bytes is never substituted or admitted.
      writeFileSync(
        config.executable.path,
        Buffer.concat([readFileSync(binary), Buffer.from('SYNTHETIC-DRIFT')]),
      );
      assert.deepEqual(
        discoverTerminalExecutable('claude', f.context.environment.PATH, f.home),
        [],
      );
      assert.throws(() => backend.validate(profile), /executable changed/);
    } finally {
      f.close();
    }
  });
}

test('OpenCode copies, hardlinks and aliases share one reviewed implementation, preserving raw discovery and PATH order', () => {
  const f = fixture(true);
  try {
    const first = join(f.root, 'bin/opencode');
    const installer = join(f.home, '.opencode/bin/opencode');
    assert.notEqual(statSync(first).ino, statSync(installer).ino);
    const alias = join(f.root, 'alias');
    const hardlink = join(f.root, 'hardlink');
    const unreviewed = join(f.root, 'unreviewed');
    for (const directory of [alias, hardlink, unreviewed]) mkdirSync(directory, { mode: 0o700 });
    symlinkSync(first, join(alias, 'opencode'));
    linkSync(first, join(hardlink, 'opencode'));
    const changed = Buffer.concat([readFileSync(binary), Buffer.from('SYNTHETIC-UNREVIEWED')]);
    writeFileSync(join(unreviewed, 'opencode'), changed, { mode: 0o700 });
    const path = [unreviewed, alias, hardlink, f.context.environment.PATH].join(':');
    const raw = discoverLocalClis(path, f.home).find((entry) => entry.provider === 'opencode')!;
    assert.equal(raw.candidates.length, 4);
    assert.equal(raw.execution, 'not_authorized');
    assert.deepEqual(discoverTerminalExecutable('opencode', path, f.home), [first]);
    // A GUI-minimal PATH falls back to the installed reviewed binary, without a shell/Finder.
    assert.deepEqual(discoverTerminalExecutable('opencode', '/usr/bin:/bin', f.home), [installer]);
    // Neither a matching name, unreviewed native bytes, an executable shim nor unsafe
    // permissions can establish equivalence to the exact reviewed pin.
    chmodSync(first, 0o777);
    writeFileSync(installer, '#!/bin/sh\nexit 99\n', { mode: 0o700 });
    assert.deepEqual(discoverTerminalExecutable('opencode', path, f.home), []);
  } finally {
    f.close();
  }
});

test('OpenCode review rejects a changed chosen executable instead of substituting an equivalent copy', async () => {
  for (const change of ['bytes', 'removal'] as const) {
    const f = fixture(true);
    try {
      const result = await prepareTauriTerminals(
        { action: 'catalog', workspaceId: f.workspaceId, featureId: null },
        f.context,
        f.ports,
        Date.now,
        f.trusted,
      );
      assert.equal(result.status, 'catalog');
      const cli = result.catalog.providers.find((entry) => entry.provider === 'opencode')!;
      assert.equal(cli.status, 'available');
      let commits = 0;
      f.ports.commit = async () => {
        commits++;
        return true;
      };
      f.ports.confirm = async (_key, detail) => {
        // The complete pre-write configuration stays available through native Details.
        assert.ok(detail.includes(join(f.root, 'bin/opencode')));
        const first = join(f.root, 'bin/opencode');
        if (change === 'removal') rmSync(first);
        else writeFileSync(first, Buffer.concat([readFileSync(binary), Buffer.from('DRIFT')]));
        return true;
      };
      await assert.rejects(
        prepareTauriTerminals(
          {
            action: 'create-selected',
            workspaceId: f.workspaceId,
            featureId: null,
            catalogId: result.catalog.catalogId,
            provider: 'opencode',
            modelId: cli.models[0]!.id,
            count: 1,
          },
          f.context,
          f.ports,
          Date.now,
          f.trusted,
        ),
        (error: unknown) => {
          assert.deepEqual(Reflect.get(error as object, 'failure'), {
            stage: 'revalidation',
            code: 'catalog_changed',
            effects: 'not_started',
          });
          return true;
        },
      );
      assert.equal(commits, 0);
      assert.deepEqual(readdirSync(f.context.parent), []);
    } finally {
      f.close();
    }
  }
});

test('unknown model capabilities and changed source/view are refused before provisioning', async () => {
  const f = fixture();
  try {
    const result = await prepareTauriTerminals(
      { action: 'catalog', workspaceId: f.workspaceId, featureId: null },
      f.context,
      f.ports,
      Date.now,
      f.trusted,
    );
    assert.equal(result.status, 'catalog');
    const request = {
      action: 'create-selected',
      workspaceId: f.workspaceId,
      featureId: null,
      catalogId: result.catalog.catalogId,
      provider: 'codex',
      modelId: '0'.repeat(64),
      count: 1,
    };
    await assert.rejects(
      prepareTauriTerminals(request, f.context, f.ports, Date.now, f.trusted),
      (error: unknown) => {
        assert.deepEqual(Reflect.get(error as object, 'failure'), {
          stage: 'selection',
          code: 'selection_unavailable',
          effects: 'not_started',
        });
        return true;
      },
    );
    assert.deepEqual(readdirSync(f.context.parent), []);
    const codex = result.catalog.providers.find((entry) => entry.provider === 'codex')!;
    request.modelId = codex.models[0]!.id;
    let commits = 0;
    f.ports.commit = async () => {
      commits++;
      return true;
    };
    f.ports.confirm = async () => {
      writeFileSync(join(f.home, '.codex/config.toml'), 'model="changed"\n', { mode: 0o600 });
      return true;
    };
    await assert.rejects(
      prepareTauriTerminals(request, f.context, f.ports, Date.now, f.trusted),
      (error: unknown) => {
        assert.deepEqual(Reflect.get(error as object, 'failure'), {
          stage: 'revalidation',
          code: 'catalog_changed',
          effects: 'not_started',
        });
        return true;
      },
    );
    assert.equal(commits, 0);
    assert.deepEqual(readdirSync(f.context.parent), []);
  } finally {
    f.close();
  }
});

for (const sourceProvider of ['codex', 'opencode'] as const) {
  test(`product MCP pair with ${sourceProvider} source reviews both selected models and preserves bilateral opt-in without a session`, async () => {
    const f = fixture(true);
    try {
      const features = featureConfigurationDatabase(f.trusted.preferencesDirectory, f.workspaceId);
      const feature = features.create({ name: 'Synthetic communication Feature' });
      features.saveView({ expectedRevision: 0, featureId: feature.featureId });
      const scope = { workspaceId: f.workspaceId, featureId: feature.featureId };
      const catalog = await prepareTauriTerminals(
        { action: 'catalog', ...scope },
        f.context,
        f.ports,
        Date.now,
        f.trusted,
      );
      assert.equal(catalog.status, 'catalog');
      const codex = catalog.catalog.providers.find((entry) => entry.provider === 'codex')!;
      const opencode = catalog.catalog.providers.find((entry) => entry.provider === 'opencode')!;
      const reviews: string[] = [];
      f.ports.confirm = async (key, detail, overview) => {
        // Pair summary and optional Details exist before the first possible write.
        if (key === 'mcpPair') {
          const reviewed = JSON.parse(detail);
          assert.equal(reviewed.terminals.length, 2);
          assert.equal(overview?.project, f.project);
          assert.deepEqual(
            overview?.terminals.map((terminal) => terminal.role),
            ['source', 'worker'],
          );
          assert.deepEqual(
            overview?.terminals.map((terminal) => terminal.id),
            reviewed.terminals.map(
              (terminal: { identity: { terminalId: string } }) => terminal.identity.terminalId,
            ),
          );
          assert.deepEqual(readdirSync(f.context.parent), []);
        } else assert.ok(detail.length > 0 && detail.length <= 4096);
        reviews.push(key);
        return true;
      };
      const prepared = await prepareTauriTerminals(
        {
          action: 'create-mcp-pair',
          ...scope,
          catalogId: catalog.catalog.catalogId,
          sourceProvider,
          codexModelId: codex.models.find((entry) => entry.label === 'synthetic-model')!.id,
          openCodeModelId: opencode.models.find((entry) => entry.label === 'synthetic/model')!.id,
        },
        f.context,
        f.ports,
        Date.now,
        f.trusted,
      );
      assert.equal(prepared.status, 'open');
      assert.equal(prepared.files.length, 2);
      const configs = prepared.files.map(readInteractiveTerminalConfig);
      assert.equal(configs[0]!.version, sourceProvider === 'codex' ? 1 : 3);
      assert.equal(configs[1]!.version, sourceProvider === 'codex' ? 3 : 1);
      // The pair is reviewed once, and the reviewed configuration is the written manifest.
      assert.deepEqual(reviews, ['mcpPair']);
      for (const config of configs) {
        const written = JSON.parse(readFileSync(join(config.state, 'terminal.json'), 'utf8'));
        assert.deepEqual(written, config);
      }
      assert.deepEqual(
        features.read(feature.featureId).terminalIds,
        configs.map((config) => config.identity!.terminalId),
      );
      const relay = { path: binary, sha256: hash };
      for (const config of configs) {
        assert.equal(config.interactive?.mcp, true);
        assert.equal(config.project, f.project);
        assert.equal(config.preparation?.featureId, feature.featureId);
        assert.deepEqual(
          readdirSync(config.state).sort(),
          config.version === 1
            ? ['codex', 'home', 'terminal.json', 'tmp']
            : ['terminal.json', 'tmp'],
        );
        const launch = {
          serverName: 'orqst_' + 'a'.repeat(32),
          socketPath: '/SYNTHETIC/socket',
          capabilityFile: '/SYNTHETIC/cap',
          relay,
        };
        assert.throws(() => interactiveTerminalProfiles(config), /MCP/);
        const profile = interactiveTerminalProfiles(config, launch)[0]!;
        if (config.version === 1) {
          assert.equal(config.model?.value, 'synthetic-model');
          assert.equal(profile.argv[profile.argv.indexOf('--model') + 1], 'synthetic-model');
        } else {
          assert.equal(config.version, 3);
          assert.equal(config.interactive.mergedMcpAcknowledged, true);
          assert.equal(config.interactive.nativeStartupAuthorized, true);
          assert.deepEqual(profile.argv, ['--standalone']);
          const inline = JSON.parse(
            interactiveTerminalEnvironment(config, launch).OPENCODE_CONFIG_CONTENT!,
          );
          assert.deepEqual(inline.model, { providerID: 'synthetic', model: 'model' });
          assert.ok(inline.mcp.servers[launch.serverName]);
        }
      }
      assert.deepEqual(readdirSync(f.project), ['SYNTHETIC-EXISTING-SOURCE']);
    } finally {
      f.close();
    }
  });
}

for (const fault of [
  'codex-model',
  'opencode-model',
  'cancel',
  'expiry',
  'surface',
  'commit',
  'codex-drift',
  'opencode-drift',
  'companion-commit-drift',
] as const) {
  test(`product MCP pair refuses ${fault} without publishing a partial pair or starting a session`, async () => {
    const f = fixture();
    try {
      const scope = { workspaceId: f.workspaceId, featureId: null };
      const catalog = await prepareTauriTerminals(
        { action: 'catalog', ...scope },
        f.context,
        f.ports,
        Date.now,
        f.trusted,
      );
      assert.equal(catalog.status, 'catalog');
      const request = {
        action: 'create-mcp-pair',
        ...scope,
        catalogId: catalog.catalog.catalogId,
        sourceProvider: 'codex',
        codexModelId: catalog.catalog.providers.find((entry) => entry.provider === 'codex')!
          .models[0]!.id,
        openCodeModelId: catalog.catalog.providers.find((entry) => entry.provider === 'opencode')!
          .models[0]!.id,
      };
      if (fault === 'codex-model') request.codexModelId = request.openCodeModelId;
      if (fault === 'opencode-model') request.openCodeModelId = request.codexModelId;
      let now = 1;
      let current = true;
      let commits = 0;
      let reviews = 0;
      const drift = (codex: boolean) =>
        writeFileSync(
          join(f.home, codex ? '.codex/config.toml' : '.config/opencode/opencode.json'),
          'SYNTHETIC-CHANGED',
          { mode: 0o600 },
        );
      f.ports.current = () => current;
      f.ports.confirm = async () => {
        reviews++;
        if (fault === 'expiry') now += 60_000;
        if (fault === 'surface') current = false;
        if (fault === 'codex-drift' || fault === 'opencode-drift') drift(fault === 'codex-drift');
        return fault !== 'cancel';
      };
      f.ports.commit = async () => {
        commits++;
        if (fault === 'companion-commit-drift') drift(false);
        return fault !== 'commit';
      };
      const attempt = prepareTauriTerminals(request, f.context, f.ports, () => now, f.trusted);
      if (['cancel', 'expiry', 'surface', 'commit'].includes(fault)) {
        const result = await attempt;
        assert.equal(result.status, 'cancelled');
      } else {
        await assert.rejects(attempt, (error: unknown) => {
          const failure = Reflect.get(error as object, 'failure');
          assert.equal(failure.stage, fault.endsWith('-model') ? 'selection' : 'revalidation');
          assert.equal(failure.effects, 'not_started');
          return true;
        });
      }
      assert.equal(commits, fault === 'commit' || fault === 'companion-commit-drift' ? 1 : 0);
      assert.equal(reviews, fault === 'codex-model' || fault === 'opencode-model' ? 0 : 1);
      assert.deepEqual(readdirSync(f.context.parent), []);
    } finally {
      f.close();
    }
  });
}

for (const provider of ['codex', 'claude', 'opencode'] as const) {
  test(`product independent ${provider} opening remains MCP-disabled without a session`, async () => {
    const f = fixture();
    try {
      const scope = { workspaceId: f.workspaceId, featureId: null };
      const catalog = await prepareTauriTerminals(
        { action: 'catalog', ...scope },
        f.context,
        f.ports,
        Date.now,
        f.trusted,
      );
      assert.equal(catalog.status, 'catalog');
      const cli = catalog.catalog.providers.find((entry) => entry.provider === provider)!;
      const prepared = await prepareTauriTerminals(
        {
          action: 'create-selected',
          ...scope,
          catalogId: catalog.catalog.catalogId,
          provider,
          modelId: cli.models[0]!.id,
          count: 1,
        },
        f.context,
        f.ports,
        Date.now,
        f.trusted,
      );
      assert.equal(prepared.status, 'open');
      assert.equal(prepared.files.length, 1);
      assert.deepEqual(f.confirmations, ['selected']);
      const config = readInteractiveTerminalConfig(prepared.files[0]!);
      assert.equal(config.interactive?.mcp, undefined);
      assert.equal(config.project, f.project);
      assert.ok(!readdirSync(config.state).includes('terminal.sqlite'));
    } finally {
      f.close();
    }
  });
}

// Human-reported path: picker catalog -> explicit CLI/model -> create-selected.
// All sources, workspaces and native bytes below are disposable synthetic fixtures.
async function catalogChoice(
  f: ReturnType<typeof fixture>,
  label: string,
  featureId: string | null = null,
) {
  const scope = { workspaceId: f.workspaceId, featureId };
  const reply = await prepareTauriTerminals(
    { action: 'catalog', ...scope },
    f.context,
    f.ports,
    Date.now,
    f.trusted,
  );
  assert.equal(reply.status, 'catalog');
  const model = reply.catalog.providers
    .find((entry) => entry.provider === 'codex')!
    .models.find((entry) => entry.label === label)!;
  assert.ok(model);
  return {
    action: 'create-selected',
    ...scope,
    catalogId: reply.catalog.catalogId,
    provider: 'codex',
    modelId: model.id,
    count: 1,
  };
}
function syntheticCache(f: ReturnType<typeof fixture>, fetchedAt = Date.now()) {
  const cache = {
    client_version: '0.162.1',
    fetched_at: new Date(fetchedAt).toISOString(),
    models: [
      { slug: 'gpt-6.1-sol', display_name: 'gpt-6.1-sol', visibility: 'list' },
      { slug: 'synthetic-other', display_name: 'Synthetic other', visibility: 'list' },
    ],
  };
  const save = () =>
    writeFileSync(join(f.home, '.codex/models_cache.json'), JSON.stringify(cache), { mode: 0o600 });
  save();
  return { cache, save };
}

for (const selected of ['native-config', 'cli-default', 'cli-cache'] as const) {
  for (const phase of ['before-click', 'review', 'commit'] as const) {
    test(`catalog regression: ${selected} survives unrelated cache/provider updates at ${phase}`, async (t) => {
      const f = fixture();
      let clock = Date.now();
      t.mock.method(Date, 'now', () => clock);
      try {
        const cache = syntheticCache(f, clock - 10_000);
        const label =
          selected === 'native-config'
            ? 'synthetic-model'
            : selected === 'cli-default'
              ? 'CLI default'
              : 'gpt-6.1-sol';
        const request = await catalogChoice(f, label);
        const originalExpiry = clock - 10_000 + 300_000;
        const mutate = () => {
          clock += 1000;
          cache.cache.fetched_at = new Date(clock).toISOString();
          cache.cache.models[1]!.display_name = 'Changed unrelated model';
          cache.cache.models.reverse();
          cache.save();
          writeFileSync(
            join(f.home, '.claude/settings.json'),
            '{"model":"synthetic-other-provider"}',
            { mode: 0o600 },
          );
          rmSync(join(f.root, 'bin/claude'));
        };
        if (phase === 'before-click') mutate();
        if (phase === 'review')
          f.ports.confirm = async () => {
            mutate();
            return true;
          };
        if (phase === 'commit')
          f.ports.commit = async () => {
            mutate();
            return true;
          };
        const result = await prepareTauriTerminals(
          request,
          f.context,
          f.ports,
          Date.now,
          f.trusted,
        );
        assert.equal(result.status, 'open');
        const config = readInteractiveTerminalConfig(result.files[0]!);
        assert.equal(config.model!.source, selected);
        assert.equal(config.model!.value, selected === 'cli-default' ? null : label);
        assert.equal(
          config.model!.expiresAt,
          selected === 'cli-cache' ? originalExpiry : undefined,
        );
        assert.equal(config.interactive?.mcp, undefined);
        // A successful preparation is files only; it never initializes a runtime journal.
        assert.ok(!readdirSync(config.state).includes('terminal.sqlite'));
        if (selected === 'cli-cache') {
          clock = originalExpiry;
          assert.throws(() => readInteractiveTerminalConfig(result.files[0]!), /expired/);
        }
      } finally {
        f.close();
      }
    });
  }
}

for (const fault of [
  'model',
  'label',
  'hidden',
  'removed',
  'duplicate',
  'version',
  'expired',
  'config',
  'source',
  'executable',
  'home',
  'path',
  'feature',
  'workspace',
] as const) {
  for (const phase of ['before-click', 'review', 'commit'] as const) {
    test(`catalog regression: selected ${fault} drift at ${phase} refuses before effects`, async (t) => {
      const f = fixture();
      let clock = Date.now();
      t.mock.method(Date, 'now', () => clock);
      try {
        const cache = syntheticCache(f, clock - 299_000);
        const features = featureConfigurationDatabase(
          f.trusted.preferencesDirectory,
          f.workspaceId,
        );
        const feature = features.create({ name: 'Synthetic catalog scope' });
        features.saveView({ expectedRevision: 0, featureId: feature.featureId });
        const request = await catalogChoice(f, 'gpt-6.1-sol', feature.featureId);
        let commits = 0;
        const mutate = () => {
          if (fault === 'model') cache.cache.models[0]!.slug = 'synthetic-replacement';
          if (fault === 'label') cache.cache.models[0]!.display_name = 'Replacement label';
          if (fault === 'hidden') cache.cache.models[0]!.visibility = 'hide';
          if (fault === 'removed') cache.cache.models.shift();
          if (fault === 'duplicate') cache.cache.models.push({ ...cache.cache.models[0]! });
          if (fault === 'version') cache.cache.client_version = 'synthetic-unreviewed';
          if (fault === 'expired') clock += 1000;
          cache.save();
          if (fault === 'config')
            writeFileSync(join(f.home, '.codex/config.toml'), 'model="synthetic-changed"', {
              mode: 0o600,
            });
          if (fault === 'source')
            writeFileSync(join(f.home, '.codex/config.toml'), 'model="gpt-6.1-sol"', {
              mode: 0o600,
            });
          if (fault === 'executable') writeFileSync(join(f.root, 'bin/codex'), 'SYNTHETIC-CHANGED');
          if (fault === 'home')
            f.context.environment = { ...f.context.environment, HOME: '/synthetic-changed' };
          if (fault === 'path') f.context.environment.PATH = '/usr/bin:/bin';
          if (fault === 'feature')
            features.update(feature.featureId, {
              expectedRevision: feature.revision,
              name: 'Changed synthetic Feature',
            });
          if (fault === 'workspace') {
            renameSync(f.project, f.project + '-replaced');
            mkdirSync(f.project, { mode: 0o700 });
          }
        };
        // HOME is supplied independently by the trusted host, like the real preparation boundary.
        const drift = () => {
          mutate();
          if (fault === 'home') f.context.home = f.project;
        };
        if (phase === 'before-click') drift();
        f.ports.confirm = async () => {
          if (phase === 'review') drift();
          return true;
        };
        f.ports.commit = async () => {
          commits++;
          if (phase === 'commit') drift();
          return true;
        };
        await assert.rejects(
          prepareTauriTerminals(request, f.context, f.ports, Date.now, f.trusted),
          (error: unknown) => {
            const failure = Reflect.get(error as object, 'failure');
            assert.equal(failure.effects, 'not_started');
            assert.equal(
              failure.stage,
              phase === 'before-click'
                ? ['workspace', 'feature'].includes(fault)
                  ? 'catalog'
                  : 'selection'
                : 'revalidation',
            );
            assert.ok(
              ['failed', 'catalog_changed', 'selection_unavailable'].includes(failure.code),
            );
            assert.ok(!JSON.stringify(failure).includes(f.root));
            return true;
          },
        );
        assert.equal(commits, phase === 'commit' ? 1 : 0);
        assert.deepEqual(readdirSync(f.context.parent), []);
      } finally {
        f.close();
      }
    });
  }
}

for (const field of ['fetched_at', 'other-model', 'other-cli'] as const) {
  test(`catalog regression isolated field: ${field} changes without invalidating configured gpt-6.1-sol`, async () => {
    const f = fixture();
    try {
      writeFileSync(join(f.home, '.codex/config.toml'), 'model="gpt-6.1-sol"\n', { mode: 0o600 });
      const cache = syntheticCache(f, Date.now() - 10_000);
      const request = await catalogChoice(f, 'gpt-6.1-sol');
      if (field === 'fetched_at')
        cache.cache.fetched_at = new Date(Date.now() - 1000).toISOString();
      if (field === 'other-model') cache.cache.models[1]!.slug = 'synthetic-replacement';
      if (field === 'other-cli') rmSync(join(f.root, 'bin/claude'));
      cache.save();
      const prepared = await prepareTauriTerminals(
        request,
        f.context,
        f.ports,
        Date.now,
        f.trusted,
      );
      assert.equal(prepared.status, 'open');
      const config = readInteractiveTerminalConfig(prepared.files[0]!);
      assert.equal(config.model!.value, 'gpt-6.1-sol');
      assert.equal(config.model!.source, 'native-config');
      assert.deepEqual(f.confirmations, ['selected']);
    } finally {
      f.close();
    }
  });
}

test('catalog regression: cache selection launch fence keeps source and original expiry after refresh', async (t) => {
  const f = fixture();
  let clock = Date.now();
  t.mock.method(Date, 'now', () => clock);
  try {
    const cache = syntheticCache(f, clock - 10_000);
    const request = await catalogChoice(f, 'gpt-6.1-sol');
    const expiry = clock - 10_000 + 300_000;
    const prepared = await prepareTauriTerminals(request, f.context, f.ports, Date.now, f.trusted);
    assert.equal(prepared.status, 'open');
    clock += 1000;
    cache.cache.fetched_at = new Date(clock).toISOString();
    cache.cache.models[1]!.slug = 'synthetic-other-updated';
    cache.save();
    assert.equal(readInteractiveTerminalConfig(prepared.files[0]!).model!.expiresAt, expiry);
    cache.cache.models[0]!.visibility = 'hide';
    cache.save();
    assert.throws(() => readInteractiveTerminalConfig(prepared.files[0]!), /catalogue changed/);
    cache.cache.models[0]!.visibility = 'list';
    cache.save();
    clock = expiry;
    assert.throws(() => readInteractiveTerminalConfig(prepared.files[0]!), /expired/);
    const stored = JSON.parse(readFileSync(prepared.files[0]!, 'utf8')) as { state: string };
    assert.ok(!readdirSync(stored.state).includes('terminal.sqlite'));
  } finally {
    f.close();
  }
});

test('catalog regression: opaque cache deadline cannot be extended or erased by the requester', async () => {
  const f = fixture();
  try {
    syntheticCache(f);
    const request = await catalogChoice(f, 'gpt-6.1-sol');
    const original = request.modelId;
    for (const prefix of [
      '000000000000',
      (Number.parseInt(original.slice(0, 12), 16) + 1).toString(16).padStart(12, '0'),
    ]) {
      request.modelId = prefix + original.slice(12);
      await assert.rejects(
        prepareTauriTerminals(request, f.context, f.ports, Date.now, f.trusted),
        (error: unknown) => {
          assert.deepEqual(Reflect.get(error as object, 'failure'), {
            stage: 'selection',
            code: 'selection_unavailable',
            effects: 'not_started',
          });
          return true;
        },
      );
    }
    assert.deepEqual(f.confirmations, []);
    assert.deepEqual(readdirSync(f.context.parent), []);
  } finally {
    f.close();
  }
});

// OpenCode 2.2.5 writes the models the person chose to <state>/opencode/model.json
// (packages/tui/src/context/local.tsx at 9bbb8ce). Synthetic fixture only.
function openCodeState(f: ReturnType<typeof fixture>, document: unknown) {
  const directory = join(f.home, '.local/state/opencode');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  writeFileSync(join(directory, 'model.json'), JSON.stringify(document), { mode: 0o600 });
}

test('OpenCode native preference document becomes real, unverified model choices', async () => {
  const f = fixture();
  try {
    openCodeState(f, {
      recent: [
        { providerID: 'synthetic', modelID: 'recent-model' },
        { providerID: 'synthetic', modelID: 'variant-model' },
      ],
      favorite: [{ providerID: 'synthetic', modelID: 'favorite-model' }],
      variant: { 'synthetic/variant-model': 'fast' },
    });
    const result = await prepareTauriTerminals(
      { action: 'catalog', workspaceId: f.workspaceId, featureId: null },
      f.context,
      f.ports,
      Date.now,
      f.trusted,
    );
    assert.equal(result.status, 'catalog');
    const opencode = result.catalog.providers.find((entry) => entry.provider === 'opencode')!;
    assert.equal(opencode.status, 'available');
    const labels = opencode.models.map((entry) => entry.label);
    // Configured models keep precedence; the preference document adds the rest, never duplicates.
    assert.ok(labels.includes('synthetic/model'));
    assert.ok(labels.includes('synthetic/favorite-model'));
    assert.ok(labels.includes('synthetic/recent-model'));
    assert.ok(labels.includes('synthetic/variant-model#fast'));
    assert.equal(labels.filter((label) => label === 'synthetic/recent-model').length, 1);
    for (const label of [
      'synthetic/favorite-model',
      'synthetic/recent-model',
      'synthetic/variant-model#fast',
    ])
      assert.equal(
        opencode.models.find((entry) => entry.label === label)!.source,
        'native-state',
        label,
      );
    for (const entry of opencode.models) assert.equal(entry.availability, 'unverified');
  } finally {
    f.close();
  }
});

test('OpenCode native choice reaches the launch profile without a picker cache or provider run', async () => {
  const f = fixture(true);
  try {
    openCodeState(f, {
      recent: [{ providerID: 'synthetic', modelID: 'variant-model' }],
      variant: { 'synthetic/variant-model': 'fast' },
    });
    const catalog = await prepareTauriTerminals(
      { action: 'catalog', workspaceId: f.workspaceId, featureId: null },
      f.context,
      f.ports,
      Date.now,
      f.trusted,
    );
    assert.equal(catalog.status, 'catalog');
    const opencode = catalog.catalog.providers.find((entry) => entry.provider === 'opencode')!;
    const chosen = opencode.models.find((entry) => entry.label === 'synthetic/variant-model#fast');
    assert.ok(chosen);
    const details: string[] = [];
    f.ports.confirm = async (key, detail, overview) => {
      assert.equal(key, 'selected');
      assert.equal(overview?.project, f.project);
      assert.equal(overview?.terminals[0]?.provider, 'opencode');
      assert.equal(overview?.terminals[0]?.model, 'synthetic/variant-model#fast');
      assert.equal(overview?.terminals[0]?.id, JSON.parse(detail).terminals[0].identity.terminalId);
      // No file is written before both concise summary and full Details are available.
      assert.deepEqual(readdirSync(f.context.parent), []);
      details.push(detail);
      return true;
    };
    const prepared = await prepareTauriTerminals(
      {
        action: 'create-selected',
        workspaceId: f.workspaceId,
        featureId: null,
        catalogId: catalog.catalog.catalogId,
        provider: 'opencode',
        modelId: chosen.id,
        count: 1,
      },
      f.context,
      f.ports,
      Date.now,
      f.trusted,
    );
    assert.equal(prepared.status, 'open');
    assert.equal(details.length, 1);
    assert.equal(JSON.parse(details[0]!).terminals[0].model.value, 'synthetic/variant-model#fast');
    const config = readInteractiveTerminalConfig(prepared.files[0]!);
    assert.equal(config.version, 3);
    assert.deepEqual(config.model, {
      value: 'synthetic/variant-model#fast',
      source: 'native-state',
      files: config.model!.files,
    });
    assert.ok(config.model!.files.some((file) => file.path.endsWith('/opencode/model.json')));
    // The written manifest is the complete configuration that the short consent authorized.
    assert.deepEqual(JSON.parse(readFileSync(join(config.state, 'terminal.json'), 'utf8')), config);
  } finally {
    f.close();
  }
});

test('OpenCode native choice survives unrelated preference edits and refuses a removed choice', async () => {
  const f = fixture();
  try {
    const base = {
      recent: [{ providerID: 'synthetic', modelID: 'chosen-model' }],
      favorite: [{ providerID: 'synthetic', modelID: 'other-model' }],
      variant: {},
    };
    openCodeState(f, base);
    const catalog = await prepareTauriTerminals(
      { action: 'catalog', workspaceId: f.workspaceId, featureId: null },
      f.context,
      f.ports,
      Date.now,
      f.trusted,
    );
    assert.equal(catalog.status, 'catalog');
    const opencode = catalog.catalog.providers.find((entry) => entry.provider === 'opencode')!;
    const chosen = opencode.models.find((entry) => entry.label === 'synthetic/chosen-model');
    assert.ok(chosen);
    const request = {
      action: 'create-selected' as const,
      workspaceId: f.workspaceId,
      featureId: null,
      catalogId: catalog.catalog.catalogId,
      provider: 'opencode' as const,
      modelId: chosen.id,
      count: 1,
    };
    // Another OpenCode session rotates its own preferences: the choice stays valid.
    openCodeState(f, {
      recent: [
        { providerID: 'synthetic', modelID: 'chosen-model' },
        { providerID: 'synthetic', modelID: 'third-model' },
      ],
      favorite: [{ providerID: 'synthetic', modelID: 'other-model' }],
      variant: { 'synthetic/other-model': 'slow' },
    });
    const prepared = await prepareTauriTerminals(request, f.context, f.ports, Date.now, f.trusted);
    assert.equal(prepared.status, 'open');
    assert.equal(
      readInteractiveTerminalConfig(prepared.files[0]!).model!.value,
      'synthetic/chosen-model',
    );
    // Removing the chosen entry before the click leaves no such choice to rebind.
    const second = fixture();
    try {
      openCodeState(second, base);
      const first = await prepareTauriTerminals(
        { action: 'catalog', workspaceId: second.workspaceId, featureId: null },
        second.context,
        second.ports,
        Date.now,
        second.trusted,
      );
      assert.equal(first.status, 'catalog');
      const cli = first.catalog.providers.find((entry) => entry.provider === 'opencode')!;
      const pick = cli.models.find((entry) => entry.label === 'synthetic/chosen-model');
      assert.ok(pick);
      openCodeState(second, {
        recent: [{ providerID: 'synthetic', modelID: 'third-model' }],
        favorite: [],
        variant: {},
      });
      await assert.rejects(
        prepareTauriTerminals(
          {
            action: 'create-selected',
            workspaceId: second.workspaceId,
            featureId: null,
            catalogId: first.catalog.catalogId,
            provider: 'opencode',
            modelId: pick.id,
            count: 1,
          },
          second.context,
          second.ports,
          Date.now,
          second.trusted,
        ),
        (error: unknown) => {
          assert.deepEqual(Reflect.get(error as object, 'failure'), {
            stage: 'selection',
            code: 'selection_unavailable',
            effects: 'not_started',
          });
          return true;
        },
      );
      assert.deepEqual(second.confirmations, []);
      assert.deepEqual(readdirSync(second.context.parent), []);
    } finally {
      second.close();
    }
  } finally {
    f.close();
  }
});

for (const change of ['unrelated', 'removed', 'variant'] as const) {
  test(`OpenCode saved selection revalidates ${change} state after consent before commit`, async () => {
    const f = fixture();
    try {
      const original = {
        recent: [{ providerID: 'synthetic', modelID: 'chosen' }],
        variant: { 'synthetic/chosen': 'fast' },
      };
      openCodeState(f, original);
      const discovered = await prepareTauriTerminals(
        { action: 'catalog', workspaceId: f.workspaceId, featureId: null },
        f.context,
        f.ports,
        Date.now,
        f.trusted,
      );
      assert.equal(discovered.status, 'catalog');
      const chosen = discovered.catalog.providers
        .find((entry) => entry.provider === 'opencode')!
        .models.find((entry) => entry.label === 'synthetic/chosen#fast')!;
      let commits = 0;
      f.ports.commit = async () => {
        commits++;
        return true;
      };
      f.ports.confirm = async () => {
        openCodeState(
          f,
          change === 'unrelated'
            ? { ...original, variant: { ...original.variant, 'other/model': 'slow' } }
            : change === 'removed'
              ? { recent: [], variant: {} }
              : { ...original, variant: { 'synthetic/chosen': 'slow' } },
        );
        return true;
      };
      const attempt = prepareTauriTerminals(
        {
          action: 'create-selected',
          workspaceId: f.workspaceId,
          featureId: null,
          catalogId: discovered.catalog.catalogId,
          provider: 'opencode',
          modelId: chosen.id,
          count: 1,
        },
        f.context,
        f.ports,
        Date.now,
        f.trusted,
      );
      if (change === 'unrelated') {
        assert.equal((await attempt).status, 'open');
        assert.equal(commits, 1);
      } else {
        await assert.rejects(attempt, (error: unknown) => {
          assert.deepEqual(Reflect.get(error as object, 'failure'), {
            stage: 'revalidation',
            code: 'catalog_changed',
            effects: 'not_started',
          });
          return true;
        });
        assert.equal(commits, 0);
        assert.deepEqual(readdirSync(f.context.parent), []);
      }
    } finally {
      f.close();
    }
  });
}

for (const phase of ['before', 'review', 'commit', 'same-owner-replaced', 'same-core'] as const) {
  test(`admission preflight ${phase} preserves reservation and never provisions a blocked selection`, async () => {
    const f = fixture();
    const file = join(f.trusted.preferencesDirectory, 'active-pair.json');
    const currentCore = {
      owner: randomUUID(),
      epoch: randomUUID(),
      initialFiles: ['/synthetic/original.json'],
    };
    const bytes = JSON.stringify({
      version: 1,
      owner: currentCore.owner,
      epoch: currentCore.epoch,
      manifests: currentCore.initialFiles,
    });
    try {
      const catalog = await prepareTauriTerminals(
        { action: 'catalog', workspaceId: f.workspaceId, featureId: null },
        f.context,
        f.ports,
        Date.now,
        f.trusted,
      );
      assert.equal(catalog.status, 'catalog');
      const cli = catalog.catalog.providers.find((entry) => entry.provider === 'codex')!;
      const selected = {
        action: 'create-selected',
        workspaceId: f.workspaceId,
        featureId: null,
        catalogId: catalog.catalog.catalogId,
        provider: 'codex',
        modelId: cli.models[0]!.id,
        count: 1,
      };
      if (phase === 'before' || phase === 'same-core' || phase === 'same-owner-replaced')
        writeFileSync(file, bytes, { mode: 0o600 });
      let commits = 0;
      const confirm = f.ports.confirm;
      f.ports.confirm = async (...args) => {
        if (phase === 'review') writeFileSync(file, bytes, { mode: 0o600 });
        if (phase === 'same-owner-replaced') {
          const replacement = file + '.synthetic-replacement';
          writeFileSync(replacement, bytes, { mode: 0o600 });
          renameSync(replacement, file);
        }
        return confirm(...args);
      };
      f.ports.commit = async () => {
        commits++;
        if (phase === 'commit') writeFileSync(file, bytes, { mode: 0o600 });
        return true;
      };
      const operation = prepareTauriTerminals(
        selected,
        f.context,
        f.ports,
        Date.now,
        f.trusted,
        phase === 'same-core' || phase === 'same-owner-replaced' ? currentCore : undefined,
      );
      if (phase === 'same-core') {
        assert.equal((await operation).status, 'open');
        assert.equal(commits, 1);
      } else {
        await assert.rejects(operation, (error: unknown) => {
          assert.deepEqual(Reflect.get(error as object, 'failure'), {
            stage: 'admission_preflight',
            code: phase === 'same-owner-replaced' ? 'admission_invalid' : 'capacity_reserved',
            effects: 'not_started', // Native commit independently upgrades this to possible.
          });
          return true;
        });
        assert.equal(commits, phase === 'commit' ? 1 : 0);
        assert.deepEqual(readdirSync(f.context.parent), []);
      }
      assert.equal(readFileSync(file, 'utf8'), bytes);
      if (phase === 'before') assert.equal(f.confirmations.length, 0);
    } finally {
      f.close();
    }
  });
}
