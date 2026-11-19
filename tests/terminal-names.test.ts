import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultTerminalNames } from '../apps/dashboard/src/terminal-names.js';

test('unnamed terminals skip Feature names and explicit requests in the same batch', () => {
  assert.deepEqual(
    defaultTerminalNames(
      ['codex 1', 'Claude 2'],
      [
        { name: '', providerName: 'Codex' },
        { name: 'Codex 2', providerName: 'Codex' },
        { name: '', providerName: 'Claude' },
        { name: '', providerName: 'Claude' },
      ],
    ),
    ['Codex 3', 'Codex 2', 'Claude 1', 'Claude 3'],
  );
  assert.deepEqual(defaultTerminalNames([], [{ name: '', providerName: 'Codex' }]), ['Codex 1']);
});
