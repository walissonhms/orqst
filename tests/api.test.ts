import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { Store } from '@orqst/database';
import { createLocalServer } from '../apps/bridge/src/server.js';
import { meta, normalized, record } from './fixtures.js';
import type { StreamMessage } from '@orqst/protocol';

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'orqst-api-'));
  await writeFile(join(dir, 'index.html'), '<!doctype html><title>Synthetic dashboard</title>');
  const store = new Store(':memory:');
  const app = createLocalServer(
    store,
    {
      port: 0,
      dataDir: dir,
      sessionsDir: dir,
      dashboardDir: dir,
      retentionDays: 30,
      pollMs: 1000,
      dev: false,
    },
    {
      diagnostics: {
        files: 0,
        malformed: 0,
        skipped: 0,
        oversized: 0,
        errors: 0,
        lastScan: null,
        scanning: false,
      },
    },
  );
  const port = await app.listen(),
    base = `http://127.0.0.1:${port}`;
  const response = await fetch(base + '/api/bootstrap');
  const cookie = response.headers.get('set-cookie')!.split(';')[0]!;
  return {
    app,
    store,
    base,
    cookie,
    port,
    close: async () => {
      await app.close();
      store.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}
test('protects local API, validates origin/input, and serves only dashboard assets', async () => {
  const ctx = await setup();
  try {
    assert.equal((await fetch(ctx.base + '/api/snapshot')).status, 401);
    assert.equal(
      (
        await fetch(ctx.base + '/api/snapshot', {
          headers: { Cookie: ctx.cookie, Origin: 'https://untrusted.invalid' },
        })
      ).status,
      403,
    );
    assert.equal(
      (await fetch(ctx.base + '/api/bootstrap', { headers: { 'Sec-Fetch-Site': 'cross-site' } }))
        .status,
      403,
    );
    assert.equal(
      (
        await fetch(ctx.base + '/api/snapshot', {
          headers: { Cookie: 'orqst_session=' + 'é'.repeat(64) },
        })
      ).status,
      401,
    );
    assert.equal(
      (await fetch(ctx.base + '/api/events?after=-1', { headers: { Cookie: ctx.cookie } })).status,
      400,
    );
    assert.equal(
      (
        await fetch(ctx.base + '/api/preferences', {
          method: 'PUT',
          headers: { Cookie: ctx.cookie, 'Content-Type': 'application/json' },
          body: '{"sound":"yes"}',
        })
      ).status,
      400,
    );
    assert.equal((await fetch(ctx.base + '/.env')).status, 403);
    assert.equal(
      (await fetch(ctx.base + '/api/unknown', { headers: { Cookie: ctx.cookie } })).status,
      404,
    );
    assert.equal((await fetch(ctx.base + '/')).status, 200);
    const response = await fetch(ctx.base + '/api/snapshot', { headers: { Cookie: ctx.cookie } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.ok(response.headers.get('content-security-policy')?.includes("frame-ancestors 'none'"));
  } finally {
    await ctx.close();
  }
});
test('dashboard fallback serves only exact public routes and preserves request security', async () => {
  const ctx = await setup();
  try {
    for (const path of [
      '/',
      '/overview',
      '/workspaces',
      '/agents',
      '/models',
      '/settings',
      '/artifacts',
      '/overview/sessions/synthetic-id',
      '/overview/sessions/synthetic%20%3F%23%20sess%C3%A3o',
    ]) {
      const response = await fetch(ctx.base + path);
      assert.equal(response.status, 200, path);
      assert.equal(response.headers.get('content-type'), 'text/html; charset=utf-8');
      assert.match(await response.text(), /Synthetic dashboard/);
      assert.equal(response.headers.get('set-cookie'), null);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.ok(response.headers.get('content-security-policy')?.includes("base-uri 'none'"));
      const head = await fetch(ctx.base + path, { method: 'HEAD' });
      assert.equal(head.status, 200);
      assert.equal(await head.text(), '');
      assert.equal((await fetch(ctx.base + path, { method: 'POST' })).status, 405);
      const untrustedHeaders: Record<string, string>[] = [
        { Origin: 'https://untrusted.invalid' },
        { 'Sec-Fetch-Site': 'cross-site' },
      ];
      for (const headers of untrustedHeaders)
        assert.equal(
          (await fetch(ctx.base + path, { headers })).status,
          403,
          JSON.stringify(headers),
        );
    }
    const badHost = await new Promise<number | undefined>((resolve, reject) => {
      const request = httpRequest(
        ctx.base + '/settings',
        { headers: { Host: 'untrusted.invalid' } },
        (response) => {
          response.resume();
          resolve(response.statusCode);
        },
      );
      request.on('error', reject);
      request.end();
    });
    assert.equal(badHost, 403);
    for (const path of [
      '/arbitrary',
      '/overview/',
      '/settings/nested',
      '/artifacts/',
      '/artifacts/nested',
      '/%73ettings',
      '/overview/sessions',
      '/overview/sessions/',
      '/overview/sessions/id/extra',
      '/overview/sessions/a%2Fb',
      '/overview/sessions/a%5Cb',
      '/overview/sessions/a%252Fb',
      '/overview/sessions/%61gent',
      '/overview/sessions/' + 'x'.repeat(201),
      '/ws',
      '/assets/missing.js',
    ]) {
      const response = await fetch(ctx.base + path);
      assert.equal(response.status, 404, path);
      assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
    }
    for (const path of ['/api/missing', '/api/snapshot']) {
      assert.equal((await fetch(ctx.base + path)).status, 401);
    }
    assert.equal((await fetch(ctx.base + '/%00')).status, 403);
    assert.equal((await fetch(ctx.base + '/%')).status, 400);
  } finally {
    await ctx.close();
  }
});
test('WebSocket replays ordered events, reconnects without duplicate notifications and broadcasts live events', async () => {
  const ctx = await setup();
  let socket: WebSocket | undefined;
  try {
    const events = normalized([meta(), record('event_msg', { type: 'task_started' })]);
    events.forEach((event) => ctx.store.ingest(event));
    socket = new WebSocket(`ws://127.0.0.1:${ctx.port}/ws?after=0`, {
      headers: { Cookie: ctx.cookie, Origin: ctx.base },
    });
    const messages: StreamMessage[] = [];
    socket.on('message', (data) => messages.push(JSON.parse(data.toString()) as StreamMessage));
    await once(socket, 'open');
    const wait = async (predicate: () => boolean) => {
      const timeout = Date.now() + 2000;
      while (!predicate() && Date.now() < timeout)
        await new Promise((resolve) => setTimeout(resolve, 10));
      assert.ok(predicate());
    };
    await wait(() => messages.some((message) => message.type === 'ready'));
    assert.deepEqual(
      messages
        .filter((message) => message.type === 'event')
        .map((message) => message.type === 'event' && message.event.sequence),
      [1, 2],
    );
    assert.ok(messages.every((message) => message.type !== 'event' || !message.live));
    const stored = ctx.store.ingest(
      {
        ...events[0]!,
        id: 'live-completion',
        type: 'agent.completed',
        payload: { status: 'completed' },
      },
      true,
    )!;
    ctx.app.broadcast(stored, true);
    await wait(() => messages.some((message) => message.type === 'event' && message.live));
    assert.equal(ctx.store.notifications().length, 1);
    socket.terminate();
    await once(socket, 'close');
    socket = new WebSocket(`ws://127.0.0.1:${ctx.port}/ws?after=2`, {
      headers: { Cookie: ctx.cookie, Origin: ctx.base },
    });
    const replay: StreamMessage[] = [];
    socket.on('message', (data) => replay.push(JSON.parse(data.toString()) as StreamMessage));
    await once(socket, 'open');
    await wait(() => replay.some((message) => message.type === 'ready'));
    assert.equal(replay.filter((message) => message.type === 'event').length, 1);
    assert.ok(replay.every((message) => message.type !== 'event' || !message.live));
    assert.equal(ctx.store.notifications().length, 1);
  } finally {
    socket?.terminate();
    await ctx.close();
  }
});
test('rejects unauthenticated WebSocket connections', async () => {
  const ctx = await setup();
  try {
    const socket = new WebSocket(`ws://127.0.0.1:${ctx.port}/ws`, {
      headers: { Origin: ctx.base },
    });
    const [error] = await once(socket, 'error');
    assert.match(String(error), /403/);
  } finally {
    await ctx.close();
  }
});

test('oversized client messages close the socket without stopping the bridge', async () => {
  const ctx = await setup();
  let socket: WebSocket | undefined;
  try {
    socket = new WebSocket(`ws://127.0.0.1:${ctx.port}/ws`, {
      headers: { Cookie: ctx.cookie, Origin: ctx.base },
    });
    socket.on('error', () => {});
    await once(socket, 'open');
    const closed = once(socket, 'close');
    socket.send(Buffer.alloc(2048));
    await closed;
    const response = await fetch(ctx.base + '/api/snapshot', { headers: { Cookie: ctx.cookie } });
    assert.equal(response.status, 200);
  } finally {
    socket?.terminate();
    await ctx.close();
  }
});
