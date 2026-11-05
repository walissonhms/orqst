import assert from 'node:assert/strict';
import test from 'node:test';
import { visualAllowedDuringFence } from '../apps/desktop/src/terminal-fence.js';

test('a shutdown fence rejects presentation and accepts only suspend/read', () => {
  for (const kind of ['layout-action', 'layout-open', 'layout-focus', 'resize'])
    assert.equal(visualAllowedDuringFence(kind), false);
  assert.equal(visualAllowedDuringFence('layout-generation'), true);
  assert.equal(visualAllowedDuringFence('layout-suspend'), true);
});
