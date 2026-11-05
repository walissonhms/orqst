// Electron sender, confirmation and lifecycle adapters; shared broker cases are neutral.
import assert from 'node:assert/strict';
import test from 'node:test';
import type { BrowserWindow, IpcMainInvokeEvent, Session, WebFrameMain } from 'electron';
import {
  authorizedTerminalSender,
  terminalDocumentURL,
} from '../apps/desktop/src/terminal-sender.js';

import { terminalBrokerFixture as setup } from './helpers/terminal-broker.js';

test('dedicated sender denies observer document, stale generation, subframes and unfocused input', () => {
  const session = {} as Session;
  let frameURL = terminalDocumentURL;
  const frame = {
    detached: false,
    isDestroyed: () => false,
    get url() {
      return frameURL;
    },
  } as WebFrameMain;
  let focused = true;
  const contents = {
    isDestroyed: () => false,
    session,
    mainFrame: frame,
    getURL: () => frame.url,
    isFocused: () => focused,
  };
  const window = {
    isDestroyed: () => false,
    webContents: contents,
    isFocused: () => focused,
  } as unknown as BrowserWindow;
  const event = { sender: contents, senderFrame: frame } as unknown as IpcMainInvokeEvent;
  const binding = { frame, generation: 1 };
  const authorized = (generation = 1, focus = true) =>
    authorizedTerminalSender(event, window, session, binding, generation, focus);
  assert.equal(authorized(), true);
  assert.equal(authorized(2), false);
  focused = false;
  assert.equal(authorized(), false);
  assert.equal(authorized(1, false), true);
  focused = true;
  frameURL = 'http://127.0.0.1:4317/';
  assert.equal(authorized(), false);
  frameURL = terminalDocumentURL;
  assert.equal(
    authorizedTerminalSender(
      { ...event, senderFrame: {} } as IpcMainInvokeEvent,
      window,
      session,
      binding,
      1,
      true,
    ),
    false,
  );
  assert.equal(authorizedTerminalSender(event, window, {} as Session, binding, 1, true), false);
});

test('native confirmation uses Cancel by default, displays exact escaped details and refuses oversized review', async () => {
  const { confirmTerminalAction } = await import('../apps/desktop/src/terminal-confirmation.js');
  const s = setup();
  await s.start();
  const details = s.confirmations[0]!;
  let options: import('electron').MessageBoxOptions | undefined;
  let response = 0;
  let calls = 0;
  const show = async (_window: BrowserWindow, value: import('electron').MessageBoxOptions) => {
    calls++;
    options = value;
    return { response, checkboxChecked: false };
  };
  const dialog = { showMessageBox: show as import('electron').Dialog['showMessageBox'] };
  const window = {} as BrowserWindow;
  const translate = (key: string) => key;
  assert.equal(await confirmTerminalAction(dialog, window, translate, details), false);
  assert.equal(options?.defaultId, 0);
  assert.equal(options?.cancelId, 0);
  assert.deepEqual(options?.buttons, ['terminalNative.cancel', 'terminalNative.confirm']);
  assert.deepEqual(JSON.parse(options?.detail ?? ''), details);
  response = 1;
  assert.equal(
    await confirmTerminalAction(dialog, window, translate, {
      ...details,
      operation: 'paste',
      paste: 'line1\n\x1b\u202e',
    }),
    true,
  );
  assert.equal(options?.detail?.includes('\x1b'), false);
  assert.equal(options?.detail?.includes('\u202e'), false);
  const before = calls;
  assert.equal(
    await confirmTerminalAction(dialog, window, translate, {
      ...details,
      paste: 'x'.repeat(1025),
    }),
    false,
  );
  assert.equal(
    await confirmTerminalAction(dialog, window, translate, {
      ...details,
      profile: { ...details.profile, permissions: 'x'.repeat(4096) },
    }),
    false,
  );
  assert.equal(calls, before);
});

test('native lifecycle invalidates blur, main navigation, process loss and destruction without control renewal', async () => {
  const { EventEmitter } = await import('node:events');
  const { bindTerminalNativeLifecycle } = await import('../apps/desktop/src/terminal-lifecycle.js');
  const window = new EventEmitter();
  const contents = new EventEmitter();
  Object.assign(window, { webContents: contents });
  let revocations = 0;
  let closes = 0;
  const dispose = bindTerminalNativeLifecycle(window as BrowserWindow, {
    revokeInput: () => {
      revocations++;
    },
    close: () => {
      closes++;
    },
  });
  window.emit('blur');
  contents.emit('did-start-navigation', {}, 'ignored', false, false);
  assert.equal(revocations, 1);
  assert.equal(closes, 0);
  contents.emit('did-start-navigation', {}, 'ignored', false, true);
  contents.emit('render-process-gone');
  contents.emit('destroyed');
  window.emit('closed');
  assert.equal(closes, 4);
  dispose();
  assert.equal(closes, 5);
  assert.equal(window.listenerCount('blur'), 0);
  assert.equal(contents.listenerCount('did-start-navigation'), 0);
});
