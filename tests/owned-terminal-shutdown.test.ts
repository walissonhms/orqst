// Synthetic owned handles and disposable receipt/journal files only. Never launches a provider.
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import {
  renameSync,
  openSync,
  fsyncSync,
  constants,
  closeSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Store } from '@orqst/database';
import { terminalNativeRequestSchema, terminalPreparationCatalogSchema } from '@orqst/protocol';
import {
  OwnedTerminalShutdown,
  type OwnedShutdownInventory,
} from '../packages/core/src/terminal/owned-shutdown.js';
import {
  preserveOwnedExitPending,
  detachOwnedExitPending,
  inspectPendingOwnedExits,
  maximumPendingOwnedExits,
  readOwnedExitPending,
} from '../packages/core/src/terminal/exit-pending.js';
import { desktopAgentsAdmission } from '../packages/core/src/managed-codex/desktop-admission.js';
import {
  DesktopAdmissionRefused,
  inspectDesktopAdmission,
} from '../packages/core/src/managed-codex/desktop-admission-inspection.js';
import {
  createLifecycleReceipt,
  armLifecycleReceipt,
  readLifecycleReceipt,
} from '../packages/core/src/managed-codex/lifecycle-receipt.js';
import {
  TerminalAuthority,
  terminalChallengeBytes,
  terminalDigest,
  type TerminalChallenge,
} from '../packages/core/src/terminal/authority.js';
import { ManagedTerminalPair } from '../packages/core/src/terminal/managed-pair.js';
import { TauriTerminalService } from '../apps/desktop/src/tauri-terminal-service.js';
import { TerminalCliPolicyStore } from '../packages/core/src/terminal/cli-authorization.js';
import { terminalRPCSchema } from '../packages/core/src/terminal/rpc.js';
import type { TerminalNativeSupervisor } from '../packages/core/src/terminal/native-broker.js';
import { TauriTerminalRetirement } from '../apps/desktop/src/tauri-terminal-retirement.js';

function fixture() {
  let time = 0;
  let signals = 0;
  let complete = false;
  let lost = false;
  const epoch = randomUUID(),
    id = randomUUID();
  const inventory = (): OwnedShutdownInventory => ({
    epoch,
    attempts: [
      {
        slot: 0,
        instanceId: id,
        epoch,
        state: lost ? 'ownership_lost' : complete ? 'exited' : 'running',
        ...(complete ? { exit: { exitCode: 0 } } : {}),
      },
    ],
  });
  const ports = {
    current: () => true,
    inventory: async () => inventory(),
    owns: () => true,
    stop: async () => {
      signals++;
    },
    prepareRetirement: async () => ({ evidence: inventory() }),
    now: () => time,
    wait: async (ms: number) => {
      time += ms;
    },
  };
  return {
    ports,
    inventory,
    signals: () => signals,
    complete: () => {
      complete = true;
    },
    lose: () => {
      lost = true;
    },
  };
}

test('native shutdown is absent from the renderer terminal contract regardless of focus claims', () => {
  for (const action of [
    'shutdownOwned',
    'beginOwnedShutdown',
    'preserveOwnedShutdown',
    'retireOwned',
    'closePreservedOwned',
  ])
    assert.equal(
      terminalNativeRequestSchema.safeParse({ version: 1, action, focused: true }).success,
      false,
    );
});

test('SIGTERM is latched once, timeout stays uncertain, and retry only accepts later exit receipts', async () => {
  const f = fixture();
  const shutdown = new OwnedTerminalShutdown(f.ports, 100);
  assert.equal(shutdown.run(), shutdown.run());
  const first = await shutdown.run();
  assert.equal(first.status, 'uncertain');
  assert.equal(first.uncertain[0]?.reason, 'timeout');
  assert.equal(f.signals(), 1);
  assert.equal((await shutdown.run()).status, 'uncertain');
  assert.equal(f.signals(), 1);
  f.complete();
  assert.equal((await shutdown.run()).status, 'ready');
  assert.equal(f.signals(), 1);
});

test('lost ownership and transport refuse shutdown without invented exits or repeated signals', async () => {
  const f = fixture();
  f.lose();
  const shutdown = new OwnedTerminalShutdown(f.ports, 100);
  const lost = await shutdown.run();
  assert.equal(lost.status, 'uncertain');
  assert.equal(lost.uncertain[0]?.reason, 'ownership_lost');
  assert.equal(f.signals(), 0);
  const g = fixture();
  const transport = new OwnedTerminalShutdown(
    {
      ...g.ports,
      stop: async () => {
        await g.ports.stop();
        throw new Error('Synthetic ACK lost');
      },
    },
    100,
  );
  assert.equal((await transport.run()).status, 'uncertain');
  assert.equal((await transport.run()).status, 'uncertain');
  assert.equal(g.signals(), 1);
});

test('a timed-out asynchronous stop preparation cannot send a signal after its native transaction ends', async () => {
  const f = fixture();
  let finish = () => {};
  let effects = 0;
  const shutdown = new OwnedTerminalShutdown(
    {
      ...f.ports,
      now: Date.now,
      stop: async (_attempt, current) => {
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
        if (current()) effects++;
      },
    },
    20,
  );
  assert.equal((await shutdown.run()).status, 'uncertain');
  finish();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(effects, 0);
});

test('unknown instance sources and changed Core epochs are never shutdown authorities', async () => {
  const f = fixture();
  const foreign = new OwnedTerminalShutdown({ ...f.ports, owns: () => false }, 100);
  assert.equal((await foreign.run()).status, 'uncertain');
  assert.equal(f.signals(), 0);
  const g = fixture();
  const shutdown = new OwnedTerminalShutdown(g.ports, 100);
  await shutdown.run();
  g.ports.inventory = async () => ({ ...g.inventory(), epoch: randomUUID() });
  assert.equal((await shutdown.run()).status, 'uncertain');
  assert.equal(g.signals(), 1);
});

test('leader exit plus unavailable retirement needs durable pending acknowledgment before exit permission', async () => {
  const f = fixture();
  f.complete();
  const unavailable = async () => {
    throw new Error('Synthetic OpenCode descendant boundary');
  };
  const denied = new OwnedTerminalShutdown(
    {
      ...f.ports,
      prepareRetirement: unavailable,
      preserveExit: async () => {
        throw new Error('Unconfirmed marker');
      },
    },
    100,
  );
  const result = await denied.run();
  assert.equal(result.status, 'uncertain');
  assert.equal(result.uncertain[0]?.reason, 'retirement_unavailable');
  const permitted = new OwnedTerminalShutdown(
    {
      ...f.ports,
      prepareRetirement: unavailable,
      preserveExit: async () => ({
        status: 'leader_exited_retirement_pending',
        evidence: f.inventory(),
      }),
    },
    100,
  );
  const preserved = await permitted.run();
  assert.equal(preserved.status, 'exited_retirement_unavailable');
  assert.deepEqual(preserved.uncertain, []);
});

function coreFixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'orqst-synthetic-owned-shutdown-')));
  const keys = generateKeyPairSync('ed25519');
  const authority = new TerminalAuthority(new Map([['desktop-managed', keys.publicKey]]), Date.now);
  const store = new Store(join(root, 'terminal.sqlite'));
  const admission = desktopAgentsAdmission(
    join(root, 'admission'),
    ['/synthetic/manifest'],
    authority.epoch,
  );
  let receipt: ReturnType<typeof armLifecycleReceipt>;
  let fd: number | undefined;
  let binding: { instanceId: string; epoch: string; manifestDigest: string; configDigest: string };
  let started: Promise<void> = Promise.resolve();
  let signals = 0;
  const pair = new ManagedTerminalPair(
    authority,
    [
      {
        journal: store.terminalJournal(authority.epoch, { recover: false }),
        profiles: [
          {
            id: 'codex-terminal-v1',
            projectId: 'synthetic',
            executable: '/synthetic/never-executed',
            executableSha256: 'a'.repeat(64),
            executableVersion: 'SYNTHETIC',
            argv: [],
            cwd: '/synthetic',
            environmentProfile: 'synthetic',
            permissions: 'synthetic',
          },
        ],
        backend: {
          validate: () => true,
          start: (_profile, events, identity) => {
            binding = { ...identity!, configDigest: 'b'.repeat(64) };
            fd = createLifecycleReceipt(root, binding);
            receipt = armLifecycleReceipt(fd, binding.configDigest);
            started = receipt.record({ type: 'started' }).then(() => events.started());
            return {
              write() {},
              resize() {},
              signal: (signal) => {
                signals++;
                assert.equal(signal, 'SIGTERM');
                void receipt
                  .record({ type: 'exit', code: 0, signal: null })
                  .then(() => events.exit(0));
              },
              dispose() {},
            };
          },
        },
      },
    ],
    admission,
  );
  const dispatch = (operation: string, args: unknown[]) =>
    pair.dispatch(0, { id: randomUUID(), operation, args });
  const proof = (challenge: TerminalChallenge) => ({
    challengeId: challenge.challengeId,
    signature: sign(null, terminalChallengeBytes(challenge), keys.privateKey).toString('base64url'),
  });
  const start = async () => {
    const p = dispatch('prepare', ['desktop-managed', 'codex-terminal-v1']) as {
      attemptId: string;
      challenge: TerminalChallenge;
    };
    dispatch('launch', [p.attemptId, proof(p.challenge)]);
    await started;
    return p.attemptId;
  };
  const ports = {
    current: () => true,
    inventory: async () => pair.ownedShutdownInventory(),
    owns: () => true,
    stop: async (attempt: OwnedShutdownInventory['attempts'][number], current: () => boolean) => {
      const c = dispatch('requestStop', [
        'desktop-managed',
        attempt.instanceId,
        'SIGTERM',
      ]) as TerminalChallenge;
      if (current()) dispatch('stop', [attempt.instanceId, 'SIGTERM', proof(c)]);
    },
    prepareRetirement: async () => pair.prepareRetire(),
  };
  return {
    root,
    keys,
    authority,
    store,
    pair,
    admission,
    dispatch,
    proof,
    start,
    ports,
    signals: () => signals,
    receipt: () => readLifecycleReceipt(root, binding),
    cleanup: () => {
      pair.close();
      store.close();
      if (fd !== undefined) closeSync(fd);
      rmSync(root, { recursive: true, force: true });
    },
  };
}

test('existing owned stop waits for a real durable receipt and Core journal before ready and retirement', async () => {
  const f = coreFixture();
  try {
    await f.start();
    const shutdown = new OwnedTerminalShutdown(f.ports);
    assert.equal((await shutdown.run()).status, 'ready');
    assert.equal(f.signals(), 1);
    assert.equal(f.receipt().status, 'recorded_exit');
    const retirement = new TauriTerminalRetirement(
      {
        epoch: f.authority.epoch,
        prepareRetire: async () => f.pair.prepareRetire(),
        retire: async (p) => {
          f.pair.retire(p);
        },
        closeAndWait: async () => {},
      },
      f.keys.privateKey,
    );
    assert.equal(
      await retirement.run({
        current: () => true,
        authorizeOwnedRetirement: (e) => e.attempts.length > 0 && e.epoch === f.authority.epoch,
        closeBrokers: () => {},
      }),
      'retired',
    );
    assert.equal(existsSync(join(f.root, 'admission/active-pair.json')), false);
  } finally {
    f.cleanup();
  }
});

test('human-approved preserved exit keeps admission/receipts intact and next startup exposes a pending warning', async () => {
  const f = coreFixture();
  try {
    await f.start();
    const marker = readFileSync(join(f.root, 'admission/active-pair.json'));
    const shutdown = new OwnedTerminalShutdown({
      ...f.ports,
      prepareRetirement: async () => {
        throw new Error('OpenCode retirement unavailable');
      },
      preserveExit: async () =>
        preserveOwnedExitPending(
          join(f.root, 'admission'),
          {
            version: 1,
            status: 'leader_exited_retirement_pending',
            owner: f.admission.owner,
            evidence: f.pair.ownedExitEvidence(),
          },
          f.admission.assertOwner,
        ),
    });
    assert.equal((await shutdown.run()).status, 'exited_retirement_unavailable');
    assert.deepEqual(readFileSync(join(f.root, 'admission/active-pair.json')), marker);
    assert.equal(f.receipt().status, 'recorded_exit');
    assert.equal(
      readOwnedExitPending(join(f.root, 'admission'), f.admission.owner, f.authority.epoch)?.status,
      'leader_exited_retirement_pending',
    );
    assert.throws(
      () => inspectDesktopAdmission(join(f.root, 'admission')),
      (error: unknown) =>
        error instanceof DesktopAdmissionRefused && error.code === 'owned_exit_pending',
    );
    assert.equal((await shutdown.run()).status, 'exited_retirement_unavailable');
    assert.equal(f.signals(), 1);
  } finally {
    f.cleanup();
  }
});

test('retirement without a current broker view uses exact Core ownership; empty and forged attempts fail', async () => {
  const f = coreFixture();
  try {
    await f.start();
    await new OwnedTerminalShutdown(f.ports).run();
    // The Core also knows a nondispatched preparation made before a replacement view existed.
    f.dispatch('prepare', ['desktop-managed', 'codex-terminal-v1']);
    const retirement = new TauriTerminalRetirement(
      {
        epoch: f.authority.epoch,
        prepareRetire: async () => f.pair.prepareRetire(),
        retire: async (p) => {
          f.pair.retire(p);
        },
        closeAndWait: async () => {},
      },
      f.keys.privateKey,
    );
    assert.equal(
      await retirement.run({
        current: () => true,
        authorizeOwnedRetirement: (e) => e.attempts.length > 0 && e.epoch === f.authority.epoch,
        closeBrokers: () => {},
      }),
      'retired',
    );
  } finally {
    f.cleanup();
  }
  for (const attempts of [
    [],
    [{ slot: 0, instanceId: randomUUID(), epoch: randomUUID(), state: 'prepared' }],
  ]) {
    const g = coreFixture();
    try {
      await g.start();
      await new OwnedTerminalShutdown(g.ports).run();
      const fake = {
        epoch: g.authority.epoch,
        attempts: attempts.map((a) => ({ ...a, epoch: g.authority.epoch })),
      };
      const challenge = g.authority.prepare('desktop-managed', {
        operation: 'retire',
        target: g.authority.epoch,
        digest: terminalDigest(JSON.stringify(fake)),
      });
      const retirement = new TauriTerminalRetirement(
        {
          epoch: g.authority.epoch,
          prepareRetire: async () => ({ evidence: fake, challenge }),
          retire: async (p) => {
            g.pair.retire(p);
          },
          closeAndWait: async () => {},
        },
        g.keys.privateKey,
      );
      assert.equal(
        await retirement.run({
          current: () => true,
          authorizeOwnedRetirement: () => true,
          closeBrokers: () => {},
        }),
        'denied',
      );
      assert.equal(existsSync(join(g.root, 'admission/active-pair.json')), true);
    } finally {
      g.cleanup();
    }
  }
});

test('native background Quit stops a Core-owned selection with no current broker view, then retires it', async () => {
  const f = coreFixture();
  try {
    await f.start();
    const supervisors = [
      Object.fromEntries(
        terminalRPCSchema.options.map((schema) => {
          const operation = schema.shape.operation.value;
          return [operation, (...args: unknown[]) => f.dispatch(operation, args)];
        }),
      ) as TerminalNativeSupervisor,
    ];
    const messages: Array<Record<string, unknown>> = [];
    const service = new TauriTerminalService(
      supervisors,
      f.keys,
      (m) => messages.push(m as Record<string, unknown>),
      (key) => key,
      undefined,
      {
        epoch: f.authority.epoch,
        beginOwnedShutdown: async () => f.pair.ownedShutdownInventory(),
        prepareRetire: async () => f.pair.prepareRetire(),
        retire: async (p) => {
          f.pair.retire(p);
        },
        closeAndWait: async () => {},
      },
      new TerminalCliPolicyStore(f.root),
    );
    const forged = randomUUID();
    await service.receive({
      kind: 'request',
      id: forged,
      slot: 0,
      focused: true,
      request: { version: 1, action: 'shutdownOwned' },
    });
    assert.equal(f.signals(), 0);
    const id = randomUUID();
    await service.receive({ kind: 'shutdownOwned', id });
    assert.equal(messages.find((m) => m.id === id)?.status, 'ready');
    assert.equal(f.signals(), 1);
    const retire = randomUUID();
    await service.receive({ kind: 'retireOwned', id: retire });
    assert.equal(messages.find((m) => m.id === retire)?.status, 'retired');
    assert.equal(
      messages.some((m) => m.kind === 'confirm'),
      false,
    );
    service.close();
  } finally {
    f.cleanup();
  }
});

test('a prepared earlier-view attempt retires from Core identity with no CLI-use grant or current broker view', async () => {
  const f = coreFixture();
  try {
    await f.start();
    await new OwnedTerminalShutdown(f.ports).run();
    f.dispatch('prepare', ['desktop-managed', 'codex-terminal-v1']);
    const supervisors = [
      Object.fromEntries(
        terminalRPCSchema.options.map((schema) => {
          const operation = schema.shape.operation.value;
          return [operation, (...args: unknown[]) => f.dispatch(operation, args)];
        }),
      ) as TerminalNativeSupervisor,
    ];
    const messages: Array<Record<string, unknown>> = [];
    const service = new TauriTerminalService(
      supervisors,
      f.keys,
      (m) => messages.push(m as Record<string, unknown>),
      (key) => key,
      undefined,
      {
        epoch: f.authority.epoch,
        prepareRetire: async () => f.pair.prepareRetire(),
        retire: async (p) => {
          f.pair.retire(p);
        },
        closeAndWait: async () => {},
      },
      new TerminalCliPolicyStore(f.root),
    );
    const id = randomUUID();
    await service.receive({ kind: 'retire', id, slot: 0, focused: true });
    assert.equal(messages.find((m) => m.id === id)?.status, 'retired');
    assert.equal(
      messages.some((m) => m.kind === 'confirm'),
      false,
    );
    service.close();
  } finally {
    f.cleanup();
  }
});

for (const point of [
  'before_rename',
  'after_rename_before_fsync',
  'after_fsync_before_ack',
] as const) {
  test(`pending namespace crash point ${point} preserves either blocked old state or coherent new state`, () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'orqst-synthetic-pending-crash-')));
    try {
      const epoch = randomUUID(),
        admission = desktopAgentsAdmission(root, ['/synthetic/old'], epoch);
      admission.claim();
      const original = readFileSync(join(root, 'active-pair.json'), 'utf8');
      preserveOwnedExitPending(
        root,
        {
          version: 1,
          status: 'leader_exited_retirement_pending',
          owner: admission.owner,
          evidence: {
            epoch,
            attempts: [
              { slot: 0, instanceId: randomUUID(), epoch, state: 'exited', exit: { exitCode: 0 } },
            ],
          },
        },
        admission.assertOwner,
      );
      assert.throws(() =>
        detachOwnedExitPending(root, original, admission.assertOwner, {
          rename: (source, target) => {
            if (point === 'before_rename') throw new Error('Crash before rename');
            renameSync(source, target);
          },
          sync: (directory) => {
            if (point === 'after_rename_before_fsync')
              throw new Error('Crash before directory fsync');
            const fd = openSync(
              directory,
              constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
            );
            try {
              fsyncSync(fd);
            } finally {
              closeSync(fd);
            }
            throw new Error('Crash after fsync before ACK');
          },
        }),
      );
      assert.equal(existsSync(join(root, `exit-pending-${admission.owner}.json`)), true);
      const active = existsSync(join(root, 'active-pair.json')),
        pending = existsSync(join(root, `pending-pair-${admission.owner}.json`));
      assert.notEqual(active, pending);
      if (active) {
        assert.deepEqual(readFileSync(join(root, 'active-pair.json'), 'utf8'), original);
        assert.throws(() => inspectDesktopAdmission(root));
      } else {
        assert.equal(
          readFileSync(join(root, `pending-pair-${admission.owner}.json`), 'utf8'),
          original,
        );
        assert.doesNotThrow(() => inspectDesktopAdmission(root));
        assert.equal(inspectPendingOwnedExits(root)[0]?.code, 'owned_exit_pending');
        // Retry of the old ACK is idempotent, even after a fresh owner claims its own namespace.
        const next = desktopAgentsAdmission(root, ['/synthetic/new'], randomUUID());
        next.claim();
        const newBytes = readFileSync(join(root, 'active-pair.json'));
        detachOwnedExitPending(root, original, admission.assertOwner);
        assert.deepEqual(readFileSync(join(root, 'active-pair.json')), newBytes);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

test('previous-launch pending exit exposes a warning and permits a new Core Open without adoption or retirement', async () => {
  const f = coreFixture();
  let nextStore: Store | undefined;
  let nextPair: ManagedTerminalPair | undefined;
  try {
    await f.start();
    await new OwnedTerminalShutdown(f.ports).run();
    const original = readFileSync(join(f.root, 'admission/active-pair.json'), 'utf8');
    preserveOwnedExitPending(
      join(f.root, 'admission'),
      {
        version: 1,
        status: 'leader_exited_retirement_pending',
        owner: f.admission.owner,
        evidence: f.pair.ownedExitEvidence(),
      },
      f.admission.assertOwner,
    );
    f.admission.preservePendingExit();
    f.pair.close();
    assert.equal(
      inspectPendingOwnedExits(join(f.root, 'admission'))[0]?.code,
      'owned_exit_pending',
    );
    const keys = generateKeyPairSync('ed25519'),
      authority = new TerminalAuthority(new Map([['desktop-managed', keys.publicKey]]), Date.now);
    const next = desktopAgentsAdmission(
      join(f.root, 'admission'),
      ['/synthetic/new-launch-manifest'],
      authority.epoch,
    );
    nextStore = new Store(join(f.root, 'new-launch.sqlite'));
    let starts = 0;
    nextPair = new ManagedTerminalPair(
      authority,
      [
        {
          journal: nextStore.terminalJournal(authority.epoch, { recover: false }),
          profiles: [
            {
              id: 'codex-terminal-v1',
              projectId: 'synthetic-new',
              executable: '/synthetic/never-executed',
              executableSha256: 'a'.repeat(64),
              executableVersion: 'SYNTHETIC',
              argv: [],
              cwd: '/synthetic',
              environmentProfile: 'synthetic',
              permissions: 'synthetic',
            },
          ],
          backend: {
            validate: () => true,
            start: (_profile, events) => {
              starts++;
              events.started();
              return { write() {}, resize() {}, signal() {}, dispose() {} };
            },
          },
        },
      ],
      next,
    );
    const p = nextPair.dispatch(0, {
      id: randomUUID(),
      operation: 'prepare',
      args: ['desktop-managed', 'codex-terminal-v1'],
    }) as { attemptId: string; challenge: TerminalChallenge };
    nextPair.dispatch(0, {
      id: randomUUID(),
      operation: 'launch',
      args: [
        p.attemptId,
        {
          challengeId: p.challenge.challengeId,
          signature: sign(null, terminalChallengeBytes(p.challenge), keys.privateKey).toString(
            'base64url',
          ),
        },
      ],
    });
    assert.equal(starts, 1);
    assert.notEqual(authority.epoch, f.authority.epoch);
    assert.equal(
      readFileSync(join(f.root, `admission/pending-pair-${f.admission.owner}.json`), 'utf8'),
      original,
    );
    assert.equal(f.receipt().status, 'recorded_exit');
    assert.equal(
      JSON.parse(readFileSync(join(f.root, 'admission/active-pair.json'), 'utf8')).owner,
      next.owner,
    );
    assert.equal(inspectPendingOwnedExits(join(f.root, 'admission')).length, 1);
  } finally {
    nextPair?.close();
    nextStore?.close();
    f.cleanup();
  }
});

test('multiple pending reservations list deterministically up to a bounded limit without automatic deletion', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'orqst-synthetic-multiple-pending-')));
  try {
    const ids: string[] = [];
    for (let i = 0; i < maximumPendingOwnedExits; i++) {
      const epoch = randomUUID(),
        admission = desktopAgentsAdmission(root, [`/synthetic/${i}`], epoch);
      admission.claim();
      ids.push(admission.owner);
      preserveOwnedExitPending(
        root,
        {
          version: 1,
          status: 'leader_exited_retirement_pending',
          owner: admission.owner,
          evidence: {
            epoch,
            attempts: [
              { slot: 0, instanceId: randomUUID(), epoch, state: 'exited', exit: { exitCode: 0 } },
            ],
          },
        },
        admission.assertOwner,
      );
      admission.preservePendingExit();
    }
    assert.deepEqual(
      inspectPendingOwnedExits(root).map((p) => p.id),
      ids.sort(),
    );
    const epoch = randomUUID(),
      admission = desktopAgentsAdmission(root, ['/synthetic/overflow'], epoch);
    admission.claim();
    preserveOwnedExitPending(
      root,
      {
        version: 1,
        status: 'leader_exited_retirement_pending',
        owner: admission.owner,
        evidence: {
          epoch,
          attempts: [
            { slot: 0, instanceId: randomUUID(), epoch, state: 'exited', exit: { exitCode: 0 } },
          ],
        },
      },
      admission.assertOwner,
    );
    assert.throws(() => admission.preservePendingExit(), /limit/);
    assert.equal(inspectPendingOwnedExits(root).length, maximumPendingOwnedExits);
    assert.equal(existsSync(join(root, 'active-pair.json')), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('pending warning descriptors round-trip through the public catalog without private epochs or paths', () => {
  const pendingOwnedExits = [{ id: randomUUID(), code: 'owned_exit_pending', principalCount: 2 }];
  const parsed = terminalPreparationCatalogSchema.parse({
    contractVersion: 1,
    workspaceId: 'a'.repeat(64),
    featureId: null,
    catalogId: 'b'.repeat(64),
    pendingOwnedExits,
    providers: ['codex', 'claude', 'opencode'].map((provider) => ({
      provider,
      status: 'unavailable',
      reason: 'executable_not_found',
      models: [],
    })),
  });
  assert.deepEqual(parsed.pendingOwnedExits, pendingOwnedExits);
  assert.equal(JSON.stringify(parsed.pendingOwnedExits).includes('epoch'), false);
});
