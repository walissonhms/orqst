// Synthetic transitions only. No OS notification or provider is invoked.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { OwnedTurnMonitor } from '../packages/core/src/terminal/owned-turn-monitor.js';

const preferences = { sound: false, completed: true, failed: true, intervention: true };

test('only a same-turn running transition alerts once, with preference and reconnect fences', () => {
  const monitor = new OwnedTurnMonitor();
  const terminalId = randomUUID();
  const turnId = randomUUID();
  const item = (agentState: 'running' | 'completed' | 'failed' | 'unknown', turn = turnId) => ({
    terminalId,
    turnId: turn,
    agentState,
  });
  assert.deepEqual(monitor.accept([item('completed')], preferences), []);
  assert.deepEqual(monitor.accept([item('running')], preferences), []);
  assert.deepEqual(monitor.accept([item('completed')], preferences), [
    { terminalId, turnId, category: 'completed', silent: true },
  ]);
  monitor.accept([item('running')], preferences);
  assert.deepEqual(monitor.accept([item('failed')], preferences), [
    { terminalId, turnId, category: 'failed', silent: true },
  ]);
  const second = randomUUID();
  monitor.accept([item('running', second)], preferences);
  assert.deepEqual(monitor.accept([item('failed', second)], { ...preferences, failed: false }), []);
  monitor.accept([item('running', second)], preferences);
  assert.deepEqual(monitor.accept([item('failed', second)], preferences), []);
  const third = randomUUID();
  monitor.accept([item('running', third)], preferences);
  monitor.disconnect();
  assert.deepEqual(monitor.accept([item('completed', third)], preferences), []);
  monitor.accept([item('running', third)], preferences);
  assert.deepEqual(monitor.accept([item('completed', randomUUID())], preferences), []);
  assert.throws(() => monitor.accept([item('running'), item('running')], preferences), /Duplicate/);
  const fourth = randomUUID();
  monitor.accept([item('running', fourth)], preferences);
  assert.throws(() => monitor.accept([item('completed', fourth)], {}), /Invalid/);
  assert.deepEqual(monitor.accept([item('completed', fourth)], preferences), []);
});

test('proved owned waiting state uses intervention preference and never replays within the turn', () => {
  const monitor = new OwnedTurnMonitor();
  const terminalId = randomUUID();
  const turnId = randomUUID();
  const item = (agentState: string, turn = turnId) => ({ terminalId, turnId: turn, agentState });
  monitor.accept([item('waiting_for_user')], preferences);
  assert.deepEqual(monitor.accept([item('waiting_for_user')], preferences), []);
  monitor.accept([item('running')], preferences);
  assert.deepEqual(monitor.accept([item('waiting_for_user')], preferences), [
    { terminalId, turnId, category: 'waiting_for_user', silent: true },
  ]);
  monitor.accept([item('running')], preferences);
  assert.deepEqual(monitor.accept([item('completed')], preferences), [
    { terminalId, turnId, category: 'completed', silent: true },
  ]);
  const next = randomUUID();
  monitor.accept([item('running', next)], preferences);
  assert.deepEqual(
    monitor.accept([item('waiting_for_user', next)], { ...preferences, intervention: false }),
    [],
  );
  monitor.accept([item('running', next)], preferences);
  assert.deepEqual(monitor.accept([item('waiting_for_user', next)], preferences), []);
  monitor.accept([item('running', next)], preferences);
  assert.deepEqual(monitor.accept([item('failed', next)], preferences), [
    { terminalId, turnId: next, category: 'failed', silent: true },
  ]);
  monitor.accept([item('running', next)], preferences);
  assert.deepEqual(monitor.accept([item('failed', next)], preferences), []);
});
