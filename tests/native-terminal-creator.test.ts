import assert from 'node:assert/strict';
import test from 'node:test';
import {
  catalogModelId,
  dialogCatalog,
  groupRequests,
} from '../apps/dashboard/src/native-terminal-catalog.js';
import type { TerminalPreparationCatalog } from '../packages/protocol/src/index.js';

const id = (n: number) => String(n).repeat(64).slice(0, 64);
const model = (n: number, source: string, isDefault = false) => ({
  id: id(n),
  label: `synthetic-${n}`,
  source,
  isDefault,
  availability: 'unverified',
});
const catalog = {
  contractVersion: 1,
  workspaceId: 'synthetic',
  featureId: null,
  catalogId: id(9),
  providers: [
    {
      provider: 'codex',
      status: 'available',
      reason: 'ready',
      models: [model(1, 'cli-default'), model(2, 'native-config', true)],
    },
    { provider: 'claude', status: 'available', reason: 'ready', models: [model(3, 'cli-cache')] },
    { provider: 'opencode', status: 'unavailable', reason: 'executable_not_found', models: [] },
    {
      provider: 'antigravity',
      status: 'unavailable',
      reason: 'executable_unreviewed',
      models: [],
    },
  ],
} as unknown as TerminalPreparationCatalog;

test('dialog catalog shows confirmed models, hides CLI-default and forwards localized unavailable reasons', () => {
  const result = dialogCatalog(catalog, (reason) => `localized:${reason}`);
  assert.deepEqual(
    result.map((entry) => [
      entry.provider,
      entry.available,
      entry.reason ?? null,
      entry.models.map((m) => m.id),
    ]),
    [
      ['codex', true, null, [id(2)]],
      ['claude', true, null, [id(3)]],
      ['opencode', false, 'localized:executable_not_found', []],
      ['antigravity', false, 'localized:antigravity_executable_unreviewed', []],
    ],
  );
});

test('CLI default maps to the catalog entry, unknown models are refused', () => {
  const codex = catalog.providers[0];
  assert.equal(catalogModelId(codex, null), id(1));
  assert.equal(catalogModelId(codex, id(2)), id(2));
  assert.equal(catalogModelId(codex, id(7)), null);
  assert.equal(catalogModelId(catalog.providers[1], null), id(3));
  assert.equal(catalogModelId(undefined, null), null);
});

test('equal CLI and model requests become one native request with a count', () => {
  const base = { workspaceId: 'w', name: '', accountId: null, orchestrator: false };
  assert.deepEqual(
    groupRequests([
      { ...base, provider: 'codex', model: id(2) },
      { ...base, provider: 'claude', model: null },
      { ...base, provider: 'codex', model: id(2) },
    ]),
    [
      { provider: 'codex', model: id(2), count: 2 },
      { provider: 'claude', model: null, count: 1 },
    ],
  );
});
