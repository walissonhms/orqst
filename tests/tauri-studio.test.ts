import assert from 'node:assert/strict';
import test from 'node:test';
import { tauriStudioRequestSchema, tauriStudioReplySchema } from '@orqst/protocol';
import { createTauriStudioClient } from '../apps/tauri/src/studio-bridge.js';

const empty = {
  generation: 1,
  limit: 8,
  count: 0,
  busy: false,
  canCreate: true,
  canReview: false,
  selectionLocked: false,
};

test('Tauri Studio accepts all homogeneous 1–8 choices and only a generation-bound review', () => {
  for (const provider of ['codex', 'claude'])
    for (let count = 1; count <= 8; count++)
      assert.equal(
        tauriStudioRequestSchema.safeParse({ action: 'create', generation: 1, provider, count })
          .success,
        true,
      );
  for (const input of [{ action: 'snapshot' }, { action: 'review', generation: 1 }])
    assert.equal(tauriStudioRequestSchema.safeParse(input).success, true);
});

test('Tauri Studio rejects paths, execution, mixed presets, Core methods and forged authority', async () => {
  let sent = 0;
  const client = createTauriStudioClient(
    async () => {
      sent++;
    },
    () => true,
  );
  const valid = { action: 'create', generation: 1, provider: 'codex', count: 1 };
  for (const input of [
    { ...valid, count: 0 },
    { ...valid, count: 9 },
    { ...valid, count: 1.5 },
    { ...valid, provider: 'opencode' },
    { ...valid, generation: -1 },
    { ...valid, generation: Number.MAX_SAFE_INTEGER + 1 },
    { ...valid, generation: undefined },
    { ...valid, files: ['/SYNTHETIC'] },
    { ...valid, path: '/SYNTHETIC' },
    { ...valid, pid: 123 },
    { ...valid, proof: {} },
    { ...valid, source: 'https://forged.invalid' },
    { ...valid, mcp: true },
    ...['currentCore', 'admissionOwner', 'initialFiles', 'epoch'].map((key) => ({
      ...valid,
      [key]: 'SYNTHETIC',
    })),
    { action: 'createMixed' },
    { action: 'start' },
    { action: 'login' },
    { action: 'prompt', task: 'SYNTHETIC' },
    { action: 'review', generation: 1, files: ['/SYNTHETIC'] },
    { action: 'snapshot', generation: 1 },
    { action: 'core', method: 'start' },
  ]) {
    assert.equal(tauriStudioRequestSchema.safeParse(input).success, false);
    assert.equal((await client.request(input as never)).status, 'denied');
  }
  assert.equal(sent, 0);
});

test('activation is required only for mutation; invalid replies and rejected IPC fail closed', async () => {
  const calls: unknown[] = [];
  let activated = false;
  let result: unknown = { status: 'ok', snapshot: empty };
  const client = createTauriStudioClient(
    async (request) => {
      calls.push(request);
      return result;
    },
    () => activated,
  );
  assert.equal(Object.isFrozen(client), true);
  assert.equal((await client.request({ action: 'snapshot' })).status, 'ok');
  assert.equal(
    (await client.request({ action: 'review', generation: 1 })).status,
    'focus_required',
  );
  assert.equal(calls.length, 1);
  activated = true;
  for (const reply of [
    { status: 'ok', snapshot: { ...empty, count: 9 } },
    { status: 'ok', snapshot: { ...empty, limit: 2 } },
    { status: 'ok', snapshot: { ...empty, files: ['/SYNTHETIC'] } },
    { status: 'ok', proof: 'SYNTHETIC' },
    { status: 'started' },
    { status: 'ok' },
  ]) {
    result = reply;
    assert.equal(tauriStudioReplySchema.safeParse(reply).success, false);
    assert.equal((await client.request({ action: 'review', generation: 1 })).status, 'unavailable');
  }
  const failed = createTauriStudioClient(
    async () => {
      throw new Error('SYNTHETIC');
    },
    () => true,
  );
  assert.deepEqual(await failed.request({ action: 'review', generation: 1 }), {
    status: 'unavailable',
  });
});

test('native facade bootstraps supported dashboard documents before SPA return, never child frames', async () => {
  const { build } = await import('esbuild');
  const { runInNewContext } = await import('node:vm');
  const result = await build({
    entryPoints: ['apps/tauri/src/studio-client.ts'],
    bundle: true,
    platform: 'browser',
    target: 'safari17',
    format: 'iife',
    write: false,
    logLevel: 'silent',
  });
  const script = result.outputFiles[0]!.text;
  for (const path of ['/', '/studio', '/overview', '/settings', '/workspaces']) {
    const calls: unknown[] = [];
    const owned: Record<string, unknown> = {
      __TAURI_INTERNALS__: {
        invoke: async (command: string, args: unknown) => {
          calls.push({ command, args });
          return { status: 'ok', snapshot: empty };
        },
      },
    };
    owned.top = owned.self = owned;
    runInNewContext(script, {
      window: owned,
      location: { pathname: path },
      navigator: { userActivation: { isActive: false } },
    });
    const client = owned.orqstTauriStudio as ReturnType<typeof createTauriStudioClient>;
    assert.equal(client.contractVersion, 1);
    assert.equal(Object.getOwnPropertyDescriptor(owned, 'orqstTauriStudio')!.writable, false);
    assert.equal((await client.request({ action: 'snapshot' })).status, 'ok');
    assert.equal(calls.length, 1);
    assert.equal((calls[0] as { command: string }).command, 'studio_request');
  }
  for (const [path, child] of [
    ['/unknown', false],
    ['/studio', true],
  ] as const) {
    const owned: Record<string, unknown> = {};
    owned.self = owned;
    owned.top = child ? {} : owned;
    runInNewContext(script, { window: owned, location: { pathname: path } });
    assert.equal(owned.orqstTauriStudio, undefined);
  }
});

const syntheticCatalog = {
  contractVersion: 1,
  workspaceId: 'synthetic-workspace',
  featureId: null,
  catalogId: 'a'.repeat(64),
  providers: ['codex', 'claude', 'opencode'].map((provider) => ({
    provider,
    status: 'available',
    reason: 'ready',
    models: [
      {
        id: 'b'.repeat(64),
        label: 'SYNTHETIC model',
        source: 'cli-cache',
        isDefault: false,
        availability: 'unverified',
      },
    ],
  })),
};

test('catalog loading is passive and selected opening carries scoped opaque IDs, never paths', async () => {
  let activated = false;
  const calls: unknown[] = [];
  const client = createTauriStudioClient(
    async (request) => {
      calls.push(request);
      return (request as { action: string }).action === 'catalog'
        ? { status: 'catalog', catalog: syntheticCatalog }
        : { status: 'ok', snapshot: empty };
    },
    () => activated,
  );
  const scope = { workspaceId: 'synthetic-workspace', featureId: null };
  assert.equal((await client.request({ action: 'catalog', ...scope })).status, 'catalog');
  const selected = {
    action: 'create-selected',
    generation: 1,
    ...scope,
    provider: 'opencode',
    count: 1,
    catalogId: 'a'.repeat(64),
    modelId: 'b'.repeat(64),
  } as const;
  assert.equal((await client.request(selected)).status, 'focus_required');
  activated = true;
  assert.equal((await client.request(selected)).status, 'ok');
  assert.deepEqual(calls, [{ action: 'catalog', ...scope }, selected]);
  for (const request of [
    { ...selected, project: '/SYNTHETIC' },
    { ...selected, model: 'arbitrary' },
    { ...selected, modelId: 'unknown' },
    { ...selected, generation: undefined },
    { ...selected, provider: 'other' },
    { ...selected, count: 9 },
    { action: 'catalog', ...scope, executable: '/SYNTHETIC' },
  ]) {
    assert.equal((await client.request(request as never)).status, 'denied');
  }
});

test('catalog replies validate source, unverified availability and bounded provider/model data', () => {
  assert.equal(
    tauriStudioReplySchema.safeParse({ status: 'catalog', catalog: syntheticCatalog }).success,
    true,
  );
  for (const catalog of [
    { ...syntheticCatalog, providers: [] },
    { ...syntheticCatalog, catalogId: 'forged' },
    { ...syntheticCatalog, path: '/SYNTHETIC' },
    {
      ...syntheticCatalog,
      providers: syntheticCatalog.providers.map((p) => ({
        ...p,
        models: [{ ...p.models[0], availability: 'entitled' }],
      })),
    },
  ])
    assert.equal(tauriStudioReplySchema.safeParse({ status: 'catalog', catalog }).success, false);
});

test('native live-enrollment capability is optional metadata and carries no path or capacity authority', () => {
  assert.equal(tauriStudioReplySchema.safeParse({ status: 'ok', snapshot: empty }).success, true);
  assert.equal(
    tauriStudioReplySchema.safeParse({ status: 'ok', snapshot: { ...empty, liveEnrollment: true } })
      .success,
    true,
  );
  for (const extra of [
    { liveEnrollment: 'true' },
    { capacity: 64 },
    { manifestFile: '/SYNTHETIC' },
  ])
    assert.equal(
      tauriStudioReplySchema.safeParse({ status: 'ok', snapshot: { ...empty, ...extra } }).success,
      false,
    );
});

test('preparation failures carry only bounded stage/code/effects and no retry authority', async () => {
  const failure = { stage: 'revalidation', code: 'catalog_changed', effects: 'not_started' };
  const reply = { status: 'denied', failure };
  let calls = 0;
  const client = createTauriStudioClient(
    async () => {
      calls++;
      return reply;
    },
    () => true,
  );
  assert.deepEqual(await client.request({ action: 'review', generation: 1 }), reply);
  assert.equal(calls, 1);
  for (const extra of ['stderr', 'message', 'path', 'config', 'proof', 'token', 'retry']) {
    assert.equal(
      tauriStudioReplySchema.safeParse({ ...reply, failure: { ...failure, [extra]: 'SYNTHETIC' } })
        .success,
      false,
    );
  }
  for (const invalid of [
    { ...failure, stage: 'unknown' },
    { ...failure, code: 'SYNTHETIC arbitrary text' },
    { ...failure, effects: 'none' },
    ...['bootstrap', 'provision', 'inspection', 'feature_assignment', 'opening'].map((stage) => ({
      ...failure,
      stage,
    })),
  ])
    assert.equal(tauriStudioReplySchema.safeParse({ ...reply, failure: invalid }).success, false);
  for (const status of ['ok', 'busy', 'focus_required'])
    assert.equal(
      tauriStudioReplySchema.safeParse({ status, snapshot: empty, failure }).success,
      false,
    );
});

test('batch contracts preserve exact per-item results and reject forged admission or native paths', async () => {
  const { randomUUID } = await import('node:crypto');
  const id = randomUUID();
  const terminalId = randomUUID();
  const request = {
    action: 'create-batch' as const,
    generation: 1,
    workspaceId: 'synthetic-workspace',
    featureId: null,
    catalogId: 'a'.repeat(64),
    requests: [
      {
        id,
        workspaceId: 'synthetic-workspace',
        provider: 'claude' as const,
        modelId: null,
        name: 'Synthetic batch',
      },
    ],
  };
  const accepted = {
    id,
    status: 'accepted',
    reason: 'core_enrolled',
    effects: 'possible',
    terminalId,
    slot: 0,
  };
  let value: unknown = { status: 'batch', items: [accepted] };
  let active = true;
  let sent = 0;
  const client = createTauriStudioClient(
    async () => {
      sent++;
      return value;
    },
    () => active,
  );
  assert.equal(tauriStudioRequestSchema.safeParse(request).success, true);
  assert.deepEqual(await client.request(request), value);
  for (const input of [
    { ...request, requests: [] },
    { ...request, requests: Array(9).fill(request.requests[0]) },
    { ...request, requests: [request.requests[0], request.requests[0]] },
    { ...request, requests: [{ ...request.requests[0], path: '/SYNTHETIC' }] },
    { ...request, requests: [{ ...request.requests[0], name: 'name\nforged' }] },
    { ...request, requests: [{ ...request.requests[0], name: 'x'.repeat(49) }] },
  ])
    assert.equal(tauriStudioRequestSchema.safeParse(input).success, false);
  for (const item of [
    { ...accepted, terminalId: undefined },
    { ...accepted, slot: undefined },
    { ...accepted, effects: 'not_started' },
    { ...accepted, file: '/SYNTHETIC' },
    { ...accepted, status: 'refused', effects: 'not_started' },
    { ...accepted, status: 'unknown' },
  ])
    assert.equal(
      tauriStudioReplySchema.safeParse({ status: 'batch', items: [item] }).success,
      false,
    );
  for (const reply of [
    { status: 'batch', items: [{ ...accepted, id: randomUUID() }] },
    {
      status: 'batch',
      items: [accepted, { ...accepted, id: randomUUID(), terminalId: randomUUID() }],
    },
    { status: 'ok', snapshot: empty },
  ]) {
    value = reply;
    assert.deepEqual(await client.request(request), { status: 'unavailable' });
  }
  value = {
    status: 'batch',
    items: [
      { id, status: 'unknown', effects: 'possible', reason: 'opening_uncertain', terminalId },
    ],
  };
  assert.deepEqual(await client.request(request), value);
  value = {
    status: 'batch',
    items: [{ id, status: 'refused', effects: 'not_started', reason: 'capacity_exceeded' }],
  };
  assert.deepEqual(await client.request(request), value);
  active = false;
  const previous = sent;
  assert.deepEqual(await client.request(request), { status: 'focus_required' });
  assert.equal(sent, previous);
});
