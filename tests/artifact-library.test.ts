// Synthetic retained-message evidence only; no local session files are accessed.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { artifactTextLimit } from '@orqst/protocol';
import { artifactSelection, parseArtifactPage } from '../apps/dashboard/src/artifact-library.js';
import { meta, normalized, record } from './fixtures.js';

const events = normalized([
  meta(),
  record('response_item', { type: 'message', role: 'assistant', content: '# Synthetic source' }),
  record('response_item', { type: 'agent_message', content: 'Synthetic agent body' }),
  record('response_item', { type: 'message', role: 'user', content: 'Synthetic user' }),
  record('response_item', { type: 'function_call_output', output: 'Synthetic tool body' }),
  record('event_msg', { type: 'task_complete', last_agent_message: 'Synthetic summary' }),
]).map((event, index) => ({ ...event, sequence: index + 1 }));
const source = events.find((event) => event.payload.role === 'assistant')!;

test('library admits only extractable Codex source messages with exact original selection', () => {
  assert.deepEqual(artifactSelection(source), {
    contractVersion: 1,
    sequence: source.sequence,
    eventId: source.id,
    sessionId: source.sessionId,
    machineId: source.machineId,
    adapter: source.adapter,
    workspaceId: source.workspaceId,
    agentId: source.agentId,
    sourceHash: source.source.hash,
  });
  assert.ok(artifactSelection(events.find((event) => event.payload.role === 'agent')!));
  for (const event of events.filter(
    (event) => !['assistant', 'agent'].includes(event.payload.role ?? ''),
  ))
    assert.equal(artifactSelection(event), undefined);
  for (const event of [
    { ...source, adapter: 'claude' as const },
    { ...source, source: { ...source.source, recordType: 'event_msg:agent_message' } },
    { ...source, source: { ...source.source, hash: 'invalid' } },
    { ...source, sequence: 0 },
    { ...source, payload: { ...source.payload, text: ' \n ' } },
    { ...source, payload: { ...source.payload, text: 'é'.repeat(artifactTextLimit / 2) + 'x' } },
  ])
    assert.equal(artifactSelection(event), undefined);
  assert.ok(
    artifactSelection({
      ...source,
      payload: { ...source.payload, text: 'é'.repeat(artifactTextLimit / 2) },
    }),
  );
});

test('library pages require validated events, strict increasing bounded sequences and exact selected session', () => {
  assert.deepEqual(parseArtifactPage({ events }, 100, source.sessionId), events);
  assert.deepEqual(parseArtifactPage({ events: [] }, 100, ''), []);
  for (const data of [
    null,
    {},
    { events: 'no' },
    { events: Array(201).fill(source) },
    { events: [{ ...source, sequence: Number.MAX_SAFE_INTEGER + 1 }] },
    { events: [{ ...source, sequence: 0 }] },
    { events: [{ ...source, sequence: 100 }] },
    { events: [{ ...source, timestamp: 'invalid' }] },
    { events: [{ ...source, schemaVersion: 2 }] },
    { events: [source, { ...source, sequence: source.sequence + 1 }] },
    {
      events: [
        { ...source, sequence: 10 },
        { ...source, id: 'other', sequence: 9 },
      ],
    },
    { events: [{ ...source, sessionId: 'other' }] },
  ])
    assert.throws(() => parseArtifactPage(data, 100, source.sessionId));
});
