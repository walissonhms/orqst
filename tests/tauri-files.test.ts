// Synthetic retained content and disposable files only; dialogs/open are explicit doubles.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm, stat, symlink, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createBridge } from '../apps/bridge/src/app.js';
import {
  nativeFileFetch,
  TauriFilesService,
  type TauriFilePorts,
} from '../apps/desktop/src/tauri-files-service.js';
import { createFileClients } from '../apps/tauri/src/files-bridge.js';
import { canonicalModelAnalytics } from '../apps/analytics-export.js';
import type { AnalyticsReading, ModelAnalyticsSummary } from '@orqst/protocol';
import { meta, record } from './fixtures.js';

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'orqst-tauri-files-'));
  const sessions = join(dir, 'sessions');
  await mkdir(sessions);
  const text = '# Synthetic retained Markdown 😀\n<script>inert</script>';
  const source = join(sessions, 'synthetic.jsonl');
  const content = [
    meta(),
    record('response_item', { type: 'message', role: 'assistant', content: text }),
  ]
    .map((v) => JSON.stringify(v) + '\n')
    .join('');
  await writeFile(source, content);
  const bridge = createBridge({
    port: 0,
    dataDir: dir,
    sessionsDir: sessions,
    dashboardDir: dir,
    retentionDays: 3650,
    pollMs: 60000,
    dev: false,
  });
  const origin = `http://127.0.0.1:${await bridge.start()}`;
  const fetcher = await nativeFileFetch(origin);
  const event = bridge.core.store.events().find((v) => v.payload.role === 'assistant')!;
  const input = {
    contractVersion: 1 as const,
    representation: 'original' as const,
    openAfterSave: false,
    selection: {
      contractVersion: 1 as const,
      sequence: event.sequence,
      eventId: event.id,
      sessionId: event.sessionId,
      machineId: event.machineId,
      adapter: event.adapter,
      workspaceId: event.workspaceId,
      agentId: event.agentId,
      sourceHash: event.source.hash,
    },
  };
  const destination = join(dir, 'synthetic.md');
  const ports: TauriFilePorts = {
    origin,
    fetch: fetcher,
    translate: (key) => key,
    choose: async () => destination,
    confirm: async () => true,
    open: async () => '',
  };
  const service = new TauriFilesService(ports);
  service.revoke(1);
  const report = (await (
    await fetcher(origin + '/api/analytics/models')
  ).json()) as ModelAnalyticsSummary;
  const reading: AnalyticsReading = {
    query: {},
    ranking: 'tokens',
    obtainedAt: new Date().toISOString(),
    readingId: randomUUID(),
    cursor: bridge.core.store.cursor(),
    digest: createHash('sha256').update(canonicalModelAnalytics(report)).digest('hex'),
  };
  return {
    dir,
    source,
    content,
    text,
    destination,
    service,
    ports,
    input,
    reading,
    origin,
    close: async () => {
      service.close();
      await bridge.stop();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

test('Tauri files reuse authenticated extraction, exact retained bytes and private new-file permissions', async () => {
  const f = await fixture();
  try {
    let opened = '';
    f.ports.open = async (path) => {
      opened = path;
      return '';
    };
    assert.deepEqual(
      await f.service.request({ kind: 'artifact', input: { ...f.input, openAfterSave: true } }, 1),
      { status: 'saved_opened' },
    );
    assert.equal(await readFile(f.destination, 'utf8'), f.text);
    assert.equal((await stat(f.destination)).mode & 0o777, 0o600);
    assert.equal(opened, await realpath(f.destination));
    assert.equal(await readFile(f.source, 'utf8'), f.content);
    assert.deepEqual(
      await f.service.request({ kind: 'artifact', input: { ...f.input, path: '/untrusted' } }, 1),
      { status: 'failed' },
    );
    assert.deepEqual(
      await f.service.request(
        {
          kind: 'artifact',
          input: { ...f.input, selection: { ...f.input.selection, sourceHash: '0'.repeat(64) } },
        },
        1,
      ),
      { status: 'failed' },
    );
  } finally {
    await f.close();
  }
});

test('Tauri overwrite review refuses cancellation, symlinks and concurrent destination changes', async () => {
  const f = await fixture();
  try {
    await writeFile(f.destination, 'Synthetic original');
    f.ports.confirm = async () => false;
    assert.deepEqual(await f.service.request({ kind: 'artifact', input: f.input }, 1), {
      status: 'cancelled',
    });
    assert.equal(await readFile(f.destination, 'utf8'), 'Synthetic original');
    f.ports.confirm = async () => {
      await writeFile(f.destination, 'Concurrent edit');
      return true;
    };
    assert.deepEqual(await f.service.request({ kind: 'artifact', input: f.input }, 1), {
      status: 'failed',
    });
    assert.equal(await readFile(f.destination, 'utf8'), 'Concurrent edit');
    await rm(f.destination);
    await symlink(f.source, f.destination);
    assert.deepEqual(await f.service.request({ kind: 'artifact', input: f.input }, 1), {
      status: 'failed',
    });
    assert.equal(await readFile(f.source, 'utf8'), f.content);
  } finally {
    await f.close();
  }
});

test('Tauri document reload and parent loss revoke pending picks before any write', async () => {
  const f = await fixture();
  try {
    f.ports.choose = async () => {
      f.service.revoke(2);
      return f.destination;
    };
    assert.deepEqual(await f.service.request({ kind: 'artifact', input: f.input }, 1), {
      status: 'failed',
    });
    await assert.rejects(stat(f.destination));
    assert.deepEqual(await f.service.request({ kind: 'artifact', input: f.input }, 1), {
      status: 'failed',
    });
    f.ports.choose = async () => {
      f.service.close();
      return f.destination;
    };
    assert.deepEqual(await f.service.request({ kind: 'artifact', input: f.input }, 2), {
      status: 'failed',
    });
    await assert.rejects(stat(f.destination));
  } finally {
    await f.close();
  }
});

test('Tauri Analytics saves CSV and Markdown only from a fresh authenticated reading and consumes it', async () => {
  const f = await fixture();
  try {
    for (const [index, format] of ['csv', 'markdown'].entries()) {
      const generation = index + 1;
      const reading = { ...f.reading, readingId: randomUUID() };
      const path = join(f.dir, `analytics.${format === 'csv' ? 'csv' : 'md'}`);
      f.ports.choose = async () => path;
      assert.deepEqual(
        await f.service.request(
          {
            kind: 'analytics',
            input: { contractVersion: 1, action: 'context', generation, reading },
          },
          1,
        ),
        { status: 'acknowledged' },
      );
      const request = {
        kind: 'analytics',
        input: { contractVersion: 1, action: 'save', generation, reading, format },
      };
      assert.deepEqual(await f.service.request(request, 1), { status: 'saved' });
      assert.ok((await readFile(path)).byteLength > 0);
      assert.equal((await stat(path)).mode & 0o777, 0o600);
      assert.deepEqual(await f.service.request(request, 1), { status: 'stale' });
    }
  } finally {
    await f.close();
  }
});

test('Tauri permits context invalidation during an export and blocks another file operation', async () => {
  const f = await fixture();
  try {
    const reading = f.reading;
    await f.service.request(
      {
        kind: 'analytics',
        input: { contractVersion: 1, action: 'context', generation: 1, reading },
      },
      1,
    );
    f.ports.choose = async () => {
      assert.deepEqual(await f.service.request({ kind: 'artifact', input: f.input }, 1), {
        status: 'failed',
      });
      assert.deepEqual(
        await f.service.request(
          {
            kind: 'analytics',
            input: { contractVersion: 1, action: 'context', generation: 2, reading: null },
          },
          1,
        ),
        { status: 'acknowledged' },
      );
      return join(f.dir, 'analytics.csv');
    };
    assert.deepEqual(
      await f.service.request(
        {
          kind: 'analytics',
          input: { contractVersion: 1, action: 'save', generation: 1, reading, format: 'csv' },
        },
        1,
      ),
      { status: 'stale' },
    );
    await assert.rejects(stat(join(f.dir, 'analytics.csv')));
  } finally {
    await f.close();
  }
});

test('native export fetch refuses non-loopback origins and routes outside the export contract', async () => {
  for (const origin of [
    'https://example.invalid',
    'http://localhost:4319',
    'http://127.0.0.1:4319/other',
    'http://user@127.0.0.1:4319',
  ])
    await assert.rejects(nativeFileFetch(origin));
  const f = await fixture();
  try {
    const fetcher = await nativeFileFetch(f.origin);
    await assert.rejects(fetcher(f.origin + '/api/snapshot'));
    await assert.rejects(fetcher('http://example.invalid/api/events'));
  } finally {
    await f.close();
  }
});

test('Tauri browser clients require user activation, validate requests and discard native diagnostics', async () => {
  let activated = false;
  const sent: unknown[] = [];
  const client = createFileClients(
    async (request) => {
      sent.push(request);
      return { status: 'saved', path: '/private/synthetic', diagnostic: 'hidden' };
    },
    () => activated,
  );
  const f = await fixture();
  try {
    assert.deepEqual(await client.artifacts.saveMarkdown(f.input), { status: 'failed' });
    assert.equal(sent.length, 0);
    activated = true;
    assert.deepEqual(await client.artifacts.saveMarkdown(f.input), { status: 'saved' });
    assert.equal(sent.length, 1);
    assert.deepEqual(await client.analytics.save('csv', 0, f.reading), { status: 'stale' });
    assert.equal(sent.length, 1);
  } finally {
    await f.close();
  }
});

test('the injected Tauri client validates without eval after response CSP becomes active', async () => {
  const { build } = await import('esbuild');
  const { createContext, runInContext } = await import('node:vm');
  const output = await build({
    entryPoints: ['apps/tauri/src/files-client.ts'],
    bundle: true,
    platform: 'browser',
    format: 'iife',
    write: false,
  });
  const f = await fixture();
  try {
    const window: Record<string, unknown> = {};
    window.top = window;
    window.self = window;
    window.__TAURI_INTERNALS__ = {
      invoke: async (
        _command: string,
        payload: { request: { kind: string; input: { action?: string } } },
      ) => ({
        status:
          payload.request.kind === 'analytics' && payload.request.input.action === 'context'
            ? 'acknowledged'
            : 'saved',
      }),
    };
    const context = createContext({
      window,
      navigator: { userActivation: { isActive: true } },
      location: { pathname: '/overview/sessions/synthetic' },
      TextEncoder,
      TextDecoder,
      URL,
      console,
    });
    runInContext(output.outputFiles![0]!.text, context);
    // Reproduces a native initialization script preceding the remote response's no-eval CSP.
    runInContext(
      'Function = function () { throw new Error("Synthetic CSP rejects eval"); }',
      context,
    );
    const artifacts = window.orqstArtifacts as ReturnType<typeof createFileClients>['artifacts'];
    const analytics = window.orqstAnalytics as ReturnType<typeof createFileClients>['analytics'];
    assert.equal((await artifacts.saveMarkdown(f.input)).status, 'saved');
    const reading = await analytics.setReading(f.reading);
    assert.equal(reading.status, 'acknowledged');
    assert.equal((await analytics.save('csv', reading.generation, f.reading)).status, 'saved');
  } finally {
    await f.close();
  }
});
