// SYNTHETIC fixtures only; no real user transcripts, paths, or credentials.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '@orqst/database';
import { AntigravityObserver } from '@orqst/adapter-antigravity';
import type { ModelAnalyticsSummary, Snapshot } from '@orqst/protocol';
import { createBridge } from '../apps/bridge/src/app.js';

const jsonl = (value: unknown) => JSON.stringify(value) + '\n';
const sessionA = '11111111-1111-4111-8111-111111111111';
const sessionB = '22222222-2222-4222-8222-222222222222';

async function logsDir(root: string, sessionId: string): Promise<string> {
  const dir = join(root, 'brain', sessionId, '.system_generated', 'logs');
  await mkdir(dir, { recursive: true });
  return dir;
}

test('handles partial UTF-8 writes, malformed records, restart, truncation, in-place rewrite, rotation and duplicate replay', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'orqst-agy-observer-'));
  const root = join(dir, 'antigravity-cli');
  const logsA = await logsDir(root, sessionA);
  const file = join(logsA, 'transcript_full.jsonl');
  const dbPath = join(dir, 'orqst.db');
  let store = new Store(dbPath);
  let observer = new AntigravityObserver({ root, store });

  try {
    const step0 = {
      step_index: 0,
      source: 'USER_EXPLICIT',
      type: 'USER_INPUT',
      status: 'DONE',
      created_at: '2026-11-18T04:00:00Z',
      content: 'Synthetic prompt',
    };
    const step1Running = {
      step_index: 1,
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      status: 'RUNNING',
      created_at: '2026-11-18T04:00:01Z',
      model: 'synthetic-gemini-4',
    };
    const step1Done = {
      step_index: 1,
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      status: 'DONE',
      created_at: '2026-11-18T04:00:02Z',
      model: 'synthetic-gemini-4',
      input_tokens: 5000,
      output_tokens: 300,
      cache_read_tokens: 12000,
      content: 'Synthetic conclusão 🚀',
    };

    const encodedDone = Buffer.from(JSON.stringify(step1Done));
    const split = encodedDone.indexOf(Buffer.from('🚀')) + 2;
    await writeFile(file, jsonl(step0) + '{broken-json}\n');
    await appendFile(file, encodedDone.subarray(0, split));

    await observer.scan();
    assert.equal(observer.diagnostics.malformed, 1);
    assert.equal(store.sessions().length, 1);
    assert.equal(store.sessions()[0]?.status, 'running');
    assert.equal(store.sessions()[0]?.result, null);

    // Complete the partial UTF-8 line and scan again.
    await appendFile(file, Buffer.concat([encodedDone.subarray(split), Buffer.from('\n')]));
    await observer.scan();
    assert.equal(store.sessions()[0]?.status, 'completed');
    assert.equal(store.sessions()[0]?.result, 'Synthetic conclusão 🚀');
    assert.equal(store.sessions()[0]?.model, 'synthetic-gemini-4');
    assert.equal(store.sessions()[0]?.usageRecorded, false);
    assert.equal(store.totals().total, 0);

    const eventsAfterCompletion = store.cursor();

    // Duplicate replay and observer restart are idempotent.
    await observer.scan();
    assert.equal(store.cursor(), eventsAfterCompletion);
    await observer.stop();
    store.close();
    store = new Store(dbPath);
    observer = new AntigravityObserver({ root, store });
    await observer.scan();
    assert.equal(store.cursor(), eventsAfterCompletion);

    // Truncation + in-place rewrite (step 1 RUNNING -> rewritten to DONE on session B).
    const logsB = await logsDir(root, sessionB);
    const fileB = join(logsB, 'transcript_full.jsonl');
    await writeFile(fileB, jsonl(step0) + jsonl(step1Running));
    await observer.scan();
    assert.equal(store.sessions().find((s) => s.id === sessionB)?.status, 'running');

    // Rewrite fileB in place from RUNNING to DONE (anchor & size change).
    await writeFile(
      fileB,
      jsonl(step0) +
        jsonl({ ...step1Done, created_at: '2026-11-18T04:00:05Z', content: 'Synthetic rewritten' }),
    );
    await observer.scan();
    assert.equal(store.sessions().find((s) => s.id === sessionB)?.status, 'completed');
    assert.equal(store.sessions().find((s) => s.id === sessionB)?.result, 'Synthetic rewritten');

    // File rotation via atomic rename (`dev:ino` replacement) + late metadata workspace update.
    const rotatedTmp = join(logsB, 'transcript_full.jsonl.next');
    await writeFile(
      rotatedTmp,
      jsonl(step0) +
        jsonl({ ...step1Done, created_at: '2026-11-18T04:00:06Z', content: 'Synthetic rotated' }),
    );
    await rename(rotatedTmp, fileB);
    await observer.scan();
    assert.equal(store.sessions().find((s) => s.id === sessionB)?.result, 'Synthetic rotated');

    // Metadata cache arrives after EOF without growing transcript_full.jsonl.
    await mkdir(join(root, 'cache'), { recursive: true });
    await writeFile(
      join(root, 'cache', 'conversation_metadata.json'),
      JSON.stringify({
        'synthetic-proj': {
          [sessionB]: {
            summary: {
              ID: sessionB,
              AgentName: 'Synthetic Agent B',
              UpdatedAt: '2026-11-18T04:00:07Z',
              WorkspaceURIs: ['file:///synthetic/workspace-b'],
            },
          },
        },
      }),
    );
    await observer.scan();
    const updatedB = store.sessions().find((s) => s.id === sessionB);
    assert.equal(updatedB?.cwd, '/synthetic/workspace-b');
    assert.equal(updatedB?.agentName, 'Synthetic Agent B');
  } finally {
    await observer.stop();
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('prefers transcript_full.jsonl over transcript.jsonl, ignores non-transcript files, rejects symlinks and skips oversized lines', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'orqst-agy-safety-'));
  const root = join(dir, 'antigravity-cli');
  const logsA = await logsDir(root, sessionA);
  const fullFile = join(logsA, 'transcript_full.jsonl');
  const compactFile = join(logsA, 'transcript.jsonl');

  const content =
    jsonl({
      step_index: 0,
      source: 'USER_EXPLICIT',
      type: 'USER_INPUT',
      status: 'DONE',
      created_at: '2026-11-18T04:10:00Z',
      content: 'Synthetic full prompt',
    }) +
    'x'.repeat(3 * 1024 * 1024) +
    '\n' +
    jsonl({
      step_index: 1,
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      status: 'DONE',
      created_at: '2026-11-18T04:10:02Z',
      content: 'Synthetic recovered after oversized line',
    });

  await writeFile(fullFile, content);
  await writeFile(
    compactFile,
    jsonl({
      step_index: 0,
      source: 'USER_EXPLICIT',
      type: 'USER_INPUT',
      status: 'DONE',
      created_at: '2026-11-18T04:10:00Z',
      content: 'Truncated compact variant should not be double-read',
      truncated_fields: ['content'],
    }),
  );

  // Non-transcript files at top-level must never be parsed as transcripts.
  await writeFile(join(root, 'settings.json'), '{"synthetic":"ignored"}');
  await writeFile(join(root, 'history.jsonl'), '{"display":"/help","timestamp":1}\n');

  // Symlinked session directory escaping root must be ignored.
  const outside = join(dir, 'outside-session');
  await mkdir(join(outside, '.system_generated', 'logs'), { recursive: true });
  await writeFile(
    join(outside, '.system_generated', 'logs', 'transcript_full.jsonl'),
    jsonl({
      step_index: 0,
      source: 'USER_EXPLICIT',
      type: 'USER_INPUT',
      status: 'DONE',
      created_at: '2026-11-18T04:10:00Z',
      content: 'Outside root must not be read',
    }),
  );
  await symlink(outside, join(root, 'brain', 'escaped-symlink'));

  // Session B has only compact transcript.jsonl (fallback).
  const logsB = await logsDir(root, sessionB);
  await writeFile(
    join(logsB, 'transcript.jsonl'),
    jsonl({
      step_index: 0,
      source: 'USER_EXPLICIT',
      type: 'USER_INPUT',
      status: 'DONE',
      created_at: '2026-11-18T04:11:00Z',
      content: 'Synthetic compact fallback',
    }),
  );

  const store = new Store(':memory:');
  const observer = new AntigravityObserver({ root, store });
  try {
    await observer.scan();
    assert.equal(observer.diagnostics.files, 2);
    assert.equal(observer.diagnostics.oversized, 1);
    assert.equal(store.sessions().length, 2);
    assert.equal(
      store.sessions().find((s) => s.id === sessionA)?.result,
      'Synthetic recovered after oversized line',
    );
    assert.equal(
      store.sessions().find((s) => s.id === sessionB)?.task,
      'Synthetic compact fallback',
    );
    assert.equal(await readFile(fullFile, 'utf8'), content);
  } finally {
    await observer.stop();
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('Bridge composes Codex and Antigravity observers, exposes antigravityDescriptor and reports honest model analytics without fabricated usage', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'orqst-agy-bridge-'));
  const codexRoot = join(dir, 'codex-sessions');
  const agyRoot = join(dir, 'antigravity-cli');
  const dataDir = join(dir, 'data');
  await mkdir(codexRoot, { recursive: true });
  await writeFile(join(dir, 'index.html'), '<!doctype html><title>Synthetic dashboard</title>');

  const logs = await logsDir(agyRoot, sessionA);
  const transcriptPath = join(logs, 'transcript_full.jsonl');
  await writeFile(
    transcriptPath,
    jsonl({
      step_index: 0,
      source: 'USER_EXPLICIT',
      type: 'USER_INPUT',
      status: 'DONE',
      created_at: new Date(Date.now() - 5000).toISOString(),
      content: 'Synthetic bridge task',
    }),
  );

  const bridge = createBridge({
    port: 0,
    dataDir,
    sessionsDir: codexRoot,
    antigravityDir: agyRoot,
    dashboardDir: dir,
    retentionDays: 30,
    pollMs: 50,
    dev: false,
  });

  try {
    const port = await bridge.start();
    const base = `http://127.0.0.1:${port}`;
    const boot = await fetch(base + '/api/bootstrap');
    const cookie = boot.headers.get('set-cookie')!.split(';')[0]!;

    const now = new Date().toISOString();
    await appendFile(
      transcriptPath,
      jsonl({
        step_index: 1,
        source: 'MODEL',
        type: 'PLANNER_RESPONSE',
        status: 'DONE',
        created_at: now,
        model: 'synthetic-gemini-carbon',
        input_tokens: 1400,
        output_tokens: 250,
        cache_read_tokens: 9000,
        content: 'Synthetic live completion',
      }),
    );

    const deadline = Date.now() + 3000;
    while (bridge.core.store.sessions()[0]?.status !== 'completed' && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    const snapRes = await fetch(base + '/api/snapshot', { headers: { Cookie: cookie } });
    assert.equal(snapRes.status, 200);
    const snapshot = (await snapRes.json()) as Snapshot;
    assert.deepEqual(
      snapshot.adapters.map((item) => item.id),
      ['codex', 'claude', 'opencode', 'antigravity'],
    );
    const agySession = snapshot.sessions.find((item) => item.id === sessionA);
    assert.ok(agySession);
    assert.equal(agySession.adapter, 'antigravity');
    assert.equal(agySession.status, 'completed');
    assert.equal(agySession.model, 'synthetic-gemini-carbon');
    assert.equal(agySession.usageRecorded, false);
    assert.equal(snapshot.notifications.length, 1);

    const analyticsRes = await fetch(base + '/api/analytics/models?adapter=antigravity', {
      headers: { Cookie: cookie },
    });
    assert.equal(analyticsRes.status, 200);
    const report = (await analyticsRes.json()) as ModelAnalyticsSummary;
    assert.equal(report.sessions, 1);
    assert.equal(report.usage, null);
    assert.equal(report.coverage.sessionsWithCanonicalUsage, 0);
    assert.equal(report.models[0]?.adapter, 'antigravity');
    assert.equal(report.models[0]?.model, 'synthetic-gemini-carbon');
    assert.equal(report.models[0]?.usage, null);
    assert.ok(report.coverage.gaps.some((gap) => gap.reason === 'usage_not_reported'));
  } finally {
    await bridge.stop();
    await rm(dir, { recursive: true, force: true });
  }
});
