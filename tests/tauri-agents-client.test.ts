// Synthetic invoke and activation only; actual shipped bundle is exercised by packaged acceptance.
import assert from 'node:assert/strict';
import test from 'node:test';
import type { ManagedAgentsRequest } from '@orqst/protocol';
import { createAgentsClient } from '../apps/tauri/src/agents-bridge.js';

test('Tauri agent adapter requires activation for every mutation, allows passive snapshots and rejects foreign fields', async () => {
  const calls: ManagedAgentsRequest[] = [];
  let active = false;
  const client = createAgentsClient(
    async (request) => {
      calls.push(request);
      return { status: 'ok' };
    },
    () => active,
  );
  for (const request of [
    { version: 1, action: 'start', slot: 0, model: 'SYNTHETIC' },
    { version: 1, action: 'stop', slot: 0 },
    { version: 1, action: 'retire' },
    {
      version: 1,
      action: 'routing',
      slot: 0,
      update: { name: 'Synthetic', handle: 'synthetic', role: 'worker', allowedTargetPaneIds: [] },
    },
    {
      version: 1,
      action: 'delegate',
      sourceSlot: 0,
      text: 'SYNTHETIC',
      task: '@synthetic SYNTHETIC',
    },
  ] satisfies ManagedAgentsRequest[]) {
    assert.equal((await client.request(request)).status, 'denied');
    assert.equal(calls.length, 0);
  }
  assert.equal((await client.request({ version: 1, action: 'snapshot' })).status, 'ok');
  assert.equal(calls.length, 1);
  active = true;
  assert.equal(
    (await client.request({ version: 1, action: 'start', slot: 0, model: 'SYNTHETIC' })).status,
    'ok',
  );
  assert.equal(calls.length, 2);
  const foreign = { version: 1, action: 'snapshot', path: '/arbitrary' } as const;
  assert.equal((await client.request(foreign)).status, 'denied');
  assert.equal(calls.length, 2);
});

test('Tauri agent adapter rejects malformed native replies and suppresses private diagnostics', async () => {
  for (const invoke of [
    async () => ({ status: 'ok', signature: 'SYNTHETIC-private-proof' }),
    async () => {
      throw new Error('SYNTHETIC-private-path');
    },
  ]) {
    const client = createAgentsClient(invoke, () => true);
    assert.deepEqual(await client.request({ version: 1, action: 'snapshot' }), {
      status: 'unavailable',
    });
  }
});
