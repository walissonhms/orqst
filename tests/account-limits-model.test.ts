import assert from 'node:assert/strict';
import test from 'node:test';
import {
  level,
  parseAccountLimits,
  renewsIn,
  worstWindow,
} from '../apps/dashboard/src/account-limits-model.js';

const caps = { warn: 60, critical: 85 };
const hour = 3_600_000;

test('levels follow the configured caps; unknown stays unknown', () => {
  assert.equal(level(10, caps), 'ok');
  assert.equal(level(60, caps), 'warn');
  assert.equal(level(85, caps), 'critical');
  assert.equal(level(undefined, caps), 'unknown');
});

test('renewal countdowns are compact and never negative', () => {
  const now = 1_000_000_000;
  assert.equal(renewsIn(now + 106 * hour, now), '4d10h');
  assert.equal(renewsIn(now + 21.25 * hour, now), '21h15m');
  assert.equal(renewsIn(now + 5 * 60_000, now), '5m');
  assert.equal(renewsIn(now - 1, now), '—');
  assert.equal(renewsIn(undefined, now), '—');
});

test('the most used window represents the account', () => {
  assert.equal(
    worstWindow({
      id: 'a',
      provider: 'claude',
      index: 1,
      locked: false,
      windows: [
        { id: 'w', label: 'Week', usedPercent: 46 },
        { id: 'm', label: 'Model', usedPercent: 81 },
        { id: 'u', label: 'Unknown' },
      ],
    })?.id,
    'm',
  );
});

test('host data is validated; malformed values are dropped, not guessed', () => {
  const parsed = parseAccountLimits([
    {
      id: 'synthetic-1',
      provider: 'codex',
      index: 1,
      plan: 'PRO',
      locked: true,
      windows: [
        { id: 'week', label: 'Week', usedPercent: 20, resetsAt: 5 },
        { id: 'bad', label: 'Bad', usedPercent: 140 },
      ],
    },
    { id: 'x', provider: 'unknown-cli', index: 1, windows: [] },
    'nonsense',
  ]);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0]!.locked, true);
  assert.deepEqual(parsed[0]!.windows, [
    { id: 'week', label: 'Week', usedPercent: 20, resetsAt: 5 },
    { id: 'bad', label: 'Bad' },
  ]);
  assert.deepEqual(parseAccountLimits(undefined), []);
});
