import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { TerminalAuthority, terminalDigest } from '../../packages/core/src/terminal/authority.js';
import {
  TerminalNativeBroker,
  type TerminalConfirmation,
  type TerminalNativeSupervisor,
} from '../../packages/core/src/terminal/native-broker.js';
import {
  TerminalSupervisor,
  type TerminalEvents,
  type TerminalProfile,
} from '../../packages/core/src/terminal/supervisor.js';
// Synthetic in-memory doubles. No CLI, IPC listener, Electron app, keys on disk or process.
export function terminalBrokerFixture(
  transport: (supervisor: TerminalSupervisor) => TerminalNativeSupervisor = (supervisor) =>
    supervisor,
) {
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
    transport(supervisor),
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
