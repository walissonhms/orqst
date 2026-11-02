/** Opt-in native Codex acceptance test. Never imported by the bridge or automatic suites. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import { chromium } from '@playwright/test';
import type { Snapshot, StoredEvent, StreamMessage } from '@orqst/protocol';

const base = process.env.ORQST_URL ?? 'http://127.0.0.1:4317';
const url = new URL(base);
assert.ok(
  ['127.0.0.1', 'localhost'].includes(url.hostname),
  'Live validation requires a loopback ORQST URL',
);
assert.equal(url.protocol, 'http:');
const runId = randomUUID();
const proof = `ORQST-LIVE-PROOF-${randomUUID()}`;
const dir = await mkdtemp(join(tmpdir(), 'orqst-live-acceptance-'));
try {
  await writeFile(join(dir, 'acceptance.txt'), proof + '\n', { mode: 0o600 });
  await runAcceptance();
} finally {
  await rm(dir, { recursive: true, force: true });
}

async function runAcceptance(): Promise<void> {
  const bootstrap = await fetch(base + '/api/bootstrap', { signal: AbortSignal.timeout(5000) });
  assert.ok(bootstrap.ok, 'The existing ORQST server must be running');
  const cookie = bootstrap.headers.get('set-cookie')!.split(';')[0]!;
  async function snapshot(): Promise<Snapshot> {
    const response = await fetch(base + '/api/snapshot', {
      headers: { Cookie: cookie },
      signal: AbortSignal.timeout(5000),
    });
    assert.ok(response.ok, 'Live ORQST snapshot is unavailable');
    return response.json() as Promise<Snapshot>;
  }
  let initial = await snapshot();
  const initialDeadline = Date.now() + 10000;
  while (initial.diagnostics.scanning && Date.now() < initialDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    initial = await snapshot();
  }
  assert.equal(
    initial.diagnostics.scanning,
    false,
    'Wait for the initial archive import before this check',
  );
  const seen: { event: StoredEvent; live: boolean }[] = [];
  const socket = new WebSocket(`${base.replace('http:', 'ws:')}/ws?after=${initial.cursor}`, {
    handshakeTimeout: 5000,
    headers: { Cookie: cookie, Origin: base },
  });
  socket.on('message', (raw) => {
    const message = JSON.parse(raw.toString()) as StreamMessage;
    if (message.type === 'event' && message.event.payload.cwd === dir)
      seen.push({ event: message.event, live: message.live });
  });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let child: ReturnType<typeof spawn> | undefined;
  let report: Record<string, unknown> | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let forceTimeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ locale: 'en-US' });
    const page = await context.newPage();
    await page.goto(base);
    await page.locator('.connection-connected').waitFor();
    await page.getByRole('textbox', { name: 'Search tasks, agents, or session IDs…' }).fill(runId);
    child = spawn(
      process.env.ORQST_CODEX_BIN ?? 'codex',
      [
        'exec',
        '--json',
        '--skip-git-repo-check',
        '--sandbox',
        'read-only',
        '-C',
        dir,
        '-c',
        'project_doc_max_bytes=0',
        '-c',
        'skills.include_instructions=false',
        '--disable',
        'hooks',
        '--disable',
        'plugins',
        `ORQST live acceptance test ${runId}. Use a read-only tool to read acceptance.txt in the current directory. Reply with the exact contents of that file and nothing else. Do not edit files or perform other work.`,
      ],
      { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stdout = '',
      stderr = '';
    child.stdout!.on('data', (data) => {
      stdout = (stdout + String(data)).slice(-1024 * 1024);
    });
    child.stderr!.on('data', (data) => {
      stderr = (stderr + String(data)).slice(-16000);
    });
    timeout = setTimeout(() => {
      child?.kill('SIGTERM');
      forceTimeout = setTimeout(() => child?.kill('SIGKILL'), 3000);
    }, 90000);
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      child!.once('error', reject);
      child!.once('exit', resolve);
    });
    clearTimeout(timeout);
    assert.equal(
      exitCode,
      0,
      `Native Codex acceptance failed (stderr present: ${stderr.length > 0})`,
    );
    assert.ok(stdout.includes(proof), 'Native Codex did not return the file proof');
    let current = await snapshot();
    let session = current.sessions.find((item) => item.cwd === dir);
    const until = Date.now() + 30000;
    while (
      (!session || session.status !== 'completed' || session.usage.total === 0) &&
      Date.now() < until
    ) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      current = await snapshot();
      session = current.sessions.find((item) => item.cwd === dir);
    }
    assert.ok(session, 'Native Codex session was not discovered');
    assert.equal(session.status, 'completed');
    assert.ok(session.result?.includes(proof));
    assert.ok(session.usage.total > 0);
    const types = new Set(seen.map((item) => item.event.type));
    for (const type of [
      'session.started',
      'agent.message',
      'agent.tool.started',
      'agent.tool.completed',
      'agent.tokens.updated',
      'agent.completed',
    ])
      assert.ok(types.has(type as StoredEvent['type']), `Missing live source event ${type}`);
    assert.ok(
      seen.some((item) => item.event.type === 'agent.completed' && item.live),
      'Completion was not classified live',
    );
    const source = seen.find((item) => item.event.type === 'agent.tokens.updated')!.event.source
      .file;
    const sourceRoot =
      process.env.ORQST_CODEX_SESSIONS ??
      join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'sessions');
    let expected = 0;
    for (const line of (await readFile(join(sourceRoot, source), 'utf8')).split('\n')) {
      if (!line) continue;
      let record;
      try {
        record = JSON.parse(line);
      } catch {
        continue;
      }
      if (record.type === 'token_usage_record' && record.payload.thread_id === session.id)
        expected = Math.max(expected, record.payload.thread_token_usage?.total_tokens ?? 0);
    }
    assert.ok(expected > 0, 'No independent thread-scoped total was found');
    assert.equal(session.usage.total, expected);
    await page.locator('.agent-cell').first().waitFor();
    assert.equal(await page.locator('.agent-cell').count(), 1);
    await page.locator('.agent-cell').first().click();
    await page.getByRole('region', { name: 'Session details' }).waitFor();
    await page.getByRole('button', { name: 'Latest result', exact: true }).click();
    assert.ok((await page.locator('.result-content').textContent())?.includes(proof));
    const notification = current.notifications.find(
      (item) => item.sessionId === session!.id && item.type === 'agent.completed',
    );
    if (initial.preferences.completed)
      assert.ok(notification, 'Expected completion notification is missing');
    report = {
      kind: 'native-codex-live-acceptance',
      runId,
      sessionId: session.id,
      sessionDiscovery: true,
      readOnlyToolExecution: true,
      sourceEvents: [...types].sort(),
      liveCompletion: true,
      completionNotification: initial.preferences.completed
        ? Boolean(notification)
        : 'disabled by preference',
      cumulativeTokensMatchSource: true,
      totalTokens: session.usage.total,
      browserUpdatedWithoutRefresh: true,
      browserResultMatchesSource: true,
      remoteAgentControl: false,
    };
  } finally {
    if (timeout) clearTimeout(timeout);
    if (forceTimeout) clearTimeout(forceTimeout);
    if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    socket.terminate();
    await browser?.close();
  }
  console.log(JSON.stringify(report, null, 2));
}
