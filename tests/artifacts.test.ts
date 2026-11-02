// All message bodies, identities and source records in this suite are synthetic.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { request as httpRequest } from 'node:http';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBridge } from '../apps/bridge/src/app.js';
import {
  artifactExtractionRequestSchema,
  artifactExtractionResultSchema,
  artifactTextLimit,
  type StoredEvent,
} from '@orqst/protocol';
import { artifactBlocks, readableArtifact } from '../apps/dashboard/src/artifact-preview.js';
import { meta, record } from './fixtures.js';

function request(event: StoredEvent) {
  return {
    contractVersion: 1,
    sequence: event.sequence,
    eventId: event.id,
    sessionId: event.sessionId,
    machineId: event.machineId,
    adapter: event.adapter,
    workspaceId: event.workspaceId,
    agentId: event.agentId,
    sourceHash: event.source.hash,
  };
}

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'orqst-artifacts-'));
  const sessions = join(dir, 'sessions');
  await mkdir(sessions);
  const text =
    '# Synthetic artifact\n\n- First\n- Second\n```html\n<script>bad()</script>\n```\n[remote](https://example.invalid)';
  await writeFile(
    join(sessions, 'synthetic.jsonl'),
    [
      meta(),
      record('response_item', { type: 'message', role: 'assistant', content: text }),
      record('response_item', { type: 'agent_message', content: 'Synthetic agent message' }),
      record('response_item', { type: 'message', role: 'user', content: 'Synthetic user message' }),
      record('response_item', { type: 'function_call_output', output: 'Synthetic tool' }),
      record('event_msg', { type: 'task_complete', last_agent_message: 'Synthetic summary' }),
    ]
      .map((value) => JSON.stringify(value) + '\n')
      .join(''),
  );
  const bridge = createBridge({
    port: 0,
    dataDir: dir,
    sessionsDir: sessions,
    dashboardDir: dir,
    retentionDays: 3650,
    pollMs: 10000,
    dev: false,
  });
  const port = await bridge.start();
  const origin = `http://127.0.0.1:${port}`;
  const bootstrap = await fetch(origin + '/api/bootstrap');
  const cookie = bootstrap.headers.get('set-cookie')!.split(';')[0]!;
  return {
    bridge,
    origin,
    cookie,
    text,
    events: bridge.core.store.events(),
    close: async () => {
      await bridge.stop();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

test('manual extraction validates one retained event, preserves reference_only and never writes', async () => {
  const ctx = await fixture();
  try {
    const { core } = ctx.bridge;
    const event = ctx.events.find((value) => value.payload.role === 'assistant')!;
    const input = request(event);
    const before = core.store.events();
    const result = core.extractArtifact(input);
    assert.equal(artifactExtractionResultSchema.safeParse(result).success, true);
    assert.equal(result.availability, 'available');
    if (result.availability !== 'available') return;
    assert.equal(result.value.original.text, ctx.text);
    assert.equal(result.value.original.completeness, 'not_verified');
    assert.deepEqual(result.value.reference.evidence.source, event.source);
    assert.deepEqual(result.value.reference.content, {
      availability: 'unavailable',
      reason: 'reference_only',
    });
    assert.deepEqual(core.artifactReference(event.sequence), {
      availability: 'available',
      value: result.value.reference,
    });
    for (const key of ['eventId', 'sessionId', 'machineId', 'workspaceId', 'agentId'] as const)
      assert.deepEqual(core.extractArtifact({ ...input, [key]: 'synthetic-mismatch' }), {
        availability: 'unavailable',
        reason: 'identity_mismatch',
      });
    assert.deepEqual(core.extractArtifact({ ...input, sourceHash: '0'.repeat(64) }), {
      availability: 'unavailable',
      reason: 'identity_mismatch',
    });
    for (const version of [2, '1', null])
      assert.throws(
        () => core.extractArtifact({ ...input, contractVersion: version }),
        /^Error: Invalid artifact request$/,
      );
    assert.equal(
      artifactExtractionRequestSchema.safeParse({ ...input, path: '/synthetic/no' }).success,
      false,
    );
    assert.throws(
      () => core.extractArtifact({ ...input, extra: true }),
      /Invalid artifact request/,
    );
    for (const other of ctx.events.filter(
      (value) => value.payload.role !== 'assistant' && value.payload.role !== 'agent',
    ))
      assert.deepEqual(core.extractArtifact(request(other)), {
        availability: 'unavailable',
        reason: 'not_artifact_message',
      });
    const agent = ctx.events.find((value) => value.payload.role === 'agent')!;
    assert.equal(core.extractArtifact(request(agent)).availability, 'available');
    const unsupported = core.store.ingest({
      ...event,
      id: 'synthetic-unsupported',
      adapter: 'claude',
    })!;
    assert.deepEqual(core.extractArtifact(request(unsupported)), {
      availability: 'unavailable',
      reason: 'unsupported_adapter',
    });
    assert.deepEqual(core.store.events().slice(0, before.length), before);
  } finally {
    await ctx.close();
  }
});

test('UTF-8 budget is exact, retention gaps do not reconstruct bodies or select a later event', async () => {
  const ctx = await fixture();
  try {
    const { core } = ctx.bridge;
    const event = ctx.events.find((value) => value.payload.role === 'assistant')!;
    const exact = core.store.ingest({
      ...event,
      id: 'synthetic-exact',
      payload: { ...event.payload, text: 'é'.repeat(artifactTextLimit / 2) },
    })!;
    assert.equal(core.extractArtifact(request(exact)).availability, 'available');
    const over = core.store.ingest({
      ...event,
      id: 'synthetic-over',
      payload: { ...event.payload, text: 'é'.repeat(artifactTextLimit / 2) + 'x' },
    })!;
    assert.deepEqual(core.extractArtifact(request(over)), {
      availability: 'unavailable',
      reason: 'content_limit',
    });
    const expired = core.store.ingest({
      ...event,
      id: 'synthetic-expired',
      timestamp: '2000-01-01T00:00:00.000Z',
    })!;
    core.store.ingest({ ...event, id: 'synthetic-later', timestamp: '2099-01-01T00:00:00.000Z' });
    core.store.retain();
    assert.deepEqual(core.extractArtifact(request(expired)), {
      availability: 'unavailable',
      reason: 'event_not_retained',
    });
    assert.equal(core.store.sessions().length, 1);
  } finally {
    await ctx.close();
  }
});

test('extraction HTTP boundary preserves authentication, origin, JSON limits, strict identity/version and no-store', async () => {
  const ctx = await fixture();
  try {
    const event = ctx.events.find((value) => value.payload.role === 'assistant')!;
    const input = request(event);
    const post = (data: unknown, headers: Record<string, string> = {}, suffix = '') =>
      fetch(ctx.origin + '/api/artifacts/extract' + suffix, {
        method: 'POST',
        headers: { Cookie: ctx.cookie, 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(data),
      });
    assert.equal((await post(input, { Cookie: '' })).status, 401);
    assert.equal((await post(input, { Origin: 'https://untrusted.invalid' })).status, 403);
    const badHost = await new Promise<number | undefined>((resolve, reject) => {
      const req = httpRequest(
        ctx.origin + '/api/artifacts/extract',
        {
          method: 'POST',
          headers: {
            Host: 'untrusted.invalid',
            Cookie: ctx.cookie,
            'Content-Type': 'application/json',
          },
        },
        (response) => {
          response.resume();
          resolve(response.statusCode);
        },
      );
      req.on('error', reject);
      req.end(JSON.stringify(input));
    });
    assert.equal(badHost, 403);
    assert.equal((await post(input, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
    assert.equal((await post(input, { 'Content-Type': 'text/plain' })).status, 400);
    for (const data of [
      { ...input, contractVersion: '1' },
      { ...input, contractVersion: 2 },
      { ...input, sequence: 0 },
      { ...input, path: '/synthetic/private' },
      { ...input, extra: 'x'.repeat(9000) },
    ])
      assert.equal((await post(data)).status, 400);
    assert.equal((await post(input, {}, '?extra=true')).status, 400);
    const result = await post(input);
    assert.equal(result.status, 200);
    assert.equal(result.headers.get('cache-control'), 'no-store');
    const body = artifactExtractionResultSchema.parse(await result.json());
    assert.equal(body.availability, 'available');
    if (body.availability === 'available') assert.equal(body.value.original.text, ctx.text);
    const error = await post({ ...input, sessionId: 'synthetic-wrong' });
    assert.deepEqual(await error.json(), {
      availability: 'unavailable',
      reason: 'identity_mismatch',
    });
  } finally {
    await ctx.close();
  }
});

test('limited preview preserves hostile content as inert text and readable output matches supported blocks', () => {
  const text =
    '# Synthetic\n- one\n- two\n```html\n<img src=x onerror=bad()>\n```\n[click](javascript:bad())\n![remote](https://example.invalid/a)';
  assert.deepEqual(artifactBlocks(text).slice(0, 3), [
    { kind: 'heading', text: 'Synthetic' },
    { kind: 'list', items: ['one', 'two'] },
    { kind: 'code', text: '<img src=x onerror=bad()>' },
  ]);
  assert.equal(
    readableArtifact(text),
    'Synthetic\none\ntwo\n<img src=x onerror=bad()>\n[click](javascript:bad())\n![remote](https://example.invalid/a)',
  );
  assert.deepEqual(artifactBlocks('```\n# literal'), [{ kind: 'code', text: '# literal' }]);
});
