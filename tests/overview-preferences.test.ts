import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultOverviewPreferences,
  moveOverviewPanel,
  overviewPanels,
  parseOverviewPreferences,
} from '../apps/dashboard/src/overview-preferences.js';

test('overview layout accepts only bounded, known panel identities and never persists source content', () => {
  for (const value of [null, '', 'bad-json', '[]', 'null', '42', ' '.repeat(4097)])
    assert.deepEqual(parseOverviewPreferences(value), defaultOverviewPreferences);
  assert.deepEqual(
    parseOverviewPreferences(
      JSON.stringify({
        order: ['diagnostics', 'execute', null, {}, 'diagnostics', 'activity'],
        hidden: ['usage', 'usage', 'unknown', '<script>'],
        task: 'Synthetic captured content must not persist',
      }),
    ),
    { order: ['diagnostics', 'activity', 'attention', 'usage'], hidden: ['usage'] },
  );
  assert.deepEqual(
    parseOverviewPreferences(JSON.stringify({ order: false, hidden: {} })),
    defaultOverviewPreferences,
  );
});

test('partial layouts append missing supported panels while explicitly hidden panels remain hidden', () => {
  assert.deepEqual(parseOverviewPreferences('{"order":["usage"],"hidden":["attention"]}'), {
    order: ['usage', 'activity', 'attention', 'diagnostics'],
    hidden: ['attention'],
  });
  assert.deepEqual(
    parseOverviewPreferences(JSON.stringify({ hidden: overviewPanels })).hidden,
    overviewPanels,
  );
});

test('keyboard reorder preserves panel identity and visibility without mutating defaults or crossing boundaries', () => {
  const original = { order: [...overviewPanels], hidden: ['usage' as const] };
  const moved = moveOverviewPanel(original, 'attention', -1);
  assert.deepEqual(moved, {
    order: ['attention', 'activity', 'usage', 'diagnostics'],
    hidden: ['usage'],
  });
  assert.deepEqual(original.order, overviewPanels);
  assert.equal(moveOverviewPanel(moved, 'attention', -1), moved);
  assert.equal(moveOverviewPanel(moved, 'diagnostics', 1), moved);
  assert.deepEqual(moveOverviewPanel(moved, 'attention', 1), original);
});
