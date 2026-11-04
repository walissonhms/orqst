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
