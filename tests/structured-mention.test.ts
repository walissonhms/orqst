// SYNTHETIC Feature/session identities. Neither a native confirmation nor a provider run.
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import {
  desktopStructuredAgentsRequestSchema,
  structuredAgentsRequestSchema,
  type StructuredSession,
} from '@orqst/protocol';
import { structuredMentionGrant } from '../apps/desktop/src/structured-mention.js';

const scope = { workspaceId: 'a'.repeat(64), featureId: randomUUID() };

function session(label: string, overrides: Partial<StructuredSession> = {}): StructuredSession {
  return {
    ...scope,
    sessionId: randomUUID(),
    provider: 'codex',
    label,
    lifecycle: 'ready',
    reportedModel: null,
    threadId: null,
    exit: null,
    items: [],
    droppedItems: 0,
    approvals: [],
    turn: null,
    busy: false,
    ...overrides,
  };
}

test('structured @mentions reuse the exact grant contract for the reviewed Feature', () => {
  const source = session('source');
  const worker = session('backend');
  const other = session('backend', { featureId: randomUUID() });
  const raw = {
    action: 'mention' as const,
    handle: '@Backend',
    sourceSessionId: source.sessionId,
    targetSessionId: worker.sessionId,
    task: 'SYNTHETIC exact  task',
  };
  assert.equal(desktopStructuredAgentsRequestSchema.safeParse(raw).success, true);
  assert.equal(structuredAgentsRequestSchema.safeParse(raw).success, false);
  assert.deepEqual(structuredMentionGrant(scope, [source, worker, other], raw), {
    action: 'grant',
    sourceSessionId: source.sessionId,
    targetSessionId: worker.sessionId,
    task: raw.task,
  });
  assert.equal(structuredMentionGrant(scope, [source, other], raw), undefined);
  assert.equal(
    structuredMentionGrant(scope, [source, worker, other], {
      ...raw,
      targetSessionId: other.sessionId,
    }),
    undefined,
  );
});

test('ambiguity, self and qualified handles fail closed; an exact session ID disambiguates', () => {
  const source = session('source');
  const worker = session('backend');
  const duplicate = session('Backend', { lifecycle: 'exited' });
  const entries = [source, worker, duplicate];
  const raw = {
    action: 'mention' as const,
    handle: '@backend',
    sourceSessionId: source.sessionId,
    targetSessionId: worker.sessionId,
    task: 'SYNTHETIC',
  };
  assert.equal(structuredMentionGrant(scope, entries, raw), undefined);
  assert.equal(
    structuredMentionGrant(scope, entries, { ...raw, handle: '@other/backend' }),
    undefined,
  );
  assert.equal(
    structuredMentionGrant(scope, entries, {
      ...raw,
      handle: '@source',
      targetSessionId: source.sessionId,
    }),
    undefined,
  );
  assert.equal(
    structuredMentionGrant(scope, entries, { ...raw, handle: `@${worker.sessionId}` })
      ?.targetSessionId,
    worker.sessionId,
  );
});
