import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eventSchema } from '@orqst/protocol';
import { redact } from '@orqst/shared';
import { normalizeRecord, type CodexState } from '../packages/adapters/codex/src/normalize.js';
import { meta, normalized, record, token } from './fixtures.js';

test('extracts actual protocol shapes without importing environment, account data, or encrypted reasoning', () => {
  const events = normalized([
    meta(),
    record('world_state', { secret: 'must-not-copy' }),
    record('turn_context', { model: 'synthetic-model', turn_id: 'turn-a', root_turn_id: 'root' }),
    record('response_item', { type: 'reasoning', encrypted_content: 'never-copy' }),
    record('response_item', {
      type: 'message',
      id: 'm',
      role: 'assistant',
      phase: 'final_answer',
      content: [{ type: 'output_text', text: 'Synthetic final result' }],
    }),
  ]);
  assert.equal(events.length, 3);
  assert.equal(events[2]?.payload.text, 'Synthetic final result');
  assert.equal(events[2]?.correlation.turnId, 'turn-a');
  assert.ok(!JSON.stringify(events).includes('must-not-copy'));
  events.forEach((event) => eventSchema.parse(event));
});
test('uses child metadata and ignores parent metadata and inherited records', () => {
  const events = normalized([
    meta('child', '/synthetic', {
      parent_thread_id: 'parent',
      subagent_history_start_ordinal: 10,
      agent_path: '/root/child',
    }),
    record('session_meta', { id: 'parent', cwd: '/other' }, 1),
    record(
      'response_item',
      { type: 'message', role: 'assistant', content: [{ text: 'inherited' }] },
      5,
    ),
    record(
      'token_usage_record',
      { thread_id: 'parent', thread_token_usage: token(10000, 100) },
      11,
    ),
    record(
      'token_usage_record',
      {
        thread_id: 'child',
        session_id: 'parent',
        thread_token_usage: token(100, 20),
        usage: token(20, 2),
      },
      12,
    ),
  ]);
  assert.equal(events.length, 2);
  assert.ok(events.every((event) => event.sessionId === 'child'));
  assert.equal(events[0]?.payload.parentSessionId, 'parent');
  assert.equal(events[1]?.payload.usage?.total, 120);
});
test('normalizes messages between agents without inventing a parent relationship', () => {
  const events = normalized([
    meta(),
    record('inter_agent_communication_metadata', { trigger_turn: true }),
    record('response_item', {
      type: 'agent_message',
      id: 'msg',
      author: '/root/a',
      recipient: '/root/b',
      content: [{ text: 'Synthetic handoff' }],
    }),
  ]);
  assert.equal(events.length, 2);
  assert.equal(events[1]?.payload.recipient, '/root/b');
  assert.equal(events[1]?.payload.parentSessionId, undefined);
});
test('only explicit lifecycle evidence changes status', () => {
  const events = normalized([
    meta(),
    record('event_msg', { type: 'task_started', turn_id: 'a' }),
    record('response_item', {
      type: 'message',
      role: 'assistant',
      phase: 'final_answer',
      content: [{ text: 'Done' }],
    }),
    record('event_msg', { type: 'token_count', info: { total_token_usage: token(10, 2) } }),
    record('event_msg', { type: 'task_complete', last_agent_message: 'Done' }),
    record('event_msg', { type: 'turn_aborted' }),
    record('event_msg', { type: 'error', message: 'Synthetic failure' }),
  ]);
  assert.deepEqual(
    events.map((event) => event.payload.status),
    ['unknown', 'running', undefined, undefined, 'completed', 'interrupted', 'failed'],
  );
});
test('direct input requests map to intervention, followed by tool return', () => {
  const events = normalized([
    meta(),
    record('response_item', {
      type: 'function_call',
      name: 'request_user_input',
      call_id: 'q',
      arguments: '{"questions":[]}',
    }),
    record('response_item', {
      type: 'function_call_output',
      call_id: 'q',
      output: 'Synthetic answer',
    }),
  ]);
  assert.equal(events[1]?.type, 'agent.intervention.required');
  assert.equal(events[1]?.payload.status, 'waiting_for_user');
  assert.equal(events[2]?.payload.status, 'running');
  assert.equal(events[1]?.correlation.callId, events[2]?.correlation.callId);
});
test('redacts common credentials in text, JSON arguments, URLs and tool output', () => {
  const secret = 'sk-syntheticABCDEFGHIJKLMNOPQRSTUVWXYZ123456789';
  const text = `{"api_key":"${secret}","password":"super-secret"} Bearer abc.def.ghi https://user:password@example.com eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature`;
  const redacted = redact(text);
  assert.ok(!redacted.includes(secret));
  assert.ok(!redacted.includes('super-secret'));
  assert.ok(!redacted.includes('abc.def.ghi'));
  assert.ok(!redacted.includes('user:password'));
  assert.ok(!redacted.includes('eyJhbGci'));
  const events = normalized([
    meta(),
    record('response_item', { type: 'custom_tool_call', name: 'shell', input: text }),
  ]);
  assert.ok(!JSON.stringify(events).includes(secret));
});
test('unknown, malformed and impossible token records do not crash or fabricate usage', () => {
  const state: CodexState = {};
  assert.deepEqual(
    normalizeRecord(null, state, { file: 'x', offset: 0, line: 1, hash: 'hash' }, 'm'),
    [],
  );
  const events = normalized([
    meta(),
    record('token_usage_record', { thread_token_usage: token(-1, 2) }),
    record('token_usage_record', { thread_token_usage: token(1, 2, 5) }),
    record('token_usage_record', {
      thread_token_usage: { input_tokens: 2, output_tokens: 3, total_tokens: 99 },
    }),
  ]);
  assert.equal(events.length, 1);
});
