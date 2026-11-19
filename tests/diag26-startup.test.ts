import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { defaultFeatureId } from '@orqst/protocol';
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
