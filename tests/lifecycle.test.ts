// All records and identities in this suite are synthetic.
import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { ObserverCore } from '@orqst/core';
import { Store } from '@orqst/database';
import {
  artifactReferenceSchema,
  eventSchema,
  lifecycleRequestSchema,
  observedSessionEvidenceSchema,
  type AgentEvent,
} from '@orqst/protocol';
import { meta, normalized, record } from './fixtures.js';

async function fixture(t: TestContext) {
  const store = new Store(':memory:');
  const core = new ObserverCore(
    {
      dataDir: '/synthetic/lifecycle',
      sessionsDir: '/synthetic/never-opened',
      retentionDays: 30,
      pollMs: 1000,
    },
    {
      openStore: () => store,
      createObserver: () => ({
        diagnostics: {
          files: 0,
          malformed: 0,
          skipped: 0,
          oversized: 0,
          errors: 0,
          lastScan: null,
          scanning: false,
        },
        start: async () => assert.fail('A reference query must not start observation'),
        stop: async () => {},
      }),
    },
  );
  await core.initialize();
  t.after(() => core.stop());
  return { core, store };
}

const lifecycleRecords = () =>
  normalized([
    meta(),
    record('event_msg', { type: 'task_started', turn_id: 'synthetic-turn' }),
    record('response_item', {
      type: 'function_call',
      name: 'functions.request_user_input',
      arguments: 'SYNTHETIC_TOOL_SECRET',
    }),
    record('event_msg', { type: 'task_complete', last_agent_message: 'SYNTHETIC_RESULT' }),
    record('event_msg', { type: 'error', message: 'SYNTHETIC_ERROR' }),
    record('event_msg', { type: 'turn_aborted' }),
    record('response_item', { type: 'function_call_output', output: 'SYNTHETIC_TOOL_RESULT' }),
  ]);

test('Core projects each retained fact with separate historical session/turn/task/process semantics', async (t) => {
  const { core, store } = await fixture(t);
  const events = lifecycleRecords().map((event) => store.ingest(event)!);
  const before = store.events();
  const states = [undefined, 'running', 'waiting_for_user', 'completed', 'failed', 'interrupted'];
  for (const [index, event] of events.entries()) {
    const result = core.observedSessionEvidence(event.sequence);
    assert.equal(result.availability, 'available');
    if (result.availability !== 'available') continue;
    const projection = result.value;
    assert.equal(observedSessionEvidenceSchema.safeParse(projection).success, true);
    assert.deepEqual(projection.identity.sessionRef, {
      machineId: event.machineId,
      adapterId: 'codex',
      nativeSessionId: event.sessionId,
    });
    assert.deepEqual(projection.identity.observedAgent, {
      id: event.agentId,
      basis: 'v1_agent_id',
    });
    assert.deepEqual(projection.identity.agentInstanceId, {
      availability: 'unavailable',
      reason: 'not_recorded',
    });
    assert.deepEqual(projection.session, { state: 'discoverable', basis: 'retained_history' });
    assert.deepEqual(projection.task, {
      availability: 'unavailable',
      reason: 'task_evidence_not_recorded',
    });
    assert.deepEqual(projection.process, {
      availability: 'unavailable',
      reason: 'process_not_observed',
    });
    assert.deepEqual(projection.evidence.source, event.source);
    assert.equal(projection.evidence.eventId, event.id);
    assert.equal(projection.evidence.occurredAt, event.timestamp);
    assert.deepEqual(projection.evidence.observedAt, {
      availability: 'unavailable',
      reason: 'not_recorded',
    });
    assert.equal(projection.evidence.sourceVerification, 'not_rechecked');
    assert.deepEqual(
      projection.turn.state,
      states[index]
        ? { availability: 'available', value: states[index] }
        : { availability: 'unavailable', reason: 'no_turn_state_evidence' },
    );
    assert.deepEqual(
      projection.turn.identity,
      index === 0
        ? { availability: 'unavailable', reason: 'not_recorded' }
        : { availability: 'available', value: 'synthetic-turn' },
    );
    assert.doesNotMatch(
      JSON.stringify(projection),
      /SYNTHETIC_(TOOL|RESULT|ERROR)|\/synthetic\/project/,
    );
  }
  assert.deepEqual(store.events(), before);
  assert.ok(store.events().every((event) => eventSchema.safeParse(event).success));
});

test('reference queries reject unsupported versions and invalid sequences before touching the store', async (t) => {
  const { core, store } = await fixture(t);
  const reads = t.mock.method(store, 'events');
  for (const version of [0, 2, '1', null, NaN, {}, true]) {
    assert.throws(
      () => core.observedSessionEvidence(1, version),
      /^Error: Invalid lifecycle request$/,
    );
    assert.throws(() => core.artifactReference(1, version), /^Error: Invalid lifecycle request$/);
  }
  for (const sequence of [-1, 0, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(lifecycleRequestSchema.safeParse({ sequence, contractVersion: 1 }).success, false);
    assert.throws(() => core.observedSessionEvidence(sequence), /Invalid lifecycle request/);
  }
  assert.equal(reads.mock.callCount(), 0);
});

test('explicit artifact references exclude content and distinguish unsupported messages and missing events', async (t) => {
  const { core, store } = await fixture(t);
  const records = normalized([
    meta(),
    record('response_item', {
      type: 'message',
      role: 'assistant',
      content: 'SYNTHETIC_PRIVATE_BODY <script>bad()</script> [link](file:///synthetic/private)',
    }),
    record('response_item', { type: 'agent_message', content: 'SYNTHETIC_AGENT_BODY' }),
    record('response_item', { type: 'message', role: 'user', content: 'SYNTHETIC_USER_BODY' }),
    record('response_item', { type: 'function_call_output', output: 'SYNTHETIC_TOOL_BODY' }),
  ]);
  const stored = records.map((event) => store.ingest(event)!);
  for (const index of [1, 2]) {
    const event = stored[index]!;
    const result = core.artifactReference(event.sequence);
    assert.equal(result.availability, 'available');
    if (result.availability !== 'available') continue;
    assert.equal(artifactReferenceSchema.safeParse(result.value).success, true);
    assert.equal(result.value.evidence.eventId, event.id);
    assert.equal(result.value.kind, 'message_reference');
    assert.deepEqual(result.value.content, {
      availability: 'unavailable',
      reason: 'reference_only',
    });
    assert.doesNotMatch(
      JSON.stringify(result),
      /SYNTHETIC_.*BODY|script|file:\/\/|\/synthetic\/project/,
    );
    assert.equal(
      artifactReferenceSchema.safeParse({ ...result.value, text: 'leak' }).success,
      false,
    );
  }
  for (const index of [0, 3, 4])
    assert.deepEqual(core.artifactReference(stored[index]!.sequence), {
      availability: 'unavailable',
      reason: 'not_artifact_message',
    });
  assert.deepEqual(core.artifactReference(900), {
    availability: 'unavailable',
    reason: 'event_not_retained',
  });
  const old: AgentEvent = {
    ...records[1]!,
    id: 'synthetic-expired-message',
    timestamp: '2000-01-01T00:00:00.000Z',
  };
  const expired = store.ingest(old)!;
  const surviving = store.ingest({
    ...records[1]!,
    id: 'synthetic-after-retention-gap',
    timestamp: '2099-01-01T00:00:00.000Z',
  })!;
  store.retain();
  assert.equal(store.events(expired.sequence - 1, 1)[0]?.sequence, surviving.sequence);
  assert.deepEqual(core.observedSessionEvidence(expired.sequence), {
    availability: 'unavailable',
    reason: 'event_not_retained',
  });
  assert.deepEqual(core.artifactReference(expired.sequence), {
    availability: 'unavailable',
    reason: 'event_not_retained',
  });
});

test('schemas reject invalid identities, provenance, extra content, version and resource-state confusion', async (t) => {
  const { core, store } = await fixture(t);
  const stored = store.ingest(lifecycleRecords()[1]!)!;
  const result = core.observedSessionEvidence(stored.sequence);
  assert.equal(result.availability, 'available');
  if (result.availability !== 'available') return;
  const value = result.value;
  const invalid = [
    { ...value, contractVersion: 2 },
    { ...value, contract: 'orqst.other' },
    { ...value, mode: 'managed' },
    { ...value, identity: undefined },
    { ...value, evidence: undefined },
    {
      ...value,
      identity: {
        ...value.identity,
        sessionRef: { ...value.identity.sessionRef, nativeSessionId: undefined },
      },
    },
    { ...value, evidence: { ...value.evidence, source: undefined } },
    { ...value, evidence: { ...value.evidence, observedAt: undefined } },
    { ...value, turn: { identity: undefined, state: value.turn.state } },
    { ...value, text: 'captured body' },
    { ...value, identity: { ...value.identity, workspaceId: '' } },
    {
      ...value,
      identity: { ...value.identity, sessionRef: { ...value.identity.sessionRef, machineId: ' ' } },
    },
    { ...value, task: { availability: 'available', state: 'completed' } },
    { ...value, process: { availability: 'available', state: 'running' } },
    { ...value, session: { state: 'completed', basis: 'retained_history' } },
    { ...value, turn: { ...value.turn, identity: { availability: 'available', value: '' } } },
    ...[
      '/absolute.jsonl',
      '../escape',
      'sub/../../escape',
      'file:///source',
      'C:\\source',
      'x\u0000y',
    ].map((file) => ({
      ...value,
      evidence: { ...value.evidence, source: { ...value.evidence.source, file } },
    })),
    ...[{ hash: 'invalid' }, { offset: -1 }, { line: 0 }, { recordType: '' }].map((source) => ({
      ...value,
      evidence: { ...value.evidence, source: { ...value.evidence.source, ...source } },
    })),
  ];
  for (const projection of invalid)
    assert.equal(observedSessionEvidenceSchema.safeParse(projection).success, false);
});

test('retained read failures are sanitized without exposing JSON or database diagnostics', async (t) => {
  const { core, store } = await fixture(t);
  t.mock.method(store, 'events', () => {
    throw new SyntaxError('SYNTHETIC_PRIVATE_JSON /synthetic/private/database');
  });
  assert.throws(
    () => core.observedSessionEvidence(1),
    /^Error: Invalid retained lifecycle evidence$/,
  );
  assert.throws(() => core.artifactReference(1), /^Error: Invalid retained lifecycle evidence$/);
});
