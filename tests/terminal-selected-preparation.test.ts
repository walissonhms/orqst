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
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import test, { after } from 'node:test';
import { build } from 'esbuild';
import { Store } from '../packages/database/src/index.js';
import { terminalExecutableSha256 } from '../packages/core/src/terminal/codex-profile.js';
import { reviewedDesktopCodexBinary } from '../apps/desktop/src/terminal-creation.js';
import { reviewedProviderMcpBinaries } from '../packages/core/src/terminal/provider-mcp-config.js';
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
        builder.onLoad({ filter: /(?:terminal-creation|provider-mcp-config)\.ts$/ }, (args) => ({
          contents: readFileSync(args.path, 'utf8')
            .replaceAll(reviewedDesktopCodexBinary.sha256, hash)
            .replaceAll(reviewedProviderMcpBinaries.claude.sha256, hash)
            .replaceAll(reviewedProviderMcpBinaries.opencode.sha256, hash),
          loader: 'ts',
        }));
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
    confirm: async (key: string, detail: string) => {
      confirmations.push(key);
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
      f.ports.confirm = async (_key, detail) => {
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
        /changed during review/,
      );
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
      /unavailable/,
    );
    assert.deepEqual(readdirSync(f.context.parent), []);
    const codex = result.catalog.providers.find((entry) => entry.provider === 'codex')!;
    request.modelId = codex.models[0]!.id;
    f.ports.confirm = async () => {
      writeFileSync(join(f.home, '.codex/config.toml'), 'model="changed"\n', { mode: 0o600 });
      return true;
    };
    await assert.rejects(
      prepareTauriTerminals(request, f.context, f.ports, Date.now, f.trusted),
      /changed during review/,
    );
    assert.deepEqual(readdirSync(f.context.parent), []);
  } finally {
    f.close();
  }
});
