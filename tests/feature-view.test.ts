// SYNTHETIC metadata/view only; no agent, process, native window or input grant.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  featureNativeRequestSchema,
  type FeatureNativeRequest,
  type FeatureNativeSnapshot,
} from '@orqst/protocol';
import { featureConfigurationDatabase } from '../packages/core/src/terminal/feature-configuration.js';
import { terminalLayoutDatabase } from '../packages/core/src/terminal/layout-database.js';
import { TauriTerminalLayout } from '../apps/desktop/src/tauri-terminal-layout.js';
import { TauriFeatureService } from '../apps/desktop/src/tauri-feature-service.js';
import { terminalLayoutStore } from '../apps/desktop/src/terminal-layout-store.js';
import { featureLayout } from '../apps/desktop/src/feature-layout.js';
import { createFeatureClient } from '../apps/tauri/src/features-bridge.js';

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'orqst-feature-view-'));
  const db = featureConfigurationDatabase(directory, 'synthetic-workspace');
  const identities = Array.from({ length: 6 }, (_, slot) => ({
    slot,
    terminalId: randomUUID(),
    provider: 'codex' as const,
  }));
  const ids: string[] = identities.map((i) => i.terminalId);
  const core = {
    identities,
    features: {
      list: async () => db.list(),
      read: async (id: string) => db.read(id),
      create: async (input: Parameters<typeof db.create>[0]) => db.create(input),
      update: async (id: string, input: Parameters<typeof db.update>[1]) => db.update(id, input),
      assign: async (id: string, slot: number, revision: number) =>
        db.assignTerminal(id, ids[slot]!, revision),
      readView: async () => db.readView(),
      saveView: async (input: Parameters<typeof db.saveView>[0]) => db.saveView(input),
      readLayout: async (id: string) => db.readLayout(id),
      saveLayout: async (id: string, record: Parameters<typeof db.saveLayout>[1]) =>
        db.saveLayout(id, record),
    },
  };
  const legacyDb = terminalLayoutDatabase(directory, ids);
  const legacy = terminalLayoutStore(directory, ids, {
    read: async () => legacyDb.read(),
    save: async (r) => legacyDb.save(r),
    import: async (r) => legacyDb.import(r),
  });
  const messages: Array<Record<string, unknown>> = [];
  const revocations: number[] = [];
  const layout = new TauriTerminalLayout(
    6,
    { save: legacy.save },
    (v) => messages.push(v as Record<string, unknown>),
    (slot) => revocations.push(slot),
  );
  const service = new TauriFeatureService(
    core,
    layout,
    legacy,
    '/synthetic/project',
    async () => {
      revocations.push(...ids.map((_, i) => i));
    },
    () => {},
  );
  let snapshot: FeatureNativeSnapshot;
  const request = async (input: Omit<FeatureNativeRequest, 'generation' | 'contractVersion'>) => {
    const result = await service.request({
      ...input,
      contractVersion: 1,
      generation: snapshot?.generation ?? 0,
    });
    if (result.snapshot) snapshot = result.snapshot;
    return result;
  };
  return {
    directory,
    db,
    core,
    ids,
    service,
    layout,
    messages,
    revocations,
    request,
    snapshot: () => snapshot,
    close: () => rmSync(directory, { recursive: true, force: true }),
  };
}

test('Feature view context uses Core CAS, rejects foreign scopes and survives reopen without authority', () => {
  const f = fixture();
  try {
    const a = f.db.create({ name: 'SYNTHETIC A' });
    assert.deepEqual(f.db.readView(), {
      contractVersion: 1,
      storage: 'core',
      workspaceId: 'synthetic-workspace',
      featureId: null,
      revision: 0,
    });
    f.db.saveView({ expectedRevision: 0, featureId: a.featureId });
    assert.throws(() => f.db.saveView({ expectedRevision: 0, featureId: null }), /Stale/);
    assert.throws(
      () =>
        featureConfigurationDatabase(f.directory, 'foreign').saveView({
          expectedRevision: 0,
          featureId: a.featureId,
        }),
      /unavailable/,
    );
    const reopened = featureConfigurationDatabase(f.directory, 'synthetic-workspace');
    assert.equal(reopened.readView().featureId, a.featureId);
    assert.equal(reopened.readView().revision, 1);
  } finally {
    f.close();
  }
});

test('Feature service creates/edits/assigns and repeatedly filters six reviewed slots 3/2/1 with captured layout keys', async () => {
  const f = fixture();
  try {
    await f.service.initialize();
    await f.request({ action: 'snapshot' });
    const groups = [];
    let slot = 0;
    for (const [index, count] of [3, 2, 1].entries()) {
      assert.equal(
        (
          await f.service.request({
            contractVersion: 1,
            generation: f.snapshot().generation,
            action: 'create',
            input: { name: `SYNTHETIC ${index}` },
          })
        ).status,
        'ok',
      );
      await f.request({ action: 'snapshot' });
      let feature = f.snapshot().features.at(-1)!;
      for (let i = 0; i < count; i++) {
        const result = await f.service.request({
          contractVersion: 1,
          generation: f.snapshot().generation,
          action: 'assign',
          featureId: feature.featureId,
          slot: slot++,
          expectedRevision: feature.revision,
        });
        assert.equal(result.status, 'ok');
        await f.request({ action: 'snapshot' });
        feature = f.snapshot().features.at(-1)!;
      }
      groups.push(feature);
    }
    f.layout.resize(1440, 900);
    for (let cycle = 0; cycle < 4; cycle++)
      for (const [index, feature] of groups.entries()) {
        assert.equal(
          (
            await f.service.request({
              contractVersion: 1,
              generation: f.snapshot().generation,
              action: 'select',
              featureId: feature.featureId,
              expectedRevision: f.snapshot().view.revision,
            })
          ).status,
          'ok',
        );
        await f.request({ action: 'snapshot' });
        const expected = feature.terminalIds.map((id) => f.ids.indexOf(id));
        assert.deepEqual(f.layout.snapshot().order, expected);
        assert.equal(f.layout.snapshot().suspended, false);
        assert.equal(f.layout.act(expected[0]!, { columns: index + 1 }), true);
        await f.layout.flush();
        assert.equal(f.db.readLayout(feature.featureId)?.columns, index + 1);
        const before = f.db.readView();
        assert.equal(
          (
            await f.service.request({
              contractVersion: 1,
              generation: f.snapshot().generation,
              action: 'select',
              featureId: groups[(index + 1) % 3]!.featureId,
              expectedRevision: 0,
            })
          ).status,
          'stale',
        );
        assert.deepEqual(f.db.readView(), before);
      }
    const feature = groups[0]!;
    const result = await f.service.request({
      contractVersion: 1,
      generation: f.snapshot().generation,
      action: 'update',
      featureId: feature.featureId,
      input: { name: 'SYNTHETIC renamed', expectedRevision: feature.revision },
    });
    assert.equal(result.status, 'ok');
    assert.equal(f.db.read(feature.featureId).name, 'SYNTHETIC renamed');
    assert.equal(
      (
        await f.service.request({
          contractVersion: 1,
          generation: result.snapshot!.generation,
          action: 'update',
          featureId: feature.featureId,
          input: { status: 'archived', expectedRevision: feature.revision + 1 },
        })
      ).status,
      'archive_blocked',
    );
    assert.equal(f.db.read(feature.featureId).terminalIds.length, 3);
    assert.ok(f.revocations.length >= 6 * 12);
  } finally {
    f.close();
  }
});

test('empty Feature remains active chrome; a late selection/save ACK never reopens dashboard', async () => {
  const f = fixture();
  try {
    const empty = f.db.create({ name: 'SYNTHETIC empty' });
    await f.service.initialize();
    await f.request({ action: 'snapshot' });
    let release!: () => void;
    const saved = f.core.features.saveView;
    f.core.features.saveView = async (input) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return saved(input);
    };
    const selection = f.service.request({
      contractVersion: 1,
      generation: 0,
      action: 'select',
      featureId: empty.featureId,
      expectedRevision: 0,
    });
    while (!release) await new Promise((resolve) => setImmediate(resolve));
    f.layout.setNativeGeneration(2);
    f.layout.suspend();
    release();
    assert.equal((await selection).status, 'ok');
    assert.equal(f.layout.snapshot().suspended, true);
    f.core.features.saveView = saved;
    await f.request({ action: 'snapshot' });
    assert.equal(
      (
        await f.service.request({
          contractVersion: 1,
          generation: f.snapshot().generation,
          action: 'select',
          featureId: empty.featureId,
          expectedRevision: 1,
        })
      ).status,
      'ok',
    );
    assert.equal(f.layout.snapshot().workspaceChrome, true);
    assert.equal(f.layout.snapshot().suspended, false);
    assert.deepEqual(f.layout.snapshot().visible, []);
    const last = f.messages.at(-1)!;
    assert.equal(last.focus, null);
  } finally {
    f.close();
  }
});

test('unavailable Feature members retain layout metadata and are never mapped to unrelated selected slots', () => {
  const ids = Array.from({ length: 4 }, () => randomUUID());
  const members = ids.slice(0, 3);
  const first = featureLayout(ids, members, null);
  const record = first.record({
    ...first.initial,
    names: ['SYNTHETIC A', 'SYNTHETIC B', 'SYNTHETIC C', ''],
    columns: 3,
  });
  const next = featureLayout([ids[3]!, ids[1]!], members, record);
  assert.deepEqual(next.initial.order, [1]);
  const result = next.record({ ...next.initial, names: ['', 'SYNTHETIC edited'], columns: 1 });
  assert.deepEqual(result.order, members);
  assert.equal(result.names.find((n) => n.id === ids[0])?.name, 'SYNTHETIC A');
  assert.equal(result.names.find((n) => n.id === ids[1])?.name, 'SYNTHETIC edited');
  assert.equal(
    result.names.some((n) => n.id === ids[3]),
    false,
  );
});

test('metadata facade validates strict actions/replies and requires fresh activation for changes', async () => {
  let calls = 0;
  let active = false;
  const client = createFeatureClient(
    async () => {
      calls++;
      return { status: 'denied' };
    },
    () => active,
  );
  assert.equal(
    (await client.request({ contractVersion: 1, generation: 0, action: 'snapshot' })).status,
    'denied',
  );
  assert.equal(calls, 1);
  assert.equal(
    (
      await client.request({
        contractVersion: 1,
        generation: 0,
        action: 'create',
        input: { name: 'SYNTHETIC' },
      })
    ).status,
    'denied',
  );
  assert.equal(calls, 1);
  active = true;
  assert.equal(
    (
      await client.request({
        contractVersion: 1,
        generation: 0,
        action: 'create',
        input: { name: 'SYNTHETIC' },
      })
    ).status,
    'denied',
  );
  for (const extra of ['source', 'document', 'path', 'pid', 'proof', 'workspaceId'])
    assert.equal(
      featureNativeRequestSchema.safeParse({
        contractVersion: 1,
        generation: 0,
        action: 'snapshot',
        [extra]: 1,
      }).success,
      false,
    );
  const broken = createFeatureClient(
    async () => ({ status: 'ok', signature: 'forged' }),
    () => true,
  );
  assert.equal(
    (await broken.request({ contractVersion: 1, generation: 0, action: 'snapshot' })).status,
    'unavailable',
  );
});

test('oversized metadata snapshot fails explicitly while the selected Core catalog stays usable', async () => {
  const f = fixture();
  try {
    for (let index = 0; index < 50; index++)
      f.db.create({ name: `SYNTHETIC ${index}`, description: 'x'.repeat(2048) });
    await f.service.initialize();
    assert.equal(
      (await f.service.request({ contractVersion: 1, generation: 0, action: 'snapshot' })).status,
      'unavailable',
    );
    assert.equal(f.db.list().length, 50);
    assert.equal(f.db.readView().revision, 0);
    assert.deepEqual(f.layout.snapshot().order, [0, 1, 2, 3, 4, 5]);
  } finally {
    f.close();
  }
});
