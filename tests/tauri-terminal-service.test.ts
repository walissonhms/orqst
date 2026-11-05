// Synthetic supervisors only. No real provider, native window or observed session.
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { setImmediate } from 'node:timers/promises';
import test from 'node:test';
import {
  featureCanvasEvidenceSchema,
  terminalNativeReplySchema,
  type TerminalNativeRequest,
} from '@orqst/protocol';
import { TauriTerminalService } from '../apps/desktop/src/tauri-terminal-service.js';
import { TerminalAuthority, terminalDigest } from '../packages/core/src/terminal/authority.js';
import {
  TerminalSupervisor,
  type TerminalEvents,
} from '../packages/core/src/terminal/supervisor.js';

function setup(evidenced = false, sessionEvidence?: () => unknown) {
  const keys = generateKeyPairSync('ed25519');
  const messages: Array<Record<string, unknown>> = [];
  const starts = [0, 0];
  const writes: string[][] = [[], []];
  const signals: string[] = [];
  const capturedEvents: TerminalEvents[] = [];
  const supervisors = [0, 1].map(
    (slot) =>
      new TerminalSupervisor(
        new TerminalAuthority(new Map([['desktop-managed', keys.publicKey]]), Date.now),
        {
          validate: () => true,
          start: (_profile, events) => {
            starts[slot]!++;
            if (evidenced) events.started({ startedAt: Date.now() - 1000 });
            else events.started();
            capturedEvents[slot] = events;
            return {
              ...(sessionEvidence ? { sessionEvidence } : {}),
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
  return { service, supervisors, messages, starts, writes, signals, request, capturedEvents };
}

test('canvas session evidence stays bound to the broker slot and Claude provider', async () => {
  const evidence = {
    session: {
      provider: 'claude',
      sessionId: randomUUID(),
      bindingEvidence: 'claude-argv-receipt-transcript',
    },
    activities: [{ at: Date.now() - 100, kind: 'tool', label: 'Read' }],
  };
  const s = setup(true, () => evidence);
  try {
    const started = await s.request(0, { version: 1, action: 'start', profileId: 'synthetic' });
    if (started.status !== 'ok' || !started.snapshot) throw new Error('Missing synthetic start');
    const identity = { slot: 0, terminalId: randomUUID(), provider: 'claude' };
    const found = featureCanvasEvidenceSchema.parse(
      await s.service.canvasEvidence([identity], started.snapshot.epoch),
    );
    assert.deepEqual(found.entries[0]?.session, evidence.session);
    assert.deepEqual(found.entries[0]?.activities, evidence.activities);
    const wrongProvider = featureCanvasEvidenceSchema.parse(
      await s.service.canvasEvidence([{ ...identity, provider: 'codex' }], started.snapshot.epoch),
    );
    assert.equal(wrongProvider.entries[0]?.session, undefined);
  } finally {
    s.service.close();
  }
});

test('canvas projection requires this broker instance, current epoch and lifecycle evidence', async () => {
  const s = setup(true);
  try {
    const terminalId = randomUUID();
    const ids = [{ slot: 0, terminalId }];
    const start = await s.request(0, { version: 1, action: 'start', profileId: 'synthetic' });
    if (start.status !== 'ok' || !start.snapshot) throw new Error('Missing synthetic start');
    const epoch = start.snapshot.epoch;
    const running = await s.service.canvasEvidence(ids, epoch);
    assert.equal(running.entries[0]?.state, 'running');
    assert.equal(running.entries[0]?.terminalId, terminalId);
    assert.equal((await s.service.canvasEvidence(ids, randomUUID())).entries[0]?.state, 'unknown');
    s.capturedEvents[0]!.exit(0);
    assert.equal((await s.service.canvasEvidence(ids, epoch)).entries[0]?.state, 'unknown');
    assert.deepEqual(s.signals, []);
  } finally {
    s.service.close();
  }
  const exited = setup(true);
  try {
    const start = await exited.request(0, { version: 1, action: 'start', profileId: 'synthetic' });
    if (start.status !== 'ok' || !start.snapshot?.lifecycle)
      throw new Error('Missing synthetic start');
    const ids = [{ slot: 0, terminalId: randomUUID() }];
    exited.capturedEvents[0]!.exit(0, undefined, {
      startedAt: start.snapshot.lifecycle.startedAt,
      exitedAt: Date.now(),
    });
    assert.equal(
      (await exited.service.canvasEvidence(ids, start.snapshot.epoch)).entries[0]?.state,
      'exited',
    );
    await exited.service.receive({ kind: 'close', slot: 0 });
    assert.equal(
      (await exited.service.canvasEvidence(ids, start.snapshot.epoch)).entries[0]?.state,
      'unknown',
    );
  } finally {
    exited.service.close();
  }
});

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

test('selected operational Open uses one native confirmation and distinct broker grants; legacy Start stays separate', async () => {
  const s = setup();
  try {
    const opened = await s.request(0, { version: 1, action: 'open', profileId: 'synthetic' });
    assert.equal(opened.status, 'ok');
    if (opened.status !== 'ok') throw new Error('Missing synthetic open');
    assert.equal(opened.opening, 'ready');
    assert.equal(s.starts[0], 1);
    assert.equal(s.messages.filter((m) => m.kind === 'confirm').length, 1);
    const review = s.messages.find((m) => m.kind === 'confirm')!;
    assert.equal(review.message, 'terminalNative.open');
    assert.equal(review.approve, 'studio.tauri.open');
    assert.equal(JSON.parse(String(review.detail)).operation, 'open');
    assert.equal(
      (
        await s.request(0, {
          version: 1,
          action: 'write',
          instanceId: opened.instanceId,
          sequence: 0,
          text: 'SYNTHETIC',
        })
      ).status,
      'ok',
    );
    const started = await s.request(1, { version: 1, action: 'start', profileId: 'synthetic' });
    if (started.status !== 'ok') throw new Error('Missing legacy synthetic start');
    assert.equal(started.opening, undefined);
    assert.equal(
      (
        await s.request(1, {
          version: 1,
          action: 'write',
          instanceId: started.instanceId,
          sequence: 0,
          text: 'must remain denied',
        })
      ).status,
      'denied',
    );
    assert.deepEqual(s.writes, [['SYNTHETIC'], []]);
  } finally {
    s.service.close();
  }
});

test('confirmed append retains old signed grants and process identities; new pane has no authority', async () => {
  const s = setup();
  try {
    const started = await s.request(0, { version: 1, action: 'start', profileId: 'synthetic' });
    assert.equal(started.status, 'ok');
    if (started.status !== 'ok' || !started.instanceId)
      throw new Error('Missing original instance');
    const instanceId = started.instanceId;
    for (const action of ['attach', 'input'] as const)
      assert.equal((await s.request(0, { version: 1, action, instanceId })).status, 'ok');
    assert.throws(() => s.service.append(2, s.supervisors[1]!), /Invalid/);
    assert.equal(s.service.beginMetadata(), true);
    const confirmations = s.messages.filter((m) => m.kind === 'confirm').length;
    s.service.append(2, s.supervisors[1]!);
    assert.throws(() => s.service.append(2, s.supervisors[1]!), /Invalid/);
    s.service.endMetadata();
    assert.equal(s.messages.filter((m) => m.kind === 'confirm').length, confirmations);
    assert.deepEqual(s.starts, [1, 0]);
    assert.equal(
      (
        await s.request(0, {
          version: 1,
          action: 'write',
          instanceId,
          sequence: 0,
          text: 'preserved lease',
        })
      ).status,
      'ok',
    );
    assert.deepEqual(s.writes[0], ['preserved lease']);
    assert.equal(
      (
        await s.request(2, {
          version: 1,
          action: 'write',
          instanceId,
          sequence: 1,
          text: 'cross-slot',
        })
      ).status,
      'denied',
    );
    assert.deepEqual(s.signals, []);
    await s.service.receive({ kind: 'close', slot: 2 });
    assert.equal(
      (
        await s.request(0, {
          version: 1,
          action: 'write',
          instanceId,
          sequence: 1,
          text: 'old pane survives',
        })
      ).status,
      'ok',
    );
    assert.deepEqual(s.starts, [1, 0]);
  } finally {
    s.service.close();
  }
  assert.throws(() => s.service.append(3, s.supervisors[1]!), /Invalid/);
});
