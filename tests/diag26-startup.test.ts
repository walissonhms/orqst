import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  rmSync,
  readdirSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { defaultFeatureId } from '@orqst/protocol';
import { savedTerminalMetadata } from '../apps/desktop/src/saved-terminal-metadata.js';
import { loadTerminalCatalog } from '../apps/dashboard/src/terminal-catalog-cache.js';
import {
  readStudioFeatureTree,
  withTerminalPreferences,
} from '../packages/core/src/terminal/layout-database.js';
import { createTauriStudioClient } from '../apps/tauri/src/studio-bridge.js';

test('startup tree is passive, includes only managed Features, and reads the saved selection', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'orqst-diag26-unit-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.deepEqual(readStudioFeatureTree(dir), []);
  assert.deepEqual(readdirSync(dir), []);

  withTerminalPreferences(dir, (store) => {
    store.workspace('/synthetic/observed-only', 'Observed only');
    const features = store.features();
    features.saveView('synthetic-managed', {
      featureId: defaultFeatureId('synthetic-managed'),
      expectedRevision: 0,
    });
    const created = features.create({ workspaceId: 'synthetic-managed', name: 'Review' });
    features.saveView('synthetic-managed', { featureId: created.featureId, expectedRevision: 1 });
  });

  const [saved, ...other] = readStudioFeatureTree(dir);
  assert.ok(saved);
  assert.deepEqual(other, []);
  assert.equal(saved.id, 'synthetic-managed');
  assert.equal(saved.features.length, 2);
  assert.equal(
    saved.features.find(({ featureId }) => featureId === saved.view.featureId)?.name,
    'Review',
  );
});

test('startup and discovery can reach native without activation, and selection stays gated', async () => {
  const commands: unknown[] = [];
  const client = createTauriStudioClient(
    async (request) => {
      commands.push(request);
      return { status: 'denied' };
    },
    () => false,
  );
  const scope = { workspaceId: 'synthetic-workspace', featureId: null };
  for (const action of ['startup', 'discovery'] as const) await client.request({ action });
  await client.request({ action: 'catalog', ...scope });
  assert.deepEqual(await client.request({ action: 'review', generation: 2 }), {
    status: 'focus_required',
  });
  assert.deepEqual(commands, [
    { action: 'startup' },
    { action: 'discovery' },
    { action: 'catalog', ...scope },
  ]);
});

test('a refused passive catalog read can be retried in the same scope', async () => {
  let calls = 0;
  const scope = { workspaceId: 'synthetic-workspace', featureId: null };
  const native = createTauriStudioClient(
    async () => {
      calls++;
      return { status: calls === 1 ? 'busy' : 'denied' };
    },
    () => false,
  );
  assert.equal((await loadTerminalCatalog(native, scope)).status, 'busy');
  assert.equal((await loadTerminalCatalog(native, scope, true)).status, 'denied');
  assert.equal(calls, 2);
});

test('startup tree reads a Feature file written before display identities existed', async (t) => {
  const { DatabaseSync } = await import('node:sqlite');
  const dir = mkdtempSync(join(tmpdir(), 'orqst-diag27-unit-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  let featureId = '';
  withTerminalPreferences(dir, (store) => {
    const features = store.features();
    features.saveView('synthetic-legacy', {
      featureId: defaultFeatureId('synthetic-legacy'),
      expectedRevision: 0,
    });
    featureId = features.create({ workspaceId: 'synthetic-legacy', name: 'Legacy' }).featureId;
  });
  const file = join(dir, 'terminal-layouts', 'preferences.sqlite');
  const terminalId = '00000000-0000-4000-8000-000000000001';
  const legacy = new DatabaseSync(file);
  // Synthetic pre-display file: the membership exists, the display and label tables do not.
  legacy.exec(
    'DROP TABLE feature_orchestrator_labels; DROP INDEX feature_terminal_current_ordinal; DROP TABLE feature_terminal_displays;',
  );
  legacy
    .prepare('INSERT INTO feature_terminal_assignments VALUES (?, ?)')
    .run(terminalId, featureId);
  legacy.close();

  const [workspace] = readStudioFeatureTree(dir);
  const feature = workspace?.features.find((entry) => entry.featureId === featureId);
  assert.ok(feature);
  assert.deepEqual(feature.terminalIds, [terminalId]);
  assert.equal(feature.terminalDisplays, undefined);
  assert.equal(feature.orchestratorTerminalId, null);
  const tables = new DatabaseSync(file, { readOnly: true });
  t.after(() => tables.close());
  assert.equal(
    tables.prepare("SELECT 1 FROM sqlite_schema WHERE name='feature_terminal_displays'").get(),
    undefined,
    'the passive read must not migrate the file',
  );
});

test('native saved terminal metadata preserves a synthetic legacy reservation and ignores foreign IDs', (t) => {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'orqst-saved-terminal-')));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const terminalId = randomUUID();
  const featureId = randomUUID();
  const workspaceId = 'synthetic-managed';
  const state = join(parent, `terminal-pair-${randomUUID()}`, 'A');
  const file = join(state, 'terminal.json');
  const managed = join(parent, 'managed-agents');
  mkdirSync(state, { recursive: true, mode: 0o700 });
  mkdirSync(managed, { mode: 0o700 });
  writeFileSync(
    file,
    JSON.stringify({ version: 1, identity: { terminalId }, state, project: '/synthetic' }),
    { mode: 0o600 },
  );
  const markerPath = join(managed, 'active-pair.json');
  const marker = JSON.stringify({
    version: 1,
    owner: randomUUID(),
    epoch: randomUUID(),
    manifests: [file],
  });
  writeFileSync(markerPath, marker, { mode: 0o600 });
  withTerminalPreferences(managed, (store) => {
    const features = store.features();
    const general = defaultFeatureId(workspaceId);
    features.saveView(workspaceId, { featureId: general, expectedRevision: 0 });
    features.assignTerminal({ featureId: general, workspaceId }, terminalId, 1);
    store.terminalLayouts(general).save([terminalId], {
      version: 1,
      axis: 'columns',
      columns: 2,
      percent: 50,
      order: [terminalId],
      shown: [terminalId],
      active: terminalId,
      maximized: null,
      names: [{ id: terminalId, name: 'Codex 1' }],
    });
  });
  assert.equal(
    readStudioFeatureTree(managed)[0]?.features[0]?.terminalDisplays?.[0]?.name,
    'Codex 1',
  );
  assert.deepEqual(savedTerminalMetadata(parent, new Set([terminalId])).get(terminalId), {
    provider: 'codex',
    project: '/synthetic',
    activeReservation: true,
  });
  assert.equal(savedTerminalMetadata(parent, new Set([featureId])).size, 0);
  assert.equal(readFileSync(markerPath, 'utf8'), marker);
  assert.deepEqual(readdirSync(state), ['terminal.json']);
});
