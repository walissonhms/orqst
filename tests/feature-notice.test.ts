// Pure state resolution only; no browser, native host, Core or PTY is started.
import assert from 'node:assert/strict';
import test from 'node:test';
import { featureNoticeAfterSnapshot } from '../apps/dashboard/src/feature-notice.js';

test('a refused request stays visible until the authoritative state changes', () => {
  assert.equal(featureNoticeAfterSnapshot('denied', 4, 4), 'denied');
  assert.equal(featureNoticeAfterSnapshot('stale', 7, 7), 'stale');
});

test('a newer snapshot resolves an old refusal instead of masking it', () => {
  assert.equal(featureNoticeAfterSnapshot('denied', 4, 5), '');
  assert.equal(featureNoticeAfterSnapshot('unavailable', 0, 1), '');
});

test('no notice stays empty', () => {
  assert.equal(featureNoticeAfterSnapshot('', 3, 3), '');
  assert.equal(featureNoticeAfterSnapshot('', 3, 4), '');
});
