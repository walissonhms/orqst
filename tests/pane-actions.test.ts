import assert from 'node:assert/strict';
import test from 'node:test';
import { paneActionRequest, profileAction } from '../apps/desktop/src/pane-actions.js';

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

test('every button action sends exactly its expected request', () => {
  assert.deepEqual(paneActionRequest('attach'), { action: 'attach' });
  assert.deepEqual(paneActionRequest('input'), { action: 'input' });
  assert.deepEqual(paneActionRequest('detach'), { action: 'detach' });
  assert.deepEqual(paneActionRequest('stop'), { action: 'stop', signal: 'SIGTERM' });
  assert.deepEqual(paneActionRequest('kill'), { action: 'stop', signal: 'SIGKILL' });
  assert.equal(paneActionRequest('hide-pane'), undefined);
  assert.equal(paneActionRequest('maximize'), undefined);
  assert.equal(paneActionRequest(''), undefined);
});

test('profile actions stay explicit and never lose start/login', () => {
  assert.deepEqual(profileAction('start', false), { action: 'start' });
  assert.deepEqual(profileAction('start', true), { action: 'open' });
  assert.deepEqual(profileAction('login', false), { action: 'start', login: true });
  assert.equal(profileAction('attach', true), undefined);
});
