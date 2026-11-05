// Pure state resolution only; no browser, native host, Core or PTY is started.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  featureNoticeAfterSnapshot,
  featureNoticeContext,
} from '../apps/dashboard/src/feature-notice.js';
import type { FeatureNativeSnapshot } from '@orqst/protocol';

function snapshot(
  activeFeatureId: string | null,
  viewRevision: number,
  features: Array<{ featureId: string; revision: number }>,
) {
  return {
    activeFeatureId,
    view: { revision: viewRevision },
    features,
  } as unknown as FeatureNativeSnapshot;
}

const raised = featureNoticeContext(
  snapshot('auth', 4, [
    { featureId: 'auth', revision: 2 },
    { featureId: 'dash', revision: 1 },
  ]),
  'auth',
);

test('an unrelated generation bump keeps the refusal and its reason', () => {
  const incoming = snapshot('auth', 4, [
    { featureId: 'auth', revision: 2 },
    { featureId: 'dash', revision: 1 },
  ]);
  assert.equal(featureNoticeAfterSnapshot('denied', raised, incoming), 'denied');
  assert.equal(featureNoticeAfterSnapshot('stale', raised, incoming), 'stale');
});

test('a view-only bump keeps the refusal because the target did not change', () => {
  const incoming = snapshot('auth', 9, [
    { featureId: 'auth', revision: 2 },
    { featureId: 'dash', revision: 1 },
  ]);
  assert.equal(featureNoticeAfterSnapshot('denied', raised, incoming), 'denied');
});

test('the refused target changing clears the refusal', () => {
  const other = snapshot('dash', 4, [
    { featureId: 'auth', revision: 2 },
    { featureId: 'dash', revision: 1 },
  ]);
  assert.equal(featureNoticeAfterSnapshot('denied', raised, other), '');
});

test('the same target actually changing clears the refusal', () => {
  const feature = snapshot('auth', 4, [
    { featureId: 'auth', revision: 3 },
    { featureId: 'dash', revision: 1 },
  ]);
  assert.equal(featureNoticeAfterSnapshot('denied', raised, feature), '');
});
