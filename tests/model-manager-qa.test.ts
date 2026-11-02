// Independent Model Manager (observational slice) QA. Static/contract only; no new API or data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path: string) => readFile(path, 'utf8');

test('SessionView carries no availability, capability, catalogue or selection field', async () => {
  const protocol = await read('packages/protocol/src/index.ts');
  const start = protocol.indexOf('export interface SessionView {');
  assert.notEqual(start, -1);
  const block = protocol.slice(start, protocol.indexOf('}', start));
  const keys = [...block.matchAll(/^\s{2}(\w+)\??:/gm)].map((match) => match[1]);
  assert.deepEqual(keys, [
    'id',
    'workspaceId',
    'cwd',
    'agentName',
    'adapter',
    'status',
    'startedAt',
    'lastActivity',
    'task',
    'result',
    'model',
    'parentSessionId',
    'usage',
    'manualWorkspace',
  ]);
  // No payload expansion for discovery, availability, capabilities or selection.
  for (const forbidden of [
    'available',
    'availability',
    'capabilities',
    'catalog',
    'catalogue',
    'selected',
    'selection',
    'provider',
    'price',
    'cost',
  ])
    assert.equal(new RegExp(`\\b${forbidden}\\b`, 'i').test(block), false, forbidden);
});

test('the header qualifies the observed identifier without time, controls or usage claims', async () => {
  const app = await read('apps/dashboard/src/App.tsx');
  const start = app.indexOf('className="session-model"');
  assert.notEqual(start, -1);
  const block = app.slice(start, app.indexOf('</div>', start));
  for (const required of [
    "t('modelObservation.identifier')",
    "session.model ?? t('modelObservation.notRecorded')",
    "t('modelObservation.historyNote')",
    "t('modelObservation.availabilityNote')",
  ])
    assert.equal(block.includes(required), true, required);
  // No evidence time, no lastActivity as model time, no control, no metrics/provider claim.
  for (const forbidden of [
    '<time',
    'lastActivity',
    '<select',
    '<input',
    '<button',
    'onChange',
    'onClick',
    'usage',
    'provider',
    'price',
    'cost',
  ])
    assert.equal(block.includes(forbidden), false, forbidden);
  // The identifier stays React text inside <code>: never HTML or a link.
  assert.match(block, /<code>\{session\.model \?\?/);
  assert.equal(block.includes('dangerouslySetInnerHTML'), false);
});

test('no model API, IPC, filesystem or process surface is introduced', async () => {
  const app = await read('apps/dashboard/src/App.tsx');
  const server = await read('apps/bridge/src/server.ts');
  const preload = await read('apps/desktop/src/preload.ts');
  const main = await read('apps/desktop/src/main.ts');
  assert.equal(server.includes('/api/models'), false);
  assert.equal(preload.includes('orqstModels'), false);
  assert.equal(main.includes('orqst:models'), false);
  for (const forbidden of ['child_process', 'spawn(', 'exec(', 'node:fs', 'readFileSync'])
    assert.equal(app.includes(forbidden), false, forbidden);
  // The header never fetches a catalogue: the only model source is the snapshot field.
  assert.equal(/fetch\([^)]*model/i.test(app), false);
  assert.equal(app.includes("'/api/models'"), false);
});

test('both locales describe observation limits without claiming current or available', async () => {
  const en = JSON.parse(await read('apps/dashboard/src/locales/en-US.json')) as Record<
    string,
    unknown
  >;
  const pt = JSON.parse(await read('apps/dashboard/src/locales/pt-BR.json')) as Record<
    string,
    unknown
  >;
  const enKeys = Object.keys(en.modelObservation as Record<string, string>).sort();
  const ptKeys = Object.keys(pt.modelObservation as Record<string, string>).sort();
  assert.deepEqual(enKeys, ptKeys);
  assert.deepEqual(enKeys, [
    'availabilityNote',
    'historyNote',
    'identifier',
    'limits',
    'notRecorded',
  ]);
  const enText = Object.values(en.modelObservation as Record<string, string>).join(' ');
  const ptText = Object.values(pt.modelObservation as Record<string, string>).join(' ');
  for (const text of [enText, ptText]) {
    // Discovery is explicitly not implemented and nothing is verified.
    assert.match(text, /not implemented|não está implementada/i);
    assert.match(text, /time is unavailable|horário.*indisponível/i);
    assert.match(text, /not been verified|não foram verificadas/i);
    assert.equal(/\b(current model|modelo atual)\b/i.test(text), false);
  }
  assert.equal(
    (en.modelObservation as Record<string, string>).identifier,
    'Observed model identifier',
  );
  assert.equal(
    (pt.modelObservation as Record<string, string>).identifier,
    'Identificador de modelo observado',
  );
});
