// SYNTHETIC fixtures only; no real user transcripts, paths, or credentials.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { eventSchema } from '@orqst/protocol';
import {
  antigravityDescriptor,
  normalizeRecord,
  parseConversationMetadata,
  type AntigravitySessionMetadata,
  type AntigravityState,
} from '@orqst/adapter-antigravity';

const syntheticFile =
  'brain/00000000-0000-4000-8000-000000000001/.system_generated/logs/transcript_full.jsonl';

function sha(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function normalizeSteps(
  steps: unknown[],
  metadata?: AntigravitySessionMetadata,
  file = syntheticFile,
) {
  const state: AntigravityState = {};
  let offset = 0;
  return steps.flatMap((step, index) => {
    const encoded = Buffer.from(JSON.stringify(step));
    const events = normalizeRecord(
      step,
      state,
      { file, offset, line: index + 1, hash: sha(step) },
      'synthetic-machine',
      metadata,
    );
    offset += encoded.length + 1;
    return events;
  });
}

test('descriptor declares only source-backed capabilities and keeps tokenUsage, subagents, userIntervention and remoteControl false', () => {
  assert.equal(antigravityDescriptor.id, 'antigravity');
  assert.equal(antigravityDescriptor.implemented, true);
  assert.deepEqual(antigravityDescriptor.capabilities, {
    sessionDiscovery: true,
    realtimeEvents: true,
    messages: true,
    toolCalls: true,
    subagents: false,
    tokenUsage: false,
    taskResults: true,
    userIntervention: false,
    remoteControl: false,
  });
});

test('normalizes user input, planner tool calls, tool outputs and final answer while omitting thinking and per-step non-cumulative tokens', () => {
  const events = normalizeSteps(
    [
      {
        step_index: 0,
        source: 'USER_EXPLICIT',
        type: 'USER_INPUT',
        status: 'DONE',
        created_at: '2026-11-18T03:00:00Z',
        content: 'Synthetic user prompt',
      },
      {
        step_index: 1,
        source: 'MODEL',
        type: 'PLANNER_RESPONSE',
        status: 'DONE',
        created_at: '2026-11-18T03:00:02Z',
        model: 'synthetic-gemini-model',
        thinking: 'synthetic-private-reasoning-must-not-copy',
        input_tokens: 2489,
        output_tokens: 674,
        cache_read_tokens: 29726,
        content: 'Synthetic tool commentary',
        tool_calls: [
          { name: 'read_file', args: { Path: '/synthetic/repo/README.md' } },
          { name: 'run_command', args: { CommandLine: 'echo synthetic' } },
        ],
      },
      {
        step_index: 2,
        source: 'MODEL',
        type: 'GENERIC',
        status: 'DONE',
        created_at: '2026-11-18T03:00:03Z',
        content: 'Synthetic README contents',
      },
      {
        step_index: 3,
        source: 'MODEL',
        type: 'GENERIC',
        status: 'ERROR',
        created_at: '2026-11-18T03:00:04Z',
        error: 'Synthetic non-fatal tool error',
        content: 'Command exited with code 1',
      },
      {
        step_index: 4,
        source: 'MODEL',
        type: 'PLANNER_RESPONSE',
        status: 'DONE',
        created_at: '2026-11-18T03:00:05Z',
        model: 'synthetic-gemini-model',
        thinking: 'synthetic-final-thinking-must-not-copy',
        input_tokens: 1800,
        output_tokens: 120,
        cache_read_tokens: 31000,
        content: 'Synthetic final answer',
      },
    ],
    { cwd: '/synthetic/repo' },
  );

  events.forEach((event) => eventSchema.parse(event));
  const serialized = JSON.stringify(events);
  assert.ok(!serialized.includes('synthetic-private-reasoning-must-not-copy'));
  assert.ok(!serialized.includes('synthetic-final-thinking-must-not-copy'));
  assert.ok(!events.some((event) => event.type === 'agent.tokens.updated'));
  assert.ok(events.every((event) => event.payload.usage === undefined));
  assert.ok(events.every((event) => event.adapter === 'antigravity'));

  assert.deepEqual(
    events.map((event) => event.type),
    [
      'session.started',
      'agent.started',
      'agent.message',
      'session.updated',
      'agent.message',
      'agent.tool.started',
      'agent.tool.started',
      'agent.tool.completed',
      'agent.tool.completed',
      'session.updated',
      'agent.message',
      'agent.completed',
    ],
  );
  assert.equal(events[0]?.payload.cwd, '/synthetic/repo');
  assert.equal(events[0]?.payload.agentName, 'repo · 00000000');
  assert.equal(events[5]?.correlation.callId, 'step-1-call-0');
  assert.equal(events[7]?.correlation.callId, 'step-1-call-0');
  assert.equal(events[6]?.correlation.callId, 'step-1-call-1');
  assert.equal(events[8]?.correlation.callId, 'step-1-call-1');
  assert.equal(events[8]?.payload.status, 'running');
  assert.equal(events.at(-1)?.payload.status, 'completed');
  assert.equal(events.at(-1)?.payload.result, 'Synthetic final answer');
});

test('does not infer parent relationships from invoke_subagent tool calls or prose', () => {
  const events = normalizeSteps([
    {
      step_index: 0,
      source: 'USER_EXPLICIT',
      type: 'USER_INPUT',
      status: 'DONE',
      created_at: '2026-11-18T03:10:00Z',
      content: 'Spawn synthetic subagent parent=11111111-1111-4111-8111-111111111111',
    },
    {
      step_index: 1,
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      status: 'DONE',
      created_at: '2026-11-18T03:10:01Z',
      tool_calls: [
        {
          name: 'invoke_subagent',
          args: { TypeName: 'research', Role: 'Synthetic Researcher', Prompt: 'Synthetic task' },
        },
      ],
    },
  ]);

  assert.ok(events.every((event) => event.payload.parentSessionId === undefined));
});

test('maps explicit lifecycle statuses, ask_question intervention and SYSTEM_MESSAGE wakeup turns', () => {
  const events = normalizeSteps([
    {
      step_index: 0,
      source: 'USER_EXPLICIT',
      type: 'USER_INPUT',
      status: 'DONE',
      created_at: '2026-11-18T03:20:00Z',
      content: 'Synthetic question flow',
    },
    {
      step_index: 1,
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      status: 'DONE',
      created_at: '2026-11-18T03:20:01Z',
      tool_calls: [
        {
          name: 'ask_question',
          args: { questions: [{ question: 'Synthetic choice?', options: ['A', 'B'] }] },
        },
      ],
    },
    {
      step_index: 2,
      source: 'MODEL',
      type: 'GENERIC',
      status: 'DONE',
      created_at: '2026-11-18T03:20:02Z',
      content: 'Selected A',
    },
    {
      step_index: 3,
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      status: 'CANCELED',
      created_at: '2026-11-18T03:20:03Z',
    },
    {
      step_index: 4,
      source: 'SYSTEM',
      type: 'SYSTEM_MESSAGE',
      status: 'DONE',
      created_at: '2026-11-18T03:20:04Z',
      content: 'Synthetic background task wakeup',
    },
    {
      step_index: 5,
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      status: 'ERROR',
      created_at: '2026-11-18T03:20:05Z',
      error: 'Synthetic model failure',
    },
  ]);

  const ask = events.find((event) => event.type === 'agent.intervention.required');
  assert.ok(ask);
  assert.equal(ask.payload.status, 'waiting_for_user');
  assert.ok(!JSON.stringify(events).includes('Synthetic background task wakeup'));
  assert.deepEqual(
    events.map((event) => event.payload.status),
    [
      'unknown',
      'running',
      undefined,
      'waiting_for_user',
      'running',
      'interrupted',
      'running',
      'failed',
    ],
  );
});

test('redacts credentials in user text, tool arguments and tool outputs', () => {
  const secret = 'sk-syntheticABCDEFGHIJKLMNOPQRSTUVWXYZ123456789';
  const events = normalizeSteps([
    {
      step_index: 0,
      source: 'USER_EXPLICIT',
      type: 'USER_INPUT',
      status: 'DONE',
      created_at: '2026-11-18T03:30:00Z',
      content: `Authorization: Bearer ${secret}`,
    },
    {
      step_index: 1,
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      status: 'DONE',
      created_at: '2026-11-18T03:30:01Z',
      tool_calls: [{ name: 'run_command', args: { api_key: secret } }],
    },
    {
      step_index: 2,
      source: 'MODEL',
      type: 'GENERIC',
      status: 'DONE',
      created_at: '2026-11-18T03:30:02Z',
      content: `password="super-secret-value" token=${secret}`,
    },
  ]);

  const dumped = JSON.stringify(events);
  assert.ok(!dumped.includes(secret));
  assert.ok(!dumped.includes('super-secret-value'));
});

test('parses conversation metadata WorkspaceURIs safely and rejects malformed records', () => {
  const parsed = parseConversationMetadata({
    'synthetic-project': {
      '00000000-0000-4000-8000-000000000001': {
        last_modified_time: '2026-11-18T03:00:00Z',
        summary: {
          ID: '00000000-0000-4000-8000-000000000001',
          AgentName: 'Synthetic Worker',
          UpdatedAt: '2026-11-18T03:05:00Z',
          WorkspaceURIs: ['file:///synthetic/workspace/project'],
        },
      },
      mismatched: {
        summary: {
          ID: 'different-id',
          WorkspaceURIs: ['file:///synthetic/ignored'],
        },
      },
    },
  });
  assert.equal(parsed.size, 1);
  assert.deepEqual(parsed.get('00000000-0000-4000-8000-000000000001'), {
    cwd: '/synthetic/workspace/project',
    agentName: 'Synthetic Worker',
    updatedAt: '2026-11-18T03:05:00Z',
  });

  const state: AntigravityState = {};
  assert.deepEqual(
    normalizeRecord(
      null,
      state,
      { file: syntheticFile, offset: 0, line: 1, hash: 'a'.repeat(64) },
      'm',
    ),
    [],
  );
  assert.deepEqual(
    normalizeRecord(
      { step_index: -1, type: 'USER_INPUT', created_at: '2026-11-18T03:00:00Z' },
      state,
      { file: syntheticFile, offset: 0, line: 1, hash: 'a'.repeat(64) },
      'm',
    ),
    [],
  );
  assert.deepEqual(
    normalizeRecord(
      { step_index: 0, type: 'USER_INPUT', created_at: '2026-11-18T03:00:00Z' },
      {},
      { file: 'history.jsonl', offset: 0, line: 1, hash: 'a'.repeat(64) },
      'm',
    ),
    [],
  );
});
