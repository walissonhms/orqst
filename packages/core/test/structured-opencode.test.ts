import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { reviewedProviderMcpBinaries } from '../src/terminal/provider-mcp-config.js';
import { terminalExecutableSha256 } from '../src/terminal/codex-profile.js';
import { processTransport } from '../src/structured-agents/codex-process.js';
import { OwnedOpenCode } from '../src/structured-agents/opencode-process.js';
import { StructuredAgents } from '../src/structured-agents/service.js';

const scope = { workspaceId: 'a'.repeat(64), featureId: randomUUID() };
const other = { ...scope, featureId: randomUUID() };
const fixture = fileURLToPath(new URL('./fixtures/structured-opencode.mjs', import.meta.url));
const codexFixture = fileURLToPath(new URL('./fixtures/structured-codex.mjs', import.meta.url));
const env = {
  PATH: '/usr/bin:/bin',
  OPENCODE_PASSWORD: 'synthetic-not-forwarded',
  OPENCODE_SERVER_PASSWORD: 'synthetic-not-forwarded',
  OPENCODE_CONFIG_CONTENT: '{}',
  OPENCODE_CONFIG_DIR: '/synthetic/config-override',
  OPENCODE_DB: '/synthetic/db-override',
  OPENAI_API_KEY: 'synthetic-not-forwarded',
  OTEL_EXPORTER_OTLP_ENDPOINT: 'https://example.invalid',
  OTEL_EXPORTER_OTLP_HEADERS: 'synthetic-not-forwarded',
};

async function until(check: () => boolean) {
  const deadline = Date.now() + 4000;
  while (!check()) {
    if (Date.now() >= deadline) assert.fail('Timed out waiting for OpenCode evidence');
    await sleep(10);
  }
}

async function harness(t: TestContext, binary?: string) {
  const cwd = await realpath(await mkdtemp(join(tmpdir(), 'orqst-test-opencode-')));
  const executable = binary ?? join(cwd, 'fake-opencode');
  const directories = {
    HOME: join(cwd, 'home'),
    TMPDIR: join(cwd, 'temp'),
    XDG_CONFIG_HOME: join(cwd, 'config'),
    XDG_DATA_HOME: join(cwd, 'data'),
    XDG_STATE_HOME: join(cwd, 'state'),
    XDG_CACHE_HOME: join(cwd, 'cache'),
  };
  if (!binary) {
    await writeFile(
      executable,
      '#!/bin/sh\nexec ' +
        JSON.stringify(process.execPath) +
        ' ' +
        JSON.stringify(fixture) +
        ' "$@"\n',
      { mode: 0o700 },
    );
  }
  const launch = {
    executable,
    cwd,
    env: binary ? process.env : { ...env, ...directories },
    provider: 'opencode' as const,
  };
  const servers: OwnedOpenCode[] = [];
  const service = new StructuredAgents(
    () =>
      processTransport(
        spawn(process.execPath, [codexFixture], {
          cwd,
          env,
          stdio: ['pipe', 'pipe', 'ignore'],
          detached: true,
        }),
      ),
    Date.now,
    (input) => {
      const server = new OwnedOpenCode(input);
      servers.push(server);
      return server;
    },
  );
  t.after(async () => {
    await service.close();
    await rm(cwd, { recursive: true, force: true });
  });
  async function start(label: string) {
    assert.deepEqual(
      await service.apply(scope, { action: 'start', label, provider: 'opencode' }, launch),
      { status: 'ok' },
    );
    return service.snapshot(scope).sessions.at(-1)!.sessionId;
  }
  async function startCodex() {
    assert.deepEqual(
      await service.apply(
        scope,
        { action: 'start', label: 'Codex fixture' },
        {
          executable: process.execPath,
          cwd,
          env,
        },
      ),
      { status: 'ok' },
    );
    return service.snapshot(scope).sessions.at(-1)!.sessionId;
  }
  return {
    service,
    servers,
    launch,
    directories,
    start,
    startCodex,
    session: (id: string) =>
      service.snapshot(scope).sessions.find((value) => value.sessionId === id)!,
  };
}

type Trace = {
  prompts: string[];
  peerRosters: Array<Array<{ sessionId: string; provider: string; busy: boolean }>>;
  returned: string[];
  decisions: string[];
  replays: number;
  child: number;
  directories: Record<string, string>;
};
const trace = async (server: OwnedOpenCode) => (await server.json('/synthetic-trace')) as Trace;

test('synthetic OpenCode inherits the supplied roots and preserves provider files on stop', async (t) => {
  const { directories, service, session, servers, start } = await harness(t);
  const files = [directories.XDG_DATA_HOME, directories.XDG_CACHE_HOME].map((root) =>
    join(root, 'provider-data-sentinel'),
  );
  for (const root of Object.values(directories)) await mkdir(root);
  for (const path of files) await writeFile(path, 'existing provider data');
  const sessionId = await start('OpenCode with user storage');
  assert.deepEqual((await trace(servers[0]!)).directories, directories);
  await service.apply(scope, { action: 'stop', sessionId });
  assert.deepEqual(session(sessionId).exit, { code: 0, signal: null });
  for (const path of files) assert.equal(await readFile(path, 'utf8'), 'existing provider data');
});

test('synthetic OpenCode uses native XDG defaults for unset or nonabsolute overrides', async (t) => {
  const { launch, servers, start, directories } = await harness(t);
  launch.env = { ...env, HOME: directories.HOME, XDG_CONFIG_HOME: '', XDG_DATA_HOME: 'relative' };
  await start('OpenCode with XDG defaults');
  assert.deepEqual((await trace(servers[0]!)).directories, { HOME: directories.HOME });
});

test('OpenCode spawn failure leaves the exit unproved and preserves provider files', async (t) => {
  const { launch, service, directories } = await harness(t);
  await mkdir(directories.XDG_DATA_HOME);
  const path = join(directories.XDG_DATA_HOME, 'provider-data-sentinel');
  await writeFile(path, 'existing provider data');
  launch.executable = join(launch.cwd, 'missing-opencode');
  await assert.rejects(
    service.apply(scope, { action: 'start', provider: 'opencode', label: 'Spawn failure' }, launch),
    { reason: 'provider_connection_failed' },
  );
  const [failed] = service.snapshot(scope).sessions;
  assert.equal(failed?.lifecycle, 'failed');
  assert.equal(failed?.exit, null);
  assert.equal(await readFile(path, 'utf8'), 'existing provider data');
});

test(
  'synthetic OpenCode denies access without Basic Auth and projects prompts, one-use decisions, and interruption',
  { timeout: 15_000 },
  async (t) => {
    const { service, session, servers, start } = await harness(t);
    const sessionId = await start('OpenCode fixture');
    const server = servers[0]!;
    assert.equal(session(sessionId).provider, 'opencode');
    assert.deepEqual(service.snapshot(other).sessions, []);
    for (const [text, decision, wire] of [
      ['permission once', 'accept', 'once'],
      ['permission reject', 'decline', 'reject'],
    ] as const) {
      await service.apply(scope, { action: 'turn', sessionId, text });
      await until(() =>
        session(sessionId).approvals.some((approval) => approval.state === 'pending'),
      );
      const approval = session(sessionId).approvals.find((entry) => entry.state === 'pending')!;
      assert.equal(approval.kind, 'permission');
      assert.ok(!(await trace(server)).decisions.includes(wire));
      const request = {
        action: 'approval',
        sessionId,
        approvalId: approval.approvalId,
        decision,
      } as const;
      assert.deepEqual(await service.apply(other, request), { status: 'denied' });
      await service.apply(scope, request);
      assert.deepEqual(await service.apply(scope, request), { status: 'denied' });
      await until(() => session(sessionId).turn?.state === 'completed');
      assert.ok((await trace(server)).decisions.includes(wire));
      assert.equal(session(sessionId).items.at(-1)?.text, wire);
      assert.equal(session(sessionId).reportedModel, 'synthetic/fake');
    }
    await service.apply(scope, { action: 'turn', sessionId, text: 'stream' });
    await until(() => session(sessionId).items.at(-1)?.status === 'in_progress');
    assert.equal(session(sessionId).items.at(-1)?.text, 'partial text');
    await until(() => session(sessionId).turn?.state === 'completed');
    assert.equal(session(sessionId).items.at(-1)?.text, 'final text');
    await service.apply(scope, { action: 'turn', sessionId, text: 'interrupt' });
    await until(() => session(sessionId).turn?.state === 'running');
    await service.apply(scope, { action: 'interrupt', sessionId });
    assert.equal(session(sessionId).turn?.state, 'running');
    await until(() => session(sessionId).turn?.state === 'interrupted');
    assert.equal(session(sessionId).lifecycle, 'ready');

    await service.apply(scope, { action: 'turn', sessionId, text: 'spawn child' });
    await until(() => session(sessionId).turn?.state === 'completed');
    const { child } = await trace(server);
    assert.ok(child > 0);
    await service.apply(scope, { action: 'stop', sessionId });
    assert.deepEqual(session(sessionId).exit, { code: 0, signal: null });
    assert.throws(() => process.kill(server.pid!, 0), { code: 'ESRCH' });
    await until(() => {
      try {
        process.kill(child, 0);
        return false;
      } catch (error) {
        assert.equal((error as NodeJS.ErrnoException).code, 'ESRCH');
        return true;
      }
    });
  },
);

test(
  'synthetic SSE loss reconciles durable evidence and retains unknown outcomes without resending',
  { timeout: 15_000 },
  async (t) => {
    const { service, session, servers, start } = await harness(t);
    const sessionId = await start('Recoverable');
    await service.apply(scope, { action: 'turn', sessionId, text: 'reconcile' });
    await until(() => session(sessionId).turn?.state === 'completed' && !session(sessionId).busy);
    assert.equal(session(sessionId).items.at(-1)?.text, 'recorded while disconnected');
    const recovered = await trace(servers[0]!);
    assert.deepEqual(recovered.prompts, ['reconcile']);
    assert.equal(recovered.replays, 1);
    for (const text of ['unknown', 'unbound history']) {
      const uncertain = text === 'unknown' ? sessionId : await start(text);
      await service.apply(scope, { action: 'turn', sessionId: uncertain, text });
      await until(() => session(uncertain).lifecycle === 'failed');
      assert.equal(session(uncertain).turn?.state, 'unknown');
      assert.deepEqual(await service.apply(scope, { action: 'turn', sessionId: uncertain, text }), {
        status: 'denied',
      });
    }
  },
);

test(
  'synthetic Core grant binds the exact OpenCode A to B to A task and consumes the authorization',
  { timeout: 15_000 },
  async (t) => {
    const { service, session, servers, start } = await harness(t);
    const sourceSessionId = await start('A');
    const targetSessionId = await start('B');
    const task = 'Read the synthetic project';
    const grant = { action: 'grant', sourceSessionId, targetSessionId, task } as const;
    assert.deepEqual(await service.apply(other, grant), { status: 'denied' });
    assert.deepEqual(await service.apply(scope, grant), { status: 'ok' });
    const turn = (text: string) =>
      service.apply(scope, { action: 'turn', sessionId: sourceSessionId, text });
    await turn('forged task');
    await until(
      () => session(sourceSessionId).turn?.state === 'completed' && !session(sourceSessionId).busy,
    );
    assert.deepEqual((await trace(servers[1]!)).prompts, []);
    await turn('request authorized delegation');
    await until(() => service.snapshot(scope).delegations[0]?.state === 'returned');
    await until(() => session(sourceSessionId).items.at(-1)?.text === 'final source answer');
    assert.deepEqual((await trace(servers[1]!)).prompts, [task]);
    assert.match(
      (await trace(servers[0]!)).returned[0]!,
      /untrustedWorkerResult.*synthetic result/,
    );
    await turn('request authorized delegation again');
    await until(
      () => session(sourceSessionId).turn?.state === 'completed' && !session(sourceSessionId).busy,
    );
    assert.deepEqual((await trace(servers[1]!)).prompts, [task]);
  },
);

test(
  'synthetic mixed routes use the same Core grant in both directions',
  { timeout: 15_000 },
  async (t) => {
    const { service, session, servers, start, startCodex } = await harness(t);
    const openCode = await start('OpenCode fixture');
    const codex = await startCodex();
    const task = 'Exact mixed-provider task';
    for (const [sourceSessionId, targetSessionId] of [
      [codex, openCode],
      [openCode, codex],
    ] as const) {
      assert.deepEqual(
        await service.apply(scope, { action: 'grant', sourceSessionId, targetSessionId, task }),
        { status: 'ok' },
      );
      const text =
        sourceSessionId === codex
          ? 'delegate:' + JSON.stringify({ targetPaneId: targetSessionId, task })
          : 'request the authorized mixed delegation';
      await service.apply(scope, { action: 'turn', sessionId: sourceSessionId, text });
      await until(() => service.snapshot(scope).delegations.at(-1)?.state === 'returned');
      await until(
        () =>
          session(sourceSessionId).turn?.state === 'completed' && !session(sourceSessionId).busy,
      );
    }
    const wire = await trace(servers[0]!);
    assert.equal(wire.prompts.filter((text) => text === task).length, 1);
    assert.deepEqual(
      wire.peerRosters.map((roster) =>
        roster.map(({ sessionId, provider, busy }) => ({
          sessionId,
          provider,
          busy,
        })),
      ),
      [
        [{ sessionId: codex, provider: 'codex', busy: true }],
        [{ sessionId: codex, provider: 'codex', busy: false }],
      ],
    );
    assert.equal(wire.returned.length, 1);
    assert.match(wire.returned[0]!, /untrustedWorkerResult.*Exact mixed-provider task/);
  },
);

const real = process.env.ORQST_STRUCTURED_REAL_OPENCODE;
test(
  'pinned OpenCode smoke with inherited HOME/XDG and no model turn',
  { skip: !real, timeout: 75_000 },
  async (t) => {
    const executable = await realpath(real!);
    assert.equal(terminalExecutableSha256(executable), reviewedProviderMcpBinaries.opencode.sha256);
    const { launch, service, session, servers, start } = await harness(t, executable);
    const sessionId = await start('OpenCode storage smoke');
    const server = servers[0]!;
    assert.equal(session(sessionId).lifecycle, 'ready');
    const threadId = encodeURIComponent(session(sessionId).threadId!);
    const path = '/api/session/' + threadId;
    const feed = server.events('/api/event', AbortSignal.timeout(8000));
    try {
      assert.equal(((await feed.next()).value as { type?: string }).type, 'server.connected');
    } finally {
      await feed.return(undefined);
    }
    const observed = (await server.json(path)) as {
      data: { time: { created: number; busy?: number } };
    };
    assert.equal(typeof observed.data.time.created, 'number');
    assert.equal(observed.data.time.busy, undefined);
    const messages = (await server.json(path + '/message?order=desc&limit=32')) as {
      data: unknown[];
    };
    assert.deepEqual(messages.data, []);
    const log = '/api/experimental/session/' + threadId + '/log';
    let synced = false;
    for await (const event of server.events(log, AbortSignal.timeout(8000))) {
      if ((event as { type?: string }).type === 'log.synced') synced = true;
    }
    assert.equal(synced, true);
    assert.equal(session(sessionId).turn, null);
    await service.close();
    assert.deepEqual(session(sessionId).exit, { code: 0, signal: null });
    assert.throws(() => process.kill(server.pid!, 0), { code: 'ESRCH' });

    const reopened = new OwnedOpenCode(launch);
    try {
      await reopened.verify();
      const stored = (await reopened.json(path)) as { data: { id: string } };
      assert.equal(stored.data.id, session(sessionId).threadId);
    } finally {
      assert.deepEqual(await reopened.terminate(), { code: 0, signal: null });
    }
  },
);
