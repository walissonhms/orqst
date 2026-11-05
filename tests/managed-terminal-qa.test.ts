// QA-only synthetic guards for the integrated multi-window Terminal slice.
// No Electron process, no provider, no credentials and no real session data.
// These invariants must survive the planned refactor: one IPC router routed by
// senderFrame, per-document busy/generation/broker, shared sticky pair admission,
// duplicate-manifest rejection before any core/PTY is created.
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { EventEmitter } from 'node:events';

import test from 'node:test';
import type { BrowserWindow, IpcMain, IpcMainInvokeEvent, Session } from 'electron';
import { terminalNativeReplySchema } from '@orqst/protocol';
import { bindTerminalRuntime } from '../apps/desktop/src/terminal-runtime.js';
import { terminalDocumentURL } from '../apps/desktop/src/terminal-sender.js';
import { TerminalAuthority, terminalDigest } from '../packages/core/src/terminal/authority.js';
import { TerminalNativeBroker } from '../packages/core/src/terminal/native-broker.js';
import { TerminalSupervisor } from '../packages/core/src/terminal/supervisor.js';

const secret = 'SYNTHETIC-SECRET-NEVER-READ';

function harness(options: { hangConfirm?: boolean } = {}) {
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
  let confirmRelease: (() => void) | undefined;
  const dispose = bindTerminalRuntime(
    ipc,
    window as unknown as BrowserWindow,
    session,
    (document, current) => {
      const keys = generateKeyPairSync('ed25519');
      const authority = new TerminalAuthority(new Map([['runtime', keys.publicKey]]));
      const supervisor = new TerminalSupervisor(
        authority,
        {
          validate: () => true,
          start: (_profile, handlers) => {
            starts++;
            handlers.started();
            return {
              write: () => {},
              resize: () => {},
              signal: () => {},
              dispose: () => {},
            };
          },
        },
        [
          {
            id: 'synthetic',
            projectId: 'disposable',
            executable: '/synthetic/node',
            executableSha256: terminalDigest(secret),
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
          if (!options.hangConfirm) return true;
          return new Promise<boolean>((done) => {
            confirmRelease = () => done(true);
          });
        },
      });
    },
  );
  return {
    window,
    contents,
    frame,
    event,
    loaded: () => contents.emit('did-finish-load'),
    starts: () => starts,
    closed: () => 0,
    confirmRelease: () => confirmRelease,
    bindEnded: dispose,
    send: async (request: unknown, sender = event) =>
      terminalNativeReplySchema.parse(await handler!(sender, request)),
  };
}

test('terminal IPC from a foreign frame or sender is denied without starting anything', async () => {
  const f = harness();
  f.loaded();
  const foreignFrame = { detached: false, isDestroyed: () => false, url: terminalDocumentURL };
  const foreign = {
    sender: foreignFrame,
    senderFrame: foreignFrame,
  } as unknown as IpcMainInvokeEvent;
  const status = (await f.send({ version: 1, action: 'start', profileId: 'synthetic' }, foreign))
    .status;
  assert.equal(status, 'denied');
  assert.equal(f.starts(), 0);
});

test('navigation revokes the document binding and every later request', async () => {
  const f = harness();
  f.loaded();
  f.contents.emit('did-start-navigation', {}, '', false, true);
  const status = (await f.send({ version: 1, action: 'start', profileId: 'synthetic' })).status;
  assert.equal(status, 'denied');
  assert.equal(f.starts(), 0);
});

test('a mutating request in flight serializes later requests as busy', async () => {
  const f = harness({ hangConfirm: true });
  f.loaded();
  const first = f.send({ version: 1, action: 'start', profileId: 'synthetic' });
  await new Promise((done) => setImmediate(done));
  const second = await f.send({ version: 1, action: 'start', profileId: 'synthetic' });
  assert.equal(second.status, 'busy');
  assert.equal(f.starts(), 0);
  const release = f.confirmRelease();
  assert.ok(release);
  release();
  const result = await first;
  assert.equal(result.status, 'ok');
  assert.equal(f.starts(), 1);
  f.bindEnded();
});
