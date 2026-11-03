import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dashboardPathSchema, dashboardSessionPathSchema } from '@orqst/protocol';
import { allowedNavigation, allowedRequest } from '../apps/desktop/src/policy.js';
import { viewPath } from '../apps/dashboard/src/navigation.js';
import { sessionFromLocation } from '../apps/dashboard/src/session-link.js';

const origin = 'http://127.0.0.1:4347';
const prefix = '/overview/sessions/';

test('session paths share bounded canonical encoding and exact sender/request policy', () => {
  for (const id of ['synthetic-id', 'synthetic ?# sessão', '.synthetic', 'x'.repeat(200)]) {
    const path = prefix + encodeURIComponent(id);
    assert.equal(dashboardSessionPathSchema.safeParse(path).success, true, path);
    assert.equal(dashboardPathSchema.safeParse(path).success, true);
    assert.equal(viewPath('overview', id), path);
    assert.equal(allowedNavigation(origin + path, origin), true);
    assert.equal(allowedRequest(origin + path, origin, 'mainFrame'), true);
    assert.equal(sessionFromLocation({ pathname: path, hash: '' }, [id]), id);
    assert.equal(sessionFromLocation({ pathname: path, hash: '' }, []), undefined);
    assert.equal(sessionFromLocation({ pathname: path, hash: '#settings' }, [id]), undefined);
    assert.equal(allowedNavigation(origin + path + '?x=1', origin), false);
    assert.equal(allowedNavigation(origin.replace('127.0.0.1', 'localhost') + path, origin), false);
  }
});

test('session paths reject traversal, ambiguous encodings, controls and arbitrary nesting', () => {
  for (const segment of [
    '',
    '.',
    '..',
    '%2E',
    '%2E%2E',
    'a/b',
    'a%2Fb',
    'a%5Cb',
    'a%252Fb',
    '%',
    '%GG',
    '%C0%AF',
    '%00',
    '%0A',
    '%7F',
    '%C2%85',
    '%61gent',
    '%c3%a9',
    'a'.repeat(201),
    'a/extra',
  ]) {
    const path = prefix + segment;
    assert.equal(dashboardSessionPathSchema.safeParse(path).success, false, path);
    assert.equal(dashboardPathSchema.safeParse(path).success, false, path);
    assert.equal(allowedNavigation(origin + path, origin), false, path);
  }
});

test('legacy identities unsafe for path representation remain exact hash links without inventing IDs', () => {
  for (const id of [
    'synthetic /#? sessão',
    'synthetic\\id',
    'synthetic%2Fid',
    '.',
    '..',
    'synthetic\ncontrol',
  ]) {
    const path = viewPath('overview', id);
    const url = new URL(path, origin);
    assert.equal(url.pathname, '/overview');
    assert.equal(url.hash, '#session=' + encodeURIComponent(id));
    assert.equal(sessionFromLocation(url, [id]), id);
    assert.equal(allowedNavigation(url.href, origin), true);
  }
});

test('unrepresentable source IDs remain viewable in memory without emitting an invalid identity URL', () => {
  assert.equal(viewPath('overview', 'x'.repeat(201)), '/overview');
  assert.equal(viewPath('overview', '\ud800'), '/overview');
});
