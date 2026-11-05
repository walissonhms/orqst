// Shared signed broker tests with synthetic in-memory supervisors; no Electron types.
import assert from 'node:assert/strict';
import test from 'node:test';
import { terminalNativeRequestSchema } from '@orqst/protocol';
import type { TerminalNativeSupervisor } from '../packages/core/src/terminal/native-broker.js';
import type { TerminalSupervisor } from '../packages/core/src/terminal/supervisor.js';
import { terminalBrokerFixture as setup } from './helpers/terminal-broker.js';

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

test('revoked write is busy during an in-flight snapshot, then denied without queue or bytes', async () => {
  let hold = false;
  let release: () => void = () => {};
  let requested: () => void = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const reading = new Promise<void>((resolve) => {
    requested = resolve;
  });
  const s = setup(
    (supervisor) =>
      new Proxy(supervisor, {
        get(target, property) {
          if (property === 'snapshot')
            return async (...args: Parameters<TerminalSupervisor['snapshot']>) => {
              if (hold) {
                requested();
                await pending;
              }
              return target.snapshot(...args);
            };
          const value: unknown = Reflect.get(target, property);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      }) as unknown as TerminalNativeSupervisor,
  );
  const instanceId = await s.start();
  await s.input(instanceId);
  const confirmations = s.confirmations.length;
  hold = true;
  const snapshot = s.send('snapshot', { instanceId });
  await reading;
  s.broker.revokeInput();
  const write = { instanceId, sequence: 0, text: 'SYNTHETIC-MUST-NOT-ARRIVE' };
  assert.equal((await s.send('write', write)).status, 'busy');
  assert.deepEqual(s.writes, []);
  release();
  assert.equal((await snapshot).status, 'ok');
  assert.equal((await s.send('write', write)).status, 'denied');
  assert.deepEqual(s.writes, []);
  assert.equal(s.confirmations.length, confirmations);
  s.supervisor.shutdown();
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

test('native blur during asynchronous input grant revokes the returned lease before reuse', async () => {
  let release: () => void = () => {};
  let granted: () => void = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const requested = new Promise<void>((resolve) => {
    granted = resolve;
  });
  const s = setup(
    (supervisor) =>
      new Proxy(supervisor, {
        get(target, property) {
          if (property === 'enableInput')
            return async (...args: Parameters<TerminalSupervisor['enableInput']>) => {
              const lease = target.enableInput(...args);
              granted();
              await pending;
              return lease;
            };
          const value: unknown = Reflect.get(target, property);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      }) as unknown as TerminalNativeSupervisor,
  );
  const instanceId = await s.start();
  assert.equal((await s.send('attach', { instanceId })).status, 'ok');
  const enabling = s.send('input', { instanceId });
  await requested;
  s.broker.revokeInput();
  release();
  assert.equal((await enabling).status, 'denied');
  assert.equal(
    (await s.send('write', { instanceId, sequence: 0, text: 'must not arrive' })).status,
    'denied',
  );
  assert.deepEqual(s.writes, []);
  s.supervisor.shutdown();
});

test('owned-sheet suspension revokes input without granting or renewing signed authority', async () => {
  const s = setup();
  s.answer(async () => {
    s.broker.suspendInput();
    return true;
  });
  const instanceId = await s.start();
  await s.input(instanceId);
  s.broker.suspendInput();
  assert.equal(
    (await s.send('write', { instanceId, sequence: 0, text: 'blocked' })).status,
    'denied',
  );
  assert.deepEqual(s.writes, []);
  assert.equal((await s.send('input', { instanceId })).status, 'ok');
  assert.equal((await s.send('write', { instanceId, sequence: 0, text: 'explicit' })).status, 'ok');
  assert.deepEqual(s.writes, ['explicit']);
  assert.equal(s.starts(), 1);
  s.supervisor.shutdown();
});

for (const invalidation of ['cancel', 'blur', 'expiry'] as const) {
  test(`owned-sheet suspension preserves ${invalidation} denial and the original proof deadline`, async () => {
    const s = setup();
    s.answer(async () => {
      s.broker.suspendInput();
      if (invalidation === 'blur') s.broker.revokeInput();
      if (invalidation === 'expiry') s.advance();
      return invalidation !== 'cancel';
    });
    assert.equal(
      (await s.send('start', { profileId: 'synthetic' })).status,
      invalidation === 'cancel' ? 'cancelled' : 'denied',
    );
    assert.equal(s.starts(), 0);
    s.supervisor.shutdown();
  });
}

test('native Open reviews the concrete profile once and signs separate start, attach and input challenges', async () => {
  const s = setup();
  const reply = await s.send('open', { profileId: 'synthetic' });
  assert.equal(reply.status, 'ok');
  if (reply.status !== 'ok') throw new Error('Expected synthetic open');
  assert.equal(reply.opening, 'ready');
  assert.equal(s.starts(), 1);
  assert.deepEqual(
    s.confirmations.map(({ operation }) => operation),
    ['open'],
  );
  assert.deepEqual(s.confirmations[0]!.profile.argv, ['/synthetic/fixture']);
  assert.equal(
    (await s.send('write', { instanceId: reply.instanceId, sequence: 0, text: 'x' })).status,
    'ok',
  );
  assert.deepEqual(s.writes, ['x']);
  assert.deepEqual(s.signals, []);
});

for (const stage of ['launch', 'requestAttach', 'attach', 'requestInput', 'enableInput'] as const) {
  test(`native Open preserves its attempt and revokes grants after focus loss during ${stage}`, async () => {
    let loseFocus = () => {};
    const s = setup(
      (supervisor) =>
        new Proxy(supervisor, {
          get(target, property) {
            const value: unknown = Reflect.get(target, property);
            if (property === stage)
              return async (...args: unknown[]) => {
                const result: unknown = await Reflect.apply(
                  value as (...args: unknown[]) => unknown,
                  target,
                  args,
                );
                loseFocus();
                return result;
              };
            return typeof value === 'function' ? value.bind(target) : value;
          },
        }) as unknown as TerminalNativeSupervisor,
    );
    loseFocus = () => {
      s.focus(false);
      s.broker.revokeInput();
    };
    const reply = await s.send('open', { profileId: 'synthetic' });
    assert.equal(reply.status, 'ok');
    if (reply.status !== 'ok') throw new Error('Expected retained synthetic attempt');
    assert.equal(reply.opening, 'incomplete');
    assert.equal(s.starts(), 1);
    assert.deepEqual(s.signals, []);
    s.focus(true);
    assert.equal(
      (await s.send('write', { instanceId: reply.instanceId, sequence: 0, text: 'never' })).status,
      'denied',
    );
    assert.deepEqual(s.writes, []);
    assert.equal(s.disposed(), 0);
  });
}

test('native Open cancellation and expired consent never start a process', async () => {
  for (const expired of [false, true]) {
    const s = setup();
    s.answer(async () => {
      if (expired) s.advance();
      return expired;
    });
    assert.equal(
      (await s.send('open', { profileId: 'synthetic' })).status,
      expired ? 'denied' : 'cancelled',
    );
    assert.equal(s.starts(), 0);
    assert.deepEqual(s.signals, []);
  }
});

for (const fault of ['blur', 'throw', 'expiry'] as const) {
  test(`native Open keeps the attempt and cannot report ready after final snapshot ${fault}`, async () => {
    let invalidate = () => {};
    const s = setup(
      (supervisor) =>
        new Proxy(supervisor, {
          get(target, property) {
            if (property === 'snapshot')
              return async (id: string) => {
                const snapshot = target.snapshot(id);
                invalidate();
                if (fault === 'throw') throw new Error('SYNTHETIC unavailable snapshot');
                return snapshot;
              };
            const value: unknown = Reflect.get(target, property);
            return typeof value === 'function' ? value.bind(target) : value;
          },
        }) as unknown as TerminalNativeSupervisor,
    );
    invalidate = () => (fault === 'expiry' ? s.advance() : s.focus(false));
    const reply = await s.send('open', { profileId: 'synthetic' });
    assert.equal(reply.status, 'ok');
    if (reply.status !== 'ok') throw new Error('Expected retained attempt');
    assert.equal(reply.opening, 'incomplete');
    assert.ok(reply.instanceId);
    assert.equal(reply.snapshot, undefined);
    assert.equal(s.starts(), 1);
    s.focus(true);
    assert.equal(
      (await s.send('write', { instanceId: reply.instanceId, sequence: 0, text: 'never' })).status,
      'denied',
    );
    assert.deepEqual(s.signals, []);
  });
}

test('fresh attach and input challenges never renew the combined native consent deadline', async () => {
  for (const stage of ['requestAttach', 'requestInput'] as const) {
    let expire = () => {};
    const s = setup(
      (supervisor) =>
        new Proxy(supervisor, {
          get(target, property) {
            const value: unknown = Reflect.get(target, property);
            if (property === stage)
              return async (...args: unknown[]) => {
                expire(); // The new challenge itself will still have a fresh expiry.
                return Reflect.apply(value as (...args: unknown[]) => unknown, target, args);
              };
            return typeof value === 'function' ? value.bind(target) : value;
          },
        }) as unknown as TerminalNativeSupervisor,
    );
    expire = s.advance;
    const reply = await s.send('open', { profileId: 'synthetic' });
    assert.equal(reply.status, 'ok');
    if (reply.status !== 'ok') throw new Error('Expected retained attempt');
    assert.equal(reply.opening, 'incomplete');
    assert.equal(s.starts(), 1);
    assert.equal(
      (await s.send('write', { instanceId: reply.instanceId, sequence: 0, text: 'never' })).status,
      'denied',
    );
    assert.deepEqual(s.signals, []);
  }
});
