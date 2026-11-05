import assert from 'node:assert/strict';
import test from 'node:test';
import { createTauriStudioClient } from '../apps/tauri/src/studio-bridge.js';
import { createTerminalClient } from '../apps/desktop/src/terminal-client.js';
import { createAgentsClient } from '../apps/tauri/src/agents-bridge.js';
import { createFeatureClient } from '../apps/tauri/src/features-bridge.js';
import en from '../apps/dashboard/src/locales/en-US.json';
import pt from '../apps/dashboard/src/locales/pt-BR.json';

test('native admission refusal crosses each typed client once without retry', async () => {
  let calls = 0;
  const invoke = async () => {
    calls++;
    return { status: 'rate_limited' };
  };
  const studio = createTauriStudioClient(invoke, () => true);
  const terminal = createTerminalClient(invoke, () => true);
  const agents = createAgentsClient(invoke, () => true);
  const features = createFeatureClient(invoke, () => true, invoke);
  assert.equal(
    (await studio.request({ action: 'catalog', workspaceId: 'synthetic', featureId: null })).status,
    'rate_limited',
  );
  assert.equal(
    (await terminal.request({ version: 1, action: 'open', profileId: 'synthetic' })).status,
    'rate_limited',
  );
  assert.equal(
    (await agents.request({ version: 1, action: 'start', slot: 0, model: 'synthetic' })).status,
    'rate_limited',
  );
  assert.equal(
    (
      await features.showPreparationDrawer!({
        contractVersion: 1,
        generation: 1,
        workspaceId: 'synthetic',
        featureId: null,
        expectedRevision: 0,
      })
    ).status,
    'rate_limited',
  );
  assert.equal(calls, 4);
  for (const locale of [en, pt]) {
    for (const section of [
      locale.studio,
      locale.managedTerminal,
      locale.managedAgents,
      locale.features,
    ]) {
      assert.ok(section.rate_limited.length > 0);
    }
  }
});
