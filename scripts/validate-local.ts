/** Read actual local Codex and Antigravity data into isolated disposable databases. Prints aggregates only. */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, stat, lstat, readFile, writeFile, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { Store } from '@orqst/database';
import { CodexObserver } from '@orqst/adapter-codex';
import { AntigravityObserver } from '@orqst/adapter-antigravity';
import { object } from '@orqst/shared';
import { smokeBuilt } from './smoke-built.js';
const source =
  process.env.ORQST_CODEX_SESSIONS ??
  join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'sessions');
const files: { path: string; mtime: number; size: number }[] = [];
async function walk(dir: string): Promise<void> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await walk(path);
    else if (entry.isFile() && path.endsWith('.jsonl')) {
      const info = await stat(path);
      if (info.size > 0 && info.size < 5 * 1024 * 1024)
        files.push({ path, mtime: info.mtimeMs, size: info.size });
    }
  }
}
await walk(source);
const selected = files.sort((a, b) => b.mtime - a.mtime).slice(0, 8);
if (!selected.length) throw new Error('No bounded local Codex files found');
const dir = await mkdtemp(join(tmpdir(), 'orqst-real-validation-'));
const root = join(dir, 'sessions');
await mkdir(root, { mode: 0o700 });
const database = join(dir, 'orqst.db');
let store = new Store(database);
let observer = new CodexObserver({ root, store });
const snapshots: { path: string; bytes: Buffer; hash: string }[] = [];
const expected = new Map<string, number>();
let result: Record<string, unknown> | undefined;
let modernRecords = 0,
  mirrorRecords = 0;
try {
  for (const [index, file] of selected.entries()) {
    const bytes = await readFile(file.path);
    snapshots.push({
      path: file.path,
      bytes,
      hash: createHash('sha256').update(bytes).digest('hex'),
    });
    await writeFile(join(root, `${index}.jsonl`), bytes, { mode: 0o600 });
    let id = '',
      floor = 0;
    const lines = bytes.toString('utf8').split('\n');
    lines.pop();
    for (const line of lines) {
      let raw: unknown;
      try {
        raw = JSON.parse(line);
      } catch {
        continue;
      }
      const r = object(raw),
        p = object(r.payload);
      if (r.type === 'session_meta' && !id) {
        id = String(p.id ?? p.session_id ?? '');
        floor = Number(p.subagent_history_start_ordinal ?? 0);
      }
      if (Number(r.ordinal ?? floor) < floor) continue;
      if (r.type === 'token_usage_record' && (!p.thread_id || p.thread_id === id)) {
        const usage = object(p.thread_token_usage);
        if (typeof usage.total_tokens === 'number') {
          modernRecords++;
          expected.set(id, Math.max(expected.get(id) ?? 0, usage.total_tokens));
        }
      }
      if (r.type === 'event_msg' && p.type === 'token_count') mirrorRecords++;
    }
  }
  await observer.scan();
  // Observer uses an 8 MiB budget per file; selected files are below 5 MiB.
  assert.equal(observer.diagnostics.errors, 0);
  assert.equal(observer.diagnostics.malformed, 0);
  const sessions = store.sessions();
  for (const [id, total] of expected)
    assert.equal(sessions.find((session) => session.id === id)?.usage.total, total);
  const cursor = store.cursor(),
    usage = store.totals();
  await observer.scan();
  assert.equal(store.cursor(), cursor);
  assert.deepEqual(store.totals(), usage);
  await observer.stop();
  store.close();
  store = new Store(database);
  observer = new CodexObserver({ root, store });
  await observer.scan();
  assert.equal(store.cursor(), cursor);
  assert.deepEqual(store.totals(), usage);
  // The source can legitimately grow during validation. Verify its captured prefix remains intact.
  for (const snapshot of snapshots) {
    const current = await readFile(snapshot.path);
    assert.equal(
      createHash('sha256').update(current.subarray(0, snapshot.bytes.length)).digest('hex'),
      snapshot.hash,
    );
  }
  const withBrowser = process.argv.includes('--with-browser');
  if (withBrowser) await smokeBuilt(root, dir, sessions.length);

  const antigravitySource =
    process.env.ORQST_ANTIGRAVITY_HOME ?? join(homedir(), '.gemini', 'antigravity-cli');
  const antigravityCandidates: {
    sessionId: string;
    path: string;
    name: 'transcript_full.jsonl' | 'transcript.jsonl';
    mtime: number;
  }[] = [];
  try {
    const brainDir = join(antigravitySource, 'brain');
    for (const entry of await readdir(brainDir, { withFileTypes: true })) {
      if (entry.isSymbolicLink() || !entry.isDirectory()) continue;
      const logsDir = join(brainDir, entry.name, '.system_generated', 'logs');
      for (const name of ['transcript_full.jsonl', 'transcript.jsonl'] as const) {
        const candidate = join(logsDir, name);
        try {
          const info = await lstat(candidate);
          if (
            !info.isSymbolicLink() &&
            info.isFile() &&
            info.size > 0 &&
            info.size < 5 * 1024 * 1024
          ) {
            antigravityCandidates.push({
              sessionId: entry.name,
              path: candidate,
              name,
              mtime: info.mtimeMs,
            });
            break;
          }
        } catch {
          continue;
        }
      }
    }
  } catch {
    /* Antigravity transcripts are optional when the CLI has no local sessions yet. */
  }
  const selectedAntigravity = antigravityCandidates.sort((a, b) => b.mtime - a.mtime).slice(0, 8);
  let antigravityValidation: Record<string, unknown> = { status: 'not_present' };
  if (selectedAntigravity.length > 0) {
    const agyRoot = join(dir, 'antigravity');
    const agyDb = join(dir, 'orqst-antigravity.db');
    await mkdir(agyRoot, { mode: 0o700 });
    const metadataSource = join(antigravitySource, 'cache', 'conversation_metadata.json');
    try {
      const metaStat = await lstat(metadataSource);
      if (
        !metaStat.isSymbolicLink() &&
        metaStat.isFile() &&
        metaStat.size > 0 &&
        metaStat.size < 4 * 1024 * 1024
      ) {
        await mkdir(join(agyRoot, 'cache'), { mode: 0o700 });
        await writeFile(
          join(agyRoot, 'cache', basename(metadataSource)),
          await readFile(metadataSource),
          { mode: 0o600 },
        );
      }
    } catch {
      /* Metadata cache is optional. */
    }
    const agySnapshots: { path: string; bytes: Buffer; hash: string }[] = [];
    for (const item of selectedAntigravity) {
      const bytes = await readFile(item.path);
      agySnapshots.push({
        path: item.path,
        bytes,
        hash: createHash('sha256').update(bytes).digest('hex'),
      });
      const targetDir = join(agyRoot, 'brain', item.sessionId, '.system_generated', 'logs');
      await mkdir(targetDir, { recursive: true, mode: 0o700 });
      await writeFile(join(targetDir, item.name), bytes, { mode: 0o600 });
    }
    let agyStore = new Store(agyDb);
    let agyObserver = new AntigravityObserver({ root: agyRoot, store: agyStore });
    try {
      await agyObserver.scan();
      assert.equal(agyObserver.diagnostics.errors, 0);
      assert.equal(agyObserver.diagnostics.malformed, 0);
      const agySessions = agyStore.sessions();
      assert.equal(agySessions.length, selectedAntigravity.length);
      assert.equal(agyStore.totals().total, 0);
      assert.ok(agySessions.every((session) => session.usageRecorded === false));
      const agyCursor = agyStore.cursor();
      await agyObserver.scan();
      assert.equal(agyStore.cursor(), agyCursor);
      await agyObserver.stop();
      agyStore.close();
      agyStore = new Store(agyDb);
      agyObserver = new AntigravityObserver({ root: agyRoot, store: agyStore });
      await agyObserver.scan();
      assert.equal(agyStore.cursor(), agyCursor);
      for (const snapshot of agySnapshots) {
        const current = await readFile(snapshot.path);
        assert.equal(
          createHash('sha256').update(current.subarray(0, snapshot.bytes.length)).digest('hex'),
          snapshot.hash,
        );
      }
      antigravityValidation = {
        status: 'validated',
        sourceFiles: selectedAntigravity.length,
        sessions: agySessions.length,
        workspaces: agyStore.workspaces().length,
        events: agyCursor,
        modelsObserved: new Set(agySessions.map((session) => session.model).filter(Boolean)).size,
        usageRecordedSessions: agySessions.filter((session) => session.usageRecorded).length,
        malformed: agyObserver.diagnostics.malformed,
        errors: agyObserver.diagnostics.errors,
        replayStable: true,
        restartStable: true,
        sourcePrefixesUnchanged: true,
      };
    } finally {
      await agyObserver.stop();
      agyStore.close();
    }
  }

  result = {
    kind: 'real-local-data-validation',
    sourceFiles: selected.length,
    sessions: sessions.length,
    workspaces: store.workspaces().length,
    events: cursor,
    modernTokenRecords: modernRecords,
    compatibilityTokenMirrors: mirrorRecords,
    verifiedCumulativeSessions: expected.size,
    verifiedParentRelationships: sessions.filter((session) => session.parentSessionId).length,
    malformed: observer.diagnostics.malformed,
    errors: observer.diagnostics.errors,
    replayStable: true,
    restartStable: true,
    sourcePrefixesUnchanged: true,
    builtBridgeSmoke: withBrowser,
    realBrowserSmoke: withBrowser,
    antigravity: antigravityValidation,
  };
} finally {
  await observer.stop();
  store.close();
  await rm(dir, { recursive: true, force: true });
}

console.log(JSON.stringify({ ...result, temporaryDataDeleted: true }, null, 2));
