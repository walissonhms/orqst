// Disposable synthetic Node children only: no user sessions, real CLI, credentials or services.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import {
  appendFile,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from '@orqst/database';
import type { Snapshot } from '@orqst/protocol';
import { meta, record } from './fixtures.js';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const sidecar = resolve(repositoryRoot, 'apps/bridge/src/desktop-sidecar.ts');
const readinessLimit = 30_000;

interface Fixture {
  dir: string;
  home: string;
  dataDir: string;
  sessionsDir: string;
  dashboardDir: string;
  sessionFile: string;
  sessionContent: string;
}

interface LaunchOptions {
  env?: Record<string, string | undefined>;
  dashboard?: string | null;
}

interface RunningSidecar {
  child: ChildProcess;
  stdout(): string;
  stderr(): string;
  ready: Promise<number>;
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  dispose(): Promise<void>;
}

async function createFixture(): Promise<Fixture> {
  const dir = await mkdtemp(join(tmpdir(), 'orqst-desktop-sidecar-'));
  const home = join(dir, 'home');
  const sessionsDir = join(dir, 'sessions');
  const dashboardDir = join(dir, 'dashboard');
  const dataDir = join(dir, 'private', 'core');
  await mkdir(home, { recursive: true });
  await mkdir(sessionsDir, { recursive: true });
  await mkdir(dashboardDir, { recursive: true });
  const sessionFile = join(sessionsDir, 'synthetic-desktop.jsonl');
  const sessionContent =
    [
      meta('synthetic-desktop-session', '/synthetic/desktop-project'),
      record('event_msg', { type: 'task_started' }),
    ]
      .map((value) => JSON.stringify(value))
      .join('\n') + '\n';
  await writeFile(sessionFile, sessionContent);
  await writeFile(
    join(dashboardDir, 'index.html'),
    '<!doctype html><title>Synthetic ORQST Desktop dashboard</title>',
  );
  return { dir, home, dataDir, sessionsDir, dashboardDir, sessionFile, sessionContent };
}

function environment(
  ctx: Fixture,
  overrides: Record<string, string | undefined> = {},
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    HOME: ctx.home,
    ORQST_DATA_DIR: ctx.dataDir,
    ORQST_CODEX_SESSIONS: ctx.sessionsDir,
    ORQST_DEV: '0',
    ORQST_POLL_MS: '500',
  };
  if (process.env.PATH) env.PATH = process.env.PATH;
  if (process.env.TMPDIR) env.TMPDIR = process.env.TMPDIR;
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

function launch(ctx: Fixture, options: LaunchOptions = {}): RunningSidecar {
  const args = ['--import', 'tsx', sidecar];
  if (options.dashboard !== null) args.push(options.dashboard ?? ctx.dashboardDir);
  const child = spawn(process.execPath, args, {
    cwd: repositoryRoot,
    env: environment(ctx, options.env),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  let settled = false;
  let resolveReady!: (port: number) => void;
  let rejectReady!: (error: Error) => void;
  const ready = new Promise<number>((accept, reject) => {
    resolveReady = accept;
    rejectReady = reject;
  });
  const exited = once(child, 'close').then(([code, signal]) => ({
    code: code as number | null,
    signal: signal as NodeJS.Signals | null,
  }));
  const settle = (error?: Error, port?: number): void => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    if (error) rejectReady(error);
    else resolveReady(port!);
  };
  const timer = setTimeout(() => {
    settle(
      new Error(
        `Synthetic Desktop Core did not become ready within ${readinessLimit}ms: ${stderr}`,
      ),
    );
  }, readinessLimit);
  child.stdin?.on('error', () => {});
  child.stdout?.setEncoding('utf8');
  child.stderr?.setEncoding('utf8');
  child.stdout?.on('data', (chunk: string) => {
    stdout += chunk;
    const match = /(?:^|\n)ORQST_CORE_READY (\d+)\r?\n/.exec(stdout);
    if (match) settle(undefined, Number(match[1]));
  });
  child.stderr?.on('data', (chunk: string) => {
    stderr += chunk;
  });
  child.on('error', (error) => {
    settle(error);
  });
  void exited.then(({ code, signal }) => {
    settle(
      new Error(
        `Synthetic Desktop Core exited before readiness (code ${code}, signal ${signal}): ${stderr}`,
      ),
    );
  });
  return {
    child,
    stdout: () => stdout,
    stderr: () => stderr,
    ready,
    exited,
    async dispose() {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      await exited;
      child.stdin?.destroy();
    },
  };
}

async function bootstrap(base: string): Promise<string> {
  const response = await fetch(base + '/api/bootstrap');
  assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie');
  assert.ok(cookie, 'bootstrap must issue a session cookie');
  return cookie.split(';')[0]!;
}

async function snapshot(base: string, cookie: string): Promise<Snapshot> {
  const response = await fetch(base + '/api/snapshot', { headers: { Cookie: cookie } });
  assert.equal(response.status, 200);
  return (await response.json()) as Snapshot;
}

test('Desktop Core announces a loopback port, serves bootstrap-cookie API and private SQLite', async () => {
  const ctx = await createFixture();
  const run = launch(ctx);
  try {
    const port = await run.ready;
    assert.equal(run.stdout(), `ORQST_CORE_READY ${port}\n`);
    assert.ok(Number.isInteger(port) && port >= 1024 && port <= 65535);
    const base = `http://127.0.0.1:${port}`;
    const database = join(ctx.dataDir, 'orqst.db');

    assert.equal((await fetch(base + '/api/snapshot')).status, 401);
    const cookie = await bootstrap(base);
    assert.match(cookie, /^orqst_session=[0-9a-f]{64}$/);
    const cookieHeader = await fetch(base + '/api/bootstrap');
    assert.match(cookieHeader.headers.get('set-cookie') ?? '', /HttpOnly/);
    assert.match(cookieHeader.headers.get('set-cookie') ?? '', /SameSite=Strict/);
    const current = await snapshot(base, cookie);
    assert.equal(current.sessions.length, 1);
    assert.equal(current.sessions[0]?.id, 'synthetic-desktop-session');
    assert.ok(current.cursor > 0);
    assert.equal(current.diagnostics.errors, 0);

    const dashboard = await fetch(base + '/');
    assert.equal(dashboard.status, 200);
    assert.equal(dashboard.headers.get('content-type'), 'text/html; charset=utf-8');
    assert.match(await dashboard.text(), /Synthetic ORQST Desktop dashboard/);

    assert.equal((await stat(ctx.dataDir)).mode & 0o777, 0o700);
    assert.equal((await stat(database)).mode & 0o777, 0o600);
    const entries = await readdir(ctx.dataDir);
    assert.deepEqual(
      entries.filter((name) => !name.startsWith('orqst.db')),
      [],
    );
    assert.deepEqual(await readdir(ctx.dashboardDir), ['index.html']);
    assert.deepEqual(await readdir(ctx.sessionsDir), ['synthetic-desktop.jsonl']);

    run.child.stdin!.write('shutdown\n');
    const closed = await run.exited;
    assert.equal(closed.code, 0);
    assert.equal(closed.signal, null);
    assert.equal(run.stdout(), `ORQST_CORE_READY ${port}\n`);
    await assert.rejects(fetch(base + '/api/bootstrap'));
    assert.equal((await stat(database)).mode & 0o777, 0o600);
    assert.equal(await readFile(ctx.sessionFile, 'utf8'), ctx.sessionContent);
    const reopened = new Store(database);
    try {
      assert.equal(reopened.cursor(), current.cursor);
      assert.ok(reopened.checkpoint(`${ctx.sessionsDir}:synthetic-desktop.jsonl`));
    } finally {
      reopened.close();
    }
  } finally {
    await run.dispose();
    await rm(ctx.dir, { recursive: true, force: true });
  }
});

test('Desktop Core drains and releases its private state on stdin EOF', async () => {
  const ctx = await createFixture();
  const run = launch(ctx);
  const database = join(ctx.dataDir, 'orqst.db');
  try {
    const port = await run.ready;
    const base = `http://127.0.0.1:${port}`;
    const before = await snapshot(base, await bootstrap(base));
    assert.equal(before.sessions[0]?.id, 'synthetic-desktop-session');

    run.child.stdin!.end();
    const closed = await run.exited;
    assert.equal(closed.code, 0);
    assert.equal(closed.signal, null);
    await assert.rejects(fetch(base + '/api/bootstrap'));
    assert.equal(await readFile(ctx.sessionFile, 'utf8'), ctx.sessionContent);
    const reopened = new Store(database);
    try {
      assert.equal(reopened.cursor(), before.cursor);
      assert.ok(reopened.checkpoint(`${ctx.sessionsDir}:synthetic-desktop.jsonl`));
    } finally {
      reopened.close();
    }
  } finally {
    await run.dispose();
    await rm(ctx.dir, { recursive: true, force: true });
  }
});

test('Desktop Core treats an oversized stdin command as shutdown and does not restart', async () => {
  const ctx = await createFixture();
  const run = launch(ctx);
  try {
    const port = await run.ready;
    const base = `http://127.0.0.1:${port}`;
    run.child.stdin!.write('x'.repeat(33));
    const closed = await run.exited;
    assert.equal(closed.code, 0);
    assert.equal(closed.signal, null);
    assert.equal(run.stdout(), `ORQST_CORE_READY ${port}\n`);
    await assert.rejects(fetch(base + '/api/bootstrap'));
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(run.stdout(), `ORQST_CORE_READY ${port}\n`);
  } finally {
    await run.dispose();
    await rm(ctx.dir, { recursive: true, force: true });
  }
});

test('Desktop Core refuses startup without explicit resources and private state', async () => {
  const ctx = await createFixture();
  try {
    for (const options of [
      { env: { ORQST_DATA_DIR: undefined } },
      { dashboard: null },
    ] satisfies LaunchOptions[]) {
      const run = launch(ctx, options);
      await assert.rejects(run.ready, /requires explicit resources and private state/);
      const closed = await run.exited;
      assert.equal(closed.code, 1);
      assert.equal(closed.signal, null);
      assert.equal(run.stdout(), '');
      assert.match(run.stderr(), /requires explicit resources and private state/);
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.equal(run.stdout(), '');
      await run.dispose();
    }
    assert.deepEqual(await readdir(ctx.sessionsDir), ['synthetic-desktop.jsonl']);
  } finally {
    await rm(ctx.dir, { recursive: true, force: true });
  }
});

test('Desktop Core startup failure is isolated from a healthy Core and never respawns', async () => {
  const healthy = await createFixture();
  const broken = await createFixture();
  await mkdir(join(broken.dir, 'private'), { recursive: true });
  // A regular file where the private data directory must be makes SQLite startup fail.
  await writeFile(broken.dataDir, 'Synthetic file blocking the private data directory');
  const survivor = launch(healthy);
  const failed = launch(broken);
  // Attach the rejection handler immediately so a fast failure is never unhandled.
  const failedReadiness = failed.ready.catch((error: unknown) => error);
  try {
    const port = await survivor.ready;
    assert.match(String(await failedReadiness), /ORQST Desktop Core startup failed\./);
    const closed = await failed.exited;
    assert.equal(closed.code, 1);
    assert.equal(closed.signal, null);
    assert.equal(failed.stdout(), '');
    assert.match(failed.stderr(), /ORQST Desktop Core startup failed\./);
    assert.doesNotMatch(failed.stderr(), /ORQST_CORE_READY/);
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(failed.stdout(), '');

    const base = `http://127.0.0.1:${port}`;
    const cookie = await bootstrap(base);
    const current = await snapshot(base, cookie);
    assert.equal(current.sessions[0]?.id, 'synthetic-desktop-session');

    survivor.child.stdin!.write('shutdown\n');
    const survivorClosed = await survivor.exited;
    assert.equal(survivorClosed.code, 0);
    assert.equal(survivorClosed.signal, null);
    await assert.rejects(fetch(base + '/api/bootstrap'));
    assert.equal(
      await readFile(broken.dataDir, 'utf8'),
      'Synthetic file blocking the private data directory',
    );
  } finally {
    await survivor.dispose();
    await failed.dispose();
    await rm(healthy.dir, { recursive: true, force: true });
    await rm(broken.dir, { recursive: true, force: true });
  }
});

test('Desktop Core refuses readiness when the packaged dashboard is missing', async () => {
  const ctx = await createFixture();
  const run = launch(ctx, { dashboard: join(ctx.dir, 'missing-dashboard') });
  try {
    await assert.rejects(run.ready, /ORQST Desktop Core startup failed/);
    assert.equal((await run.exited).code, 1);
    assert.equal(run.stdout(), '');
    await assert.rejects(stat(ctx.dataDir), { code: 'ENOENT' });
    assert.equal(await readFile(ctx.sessionFile, 'utf8'), ctx.sessionContent);
  } finally {
    await run.dispose();
    await rm(ctx.dir, { recursive: true, force: true });
  }
});

test('Desktop Core can reopen a stable native origin without duplicating observed events', async () => {
  const ctx = await createFixture();
  const first = launch(ctx);
  let second: RunningSidecar | undefined;
  try {
    const port = await first.ready;
    const base = `http://127.0.0.1:${port}`;
    const before = await snapshot(base, await bootstrap(base));
    first.child.stdin!.end('shutdown\n');
    assert.equal((await first.exited).code, 0);
    second = launch(ctx, { env: { ORQST_PORT: String(port) } });
    assert.equal(await second.ready, port);
    const after = await snapshot(base, await bootstrap(base));
    assert.equal(after.cursor, before.cursor);
    assert.deepEqual(
      after.sessions.map(({ id }) => id),
      before.sessions.map(({ id }) => id),
    );
    second.child.stdin!.end('shutdown\n');
    assert.equal((await second.exited).code, 0);
  } finally {
    await first.dispose();
    await second?.dispose();
    await rm(ctx.dir, { recursive: true, force: true });
  }
});

test('native metadata pipe reuses live evidence, consumes replay and omits private content', async () => {
  const ctx = await createFixture();
  const run = launch(ctx, { env: { ORQST_NATIVE_MONITOR: '1' } });
  type Frame = { connected: boolean; pending: number; alerts: object[] };
  const frames = (): Frame[] =>
    run
      .stdout()
      .split('\n')
      .filter((line) => line.startsWith('ORQST_DESKTOP_STATE '))
      .map((line) => JSON.parse(line.slice('ORQST_DESKTOP_STATE '.length)) as Frame);
  async function until(check: () => boolean) {
    const deadline = Date.now() + 10_000;
    while (!check()) {
      assert.ok(
        Date.now() < deadline,
        `native metadata frame deadline: ${run.stdout()} ${run.stderr()}`,
      );
      await new Promise((accept) => setTimeout(accept, 50));
    }
  }
  try {
    const port = await run.ready;
    await until(() => frames().length > 0);
    assert.deepEqual(frames()[0], { connected: true, pending: 0, alerts: [] });
    const completion =
      JSON.stringify({
        ...record('event_msg', {
          type: 'task_complete',
          last_agent_message: 'PRIVATE SYNTHETIC RESULT',
        }),
        timestamp: new Date().toISOString(),
      }) + '\n';
    await appendFile(ctx.sessionFile, completion);
    await until(() => frames().some((value) => value.alerts.length > 0));
    const notified = frames().filter((value) => value.alerts.length > 0);
    assert.deepEqual(notified, [
      {
        connected: true,
        pending: 1,
        alerts: [{ category: 'completed', silent: true, sessionId: 'synthetic-desktop-session' }],
      },
    ]);
    const length = frames().length;
    await until(() => frames().length > length);
    assert.equal(frames().filter((value) => value.alerts.length > 0).length, 1);
    const current = await snapshot(
      `http://127.0.0.1:${port}`,
      await bootstrap(`http://127.0.0.1:${port}`),
    );
    assert.equal(current.notifications.length, 1);
    assert.doesNotMatch(run.stdout(), /private|PRIVATE|source|token|cookie/i);
    for (const line of run.stdout().split('\n')) assert.ok(Buffer.byteLength(line) <= 1024);
    run.child.stdin!.end();
    assert.equal((await run.exited).code, 0);
    assert.equal(await readFile(ctx.sessionFile, 'utf8'), ctx.sessionContent + completion);
    const stopped = run.stdout();
    await new Promise((accept) => setTimeout(accept, 100));
    assert.equal(run.stdout(), stopped);
  } finally {
    await run.dispose();
    await rm(ctx.dir, { recursive: true, force: true });
  }
});
