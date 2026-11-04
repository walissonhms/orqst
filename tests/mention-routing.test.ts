// Synthetic identities, content and disposable SQLite only; no provider or observed session.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Store } from '@orqst/database';
import type { CommunicationPane } from '@orqst/protocol';
import { PaneCommunication } from '../packages/core/src/communication/service.js';
import { mentionedHandles } from '../packages/core/src/communication/mentions.js';
import { terminalDigest } from '../packages/core/src/terminal/authority.js';
import { managedAgentsDocument } from '../apps/desktop/src/managed-agents-document.js';
import en from '../apps/dashboard/src/locales/en-US.json';
import pt from '../apps/dashboard/src/locales/pt-BR.json';

test('adapted Tucano mentions preserve order and ignore code, emails and escaped-at handles', () => {
  assert.deepEqual(mentionedHandles('mail@worker @@worker `@quoted` @Review @review @worker'), [
    'review',
    'worker',
  ]);
  assert.deepEqual(mentionedHandles('```md\n@hidden\n``` @shown ~~~\n@hidden'), ['shown']);
  assert.deepEqual(mentionedHandles('````\n``` @hidden ```\n```` @shown'), ['shown']);
  assert.deepEqual(mentionedHandles(`@${'x'.repeat(33)} @ok`), ['x'.repeat(33), 'ok']);
  assert.deepEqual(mentionedHandles('joã@worker mail+@worker mail.@worker @workeré'), []);
});

function fixture(file = ':memory:') {
  const store = new Store(file);
  const journal = store.communicationJournal(randomUUID(), { recover: false });
  const bytes = Buffer.from('SYNTHETIC task');
  const payload = { id: 'synthetic-content', bytes: bytes.length, sha256: terminalDigest(bytes) };
  const service = new PaneCommunication(journal, () => bytes);
  const register = (handle: string, workspaceId = 'synthetic', external = false) =>
    service.registerPane({
      workspaceId,
      name: handle,
      provider: 'synthetic-codex',
      cliVersion: null,
      model: null,
      ownerId: 'synthetic-owner',
      creationReason: 'synthetic-test',
      ownership: external ? 'external' : 'managed',
      binding: external
        ? null
        : { instanceId: randomUUID(), projectId: 'synthetic-project', terminalEpoch: randomUUID() },
      routing: external ? null : { handle, role: 'worker', allowedTargetPaneIds: [] },
      capabilities: {
        canSend: !external,
        canQueueWhileBusy: !external,
        canAcknowledge: !external,
        canReportTaskCompletion: !external,
        canCancel: !external,
      },
      state: 'ready',
    });
  const a = register('source');
  const b = register('worker');
  const configure = (
    source: CommunicationPane,
    targets: CommunicationPane[],
    handle = source.routing!.handle,
  ) =>
    service.configureRouting(source.paneId, {
      name: `renamed ${handle}`,
      handle,
      role: 'orchestrator',
      allowedTargetPaneIds: targets.map((p) => p.paneId),
    });
  const authorize = () =>
    service.authorize({
      actorId: 'synthetic',
      workspaceId: a.workspaceId,
      sourcePaneId: a.paneId,
      targetPaneIds: [b.paneId],
      expiresAt: Date.now() + 60000,
    });
  const request = () => ({
    schemaVersion: 1,
    messageId: randomUUID(),
    taskId: randomUUID(),
    correlationId: randomUUID(),
    workspaceId: a.workspaceId,
    sourcePaneId: a.paneId,
    targetPaneId: b.paneId,
    parentTaskId: null,
    kind: 'task.request',
    payload,
    deliveryPolicy: 'queue-if-busy',
    idempotencyKey: randomUUID(),
    deadline: Date.now() + 30000,
  });
  return { store, journal, service, register, a, b, configure, authorize, request };
}

test('workspace handles are unique and stable across rename, closure and explicit recovery', () => {
  const root = mkdtempSync(join(tmpdir(), 'orqst-synthetic-mentions-'));
  const f = fixture(join(root, 'private.sqlite'));
  try {
    assert.throws(() => f.register('worker'), /already registered/);
    const other = f.register('worker', 'other');
    assert.equal(f.service.resolveMention('other', '@worker').paneId, other.paneId);
    const updated = f.configure(f.b, [], 'reviewer');
    assert.equal(updated.paneId, f.b.paneId);
    assert.equal(updated.displayId, f.b.displayId);
    assert.throws(() => f.service.resolveMention('synthetic', '@worker'), /unavailable/);
    assert.equal(f.service.resolveMention('synthetic', '@REVIEWER `@ignored`').paneId, f.b.paneId);
    f.configure(f.a, [updated]);
    const recovered = new PaneCommunication(
      f.store.communicationJournal(randomUUID(), { recover: true }),
      () => new Uint8Array(),
    );
    const identity = recovered.resolveMention('synthetic', '@source');
    assert.deepEqual(identity.routing?.allowedTargetPaneIds, [updated.paneId]);
    assert.equal(identity.state, 'unavailable');
    recovered.setPaneState(updated.paneId, 'closed');
    assert.throws(() => recovered.resolveMention('synthetic', '@reviewer'), /unavailable/);
    assert.throws(
      () =>
        recovered.registerPane({
          ...updated,
          binding: { ...updated.binding!, instanceId: randomUUID() },
          state: 'ready',
          routing: { ...updated.routing!, allowedTargetPaneIds: [] },
        }),
      /already registered/,
    );
  } finally {
    f.store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('directed matrix fails closed at grant, admission and dispatch while read access preserves queued evidence', async () => {
  const f = fixture();
  try {
    assert.throws(f.authorize, /permission/);
    f.configure(f.a, [f.b]);
    const client = f.authorize();
    const message = client.send(f.request());
    let submitted = 0;
    f.service.enrollAdapter(f.b.paneId, f.b.binding!, {
      ready: () => true,
      submit: async () => {
        submitted++;
      },
    });
    f.configure(f.a, []);
    assert.throws(() => client.send(f.request()), /capabilities/);
    assert.equal(await f.service.dispatchNext(f.b.paneId), undefined);
    assert.equal(submitted, 0);
    assert.equal(client.status(message.messageId).deliveryState, 'queued');
    assert.equal(client.cancelQueued(message.messageId).taskState, 'cancelled');
    assert.ok(
      f.journal.transaction((tx) => tx.events(0)).some((e) => e.action === 'pane_routing_changed'),
    );
  } finally {
    f.store.close();
  }
});

test('matrix rejects self-send, direct and transitive cycles, duplicate targets, external and foreign panes', () => {
  const f = fixture();
  try {
    const c = f.register('third');
    f.configure(f.a, [f.b]);
    f.configure(f.b, [c]);
    assert.throws(() => f.configure(f.b, [f.a]), /cycle/);
    assert.throws(() => f.configure(c, [f.a]), /cycle/);
    assert.throws(() => f.configure(f.a, [f.a]), /target/);
    assert.throws(() => f.configure(f.a, [f.b, f.b]), /Duplicate/);
    assert.throws(() => f.configure(f.a, [f.register('foreign', 'foreign')]), /target/);
    assert.throws(() => f.configure(f.a, [f.register('observed', 'synthetic', true)]), /target/);
    assert.throws(() => f.configure(f.a, [], 'WORKER'), /pattern/);
    for (const text of [
      'no mention',
      '`@worker`',
      '@missing',
      '@worker @missing',
      '@' + 'x'.repeat(33),
    ])
      assert.throws(() => f.service.resolveMention('synthetic', text));
    assert.equal(f.service.resolveMention('synthetic', '@worker @WORKER').paneId, f.b.paneId);
  } finally {
    f.store.close();
  }
});

test('native communication document has localized accessible routing controls and escapes all labels', () => {
  for (const locale of [en, pt]) {
    const html = managedAgentsDocument('en-US', (key) => {
      const text =
        locale.managedAgents[
          key.slice('managedAgents.'.length) as keyof typeof locale.managedAgents
        ];
      assert.equal(typeof text, 'string', key);
      return text;
    });
    for (const id of ['source', 'role-0', 'role-1', 'route-0', 'route-1', 'mention-options'])
      assert.ok(html.includes(`id="${id}"`));
    assert.ok(html.includes('aria-describedby="mention-help"'));
  }
  const html = managedAgentsDocument('"><img src=x>', () => '"><img src=x>');
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('&lt;img'));
});
