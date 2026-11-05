// Synthetic Electron sender adapter; shared writer assertions live in artifact-writers.test.ts.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { IpcMainInvokeEvent, Session, WebContents } from 'electron';
import { authorizedArtifactSender } from '../apps/desktop/src/artifact-sender.js';

test('sender must be the live main frame, expected webContents, session and exact dashboard origin and routes', () => {
  const session = {} as Session;
  const origin = 'http://127.0.0.1:4321';
  const frame = { url: origin + '/', detached: false, isDestroyed: () => false };
  const sender = {
    session,
    mainFrame: frame,
    getURL: () => frame.url,
    isDestroyed: () => false,
  } as unknown as WebContents;
  const event = { sender, senderFrame: frame } as unknown as IpcMainInvokeEvent;
  const check = (value = event) => authorizedArtifactSender(value, sender, session, origin);
  for (const path of [
    '/',
    '/overview',
    '/workspaces',
    '/agents',
    '/models',
    '/settings',
    '/artifacts',
    '/overview#session=synthetic',
    '/overview/sessions/synthetic',
    '/overview/sessions/synthetic%20%3F%23%20sess%C3%A3o',
  ]) {
    frame.url = origin + path;
    assert.equal(check(), true, path);
  }
  assert.equal(
    check({ ...event, senderFrame: { ...frame } } as unknown as IpcMainInvokeEvent),
    false,
  );
  assert.equal(check({ ...event, sender: {} } as unknown as IpcMainInvokeEvent), false);
  assert.equal(authorizedArtifactSender(event, sender, {} as Session, origin), false);
  frame.detached = true;
  assert.equal(check(), false);
  frame.detached = false;
  for (const url of [
    'file:///synthetic.md',
    origin + '/api/bootstrap',
    ...[
      '/overview/',
      '/overview/sessions/a%2Fb',
      '/overview/sessions/a%252Fb',
      '/overview/sessions/id/extra',
      '/overview/sessions/id?x=1',
      '/settings/nested',
      '/arbitrary',
      '/%73ettings',
      '/settings?x=1',
      '/ws',
      '/assets/app.js',
    ].map((path) => origin + path),
    origin + '/?x=1',
    'orqst-desktop://offline/',
    'http://localhost:4321/',
  ]) {
    frame.url = url;
    assert.equal(check(), false);
  }
});
