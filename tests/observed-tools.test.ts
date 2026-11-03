// Synthetic fixtures only. No process is launched and no native session is read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { StoredEvent } from '@orqst/protocol';
import {
  observedToolLimits,
  observedTools,
  toolDisplayText,
} from '../apps/dashboard/src/observed-tools.js';
import { meta, normalized, record } from './fixtures.js';

function pair(): StoredEvent[] {
  return normalized([
    meta(),
    record('turn_context', { turn_id: 'synthetic-turn' }),
    record('response_item', {
      type: 'function_call',
      name: 'synthetic_tool',
      call_id: 'synthetic-call',
      arguments: 'Synthetic input',
    }),
    record('response_item', {
      type: 'function_call_output',
      call_id: 'synthetic-call',
      output: 'Synthetic output: exit code 0 is untrusted prose',
    }),
  ])
    .filter((event) => event.type.startsWith('agent.tool.'))
    .map((event, index) => ({ ...event, sequence: index + 1 }));
}
const project = (events: StoredEvent[]) => observedTools(events, 'synthetic-session');

test('projects actual normalized input/output and retains sources without interpreting status', () => {
  const events = pair();
  const result = project(events);
  assert.equal(result.groups.length, 1);
  assert.equal(result.groups[0]?.paired, true);
  assert.equal(result.groups[0]?.records[0]?.payload.text, 'Synthetic input');
  assert.equal(result.groups[0]?.records[1]?.payload.status, 'running');
  assert.deepEqual(
    result.groups[0]?.records.map((event) => event.source),
    events.map((e) => e.source),
  );
  assert.equal('status' in result.groups[0]!, false);
  assert.equal('exitCode' in result.groups[0]!, false);
  assert.deepEqual(events, pair());
});

test('missing turn/call identity and conflicting call fields remain unpaired', () => {
  for (const change of [
    (event: StoredEvent) => delete event.correlation.turnId,
    (event: StoredEvent) => delete event.correlation.callId,
    (event: StoredEvent) => delete event.payload.callId,
    (event: StoredEvent) => (event.payload.callId = 'synthetic-conflict'),
  ]) {
    const events = pair();
    change(events[1]!);
    assert.ok(project(events).groups.every((group) => !group.paired));
  }
});

test('machine, session, agent, turn, source file and tool family isolate pairing', () => {
  for (const change of [
    (event: StoredEvent) => (event.machineId = 'synthetic-other'),
    (event: StoredEvent) => (event.sessionId = 'synthetic-other'),
    (event: StoredEvent) => (event.agentId = 'synthetic-other'),
    (event: StoredEvent) => (event.correlation.turnId = 'synthetic-other'),
    (event: StoredEvent) => (event.source.file = 'synthetic-other.jsonl'),
    (event: StoredEvent) => (event.source.recordType = 'response_item:custom_tool_call_output'),
  ]) {
    const events = pair();
    change(events[1]!);
    assert.ok(project(events).groups.every((group) => !group.paired));
  }
});

test('unmatched return, invocation, reversed order and ambiguous duplicates are separate evidence', () => {
  const events = pair();
  for (const input of [
    [events[0]!],
    [events[1]!],
    [
      { ...events[1]!, sequence: 1 },
      { ...events[0]!, sequence: 2 },
    ],
    [...events, { ...events[0]!, id: 'synthetic-duplicate-start', sequence: 3 }],
    [...events, { ...events[1]!, id: 'synthetic-duplicate-return', sequence: 3 }],
  ]) {
    const result = project(input);
    assert.equal(result.groups.length, input.length);
    assert.ok(result.groups.every((group) => !group.paired));
  }
});

test('same call ID in another complete turn pairs independently', () => {
  const first = pair();
  const second = pair().map((event) => ({
    ...event,
    id: event.id + '-second',
    sequence: event.sequence + 2,
    correlation: { ...event.correlation, turnId: 'synthetic-second-turn' },
  }));
  const result = project([...first, ...second]);
  assert.equal(result.groups.length, 2);
  assert.ok(result.groups.every((group) => group.paired));
});

test('unsupported adapters, mismatched record kinds and malformed evidence are omitted', () => {
  for (const change of [
    (event: StoredEvent) => (event.adapter = 'claude'),
    (event: StoredEvent) => (event.source.recordType = 'response_item:function_call_output'),
    (event: StoredEvent) => (event.timestamp = 'invalid'),
    (event: StoredEvent) => (event.sequence = NaN),
    (event: StoredEvent) => (event.sequence = 0),
  ]) {
    const events = pair();
    change(events[0]!);
    const result = project(events);
    assert.equal(result.invalid, true);
    assert.equal(result.groups.length, 1);
    assert.equal(result.groups[0]?.paired, false);
  }
});

test('only latest bounded records are projected; excluded partners cannot establish a pair', () => {
  const first = pair();
  const events = Array.from({ length: observedToolLimits.inspected + 10 }, (_, index) => ({
    ...first[1]!,
    id: `synthetic-output-${index}`,
    sequence: index + 2,
  }));
  const result = project([first[0]!, ...events]);
  assert.equal(result.limited, true);
  assert.equal(result.groups.length, observedToolLimits.records);
  assert.equal(result.groups[0]?.records[0]?.id, 'synthetic-output-509');
  assert.ok(result.groups.every((group) => !group.paired));
});

test('terminal and format controls are visible with bounded expansion, not parsed or stripped', () => {
  const hostile = '\u001b]52;c;synthetic\u0007\r\b\u009b\u202e\u200b\ufeff\n\t<img src=x>';
  const display = toolDisplayText(hostile);
  assert.equal(
    display.text,
    '\\u001b]52;c;synthetic\\u0007\\u000d\\u0008\\u009b\\u202e\\u200b\\ufeff\n\t<img src=x>',
  );
  assert.equal(display.truncated, false);
  assert.deepEqual(toolDisplayText('\u001b'.repeat(5000)), {
    text: '\\u001b'.repeat(667).slice(0, 4000),
    truncated: true,
  });
  assert.equal(toolDisplayText('x'.repeat(4000)).truncated, false);
  assert.equal(toolDisplayText('x'.repeat(4001)).truncated, true);
});

test('known ambiguity outside the display cap and reversed source positions cannot pair', () => {
  const [start, output] = pair();
  const fillers = Array.from({ length: observedToolLimits.records - 2 }, (_, index) => ({
    ...output!,
    id: `synthetic-filler-${index}`,
    sequence: index + 2,
    correlation: {},
    payload: { text: 'Synthetic unrelated output' },
  }));
  const ambiguous = project([
    start!,
    ...fillers,
    { ...start!, id: 'synthetic-repeated-start', sequence: 101 },
    { ...output!, sequence: 102 },
  ]);
  assert.equal(ambiguous.limited, true);
  assert.equal(ambiguous.groups.length, observedToolLimits.records);
  assert.ok(ambiguous.groups.every((group) => !group.paired));
  for (const source of [
    { ...output!.source, line: start!.source.line },
    { ...output!.source, offset: start!.source.offset },
  ]) {
    assert.ok(project([start!, { ...output!, source }]).groups.every((group) => !group.paired));
  }
});
