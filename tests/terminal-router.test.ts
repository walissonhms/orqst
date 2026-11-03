// Exact native-frame routing with two synthetic documents. No Electron or provider process.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import type { BrowserWindow, IpcMain, IpcMainInvokeEvent, Session } from 'electron';
import { createTerminalRuntimeRouter } from '../apps/desktop/src/terminal-runtime.js';
import { terminalDocumentURL } from '../apps/desktop/src/terminal-sender.js';

test('one native IPC router isolates busy, active event, blur, navigation and disposal for both documents', async () => {
  let registered = 0,
    removed = 0;
  let dispatch: (event: IpcMainInvokeEvent, raw: unknown) => Promise<unknown>;
  const ipc = {
    handle(_name: string, handler: typeof dispatch) {
      registered++;
      dispatch = handler;
    },
    removeHandler() {
      removed++;
    },
  } as unknown as IpcMain;
  const router = createTerminalRuntimeRouter(ipc);
  const bind = () => {
    const window = new EventEmitter(),
      contents = new EventEmitter();
    const session = {} as Session;
    const frame = { detached: false, isDestroyed: () => false, url: terminalDocumentURL };
    Object.assign(contents, {
      session,
      mainFrame: frame,
      isDestroyed: () => false,
      isFocused: () => true,
      getURL: () => frame.url,
    });
    Object.assign(window, {
      webContents: contents,
      isDestroyed: () => false,
      isFocused: () => true,
    });
    const event = { sender: contents, senderFrame: frame } as unknown as IpcMainInvokeEvent;
    const id = randomUUID();
    let revoked = 0,
      closed = 0,
      calls = 0;
    let delay: Promise<void> | undefined;
    const dispose = router.bind(
      window as unknown as BrowserWindow,
      session,
      (_document, current) => ({
        async dispatch(_document, raw) {
          calls++;
          await delay;
          assert.equal(current(false), true);
          if ((raw as { instanceId: string }).instanceId !== id) return { status: 'denied' };
          return { status: 'ok', instanceId: id };
        },
        revokeInput() {
          revoked++;
        },
        close() {
          closed++;
        },
      }),
    );
    contents.emit('did-finish-load');
    return {
      window,
      contents,
      event,
      id,
      dispose,
      calls: () => calls,
      closed: () => closed,
      revoked: () => revoked,
      delay: (value: Promise<void> | undefined) => {
        delay = value;
      },
      send: () => dispatch(event, { version: 1, action: 'snapshot', instanceId: id }),
    };
  };
  const a = bind(),
    b = bind();
  assert.equal(registered, 1);
  assert.throws(bind, /capacity/);
  assert.deepEqual(await dispatch!({ ...a.event, senderFrame: {} } as IpcMainInvokeEvent, {}), {
    status: 'denied',
  });
  let release: () => void = () => {};
  a.delay(
    new Promise<void>((resolve) => {
      release = resolve;
    }),
  );
  const pending = a.send();
  assert.deepEqual(await a.send(), { status: 'busy' });
  assert.deepEqual(await b.send(), { status: 'ok', instanceId: b.id });
  release();
  assert.deepEqual(await pending, { status: 'ok', instanceId: a.id });
  a.delay(undefined);
  assert.deepEqual(await dispatch!(a.event, { version: 1, action: 'snapshot', instanceId: b.id }), {
    status: 'denied',
  });
  a.window.emit('blur');
  assert.equal(a.revoked(), 1);
  assert.equal(b.revoked(), 0);
  a.contents.emit('did-start-navigation', {}, terminalDocumentURL, false, true);
  a.contents.emit('did-finish-load');
  assert.deepEqual(await a.send(), { status: 'denied' });
  assert.deepEqual(await b.send(), { status: 'ok', instanceId: b.id });
  a.dispose();
  assert.equal(removed, 0);
  assert.deepEqual(await b.send(), { status: 'ok', instanceId: b.id });
  assert.equal(a.calls(), 2);
  assert.equal(b.calls(), 3);
  router.close();
  router.close();
  assert.equal(removed, 1);
  assert.ok(a.closed() > 0);
  assert.ok(b.closed() > 0);
});
