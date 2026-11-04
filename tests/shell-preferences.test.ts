import { test } from 'node:test';
import { viewFromLocation, viewPath } from '../apps/dashboard/src/navigation.js';
import assert from 'node:assert/strict';
import {
  defaultShellPreferences,
  parseShellPreferences,
  readShellPreferences,
  viewFromHash,
} from '../apps/dashboard/src/shell-preferences.js';

test('local shell preferences reject malformed storage and unsupported capabilities', () => {
  for (const value of [null, 'bad-json', '[]', 'null', '42']) {
    assert.deepEqual(parseShellPreferences(value), defaultShellPreferences);
  }
  assert.deepEqual(
    parseShellPreferences(
      JSON.stringify({
        view: 'not-implemented',
        workspaceId: '/'.repeat(4096),
        status: 'idle',
        collapsed: 'true',
        workspaceLayout: 'terminal',
        workspaceSort: 'cost',
      }),
    ),
    defaultShellPreferences,
  );
  assert.deepEqual(
    parseShellPreferences(
      JSON.stringify({
        view: 'agents',
        workspaceId: 'synthetic-workspace',
        status: 'unknown',
        collapsed: true,
        workspaceLayout: 'list',
        workspaceSort: 'name',
        task: 'must not persist',
        execute: true,
      }),
    ),
    {
      view: 'agents',
      workspaceId: 'synthetic-workspace',
      status: 'unknown',
      collapsed: true,
      workspaceLayout: 'list',
      workspaceSort: 'name',
    },
  );
  assert.deepEqual(readShellPreferences(), defaultShellPreferences);
});
test('hash navigation admits only implemented views, leaving session identities to their existing resolver', () => {
  for (const view of [
    'overview',
    'studio',
    'workspaces',
    'agents',
    'models',
    'settings',
    'artifacts',
  ])
    assert.equal(viewFromHash(`#${view}`), view);
  for (const hash of [
    '',
    '#not-implemented',
    '#session=synthetic',
    '#models?run=true',
    '#WORKSPACES',
  ])
    assert.equal(viewFromHash(hash), undefined);
});

test('clean paths and legacy view aliases resolve only implemented views', () => {
  for (const view of [
    'overview',
    'studio',
    'workspaces',
    'agents',
    'models',
    'settings',
    'artifacts',
  ] as const) {
    assert.equal(viewFromLocation({ pathname: '/' + view, hash: '' }), view);
    assert.equal(viewFromLocation({ pathname: '/', hash: '#' + view }), view);
    assert.equal(viewPath(view), '/' + view);
  }
  assert.equal(viewFromLocation({ pathname: '/settings', hash: '#agents' }), 'agents');
  assert.equal(viewFromLocation({ pathname: '/', hash: '#session=synthetic' }), 'overview');
  assert.equal(viewPath('overview', 'synthetic /?é'), '/overview#session=synthetic%20%2F%3F%C3%A9');
  assert.equal(viewPath('settings', 'synthetic'), '/settings');
  for (const pathname of ['/', '/unknown', '/settings/nested', '/overview/', '/%73ettings']) {
    assert.equal(viewFromLocation({ pathname, hash: '' }), undefined);
  }
});
