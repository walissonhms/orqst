import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  allowedNavigation,
  allowedRequest,
  bridgeOrigin,
  escapeHTML,
  offlineURL,
} from '../apps/desktop/src/policy.js';

test('desktop configuration accepts only a bounded loopback port', () => {
  assert.equal(bridgeOrigin(undefined), 'http://127.0.0.1:4317');
  assert.equal(bridgeOrigin('4320'), 'http://127.0.0.1:4320');
  for (const value of ['', '0', '1023', '65536', '4e3', '4320/path', 'https://example.com'])
    assert.throws(() => bridgeOrigin(value));
});

test('desktop limits navigation and resources to its configured Bridge', () => {
  const origin = bridgeOrigin('4320');
  for (const url of [origin + '/', origin + '/#models', offlineURL])
    assert.equal(allowedNavigation(url, origin), true, url);
  for (const url of [
    origin + '/api/snapshot',
    origin + '/?url=https://example.com',
    'http://user@127.0.0.1:4320/',
    'http://127.0.0.1:4317/',
    'http://localhost:4320/',
    'https://example.com/',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'orqst-desktop://offline/other',
    'invalid',
  ])
    assert.equal(allowedNavigation(url, origin), false, url);
  assert.equal(allowedRequest(origin + '/api/snapshot', origin, 'xhr'), true);
  assert.equal(allowedRequest('ws://127.0.0.1:4320/ws?after=2', origin, 'webSocket'), true);
  for (const [url, type] of [
    ['http://127.0.0.1:4317/api/bootstrap', 'xhr'],
    ['https://example.com/track', 'image'],
    ['ws://127.0.0.1:4320/other', 'webSocket'],
    [origin + '/', 'subFrame'],
    ['data:text/html,hello', 'mainFrame'],
    ['file:///etc/passwd', 'xhr'],
    [offlineURL, 'script'],
  ] as const)
    assert.equal(allowedRequest(url, origin, type), false, url);
  assert.equal(
    escapeHTML('<script>"&\'</script>'),
    '&lt;script&gt;&quot;&amp;&#39;&lt;/script&gt;',
  );
});
