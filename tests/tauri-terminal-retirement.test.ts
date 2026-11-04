// Synthetic owned handles and disposable SQLite journals only. No provider/native UI.
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import test from 'node:test';
import { Store } from '@orqst/database';
import type { TerminalJournal } from '@orqst/protocol';
import { TauriTerminalService } from '../apps/desktop/src/tauri-terminal-service.js';
import { TauriTerminalRetirement } from '../apps/desktop/src/tauri-terminal-retirement.js';
import { desktopAgentsAdmission } from '../packages/core/src/managed-codex/desktop-admission.js';
import { TerminalAuthority, terminalDigest } from '../packages/core/src/terminal/authority.js';
import { ManagedTerminalPair } from '../packages/core/src/terminal/managed-pair.js';
import type { TerminalNativeSupervisor } from '../packages/core/src/terminal/native-broker.js';
import { terminalRPCSchema } from '../packages/core/src/terminal/rpc.js';
import type { TerminalEvents } from '../packages/core/src/terminal/supervisor.js';

function fixture(
  options: { retireError?: boolean; closeError?: boolean; beforeClose?: () => Promise<void> } = {},
) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'orqst-synthetic-tauri-retire-')));
  const directory = join(root, 'admission');
  const keys = generateKeyPairSync('ed25519');
  const authority = new TerminalAuthority(new Map([['desktop-managed', keys.publicKey]]), Date.now);
  const stores: Store[] = [];
  const journals: TerminalJournal[] = [];
  const instances: string[] = [];
  const events: TerminalEvents[] = [];
  const pair = new ManagedTerminalPair(
    authority,
    [0, 1].map((slot) => {
      const state = join(root, String(slot));
      mkdirSync(state, { mode: 0o700 });
      const store = new Store(join(state, 'terminal.sqlite'));
      stores.push(store);
      const journal = store.terminalJournal(authority.epoch, { recover: false });
      journals.push(journal);
      return {
        journal,
        profiles: [
          {
            id: 'codex-terminal-v1',
            projectId: 'synthetic-disposable',
            executable: '/synthetic/never-executed',
            executableSha256: terminalDigest('synthetic'),
            executableVersion: 'synthetic',
            argv: [],
            cwd: '/synthetic',
            environmentProfile: 'no-credentials',
            permissions: 'synthetic only',
          },
        ],
        backend: {
          validate: () => true,
          start: (_profile: unknown, handlers: TerminalEvents) => {
            events[slot] = handlers;
            handlers.started();
            return { write() {}, resize() {}, signal() {}, dispose() {} };
          },
        },
      };
    }),
    desktopAgentsAdmission(directory),
  );
  const supervisors = [0, 1].map(
    (slot) =>
      Object.fromEntries(
        terminalRPCSchema.options.map((schema) => {
          const operation = schema.shape.operation.value;
          return [
            operation,
            (...args: unknown[]) => pair.dispatch(slot, { id: randomUUID(), operation, args }),
          ];
        }),
      ) as TerminalNativeSupervisor,
  );
  const messages: Array<Record<string, unknown>> = [];
  let retireCalls = 0;
  let closeCalls = 0;
  let mutateReview: (review: ReturnType<typeof pair.prepareRetire>) => unknown = (r) => r;
  const service = new TauriTerminalService(
    supervisors,
    keys,
    (value) => messages.push(value as Record<string, unknown>),
    (key) => key,
    undefined,
    {
      prepareRetire: async () => mutateReview(pair.prepareRetire()),
      retire: async (proof) => {
        retireCalls++;
        if (options.retireError) throw new Error('Synthetic uncertain RPC');
        pair.retire(proof);
      },
      closeAndWait: async () => {
        closeCalls++;
        await options.beforeClose?.();
        if (options.closeError) throw new Error('Synthetic unconfirmed Core exit');
        pair.close();
      },
    },
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
    const confirm = messages.findLast((m) => m.kind === 'confirm')!;
    await service.receive({ kind: 'confirm', id: confirm.id, accepted: true });
    await pending;
    const reply = messages.findLast((m) => m.id === id)?.value as {
      status: string;
      instanceId: string;
    };
    assert.equal(reply.status, 'ok');
    instances[slot] = reply.instanceId;
  }
  function retire() {
    const id = randomUUID();
    return {
      id,
      pending: service.receive({ kind: 'retire', id, slot: 0, focused: true }),
      result: () => messages.findLast((m) => m.id === id),
    };
  }
  async function confirm(accepted = true) {
    const message = messages.findLast((m) => m.kind === 'confirm')!;
    assert.equal(message.message, 'managedTerminal.retireConfirm');
    await service.receive({ kind: 'confirm', id: message.id, accepted });
  }
  return {
    service,
    journals,
    instances,
    pair,
    directory,
    root,
    messages,
    events,
    stores,
    start,
    retire,
    confirm,
    calls: () => ({ retireCalls, closeCalls }),
    mutateReview: (mutate: typeof mutateReview) => {
      mutateReview = mutate;
    },
    close() {
      service.close();
      pair.close();
      for (const store of stores) store.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

test('Tauri retirement signs Core exit evidence, archives capacity and reports success only after Core close', async () => {
  const f = fixture();
  try {
    await f.start(0);
    await f.start(1);
    f.events.forEach((event) => event.exit(0));
    const before = f.journals.map((journal, slot) => journal.read(f.instances[slot]!));
    const request = f.retire();
    await setImmediate();
    const concurrent = randomUUID();
    await f.service.receive({
      kind: 'request',
      id: concurrent,
      slot: 1,
      focused: true,
      request: { version: 1, action: 'start', profileId: 'codex-terminal-v1' },
    });
    assert.deepEqual(f.messages.findLast((m) => m.id === concurrent)?.value, { status: 'denied' });
    await f.confirm();
    await request.pending;
    assert.equal(request.result()?.status, 'retired');
    assert.equal(request.result()?.fenced, true);
    assert.deepEqual(f.calls(), { retireCalls: 1, closeCalls: 1 });
    assert.equal(existsSync(join(f.directory, 'active-pair.json')), false);
    const archive = readdirSync(f.directory).find((name) => name.startsWith('retired-'))!;
    assert.equal(
      JSON.parse(readFileSync(join(f.directory, archive), 'utf8')).evidence.attempts.length,
      2,
    );
    assert.deepEqual(
      f.journals.map((journal, slot) => journal.read(f.instances[slot]!)),
      before,
    );
    const again = f.retire();
    await again.pending;
    assert.equal(again.result()?.status, 'denied');
    assert.deepEqual(f.calls(), { retireCalls: 1, closeCalls: 1 });
    const wire = JSON.stringify(f.messages);
    for (const secret of ['signature', 'privateKey', 'challengeId'])
      assert.equal(wire.includes(secret), false);
    assert.doesNotThrow(() => desktopAgentsAdmission(f.directory));
  } finally {
    f.close();
  }
});

for (const invalidation of ['cancel', 'revoke', 'close', 'changed-reservation'] as const) {
  test(`Tauri retirement preserves the reservation on ${invalidation}`, async () => {
    const f = fixture();
    try {
      await f.start(0);
      f.events[0]!.exit(0);
      const marker = join(f.directory, 'active-pair.json');
      const original = readFileSync(marker, 'utf8');
      const request = f.retire();
      await setImmediate();
      if (invalidation === 'revoke' || invalidation === 'close')
        await f.service.receive({ kind: invalidation, slot: 0 });
      if (invalidation === 'changed-reservation')
        writeFileSync(marker, 'SYNTHETIC-UNKNOWN-OWNER', { mode: 0o600 });
      await f.confirm(invalidation !== 'cancel');
      await request.pending;
      assert.notEqual(request.result()?.status, 'retired');
      assert.equal(
        readFileSync(marker, 'utf8'),
        invalidation === 'changed-reservation' ? 'SYNTHETIC-UNKNOWN-OWNER' : original,
      );
      assert.equal(
        readdirSync(f.directory).some((name) => name.startsWith('retired-')),
        false,
      );
      if (invalidation === 'cancel') {
        const retry = f.retire();
        await setImmediate();
        await f.confirm();
        await retry.pending;
        assert.equal(retry.result()?.status, 'retired');
      }
    } finally {
      f.close();
    }
  });
}

for (const state of ['running', 'lost', 'journal-fenced'] as const) {
  test(`Tauri refuses retirement before review when a slot is ${state}`, async () => {
    const f = fixture();
    try {
      await f.start(0);
      await f.start(1);
      f.events[0]!.exit(0);
      if (state === 'lost') {
        f.events[1]!.lost();
        f.events[1]!.exit(0);
      }
      if (state === 'journal-fenced') {
        f.events[1]!.exit(0);
        f.stores[1]!.terminalJournal(randomUUID(), { recover: true });
      }
      const original = readFileSync(join(f.directory, 'active-pair.json'), 'utf8');
      const confirmations = f.messages.filter((m) => m.kind === 'confirm').length;
      const request = f.retire();
      await request.pending;
      assert.equal(request.result()?.status, 'denied');
      assert.equal(request.result()?.fenced, false);
      assert.equal(f.messages.filter((m) => m.kind === 'confirm').length, confirmations);
      assert.equal(readFileSync(join(f.directory, 'active-pair.json'), 'utf8'), original);
      assert.deepEqual(f.calls(), { retireCalls: 0, closeCalls: 0 });
    } finally {
      f.close();
    }
  });
}

for (const error of ['retireError', 'closeError'] as const) {
  test(`Tauri never reports success or retries after ${error}`, async () => {
    const f = fixture({ [error]: true });
    try {
      await f.start(0);
      f.events[0]!.exit(0);
      const request = f.retire();
      await setImmediate();
      await f.confirm();
      await request.pending;
      assert.equal(request.result()?.status, 'denied');
      assert.equal(request.result()?.fenced, true);
      const again = f.retire();
      await again.pending;
      assert.equal(again.result()?.status, 'denied');
      assert.equal(f.calls().retireCalls, 1);
      assert.equal(existsSync(join(f.directory, 'active-pair.json')), error === 'retireError');
    } finally {
      f.close();
    }
  });
}

for (const invalidReview of ['wrong-digest', 'wrong-target', 'oversized', 'malformed'] as const) {
  test(`Tauri never signs a ${invalidReview} retirement review`, async () => {
    const f = fixture();
    try {
      await f.start(0);
      f.events[0]!.exit(0);
      f.mutateReview((review) => {
        if (invalidReview === 'malformed') return { evidence: review.evidence, challenge: {} };
        if (invalidReview === 'wrong-target')
          return { ...review, challenge: { ...review.challenge, target: randomUUID() } };
        if (invalidReview === 'wrong-digest') return { ...review, evidence: { forged: true } };
        const evidence = { synthetic: '\u200b'.repeat(4096) };
        return {
          evidence,
          challenge: { ...review.challenge, digest: terminalDigest(JSON.stringify(evidence)) },
        };
      });
      const confirmations = f.messages.filter((m) => m.kind === 'confirm').length;
      const request = f.retire();
      await request.pending;
      assert.equal(request.result()?.status, 'denied');
      assert.equal(f.messages.filter((m) => m.kind === 'confirm').length, confirmations);
      assert.deepEqual(f.calls(), { retireCalls: 0, closeCalls: 0 });
      assert.equal(existsSync(join(f.directory, 'active-pair.json')), true);
    } finally {
      f.close();
    }
  });
}

test('Tauri keeps success pending until Core exit is actually acknowledged', async () => {
  let acknowledge!: () => void;
  const closed = new Promise<void>((resolve) => {
    acknowledge = resolve;
  });
  const f = fixture({ beforeClose: () => closed });
  try {
    await f.start(0);
    f.events[0]!.exit(0);
    const request = f.retire();
    await setImmediate();
    await f.confirm();
    await setImmediate();
    assert.equal(f.calls().closeCalls, 1);
    assert.equal(request.result(), undefined);
    acknowledge();
    await request.pending;
    assert.equal(request.result()?.status, 'retired');
  } finally {
    acknowledge();
    f.close();
  }
});

test('retirement is native-only and an unfocused native request cannot obtain a review', async () => {
  const f = fixture();
  try {
    await f.start(0);
    f.events[0]!.exit(0);
    const before = f.messages.length;
    await f.service.receive({ kind: 'retire', id: randomUUID(), slot: 0, focused: false });
    assert.equal(f.messages.at(-1)?.status, 'denied');
    assert.equal(
      f.messages.slice(before).some((m) => m.kind === 'confirm'),
      false,
    );
    const id = randomUUID();
    await f.service.receive({
      kind: 'request',
      id,
      slot: 0,
      focused: true,
      request: { version: 1, action: 'retire' },
    });
    assert.deepEqual(f.messages.at(-1)?.value, { status: 'denied' });
    assert.deepEqual(f.calls(), { retireCalls: 0, closeCalls: 0 });
  } finally {
    f.close();
  }
});

test('retirement fences new work before proof dispatch without flooding Core with teardown RPCs', async () => {
  const keys = generateKeyPairSync('ed25519');
  const authority = new TerminalAuthority(new Map([['desktop-managed', keys.publicKey]]));
  const evidence = { epoch: authority.epoch, attempts: [] };
  const trace: string[] = [];
  const retirement: TauriTerminalRetirement = new TauriTerminalRetirement(
    {
      prepareRetire: async () => ({
        evidence,
        challenge: authority.prepare('desktop-managed', {
          operation: 'retire',
          target: authority.epoch,
          digest: terminalDigest(JSON.stringify(evidence)),
        }),
      }),
      retire: async (proof) => {
        assert.equal(retirement.fenced, true);
        assert.equal(trace.length, 0); // Teardown RPCs must not occupy the retirement queue.
        authority.consume(proof, {
          operation: 'retire',
          target: authority.epoch,
          digest: terminalDigest(JSON.stringify(evidence)),
        });
        trace.push('retired');
      },
      closeAndWait: async () => {
        trace.push('core-exited');
      },
    },
    keys.privateKey,
  );
  assert.equal(
    await retirement.run({
      current: () => true,
      confirm: async () => true,
      closeBrokers: () => {
        trace.push('brokers-closed');
      },
    }),
    'retired',
  );
  assert.deepEqual(trace, ['retired', 'core-exited', 'brokers-closed']);
});
