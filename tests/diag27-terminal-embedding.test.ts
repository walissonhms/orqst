import assert from 'node:assert/strict';
import test from 'node:test';
import { terminalDocument } from '../apps/desktop/src/terminal-document.js';
import { awaitPreparedOpen } from '../apps/tauri/src/prepared-open.js';
import { projectPaneLifecycle } from '../apps/dashboard/src/terminal-lifecycle.js';

test('the native Studio document contains only the terminal body and status feedback', () => {
  const html = terminalDocument({
    language: 'en-US',
    slot: 1,
    providers: ['codex', 'claude'],
    provider: 'claude',
    project: '/synthetic',
    version: '1.0.0',
    startProfile: 'claude-terminal-v1',
    operationalOpen: true,
    studioChrome: true,
    nativeAuthentication: true,
    scope: 'reuseScope',
    translate: (key) => key,
  });
  assert.match(html, /id="terminal"/);
  assert.match(html, /id="status" hidden/);
  assert.doesNotMatch(html, /<(header|aside|nav|footer|button|details)\b/);
  assert.doesNotMatch(html, /\/synthetic|pane-menu|process-controls/);
});

test('idle waits are bounded and a refusal after native dispatch is final', async () => {
  let attempts = 0;
  let pauses = 0;
  const value = await awaitPreparedOpen(
    async () => {
      attempts++;
      return { attempted: false };
    },
    async () => {
      pauses++;
    },
    () => true,
  );
  assert.equal(value, undefined);
  assert.equal(attempts, 12);
  assert.equal(pauses, 11);
  attempts = 0;
  const refused = await awaitPreparedOpen(
    async () => ({
      attempted: ++attempts === 2,
      value: { status: 'focus_required' },
    }),
    async () => {},
    () => true,
  );
  assert.deepEqual(refused, { status: 'focus_required' });
  assert.equal(attempts, 2);
});

test('a proven pre-dispatch refusal stays failed and offers a fresh user retry', () => {
  assert.deepEqual(projectPaneLifecycle({ transport: 'connected', process: 'open_refused' }), {
    state: 'failed',
    failure: { reason: 'native_authority_refused', evidence: 'open_refused', retryable: true },
  });
  assert.equal(
    projectPaneLifecycle({ transport: 'connected', process: 'open_unconfirmed' }).failure
      ?.retryable,
    false,
  );
});
