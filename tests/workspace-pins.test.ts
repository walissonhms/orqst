import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  maxWorkspacePins,
  parseWorkspacePins,
  pinnedFirst,
} from '../apps/dashboard/src/workspace-pins.js';

test('workspace pins admit only bounded exact identifiers and ignore unrelated storage fields', () => {
  for (const value of [null, '', '{bad', '{}', 'null', 'true', '0', '[]'.repeat(70_000)])
    assert.deepEqual(parseWorkspacePins(value), []);
  assert.deepEqual(
    parseWorkspacePins(
      JSON.stringify([
        'synthetic-b',
        'synthetic-b',
        '',
        null,
        42,
        {},
        'x'.repeat(201),
        'synthetic\ninvalid',
        'synthetic-a',
        '<synthetic>',
      ]),
    ),
    ['synthetic-b', 'synthetic-a', '<synthetic>'],
  );
  const many = Array.from({ length: 150 }, (_, index) => `synthetic-${index}`);
  assert.deepEqual(parseWorkspacePins(JSON.stringify(many)), many.slice(0, maxWorkspacePins));
});

test('pin priority preserves within-group order and never fabricates or mutates workspace records', () => {
  const records = [{ id: 'synthetic-a' }, { id: 'synthetic-b' }, { id: 'synthetic-c' }];
  const result = pinnedFirst(records, ['synthetic-c', 'missing', 'synthetic-b']);
  assert.deepEqual(
    result.map((item) => item.id),
    ['synthetic-b', 'synthetic-c', 'synthetic-a'],
  );
  assert.equal(result[0], records[1]);
  assert.deepEqual(
    records.map((item) => item.id),
    ['synthetic-a', 'synthetic-b', 'synthetic-c'],
  );
  assert.deepEqual(pinnedFirst(records, []), records);
});
