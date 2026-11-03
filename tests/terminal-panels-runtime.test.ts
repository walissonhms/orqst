// Synthetic native objects only; no Electron process, provider or credentials.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import type { BrowserWindow, IpcMain, IpcMainInvokeEvent, Session, WebContents } from 'electron';
import { createTerminalRuntimeRouter } from '../apps/desktop/src/terminal-runtime.js';
import { terminalDocumentURL } from '../apps/desktop/src/terminal-sender.js';

test('sibling terminal documents share a parent without sharing sender, focus or lifecycle authority', async () => {
  const parent = new EventEmitter();
  const observer = new EventEmitter();
  let parentFocused = true;
  Object.assign(parent, {
    webContents: observer,
    isDestroyed: () => false,
    isFocused: () => parentFocused,
  });
  let handler: (event: IpcMainInvokeEvent, raw: unknown) => Promise<unknown>;
  const router = createTerminalRuntimeRouter({
    handle(_channel: string, dispatch: typeof handler) {
      handler = dispatch;
    },
    removeHandler() {},
  } as unknown as IpcMain);
  const bind = () => {
    const contents = new EventEmitter();
    const session = {} as Session;
    const frame = { url: terminalDocumentURL, detached: false, isDestroyed: () => false };
    let focused = true,
      visible = true,
      revoked = 0,
      closed = 0,
      calls = 0;
    Object.assign(contents, {
      session,
      mainFrame: frame,
      getURL: () => frame.url,
      isDestroyed: () => false,
      isFocused: () => focused,
    });
    const id = randomUUID();
    router.bind(
      parent as unknown as BrowserWindow,
      session,
      (_document, current) => ({
        async dispatch(_document, raw) {
          calls++;
          assert.ok(current(false));
          return (raw as { instanceId: string }).instanceId === id
            ? { status: 'ok', instanceId: id }
            : { status: 'denied' };
        },
        revokeInput() {
          revoked++;
        },
        close() {
          closed++;
        },
      }),
      { contents: contents as unknown as WebContents, visible: () => visible },
    );
    contents.emit('did-finish-load');
    const event = { sender: contents, senderFrame: frame } as unknown as IpcMainInvokeEvent;
    return {
      contents,
      event,
      id,
      session,
      frame,
      calls: () => calls,
      revoked: () => revoked,
      closed: () => closed,
      focus(value: boolean) {
        focused = value;
      },
      visible(value: boolean) {
        visible = value;
      },
      send: (action = 'snapshot') =>
        handler(event, {
          version: 1,
          action,
          instanceId: id,
          ...(action === 'write' ? { sequence: 0, text: 'synthetic' } : {}),
        }),
    };
  };
  const a = bind(),
    b = bind();
  try {
    assert.deepEqual(await a.send(), { status: 'ok', instanceId: a.id });
    assert.deepEqual(await b.send(), { status: 'ok', instanceId: b.id });
    for (const event of [
      { ...a.event, sender: observer },
      { ...a.event, sender: b.contents },
      { ...a.event, senderFrame: b.frame },
      { ...a.event, senderFrame: { ...a.frame } },
    ])
      assert.deepEqual(
        await handler!(event as IpcMainInvokeEvent, {
          version: 1,
          action: 'snapshot',
          instanceId: a.id,
        }),
        { status: 'denied' },
      );
    assert.deepEqual(
      await handler!(a.event, { version: 1, action: 'snapshot', instanceId: b.id }),
      { status: 'denied' },
    );
    a.focus(false);
    assert.deepEqual(await a.send('write'), { status: 'focus_required' });
    a.focus(true);
    a.visible(false);
    assert.deepEqual(await a.send('write'), { status: 'focus_required' });
    a.visible(true);
    parentFocused = false;
    assert.deepEqual(await a.send('write'), { status: 'focus_required' });
    parentFocused = true;
    a.contents.emit('blur');
    assert.equal(a.revoked(), 1);
    assert.equal(b.revoked(), 0);
    parent.emit('hide');
    assert.equal(a.revoked(), 2);
    assert.equal(b.revoked(), 1);
    a.contents.emit('did-start-navigation', {}, terminalDocumentURL, false, true);
    assert.ok(a.closed() > 0);
    assert.equal(b.closed(), 0);
    a.contents.emit('did-finish-load');
    assert.deepEqual(await a.send(), { status: 'denied' });
    assert.deepEqual(await b.send(), { status: 'ok', instanceId: b.id });
    assert.equal(a.calls(), 2); // Own snapshot plus explicit cross-instance refusal only.
  } finally {
    router.close();
  }
});
