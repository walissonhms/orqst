import assert from 'node:assert/strict';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { Store, readTerminalWorkspace } from '../packages/database/src/index.js';
import { stableId } from '../packages/shared/src/index.js';
import { terminalSelectedRequestSchema } from '../packages/protocol/src/terminal-preparation.js';
import {
  discoverTerminalModels,
  terminalModelArguments,
} from '../packages/core/src/terminal/model-selection.js';
import {
  resolveTerminalPreparationContext,
  validateTerminalPreparationBinding,
} from '../packages/core/src/terminal/preparation-context.js';
import { featureConfigurationDatabase } from '../packages/core/src/terminal/feature-configuration.js';

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'orqst-synthetic-model-selection-')));
  chmodSync(root, 0o700);
  const home = join(root, 'home');
  const project = join(root, 'selected-project');
  const preferencesDirectory = join(root, 'preferences');
  for (const dir of [home, project, preferencesDirectory]) mkdirSync(dir, { mode: 0o700 });
  for (const dir of ['.codex', '.claude', '.config', '.config/opencode'])
    mkdirSync(join(home, dir), { mode: 0o700 });
  const observerDatabase = join(root, 'observer.sqlite');
  const store = new Store(observerDatabase);
  const workspaceId = store.workspace(project, 'Synthetic selected workspace');
  store.close();
  return {
    root,
    home,
    project,
    workspaceId,
    trusted: { observerDatabase, preferencesDirectory },
    close: () => rmSync(root, { recursive: true, force: true }),
  };
}

test('real Codex picker cache and configured values retain provenance without entitlement', () => {
  const f = fixture();
  try {
    writeFileSync(
      join(f.home, '.codex/config.toml'),
      'model = "synthetic-configured"\n[profiles.test]\nmodel = "synthetic-profile"\n',
      { mode: 0o600 },
    );
    writeFileSync(
      join(f.home, '.codex/models_cache.json'),
      JSON.stringify({
        client_version: '0.162.1',
        fetched_at: new Date().toISOString(),
        models: [
          { slug: 'synthetic-picker', display_name: 'Synthetic picker', visibility: 'list' },
          { slug: 'synthetic-hidden', visibility: 'hide' },
        ],
      }),
      { mode: 0o600 },
    );
    const models = discoverTerminalModels('codex', f.project, f.home, {});
    assert.equal(models.limited, false);
    assert.deepEqual(
      models.options.map((entry) => entry.selection.value),
      [null, 'synthetic-configured', 'synthetic-profile', 'synthetic-picker'],
    );
    const picked = models.options.find((entry) => entry.selection.source === 'cli-cache')!;
    assert.deepEqual(terminalModelArguments(picked.selection), ['--model', 'synthetic-picker']);
    assert.throws(
      () => terminalModelArguments({ ...picked.selection, expiresAt: Date.now() - 1 }),
      /expired/,
    );
    assert.deepEqual(terminalModelArguments(models.options[0]!.selection), []);
    writeFileSync(join(f.home, '.codex/models_cache.json'), '{"models":[]}', { mode: 0o600 });
    assert.throws(() => terminalModelArguments(picked.selection), /catalogue changed/);
  } finally {
    f.close();
  }
});

test('Claude aliases have official provenance and OpenCode exposes only explicit configured IDs', () => {
  const f = fixture();
  try {
    const claude = discoverTerminalModels('claude', f.project, f.home, {});
    assert.deepEqual(
      claude.options.map((entry) => entry.selection.value),
      [null, 'sonnet', 'opus', 'haiku'],
    );
    assert.ok(
      claude.options.slice(1).every((entry) => entry.selection.source === 'official-alias'),
    );
    writeFileSync(
      join(f.home, '.config/opencode/opencode.json'),
      JSON.stringify({
        model: 'synthetic/chosen',
        provider: { synthetic: { models: { custom: {}, other: {} } } },
      }),
      { mode: 0o600 },
    );
    const opencode = discoverTerminalModels('opencode', f.project, f.home, {});
    assert.equal(opencode.limited, true);
    assert.deepEqual(
      opencode.options.map((entry) => entry.selection.value),
      [null, 'synthetic/chosen', 'synthetic/custom', 'synthetic/other'],
    );
    assert.deepEqual(terminalModelArguments(opencode.options[2]!.selection), [
      '--model',
      'synthetic/custom',
    ]);
    writeFileSync(
      join(f.home, '.config/opencode/opencode.json'),
      JSON.stringify({
        model: { providerID: 'synthetic', model: 'v2', variant: 'focused' },
        providers: { synthetic: { models: { native: {}, disabled: { disabled: true } } } },
      }),
      { mode: 0o600 },
    );
    assert.deepEqual(
      discoverTerminalModels('opencode', f.project, f.home, {}).options.map(
        (entry) => entry.selection.value,
      ),
      [null, 'synthetic/v2#focused', 'synthetic/native'],
    );
    writeFileSync(
      join(f.home, '.config/opencode/opencode.json'),
      '{/* JSONC is delegated to CLI */}',
      { mode: 0o600 },
    );
    assert.deepEqual(
      discoverTerminalModels('opencode', f.project, f.home, {}).options.map(
        (entry) => entry.selection.value,
      ),
      [null],
    );
  } finally {
    f.close();
  }
});

test('catalogue limits and unsafe model values cannot create executable arguments', () => {
  const f = fixture();
  try {
    writeFileSync(join(f.home, '.claude/settings.json'), JSON.stringify({ model: '--dangerous' }), {
      mode: 0o600,
    });
    assert.ok(
      !discoverTerminalModels('claude', f.project, f.home, {}).options.some(
        (entry) => entry.selection.value === '--dangerous',
      ),
    );
    writeFileSync(join(f.home, '.codex/models_cache.json'), 'x'.repeat(2 * 1024 * 1024 + 1), {
      mode: 0o600,
    });
    assert.throws(() => discoverTerminalModels('codex', f.project, f.home, {}), /Untrusted/);
    assert.throws(() =>
      terminalSelectedRequestSchema.parse({
        action: 'create-selected',
        workspaceId: f.workspaceId,
        featureId: null,
        catalogId: 'a'.repeat(64),
        modelId: 'b'.repeat(64),
        provider: 'codex',
        count: 1,
        cwd: f.project,
      }),
    );
  } finally {
    f.close();
  }
});

test('workspace lookup is read-only, ID-bound and launch fences reject changed Feature/project', () => {
  const f = fixture();
  try {
    const before = readFileSync(f.trusted.observerDatabase);
    assert.equal(readTerminalWorkspace(f.trusted.observerDatabase, f.workspaceId), f.project);
    assert.deepEqual(readFileSync(f.trusted.observerDatabase), before);
    assert.throws(() => readTerminalWorkspace(f.trusted.observerDatabase, "' OR 1=1 --"));
    assert.throws(
      () => resolveTerminalPreparationContext(f.trusted, '0'.repeat(64), null),
      /unavailable/,
    );
    const resolved = resolveTerminalPreparationContext(f.trusted, f.workspaceId, null);
    const binding = {
      ...f.trusted,
      workspaceId: f.workspaceId,
      featureId: null,
      fence: resolved.fence,
    };
    validateTerminalPreparationBinding(binding, f.project);
    assert.throws(() => validateTerminalPreparationBinding(binding, f.home), /changed/);
    const features = featureConfigurationDatabase(f.trusted.preferencesDirectory, f.workspaceId);
    const feature = features.create({ name: 'Synthetic Feature' });
    features.saveView({ expectedRevision: 0, featureId: feature.featureId });
    assert.throws(() => validateTerminalPreparationBinding(binding, f.project), /Feature changed/);
    assert.equal(stableId('workspace', f.project), f.workspaceId);
  } finally {
    f.close();
  }
});
