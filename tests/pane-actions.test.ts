import assert from 'node:assert/strict';
import test from 'node:test';
import { paneActionRequest } from '../apps/desktop/src/pane-actions.js';

test('hide and detach never signal the process', () => {
  // Hide is layout-only: it produces no native process request at all.
  assert.equal(paneActionRequest('hide-pane'), undefined);
  assert.equal(paneActionRequest('hide'), undefined);
  assert.deepEqual(paneActionRequest('detach'), { action: 'detach' });
  assert.equal('signal' in paneActionRequest('detach')!, false);
});

test('stop sends SIGTERM and terminate forces SIGKILL', () => {
  assert.deepEqual(paneActionRequest('stop'), { action: 'stop', signal: 'SIGTERM' });
  assert.deepEqual(paneActionRequest('kill'), { action: 'stop', signal: 'SIGKILL' });
});

test('unknown actions map to nothing', () => {
  assert.equal(paneActionRequest('maximize'), undefined);
  assert.equal(paneActionRequest(''), undefined);
});
