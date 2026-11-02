// Synthetic lifecycle QA. No installed database, native sessions or transports.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObserverCore } from '@orqst/core';
import { codexDescriptor } from '@orqst/adapter-codex';
import { Store } from '@orqst/database';
import { DatabaseSync } from 'node:sqlite';
import {
  artifactReferenceResultSchema,
  eventSchema,
  eventTypes,
  lifecycleRequestSchema,
  observedSessionEvidenceResultSchema,
  type AgentEvent,
} from '@orqst/protocol';

const stamp = '2026-11-02T12:00:00.000Z';
const hash = 'a'.repeat(64);

function event(overrides: Partial<AgentEvent> & { id: string }): AgentEvent {
  return {
    schemaVersion: 1,
    type: 'agent.message',
    timestamp: stamp,
    adapter: 'codex',
    machineId: 'synthetic-machine',
    workspaceId: 'synthetic-workspace',
    sessionId: 'synthetic-session',
    agentId: 'synthetic-agent',
    correlation: { turnId: 'synthetic-turn' },
    source: {
      file: 'synthetic/lifecycle.jsonl',
      offset: 0,
      line: 1,
      hash,
      recordType: 'response_item:message',
    },
    payload: { role: 'assistant', text: 'Synthetic artifact text' },
    ...overrides,
  };
}

async function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'orqst-lifecycle-qa-'));
  const sessions = join(dir, 'sessions');
  mkdirSync(sessions);
  const core = new ObserverCore({
    dataDir: dir,
    sessionsDir: sessions,
    retentionDays: 1,
    pollMs: 1000,
  });
  await core.initialize();
  return {
    dir,
    core,
    close: async () => {
      await core.stop();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function ingest(core: ObserverCore, value: AgentEvent) {
  const stored = core.store.ingest(value);
  assert.ok(stored);
  return stored;
}

test('lifecycle request validation happens before Store.events and rejects every non-v1 shape', async () => {
  const store = new Store(':memory:');
  let eventReads = 0;
  const original = store.events.bind(store);
  store.events = ((...args: Parameters<Store['events']>) => {
    eventReads++;
    return original(...args);
  }) as Store['events'];
  const dir = mkdtempSync(join(tmpdir(), 'orqst-lifecycle-invalid-'));
  const core = new ObserverCore(
    { dataDir: dir, sessionsDir: dir, retentionDays: 3650, pollMs: 1000 },
    { openStore: () => store },
  );
  await core.initialize();
  try {
    for (const [sequence, contractVersion] of [
      [0, 1],
      [-1, 1],
      [1.5, 1],
      [Number.NaN, 1],
      [1, 2],
      [1, '1'],
      [1, null],
      [1, 0],
    ] as const) {
      assert.throws(
        () => core.observedSessionEvidence(sequence, contractVersion),
        /^Error: Invalid lifecycle request$/,
      );
      assert.throws(
        () => core.artifactReference(sequence, contractVersion),
        /^Error: Invalid lifecycle request$/,
      );
    }
    assert.equal(eventReads, 0);
    assert.equal(
      lifecycleRequestSchema.safeParse({ sequence: 1, contractVersion: 1 }).success,
      true,
    );
    assert.equal(
      lifecycleRequestSchema.safeParse({ sequence: 1, contractVersion: 1, extra: true }).success,
      false,
    );
  } finally {
    await core.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('observed evidence preserves explicit identity, provenance and absences without inferring lifecycle', async () => {
  const ctx = await setup();
  try {
    const stored = ingest(
      ctx.core,
      event({
        id: 'observed-basic',
        type: 'agent.started',
        source: {
          file: 'synthetic/lifecycle.jsonl',
          offset: 12,
          line: 4,
          hash,
          recordType: 'event_msg:task_started',
        },
        payload: { status: 'running' },
      }),
    );
    const result = ctx.core.observedSessionEvidence(stored.sequence);
    assert.equal(observedSessionEvidenceResultSchema.safeParse(result).success, true);
    assert.equal(result.availability, 'available');
    if (result.availability !== 'available') return;
    assert.equal(result.value.contract, 'orqst.lifecycle');
    assert.equal(result.value.contractVersion, 1);
    assert.equal(result.value.type, 'observed_session.evidence');
    assert.equal(result.value.mode, 'observed');
    assert.deepEqual(result.value.identity.sessionRef, {
      machineId: 'synthetic-machine',
      adapterId: 'codex',
      nativeSessionId: 'synthetic-session',
    });
    assert.equal(result.value.identity.workspaceId, 'synthetic-workspace');
    assert.deepEqual(result.value.identity.observedAgent, {
      id: 'synthetic-agent',
      basis: 'v1_agent_id',
    });
    assert.deepEqual(result.value.identity.agentInstanceId, {
      availability: 'unavailable',
      reason: 'not_recorded',
    });
    assert.equal(result.value.evidence.kind, 'retained_v1_event');
    assert.equal(result.value.evidence.eventId, 'observed-basic');
    assert.equal(result.value.evidence.sequence, stored.sequence);
    assert.equal(result.value.evidence.occurredAt, stamp);
    assert.deepEqual(result.value.evidence.observedAt, {
      availability: 'unavailable',
      reason: 'not_recorded',
    });
    assert.equal(result.value.evidence.sourceVerification, 'not_rechecked');
    assert.deepEqual(result.value.evidence.source, {
      file: 'synthetic/lifecycle.jsonl',
      offset: 12,
      line: 4,
      hash,
      recordType: 'event_msg:task_started',
    });
    assert.deepEqual(result.value.session, {
      state: 'discoverable',
      basis: 'retained_history',
    });
    assert.deepEqual(result.value.turn.identity, {
      availability: 'available',
      value: 'synthetic-turn',
    });
    assert.deepEqual(result.value.turn.state, { availability: 'available', value: 'running' });
    assert.deepEqual(result.value.task, {
      availability: 'unavailable',
      reason: 'task_evidence_not_recorded',
    });
    assert.deepEqual(result.value.process, {
      availability: 'unavailable',
      reason: 'process_not_observed',
    });
  } finally {
    await ctx.close();
  }
});

test('closed turn mapping accepts only explicit Codex evidence and never infers task/process state', async () => {
  const ctx = await setup();
  try {
    const cases: Array<[string, Partial<AgentEvent>, string]> = [
      [
        'turn-running',
        {
          type: 'agent.started',
          source: {
            file: 'synthetic/lifecycle.jsonl',
            offset: 1,
            line: 1,
            hash,
            recordType: 'event_msg:task_started',
          },
          payload: { status: 'running' },
        },
        'running',
      ],
      [
        'turn-completed',
        {
          type: 'agent.completed',
          source: {
            file: 'synthetic/lifecycle.jsonl',
            offset: 2,
            line: 2,
            hash,
            recordType: 'event_msg:task_complete',
          },
          payload: { status: 'completed' },
        },
        'completed',
      ],
      [
        'turn-failed',
        {
          type: 'agent.failed',
          source: {
            file: 'synthetic/lifecycle.jsonl',
            offset: 3,
            line: 3,
            hash,
            recordType: 'event_msg:error',
          },
          payload: { status: 'failed' },
        },
        'failed',
      ],
      [
        'turn-interrupted',
        {
          type: 'agent.updated',
          source: {
            file: 'synthetic/lifecycle.jsonl',
            offset: 4,
            line: 4,
            hash,
            recordType: 'event_msg:turn_aborted',
          },
          payload: { status: 'interrupted' },
        },
        'interrupted',
      ],
      [
        'turn-waiting',
        {
          type: 'agent.intervention.required',
          source: {
            file: 'synthetic/lifecycle.jsonl',
            offset: 5,
            line: 5,
            hash,
            recordType: 'response_item:function_call',
          },
          payload: {
            name: 'request_user_input',
            status: 'waiting_for_user',
            callId: 'synthetic-call',
          },
        },
        'waiting_for_user',
      ],
    ];
    for (const [id, extra, expected] of cases) {
      const stored = ingest(ctx.core, event({ id, ...extra }));
      const result = ctx.core.observedSessionEvidence(stored.sequence);
      assert.equal(result.availability, 'available', id);
      if (result.availability === 'available')
        assert.deepEqual(result.value.turn.state, { availability: 'available', value: expected });
    }

    const unknown = ingest(
      ctx.core,
      event({
        id: 'turn-unknown',
        type: 'agent.started',
        source: {
          file: 'synthetic/lifecycle.jsonl',
          offset: 6,
          line: 6,
          hash,
          recordType: 'response_item:message',
        },
        payload: { status: 'running' },
      }),
    );
    const unknownResult = ctx.core.observedSessionEvidence(unknown.sequence);
    assert.equal(unknownResult.availability, 'available');
    if (unknownResult.availability === 'available')
      assert.deepEqual(unknownResult.value.turn.state, {
        availability: 'unavailable',
        reason: 'no_turn_state_evidence',
      });

    const noTurnId = ingest(
      ctx.core,
      event({
        id: 'no-turn-id',
        correlation: {},
        type: 'agent.started',
        source: {
          file: 'synthetic/lifecycle.jsonl',
          offset: 7,
          line: 7,
          hash,
          recordType: 'event_msg:task_started',
        },
        payload: { status: 'running' },
      }),
    );
    const noTurnResult = ctx.core.observedSessionEvidence(noTurnId.sequence);
    assert.equal(noTurnResult.availability, 'available');
    if (noTurnResult.availability === 'available')
      assert.deepEqual(noTurnResult.value.turn.identity, {
        availability: 'unavailable',
        reason: 'not_recorded',
      });
  } finally {
    await ctx.close();
  }
});

test('artifact references are explicit message references without body, Markdown or path access', async () => {
  const ctx = await setup();
  try {
    const privateText =
      'SYNTHETIC_PRIVATE_BODY **markdown** [link](file:///private/secret) /private/secret.txt';
    const stored = ingest(
      ctx.core,
      event({
        id: 'artifact-assistant',
        payload: { role: 'assistant', text: privateText, cwd: '/private/secret' },
      }),
    );
    const result = ctx.core.artifactReference(stored.sequence);
    assert.equal(artifactReferenceResultSchema.safeParse(result).success, true);
    assert.equal(result.availability, 'available');
    if (result.availability === 'available') {
      assert.equal(result.value.contract, 'orqst.lifecycle');
      assert.equal(result.value.type, 'artifact.reference');
      assert.equal(result.value.kind, 'message_reference');
      assert.equal(result.value.role, 'assistant');
      assert.deepEqual(result.value.content, {
        availability: 'unavailable',
        reason: 'reference_only',
      });
      assert.deepEqual(result.value.turnIdentity, {
        availability: 'available',
        value: 'synthetic-turn',
      });
      const serialized = JSON.stringify(result);
      for (const forbidden of [
        privateText,
        'SYNTHETIC_PRIVATE_BODY',
        'file:///private/secret',
        '/private/secret.txt',
        '/private/secret',
        '**markdown**',
      ])
        assert.equal(serialized.includes(forbidden), false, forbidden);
    }

    const agent = ingest(
      ctx.core,
      event({
        id: 'artifact-agent',
        source: {
          file: 'synthetic/lifecycle.jsonl',
          offset: 9,
          line: 9,
          hash,
          recordType: 'response_item:agent_message',
        },
        payload: { role: 'agent', text: 'Synthetic agent artifact' },
      }),
    );
    const agentResult = ctx.core.artifactReference(agent.sequence);
    assert.equal(agentResult.availability, 'available');
    if (agentResult.availability === 'available') assert.equal(agentResult.value.role, 'agent');

    for (const [id, payload, recordType] of [
      ['artifact-user', { role: 'user', text: 'Synthetic user' }, 'response_item:message'],
      ['artifact-tool', { role: 'tool', text: 'Synthetic tool' }, 'response_item:message'],
      ['artifact-empty', { role: 'assistant', text: '   ' }, 'response_item:message'],
      [
        'artifact-wrong-shape',
        { role: 'assistant', text: 'Synthetic' },
        'response_item:agent_message',
      ],
    ] as const) {
      const rejected = ingest(
        ctx.core,
        event({
          id,
          source: {
            file: 'synthetic/lifecycle.jsonl',
            offset: 10,
            line: 10,
            hash,
            recordType,
          },
          payload,
        }),
      );
      assert.deepEqual(ctx.core.artifactReference(rejected.sequence), {
        availability: 'unavailable',
        reason: 'not_artifact_message',
      });
    }
  } finally {
    await ctx.close();
  }
});

test('unsupported adapters, missing/retained sequences and invalid provenance have explicit sanitized outcomes', async () => {
  const ctx = await setup();
  try {
    const manual = ingest(
      ctx.core,
      event({ id: 'manual-event', adapter: 'manual', payload: { role: 'assistant', text: 'x' } }),
    );
    assert.deepEqual(ctx.core.observedSessionEvidence(manual.sequence), {
      availability: 'unavailable',
      reason: 'unsupported_adapter',
    });
    assert.deepEqual(ctx.core.artifactReference(manual.sequence), {
      availability: 'unavailable',
      reason: 'unsupported_adapter',
    });

    assert.deepEqual(ctx.core.observedSessionEvidence(999999), {
      availability: 'unavailable',
      reason: 'event_not_retained',
    });
    assert.deepEqual(ctx.core.artifactReference(999999), {
      availability: 'unavailable',
      reason: 'event_not_retained',
    });

    const badPath = ingest(
      ctx.core,
      event({
        id: 'bad-path',
        source: {
          file: '../private/secret.jsonl',
          offset: 0,
          line: 1,
          hash,
          recordType: 'response_item:message',
        },
      }),
    );
    assert.throws(
      () => ctx.core.observedSessionEvidence(badPath.sequence),
      /^Error: Invalid retained lifecycle evidence$/,
    );
    const badHash = ingest(
      ctx.core,
      event({
        id: 'bad-hash',
        source: {
          file: 'synthetic/lifecycle.jsonl',
          offset: 0,
          line: 1,
          hash: 'not-a-hash',
          recordType: 'response_item:message',
        },
      }),
    );
    assert.throws(
      () => ctx.core.observedSessionEvidence(badHash.sequence),
      /^Error: Invalid retained lifecycle evidence$/,
    );

    const retained = ingest(ctx.core, event({ id: 'retained-event' }));
    assert.equal(ctx.core.observedSessionEvidence(retained.sequence).availability, 'available');
    ctx.core.store.retain(Date.parse('2026-12-05T00:00:00Z'));
    assert.deepEqual(ctx.core.observedSessionEvidence(retained.sequence), {
      availability: 'unavailable',
      reason: 'event_not_retained',
    });
    assert.deepEqual(ctx.core.artifactReference(retained.sequence), {
      availability: 'unavailable',
      reason: 'event_not_retained',
    });
  } finally {
    await ctx.close();
  }
});

test('lifecycle reads are non-mutating and leave v1 protocol, adapter flags and schema2 unchanged', async () => {
  const ctx = await setup();
  try {
    const stored = ingest(ctx.core, event({ id: 'compat-event' }));
    const cursor = ctx.core.store.cursor();
    const eventCount = ctx.core.store.events().length;
    const raw = new DatabaseSync(join(ctx.dir, 'orqst.db'), { readOnly: true });
    const beforeVersion = Number(raw.prepare('PRAGMA user_version').get()?.user_version);
    raw.close();
    ctx.core.observedSessionEvidence(stored.sequence);
    ctx.core.artifactReference(stored.sequence);
    assert.equal(ctx.core.store.cursor(), cursor);
    assert.equal(ctx.core.store.events().length, eventCount);
    assert.equal(beforeVersion, 2);
    assert.equal((eventTypes as readonly string[]).includes('observed_session.evidence'), false);
    assert.equal((eventTypes as readonly string[]).includes('artifact.reference'), false);
    assert.equal(
      eventSchema.safeParse({
        contract: 'orqst.lifecycle',
        contractVersion: 1,
        type: 'artifact.reference',
      }).success,
      false,
    );
    assert.equal(codexDescriptor.implemented, true);
    assert.equal(codexDescriptor.capabilities.remoteControl, false);
  } finally {
    await ctx.close();
  }
});
