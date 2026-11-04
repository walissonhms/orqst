// Synthetic owned handles, disposable SQLite journals and Unix sockets. No installed CLI/login.
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import test from 'node:test';
import { Store } from '@orqst/database';
import { terminalNativeRequestSchema } from '@orqst/protocol';
import {
  TauriTerminalService,
  tauriTerminalMessageSchema,
  type TauriTerminalMcp,
} from '../apps/desktop/src/tauri-terminal-service.js';
import { desktopAgentsAdmission } from '../packages/core/src/managed-codex/desktop-admission.js';
import { TerminalAuthority, terminalDigest } from '../packages/core/src/terminal/authority.js';
import { InteractiveMcpSession } from '../packages/core/src/terminal/interactive-mcp.js';
import { ManagedTerminalPair } from '../packages/core/src/terminal/managed-pair.js';
import { connectMcpInstance } from '../packages/core/src/terminal/mcp-socket.js';
import { terminalRPCSchema } from '../packages/core/src/terminal/rpc.js';
import type { TerminalNativeSupervisor } from '../packages/core/src/terminal/native-broker.js';
import type { TerminalEvents } from '../packages/core/src/terminal/supervisor.js';

async function fixture(optedIn = true) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'orqst-tauri-mcp-')));
  const keys = generateKeyPairSync('ed25519');
  const authority = new TerminalAuthority(new Map([['desktop-managed', keys.publicKey]]), Date.now);
  const admissionDirectory = join(root, 'admission');
  const admission = desktopAgentsAdmission(admissionDirectory);
  const stores: Store[] = [];
  const events: TerminalEvents[] = [];
  const writes: string[] = [];
  const signals: string[] = [];
  const messages: Array<Record<string, unknown>> = [];
  const session = new InteractiveMcpSession(authority, 'synthetic-workspace', (slot, id) => {
    try {
      admission.assertOwner();
      return (
        (
          pair.dispatch(slot, {
            id: randomUUID(),
            operation: 'snapshot',
            args: [id],
          }) as { state: string }
        ).state === 'running'
      );
    } catch {
      return false;
    }
  });
  const endpoints = await session.open();
  const pair: ManagedTerminalPair = new ManagedTerminalPair(
    authority,
    [0, 1].map((slot) => {
      const directory = join(root, String(slot));
      mkdirSync(directory, { mode: 0o700 });
      const store = new Store(join(directory, 'terminal.sqlite'));
      stores.push(store);
      return {
        profiles: [
          {
            id: 'codex-terminal-v1',
            projectId: 'synthetic-workspace',
            executable: '/synthetic/never-run',
            executableSha256: terminalDigest('synthetic'),
            executableVersion: 'synthetic',
            argv: [],
            cwd: root,
            environmentProfile: 'synthetic',
            permissions: 'Synthetic only',
          },
        ],
        journal: store.terminalJournal(authority.epoch, { recover: false }),
        backend: session.wrap(slot, {
          validate: () => true,
          start: (_profile, handlers) => {
            events[slot] = handlers;
            handlers.started();
            return {
              write(text) {
                writes.push(text);
              },
              resize() {},
              signal(signal) {
                signals.push(signal);
              },
              dispose() {},
            };
          },
        }),
      };
    }),
    admission,
  );
  const supervisors = [0, 1].map(
    (slot) =>
      Object.fromEntries(
        terminalRPCSchema.options.map((schema) => {
          const operation = schema.shape.operation.value;
          return [
            operation,
            (...args: unknown[]) =>
              pair.dispatch(slot, {
                id: randomUUID(),
                operation,
                args,
              }),
          ];
        }),
      ) as TerminalNativeSupervisor,
  );
  const port: TauriTerminalMcp = {
    prepareMcp: async () => session.prepare(),
    authorizeMcp: async (proof) => session.authorize(proof),
    closeSlot: async (slot) => {
      session.invalidate();
      pair.closeSlot(slot);
    },
  };
  const service = new TauriTerminalService(
    supervisors,
    keys,
    (message) => messages.push(message as Record<string, unknown>),
    (key) => key,
    optedIn ? port : undefined,
  );
  const clients = await Promise.all(
    endpoints.map((endpoint) => connectMcpInstance(endpoint.socketPath, endpoint.capabilityFile)),
  );
  async function start(slot: number) {
    const id = randomUUID();
    const pending = service.receive({
      kind: 'request',
      id,
      slot,
      focused: true,
      request: { version: 1, action: 'start', profileId: 'codex-terminal-v1' },
    });
    await setImmediate();
    const confirmation = messages.findLast((m) => m.kind === 'confirm')!;
    await service.receive({ kind: 'confirm', id: confirmation.id, accepted: true });
    await pending;
    const reply = messages.findLast((m) => m.id === id)?.value as {
      status: string;
      instanceId: string;
    };
    assert.equal(reply.status, 'ok');
    return reply.instanceId;
  }
  function authorize(slot = 0, focused = true) {
    const id = randomUUID();
    const pending = service.receive({ kind: 'authorizeMcp', id, slot, focused });
    return { id, pending };
  }
  function status(id: string) {
    return (messages.findLast((m) => m.id === id)?.value as { status: string }).status;
  }
  async function confirm(accepted = true) {
    await setImmediate();
    const message = messages.findLast((m) => m.kind === 'confirm')!;
    await service.receive({ kind: 'confirm', id: message.id, accepted });
    return message;
  }
  return {
    service,
    session,
    messages,
    events,
    clients,
    writes,
    signals,
    port,
    start,
    authorize,
    status,
    confirm,
    marker: () => readFileSync(join(admissionDirectory, 'active-pair.json')),
    assertReserved: () =>
      assert.throws(() => desktopAgentsAdmission(admissionDirectory), /reconciliation/),
    async close() {
      service.close();
      clients.forEach((client) => client.close());
      await session.close();
      pair.close();
      stores.forEach((store) => store.close());
      rmSync(root, { recursive: true, force: true });
    },
  };
}

test('Tauri native signed consent completes Core/socket A -> B -> A without PTY injection', async () => {
  const f = await fixture();
  try {
    const source = await f.start(0),
      target = await f.start(1);
    const marker = f.marker();
    await assert.rejects(
      f.clients[0]!.call(randomUUID(), {
        name: 'delegate_task',
        arguments: { task: 'before native grant' },
      }),
    );
    const grant = f.authorize(1); // Focusing B does not reverse the fixed roles.
    const confirmation = await f.confirm();
    await grant.pending;
    assert.equal(f.status(grant.id), 'ok');
    assert.equal(confirmation.slot, 1);
    assert.equal(confirmation.requestId, grant.id);
    const detail = JSON.parse(String(confirmation.detail)) as Record<string, unknown>;
    assert.equal(detail.sourceInstanceId, source);
    assert.equal(detail.targetInstanceId, target);
    assert.equal(detail.maximumTaskBytes, 4096);
    assert.equal(detail.maximumResultBytes, 8192);
    const waiting = f.clients[1]!.call(randomUUID(), { name: 'wait_task', arguments: {} });
    const result = f.clients[0]!.call(randomUUID(), {
      name: 'delegate_task',
      arguments: { task: 'SYNTHETIC Tauri task' },
    });
    const delivered = (await waiting) as { taskId: string; task: string };
    assert.equal(delivered.task, 'SYNTHETIC Tauri task');
    await assert.rejects(
      f.clients[1]!.call(randomUUID(), {
        name: 'submit_result',
        arguments: { taskId: randomUUID(), result: 'wrong correlation' },
      }),
    );
    await f.clients[1]!.call(randomUUID(), {
      name: 'submit_result',
      arguments: { taskId: delivered.taskId, result: 'SYNTHETIC result' },
    });
    assert.deepEqual(await result, {
      state: 'completed',
      taskId: delivered.taskId,
      result: 'SYNTHETIC result',
    });
    const replay = f.authorize();
    await replay.pending;
    assert.equal(f.status(replay.id), 'denied');
    assert.equal(JSON.stringify(f.messages).includes('signature'), false);
    assert.deepEqual(f.writes, []);
    assert.deepEqual(f.signals, []);
    assert.deepEqual(f.marker(), marker);
    f.assertReserved();
  } finally {
    await f.close();
  }
});

test('Tauri MCP requires opt-in, native focus and two actually started owned handles', async () => {
  for (const optedIn of [false, true]) {
    const f = await fixture(optedIn);
    try {
      for (const starts of [0, 1]) {
        if (starts) await f.start(0);
        const request = f.authorize();
        await request.pending;
        assert.equal(f.status(request.id), 'denied');
      }
      await f.start(1);
      const request = f.authorize(0, false);
      await request.pending;
      assert.equal(f.status(request.id), 'denied');
      assert.equal(
        f.messages.some((m) => m.requestId),
        false,
      );
    } finally {
      await f.close();
    }
  }
  assert.equal(
    terminalNativeRequestSchema.safeParse({ version: 1, action: 'authorizeMcp' }).success,
    false,
  );
  for (const extra of [{ proof: {} }, { task: 'injected' }, { targetInstanceId: randomUUID() }])
    assert.equal(
      tauriTerminalMessageSchema.safeParse({
        kind: 'authorizeMcp',
        id: randomUUID(),
        slot: 0,
        focused: true,
        ...extra,
      }).success,
      false,
    );
});

test('Tauri MCP wrong confirmation IDs, duplicate requests and cancellation cannot grant authority', async () => {
  const f = await fixture();
  try {
    await f.start(0);
    await f.start(1);
    const request = f.authorize();
    await setImmediate();
    await f.service.receive({ kind: 'confirm', id: randomUUID(), accepted: true });
    assert.equal(f.session.snapshot().state, 'ungranted');
    const duplicate = f.authorize(1);
    await duplicate.pending;
    assert.equal(f.status(duplicate.id), 'busy');
    await f.confirm(false);
    await request.pending;
    assert.equal(f.status(request.id), 'cancelled');
    assert.equal(f.session.snapshot().state, 'ungranted');
    // A fresh native review is permitted after explicit cancellation, without a new process.
    const retry = f.authorize();
    await f.confirm();
    await retry.pending;
    assert.equal(f.status(retry.id), 'ok');
  } finally {
    await f.close();
  }
});

test('Tauri MCP blur/layout revocation or either document close cancels pending consent', async () => {
  for (const kind of ['revoke', 'close'] as const) {
    const f = await fixture();
    try {
      await f.start(0);
      await f.start(1);
      const marker = f.marker();
      const request = f.authorize();
      await setImmediate();
      const confirmation = f.messages.findLast((m) => m.kind === 'confirm')!;
      await f.service.receive({ kind, slot: 1 });
      await f.service.receive({ kind: 'confirm', id: confirmation.id, accepted: true });
      await request.pending;
      assert.equal(f.status(request.id), 'cancelled');
      assert.notEqual(f.session.snapshot().state, 'ready');
      assert.deepEqual(f.marker(), marker);
      f.assertReserved();
      assert.deepEqual(f.signals, []);
    } finally {
      await f.close();
    }
  }
});

test('Tauri document reload invalidates an authorized queued task as unknown, retaining the reservation', async () => {
  const f = await fixture();
  try {
    await f.start(0);
    await f.start(1);
    const marker = f.marker();
    const request = f.authorize();
    await f.confirm();
    await request.pending;
    const result = f.clients[0]!.call(randomUUID(), {
      name: 'delegate_task',
      arguments: { task: 'SYNTHETIC undelivered task' },
    });
    await setImmediate();
    await f.service.receive({ kind: 'close', slot: 1 });
    assert.equal(((await result) as { state: string }).state, 'unknown');
    assert.deepEqual(f.marker(), marker);
    f.assertReserved();
    assert.deepEqual(f.writes, []);
    assert.deepEqual(f.signals, []);
  } finally {
    await f.close();
  }
});

test('Tauri MCP drops preparation arriving after revocation and handles a rejected Core operation', async () => {
  const f = await fixture();
  try {
    await f.start(0);
    await f.start(1);
    const original = f.port.prepareMcp;
    let release!: (value: unknown) => void;
    f.port.prepareMcp = () =>
      new Promise((resolve) => {
        release = resolve;
      });
    const request = f.authorize();
    const prepared = f.session.prepare();
    await f.service.receive({ kind: 'revoke', slot: 0 });
    release(prepared);
    await request.pending;
    assert.equal(f.status(request.id), 'denied');
    assert.equal(
      f.messages.some((m) => m.requestId === request.id),
      false,
    );
    f.port.prepareMcp = original;
    f.events[1]!.lost();
    const lost = f.authorize();
    await lost.pending;
    assert.equal(f.status(lost.id), 'denied');
    f.assertReserved();
  } finally {
    await f.close();
  }
});

test('Tauri MCP expiration and native timeout never sign a grant', async (t) => {
  const f = await fixture();
  try {
    await f.start(0);
    await f.start(1);
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.now() });
    const request = f.authorize();
    await setImmediate();
    t.mock.timers.tick(30_001);
    await request.pending;
    assert.equal(f.status(request.id), 'cancelled');
    assert.equal(f.session.snapshot().state, 'ungranted');
    t.mock.timers.reset();
    const expired = f.authorize();
    await setImmediate();
    t.mock.timers.enable({ apis: ['Date'], now: Date.now() + 30_001 });
    await f.confirm();
    await expired.pending;
    assert.equal(f.status(expired.id), 'denied');
    assert.equal(f.session.snapshot().state, 'ungranted');
  } finally {
    t.mock.timers.reset();
    await f.close();
  }
});

test('native terminal host shutdown cancels consent before signing', async () => {
  const f = await fixture();
  try {
    await f.start(0);
    await f.start(1);
    const request = f.authorize();
    await setImmediate();
    f.service.close();
    await request.pending;
    assert.equal(f.status(request.id), 'cancelled');
    assert.notEqual(f.session.snapshot().state, 'ready');
    assert.deepEqual(f.writes, []);
    f.assertReserved();
  } finally {
    await f.close();
  }
});
