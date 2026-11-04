// Synthetic supervisors only. No real provider, native window or observed session.
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { setImmediate } from 'node:timers/promises';
import test from 'node:test';
import { terminalNativeReplySchema, type TerminalNativeRequest } from '@orqst/protocol';
import { TauriTerminalService } from '../apps/desktop/src/tauri-terminal-service.js';
import { TerminalAuthority, terminalDigest } from '../packages/core/src/terminal/authority.js';
import { TerminalSupervisor } from '../packages/core/src/terminal/supervisor.js';

function setup() {
  const keys = generateKeyPairSync('ed25519');
  const messages: Array<Record<string, unknown>> = [];
  const starts = [0, 0];
  const writes: string[][] = [[], []];
  const signals: string[] = [];
  const supervisors = [0, 1].map(
    (slot) =>
      new TerminalSupervisor(
        new TerminalAuthority(new Map([['desktop-managed', keys.publicKey]]), Date.now),
        {
          validate: () => true,
          start: (_profile, events) => {
            starts[slot]!++;
            events.started();
            return {
              write: (text) => {
                writes[slot]!.push(text);
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
            argv: ['/synthetic/fixture'],
            cwd: '/synthetic/private',
            environmentProfile: 'no-credentials',
            permissions: 'synthetic fixture only',
          },
        ],
      ),
  );
  const service = new TauriTerminalService(
    supervisors,
    keys,
    (message) => messages.push(message as Record<string, unknown>),
    (key) => key,
  );
  async function request(slot: number, request: TerminalNativeRequest, approve = true) {
    const id = randomUUID();
    const pending = service.receive({ kind: 'request', id, slot, request, focused: true });
    await setImmediate();
    const confirmation = messages.findLast((m) => m.kind === 'confirm');
    if (confirmation)
      await service.receive({ kind: 'confirm', id: confirmation.id, accepted: approve });
    await pending;
    return terminalNativeReplySchema.parse(messages.findLast((m) => m.id === id)?.value);
  }
  return { service, messages, starts, writes, signals, request };
}

test('Tauri pipe reuses signed native start/attach/input and exposes only public replies', async () => {
  const s = setup();
  try {
    const start = await s.request(0, { version: 1, action: 'start', profileId: 'synthetic' });
    assert.equal(start.status, 'ok');
    if (start.status !== 'ok') throw new Error('Missing instance');
    assert.equal(s.starts[0], 1);
    const instanceId = start.instanceId;
    for (const action of ['attach', 'input'] as const)
      assert.equal((await s.request(0, { version: 1, action, instanceId })).status, 'ok');
    assert.equal(
      (
        await s.request(0, {
          version: 1,
          action: 'write',
          instanceId,
          sequence: 0,
          text: 'synthetic',
        })
      ).status,
      'ok',
    );
    assert.deepEqual(s.writes[0], ['synthetic']);
    const wire = JSON.stringify(s.messages.filter((m) => m.kind === 'reply'));
    for (const secret of ['signature', 'privateKey', 'attachment', 'lease'])
      assert.equal(wire.includes(secret), false);
    await s.service.receive({ kind: 'revoke', slot: 0 });
    assert.equal(
      (
        await s.request(0, {
          version: 1,
          action: 'write',
          instanceId,
          sequence: 1,
          text: 'revoked',
        })
      ).status,
      'denied',
    );
    assert.deepEqual(s.writes[0], ['synthetic']);
    assert.deepEqual(s.signals, []);
  } finally {
    s.service.close();
  }
});

test('Tauri cancellation and blur during a native confirmation cannot launch a process', async () => {
  const s = setup();
  try {
    assert.equal(
      (await s.request(0, { version: 1, action: 'start', profileId: 'synthetic' }, false)).status,
      'cancelled',
    );
    const id = randomUUID();
    const pending = s.service.receive({
      kind: 'request',
      id,
      slot: 0,
      focused: true,
      request: { version: 1, action: 'start', profileId: 'synthetic' },
    });
    await setImmediate();
    const confirmation = s.messages.findLast((m) => m.kind === 'confirm')!;
    await s.service.receive({ kind: 'revoke', slot: 0 });
    await s.service.receive({ kind: 'confirm', id: confirmation.id, accepted: true });
    await pending;
    assert.equal(s.starts[0], 0);
    assert.equal(
      terminalNativeReplySchema.parse(s.messages.findLast((m) => m.id === id)?.value).status,
      'cancelled',
    );
  } finally {
    s.service.close();
  }
});

test('Tauri terminal documents reject cross-slot instances and close without affecting another slot', async () => {
  const s = setup();
  try {
    const start = await s.request(0, { version: 1, action: 'start', profileId: 'synthetic' });
    if (start.status !== 'ok') throw new Error('Missing instance');
    assert.equal(
      (await s.request(1, { version: 1, action: 'attach', instanceId: start.instanceId })).status,
      'denied',
    );
    await s.service.receive({ kind: 'close', slot: 0 });
    assert.equal(
      (await s.request(0, { version: 1, action: 'start', profileId: 'synthetic' })).status,
      'denied',
    );
    assert.equal(
      (await s.request(1, { version: 1, action: 'start', profileId: 'synthetic' })).status,
      'ok',
    );
    assert.deepEqual(s.starts, [1, 1]);
    assert.deepEqual(s.signals, []);
  } finally {
    s.service.close();
  }
});

test('Tauri pipe denies unfocused and malformed requests before producing native confirmation', async () => {
  const s = setup();
  try {
    await s.service.receive({
      kind: 'request',
      id: randomUUID(),
      slot: 0,
      focused: false,
      request: { version: 1, action: 'start', profileId: 'synthetic' },
    });
    assert.equal(
      s.messages.some((m) => m.kind === 'confirm'),
      false,
    );
    assert.equal(s.starts[0], 0);
    await s.service.receive({
      kind: 'request',
      id: randomUUID(),
      slot: 0,
      focused: true,
      request: { version: 1, action: 'start', profileId: 'synthetic', command: 'arbitrary' },
    });
    assert.equal(s.messages.at(-1)?.kind, 'reply');
    assert.deepEqual(s.messages.at(-1)?.value, { status: 'denied' });
    assert.equal(
      (await s.request(1, { version: 1, action: 'start', profileId: 'synthetic' })).status,
      'ok',
    );
    await assert.rejects(s.service.receive({ kind: 'revoke', slot: 8 }));
    await assert.rejects(s.service.receive({ kind: 'revoke', slot: 2 }));
  } finally {
    s.service.close();
  }
});

test('metadata mutations and native execution reviews exclude each other in both directions', async () => {
  const s = setup();
  try {
    assert.equal(s.service.beginMetadata(), true);
    assert.equal(s.service.beginMetadata(), false);
    const id = randomUUID();
    await s.service.receive({
      kind: 'request',
      id,
      slot: 0,
      focused: true,
      request: { version: 1, action: 'start', profileId: 'synthetic' },
    });
    assert.equal(
      s.messages.findLast((message) => message.id === id)?.value &&
        Reflect.get(s.messages.findLast((message) => message.id === id)!.value as object, 'status'),
      'busy',
    );
    assert.equal(s.starts[0], 0);
    s.service.endMetadata();
    const pending = s.service.receive({
      kind: 'request',
      id: randomUUID(),
      slot: 0,
      focused: true,
      request: { version: 1, action: 'start', profileId: 'synthetic' },
    });
    await setImmediate();
    assert.equal(s.service.beginMetadata(), false);
    await s.service.receive({ kind: 'revoke', slot: 0 });
    await pending;
    assert.equal(s.starts[0], 0);
    assert.equal(s.service.beginMetadata(), true);
    s.service.endMetadata();
  } finally {
    s.service.close();
  }
});

test('metadata edits keep passive state reads available while new input reviews stay blocked', async () => {
  const s = setup();
  try {
    const start = await s.request(0, { version: 1, action: 'start', profileId: 'synthetic' });
    assert.equal(start.status, 'ok');
    if (start.status !== 'ok') throw new Error('Missing synthetic instance');
    assert.equal(s.service.beginMetadata(), true);
    assert.equal(
      (await s.request(0, { version: 1, action: 'snapshot', instanceId: start.instanceId })).status,
      'ok',
    );
    assert.equal(
      (await s.request(0, { version: 1, action: 'input', instanceId: start.instanceId })).status,
      'busy',
    );
    assert.deepEqual(s.starts, [1, 0]);
    assert.deepEqual(s.signals, []);
    s.service.endMetadata();
  } finally {
    s.service.close();
  }
});

test('an owned sheet preserves its exact signed review while suspending keyboard leases', async () => {
  const s = setup();
  try {
    const id = randomUUID();
    const pending = s.service.receive({
      kind: 'request',
      id,
      slot: 0,
      focused: true,
      request: { version: 1, action: 'start', profileId: 'synthetic' },
    });
    await setImmediate();
    const confirmation = s.messages.findLast((m) => m.kind === 'confirm')!;
    await s.service.receive({ kind: 'suspend-input', slot: 0 });
    assert.equal(s.starts[0], 0);
    await s.service.receive({ kind: 'confirm', id: confirmation.id, accepted: true });
    await pending;
    const start = terminalNativeReplySchema.parse(s.messages.findLast((m) => m.id === id)?.value);
    assert.equal(start.status, 'ok');
    if (start.status !== 'ok') throw new Error('Missing synthetic instance');
    const instanceId = start.instanceId;
    for (const action of ['attach', 'input'] as const)
      assert.equal((await s.request(0, { version: 1, action, instanceId })).status, 'ok');
    await s.service.receive({ kind: 'suspend-input', slot: 0 });
    assert.equal((await s.request(0, { version: 1, action: 'snapshot', instanceId })).status, 'ok');
    assert.equal(
      (
        await s.request(0, {
          version: 1,
          action: 'write',
          instanceId,
          sequence: 0,
          text: 'suspended',
        })
      ).status,
      'denied',
    );
    assert.deepEqual(s.writes[0], []);
    assert.equal((await s.request(0, { version: 1, action: 'input', instanceId })).status, 'ok');
    assert.equal(
      (
        await s.request(0, {
          version: 1,
          action: 'write',
          instanceId,
          sequence: 0,
          text: 'explicit renewal',
        })
      ).status,
      'ok',
    );
    assert.deepEqual(s.writes[0], ['explicit renewal']);
  } finally {
    s.service.close();
  }
});

test('cancel and real blur remain final after returning to an owned sheet', async () => {
  for (const blur of [false, true]) {
    const s = setup();
    try {
      const id = randomUUID();
      const pending = s.service.receive({
        kind: 'request',
        id,
        slot: 0,
        focused: true,
        request: { version: 1, action: 'start', profileId: 'synthetic' },
      });
      await setImmediate();
      const confirmation = s.messages.findLast((m) => m.kind === 'confirm')!;
      await s.service.receive({ kind: 'suspend-input', slot: 0 });
      if (blur) await s.service.receive({ kind: 'revoke', slot: 0 });
      await s.service.receive({ kind: 'confirm', id: confirmation.id, accepted: blur });
      await pending;
      // A late affirmative result after cancellation/revocation cannot resurrect this nonce.
      await s.service.receive({ kind: 'confirm', id: confirmation.id, accepted: true });
      assert.equal(s.starts[0], 0);
      assert.equal(
        terminalNativeReplySchema.parse(s.messages.findLast((m) => m.id === id)?.value).status,
        'cancelled',
      );
    } finally {
      s.service.close();
    }
  }
});

test('a suspended sheet never renews an expired signed approval', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 10_000 });
  const s = setup();
  try {
    const id = randomUUID();
    const pending = s.service.receive({
      kind: 'request',
      id,
      slot: 0,
      focused: true,
      request: { version: 1, action: 'start', profileId: 'synthetic' },
    });
    await setImmediate();
    const confirmation = s.messages.findLast((m) => m.kind === 'confirm')!;
    await s.service.receive({ kind: 'suspend-input', slot: 0 });
    t.mock.timers.tick(30_001);
    await s.service.receive({ kind: 'confirm', id: confirmation.id, accepted: true });
    await pending;
    assert.equal(s.starts[0], 0);
    assert.equal(
      terminalNativeReplySchema.parse(s.messages.findLast((m) => m.id === id)?.value).status,
      'denied',
    );
  } finally {
    s.service.close();
  }
});
