// Synthetic contracts only: no native app, Core, PTY or provider is started.
import assert from 'node:assert/strict';
import test from 'node:test';
import { featureNativeRequestSchema, featurePreparationRequestSchema } from '@orqst/protocol';
import { createFeatureClient } from '../apps/tauri/src/features-bridge.js';

const scope = {
  contractVersion: 1 as const,
  generation: 7,
  workspaceId: 'synthetic-workspace',
  featureId: '00000000-0000-4000-8000-000000000001',
  expectedRevision: 3,
};

test('passive preparation accepts only IDs/CAS and never enters the metadata allowlist', () => {
  for (const featureId of [scope.featureId, null])
    assert.equal(featurePreparationRequestSchema.safeParse({ ...scope, featureId }).success, true);
  for (const extra of [
    'action',
    'path',
    'executable',
    'pid',
    'proof',
    'source',
    'document',
    'epoch',
    'mcp',
    'provider',
    'modelId',
  ]) {
    assert.equal(
      featurePreparationRequestSchema.safeParse({ ...scope, [extra]: 'SYNTHETIC' }).success,
      false,
    );
  }
  for (const invalid of [
    { ...scope, featureId: 'title' },
    { ...scope, workspaceId: '/synthetic/path' },
    { ...scope, expectedRevision: -1 },
    { ...scope, generation: Number.MAX_SAFE_INTEGER + 1 },
    { ...scope, generation: undefined },
  ])
    assert.equal(featurePreparationRequestSchema.safeParse(invalid).success, false);
  assert.equal(
    featureNativeRequestSchema.safeParse({ ...scope, action: 'prepare' }).success,
    false,
  );
});

test('chrome navigation is opt-in, activation-bound, serialized with metadata and never invokes execution', async () => {
  let active = false;
  let metadata = 0;
  const sent: unknown[] = [];
  let complete!: (reply: unknown) => void;
  const invoke = async () => {
    metadata++;
    return { status: 'denied' };
  };
  assert.equal(createFeatureClient(invoke, () => true).showPreparationDrawer, undefined);
  const client = createFeatureClient(
    invoke,
    () => active,
    async (request) => {
      sent.push(request);
      return new Promise((resolve) => {
        complete = resolve;
      });
    },
  );
  assert.equal((await client.showPreparationDrawer!(scope)).status, 'denied');
  active = true;
  assert.equal(
    (await client.showPreparationDrawer!({ ...scope, path: '/SYNTHETIC' } as never)).status,
    'denied',
  );
  assert.equal(sent.length, 0);
  const pending = client.showPreparationDrawer!(scope);
  assert.equal((await client.showPreparationDrawer!(scope)).status, 'busy');
  assert.equal(
    (await client.request({ contractVersion: 1, generation: 0, action: 'snapshot' })).status,
    'busy',
  );
  assert.equal(metadata, 0);
  complete({ status: 'ok' });
  assert.equal((await pending).status, 'ok');
  assert.deepEqual(sent, [scope]);
  assert.equal(
    (await client.request({ contractVersion: 1, generation: 0, action: 'snapshot' })).status,
    'denied',
  );
  assert.equal(metadata, 1);
});

test('navigation preserves explicit refusal/staleness and rejects authority in replies', async () => {
  for (const status of ['denied', 'stale', 'busy', 'unavailable', 'ok'] as const) {
    const client = createFeatureClient(
      async () => null,
      () => true,
      async () => ({ status }),
    );
    assert.equal((await client.showPreparationDrawer!(scope)).status, status);
  }
  for (const invoke of [
    async () => ({ status: 'ok', proof: 'SYNTHETIC' }),
    async () => {
      throw Error('SYNTHETIC');
    },
  ]) {
    const client = createFeatureClient(
      async () => null,
      () => true,
      invoke,
    );
    assert.equal((await client.showPreparationDrawer!(scope)).status, 'unavailable');
    assert.equal((await client.showPreparationDrawer!(scope)).status, 'unavailable');
  }
});

test('only the exact top-level chrome receives passive navigation; Studio authority is absent', async () => {
  const { build } = await import('esbuild');
  const { runInNewContext } = await import('node:vm');
  const result = await build({
    entryPoints: ['apps/tauri/src/features-client.ts'],
    bundle: true,
    platform: 'browser',
    target: 'safari17',
    format: 'iife',
    write: false,
    logLevel: 'silent',
  });
  for (const [href, pathname, child, enabled] of [
    ['orqst-features://local/index.html', '/index.html', false, true],
    ['orqst-features://local/index.html?forged=1', '/index.html', false, false],
    ['orqst-features://other/index.html', '/index.html', false, false],
    ['orqst-features://local/index.html', '/index.html', true, false],
    ['http://127.0.0.1:4319/studio', '/studio', false, false],
  ] as const) {
    const calls: string[] = [];
    const owned: Record<string, unknown> = {
      addEventListener() {},
      __TAURI_INTERNALS__: {
        invoke: async (command: string) => {
          calls.push(command);
          return { status: 'ok' };
        },
      },
    };
    owned.self = owned;
    owned.top = child ? {} : owned;
    runInNewContext(result.outputFiles[0]!.text, {
      window: owned,
      location: { href, pathname },
      navigator: { userActivation: { isActive: true } },
    });
    const client = owned.orqstFeatures as ReturnType<typeof createFeatureClient> | undefined;
    assert.equal(typeof client?.showPreparationDrawer === 'function', enabled);
    assert.equal(owned.orqstTauriStudio, undefined);
    if (enabled) {
      assert.equal((await client!.showPreparationDrawer!(scope)).status, 'ok');
      assert.deepEqual(calls, ['feature_prepare']);
    } else assert.deepEqual(calls, []);
  }
});
