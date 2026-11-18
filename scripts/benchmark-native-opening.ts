// Disposable host benchmark. The only executable opened in a PTY is a synthetic C fixture.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { chmod, cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { loadavg, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';
import { build } from 'esbuild';
import { Store } from '@orqst/database';
import { defaultFeatureId, type Snapshot } from '@orqst/protocol';
import { terminalExecutableSha256 } from '../packages/core/src/terminal/codex-profile.js';
import { reviewedDesktopCodexBinary } from '../apps/desktop/src/terminal-creation.js';
import { reviewedClaudeTuiBinary } from '../packages/core/src/terminal/interactive-profile.js';
import { reviewedProviderMcpBinaries } from '../packages/core/src/terminal/provider-mcp-config.js';

assert.equal(process.platform, 'darwin');
assert.equal(process.arch, 'arm64');
assert.match(process.version, /^v24\./);
const trials = Number(process.argv[2] ?? 3);
assert(Number.isInteger(trials) && trials > 0 && trials <= 10);
const catalogOnly = process.argv[3] === '--catalog-only';
const batchPreparation = process.argv[3] === '--batch-preparation';
assert(process.argv[3] === undefined || catalogOnly || batchPreparation);
process.umask(0o077);
const root = await realpath(await mkdtemp(join(tmpdir(), 'orqst-benchmark-')));
const bundles = join(root, 'bundles');
const bin = join(root, 'bin');
const sessions = join(root, 'sessions');
const empty = join(root, 'empty');
const dashboard = join(root, 'dashboard');
const node = await realpath(process.execPath);
const timings: Record<string, number> = {};

async function withHost<T>(
  args: string[],
  env: NodeJS.ProcessEnv,
  run: (next: () => Promise<string>, send: (data: object) => void) => Promise<T>,
  report?: (stderr: string) => void,
): Promise<T> {
  const child = spawn(node, args, { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr
    .setEncoding('utf8')
    .on('data', (text: string) => (stderr = (stderr + text).slice(-2048)));
  child.stdin.on('error', () => {});
  const closed = once(child, 'close');
  const output = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  const timer = setTimeout(() => child.kill('SIGKILL'), 120_000);
  try {
    const result = await run(
      async () => {
        const line = await output.next();
        if (line.done) throw new Error(`Synthetic host closed: ${stderr}`);
        return line.value;
      },
      (data) => child.stdin.write(JSON.stringify(data) + '\n'),
    );
    child.stdin.end();
    if (args[0]?.endsWith('tauri-terminal-host.cjs')) child.stdout.resume();
    assert.equal((await closed)[0], 0, stderr);
    report?.(stderr);
    return result;
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await closed;
    await output.return?.();
  }
}

function fixtureEnvironment(home: string): NodeJS.ProcessEnv {
  return { HOME: home, PATH: `${bin}:/usr/bin:/bin`, LANG: 'en_US.UTF-8', TMPDIR: root };
}

async function observe(home: string, data: string, input: string, label: string) {
  const started = performance.now();
  await withHost(
    [join(bundles, 'desktop-sidecar.mjs'), dashboard],
    { ...fixtureEnvironment(home), ORQST_DATA_DIR: data, ORQST_CODEX_SESSIONS: input },
    async (next) => {
      const ready = /^ORQST_CORE_READY (\d+)$/.exec(await next());
      assert(ready);
      timings[`${label}ReadyMs`] = performance.now() - started;
      const base = `http://127.0.0.1:${ready[1]}`;
      const entry = await fetch(base + '/api/bootstrap');
      assert.equal(entry.status, 200);
      const cookie = entry.headers.get('set-cookie')?.split(';')[0];
      assert(cookie);
      const response = await fetch(base + '/api/snapshot', { headers: { cookie } });
      assert.equal(response.status, 200);
      let current = (await response.json()) as Snapshot;
      timings[`${label}SnapshotMs`] = performance.now() - started;
      timings[`${label}SessionsAtFirstSnapshot`] = current.sessions.length;
      while (current.diagnostics.lastScan === null) {
        await delay(100);
        const updated: Response = await fetch(base + '/api/snapshot', { headers: { cookie } });
        assert.equal(updated.status, 200);
        current = (await updated.json()) as Snapshot;
      }
      timings[`${label}ScanMs`] = performance.now() - started;
      assert.equal(current.sessions.length, input === empty ? 0 : 16);
    },
  );
}

async function prepare(
  request: object,
  context: { home: string; parent: string; preferencesDirectory: string; observerDatabase: string },
  label: string,
) {
  const started = performance.now();
  let committed: number | undefined;
  return withHost(
    [
      join(bundles, 'tauri-terminal-preparation-host.cjs'),
      JSON.stringify(request),
      context.parent,
      JSON.stringify({
        observerDatabase: context.observerDatabase,
        preferencesDirectory: context.preferencesDirectory,
      }),
    ],
    fixtureEnvironment(context.home),
    async (next, send) => {
      let frame = JSON.parse(await next());
      if (frame.kind === 'commit') {
        committed = performance.now();
        timings[`${label}CommitMs`] = committed - started;
        send({ id: frame.id, value: true });
        frame = JSON.parse(await next());
      }
      assert.equal(frame.kind, 'complete', JSON.stringify(frame.failure));
      const completed = performance.now();
      timings[`${label}ReplyMs`] = completed - started;
      if (committed !== undefined) timings[`${label}AfterCommitMs`] = completed - committed;
      return frame;
    },
    (stderr) => {
      const digest = /^ORQST_BENCH_DIGEST (\d+) (\d+)$/m.exec(stderr);
      assert(digest, 'Synthetic helper did not report its digest work');
      timings[`${label}HashedMiB`] = Number(digest[1]) / (1024 * 1024);
      timings[`${label}CpuMs`] = Number(digest[2]) / 1000;
    },
  ).finally(() => {
    timings[`${label}ExitMs`] = performance.now() - started;
  });
}

try {
  for (const path of [bin, sessions, empty, dashboard]) await mkdir(path, { mode: 0o700 });
  await writeFile(
    join(dashboard, 'index.html'),
    '<!doctype html><title>Synthetic benchmark</title>',
  );
  const padding = join(root, 'padding.s');
  await writeFile(padding, '.section __DATA,__bench\n.space 100663296\n');
  const codex = join(bin, 'codex');
  execFileSync('/usr/bin/cc', [
    '-O2',
    '-DORQST_SYNTHETIC_TIMEOUT_SECONDS=15',
    resolve('tests/helpers/managed-terminal-fixture.c'),
    padding,
    '-o',
    codex,
  ]);
  // Separate canonical copies model three installations with independently reviewed digests.
  await cp(codex, join(bin, 'claude'));
  await cp(codex, join(bin, 'opencode'));
  const syntheticDigest = terminalExecutableSha256(codex);
  const pins = [
    reviewedDesktopCodexBinary.sha256,
    reviewedClaudeTuiBinary.sha256,
    reviewedProviderMcpBinaries.opencode.sha256,
  ];
  await build({
    entryPoints: { 'desktop-sidecar': 'apps/bridge/src/desktop-sidecar.ts' },
    outdir: bundles,
    outExtension: { '.js': '.mjs' },
    bundle: true,
    platform: 'node',
    target: 'node24',
    format: 'esm',
    banner: {
      js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
    },
    logLevel: 'silent',
  });
  await build({
    entryPoints: {
      'tauri-terminal-preparation-host': 'apps/desktop/src/tauri-terminal-preparation-host.ts',
      'tauri-terminal-host': 'apps/desktop/src/tauri-terminal-host.ts',
      'managed-terminal-core': 'packages/core/src/terminal/host.ts',
      'managed-terminal-host': 'packages/core/src/terminal/pty-host.ts',
      'orqst-mcp-relay': 'packages/core/src/terminal/mcp-relay.ts',
    },
    outdir: bundles,
    outExtension: { '.js': '.cjs' },
    bundle: true,
    platform: 'node',
    target: 'node24',
    format: 'cjs',
    logLevel: 'silent',
    plugins: [
      {
        name: 'synthetic-pins',
        setup(builder) {
          builder.onLoad({ filter: /codex-profile\.ts$/ }, async ({ path }) => {
            // Measure bytes from the production read loop, excluding cache hits.
            const original = await readFile(path, 'utf8');
            const boundary = "if (!position) throw new Error('Empty terminal executable');";
            assert(original.includes(boundary));
            return {
              contents:
                `
import { writeSync as writeBenchmarkReport } from 'node:fs';
let hashedBytes = 0;
if (process.argv[1]?.endsWith('tauri-terminal-preparation-host.cjs')) {
  process.on('exit', () => {
    const { user, system } = process.cpuUsage();
    writeBenchmarkReport(2, 'ORQST_BENCH_DIGEST ' + hashedBytes + ' ' + (user + system) + '\\n');
  });
}
` + original.replace(boundary, boundary + ' hashedBytes += position;'),
              loader: 'ts',
            };
          });
          builder.onLoad(
            { filter: /(?:terminal-creation|interactive-profile|provider-mcp-config)\.ts$/ },
            async ({ path }) => {
              let contents = await readFile(path, 'utf8');
              for (const pin of pins) contents = contents.replaceAll(pin, syntheticDigest);
              return { contents, loader: 'ts' };
            },
          );
        },
      },
    ],
  });
  const require = createRequire(import.meta.url);
  const pty = dirname(require.resolve('node-pty/package.json'));
  const ptyBundle = join(bundles, 'terminal-pty');
  for (const name of ['lib', 'package.json', 'prebuilds/darwin-arm64'])
    await cp(join(pty, name), join(ptyBundle, name), { recursive: true });
  await chmod(join(ptyBundle, 'prebuilds/darwin-arm64/spawn-helper'), 0o700);
  const project = join(root, 'project');
  await mkdir(project);
  const timestamp = new Date().toISOString();
  const line = (type: string, payload: object) =>
    JSON.stringify({ timestamp, type, payload }) + '\n';
  const messages = Array.from({ length: 2048 }, (_, index) =>
    line('event_msg', { type: 'user_message', message: `synthetic ${index} ${'x'.repeat(900)}` }),
  ).join('');
  for (let index = 0; index < 16; index++) {
    const id = randomUUID();
    await writeFile(
      join(sessions, `synthetic-${index}.jsonl`),
      line('session_meta', { id, cwd: project, timestamp, cli_version: 'synthetic' }) + messages,
    );
  }
  const printTrial = (trial: number, loadStart: number) =>
    console.log(
      JSON.stringify({
        trial: trial + 1,
        loadStart,
        loadEnd: loadavg()[0],
        ...Object.fromEntries(
          Object.entries(timings).map(([key, value]) => [key, Math.round(value)]),
        ),
      }),
    );
  for (let trial = 0; trial < trials; trial++) {
    const loadStart = loadavg()[0]!;
    const dir = join(root, String(trial));
    const home = join(dir, 'home');
    const parent = join(dir, 'profiles');
    const preferencesDirectory = join(dir, 'preferences');
    for (const path of [join(home, '.codex'), parent, preferencesDirectory])
      await mkdir(path, { recursive: true, mode: 0o700 });
    const data = join(dir, 'observer');
    if (!catalogOnly && !batchPreparation) {
      await observe(home, join(dir, 'empty-store'), empty, 'emptyObserver');
      await observe(home, data, sessions, 'historyObserver');
    }
    const observerDatabase = join(data, 'orqst.db');
    const store = new Store(observerDatabase);
    const workspaceId = store.workspace(project, 'Synthetic benchmark');
    store.close();
    const context = { home, parent, preferencesDirectory, observerDatabase };
    const scope = { workspaceId, featureId: null };
    const { catalog } = await prepare({ action: 'catalog', ...scope }, context, 'catalog');
    const entry = catalog.providers.find(
      (provider: { provider: string }) => provider.provider === 'codex',
    );
    assert.equal(entry.status, 'available');
    if (catalogOnly) {
      printTrial(trial, loadStart);
      continue;
    }
    if (batchPreparation) {
      const { items } = await prepare(
        {
          action: 'create-batch',
          ...scope,
          catalogId: catalog.catalogId,
          requests: Array.from({ length: 4 }, (_, index) => ({
            id: randomUUID(),
            workspaceId,
            provider: 'codex',
            modelId: entry.models[0].id,
            name: `Synthetic terminal ${index + 1}`,
          })),
        },
        context,
        'batch',
      );
      assert.equal(items.length, 4);
      assert(
        items.every(({ status }: { status: string }) => status === 'prepared'),
        JSON.stringify(items),
      );
      printTrial(trial, loadStart);
      continue;
    }
    const create = {
      action: 'create-selected',
      ...scope,
      provider: 'codex',
      modelId: entry.models[0].id,
      catalogId: catalog.catalogId,
      count: 1,
    };
    const { files: initial } = await prepare(create, context, 'firstPreparation');
    const nextScope = { workspaceId, featureId: defaultFeatureId(workspaceId) };
    const { catalog: nextCatalog } = await prepare(
      { action: 'catalog', ...nextScope },
      context,
      'nextCatalog',
    );
    const { files: added } = await prepare(
      { ...create, ...nextScope, catalogId: nextCatalog.catalogId },
      context,
      'nextPreparation',
    );
    const boot = performance.now();
    await withHost(
      [
        join(bundles, 'tauri-terminal-host.cjs'),
        JSON.stringify(initial),
        preferencesDirectory,
        'true',
        randomUUID(),
      ],
      fixtureEnvironment(home),
      async (next, send) => {
        const wait = async (kind: string, id?: string) => {
          for (;;) {
            const frame = JSON.parse(await next());
            if (frame.kind === 'confirm') send({ kind: 'confirm', id: frame.id, accepted: true });
            if (frame.kind === 'startup-failure') throw new Error(JSON.stringify(frame));
            if (frame.kind === kind && (id === undefined || frame.id === id)) return frame;
          }
        };
        const ready = await wait('ready');
        timings.hostStartupMs = performance.now() - boot;
        const id = randomUUID();
        const enrolled = performance.now();
        send({
          kind: 'enroll',
          id,
          epoch: ready.epoch,
          generation: 0,
          manifestFile: added[0],
          previousLayout: null,
        });
        const receipt = await wait('enrollment-reply', id);
        assert.equal(receipt.status, 'ready', JSON.stringify(receipt.receipt));
        timings.enrollmentMs = performance.now() - enrolled;
        const presented = performance.now();
        send({ kind: 'enrollment-present', id, generation: 0 });
        assert.equal((await wait('enrollment-presented', id)).ready, true);
        timings.presentationAckMs = performance.now() - presented;
        const open = randomUUID();
        const opening = performance.now();
        send({
          kind: 'request',
          id: open,
          slot: 1,
          focused: true,
          openingAuthorized: true,
          request: { version: 1, action: 'open', profileId: 'codex-terminal-v1' },
        });
        const reply = await wait('reply', open);
        assert.equal(reply.value.opening, 'ready', JSON.stringify(reply.value));
        timings.cliOpeningMs = performance.now() - opening;
        const stop = randomUUID();
        send({
          kind: 'request',
          id: stop,
          slot: 1,
          focused: true,
          request: {
            version: 1,
            action: 'stop',
            instanceId: reply.value.instanceId,
            signal: 'SIGTERM',
          },
        });
        assert.equal((await wait('reply', stop)).value.status, 'ok');
      },
    );
    printTrial(trial, loadStart);
  }
} finally {
  await rm(root, { recursive: true, force: true });
}
