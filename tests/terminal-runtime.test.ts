// Synthetic native/transport doubles. No Electron process, provider, credentials or session files.
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import type { BrowserWindow, IpcMain, IpcMainInvokeEvent, Session } from 'electron';
import { terminalNativeReplySchema, type TerminalNativeRequest } from '@orqst/protocol';
import { createTerminalClient } from '../apps/desktop/src/terminal-client.js';
import {
  allowedTerminalRequest,
  terminalContentSecurityPolicy,
} from '../apps/desktop/src/terminal-policy.js';
import { bindTerminalRuntime } from '../apps/desktop/src/terminal-runtime.js';
import { terminalDocumentURL } from '../apps/desktop/src/terminal-sender.js';
import { TerminalAuthority, terminalDigest } from '../packages/core/src/terminal/authority.js';
import { TerminalNativeBroker } from '../packages/core/src/terminal/native-broker.js';
import {
  TerminalSupervisor,
  type TerminalEvents,
} from '../packages/core/src/terminal/supervisor.js';

function setup() {
  const window = new EventEmitter();
  const contents = new EventEmitter();
  const session = {} as Session;
  const frame = { detached: false, isDestroyed: () => false, url: terminalDocumentURL };
  Object.assign(contents, {
    session,
    mainFrame: frame,
    isDestroyed: () => false,
    isFocused: () => true,
    getURL: () => frame.url,
  });
  Object.assign(window, { webContents: contents, isDestroyed: () => false, isFocused: () => true });
  const event = { sender: contents, senderFrame: frame } as unknown as IpcMainInvokeEvent;
  let handler: ((event: IpcMainInvokeEvent, input: unknown) => Promise<unknown>) | undefined;
  const ipc = {
    handle: (_name: string, value: typeof handler) => {
      handler = value;
    },
    removeHandler: () => {
      handler = undefined;
    },
  } as unknown as IpcMain;
  let starts = 0;
  let confirms = 0;
  let accept = true;
  let answer: () => Promise<boolean> = async () => accept;
  let supervisor: TerminalSupervisor | undefined;
  let events: TerminalEvents | undefined;
  const writes: string[] = [];
  const signals: string[] = [];
  const dispose = bindTerminalRuntime(
    ipc,
    window as BrowserWindow,
    session,
    (document, current) => {
      const keys = generateKeyPairSync('ed25519');
      const authority = new TerminalAuthority(new Map([['runtime', keys.publicKey]]));
      supervisor = new TerminalSupervisor(
        authority,
        {
          validate: () => true,
          start: (_profile, handlers) => {
            starts++;
            events = handlers;
            handlers.started();
            return {
              write: (text) => {
                writes.push(text);
              },
              resize: () => {},
              signal: (signal) => {
                signals.push(signal);
              },
              dispose: () => {},
            };
          },
        },
        [
          {
            id: 'synthetic',
            projectId: 'disposable',
            executable: '/synthetic/node',
            executableSha256: terminalDigest('synthetic'),
            executableVersion: 'synthetic',
            argv: [],
            cwd: '/synthetic',
            environmentProfile: 'no-secrets',
            permissions: 'synthetic only',
          },
        ],
      );
      return new TerminalNativeBroker(authority, supervisor, 'runtime', keys.privateKey, document, {
        current: (_document, focus) => current(focus),
        confirm: async () => {
          confirms++;
          return answer();
        },
      });
    },
  );
  const send = async (request: unknown, sender = event) =>
    terminalNativeReplySchema.parse(await handler!(sender, request));
  const action = (name: string, fields = {}) => send({ version: 1, action: name, ...fields });
  const start = async () => {
    const result = await action('start', { profileId: 'synthetic' });
    assert.equal(result.status, 'ok');
    if (result.status !== 'ok') throw new Error('Expected synthetic instance');
    return result.instanceId;
  };
  return {
    window,
    contents,
    frame,
    event,
    dispose,
    send,
    action,
    start,
    writes,
    signals,
    loaded: () => contents.emit('did-finish-load'),
    starts: () => starts,
    confirms: () => confirms,
    handler: () => handler,
    events: () => {
      assert.ok(events);
      return events;
    },
    supervisor: () => {
      assert.ok(supervisor);
      return supervisor;
    },
    accept: (value: boolean) => {
      accept = value;
    },
    answer: (value: typeof answer) => {
      answer = value;
    },
  };
}

test('runtime requires an initialized exact dedicated document and denies unknown command authority', async () => {
  const s = setup();
  assert.equal((await s.action('start', { profileId: 'synthetic' })).status, 'denied');
  s.loaded();
  assert.equal(
    (await s.send({ version: 1, action: 'start', profileId: 'synthetic', env: {} })).status,
    'denied',
  );
  assert.equal(
    (
      await s.send({ version: 1, action: 'start', profileId: 'synthetic' }, {
        ...s.event,
        senderFrame: {},
      } as IpcMainInvokeEvent)
    ).status,
    'denied',
  );
  s.frame.url = 'http://127.0.0.1:4317/';
  assert.equal((await s.action('start', { profileId: 'synthetic' })).status, 'denied');
  assert.equal(s.starts(), 0);
  assert.equal(s.confirms(), 0);
  s.dispose();
});

test('runtime connects cancellation, native grants, inert bounded output and separate input/stop', async () => {
  const s = setup();
  s.loaded();
  s.accept(false);
  assert.equal((await s.action('start', { profileId: 'synthetic' })).status, 'cancelled');
  assert.equal(s.starts(), 0);
  s.accept(true);
  const id = await s.start();
  assert.equal((await s.action('attach', { instanceId: id })).status, 'ok');
  s.events().data('\x1b]52;c;untrusted\x07');
  const output = await s.action('read', { instanceId: id, cursor: 0 });
  assert.equal(output.status, 'ok');
  if (output.status !== 'ok') throw new Error('Expected inert bytes');
  assert.deepEqual(output.output?.bytes, [...Buffer.from('\x1b]52;c;untrusted\x07')]);
  assert.equal((await s.action('input', { instanceId: id })).status, 'ok');
  assert.equal((await s.action('write', { instanceId: id, sequence: 0, text: 'a' })).status, 'ok');
  s.window.emit('blur');
  assert.equal(
    (await s.action('write', { instanceId: id, sequence: 1, text: 'b' })).status,
    'denied',
  );
  assert.deepEqual(s.writes, ['a']);
  assert.equal((await s.action('stop', { instanceId: id, signal: 'SIGTERM' })).status, 'ok');
  assert.equal(s.supervisor().snapshot(id).state, 'running');
  assert.deepEqual(s.signals, ['SIGTERM']);
  s.events().lost();
  s.events().exit(0);
  assert.equal(s.supervisor().snapshot(id).state, 'ownership_lost');
  s.dispose();
});

test('runtime serializes dialogs and permanently revokes pending work on navigation/reload', async () => {
  const s = setup();
  s.loaded();
  let resolve: ((accepted: boolean) => void) | undefined;
  s.answer(
    () =>
      new Promise<boolean>((accept) => {
        resolve = accept;
      }),
  );
  const pending = s.action('start', { profileId: 'synthetic' });
  assert.equal((await s.action('start', { profileId: 'synthetic' })).status, 'busy');
  s.contents.emit('did-start-navigation', {}, terminalDocumentURL, false, true);
  assert.ok(resolve);
  resolve(true);
  assert.equal((await pending).status, 'denied');
  s.loaded();
  assert.equal((await s.action('start', { profileId: 'synthetic' })).status, 'denied');
  assert.equal(s.starts(), 0);
  s.dispose();
  s.dispose();
  assert.equal(s.handler(), undefined);
  assert.equal(s.contents.listenerCount('did-finish-load'), 0);
  assert.equal(s.window.listenerCount('blur'), 0);
});

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
