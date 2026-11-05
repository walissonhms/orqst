// Shared client and document policy; synthetic transport only, no Electron types.
import assert from 'node:assert/strict';
import test from 'node:test';
import { terminalNativeReplySchema, type TerminalNativeRequest } from '@orqst/protocol';
import { createTerminalClient } from '../apps/desktop/src/terminal-client.js';
import {
  allowedTerminalRequest,
  terminalContentSecurityPolicy,
  terminalDocumentURL,
} from '../apps/desktop/src/terminal-policy.js';

test('preload requires activation for consent effects, validates both directions and does not queue', async () => {
  let active = false;
  let calls = 0;
  let resolve: ((value: unknown) => void) | undefined;
  const client = createTerminalClient(
    async () => {
      calls++;
      return new Promise((accept) => {
        resolve = accept;
      });
    },
    () => active,
  );
  const request: TerminalNativeRequest = { version: 1, action: 'start', profileId: 'synthetic' };
  assert.deepEqual(await client.request(request), { status: 'denied' });
  assert.equal(calls, 0);
  active = true;
  const pending = client.request(request);
  assert.deepEqual(await client.request(request), { status: 'busy' });
  assert.ok(resolve);
  resolve({ status: 'denied', signature: 'must-never-cross' });
  assert.deepEqual(await pending, { status: 'denied' });
  const broken = createTerminalClient(
    async () => {
      throw new Error('private diagnostic');
    },
    () => true,
  );
  assert.deepEqual(await broken.request(request), { status: 'denied' });
  assert.equal(
    terminalNativeReplySchema.safeParse({ status: 'ok', instanceId: 'bad' }).success,
    false,
  );
  assert.equal(
    terminalNativeReplySchema.safeParse({
      status: 'ok',
      instanceId: '751e6692-d50d-49d6-89aa-b285b62d1965',
      output: { bytes: new Array(65537).fill(0), nextCursor: 0, gap: false },
    }).success,
    false,
  );
});

test('terminal network policy is independent, exact and excludes Bridge, frames, query aliases and data URLs', () => {
  for (const [url, type] of [
    [terminalDocumentURL, 'mainFrame'],
    ['orqst-terminal://local/client.js', 'script'],
    ['orqst-terminal://local/style.css', 'stylesheet'],
  ])
    assert.equal(allowedTerminalRequest(url!, type!), true);
  for (const [url, type] of [
    ['http://127.0.0.1:4317/', 'mainFrame'],
    [terminalDocumentURL, 'subFrame'],
    [terminalDocumentURL + '?x=1', 'mainFrame'],
    ['orqst-terminal://local/client.js', 'xhr'],
    ['data:text/html,x', 'mainFrame'],
    ['file:///tmp/private', 'script'],
  ])
    assert.equal(allowedTerminalRequest(url!, type!), false);
  assert.ok(terminalContentSecurityPolicy.includes("connect-src 'none'"));
  assert.ok(terminalContentSecurityPolicy.includes("frame-src 'none'"));
});
