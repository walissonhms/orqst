// All executables, handles, providers and receipts below are synthetic and never executed.
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { TauriTerminalService } from '../apps/desktop/src/tauri-terminal-service.js';
import test from 'node:test';
import {
  TerminalCliPolicyStore,
  type TerminalCliAuthorizationState,
} from '../packages/core/src/terminal/cli-authorization.js';
import { TerminalAuthority, terminalDigest } from '../packages/core/src/terminal/authority.js';
import {
  TerminalNativeBroker,
  type TerminalNativeSupervisor,
} from '../packages/core/src/terminal/native-broker.js';
import {
  TerminalSupervisor,
  type TerminalEvents,
  type TerminalProfile,
} from '../packages/core/src/terminal/supervisor.js';
import { TauriTerminalRetirement } from '../apps/desktop/src/tauri-terminal-retirement.js';

const profile: TerminalProfile = {
  id: 'synthetic',
  projectId: 'synthetic',
  executable: '/synthetic/cli',
  executableSha256: terminalDigest('synthetic'),
  executableVersion: 'synthetic',
  argv: [],
  cwd: '/synthetic',
  environmentProfile: 'synthetic-no-credentials-v1',
  permissions: 'synthetic only',
  cliAuthorizationScope: 'synthetic-local-v1',
};

function policyFixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'orqst-synthetic-cli-policy-')));
  chmodSync(root, 0o700);
  const binary = Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 1, 2, 3, 4]);
  const executable = join(root, 'synthetic-never-executed');
  writeFileSync(executable, binary, { mode: 0o700 });
  const selected = { ...profile, executable, executableSha256: terminalDigest(binary) };
  const store = new TerminalCliPolicyStore(root);
  return { root, selected, store, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('one durable CLI review covers model/cwd/PATH changes and a fresh policy-store instance', async () => {
  const s = policyFixture();
  try {
    let reviews = 0;
    const review = async () => {
      reviews++;
      return true;
    };
    assert.equal(await s.store.authorizeCli(s.selected, review), 'allowed');
    const epoch = s.store.epoch(s.selected);
    assert.ok(epoch);
    const anotherModel = {
      ...s.selected,
      cwd: '/another/workspace',
      argv: ['--model', 'synthetic-other'],
      permissions: 'Changed display prose/PATH/cache',
    };
    assert.equal(await s.store.authorizeCli(anotherModel, review), 'allowed');
    const restarted = new TerminalCliPolicyStore(s.root);
    assert.equal(restarted.current(anotherModel), 'allowed');
    assert.equal(restarted.epoch(anotherModel), epoch);
    assert.equal(reviews, 1);
    const stored = JSON.parse(
      readFileSync(
        join(s.root, 'cli-authorizations', `${terminalDigest(s.selected.executable)}.rev-1`),
        'utf8',
      ),
    );
    assert.deepEqual(Object.keys(stored).sort(), [
      'authorizationEpoch',
      'executable',
      'executableSha256',
      'permissionScope',
      'scope',
      'state',
      'version',
    ]);
  } finally {
    s.cleanup();
  }
});

test('missing/new permission scope and MCP expansion block inline without another review', async () => {
  const s = policyFixture();
  try {
    await s.store.authorizeCli(s.selected, async () => true);
    for (const cliAuthorizationScope of [undefined, 'synthetic-local-v1:mcp']) {
      let reviews = 0;
      const changed = { ...s.selected, cliAuthorizationScope };
      assert.equal(
        await s.store.authorizeCli(changed, async () => {
          reviews++;
          return true;
        }),
        'blocked',
      );
      assert.equal(reviews, 0);
    }
  } finally {
    s.cleanup();
  }
});

test('binary change requires one fresh native CLI review and replaces the old epoch', async () => {
  const s = policyFixture();
  try {
    await s.store.authorizeCli(s.selected, async () => true);
    const oldEpoch = s.store.epoch(s.selected);
    const updated = Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 9, 8, 7, 6]);
    writeFileSync(s.selected.executable, updated);
    assert.equal(s.store.current(s.selected), 'revoked');
    const selected = { ...s.selected, executableSha256: terminalDigest(updated) };
    let reviews = 0;
    assert.equal(
      await s.store.authorizeCli(selected, async () => {
        reviews++;
        return true;
      }),
      'allowed',
    );
    assert.notEqual(s.store.epoch(selected), oldEpoch);
    assert.equal(s.store.current(s.selected), 'revoked');
    assert.equal(reviews, 1);
  } finally {
    s.cleanup();
  }
});

test('revocation, linked policy source and unsafe file ownership/mode fail closed', async () => {
  const s = policyFixture();
  try {
    await s.store.authorizeCli(s.selected, async () => true);
    s.store.revoke(s.selected);
    assert.equal(
      await s.store.authorizeCli(s.selected, async () => {
        throw new Error('No review');
      }),
      'revoked',
    );
    const file = join(
      s.root,
      'cli-authorizations',
      `${terminalDigest(s.selected.executable)}.rev-2`,
    );
    chmodSync(file, 0o644);
    assert.equal(s.store.current(s.selected), 'revoked');
    chmodSync(file, 0o600);
    const content = readFileSync(file);
    rmSync(file);
    const alternate = join(s.root, 'untrusted-policy');
    writeFileSync(alternate, content, { mode: 0o600 });
    symlinkSync(alternate, file);
    assert.equal(s.store.current(s.selected), 'revoked');
  } finally {
    s.cleanup();
  }
});

function brokerFixture(
  wrap: (supervisor: TerminalSupervisor) => TerminalNativeSupervisor = (s) => s,
) {
  const keys = generateKeyPairSync('ed25519');
  let now = 1000;
  const authority = new TerminalAuthority(new Map([['native', keys.publicKey]]), () => now);
  const document = {};
  let focused = true;
  let nativeCurrent = true;
  let state: TerminalCliAuthorizationState = 'blocked';
  let epoch = randomUUID();
  let reviews = 0;
  const writes: string[] = [];
  const signals: string[] = [];
  const events = new Map<string, TerminalEvents>();
  let starts = 0;
  const supervisor = new TerminalSupervisor(
    authority,
    {
      validate: () => true,
      start: (_profile, event) => {
        events.set(String(starts++), event);
        event.started();
        return {
          write: (text) => writes.push(text),
          resize() {},
          signal: (signal) => signals.push(signal),
          dispose() {},
        };
      },
    },
    [profile],
  );
  const broker = new TerminalNativeBroker(
    authority,
    wrap(supervisor),
    'native',
    keys.privateKey,
    document,
    {
      current: (_document, requireFocus) => nativeCurrent && (!requireFocus || focused),
      confirm: async () => {
        throw new Error('Per-operation dialog forbidden');
      },
      cliAuthorization: {
        authorizeCli: async () => {
          if (state === 'blocked') {
            reviews++;
            state = 'allowed';
          }
          return state;
        },
        current: () => state,
        epoch: () => (state === 'allowed' ? epoch : undefined),
      },
    },
  );
  const send = (action: string, fields: object = {}) =>
    broker.dispatch(document, { version: 1, action, ...fields });
  const open = async () => {
    const reply = await send('open', { profileId: profile.id });
    assert.equal(reply.status, 'ok');
    if (reply.status !== 'ok') throw new Error('Synthetic open failed');
    assert.equal(reply.opening, 'ready');
    return reply.instanceId;
  };
  return {
    broker,
    document,
    send,
    open,
    authority,
    writes,
    signals,
    events,
    reviews: () => reviews,
    focus: (value: boolean) => {
      focused = value;
    },
    source: (value: boolean) => {
      nativeCurrent = value;
    },
    revoke: () => {
      state = 'revoked';
    },
    staleEpoch: () => {
      epoch = randomUUID();
    },
    advance: () => {
      now += 125_000;
    },
  };
}

test('one initial authorization opens multiple owned terminals, attaches, inputs, pastes and stops without dialogs', async () => {
  const s = brokerFixture();
  try {
    const id = await s.open();
    assert.equal(s.reviews(), 1);
    assert.equal(
      (await s.send('write', { instanceId: id, sequence: 0, text: 'synthetic' })).status,
      'ok',
    );
    assert.equal(
      (await s.send('paste', { instanceId: id, sequence: 1, text: 'synthetic\ntext' })).status,
      'ok',
    );
    assert.deepEqual(s.writes, ['synthetic', 'synthetic\ntext']);
    assert.equal((await s.send('stop', { instanceId: id, signal: 'SIGTERM' })).status, 'ok');
    assert.deepEqual(s.signals, ['SIGTERM']);
    s.events.get('0')!.exit(0);
    const next = await s.open();
    assert.equal((await s.send('detach', { instanceId: next })).status, 'ok');
    assert.equal((await s.send('attach', { instanceId: next })).status, 'ok');
    assert.equal((await s.send('input', { instanceId: next })).status, 'ok');
    assert.equal(s.reviews(), 1);
  } finally {
    s.broker.close();
  }
});

test('focus suspension and lease expiry resume only under native focus with continuous renderer replay protection', async () => {
  const s = brokerFixture();
  try {
    const id = await s.open();
    assert.equal(
      (await s.send('write', { instanceId: id, sequence: 0, text: 'first' })).status,
      'ok',
    );
    s.focus(false);
    s.broker.revokeInput();
    assert.equal(
      (await s.send('write', { instanceId: id, sequence: 1, text: 'background' })).status,
      'denied',
    );
    s.focus(true);
    assert.equal(
      (await s.send('write', { instanceId: id, sequence: 1, text: 'focused' })).status,
      'ok',
    );
    s.advance();
    assert.equal(
      (await s.send('write', { instanceId: id, sequence: 2, text: 'renewed' })).status,
      'ok',
    );
    assert.equal(
      (await s.send('write', { instanceId: id, sequence: 1, text: 'replay' })).status,
      'denied',
    );
    assert.deepEqual(s.writes, ['first', 'focused', 'renewed']);
    assert.equal(s.reviews(), 1);
  } finally {
    s.broker.close();
  }
});

for (const reason of ['revoked', 'epoch', 'source', 'document'] as const) {
  test(`trusted CLI never permits input from a ${reason} authorization context`, async () => {
    const s = brokerFixture();
    try {
      const id = await s.open();
      if (reason === 'revoked') s.revoke();
      if (reason === 'epoch') s.staleEpoch();
      if (reason === 'source') s.source(false);
      const request = {
        version: 1,
        action: 'write',
        instanceId: id,
        sequence: 0,
        text: 'forbidden',
      };
      assert.equal(
        (await s.broker.dispatch(reason === 'document' ? {} : s.document, request)).status,
        'denied',
      );
      assert.deepEqual(s.writes, []);
    } finally {
      s.broker.close();
    }
  });
}

test('unknown/future owner and renderer MCP/delegate requests remain denied', async () => {
  const s = brokerFixture();
  try {
    await s.open();
    for (const action of ['attach', 'input', 'stop', 'delegate', 'authorizeMcp'])
      assert.equal(
        (
          await s.send(action, {
            instanceId: randomUUID(),
            ...(action === 'stop' ? { signal: 'SIGTERM' } : {}),
          })
        ).status,
        'denied',
      );
    assert.deepEqual(s.signals, []);
  } finally {
    s.broker.close();
  }
});

test('uncertain write transport never renews a lease to replay the possibly consumed input', async () => {
  let native: TerminalSupervisor;
  const s = brokerFixture((supervisor) => {
    native = supervisor;
    return new Proxy(supervisor, {
      get(target, key) {
        if (key === 'write')
          return (...args: Parameters<TerminalSupervisor['write']>) => {
            native.write(...args);
            throw new Error('Synthetic reply lost');
          };
        const value: unknown = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  });
  try {
    const id = await s.open();
    assert.equal(
      (await s.send('write', { instanceId: id, sequence: 0, text: 'once' })).status,
      'denied',
    );
    s.advance();
    s.broker.revokeInput();
    assert.equal(
      (await s.send('write', { instanceId: id, sequence: 0, text: 'once' })).status,
      'denied',
    );
    assert.equal(
      (await s.send('write', { instanceId: id, sequence: 1, text: 'again' })).status,
      'denied',
    );
    assert.deepEqual(s.writes, ['once']);
  } finally {
    s.broker.close();
  }
});

test('revoked CLI trust still permits user Stop and owned retirement with a Core exit receipt', async () => {
  const s = brokerFixture();
  const keys = generateKeyPairSync('ed25519');
  try {
    const id = await s.open();
    s.revoke();
    assert.equal((await s.send('stop', { instanceId: id, signal: 'SIGTERM' })).status, 'ok');
    s.events.get('0')!.exit(0);
    const snapshot = s.authority.epoch;
    const evidence = {
      epoch: snapshot,
      attempts: [
        { slot: 0, instanceId: id, epoch: snapshot, state: 'exited', exit: { exitCode: 0 } },
      ],
    };
    const authority = new TerminalAuthority(
      new Map([['desktop-managed', keys.publicKey]]),
      Date.now,
    );
    const proofEvidence = {
      ...evidence,
      epoch: authority.epoch,
      attempts: evidence.attempts.map((a) => ({ ...a, epoch: authority.epoch })),
    };
    let retired = false;
    const retirement = new TauriTerminalRetirement(
      {
        prepareRetire: async () => ({
          evidence: proofEvidence,
          challenge: authority.prepare('desktop-managed', {
            operation: 'retire',
            target: authority.epoch,
            digest: terminalDigest(JSON.stringify(proofEvidence)),
          }),
        }),
        retire: async (proof) => {
          authority.consume(proof, {
            operation: 'retire',
            target: authority.epoch,
            digest: terminalDigest(JSON.stringify(proofEvidence)),
          });
          retired = true;
        },
        closeAndWait: async () => {},
      },
      keys.privateKey,
    );
    assert.equal(
      await retirement.run({
        current: () => true,
        confirm: async () => {
          throw new Error('Retire dialog forbidden');
        },
        authorizeOwnedRetirement: (e) =>
          e.attempts.every((a) => s.broker.ownsRetirementAttempt(a.instanceId)),
        closeBrokers: () => s.broker.close(),
      }),
      'retired',
    );
    assert.equal(retired, true);
  } finally {
    s.broker.close();
  }
});

test('installed owned-retirement port denies invalid evidence inline and never falls back to a dialog', async () => {
  const keys = generateKeyPairSync('ed25519');
  const authority = new TerminalAuthority(new Map([['desktop-managed', keys.publicKey]]), Date.now);
  const evidence = {
    epoch: authority.epoch,
    attempts: [{ slot: 0, instanceId: randomUUID(), epoch: authority.epoch, state: 'exited' }],
  };
  let confirmed = false;
  let retired = false;
  const retirement = new TauriTerminalRetirement(
    {
      prepareRetire: async () => ({
        evidence,
        challenge: authority.prepare('desktop-managed', {
          operation: 'retire',
          target: authority.epoch,
          digest: terminalDigest(JSON.stringify(evidence)),
        }),
      }),
      retire: async () => {
        retired = true;
      },
      closeAndWait: async () => {},
    },
    keys.privateKey,
  );
  assert.equal(
    await retirement.run({
      current: () => true,
      confirm: async () => {
        confirmed = true;
        return true;
      },
      authorizeOwnedRetirement: () => true,
      closeBrokers: () => {},
    }),
    'denied',
  );
  assert.equal(confirmed, false);
  assert.equal(retired, false);
});

test('production service policy port shows one compact CLI review across two native-owned slots', async () => {
  const s = policyFixture();
  const keys = generateKeyPairSync('ed25519');
  const messages: Array<Record<string, unknown>> = [];
  let starts = 0;
  const supervisors = [0, 1].map(
    () =>
      new TerminalSupervisor(
        new TerminalAuthority(new Map([['desktop-managed', keys.publicKey]]), Date.now),
        {
          validate: () => true,
          start: (_profile, events) => {
            starts++;
            events.started();
            return { write() {}, resize() {}, signal() {}, dispose() {} };
          },
        },
        [s.selected],
      ),
  );
  const service = new TauriTerminalService(
    supervisors,
    keys,
    (message) => messages.push(message as Record<string, unknown>),
    (key) => key,
    undefined,
    undefined,
    s.store,
  );
  try {
    const first = randomUUID();
    const pending = service.receive({
      kind: 'request',
      id: first,
      slot: 0,
      focused: true,
      request: { version: 1, action: 'open', profileId: profile.id },
    });
    await setImmediate();
    const confirmation = messages.find((m) => m.kind === 'confirm');
    assert.ok(confirmation);
    assert.equal(confirmation.approve, 'terminalNative.authorizeCli');
    assert.equal(confirmation.message, 'terminalNative.cliScope');
    await service.receive({ kind: 'confirm', id: confirmation.id, accepted: true });
    await pending;
    const reply = messages.find((m) => m.id === first)?.value;
    assert.equal(Reflect.get(reply as object, 'opening'), 'ready');
    const second = randomUUID();
    await service.receive({
      kind: 'request',
      id: second,
      slot: 1,
      focused: true,
      request: { version: 1, action: 'open', profileId: profile.id },
    });
    assert.equal(
      Reflect.get(messages.find((m) => m.id === second)?.value as object, 'opening'),
      'ready',
    );
    assert.equal(messages.filter((m) => m.kind === 'confirm').length, 1);
    assert.equal(starts, 2);
  } finally {
    service.close();
    s.cleanup();
  }
});

test('replacing an executable with identical bytes retains durable CLI authorization and epoch', async () => {
  const s = policyFixture();
  try {
    await s.store.authorizeCli(s.selected, async () => true);
    const epoch = s.store.epoch(s.selected);
    const bytes = readFileSync(s.selected.executable);
    rmSync(s.selected.executable);
    writeFileSync(s.selected.executable, bytes, { mode: 0o700 });
    assert.equal(s.store.current(s.selected), 'allowed');
    assert.equal(
      await s.store.authorizeCli(s.selected, async () => {
        throw new Error('Identity is not policy');
      }),
      'allowed',
    );
    assert.equal(s.store.epoch(s.selected), epoch);
  } finally {
    s.cleanup();
  }
});

// The focus loss happens after the renewal RPC was requested, before the fresh proof/effect.
test('lease reacquisition rechecks native focus after asynchronous Core preparation', async () => {
  let loseFocus = () => {};
  const s = brokerFixture(
    (supervisor) =>
      new Proxy(supervisor, {
        get(target, key) {
          if (key === 'requestInput')
            return async (...args: Parameters<TerminalSupervisor['requestInput']>) => {
              const challenge = target.requestInput(...args);
              loseFocus();
              return challenge;
            };
          const value: unknown = Reflect.get(target, key);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      }),
  );
  try {
    const id = await s.open();
    s.advance();
    loseFocus = () => {
      s.focus(false);
      s.broker.revokeInput();
    };
    assert.equal(
      (await s.send('write', { instanceId: id, sequence: 0, text: 'background' })).status,
      'denied',
    );
    assert.deepEqual(s.writes, []);
    loseFocus = () => {};
    s.focus(true);
    assert.equal(
      (await s.send('write', { instanceId: id, sequence: 0, text: 'focused' })).status,
      'ok',
    );
    assert.deepEqual(s.writes, ['focused']);
    assert.equal(s.reviews(), 1);
  } finally {
    s.broker.close();
  }
});

test('trusted CLI Stop still requires the current native document and focus, and never signals in background', async () => {
  const s = brokerFixture();
  try {
    const id = await s.open();
    s.focus(false);
    s.broker.revokeInput();
    assert.equal((await s.send('stop', { instanceId: id, signal: 'SIGTERM' })).status, 'denied');
    assert.deepEqual(s.signals, []);
    s.focus(true);
    assert.equal((await s.send('stop', { instanceId: id, signal: 'SIGTERM' })).status, 'ok');
    assert.deepEqual(s.signals, ['SIGTERM']);
    assert.equal(s.reviews(), 1);
  } finally {
    s.broker.close();
  }
});
