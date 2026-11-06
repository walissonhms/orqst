// SYNTHETIC signed MCP exchanges and private metadata only. No provider or PTY input.
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import {
  chmodSync,
  linkSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { featureNativeReplySchema } from '@orqst/protocol';
import { mcpCommunicationJournal } from '../packages/core/src/terminal/mcp-communication.js';
import { featureConfigurationDatabase } from '../packages/core/src/terminal/feature-configuration.js';
import {
  TerminalAuthority,
  terminalChallengeBytes,
} from '../packages/core/src/terminal/authority.js';
import { McpTaskBroker } from '../packages/core/src/terminal/mcp-task.js';

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'orqst-synthetic-mcp-audit-')));
  const keys = generateKeyPairSync('ed25519');
  let now = 1000;
  const authority = new TerminalAuthority(
    new Map([['desktop-managed', keys.publicKey]]),
    () => now,
  );
  const db = featureConfigurationDatabase(root, 'synthetic-workspace');
  const ids: [string, string] = [randomUUID(), randomUUID()];
  let feature = db.create({ name: 'SYNTHETIC MCP' });
  for (const id of ids) feature = db.assignTerminal(feature.featureId, id, feature.revision);
  const journal = mcpCommunicationJournal(
    root,
    authority.epoch,
    'synthetic-workspace',
    ids,
    db.list,
  );
  const file = join(root, 'mcp-communication', `${authority.epoch}.jsonl`);
  const source = randomUUID(),
    target = randomUUID();
  const create = () => {
    const broker = new McpTaskBroker(
      authority,
      { sourceInstanceId: source, targetInstanceId: target, workspaceId: 'synthetic-workspace' },
      () => true,
      120000,
      journal.bind(source, target),
      () => now,
    );
    const prepared = broker.prepare();
    return {
      broker,
      authorize: () =>
        broker.authorize({
          challengeId: prepared.challenge.challengeId,
          signature: sign(
            null,
            terminalChallengeBytes(prepared.challenge),
            keys.privateKey,
          ).toString('base64url'),
        }),
    };
  };
  const exchange = async () => {
    const { broker, authorize } = create();
    authorize();
    const pending = broker.call('source', {
      name: 'delegate_task',
      arguments: { task: 'SYNTHETIC secret task' },
    });
    assert.deepEqual(journal.project(feature.featureId), { events: [] }); // queued is not delivery
    const delivery = (await broker.call('worker', { name: 'wait_task', arguments: {} })) as {
      taskId: string;
    };
    now++;
    await assert.rejects(
      broker.call('worker', {
        name: 'submit_result',
        arguments: { taskId: randomUUID(), result: 'wrong' },
      }),
    );
    assert.equal(journal.project(feature.featureId)?.events.length, 1);
    await broker.call('worker', {
      name: 'submit_result',
      arguments: { taskId: delivery.taskId, result: 'SYNTHETIC secret result' },
    });
    await pending;
    broker.close();
  };
  return {
    root,
    file,
    db,
    feature,
    ids,
    journal,
    create,
    exchange,
    close: () => rmSync(root, { recursive: true, force: true }),
  };
}

test('only accepted exact MCP delivery/result produce durable bounded metadata with stable IDs', async () => {
  const f = fixture();
  try {
    await f.exchange();
    const projection = f.journal.project(f.feature.featureId)!;
    assert.deepEqual(
      projection.events.map(({ from, to, kind, at }) => ({ from, to, kind, at })),
      [
        { from: f.ids[0], to: f.ids[1], kind: 'delegation', at: 1000 },
        { from: f.ids[1], to: f.ids[0], kind: 'result', at: 1001 },
      ],
    );
    assert.deepEqual(f.journal.project(f.feature.featureId), projection);
    const raw = readFileSync(f.file, 'utf8');
    assert.doesNotMatch(raw, /secret|SYNTHETIC/);
    const records = raw
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    assert.ok(
      records.every(
        (record) =>
          record.epoch &&
          record.grantId &&
          record.taskId &&
          record.sourceInstanceId &&
          record.targetInstanceId,
      ),
    );
    assert.deepEqual(f.journal.project(randomUUID()), { events: [] });
    assert.deepEqual(f.journal.project(null), { events: [] });
  } finally {
    f.close();
  }
});

test('no event before grant, no completion from disconnect, no result from uncorrelated calls', async () => {
  const f = fixture();
  const { broker, authorize } = f.create();
  try {
    await assert.rejects(
      broker.call('source', { name: 'delegate_task', arguments: { task: 'SYNTHETIC' } }),
    );
    assert.deepEqual(f.journal.project(f.feature.featureId), { events: [] });
    authorize();
    const pending = broker.call('source', {
      name: 'delegate_task',
      arguments: { task: 'SYNTHETIC' },
    });
    await broker.call('worker', { name: 'wait_task', arguments: {} });
    broker.close();
    assert.equal(((await pending) as { state: string }).state, 'unknown');
    assert.deepEqual(
      f.journal.project(f.feature.featureId)?.events.map((e) => e.kind),
      ['delegation'],
    );
  } finally {
    broker.close();
    f.close();
  }
});

test('Feature revision changes after grant do not relabel delivery into another context', async () => {
  const f = fixture();
  const { broker, authorize } = f.create();
  try {
    authorize();
    f.db.update(f.feature.featureId, {
      expectedRevision: f.feature.revision,
      name: 'SYNTHETIC changed',
    });
    const pending = broker.call('source', {
      name: 'delegate_task',
      arguments: { task: 'SYNTHETIC' },
    });
    await broker.call('worker', { name: 'wait_task', arguments: {} });
    broker.close();
    await pending;
    assert.deepEqual(f.journal.project(f.feature.featureId), { events: [] });
  } finally {
    broker.close();
    f.close();
  }
});

for (const change of ['rewrite', 'replace', 'symlink', 'hardlink', 'mode'] as const) {
  test(`unsafe ${change} audit becomes unavailable without changing MCP completion`, async () => {
    const f = fixture();
    try {
      if (change === 'rewrite') writeFileSync(f.file, 'SYNTHETIC corruption');
      if (change === 'replace') {
        renameSync(f.file, `${f.file}.old`);
        writeFileSync(f.file, '', { mode: 0o600 });
      }
      if (change === 'symlink') {
        renameSync(f.file, `${f.file}.old`);
        symlinkSync(`${f.file}.old`, f.file);
      }
      if (change === 'hardlink') linkSync(f.file, `${f.file}.link`);
      if (change === 'mode') chmodSync(f.file, 0o644);
      const { broker, authorize } = f.create();
      authorize();
      const pending = broker.call('source', {
        name: 'delegate_task',
        arguments: { task: 'SYNTHETIC' },
      });
      const delivered = (await broker.call('worker', { name: 'wait_task', arguments: {} })) as {
        taskId: string;
      };
      await broker.call('worker', {
        name: 'submit_result',
        arguments: { taskId: delivered.taskId, result: 'SYNTHETIC' },
      });
      assert.equal(((await pending) as { state: string }).state, 'completed');
      broker.close();
      assert.equal(f.journal.project(f.feature.featureId), undefined);
    } finally {
      f.close();
    }
  });
}

test('facade protocol rejects raw bodies, self links, unknown endpoints, other Features and duplicate IDs', async () => {
  const f = fixture();
  try {
    await f.exchange();
    const snapshot = {
      contractVersion: 1,
      storage: 'core',
      generation: 0,
      workspace: { id: 'synthetic-workspace', name: 'SYNTHETIC' },
      features: [f.feature],
      view: {
        contractVersion: 1,
        storage: 'core',
        workspaceId: 'synthetic-workspace',
        featureId: f.feature.featureId,
        revision: 1,
      },
      activeFeatureId: f.feature.featureId,
      slots: f.ids.map((terminalId, slot) => ({ slot, terminalId, provider: 'codex' })),
      layoutSaved: false,
    };
    const reply = {
      status: 'ok',
      snapshot,
      communication: f.journal.project(f.feature.featureId)!,
    };
    assert.ok(featureNativeReplySchema.safeParse(reply).success);
    for (const patch of [
      { kind: 'message' },
      { from: randomUUID() },
      { to: f.ids[0] },
      { text: 'SYNTHETIC' },
      { at: -1 },
    ]) {
      const bad = structuredClone(reply);
      Object.assign(bad.communication.events[0]!, patch);
      assert.equal(featureNativeReplySchema.safeParse(bad).success, false);
    }
    const duplicate = structuredClone(reply);
    duplicate.communication.events.push(duplicate.communication.events[0]!);
    assert.equal(featureNativeReplySchema.safeParse(duplicate).success, false);
    const foreign = {
      ...reply,
      snapshot: { ...snapshot, activeFeatureId: null, view: { ...snapshot.view, featureId: null } },
    };
    assert.equal(featureNativeReplySchema.safeParse(foreign).success, false);
    const tooMany = structuredClone(reply);
    tooMany.communication.events = Array.from({ length: 51 }, () => ({
      ...reply.communication.events[0]!,
      id: randomUUID(),
    }));
    assert.equal(featureNativeReplySchema.safeParse(tooMany).success, false);
  } finally {
    f.close();
  }
});
