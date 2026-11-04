// Pure metadata and transport checks; no provider, credentials or process startup.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { terminalSlotLimit, terminalIdentitySchema } from '@orqst/protocol';
import { terminalIdentity } from '../packages/core/src/terminal/identity.js';
import {
  terminalPairReadySchema,
  terminalPairRPCSchema,
} from '../packages/core/src/terminal/rpc.js';

test('one explicit numeric slot limit controls the bounded team transport', () => {
  assert.equal(terminalSlotLimit(), 2);
  for (const limit of [1, 3, 6, 8]) assert.equal(terminalSlotLimit(limit), limit);
  for (const limit of [0, -1, 9, 1.5, NaN, Infinity, '8', null])
    assert.throws(() => terminalSlotLimit(limit));
  const body = { kind: 'closeSlot', id: randomUUID() };
  for (const slot of [0, 2, 7])
    assert.ok(terminalPairRPCSchema.safeParse({ ...body, slot }).success);
  for (const slot of [-1, 8, 1.5, '2'])
    assert.equal(terminalPairRPCSchema.safeParse({ ...body, slot }).success, false);
});

test('ready identity arrays enforce the shared ceiling and strict metadata', () => {
  const identities = Array.from({ length: 8 }, (_, slot) => ({
    slot,
    terminalId: randomUUID(),
    provider: 'codex',
  }));
  const ready = {
    type: 'ready',
    id: randomUUID(),
    admissionOwner: randomUUID(),
    initialFiles: ['/synthetic/initial.json'],
    epoch: randomUUID(),
    identities,
  };
  assert.ok(terminalPairReadySchema.safeParse(ready).success);
  assert.equal(
    terminalPairReadySchema.safeParse({
      ...ready,
      identities: [...identities, { ...identities[0], slot: 8 }],
    }).success,
    false,
  );
  assert.equal(
    terminalIdentitySchema.safeParse({ terminalId: randomUUID(), command: 'start' }).success,
    false,
  );
});

test('persisted UUID aliases survive path/order changes while legacy paths are explicitly distinct', () => {
  const identity = { terminalId: randomUUID() };
  const before = terminalIdentity({ state: '/synthetic/a', identity });
  assert.deepEqual(terminalIdentity({ state: '/synthetic/elsewhere', identity }), before);
  assert.equal(before.alias, `P-${identity.terminalId}`);
  const legacy = terminalIdentity({ state: '/synthetic/legacy' });
  assert.ok(terminalIdentitySchema.safeParse({ terminalId: legacy.terminalId }).success);
  assert.deepEqual(terminalIdentity({ state: '/synthetic/legacy' }), legacy);
  assert.notEqual(terminalIdentity({ state: '/synthetic/new' }).terminalId, legacy.terminalId);
});
