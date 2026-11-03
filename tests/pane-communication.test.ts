// Synthetic contracts/transports and disposable SQLite only. No provider, PTY, credential or session access.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Store } from '@orqst/database';
import {
  communicationContentSchema,
  communicationLimits,
  type CommunicationMessage,
  type CommunicationPane,
  type CommunicationTransaction,
  type PaneProviderEvidence,
  type PaneSend,
} from '@orqst/protocol';
import {
  PaneCommunication,
  type CommunicationAdapter,
  type CommunicationClient,
  type CommunicationContentScope,
} from '../packages/core/src/communication/service.js';

const capabilities = {
  canSend: true,
  canQueueWhileBusy: true,
  canAcknowledge: true,
  canReportTaskCompletion: true,
  canCancel: false,
};
function setup(file = ':memory:') {
  const store = new Store(file);
  const journal = store.communicationJournal(randomUUID(), { recover: false });
  let clock = 100000;
  const contents = new Map<string, Uint8Array>();
  const content = (text: string) => {
    const bytes = Buffer.from(text);
    const ref = {
      id: randomUUID(),
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
    contents.set(ref.id, bytes);
    return ref;
  };
  const resolver = (_scope: Readonly<CommunicationContentScope>, id: string) => {
    const value = contents.get(id);
    if (!value) throw new Error('Synthetic missing content');
    return value;
  };
  const service = new PaneCommunication(journal, resolver, () => clock);
  const register = (
    name: string,
    adapter?: CommunicationAdapter,
    workspaceId = 'synthetic-workspace',
    provider = 'synthetic-codex',
  ) =>
    service.registerPane(
      {
        workspaceId,
        name,
        provider,
        cliVersion: 'synthetic-v1',
        model: `${name}-model`,
        ownership: 'managed',
        ownerId: 'synthetic-user',
        creationReason: 'synthetic contract test',
        binding: {
          instanceId: randomUUID(),
          projectId: 'synthetic-project',
          terminalEpoch: randomUUID(),
        },
        capabilities,
        state: 'ready',
      },
      adapter,
    );
  const a = register('initiator');
  const b = register('worker');
  const authorize = (source = a, targets = [b], actorId = 'synthetic-agent') =>
    service.authorize({
      actorId,
      workspaceId: source.workspaceId,
      sourcePaneId: source.paneId,
      targetPaneIds: targets.map((p) => p.paneId),
      expiresAt: clock + 800000,
    });
  const request = (source = a, target = b) => ({
    schemaVersion: 1 as const,
    messageId: randomUUID(),
    taskId: randomUUID(),
    correlationId: randomUUID(),
    workspaceId: source.workspaceId,
    sourcePaneId: source.paneId,
    targetPaneId: target.paneId,
    parentTaskId: null,
    kind: 'task.request' as const,
    payload: content('synthetic private prompt'),
    deliveryPolicy: 'queue-if-busy' as const,
    idempotencyKey: randomUUID(),
    deadline: clock + 700000,
  });
  const event = (
    m: CommunicationMessage,
    pane: CommunicationPane,
    kind: PaneProviderEvidence['event'],
    extra = {},
  ) => ({
    messageId: m.messageId,
    taskId: m.taskId,
    correlationId: m.correlationId,
    targetPaneId: m.targetPaneId,
    attemptId: m.attemptId!,
    instanceId: pane.binding!.instanceId,
    terminalEpoch: pane.binding!.terminalEpoch,
    evidenceId: randomUUID(),
    event: kind,
    ...extra,
  });
  return {
    store,
    journal,
    service,
    a,
    b,
    register,
    authorize,
    request,
    content,
    contents,
    resolver,
    event,
    now: () => clock,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}
function withFixture(action: (f: ReturnType<typeof setup>) => Promise<void> | void) {
  return async () => {
    const f = setup();
    try {
      await action(f);
    } finally {
      f.store.close();
    }
  };
}

test(
  'synthetic identified panes return a correlated result automatically after commit, independently of receipt',
  withFixture(async (f) => {
    const client = f.authorize();
    const seen: CommunicationMessage[] = [];
    client.subscribe((message) => {
      assert.equal(client.status(message.messageId).updatedAt, message.updatedAt);
      seen.push(message);
    });
    const result = f.content('synthetic verified result');
    f.service.enrollAdapter(f.b.paneId, f.b.binding!, {
      ready: () => true,
      submit: async (m, bytes, report) => {
        assert.equal(Buffer.from(bytes).toString(), 'synthetic private prompt');
        report(f.event(m, f.b, 'accepted'));
        assert.equal(client.status(m.messageId).taskState, 'pending');
        report(f.event(m, f.b, 'started'));
        assert.equal(client.status(m.messageId).deliveryState, 'accepted');
        report(f.event(m, f.b, 'completed', { result }));
      },
    });
    const admitted = client.send(f.request());
    assert.equal(admitted.deliveryState, 'queued');
    assert.equal(client.inbox().length, 0);
    const done = await f.service.dispatchNext(f.b.paneId);
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    assert.equal(done?.taskState, 'completed');
    assert.equal(done?.deliveryState, 'accepted'); // No receipt event was fabricated.
    assert.deepEqual(client.inbox()[0]?.result, result);
    assert.deepEqual(
      seen.map((m) => [m.deliveryState, m.taskState]),
      [
        ['dispatching', 'pending'],
        ['accepted', 'pending'],
        ['accepted', 'running'],
        ['accepted', 'completed'],
      ],
    );
    assert.notEqual(f.a.paneId, f.b.paneId);
    assert.equal(f.a.displayId, 'T-001');
    assert.equal(f.b.displayId, 'T-002');
  }),
);

test(
  'busy queue preserves FIFO and cannot dispatch simultaneous tasks to a target',
  withFixture(async (f) => {
    const client = f.authorize();
    const requests = [f.request(), f.request()];
    requests.forEach((r) => client.send(r));
    f.service.setPaneState(f.b.paneId, 'busy');
    const submitted: string[] = [];
    let report!: (e: PaneProviderEvidence) => void;
    let inFlight!: CommunicationMessage;
    f.service.enrollAdapter(f.b.paneId, f.b.binding!, {
      ready: () => true,
      submit: async (m, _bytes, callback) => {
        submitted.push(m.messageId);
        report = callback;
        inFlight = m;
        report(f.event(m, f.b, 'accepted'));
      },
    });
    assert.equal(await f.service.dispatchNext(f.b.paneId), undefined);
    f.service.setPaneState(f.b.paneId, 'ready');
    await Promise.all([f.service.dispatchNext(f.b.paneId), f.service.dispatchNext(f.b.paneId)]);
    assert.deepEqual(submitted, [requests[0]!.messageId]);
    assert.equal(client.status(requests[0]!.messageId).taskState, 'pending');
    report(f.event(inFlight, f.b, 'started'));
    report(f.event(inFlight, f.b, 'completed', { result: f.content('synthetic result') }));
    await f.service.dispatchNext(f.b.paneId);
    assert.deepEqual(
      submitted,
      requests.map((r) => r.messageId),
    );
  }),
);

test(
  'denies forged source, cross-workspace, external control, unknown targets and unscoped reads with metadata audit',
  withFixture((f) => {
    const client = f.authorize();
    const other = f.register('other', undefined, 'other-workspace');
    assert.throws(() => client.send({ ...f.request(), sourcePaneId: f.b.paneId }), /denied/);
    assert.throws(() => client.send(f.request(f.a, other)), /denied/);
    assert.throws(() => client.send({ ...f.request(), workspaceId: other.workspaceId }), /denied/);
    assert.throws(() => f.authorize(f.a, [other]), /denied/);
    assert.throws(() => client.status(randomUUID()), /unavailable/);
    assert.throws(() => client.send({ ...f.request(), targetPaneId: randomUUID() }), /denied/);
    const r = f.request();
    client.send(r);
    assert.throws(
      () => f.authorize(f.a, [f.b], 'another-actor').status(r.messageId),
      /unavailable/,
    );
    assert.ok(client.events(0).filter((e) => e.action === 'denied').length >= 5);
    assert.throws(
      () => f.service.registerPane({ ...f.b, ownership: 'external' }),
      /Unrecognized|read-only/,
    );
  }),
);

test(
  'idempotency returns original and rejects changed payload, task/message reuse or actor collision',
  withFixture((f) => {
    const client = f.authorize();
    const r = f.request();
    const original = client.send(r);
    assert.deepEqual(client.send({ ...r, messageId: randomUUID() }), original);
    assert.throws(() => client.send({ ...r, payload: f.content('replacement') }), /Idempotency/);
    assert.throws(() => client.send({ ...f.request(), messageId: r.messageId }), /identity/);
    assert.throws(() => client.send({ ...f.request(), taskId: r.taskId }), /identity/);
    assert.throws(() => f.authorize(f.a, [f.b], 'another-actor').send(r), /Idempotency/);
    assert.equal(f.journal.transaction((tx) => tx.messages()).length, 1);
  }),
);

test(
  'revocation and expiration prevent dispatch, reads, and post-commit notifications',
  withFixture(async (f) => {
    const client = f.authorize();
    const r = f.request();
    client.send(r);
    let calls = 0;
    let notifications = 0;
    client.subscribe(() => notifications++);
    f.service.enrollAdapter(f.b.paneId, f.b.binding!, {
      ready: () => true,
      submit: async () => {
        calls++;
      },
    });
    f.service.revoke(client);
    assert.equal(await f.service.dispatchNext(f.b.paneId), undefined);
    assert.throws(() => client.status(r.messageId), /revoked/);
    const newClient = f.authorize();
    f.service.reauthorize(newClient, r.messageId);
    f.advance(800001);
    assert.throws(() => newClient.inbox(), /expired/);
    await f.service.dispatchNext(f.b.paneId);
    assert.equal(calls, 0);
    assert.equal(notifications, 0);
  }),
);

test(
  'closure before dispatch fails distinctly; after acceptance preserves unknown outcome and process-independent state',
  withFixture(async (f) => {
    const client = f.authorize();
    const first = f.request();
    client.send(first);
    f.service.setPaneState(f.b.paneId, 'closed');
    assert.equal(client.status(first.messageId).deliveryState, 'target_closed');
    assert.equal(client.status(first.messageId).taskState, 'failed');
    assert.throws(() => f.service.setPaneState(f.b.paneId, 'ready'), /cannot be reused/);
    const c = f.register('third');
    const next = f.request(f.a, c);
    const second = f.authorize(f.a, [c]);
    second.send(next);
    f.service.enrollAdapter(c.paneId, c.binding!, {
      ready: () => true,
      submit: async (m, _b, report) => report(f.event(m, c, 'accepted')),
    });
    await f.service.dispatchNext(c.paneId);
    f.service.setPaneState(c.paneId, 'closed');
    assert.equal(second.status(next.messageId).deliveryState, 'accepted');
    assert.equal(second.status(next.messageId).taskState, 'outcome_unknown');
  }),
);

test(
  'queued cancellation and deadlines cannot manufacture provider cancellation or completion',
  withFixture(async (f) => {
    const client = f.authorize();
    const cancelled = f.request();
    client.send(cancelled);
    const result = client.cancelQueued(cancelled.messageId);
    assert.equal(result.taskState, 'cancelled');
    assert.equal(result.deliveryState, 'queued');
    const expired = { ...f.request(), deadline: f.now() + 10 };
    client.send(expired);
    f.advance(11);
    await f.service.dispatchNext(f.b.paneId);
    assert.equal(client.status(expired.messageId).reason, 'deadline');
    assert.equal(client.status(expired.messageId).taskState, 'failed');
  }),
);

test(
  'content references reject URLs/traversal, excessive bytes and digest drift before send',
  withFixture(async (f) => {
    const client = f.authorize();
    for (const id of ['../secret', 'file:///secret', 'https://example.org', 'local://secret'])
      assert.equal(
        communicationContentSchema.safeParse({ ...f.request().payload, id }).success,
        false,
      );
    assert.throws(() =>
      client.send({
        ...f.request(),
        payload: { ...f.request().payload, bytes: communicationLimits.payloadBytes + 1 },
      }),
    );
    const r = f.request();
    client.send(r);
    f.contents.set(r.payload.id, Buffer.from('changed'));
    let sends = 0;
    f.service.enrollAdapter(f.b.paneId, f.b.binding!, {
      ready: () => true,
      submit: async () => {
        sends++;
      },
    });
    await f.service.dispatchNext(f.b.paneId);
    assert.equal(sends, 0);
    assert.equal(client.status(r.messageId).reason, 'payload_unavailable');
  }),
);

test(
  'six synthetic panes retain independent identity/model, exact addressing, rename and non-reuse',
  withFixture((f) => {
    const extra = Array.from({ length: 4 }, (_, n) =>
      f.register(`claude-${n}`, undefined, f.a.workspaceId, 'synthetic-claude'),
    );
    assert.equal(new Set([f.a, f.b, ...extra].map((p) => p.model)).size, 6);
    f.service.renamePane(f.b.paneId, f.a.name);
    assert.throws(() => f.service.resolvePane(f.a.workspaceId, f.a.name), /ambiguous/);
    assert.equal(f.service.resolvePane(f.a.workspaceId, f.b.displayId).paneId, f.b.paneId);
    f.service.setPaneState(f.b.paneId, 'closed');
    assert.equal(f.register('next').displayId, 'T-007');
    assert.throws(() => f.service.resolvePane('another-workspace', f.a.paneId), /missing/);
  }),
);

test(
  'rejects cycles and enforces depth with explicit parent/task/correlation',
  withFixture((f) => {
    const client = f.authorize();
    const parent = f.request();
    client.send(parent);
    const back = f.authorize(f.b, [f.a]);
    assert.throws(
      () =>
        back.send({
          ...f.request(f.b, f.a),
          parentTaskId: parent.taskId,
          correlationId: parent.correlationId,
        }),
      /cycle/,
    );
    let previous: PaneSend = parent;
    let source = f.b;
    for (let depth = 1; depth <= 4; depth++) {
      const target = f.register(`depth-${depth}`);
      const r = {
        ...f.request(source, target),
        parentTaskId: previous.taskId,
        correlationId: parent.correlationId,
      };
      const sender = f.authorize(source, [target]);
      if (depth === 4) assert.throws(() => sender.send(r), /depth/);
      else {
        assert.equal(sender.send(r).depth, depth);
        previous = r;
        source = target;
      }
    }
  }),
);

test(
  'rate and queue capacities fail visibly without dropping prior requests',
  withFixture((f) => {
    const client = f.authorize();
    for (let n = 0; n < communicationLimits.admissionsPerMinute; n++) client.send(f.request());
    assert.throws(() => client.send(f.request()), /rate limit/);
    f.advance(60001);
    for (
      let n = communicationLimits.admissionsPerMinute;
      n < communicationLimits.queuedPerPane;
      n++
    )
      client.send(f.request());
    assert.throws(() => client.send(f.request()), /Queue/);
    assert.equal(
      f.journal.transaction((tx) => tx.messages()).length,
      communicationLimits.queuedPerPane,
    );
  }),
);

test(
  'wrong attempt/task/instance evidence and transport failures never retry or complete work',
  withFixture(async (f) => {
    const client = f.authorize();
    const r = f.request();
    client.send(r);
    let sends = 0;
    f.service.enrollAdapter(f.b.paneId, f.b.binding!, {
      ready: () => true,
      submit: async (m, _b, report) => {
        sends++;
        assert.throws(
          () => report(f.event(m, f.b, 'accepted', { taskId: randomUUID() })),
          /correlation/,
        );
        assert.throws(
          () => report(f.event(m, f.b, 'accepted', { instanceId: randomUUID() })),
          /correlation/,
        );
        assert.throws(
          () => report(f.event(m, f.b, 'accepted', { attemptId: randomUUID() })),
          /correlation/,
        );
        assert.throws(
          () => report(f.event(m, f.b, 'completed', { result: f.content('fake result') })),
          /acceptance/,
        );
        throw new Error('synthetic after possible side effects');
      },
    });
    await f.service.dispatchNext(f.b.paneId);
    await f.service.dispatchNext(f.b.paneId);
    assert.equal(client.status(r.messageId).deliveryState, 'delivery_unknown');
    assert.equal(client.status(r.messageId).taskState, 'outcome_unknown');
    assert.throws(() => client.cancelQueued(r.messageId), /undispatched/);
    assert.equal(sends, 1);
  }),
);

test('crash recovery preserves identities and queued work; fences stale writer and quarantines ambiguous attempts', async () => {
  const root = mkdtempSync(join(tmpdir(), 'orqst-synthetic-communication-'));
  const file = join(root, 'communication.db');
  const f = setup(file);
  let recovered: Store | undefined;
  try {
    const client = f.authorize();
    const one = f.request();
    const two = f.request();
    client.send(one);
    client.send(two);
    f.service.enrollAdapter(f.b.paneId, f.b.binding!, {
      ready: () => true,
      submit: async () => {
        /* Crash before acknowledgement. */
      },
    });
    await f.service.dispatchNext(f.b.paneId);
    recovered = new Store(file);
    assert.throws(() => recovered!.communicationJournal(randomUUID(), { recover: false }), /owned/);
    const journal = recovered.communicationJournal(randomUUID(), { recover: true });
    assert.throws(() => client.inbox(), /fenced/);
    const messages = journal.transaction((tx) => tx.messages());
    assert.equal(messages[0]?.deliveryState, 'delivery_unknown');
    assert.equal(messages[0]?.taskState, 'outcome_unknown');
    assert.equal(messages[1]?.deliveryState, 'queued');
    const panes = journal.transaction((tx) => tx.panes());
    assert.equal(panes[1]?.paneId, f.b.paneId);
    assert.equal(panes[1]?.displayId, f.b.displayId);
    assert.equal(panes[1]?.state, 'unavailable');
    const service = new PaneCommunication(journal, f.resolver, f.now);
    const regrant = service.authorize({
      actorId: 'synthetic-agent',
      workspaceId: f.a.workspaceId,
      sourcePaneId: f.a.paneId,
      targetPaneIds: [f.b.paneId],
      expiresAt: f.now() + 800000,
    });
    service.reauthorize(regrant, two.messageId);
    assert.throws(() => service.reauthorize(regrant, one.messageId), /undispatched/);
    assert.equal(await service.dispatchNext(f.b.paneId), undefined);
    assert.equal(statSync(file).mode & 0o777, 0o600);
    const snapshot =
      readFileSync(file).toString() +
      (await import('node:fs')).readFileSync(`${file}-wal`).toString();
    assert.equal(snapshot.includes('synthetic private prompt'), false);
    assert.equal(snapshot.includes('synthetic verified result'), false);
  } finally {
    recovered?.close();
    f.store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test(
  'escaped transaction handles, nested commits and stale ownership fail closed',
  withFixture((f) => {
    let leaked!: CommunicationTransaction;
    f.journal.transaction((tx) => {
      leaked = tx;
    });
    assert.throws(() => leaked.messages(), /expired/);
    assert.throws(
      () => f.store.transaction(() => f.journal.transaction(() => undefined)),
      /independent/,
    );
  }),
);

test(
  'an absent adapter keeps a message queued rather than claiming provider delivery',
  withFixture(async (f) => {
    const client: CommunicationClient = f.authorize();
    const r = f.request();
    client.send(r);
    assert.equal(await f.service.dispatchNext(f.b.paneId), undefined);
    assert.equal(client.status(r.messageId).deliveryState, 'queued');
    assert.equal(client.status(r.messageId).attemptId, null);
  }),
);

test(
  'scoped audit pagination skips unrelated panes and does not disclose another actor message',
  withFixture((f) => {
    const sender = f.authorize();
    const r = f.request();
    sender.send(r);
    const alternate = f.authorize(f.a, [f.b], 'another-actor');
    assert.equal(
      alternate.events(0).some((e) => e.messageId === r.messageId),
      false,
    );
    const other = f.register('audit-noise');
    for (let n = 0; n < 300; n++) f.service.renamePane(other.paneId, `noise-${n}`);
    const last = f.request();
    sender.send(last);
    const cursor = sender.events(0).at(-1)!.sequence;
    assert.ok(cursor > 300);
    assert.ok(sender.events(0).some((e) => e.messageId === last.messageId));
  }),
);

test(
  'content resolver receives exact private authorization scope and never receives a path',
  withFixture((f) => {
    let actual: unknown;
    const service = new PaneCommunication(
      f.journal,
      (scope, id) => {
        actual = scope;
        assert.ok(Object.isFrozen(scope));
        return f.resolver(scope, id);
      },
      f.now,
    );
    const client = service.authorize({
      actorId: 'synthetic-agent',
      workspaceId: f.a.workspaceId,
      sourcePaneId: f.a.paneId,
      targetPaneIds: [f.b.paneId],
      expiresAt: f.now() + 800000,
    });
    client.send(f.request());
    assert.deepEqual(actual, {
      workspaceId: f.a.workspaceId,
      actorId: 'synthetic-agent',
      sourcePaneId: f.a.paneId,
      targetPaneId: f.b.paneId,
      purpose: 'request',
    });
  }),
);

test(
  'unsupported managed capabilities and external panes cannot receive work',
  withFixture((f) => {
    const external = f.service.registerPane({
      workspaceId: f.a.workspaceId,
      name: 'external',
      provider: 'synthetic-observed',
      cliVersion: null,
      model: null,
      ownership: 'external',
      ownerId: 'synthetic-user',
      creationReason: 'synthetic observation',
      binding: null,
      capabilities: {
        canSend: false,
        canQueueWhileBusy: false,
        canAcknowledge: false,
        canReportTaskCompletion: false,
        canCancel: false,
      },
      state: 'ready',
    });
    assert.throws(() => f.authorize(f.a, [external]), /denied/);
    const unsupported = f.service.registerPane({
      workspaceId: f.a.workspaceId,
      name: 'unsupported',
      provider: 'synthetic-provider',
      cliVersion: null,
      model: null,
      ownership: 'managed',
      ownerId: 'synthetic-user',
      creationReason: 'synthetic unsupported transport',
      binding: {
        instanceId: randomUUID(),
        projectId: 'synthetic-project',
        terminalEpoch: randomUUID(),
      },
      capabilities: { ...capabilities, canReportTaskCompletion: false },
      state: 'ready',
    });
    const client = f.authorize(f.a, [unsupported]);
    assert.throws(() => client.send(f.request(f.a, unsupported)), /capabilities unavailable/);
  }),
);

test('a hung structured submission times out as uncertain without cancellation, retry or late completion', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = setup();
  try {
    const client = f.authorize();
    const r = f.request();
    client.send(r);
    let report!: (event: PaneProviderEvidence) => void;
    let claim!: CommunicationMessage;
    f.service.enrollAdapter(f.b.paneId, f.b.binding!, {
      ready: () => true,
      submit: (m, _bytes, callback) => {
        report = callback;
        claim = m;
        return new Promise<void>(() => {
          /* Synthetic disconnected transport. */
        });
      },
    });
    const dispatch = f.service.dispatchNext(f.b.paneId);
    t.mock.timers.tick(communicationLimits.dispatchMs);
    await dispatch;
    assert.equal(client.status(r.messageId).deliveryState, 'delivery_unknown');
    assert.equal(client.status(r.messageId).taskState, 'outcome_unknown');
    assert.throws(() => report(f.event(claim, f.b, 'accepted')), /correlation/);
    assert.equal(await f.service.dispatchNext(f.b.paneId), undefined);
  } finally {
    f.store.close();
  }
});
