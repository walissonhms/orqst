import assert from 'node:assert/strict';
import test from 'node:test';
import { quitBlocked } from '../apps/dashboard/src/quit-notice.js';

test('a blocked quit keeps its reason and bounded uncertain slots', () => {
  assert.deepEqual(
    quitBlocked({ reason: 'uncertain', uncertain: [{ slot: 1, reason: 'timeout' }] }),
    { reason: 'uncertain', uncertain: [{ slot: 1, reason: 'timeout' }] },
  );
});

test('malformed or unknown reasons never render a fake state', () => {
  assert.equal(quitBlocked(undefined), null);
  assert.equal(quitBlocked({ reason: 'made-up' }), null);
  assert.deepEqual(quitBlocked({ reason: 'transport', uncertain: [{ slot: 9 }] }), {
    reason: 'transport',
    uncertain: [],
  });
});
