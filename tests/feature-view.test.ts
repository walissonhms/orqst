// SYNTHETIC metadata/view only; no agent, process, native window or input grant.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  featureNativeRequestSchema,
  featureNativeEnvelopeSchema,
  featureNativeReplyEnvelopeSchema,
  type FeatureNativeRequest,
  type FeatureNativeSnapshot,
} from '@orqst/protocol';
import { featureConfigurationDatabase } from '../packages/core/src/terminal/feature-configuration.js';
import { terminalLayoutDatabase } from '../packages/core/src/terminal/layout-database.js';
import { TauriTerminalLayout } from '../apps/desktop/src/tauri-terminal-layout.js';
import { TauriFeatureService } from '../apps/desktop/src/tauri-feature-service.js';
import { terminalLayoutStore } from '../apps/desktop/src/terminal-layout-store.js';
import { appendTerminalLayout } from '../apps/desktop/src/terminal-layout-enrollment.js';
import { featureLayout } from '../apps/desktop/src/feature-layout.js';
import { createFeatureClient } from '../apps/tauri/src/features-bridge.js';
import { FeatureRevisionConflict } from '../apps/desktop/src/managed-terminal-core.js';

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
      readPermissions: async (id: string) => ({
        schemaVersion: 1 as const,
        workspaceId: (await db.readView()).workspaceId,
        featureId: id,
        revision: 0,
        configuration: null,
      }),
      savePermissions: async (id: string) => ({
        schemaVersion: 1 as const,
        workspaceId: (await db.readView()).workspaceId,
        featureId: id,
        revision: 0,
        configuration: null,
      }),
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
    assert.equal((await selection).status, 'unavailable');
    assert.equal(f.db.readView().featureId, empty.featureId);
    assert.equal(f.layout.snapshot().suspended, true);
    f.core.features.saveView = saved;
    const messagesBeforeRead = f.messages.length;
    await f.request({ action: 'snapshot' });
    assert.equal(f.snapshot().view.featureId, empty.featureId);
    assert.equal(f.snapshot().activeFeatureId, null);
    assert.equal(f.messages.length, messagesBeforeRead);
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

test('selection revokes before metadata reads and a navigation during refresh cannot apply its view', async () => {
  const f = fixture();
  try {
    const feature = f.db.create({ name: 'SYNTHETIC delayed refresh' });
    await f.service.initialize();
    let release!: () => void;
    const list = f.core.features.list;
    f.core.features.list = async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return list();
    };
    const before = f.revocations.length;
    const pending = f.service.request({
      contractVersion: 1,
      generation: 0,
      action: 'select',
      featureId: feature.featureId,
      expectedRevision: 0,
    });
    assert.equal(f.revocations.length, before + 6);
    while (!release) await new Promise((resolve) => setImmediate(resolve));
    f.layout.setNativeGeneration(1);
    f.layout.suspend();
    f.core.features.list = list;
    release();
    assert.equal((await pending).status, 'unavailable');
    await f.request({ action: 'snapshot' });
    assert.equal(f.snapshot().activeFeatureId, null);
    assert.equal(f.layout.snapshot().suspended, true);
  } finally {
    f.close();
  }
});

test('confirmed CAS refusal stays distinct from uncertain transport without a write retry', async () => {
  const f = fixture();
  try {
    const feature = f.db.create({ name: 'SYNTHETIC CAS' });
    await f.service.initialize();
    let writes = 0;
    for (const [error, expected] of [
      [new FeatureRevisionConflict(), 'stale'],
      [new Error('transport'), 'unavailable'],
    ] as const) {
      f.core.features.update = async () => {
        writes++;
        throw error;
      };
      const result = await f.service.request({
        contractVersion: 1,
        generation: 0,
        action: 'update',
        featureId: feature.featureId,
        input: { expectedRevision: feature.revision, name: 'SYNTHETIC edited' },
      });
      assert.equal(result.status, expected);
    }
    assert.equal(writes, 2);
    assert.equal(f.db.read(feature.featureId).revision, 1);
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

test('private metadata namespaces retain wire UUIDs and reject forged envelope fields', () => {
  const envelope = {
    kind: 'feature-request',
    id: randomUUID(),
    document: 1,
    source: 'orqst-features://local/index.html',
    request: { contractVersion: 1, generation: 0, action: 'snapshot' },
  };
  assert.equal(featureNativeEnvelopeSchema.safeParse(envelope).success, true);
  for (const forged of [
    { ...envelope, kind: 'request' },
    { ...envelope, id: `feature-${envelope.id}` },
    { ...envelope, document: 0 },
    { ...envelope, focused: true },
    { ...envelope, request: { ...envelope.request, source: envelope.source } },
  ])
    assert.equal(featureNativeEnvelopeSchema.safeParse(forged).success, false);
  const reply = {
    kind: 'feature-reply',
    id: envelope.id,
    document: 1,
    value: { status: 'denied' },
  };
  assert.equal(featureNativeReplyEnvelopeSchema.safeParse(reply).success, true);
  assert.equal(
    featureNativeReplyEnvelopeSchema.safeParse({ ...reply, kind: 'reply' }).success,
    false,
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

test('live Feature append preserves saved order/names and uses membership CAS before presentation', async () => {
  const f = fixture();
  try {
    let feature = f.db.create({ name: 'SYNTHETIC live append' });
    for (const id of f.ids.slice(0, 2))
      feature = f.db.assignTerminal(feature.featureId, id, feature.revision);
    await f.service.initialize();
    await f.request({ action: 'snapshot' });
    assert.equal(
      (
        await f.service.request({
          contractVersion: 1,
          generation: 0,
          action: 'select',
          featureId: feature.featureId,
          expectedRevision: 0,
        })
      ).status,
      'ok',
    );
    f.layout.act(0, { name: 'SYNTHETIC retained' });
    f.layout.act(0, 'move-later');
    f.layout.act(0, { columns: 1 });
    await f.layout.flush();
    const previous = f.db.readLayout(feature.featureId)!;
    const terminalId = randomUUID();
    assert.throws(
      () => f.db.assignTerminal(feature.featureId, terminalId, feature.revision - 1),
      /Stale/,
    );
    assert.deepEqual(f.db.readLayout(feature.featureId), previous);
    feature = f.db.assignTerminal(feature.featureId, terminalId, feature.revision);
    f.db.saveLayout(feature.featureId, appendTerminalLayout(previous, feature.terminalIds));
    f.ids.push(terminalId);
    f.core.identities.push({ slot: 6, terminalId, provider: 'codex' });
    f.layout.append(6);
    const presentation = f.layout.presentationRevision();
    assert.equal(await f.service.enrolled(6, presentation), true);
    assert.deepEqual(f.layout.snapshot().order, [1, 0, 6]);
    assert.equal(f.layout.snapshot().names[0], 'SYNTHETIC retained');
    assert.equal(f.layout.snapshot().columns, 1);
    assert.equal(f.layout.snapshot().active, 6);
    await f.layout.flush();
    assert.deepEqual(f.db.readLayout(feature.featureId)?.order, [...previous.order, terminalId]);
    assert.equal(f.db.read(feature.featureId).revision, feature.revision);
    assert.throws(() => appendTerminalLayout(previous, [terminalId]), /cannot replace/);
  } finally {
    f.close();
  }
});

test('an old enrollment presentation ACK cannot reopen a suspended retained view', async () => {
  const f = fixture();
  try {
    await f.service.initialize();
    f.layout.open(0);
    const before = f.layout.snapshot();
    const presentation = f.layout.presentationRevision();
    const list = f.core.features.list;
    let release!: () => void;
    f.core.features.list = async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return list();
    };
    const pending = f.service.enrolled(0, presentation);
    while (!release) await new Promise((resolve) => setImmediate(resolve));
    f.layout.setNativeGeneration(10);
    f.layout.suspend();
    release();
    assert.equal(await pending, false);
    assert.equal(f.layout.snapshot().suspended, true);
    assert.deepEqual(f.layout.snapshot().order, before.order);
    assert.equal(f.messages.at(-1)?.focus, null);
  } finally {
    f.close();
  }
});

test('permission packets are separate from the renderer metadata envelope', async () => {
  const { featurePermissionNativeEnvelopeSchema } = await import('@orqst/protocol');
  const id = 'e10636eb-3a12-4094-9123-49a4cdad27b8';
  const packet = {
    kind: 'feature-permission-request',
    id,
    document: 2,
    source: 'orqst-features://local/index.html',
    request: { action: 'readPermissions', contractVersion: 1, generation: 7, featureId: id },
  };
  assert.equal(featurePermissionNativeEnvelopeSchema.safeParse(packet).success, true);
  assert.equal(
    featureNativeEnvelopeSchema.safeParse({ ...packet, kind: 'feature-request' }).success,
    false,
  );
  assert.equal(
    featurePermissionNativeEnvelopeSchema.safeParse({
      ...packet,
      source: 'https://example.invalid',
    }).success,
    false,
  );
  assert.equal(
    featurePermissionNativeEnvelopeSchema.safeParse({
      ...packet,
      request: { ...packet.request, actorId: 'fake' },
    }).success,
    false,
  );
});
