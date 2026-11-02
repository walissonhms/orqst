import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { appendFile, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { ObserverCore } from '@orqst/core';
import { CodexObserver } from '@orqst/adapter-codex';
import { Store } from '@orqst/database';
import type { Snapshot, StreamMessage } from '@orqst/protocol';
import { createBridge } from '../apps/bridge/src/app.js';
import { createLocalServer } from '../apps/bridge/src/server.js';
import type { Config } from '../apps/bridge/src/config.js';
import { meta, record, token } from './fixtures.js';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'orqst-bridge-lifecycle-'));
  const root = join(dir, 'sessions');
  await mkdir(root);
  const file = join(root, 'synthetic.jsonl');
  await writeFile(file, JSON.stringify(meta()) + '\n');
  const config: Config = {
    port: 0,
    dataDir: dir,
    sessionsDir: root,
    dashboardDir: dir,
    retentionDays: 3650,
    pollMs: 50,
    dev: false,
  };
  return { config, file, dir };
}

test('Bridge readiness includes initial import; v1 replay/live delivery survives client detachment', async () => {
  const ctx = await setup();
  const bridge = createBridge(ctx.config);
  let socket: WebSocket | undefined;
  try {
    const starting = bridge.start();
    assert.equal(bridge.start(), starting);
    const port = await starting;
    const base = `http://127.0.0.1:${port}`;
    const bootstrap = await fetch(base + '/api/bootstrap');
    assert.deepEqual(await bootstrap.json(), { version: '0.1.0', local: true });
    const cookie = bootstrap.headers.get('set-cookie')!.split(';')[0]!;
    const snapshotResponse = await fetch(base + '/api/snapshot', { headers: { Cookie: cookie } });
    const snapshot = (await snapshotResponse.json()) as Snapshot;
    assert.equal(snapshot.sessions.length, 1);
    assert.equal(snapshot.sessions[0]?.id, 'synthetic-session');
    assert.equal(bridge.core.state, 'ready');
    assert.deepEqual(Object.keys(snapshot).sort(), [
      'adapters',
      'cursor',
      'diagnostics',
      'events',
      'notifications',
      'preferences',
      'sessions',
      'workspaces',
    ]);
    socket = new WebSocket(`ws://127.0.0.1:${port}/ws?after=0`, {
      headers: { Cookie: cookie, Origin: base },
    });
    const messages: StreamMessage[] = [];
    const ready = deferred();
    socket.on('message', (data) => {
      const message = JSON.parse(data.toString()) as StreamMessage;
      messages.push(message);
      if (message.type === 'ready') ready.resolve();
    });
    await ready.promise;
    assert.deepEqual(messages.at(-1), { type: 'ready', cursor: snapshot.cursor });
    const historical = messages.filter((message) => message.type === 'event');
    assert.deepEqual(
      historical.map((message) => message.event),
      snapshot.events,
    );
    assert.ok(historical.every((message) => !message.live && message.event.schemaVersion === 1));

    const live = deferred();
    socket.on('message', (data) => {
      const message = JSON.parse(data.toString()) as StreamMessage;
      if (message.type === 'event' && message.live) live.resolve();
    });
    await appendFile(
      ctx.file,
      JSON.stringify({
        ...record('event_msg', { type: 'task_complete', last_agent_message: 'Synthetic result' }),
        timestamp: new Date().toISOString(),
      }) + '\n',
    );
    await live.promise;
    assert.equal(bridge.core.store.notifications().length, 1);
    const detached = once(socket, 'close');
    socket.terminate();
    await detached;
    assert.equal(bridge.core.state, 'ready');
    const cursor = bridge.core.store.cursor();
    await appendFile(
      ctx.file,
      JSON.stringify(
        record('token_usage_record', {
          thread_id: 'synthetic-session',
          response_id: 'synthetic-response',
          thread_token_usage: token(100, 20, 40),
        }),
      ) + '\n',
    );
    const deadline = Date.now() + 3000;
    while (bridge.core.store.cursor() === cursor && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(bridge.core.store.totals().total, 120);
    assert.equal(bridge.core.store.totals().cached, 40);

    socket = new WebSocket(`ws://127.0.0.1:${port}/ws?after=${cursor}`, {
      headers: { Cookie: cookie, Origin: base },
    });
    await once(socket, 'open');
    const disconnected = once(socket, 'close');
    const store = bridge.core.store;
    const stopping = bridge.stop();
    assert.equal(bridge.stop(), stopping);
    await stopping;
    await disconnected;
    assert.equal(bridge.core.state, 'stopped');
    assert.throws(() => store.cursor());
    await assert.rejects(fetch(base + '/api/bootstrap'));
    await assert.rejects(bridge.start(), /cannot be restarted/);
  } finally {
    socket?.terminate();
    await bridge.stop();
    await rm(ctx.dir, { recursive: true, force: true });
  }
});

test('Bridge awaits the controlled first scan and stays ready during a later periodic scan', async (t) => {
  const ctx = await setup();
  const firstEntered = deferred();
  const firstRelease = deferred();
  const periodicEntered = deferred();
  const periodicRelease = deferred();
  const periodicDone = deferred();
  t.mock.timers.enable({ apis: ['setInterval'] });
  let scans = 0;
  const core = new ObserverCore(ctx.config, {
    createObserver(options) {
      const observer = new CodexObserver(options);
      const scan = observer.scan.bind(observer);
      t.mock.method(observer, 'scan', async () => {
        const first = ++scans === 1;
        observer.diagnostics.scanning = true;
        (first ? firstEntered : periodicEntered).resolve();
        await (first ? firstRelease : periodicRelease).promise;
        await scan();
        if (!first) periodicDone.resolve();
      });
      return observer;
    },
  });
  const bridge = createBridge(ctx.config, core);
  let settled = false;
  try {
    const starting = bridge.start();
    void starting.then(() => {
      settled = true;
    });
    await firstEntered.promise;
    assert.equal(core.state, 'starting');
    assert.equal(core.diagnostics.scanning, true);
    assert.equal(core.store.cursor(), 0);
    await Promise.resolve();
    assert.equal(settled, false);
    firstRelease.resolve();
    const port = await starting;
    assert.equal(settled, true);
    assert.equal(core.state, 'ready');
    assert.equal(core.diagnostics.scanning, false);
    assert.equal(core.store.sessions()[0]?.id, 'synthetic-session');
    assert.ok(core.store.cursor() > 0);

    // Trigger the actual observer's interval without a sleep or a larger pollMs.
    t.mock.timers.tick(ctx.config.pollMs);
    await periodicEntered.promise;
    assert.equal(core.diagnostics.scanning, true);
    assert.equal(core.state, 'ready');
    assert.equal(bridge.start(), starting);
    assert.equal(await bridge.start(), port);
    const base = `http://127.0.0.1:${port}`;
    const bootstrap = await fetch(base + '/api/bootstrap');
    const cookie = bootstrap.headers.get('set-cookie')!.split(';')[0]!;
    const response = await fetch(base + '/api/snapshot', { headers: { Cookie: cookie } });
    const snapshot = (await response.json()) as Snapshot;
    assert.equal(snapshot.diagnostics.scanning, true);
    assert.equal(snapshot.sessions[0]?.id, 'synthetic-session');
    assert.equal(core.state, 'ready');
    periodicRelease.resolve();
    await periodicDone.promise;
    assert.equal(core.diagnostics.scanning, false);
    assert.equal(core.state, 'ready');
  } finally {
    firstRelease.resolve();
    periodicRelease.resolve();
    await bridge.stop();
    await rm(ctx.dir, { recursive: true, force: true });
  }
});

test('port binding failure releases the Core without closing an unrelated listener', async () => {
  const ctx = await setup();
  const occupied = createServer();
  occupied.listen(0, '127.0.0.1');
  await once(occupied, 'listening');
  const address = occupied.address();
  assert.ok(address && typeof address !== 'string');
  const bridge = createBridge({ ...ctx.config, port: address.port });
  try {
    await assert.rejects(bridge.start(), { code: 'EADDRINUSE' });
    await bridge.stop();
    assert.equal(bridge.core.state, 'stopped');
    assert.throws(() => bridge.core.store, /not open/);
    assert.equal(occupied.listening, true);
    const persisted = new Store(join(ctx.dir, 'orqst.db'));
    assert.equal(persisted.cursor(), 0);
    assert.equal(persisted.checkpoint(ctx.config.sessionsDir + ':synthetic.jsonl'), undefined);
    persisted.close();
  } finally {
    await bridge.stop();
    await new Promise<void>((resolve, reject) =>
      occupied.close((error) => (error ? reject(error) : resolve())),
    );
    await rm(ctx.dir, { recursive: true, force: true });
  }
});

test('Bridge stop during Core initialization waits for cleanup and never opens a port', async () => {
  const ctx = await setup();
  const ready = deferred();
  const store = new Store(':memory:');
  const core = new ObserverCore(ctx.config, {
    openStore: () => store,
    createObserver: (config) => ({
      diagnostics: {
        files: 0,
        malformed: 0,
        skipped: 0,
        oversized: 0,
        errors: 0,
        lastScan: null,
        scanning: false,
      },
      start: () => ready.promise,
      stop: async () => {
        assert.equal(config.store.cursor(), 0);
      },
    }),
  });
  const bridge = createBridge(ctx.config, core);
  try {
    const starting = assert.rejects(bridge.start(), /stopped before becoming ready/);
    const stopping = bridge.stop();
    ready.resolve();
    await Promise.all([starting, stopping]);
    assert.equal(core.state, 'stopped');
    assert.throws(() => store.cursor());
  } finally {
    ready.resolve();
    await bridge.stop();
    await rm(ctx.dir, { recursive: true, force: true });
  }
});

test('local transport can close before listening and repeated closes share completion', async () => {
  const ctx = await setup();
  const core = new ObserverCore(ctx.config);
  try {
    await core.start();
    const api = createLocalServer(core.store, ctx.config, core);
    const closing = api.close();
    assert.equal(api.close(), closing);
    await closing;
    assert.equal(core.state, 'ready');
  } finally {
    await core.stop();
    await rm(ctx.dir, { recursive: true, force: true });
  }
});

test('periodic Core failure shuts down Bridge transports and preserves the original fault', async (t) => {
  const ctx = await setup();
  const store = new Store(':memory:');
  const core = new ObserverCore(ctx.config, {
    openStore: () => store,
    createObserver: () => ({
      diagnostics: {
        files: 0,
        malformed: 0,
        skipped: 0,
        oversized: 0,
        errors: 0,
        lastScan: null,
        scanning: false,
      },
      start: async () => {},
      stop: async () => {},
    }),
  });
  const bridge = createBridge(ctx.config, core);
  try {
    t.mock.timers.enable({ apis: ['setInterval'] });
    const port = await bridge.start();
    const failure = new Error('Synthetic retention failure');
    t.mock.method(store, 'retain', () => {
      throw failure;
    });
    t.mock.timers.tick(3600000);
    await bridge.stop();
    assert.equal(core.state, 'failed');
    assert.equal(core.failure, failure);
    assert.throws(() => store.cursor());
    await assert.rejects(fetch(`http://127.0.0.1:${port}/api/bootstrap`));
  } finally {
    await bridge.stop();
    await rm(ctx.dir, { recursive: true, force: true });
  }
});
