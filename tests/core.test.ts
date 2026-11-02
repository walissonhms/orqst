import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '@orqst/database';
import { CodexObserver, type CodexObserverOptions } from '@orqst/adapter-codex';
import { ObserverCore, type CoreDependencies, type CoreOptions } from '@orqst/core';
import { meta, normalized, record, token } from './fixtures.js';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const options: CoreOptions = {
  dataDir: '/synthetic/core-test',
  sessionsDir: '/synthetic/core-test/sessions',
  retentionDays: 3650,
  pollMs: 50,
};
const diagnostics = () => ({
  files: 0,
  malformed: 0,
  skipped: 0,
  oversized: 0,
  errors: 0,
  lastScan: null,
  scanning: false,
});

test('Core initializes once, awaits readiness, and drains observation before closing its one store', async (t) => {
  const store = new Store(':memory:');
  const close = t.mock.method(store, 'close');
  const retain = t.mock.method(store, 'retain');
  const ready = deferred();
  const drained = deferred();
  let opens = 0;
  let starts = 0;
  let stops = 0;
  const core = new ObserverCore(options, {
    openStore(file, days) {
      opens++;
      assert.equal(file, join(options.dataDir, 'orqst.db'));
      assert.equal(days, options.retentionDays);
      return store;
    },
    createObserver(config) {
      assert.equal(config.store, store);
      assert.equal(config.root, options.sessionsDir);
      assert.equal(config.pollMs, options.pollMs);
      return {
        diagnostics: diagnostics(),
        start: async () => {
          starts++;
          await ready.promise;
        },
        stop: async () => {
          stops++;
          assert.equal(close.mock.callCount(), 0);
          await drained.promise;
          assert.equal(store.cursor(), 0);
        },
      };
    },
  });
  assert.equal(core.state, 'idle');
  assert.throws(() => core.store, /not open/);
  const first = core.start();
  assert.equal(core.start(), first);
  assert.equal(core.state, 'starting');
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(retain.mock.callCount(), 1);
  ready.resolve();
  await first;
  assert.equal(core.state, 'ready');
  assert.equal(core.start(), first);
  assert.equal(core.store, store);
  const stopping = core.stop();
  assert.equal(core.stop(), stopping);
  assert.equal(core.state, 'stopping');
  assert.equal(close.mock.callCount(), 0);
  drained.resolve();
  await stopping;
  assert.equal(core.state, 'stopped');
  assert.equal(core.failure, undefined);
  assert.equal(opens, 1);
  assert.equal(starts, 1);
  assert.equal(stops, 1);
  assert.equal(close.mock.callCount(), 1);
  assert.equal(core.stop(), stopping);
  assert.throws(() => core.store, /not open/);
  await assert.rejects(core.start(), /cannot be restarted/);
});

test('stop before start opens no resources; stop during startup never reports ready', async (t) => {
  const idle = new ObserverCore(options, {
    openStore: () => assert.fail('Stopped Core must not open SQLite'),
  });
  await idle.stop();
  await assert.rejects(idle.start(), /cannot be restarted/);

  const store = new Store(':memory:');
  const close = t.mock.method(store, 'close');
  const ready = deferred();
  const core = new ObserverCore(options, {
    openStore: () => store,
    createObserver: () => ({
      diagnostics: diagnostics(),
      start: () => ready.promise,
      stop: async () => {},
    }),
  });
  const starting = core.start();
  const rejected = assert.rejects(starting, /stopped before becoming ready/);
  await new Promise<void>((resolve) => setImmediate(resolve));
  const stopping = core.stop();
  assert.equal(close.mock.callCount(), 0);
  ready.resolve();
  await Promise.all([rejected, stopping]);
  assert.equal(core.state, 'stopped');
  assert.equal(close.mock.callCount(), 1);
});

test('Core initialization opens resources without starting observation or retention', async (t) => {
  const store = new Store(':memory:');
  const retain = t.mock.method(store, 'retain');
  let starts = 0;
  const core = new ObserverCore(options, {
    openStore: () => store,
    createObserver: () => ({
      diagnostics: diagnostics(),
      start: async () => {
        starts++;
      },
      stop: async () => {},
    }),
  });
  const initializing = core.initialize();
  assert.equal(core.initialize(), initializing);
  await initializing;
  assert.equal(core.state, 'initialized');
  assert.equal(core.store, store);
  assert.equal(starts, 0);
  assert.equal(retain.mock.callCount(), 0);
  await core.stop();
  assert.equal(core.state, 'stopped');
  await assert.rejects(core.initialize(), /cannot be restarted/);
  await assert.rejects(core.start(), /cannot be restarted/);
  assert.equal(core.state, 'stopped');
});

test('initialization failures release acquired resources and preserve the original error', async (t) => {
  for (const stage of ['store', 'observer', 'retention', 'start'] as const) {
    await t.test(stage, async (t) => {
      const failure = new Error(`Synthetic ${stage} failure`);
      const store = new Store(':memory:');
      const close = t.mock.method(store, 'close');
      let stops = 0;
      const dependencies: CoreDependencies = {
        openStore: () => {
          if (stage === 'store') throw failure;
          return store;
        },
        createObserver: () => {
          if (stage === 'observer') throw failure;
          return {
            diagnostics: diagnostics(),
            start: async () => {
              if (stage === 'start') throw failure;
            },
            stop: async () => {
              stops++;
            },
          };
        },
      };
      if (stage === 'retention')
        t.mock.method(store, 'retain', () => {
          throw failure;
        });
      const core = new ObserverCore(options, dependencies);
      await assert.rejects(core.start(), (error) => error === failure);
      assert.equal(core.state, 'failed');
      assert.equal(core.failure, failure);
      await core.stop();
      assert.equal(stops, stage === 'start' || stage === 'retention' ? 1 : 0);
      assert.equal(close.mock.callCount(), stage === 'store' ? 0 : 1);
      if (stage === 'store') store.close();
      await assert.rejects(core.start(), /cannot be restarted/);
    });
  }
});

test('cleanup failures remain observable and repeated shutdown shares the same rejection', async () => {
  const store = new Store(':memory:');
  const failure = new Error('Synthetic observer shutdown failure');
  const core = new ObserverCore(options, {
    openStore: () => store,
    createObserver: () => ({
      diagnostics: diagnostics(),
      start: async () => {},
      stop: async () => {
        throw failure;
      },
    }),
  });
  await core.start();
  const stopping = core.stop();
  assert.equal(core.stop(), stopping);
  await assert.rejects(stopping, (error) => error === failure);
  assert.equal(core.failure, failure);
  assert.equal(core.state, 'failed');
  assert.throws(() => store.cursor());
});

test('retention failure reports the fault, drains clients, and stops without an unhandled rejection', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const store = new Store(':memory:');
  const failure = new Error('Synthetic periodic retention failure');
  const clientClosed = deferred();
  let observerStopped = false;
  const core = new ObserverCore(options, {
    openStore: () => store,
    createObserver: () => ({
      diagnostics: diagnostics(),
      start: async () => {},
      stop: async () => {
        observerStopped = true;
      },
    }),
  });
  core.onFailure(async (error) => {
    assert.equal(error, failure);
    await clientClosed.promise;
    assert.equal(store.cursor(), 0);
  });
  await core.start();
  const retain = t.mock.method(store, 'retain', () => {
    throw failure;
  });
  t.mock.timers.tick(3600000);
  assert.equal(core.state, 'failed');
  assert.equal(core.failure, failure);
  assert.equal(observerStopped, false);
  t.mock.timers.tick(3600000);
  assert.equal(retain.mock.callCount(), 1);
  clientClosed.resolve();
  await new Promise<void>((resolve) => setImmediate(resolve));
  await core.stop();
  assert.equal(observerStopped, true);
  assert.throws(() => store.cursor());
});

test('event subscriptions can detach without stopping the Core; listener faults cannot lose ownership', async () => {
  const store = new Store(':memory:');
  let observerOptions: CodexObserverOptions | undefined;
  const core = new ObserverCore(options, {
    openStore: () => store,
    createObserver: (config) => {
      observerOptions = config;
      return { diagnostics: diagnostics(), start: async () => {}, stop: async () => {} };
    },
  });
  await core.start();
  let received = 0;
  const unsubscribe = core.subscribe(() => received++);
  // Subscriber delivery is tested with a persisted synthetic event below.
  const event = store.ingest(normalized([meta()])[0]!)!;
  observerOptions!.onEvent!(event, false);
  unsubscribe();
  observerOptions!.onEvent!(event, true);
  assert.equal(received, 1);
  assert.equal(core.state, 'ready');
  const failure = new Error('Synthetic subscriber failure');
  core.subscribe(() => {
    throw failure;
  });
  core.onFailure(() => {
    throw new Error('Synthetic failure handler failure');
  });
  observerOptions!.onEvent!(event, true);
  assert.equal(core.failure, failure);
  await core.stop();
  assert.throws(() => store.cursor());
});

test('Core preserves legacy store identity, usage, source events, settings and checkpoints across restart', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'orqst-core-compatibility-'));
  const root = join(dir, 'sessions');
  await mkdir(root);
  const file = join(root, 'synthetic.jsonl');
  const content = [
    meta(),
    record('turn_context', { turn_id: 'synthetic-turn', model: 'synthetic-model' }),
    record('token_usage_record', {
      thread_id: 'synthetic-session',
      response_id: 'synthetic-response',
      thread_token_usage: token(100, 20, 40),
    }),
    record('event_msg', {
      type: 'token_count',
      info: { total_token_usage: token(100, 20, 40) },
    }),
    record('event_msg', { type: 'task_complete', last_agent_message: 'Synthetic result' }),
  ]
    .map((value) => JSON.stringify(value) + '\n')
    .join('');
  await writeFile(file, content);
  const database = join(dir, 'orqst.db');
  const legacy = new Store(database, 3650);
  const observer = new CodexObserver({ root, store: legacy });
  let core: ObserverCore | undefined;
  try {
    await observer.scan();
    legacy.setSetting('synthetic-setting', { preserved: true });
    const expected = {
      machineId: legacy.machineId,
      events: legacy.events(),
      sessions: legacy.sessions(),
      usage: legacy.totals(),
      checkpoint: legacy.checkpoint(root + ':synthetic.jsonl'),
    };
    await observer.stop();
    legacy.close();
    for (let index = 0; index < 2; index++) {
      core = new ObserverCore({ ...options, dataDir: dir, sessionsDir: root });
      const events: unknown[] = [];
      core.subscribe((event) => events.push(event));
      await core.start();
      assert.equal(core.store.machineId, expected.machineId);
      assert.deepEqual(core.store.events(), expected.events);
      assert.deepEqual(core.store.sessions(), expected.sessions);
      assert.deepEqual(core.store.totals(), expected.usage);
      assert.deepEqual(core.store.checkpoint(root + ':synthetic.jsonl'), expected.checkpoint);
      assert.deepEqual(core.store.setting('synthetic-setting', null), { preserved: true });
      assert.equal(core.store.notifications().length, 0);
      assert.equal(core.diagnostics.errors, 0);
      assert.equal(events.length, 0);
      assert.equal((await stat(database)).mode & 0o777, 0o600);
      assert.equal((await stat(dir)).mode & 0o777, 0o700);
      await core.stop();
    }
    assert.equal(await readFile(file, 'utf8'), content);
  } finally {
    await core?.stop();
    await observer.stop();
    if (!core) legacy.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('an absent session root keeps source availability separate from Core readiness', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'orqst-core-absent-'));
  const core = new ObserverCore({ ...options, dataDir: dir, sessionsDir: join(dir, 'absent') });
  try {
    await core.start();
    assert.equal(core.state, 'ready');
    assert.equal(core.diagnostics.lastScan, null);
    assert.equal(core.diagnostics.errors, 0);
    assert.equal(core.store.cursor(), 0);
  } finally {
    await core.stop();
    await rm(dir, { recursive: true, force: true });
  }
});
