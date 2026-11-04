import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { chromium } from '@playwright/test';
import type { ModelAnalyticsSummary, Snapshot } from '@orqst/protocol';

// Packaging acceptance, deliberately outside CI and without any real CLI execution.
// Copy the shipped bundles outside the checkout so workspace node_modules cannot help.
const fixture = await mkdtemp(join(tmpdir(), 'orqst-tauri-core-acceptance-'));
const distribution = resolve('apps/tauri/dist');
const runtime = JSON.parse(await readFile(join(distribution, 'core/runtime.json'), 'utf8')) as {
  target: string;
};
const node = resolve(
  `apps/tauri/src-tauri/binaries/orqst-node-${runtime.target}${process.platform === 'win32' ? '.exe' : ''}`,
);
await cp(join(distribution, 'core'), join(fixture, 'core'), { recursive: true });
await cp(join(distribution, 'dashboard'), join(fixture, 'dashboard'), { recursive: true });
await mkdir(join(fixture, 'sessions'));
await writeFile(
  join(fixture, 'sessions/synthetic.jsonl'),
  JSON.stringify({
    timestamp: '2026-11-04T03:00:00.000Z',
    type: 'session_meta',
    payload: {
      id: 'synthetic-tauri-acceptance',
      cwd: '/synthetic/tauri-project',
      originator: 'codex_cli_rs',
      cli_version: 'synthetic',
    },
  }) + '\n',
);
const child = spawn(node, [join(fixture, 'core/desktop-sidecar.mjs'), join(fixture, 'dashboard')], {
  cwd: fixture,
  env: {
    HOME: fixture,
    USERPROFILE: fixture,
    SYSTEMROOT: process.env.SYSTEMROOT,
    ORQST_DATA_DIR: join(fixture, 'state'),
    ORQST_CODEX_SESSIONS: join(fixture, 'sessions'),
  },
  stdio: ['pipe', 'pipe', 'pipe'],
});
let diagnostics = '';
child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
  diagnostics = (diagnostics + chunk).slice(-8192);
});
const exited = once(child, 'exit');
const lines = createInterface({ input: child.stdout });
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
try {
  const port = await new Promise<number>((accept, reject) => {
    timer = setTimeout(() => reject(new Error('Packaged Core readiness timed out')), 30_000);
    lines.once('line', (line: string) => {
      const match = /^ORQST_CORE_READY ([0-9]+)$/.exec(line);
      if (!match) reject(new Error('Invalid packaged Core readiness'));
      else accept(Number(match[1]));
    });
    child.once('error', reject);
    child.once('exit', () =>
      reject(new Error(`Packaged Core exited before readiness: ${diagnostics}`)),
    );
  });
  clearTimeout(timer);
  browser = await chromium.launch({ headless: true });
  const base = `http://127.0.0.1:${port}`;
  const page = await browser.newPage({ locale: 'en-US' });
  await page.goto(base);
  await page.getByRole('heading', { name: 'Your agents, in focus.' }).waitFor();
  await page.locator('.agent-cell').first().waitFor();
  const snapshot = await page.request.get(base + '/api/snapshot');
  assert.equal(snapshot.status(), 200);
  assert.equal(((await snapshot.json()) as Snapshot).sessions[0]?.id, 'synthetic-tauri-acceptance');
  const analytics = await page.request.get(base + '/api/analytics/models');
  assert.equal(analytics.status(), 200);
  assert.equal(
    ((await analytics.json()) as ModelAnalyticsSummary).contract,
    'orqst.model-analytics',
  );
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('heading', { name: 'Settings', exact: true }).waitFor();
  child.stdin.end('shutdown\n');
  timer = setTimeout(() => child.kill('SIGKILL'), 5000);
  const [code, signal] = await exited;
  assert.equal(code, 0);
  assert.equal(signal, null);
  await assert.rejects(fetch(base + '/api/bootstrap', { signal: AbortSignal.timeout(1000) }));
  console.log(
    'PASS: packaged Node/Core, dashboard, cookie API, Analytics worker and graceful shutdown outside the checkout (synthetic data).',
  );
} finally {
  clearTimeout(timer);
  lines.close();
  await browser?.close();
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  await exited;
  await rm(fixture, { recursive: true, force: true });
}
