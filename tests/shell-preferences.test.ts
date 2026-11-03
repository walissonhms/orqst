import { test } from 'node:test';
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
        view: 'studio',
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
  for (const view of ['overview', 'workspaces', 'agents', 'models', 'settings'])
    assert.equal(viewFromHash(`#${view}`), view);
  for (const hash of ['', '#studio', '#session=synthetic', '#models?run=true', '#WORKSPACES'])
    assert.equal(viewFromHash(hash), undefined);
});
