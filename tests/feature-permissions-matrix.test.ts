import assert from 'node:assert/strict';
import test from 'node:test';
import {
  permissionConfiguration,
  permissionProblems,
  permissionRules,
  permissionTerminals,
  toggleOperation,
} from '../apps/dashboard/src/feature-permissions-matrix.js';

test('terminals are the Feature members labelled by slot', () => {
  const snapshot = {
    features: [{ featureId: 'f', terminalIds: ['a', 'b'] }],
    slots: [
      { slot: 0, terminalId: 'a', provider: 'codex' },
      { slot: 3, terminalId: 'b', provider: 'claude' },
      { slot: 1, terminalId: 'c', provider: 'opencode' },
    ],
  } as never;
  assert.deepEqual(permissionTerminals(snapshot, 'f'), [
    { terminalId: 'a', label: 'T-001', provider: 'codex' },
    { terminalId: 'b', label: 'T-004', provider: 'claude' },
  ]);
});

test('self-send, duplicate and delegate cycles are refused', () => {
  assert.deepEqual(
    permissionProblems([{ sourceTerminalId: 'a', targetTerminalId: 'a', operations: ['view'] }]),
    ['self'],
  );
  assert.deepEqual(
    permissionProblems([
      { sourceTerminalId: 'a', targetTerminalId: 'b', operations: ['view'] },
      { sourceTerminalId: 'a', targetTerminalId: 'b', operations: ['execute'] },
    ]),
    ['duplicate'],
  );
  assert.deepEqual(
    permissionProblems([
      { sourceTerminalId: 'a', targetTerminalId: 'b', operations: ['delegate'] },
      { sourceTerminalId: 'b', targetTerminalId: 'a', operations: ['delegate'] },
    ]),
    ['cycle'],
  );
});

test('toggling adds and removes exactly one operation', () => {
  const added = toggleOperation([], 'a', 'b', 'execute');
  assert.deepEqual(added, [
    { sourceTerminalId: 'a', targetTerminalId: 'b', operations: ['execute'] },
  ]);
  const removed = toggleOperation(added, 'a', 'b', 'execute');
  assert.deepEqual(removed, []);
  assert.deepEqual(permissionConfiguration(added), {
    schemaVersion: 1,
    rules: [{ sourceTerminalId: 'a', targetTerminalId: 'b', operations: ['execute'] }],
  });
});

test('parsing keeps only known operations', () => {
  assert.deepEqual(
    permissionRules({
      rules: [{ sourceTerminalId: 'a', targetTerminalId: 'b', operations: ['view', 'nope'] }],
    }),
    [{ sourceTerminalId: 'a', targetTerminalId: 'b', operations: ['view'] }],
  );
});
