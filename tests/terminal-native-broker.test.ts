import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import test from 'node:test';
import type { BrowserWindow, IpcMainInvokeEvent, Session, WebFrameMain } from 'electron';
import { terminalNativeRequestSchema } from '@orqst/protocol';
import { TerminalAuthority, terminalDigest } from '../packages/core/src/terminal/authority.js';
import {
  TerminalNativeBroker,
  type TerminalConfirmation,
} from '../packages/core/src/terminal/native-broker.js';
import {
  TerminalSupervisor,
  type TerminalEvents,
  type TerminalProfile,
} from '../packages/core/src/terminal/supervisor.js';
import {
  authorizedTerminalSender,
  terminalDocumentURL,
} from '../apps/desktop/src/terminal-sender.js';

// Synthetic in-memory doubles. No CLI, IPC listener, Electron app, keys on disk or process.
function setup() {
  const keys = generateKeyPairSync('ed25519');
  let now = 1000;
  const authority = new TerminalAuthority(new Map([['native', keys.publicKey]]), () => now);
  const document = {};
  let current = true;
  let focused = true;
  let starts = 0;
  let disposed = 0;
  const writes: string[] = [];
  const signals: string[] = [];
  const confirmations: TerminalConfirmation[] = [];
  let events: TerminalEvents | undefined;
  let answer: (details: TerminalConfirmation) => Promise<boolean> = async () => true;
  const profile: TerminalProfile = {
    id: 'synthetic',
    projectId: 'disposable',
    executable: '/synthetic/node',
    executableSha256: terminalDigest('synthetic'),
    executableVersion: 'synthetic',
    argv: ['/synthetic/fixture'],
    cwd: '/synthetic/private',
    environmentProfile: 'no-credentials',
    permissions: 'cooperative fixture only',
  };
  const supervisor = new TerminalSupervisor(
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
          dispose: () => {
            disposed++;
          },
        };
      },
    },
    [profile],
  );
  const broker = new TerminalNativeBroker(
    authority,
    supervisor,
    'native',
    keys.privateKey,
    document,
    {
      current: (_document, focus) => current && (!focus || focused),
      confirm: async (_document, details) => {
        confirmations.push(details);
        return answer(details);
      },
    },
  );
  const send = (action: string, fields = {}) =>
    broker.dispatch(document, { version: 1, action, ...fields });
  const start = async () => {
    const result = await send('start', { profileId: profile.id });
    assert.equal(result.status, 'ok');
    if (result.status !== 'ok') throw new Error('Expected synthetic start');
    return result.instanceId;
  };
  const input = async (instanceId: string) => {
    assert.equal((await send('attach', { instanceId })).status, 'ok');
    assert.equal((await send('input', { instanceId })).status, 'ok');
  };
  return {
    broker,
    supervisor,
    authority,
    document,
    send,
    start,
    input,
    writes,
    signals,
    confirmations,
    starts: () => starts,
    disposed: () => disposed,
    events: () => {
      assert.ok(events);
      return events;
    },
    answer: (value: typeof answer) => {
      answer = value;
    },
    focus: (value: boolean) => {
      focused = value;
    },
    current: (value: boolean) => {
      current = value;
    },
    advance: () => {
      now += 30_001;
    },
  };
}

test('native broker refuses untrusted documents, extra command fields and unfocused start', async () => {
  const s = setup();
  assert.equal(
    (await s.broker.dispatch({}, { version: 1, action: 'start', profileId: 'synthetic' })).status,
    'denied',
  );
  assert.equal(
    (await s.send('start', { profileId: 'synthetic', command: 'arbitrary' })).status,
    'denied',
  );
  s.focus(false);
  assert.equal((await s.send('start', { profileId: 'synthetic' })).status, 'denied');
  assert.equal(s.starts(), 0);
  assert.equal(s.confirmations.length, 0);
});

test('native cancellation has no process effect and confirmation binds the immutable profile', async () => {
  const s = setup();
  s.answer(async (details) => {
    assert.equal(Object.isFrozen(details), true);
    assert.equal(Object.isFrozen(details.profile), true);
    assert.deepEqual(details.profile.argv, ['/synthetic/fixture']);
    assert.equal(details.operation, 'start');
    return false;
  });
  assert.equal((await s.send('start', { profileId: 'synthetic' })).status, 'cancelled');
  assert.equal(s.starts(), 0);
});

test('native dialog has one operation in flight, with no queued or replayed start', async () => {
  const s = setup();
  let resolve: ((answer: boolean) => void) | undefined;
  s.answer(
    () =>
      new Promise<boolean>((accept) => {
        resolve = accept;
      }),
  );
  const pending = s.send('start', { profileId: 'synthetic' });
  assert.equal((await s.send('start', { profileId: 'synthetic' })).status, 'busy');
  assert.equal(s.starts(), 0);
  assert.ok(resolve);
  resolve(true);
  const result = await pending;
  assert.equal(result.status, 'ok');
  assert.equal(s.starts(), 1);
  assert.equal(s.confirmations.length, 1);
});

for (const invalidation of ['blur', 'navigation', 'expiry', 'close', 'revocation'] as const) {
  test(`native ${invalidation} while confirming denies launch`, async () => {
    const s = setup();
    s.answer(async () => {
      if (invalidation === 'blur') s.broker.revokeInput();
      if (invalidation === 'navigation') s.current(false);
      if (invalidation === 'expiry') s.advance();
      if (invalidation === 'close') s.broker.close();
      if (invalidation === 'revocation') s.authority.revoke('native');
      return true;
    });
    assert.equal((await s.send('start', { profileId: 'synthetic' })).status, 'denied');
    assert.equal(s.starts(), 0);
  });
}

test('native input is leased and sequenced; exact paste and stop have separate confirmations', async () => {
  const s = setup();
  const instanceId = await s.start();
  assert.equal((await s.send('write', { instanceId, sequence: 0, text: 'a' })).status, 'denied');
  await s.input(instanceId);
  assert.equal((await s.send('write', { instanceId, sequence: 0, text: 'a' })).status, 'ok');
  assert.equal((await s.send('write', { instanceId, sequence: 0, text: 'a' })).status, 'denied');
  s.answer(async (details) => {
    assert.equal(details.paste, 'ping\n');
    return false;
  });
  assert.equal(
    (await s.send('paste', { instanceId, sequence: 1, text: 'ping\n' })).status,
    'cancelled',
  );
  assert.deepEqual(s.writes, ['a']);
  s.answer(async () => true);
  assert.equal((await s.send('paste', { instanceId, sequence: 1, text: 'ping\n' })).status, 'ok');
  assert.deepEqual(s.writes, ['a', 'ping\n']);
  assert.equal((await s.send('stop', { instanceId, signal: 'SIGTERM' })).status, 'ok');
  assert.deepEqual(s.signals, ['SIGTERM']);
  assert.equal(s.confirmations.at(-1)?.signal, 'SIGTERM');
  assert.equal(s.supervisor.snapshot(instanceId).state, 'running');
  s.events().exit(0);
  assert.equal(s.supervisor.snapshot(instanceId).state, 'exited');
});

test('native blur and detach revoke input without stopping; replies contain no authority', async () => {
  const s = setup();
  const instanceId = await s.start();
  await s.input(instanceId);
  s.broker.revokeInput();
  assert.equal((await s.send('write', { instanceId, sequence: 0, text: 'a' })).status, 'denied');
  assert.equal((await s.send('input', { instanceId })).status, 'ok');
  assert.equal((await s.send('detach', { instanceId })).status, 'ok');
  assert.equal((await s.send('read', { instanceId, cursor: 0 })).status, 'denied');
  await s.input(instanceId);
  s.events().data('synthetic output');
  const reply = await s.send('read', { instanceId, cursor: 0 });
  assert.equal(reply.status, 'ok');
  assert.equal(
    /signature|challenge|lease|attachment|privateKey/.test(JSON.stringify(reply)),
    false,
  );
  assert.equal(s.supervisor.snapshot(instanceId).state, 'running');
  assert.deepEqual(s.signals, []);
  s.broker.close();
  assert.equal((await s.send('snapshot', { instanceId })).status, 'denied');
  assert.equal(s.supervisor.snapshot(instanceId).state, 'running');
  assert.deepEqual(s.signals, []);
});

test('native broker cannot adopt an arbitrary instance and suppresses sensitive host failures', async () => {
  const s = setup();
  assert.equal(
    (await s.send('attach', { instanceId: '751e6692-d50d-49d6-89aa-b285b62d1965' })).status,
    'denied',
  );
  s.answer(async () => {
    throw new Error('private native diagnostic');
  });
  assert.deepEqual(await s.send('start', { profileId: 'synthetic' }), { status: 'denied' });
  assert.equal(s.starts(), 0);
});

test('explicit supervisor shutdown denies prepared launches and preserves uncertain ownership', async () => {
  const s = setup();
  const instanceId = await s.start();
  await s.input(instanceId);
  const prepared = s.supervisor.prepare('native', 'synthetic');
  s.supervisor.shutdown();
  s.supervisor.shutdown();
  assert.equal(s.supervisor.snapshot(instanceId).state, 'ownership_lost');
  assert.equal(s.supervisor.snapshot(prepared.attemptId).state, 'start_failed');
  assert.throws(() => s.supervisor.prepare('native', 'synthetic'), /closed/);
  assert.throws(() => s.supervisor.launch(prepared.attemptId, {}), /closed/);
  assert.equal((await s.send('write', { instanceId, sequence: 0, text: 'a' })).status, 'denied');
  assert.deepEqual(s.signals, []);
  assert.equal(s.disposed(), 1);
  s.events().exit(0);
  assert.equal(s.supervisor.snapshot(instanceId).state, 'ownership_lost');
});

test('native request schema has no command, environment, grant, provider approval or resume channel', () => {
  for (const action of ['exec', 'resume', 'approval', 'enroll', 'sign', 'adopt'])
    assert.equal(terminalNativeRequestSchema.safeParse({ version: 1, action }).success, false);
  assert.equal(
    terminalNativeRequestSchema.safeParse({ version: 1, action: 'start', profileId: 'x', env: {} })
      .success,
    false,
  );
});

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
