import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseBrowserPort } from './helpers/browser-port.js';

test('browser fixture port defaults separately from production and accepts isolated ports', () => {
  assert.equal(parseBrowserPort(undefined), 4318);
  assert.equal(parseBrowserPort('4320'), 4320);
  assert.equal(parseBrowserPort('1024'), 1024);
  assert.equal(parseBrowserPort('65535'), 65535);
});

test('browser fixture rejects production, invalid and out-of-range ports', () => {
  for (const value of ['', '0', '1023', '65536', '4317', '4320.5', '4320x', '-1', ' 4320', 'NaN'])
    assert.throws(() => parseBrowserPort(value), /ORQST_BROWSER_PORT/);
});
