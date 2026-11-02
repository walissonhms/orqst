// Independent Artifacts QA. Synthetic data only; no installed DB or native sessions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObserverCore } from '@orqst/core';
import { Store } from '@orqst/database';
import {
  artifactExtractionRequestSchema,
  artifactExtractionResultSchema,
  artifactTextLimit,
  type AgentEvent,
  type ArtifactExtractionRequest,
} from '@orqst/protocol';
import { artifactBlocks, readableArtifact } from '../apps/dashboard/src/artifact-preview.js';
import { createLocalServer } from '../apps/bridge/src/server.js';

const stamp = '2026-11-02T12:00:00.000Z';
const hash = 'a'.repeat(64);
const text =
  '# Synthetic\n- one\n- two\n```html\n<img src=x onerror="bad()">\n```\n[click](javascript:bad())\n![remote](https://example.invalid/a)';

function event(overrides: Partial<AgentEvent> & { id: string }): AgentEvent {
  return {
    schemaVersion: 1,
    type: 'agent.message',
    timestamp: stamp,
    adapter: 'codex',
    machineId: 'synthetic-machine',
    workspaceId: 'synthetic-workspace',
    sessionId: 'synthetic-session',
    agentId: 'synthetic-agent',
    correlation: { turnId: 'synthetic-turn' },
    source: {
      file: 'synthetic/artifact.jsonl',
      offset: 10,
      line: 3,
      hash,
      recordType: 'response_item:message',
    },
    payload: { role: 'assistant', text },
    ...overrides,
  };
}

function request(value: AgentEvent): ArtifactExtractionRequest {
  return {
    contractVersion: 1,
    sequence: 1,
    eventId: value.id,
    sessionId: value.sessionId,
    machineId: value.machineId,
    adapter: value.adapter,
    workspaceId: value.workspaceId,
    agentId: value.agentId,
    sourceHash: value.source.hash,
  };
}

async function setup(retentionDays = 3650) {
  const dir = mkdtempSync(join(tmpdir(), 'orqst-artifacts-qa-'));
  const sessions = join(dir, 'sessions');
  mkdirSync(sessions);
  const core = new ObserverCore({
    dataDir: dir,
    sessionsDir: sessions,
    retentionDays,
    pollMs: 1000,
  });
  await core.initialize();
  return {
    dir,
    core,
    close: async () => {
      await core.stop();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test('extraction is strict, identity/source-bound and returns reference plus the same retained body', async () => {
  const ctx = await setup();
  try {
    const stored = ctx.core.store.ingest(event({ id: 'artifact-valid' }));
    assert.ok(stored);
    const input = { ...request(stored), sequence: stored.sequence };
    assert.equal(artifactExtractionRequestSchema.safeParse(input).success, true);
    const result = ctx.core.extractArtifact(input);
    assert.equal(artifactExtractionResultSchema.safeParse(result).success, true);
    assert.equal(result.availability, 'available');
    if (result.availability !== 'available') return;
    assert.equal(result.value.contract, 'orqst.artifacts');
    assert.equal(result.value.contractVersion, 1);
    assert.equal(result.value.selection, 'manual_message');
    assert.equal(result.value.eventSchemaVersion, 1);
    assert.equal(result.value.original.text, text);
    assert.equal(result.value.original.representation, 'retained_redacted_text');
    assert.equal(result.value.original.completeness, 'not_verified');
    assert.equal(result.value.reference.evidence.eventId, stored.id);
    assert.equal(result.value.reference.evidence.sequence, stored.sequence);
    assert.deepEqual(result.value.reference.evidence.source, stored.source);
    assert.deepEqual(result.value.reference.content, {
      availability: 'unavailable',
      reason: 'reference_only',
    });

    for (const key of ['eventId', 'sessionId', 'machineId', 'workspaceId', 'agentId'] as const)
      assert.deepEqual(ctx.core.extractArtifact({ ...input, [key]: 'wrong' }), {
        availability: 'unavailable',
        reason: 'identity_mismatch',
      });
    assert.deepEqual(ctx.core.extractArtifact({ ...input, sourceHash: '0'.repeat(64) }), {
      availability: 'unavailable',
      reason: 'identity_mismatch',
    });
    assert.deepEqual(ctx.core.extractArtifact({ ...input, adapter: 'claude' }), {
      availability: 'unavailable',
      reason: 'identity_mismatch',
    });
    for (const invalid of [
      { ...input, contractVersion: 2 },
      { ...input, contractVersion: '1' },
      { ...input, sequence: 0 },
      { ...input, extra: true },
      { ...input, path: '/synthetic/private' },
    ])
      assert.throws(() => ctx.core.extractArtifact(invalid), /^Error: Invalid artifact request$/);

    const before = {
      cursor: ctx.core.store.cursor(),
      events: ctx.core.store.events(),
      totals: ctx.core.store.totals(),
    };
    ctx.core.extractArtifact(input);
    assert.equal(ctx.core.store.cursor(), before.cursor);
    assert.deepEqual(ctx.core.store.events(), before.events);
    assert.deepEqual(ctx.core.store.totals(), before.totals);
  } finally {
    await ctx.close();
  }
});

test('UTF-8 limit is exact in bytes, never truncates and distinguishes multibyte content', async () => {
  const ctx = await setup();
  try {
    const base = event({ id: 'limit-base' });
    const exact = ctx.core.store.ingest({
      ...base,
      id: 'ascii-exact',
      payload: { ...base.payload, text: 'a'.repeat(artifactTextLimit) },
    })!;
    const exactResult = ctx.core.extractArtifact({ ...request(exact), sequence: exact.sequence });
    assert.equal(exactResult.availability, 'available');
    if (exactResult.availability === 'available')
      assert.equal(exactResult.value.original.text.length, artifactTextLimit);

    const over = ctx.core.store.ingest({
      ...base,
      id: 'ascii-over',
      payload: { ...base.payload, text: 'a'.repeat(artifactTextLimit + 1) },
    })!;
    assert.deepEqual(ctx.core.extractArtifact({ ...request(over), sequence: over.sequence }), {
      availability: 'unavailable',
      reason: 'content_limit',
    });

    const multibyteExact = ctx.core.store.ingest({
      ...base,
      id: 'utf8-exact',
      payload: { ...base.payload, text: 'é'.repeat(artifactTextLimit / 2) },
    })!;
    assert.equal(
      ctx.core.extractArtifact({ ...request(multibyteExact), sequence: multibyteExact.sequence })
        .availability,
      'available',
    );
    const multibyteOver = ctx.core.store.ingest({
      ...base,
      id: 'utf8-over',
      payload: { ...base.payload, text: 'é'.repeat(artifactTextLimit / 2 + 1) },
    })!;
    assert.deepEqual(
      ctx.core.extractArtifact({ ...request(multibyteOver), sequence: multibyteOver.sequence }),
      { availability: 'unavailable', reason: 'content_limit' },
    );
  } finally {
    await ctx.close();
  }
});

test('unsupported source/role, retention expiry and no fallback remain explicit', async () => {
  const ctx = await setup(1);
  try {
    const user = ctx.core.store.ingest(
      event({ id: 'user-message', payload: { role: 'user', text: 'Synthetic user' } }),
    )!;
    assert.deepEqual(ctx.core.extractArtifact({ ...request(user), sequence: user.sequence }), {
      availability: 'unavailable',
      reason: 'not_artifact_message',
    });
    const wrongRecord = ctx.core.store.ingest(
      event({
        id: 'wrong-record',
        source: { ...event({ id: 'source' }).source, recordType: 'response_item:agent_message' },
      }),
    )!;
    assert.deepEqual(
      ctx.core.extractArtifact({ ...request(wrongRecord), sequence: wrongRecord.sequence }),
      { availability: 'unavailable', reason: 'not_artifact_message' },
    );
    const manual = ctx.core.store.ingest(event({ id: 'manual-message', adapter: 'manual' }))!;
    assert.deepEqual(ctx.core.extractArtifact({ ...request(manual), sequence: manual.sequence }), {
      availability: 'unavailable',
      reason: 'unsupported_adapter',
    });
    const empty = ctx.core.store.ingest(
      event({ id: 'empty-message', payload: { role: 'assistant', text: '   ' } }),
    )!;
    assert.deepEqual(ctx.core.extractArtifact({ ...request(empty), sequence: empty.sequence }), {
      availability: 'unavailable',
      reason: 'not_artifact_message',
    });
    const retained = ctx.core.store.ingest(event({ id: 'retained-message' }))!;
    assert.equal(
      ctx.core.extractArtifact({ ...request(retained), sequence: retained.sequence }).availability,
      'available',
    );
    ctx.core.store.retain(Date.parse('2026-12-05T00:00:00Z'));
    assert.deepEqual(
      ctx.core.extractArtifact({ ...request(retained), sequence: retained.sequence }),
      { availability: 'unavailable', reason: 'event_not_retained' },
    );
  } finally {
    await ctx.close();
  }
});

test('preview parser is inert for hostile HTML, links, images and remote URLs', () => {
  const blocks = artifactBlocks(text);
  assert.deepEqual(blocks[0], { kind: 'heading', text: 'Synthetic' });
  assert.deepEqual(blocks[1], { kind: 'list', items: ['one', 'two'] });
  assert.deepEqual(blocks[2], { kind: 'code', text: '<img src=x onerror="bad()">' });
  assert.equal(
    blocks.some((block) => block.kind === 'code' && block.text.includes('<script>')),
    false,
  );
  assert.equal(JSON.stringify(blocks).includes('https://example.invalid'), true);
  assert.equal(readableArtifact(text).includes('[click](javascript:bad())'), true);
  assert.equal(readableArtifact(text).includes('![remote](https://example.invalid/a)'), true);
  assert.deepEqual(artifactBlocks('```\r\n# literal\r\n<img src=x>'), [
    { kind: 'code', text: '# literal\n<img src=x>' },
  ]);
  for (const hostile of [
    '<script>alert(1)</script>',
    '<img src=x onerror=bad()>',
    '[x](javascript:alert(1))',
    '![x](https://example.invalid/x.png)',
    '<a href="https://example.invalid">x</a>',
  ]) {
    const parsed = artifactBlocks(hostile);
    assert.ok(parsed.every((block) => ['text', 'heading', 'list', 'code'].includes(block.kind)));
  }
});

test('panel and activity integration are manual-only, memory-only and free of active HTML/remote fetches', () => {
  const panel = readFileSync(join(process.cwd(), 'apps/dashboard/src/ArtifactPanel.tsx'), 'utf8');
  const app = readFileSync(join(process.cwd(), 'apps/dashboard/src/App.tsx'), 'utf8');
  const preview = readFileSync(
    join(process.cwd(), 'apps/dashboard/src/artifact-preview.ts'),
    'utf8',
  );
  for (const forbidden of [
    'dangerouslySetInnerHTML',
    '<img',
    '<a ',
    'href=',
    'window.open',
    'window.location',
    'localStorage',
    'sessionStorage',
    'fetch(',
    'saveFile',
    'showSaveDialog',
    'shell.',
    'child_process',
  ])
    assert.equal(panel.includes(forbidden), false, forbidden);
  assert.match(panel, /navigator\.clipboard\.writeText/);
  assert.match(panel, /copyFailed/);
  assert.match(panel, /new TextEncoder\(\)/);
  assert.match(panel, /\/api\/artifacts\/extract/);
  assert.match(app, /event\.payload\.role === 'assistant'/);
  assert.match(app, /event\.payload\.role === 'agent'/);
  assert.match(app, /key=\{selectedSession\.id\}/);
  for (const forbidden of ['dangerouslySetInnerHTML', 'fetch(', 'window.open', '<img', '<a '])
    assert.equal(preview.includes(forbidden), false, forbidden);
});

test('HTTP returns 503 when no extractor is wired, without partial artifact data', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'orqst-artifacts-qa-http-'));
  const store = new Store(':memory:');
  const server = createLocalServer(
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
  try {
    const stored = store.ingest(event({ id: 'http-no-extractor' }))!;
    const origin = `http://127.0.0.1:${await server.listen()}`;
    const bootstrap = await fetch(origin + '/api/bootstrap');
    const cookie = bootstrap.headers.get('set-cookie')!.split(';')[0]!;
    const response = await fetch(origin + '/api/artifacts/extract', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...request(stored), sequence: stored.sequence }),
    });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'artifacts_unavailable' });
  } finally {
    await server.close();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
