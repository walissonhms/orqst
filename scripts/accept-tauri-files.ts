import assert from 'node:assert/strict';
import { constants } from 'node:fs';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { once } from 'node:events';
import { cp, mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { chromium, expect } from '@playwright/test';

// Shipped Node/Core/file host + actual dashboard buttons. Native IPC/dialog/open are doubles.
// All files are disposable; no installed provider, source credentials or user data are used.
const dir = await mkdtemp(join(tmpdir(), 'orqst-tauri-files-acceptance-'));
const distribution = resolve('apps/tauri/dist');
const runtime = JSON.parse(await readFile(join(distribution, 'core/runtime.json'), 'utf8')) as {
  target: string;
};
const binary = resolve(
  `apps/tauri/src-tauri/binaries/orqst-node-${runtime.target}${process.platform === 'win32' ? '.exe' : ''}`,
);
const children: ChildProcessWithoutNullStreams[] = [];
const exited: Promise<unknown>[] = [];
const launch = (args: string[]) => {
  const child = spawn(join(dir, 'node'), args, {
    cwd: dir,
    env: {
      HOME: dir,
      USERPROFILE: dir,
      SYSTEMROOT: process.env.SYSTEMROOT,
      ORQST_DATA_DIR: join(dir, 'state'),
      ORQST_CODEX_SESSIONS: join(dir, 'sessions'),
      LANG: 'en_US.UTF-8',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  children.push(child);
  exited.push(once(child, 'exit'));
  child.stderr.resume();
  return child;
};
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let deadline: ReturnType<typeof setTimeout> | undefined;
const pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void }>();
try {
  await cp(binary, join(dir, 'node'), { mode: constants.COPYFILE_FICLONE });
  await cp(join(distribution, 'core'), join(dir, 'core'), { recursive: true });
  await cp(join(distribution, 'dashboard'), join(dir, 'dashboard'), { recursive: true });
  await cp(join(distribution, 'files'), join(dir, 'files'), { recursive: true });
  await mkdir(join(dir, 'sessions'));
  const original = '# Synthetic Tauri export 😀\n<script>inert()</script>';
  const content = [
    {
      timestamp: '2026-11-04T03:00:00.000Z',
      type: 'session_meta',
      payload: {
        id: 'synthetic-tauri-export',
        cwd: '/synthetic/export-project',
        originator: 'codex_cli_rs',
        cli_version: 'synthetic',
      },
    },
    {
      timestamp: '2026-11-04T03:00:01.000Z',
      type: 'response_item',
      payload: { type: 'message', role: 'assistant', content: original },
    },
  ]
    .map((value) => JSON.stringify(value) + '\n')
    .join('');
  await writeFile(join(dir, 'sessions/synthetic.jsonl'), content);
  const core = launch([join(dir, 'core/desktop-sidecar.mjs'), join(dir, 'dashboard')]);
  const coreLines = createInterface({ input: core.stdout });
  const port = await new Promise<string>((accept, reject) => {
    deadline = setTimeout(() => reject(new Error('Core readiness timeout')), 30000);
    coreLines.once('line', (line) => {
      const match = /^ORQST_CORE_READY ([0-9]+)$/.exec(line);
      if (match) accept(match[1]!);
      else reject(new Error('Invalid Core readiness'));
    });
    core.once('error', reject);
  });
  clearTimeout(deadline);
  const origin = `http://127.0.0.1:${port}`;
  const host = launch([join(dir, 'core/tauri-files-host.cjs'), origin]);
  const lines = createInterface({ input: host.stdout });
  let path: string | null = join(dir, 'original.md');
  let overwrite = true;
  let openCount = 0;
  let dialogCount = 0;
  const ready = new Promise<void>((accept, reject) => {
    deadline = setTimeout(() => reject(new Error('File host readiness timeout')), 10000);
    host.once('error', reject);
    lines.on('line', (line) => {
      const value = JSON.parse(line) as Record<string, unknown>;
      if (value.kind === 'ready') {
        clearTimeout(deadline);
        accept();
        return;
      }
      if (value.kind === 'reply') {
        const item = pending.get(String(value.id));
        pending.delete(String(value.id));
        item?.resolve(value.value);
        return;
      }
      dialogCount++;
      let answer: string | boolean | null;
      if (value.kind === 'choose') answer = path;
      else if (value.kind === 'confirm') answer = value.detail ? overwrite : true;
      else if (value.kind === 'open') {
        openCount++;
        answer = true;
      } else throw new Error('Unexpected private file message');
      host.stdin.write(JSON.stringify({ kind: 'dialog', id: value.id, value: answer }) + '\n');
    });
  });
  await ready;
  host.stdin.write(JSON.stringify({ kind: 'revoke', document: 1 }) + '\n');
  let sequence = 0;
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ locale: 'en-US' });
  let lastArtifact: unknown;
  const requestHost = (request: unknown, source: string) =>
    new Promise((resolve, reject) => {
      const id = String(++sequence);
      pending.set(id, { resolve, reject });
      host.stdin.write(
        JSON.stringify({ kind: 'request', id, document: 1, request, source }) + '\n',
      );
    });
  await page.exposeFunction('__nativeFileRequest', (request: unknown) => {
    if (request && typeof request === 'object' && 'kind' in request && request.kind === 'artifact')
      lastArtifact = request;
    return requestHost(request, page.url());
  });
  await page.addInitScript({
    content: `
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {
      invoke(command, payload) {
        if (command !== 'file_request') throw new Error('Export-only test transport');
        return window.__nativeFileRequest(payload.request);
      }
    } });
    ${await readFile(join(dir, 'files/client.js'), 'utf8')}
  `,
  });
  await page.goto(origin + '/#session=synthetic-tauri-export');
  await page
    .getByRole('button', { name: 'Extract artifact manually', exact: true })
    .first()
    .click();
  const panel = page.getByRole('region', { name: 'Manual artifact', exact: true });
  await panel.getByRole('button', { name: 'Save original Markdown…', exact: true }).click();
  await expect(panel.getByRole('status')).toHaveText('Markdown file saved.');
  assert.equal(await readFile(path!, 'utf8'), original);
  const beforeRouteProbes = dialogCount;
  for (const source of [
    origin + '/api/bootstrap',
    origin + '/unknown',
    'http://example.invalid/models',
  ]) {
    assert.deepEqual(await requestHost(lastArtifact, source), { status: 'failed' });
  }
  assert.equal(dialogCount, beforeRouteProbes);
  assert.equal((await stat(path!)).mode & 0o777, 0o600);
  overwrite = false;
  await panel.getByRole('button', { name: 'Save original Markdown…', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('Save cancelled.');
  assert.equal(await readFile(path!, 'utf8'), original);
  overwrite = true;
  path = join(dir, 'draft.md');
  await panel.getByRole('button', { name: 'Edit draft', exact: true }).click();
  await panel.getByRole('textbox').fill('# Synthetic edited draft');
  await panel
    .getByRole('button', { name: 'Save draft and open in default app…', exact: true })
    .click();
  await expect(panel.getByRole('status')).toContainText('handed to the system default application');
  assert.equal(await readFile(path, 'utf8'), '# Synthetic edited draft');
  assert.equal(openCount, 1);
  await panel.getByRole('textbox').fill(original);
  // Use actual path-based sidebar navigation; this preserves the native document.
  await page.locator('a[href="/models"]').click();
  const csv = page.getByRole('button', { name: 'Export CSV', exact: true });
  await expect(csv).toBeEnabled();
  path = join(dir, 'analytics.csv');
  await csv.click();
  await expect(
    page.getByText('Report saved. Refresh for another export.', { exact: true }),
  ).toBeVisible();
  assert.ok((await readFile(path, 'utf8')).includes('orqst.model-usage'));
  await expect(csv).toBeDisabled();
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  const markdown = page.getByRole('button', { name: 'Export Markdown', exact: true });
  await expect(markdown).toBeEnabled();
  path = join(dir, 'analytics.md');
  await markdown.click();
  await expect(
    page.getByText('Report saved. Refresh for another export.', { exact: true }),
  ).toBeVisible();
  assert.ok((await readFile(path)).byteLength > 0);
  assert.equal(await readFile(join(dir, 'sessions/synthetic.jsonl'), 'utf8'), content);
  assert.ok(dialogCount >= 8);
  assert.equal(pending.size, 0);
  await browser.close();
  browser = undefined;
  host.stdin.end('shutdown\n');
  core.stdin.end('shutdown\n');
  await Promise.all(exited);
  assert.ok(children.every((child) => child.exitCode === 0));
  console.log(
    'PASS: copied Node/Core/file host and real dashboard buttons saved retained/draft Markdown and Analytics CSV/Markdown; overwrite cancellation, consumption, private permissions, source immutability and shutdown passed. Native IPC/dialog/open were simulated.',
  );
} finally {
  clearTimeout(deadline);
  await browser?.close();
  for (const value of pending.values()) value.reject(new Error('Acceptance closed'));
  for (const child of children)
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  await Promise.all(exited);
  await rm(dir, { recursive: true, force: true });
}
