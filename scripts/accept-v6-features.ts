// Explicit disposable packaging acceptance. Native focus/dialogs are simulated; no provider runs.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import en from '../apps/dashboard/src/locales/en-US.json';
import pt from '../apps/dashboard/src/locales/pt-BR.json';
import { once } from 'node:events';
import { cp, mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { DatabaseSync } from 'node:sqlite';
import { stableId } from '@orqst/shared';
import {
  terminalLayoutRecordSchema,
  featureNativeReplySchema,
  type FeatureNativeRequest,
} from '@orqst/protocol';
import type { TerminalLayoutState } from '../apps/desktop/src/terminal-layout.js';
import { chromium, expect, type Frame, type Page } from '@playwright/test';
import { terminalNativeReplySchema, type TerminalNativeRequest } from '@orqst/protocol';
import {
  managedCodexSettings,
  terminalExecutableSha256,
  type ManagedCodexConfig,
} from '../packages/core/src/terminal/codex-profile.js';

const language = process.argv[3] === '--locale=pt-BR' ? 'pt-BR' : 'en-US';
assert.deepEqual(
  process.argv.slice(2),
  language === 'pt-BR'
    ? ['--authorize-synthetic-features', '--locale=pt-BR']
    : ['--authorize-synthetic-features'],
);
const ui = language === 'pt-BR' ? pt : en;
const count = 6;
const fixture = await realpath(await mkdtemp(join(tmpdir(), 'orqst-feature-acceptance-')));
await cp('apps/tauri/dist/core', join(fixture, 'core'), {
  recursive: true,
  mode: constants.COPYFILE_FICLONE,
});
const runtime = JSON.parse(await readFile('apps/tauri/dist/core/runtime.json', 'utf8')) as {
  target: string;
  nodeSha256: string;
};
for (const name of await readdir('apps/tauri/dist/core')) {
  if (!name.endsWith('.cjs') && name !== 'runtime.json') continue;
  const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
  assert.equal(
    digest(await readFile(join(fixture, 'core', name))),
    digest(await readFile(join('apps/tauri/dist/core', name))),
  );
}
const node = join(fixture, 'node');
await cp(`apps/tauri/src-tauri/binaries/orqst-node-${runtime.target}`, node, {
  mode: constants.COPYFILE_FICLONE,
});
assert.equal(terminalExecutableSha256(node), runtime.nodeSha256);
const executable = join(fixture, 'synthetic-pty');
execFileSync('cc', [
  '-O2',
  '-DORQST_SYNTHETIC_TIMEOUT_SECONDS=90',
  resolve('tests/helpers/managed-terminal-fixture.c'),
  '-o',
  executable,
]);
const project = join(fixture, 'project');
await mkdir(project, { mode: 0o700 });
const manifests: string[] = [];
for (let slot = 0; slot < count; slot++) {
  const state = join(fixture, `state-${slot}`);
  for (const directory of [state, ...['home', 'codex', 'tmp'].map((p) => join(state, p))])
    await mkdir(directory, { mode: 0o700 });
  const config: ManagedCodexConfig = {
    version: 1,
    trust: 'native-same-user',
    executable: { path: executable, sha256: terminalExecutableSha256(executable) },
    executableVersion: 'SYNTHETIC-NOT-A-PROVIDER',
    node: { path: node, sha256: terminalExecutableSha256(node) },
    project,
    state,
  };
  const manifest = join(fixture, `manifest-${slot}.json`);
  await writeFile(manifest, JSON.stringify(config), { mode: 0o600 });
  await writeFile(join(state, 'codex/config.toml'), managedCodexSettings(config), { mode: 0o600 });
  await writeFile(join(state, 'codex/auth.json'), '{"synthetic":true}', { mode: 0o600 });
  manifests.push(manifest);
}
const child = spawn(
  node,
  [
    join(fixture, 'core/tauri-terminal-host.cjs'),
    JSON.stringify(manifests),
    join(fixture, 'admission'),
  ],
  {
    cwd: fixture,
    env: {
      HOME: fixture,
      PATH: '/usr/bin:/bin',
      LANG: language === 'pt-BR' ? 'pt_BR.UTF-8' : 'en_US.UTF-8',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  },
);
const exited = once(child, 'exit');
let diagnostics = '';
child.stderr.on('data', (chunk: Buffer) => {
  diagnostics = (diagnostics + chunk.toString()).slice(-4096);
});
const lines = createInterface({ input: child.stdout });
const pending = new Map<string, (value: unknown) => void>();
const send = (value: object) => child.stdin.write(JSON.stringify(value) + '\n');
let acceptReady!: (value: { panes: Array<{ html: string }>; layout: TerminalLayoutState }) => void;
let rejectReady!: (reason: Error) => void;
let layout!: TerminalLayoutState;
const frames: Frame[] = [];
let workspace: Page | undefined;
let starts = 0;
let nativeGeneration = 0;
const layoutMessages: unknown[] = [];
let layoutWork = Promise.resolve();
let layoutError: unknown;
const ready = new Promise<{ panes: Array<{ html: string }>; layout: TerminalLayoutState }>(
  (resolve, reject) => {
    acceptReady = resolve;
    rejectReady = reject;
  },
);
const confirmations: string[] = [];
lines.on('line', (line) => {
  const value = JSON.parse(line) as {
    kind: string;
    id: string;
    detail: string;
    value: unknown;
    panes: Array<{ html: string }>;
    layout: TerminalLayoutState;
    state: TerminalLayoutState;
    bounds: Array<{ slot: number; rect: { width: number; height: number } | null }>;
  };
  if (value.kind === 'ready') {
    layout = value.layout;
    acceptReady(value);
  } else if (value.kind === 'layout') {
    layout = value.state;
    layoutMessages.push(value);
    layoutWork = layoutWork
      .then(async () => {
        if (!workspace) return;
        await workspace.evaluate((message) => {
          for (const bound of message.bounds) {
            const frame = document.getElementById(
              `terminal-frame-${bound.slot}`,
            ) as HTMLIFrameElement | null;
            if (!frame) continue;
            const rect = bound.rect as {
              x: number;
              y: number;
              width: number;
              height: number;
            } | null;
            frame.style.display = rect ? 'block' : 'none';
            if (rect)
              Object.assign(frame.style, {
                left: `${rect.x}px`,
                top: `${rect.y}px`,
                width: `${rect.width}px`,
                height: `${rect.height}px`,
              });
            frame.contentWindow?.dispatchEvent(
              new CustomEvent('orqst-terminal-layout', { detail: message.state }),
            );
          }
        }, value);
      })
      .catch((error: unknown) => {
        layoutError = error;
      });
  } else if (value.kind === 'confirm') {
    confirmations.push(value.detail);
    send({ kind: 'confirm', id: value.id, accepted: true }); // Synthetic native consent only.
  } else pending.get(value.id)?.(value.kind === 'retirement' ? value : value.value);
});
async function request(request: TerminalNativeRequest, slot = 0) {
  const id = randomUUID();
  return new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('Synthetic request timed out'));
    }, 10_000);
    pending.set(id, (value) => {
      clearTimeout(timer);
      pending.delete(id);
      resolve(value);
    });
    send({ kind: 'request', id, slot, focused: true, request });
  });
}
async function featureRequest(request: FeatureNativeRequest) {
  const id = randomUUID();
  if (request.action === 'select' || request.action === 'organize')
    send({ kind: 'layout-generation', generation: ++nativeGeneration });
  return new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('Synthetic metadata request timed out'));
    }, 15000);
    pending.set(id, (value) => {
      clearTimeout(timer);
      pending.delete(id);
      resolve(value);
    });
    send({
      kind: 'feature-request',
      id,
      document: 1,
      source: 'orqst-features://local/index.html',
      request,
    });
  });
}
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let retiredAndClosed = false;
const ids: string[] = [];
let deadlineExpired = false;
const deadline = setTimeout(() => {
  deadlineExpired = true;
  rejectReady(new Error('Synthetic visual acceptance deadline exceeded'));
  // Interrupt UI work, retaining the original host for the signed cleanup below.
  // Closing its stdin here would discard that cleanup path before observing exits.
  void browser?.close().catch(() => {});
}, 150000);
const artifacts = await mkdtemp(join(tmpdir(), 'orqst-feature-screens-'));
async function retireSelection() {
  const id = randomUUID();
  return new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('Synthetic signed retirement timed out'));
    }, 60000);
    pending.set(id, (value) => {
      clearTimeout(timer);
      pending.delete(id);
      resolve(value);
    });
    send({ kind: 'retire', id, slot: 0, focused: true });
  });
}
function retired(value: unknown): boolean {
  return (
    !!value &&
    typeof value === 'object' &&
    Reflect.get(value, 'kind') === 'retirement' &&
    Reflect.get(value, 'status') === 'retired' &&
    Reflect.get(value, 'fenced') === true
  );
}
async function cleanupKnownInstances(): Promise<void> {
  // Cleanup is allowed only through the still-valid original host and known IDs.
  // After transport loss, preserve evidence; never reconnect, adopt or signal a PID.
  for (const [slot, instanceId] of ids.entries()) {
    let state = terminalNativeReplySchema.parse(
      await request({ version: 1, action: 'snapshot', instanceId }, slot),
    );
    if (state.status !== 'ok' || !state.snapshot)
      throw new Error('Synthetic cleanup state unavailable');
    if (state.snapshot.state !== 'exited') {
      const stopped = terminalNativeReplySchema.parse(
        await request({ version: 1, action: 'stop', instanceId, signal: 'SIGTERM' }, slot),
      );
      if (stopped.status !== 'ok') throw new Error('Synthetic signed stop refused');
      const until = Date.now() + 5000;
      while (state.snapshot?.state !== 'exited' && Date.now() < until) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        state = terminalNativeReplySchema.parse(
          await request({ version: 1, action: 'snapshot', instanceId }, slot),
        );
        if (state.status !== 'ok') throw new Error('Synthetic cleanup transport unavailable');
      }
      if (state.snapshot?.state !== 'exited') throw new Error('Synthetic owned exit unconfirmed');
    }
  }
  if (!retired(await retireSelection())) throw new Error('Synthetic retirement unconfirmed');
}

try {
  const value = await Promise.race([
    ready,
    exited.then(() => {
      throw new Error(`Synthetic startup failed: ${diagnostics}`);
    }),
  ]);
  browser = await chromium.launch();
  if (deadlineExpired) throw new Error('Synthetic visual acceptance deadline exceeded');
  const approved = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    reducedMotion: 'reduce',
  });
  await approved.goto(
    new URL('../docs/design/v6/source/ORQST_workspace_v6_features.html', import.meta.url).href,
  );
  await approved.screenshot({ path: join(artifacts, 'approved-1440x900.png') });
  await approved.close();
  workspace = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    reducedMotion: 'reduce',
    locale: language,
  });
  const errors: string[] = [];
  workspace.on('pageerror', (error) => errors.push(error.message));
  const client = await readFile('apps/tauri/dist/terminal/client.js', 'utf8');
  const style = await readFile('apps/tauri/dist/terminal/style.css', 'utf8');
  const featureClient = await readFile('apps/tauri/dist/features/workspace.js', 'utf8');
  const featureStyle = await readFile('apps/tauri/dist/features/workspace.css', 'utf8');
  const logo = await readFile('apps/dashboard/public/brand/orqst-logo-dark.svg', 'utf8');
  await workspace.exposeFunction(
    'syntheticNativeInvoke',
    (slot: number, command: string, args: { request: TerminalNativeRequest; action: unknown }) => {
      if (command === 'feature_request')
        return featureRequest(args.request as unknown as FeatureNativeRequest);
      if (command === 'terminal_view') {
        if (args.action === 'layout') return layout;
        if (!layout.visible.includes(slot)) return false;
        if (args.action === 'dashboard')
          send({ kind: 'layout-generation', generation: ++nativeGeneration });
        send({ kind: 'layout-action', slot, action: args.action });
        return true;
      }
      assert.equal(command, 'terminal_request');
      if (
        !layout.visible.includes(slot) &&
        !['read', 'snapshot', 'resize', 'detach'].includes(args.request.action)
      )
        return { status: 'focus_required' };
      if (args.request.action === 'start') starts++;
      return request(args.request, slot);
    },
  );
  await workspace.addInitScript('window.__name = (target) => target;');
  await workspace.addInitScript(() => {
    Reflect.set(window, '__TAURI_INTERNALS__', {
      invoke: (command: string, args: unknown) =>
        Reflect.get(window, 'syntheticNativeInvoke')(
          Number(location.pathname.match(/^\/(\d+)\//)?.[1] ?? -1),
          command,
          args,
        ),
    });
    Reflect.set(window, 'syntheticDocumentIdentity', crypto.randomUUID());
  });
  await workspace.route('**/*', (route) => {
    const path = new URL(route.request().url()).pathname;
    const match = path.match(/^\/(\d+)\/(index.html|client.js|style.css)$/);
    let body: string;
    let contentType: string;
    if (match) {
      body =
        match[2] === 'client.js'
          ? client
          : match[2] === 'style.css'
            ? style
            : value.panes[Number(match[1])]!.html;
      contentType = path.endsWith('.js')
        ? 'text/javascript'
        : path.endsWith('.css')
          ? 'text/css'
          : 'text/html';
    } else {
      assert.ok(['/studio', '/workspace.js', '/workspace.css', '/logo.svg'].includes(path));
      body =
        path === '/logo.svg'
          ? logo
          : path === '/workspace.js'
            ? featureClient
            : path === '/workspace.css'
              ? featureStyle
              : '<!doctype html><html><head><link rel="stylesheet" href="workspace.css"></head><body style="margin:0"><div id="root"></div><script src="workspace.js"></script></body></html>';
      contentType = path.endsWith('.js')
        ? 'text/javascript'
        : path.endsWith('.css')
          ? 'text/css'
          : path.endsWith('.svg')
            ? 'image/svg+xml'
            : 'text/html';
    }
    return route.fulfill({ body, contentType });
  });
  await workspace.goto('https://synthetic.orqst.invalid/studio');
  await expect(
    workspace.getByRole('button', { name: ui.features.create, exact: false }),
  ).toBeEnabled();
  send({ kind: 'layout-resize', width: 1440, height: 900 });
  await workspace.evaluate((count) => {
    for (let slot = 0; slot < count; slot++) {
      const frame = document.createElement('iframe');
      frame.id = `terminal-frame-${slot}`;
      frame.src = `/${slot}/index.html`;
      Object.assign(frame.style, { position: 'fixed', border: '0', display: 'none', zIndex: '10' });
      document.body.append(frame);
    }
  }, count);
  const documents: string[] = [];
  for (let slot = 0; slot < count; slot++) {
    send({ kind: 'layout-open', slot });
    await expect.poll(() => layout.visible.includes(slot)).toBe(true);
    await layoutWork;
    const frame = await workspace
      .locator(`#terminal-frame-${slot}`)
      .contentFrame()
      .locator('main')
      .elementHandle()
      .then((handle) => handle!.ownerFrame());
    assert.ok(frame);
    frames.push(frame);
    await expect(frame.locator('#terminal .xterm')).toBeVisible();
    await frame.locator('#start').click();
    await expect(frame.locator('#status')).toHaveAttribute('data-state', 'running');
    ids.push((await frame.locator('#status').getAttribute('data-instance-id'))!);
    await frame.locator('#attach').click();
    await expect(frame.locator('#terminal')).toContainText('SYNTHETIC:OWNED_TUI');
    documents.push(
      await frame.evaluate(() => Reflect.get(window, 'syntheticDocumentIdentity') as string),
    );
    await frame
      .locator('.xterm')
      .evaluate((element) => Reflect.set(element, 'retainedFeatureTerminal', true));
  }
  assert.equal(new Set(ids).size, 6);
  assert.equal(starts, 6);
  assert.equal(
    featureNativeReplySchema.parse(
      await featureRequest({
        contractVersion: 1,
        generation: 0,
        action: 'snapshot',
        path: '/SYNTHETIC-DENIED',
      } as unknown as FeatureNativeRequest),
    ).status,
    'denied',
  );
  assert.equal(
    featureNativeReplySchema.parse(
      await featureRequest({ contractVersion: 1, generation: 0, action: 'snapshot' }),
    ).status,
    'ok',
  );
  send({ kind: 'layout-open', slot: 0 });
  await expect.poll(() => layout.visible.includes(0)).toBe(true);
  await layoutWork;
  await frames[0]!.locator('#input').click();
  await expect(frames[0]!.locator('main')).toHaveAttribute('data-next', 'typing');
  await workspace.keyboard.type('ping');
  await workspace.keyboard.press('Enter');
  await expect(frames[0]!.locator('#terminal')).toContainText('SYNTHETIC:PONG');
  // Keyboard creation/cancel is independent from native terminal keystrokes.
  await workspace.getByRole('button', { name: ui.features.create, exact: false }).focus();
  await workspace.keyboard.press('Enter');
  await expect(workspace.getByLabel(ui.features.name, { exact: true })).toBeFocused();
  await workspace.keyboard.press('Escape');
  await expect(
    workspace.getByRole('button', { name: ui.features.create, exact: false }),
  ).toBeFocused();
  const featureNames = ['Autenticação', 'Dashboard', 'Banco de dados'];
  let slot = 0;
  for (const [index, count] of [3, 2, 1].entries()) {
    await workspace.getByRole('button', { name: ui.features.create, exact: false }).click();
    await workspace.getByLabel(ui.features.name, { exact: true }).fill(featureNames[index]!);
    await workspace
      .getByLabel(ui.features.description, { exact: true })
      .fill('SYNTHETIC six-PTY acceptance');
    await workspace.getByRole('button', { name: ui.features.save, exact: true }).click();
    await workspace
      .getByRole('navigation', { name: ui.features.heading })
      .getByRole('button', { name: new RegExp(featureNames[index]!) })
      .click();
    await expect(workspace.locator('.feature-topbar strong')).toContainText(featureNames[index]!);
    await expect(workspace.locator('.feature-surface')).toContainText(ui.features.empty);
    assert.equal(layout.suspended, false);
    assert.equal(layout.workspaceChrome, true);
    for (let i = 0; i < count; i++) {
      await workspace.getByLabel(ui.features.assign).selectOption(String(slot++));
      await workspace.getByRole('button', { name: ui.features.addMember, exact: true }).click();
      await expect(workspace.locator('.feature-members')).toContainText(
        ui.features.members.replace('{{count}}', String(i + 1)),
      );
    }
  }
  const snapshot = featureNativeReplySchema.parse(
    await featureRequest({ contractVersion: 1, generation: 0, action: 'snapshot' }),
  ).snapshot!;
  assert.deepEqual(
    snapshot.features.map((f) => f.terminalIds.length),
    [3, 2, 1],
  );
  assert.equal(snapshot.slots.length, 6);
  for (let cycle = 0; cycle < 5; cycle++)
    for (const [index, name] of featureNames.entries()) {
      await workspace
        .getByRole('navigation', { name: ui.features.heading })
        .getByRole('button', { name: new RegExp(name) })
        .click();
      await expect(workspace.locator('.feature-topbar strong')).toContainText(name);
      await expect
        .poll(() => layout.order)
        .toEqual(index === 0 ? [0, 1, 2] : index === 1 ? [3, 4] : [5]);
      await layoutWork;
      const first = layout.order[0]!;
      const frame = frames[first]!;
      if (cycle === 0) {
        await frame.locator('#pane-menu-toggle').click();
        await frame.locator('.layout-options > summary').click();
        await frame.locator('#column-choice').selectOption(String(index + 1));
        await expect.poll(() => layout.columns).toBe(index + 1);
        await frame.locator('#pane-menu-toggle').click();
      } else assert.equal(layout.columns, index + 1);
      await expect.poll(() => layout.persisted).toBe(true);
      for (const [slot, frame] of frames.entries()) {
        assert.equal(await frame.locator('#status').getAttribute('data-instance-id'), ids[slot]);
        assert.equal(
          await frame.evaluate(() => Reflect.get(window, 'syntheticDocumentIdentity')),
          documents[slot],
        );
        assert.equal(
          await frame
            .locator('.xterm')
            .evaluate((element) => Reflect.get(element, 'retainedFeatureTerminal')),
          true,
        );
        assert.match(await frame.locator('#terminal').innerText(), /SYNTHETIC:OWNED_TUI/);
        if (slot === 0)
          assert.match(await frame.locator('#terminal').innerText(), /SYNTHETIC:PONG/);
      }
      assert.equal(starts, 6);
    }
  // Real UI metadata edit and archive refusal preserve the sessions.
  await workspace.locator('.feature-topbar button').first().click();
  await workspace.getByLabel(ui.features.name, { exact: true }).fill('Banco persistido');
  await workspace.getByRole('button', { name: ui.features.save, exact: true }).click();
  await expect(workspace.locator('.feature-topbar strong')).toContainText('Banco persistido');
  await workspace.locator('.feature-topbar button').first().click();
  await workspace.getByLabel(ui.features.status, { exact: true }).selectOption('archived');
  await workspace.getByRole('button', { name: ui.features.save, exact: true }).click();
  await expect(workspace.getByRole('status')).toContainText(ui.features.archive_blocked);
  await workspace.getByRole('button', { name: ui.features.cancel, exact: true }).click();
  // Keyboard input is revoked on view switching; selection never grants a fresh lease.
  const revoked = terminalNativeReplySchema.parse(
    await request({
      version: 1,
      action: 'write',
      instanceId: ids[0]!,
      sequence: 100,
      text: 'forbidden',
    }),
  );
  assert.equal(revoked.status, 'denied');
  await workspace
    .getByRole('navigation', { name: ui.features.heading })
    .getByRole('button', { name: /Autenticação/ })
    .click();
  await expect(workspace.locator('.feature-topbar strong')).toContainText('Autenticação');
  await expect(workspace.locator('.feature-workspace')).toHaveAttribute('aria-busy', 'false');
  await expect.poll(() => layout.order).toEqual([0, 1, 2]);
  await layoutWork;
  const widePage = [...layout.visible];
  assert.ok(widePage.length > 0);
  await workspace.screenshot({ path: join(artifacts, `functional-v6-${language}-1440x900.png`) });
  assert.equal((await workspace.locator('.feature-sidebar').boundingBox())?.width, 155);
  assert.equal((await workspace.locator('.feature-topbar').boundingBox())?.height, 45);
  assert.equal((await frames[0]!.locator('.pane-header').boundingBox())?.height, 31);
  await workspace.setViewportSize({ width: 720, height: 700 });
  send({ kind: 'layout-resize', width: 720, height: 700 });
  await expect.poll(() => layout.visible.length).toBe(1);
  await layoutWork;
  await workspace.screenshot({ path: join(artifacts, `functional-v6-${language}-720x700.png`) });
  await workspace.setViewportSize({ width: 1440, height: 900 });
  send({ kind: 'layout-resize', width: 1440, height: 900 });
  await expect.poll(() => layout.visible).toEqual(widePage);
  assert.deepEqual(layout.order, [0, 1, 2]);
  assert.deepEqual(layout.shown, [0, 1, 2]);
  await layoutWork;
  assert.deepEqual(errors, []);
  assert.equal(layoutError, undefined);
  const db = new DatabaseSync(join(fixture, 'admission/terminal-layouts/preferences.sqlite'), {
    readOnly: true,
  });
  try {
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM features').get()?.n, 3);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM feature_terminal_assignments').get()?.n, 6);
    const keys = snapshot.features.map((f) =>
      stableId('terminal-layout-feature', f.featureId, JSON.stringify([...f.terminalIds].sort())),
    );
    const records = db
      .prepare('SELECT selection_id,metadata FROM terminal_layouts')
      .all()
      .filter((row) => keys.includes(String(row.selection_id)));
    // Reopening the actual Core-backed metadata path proves persisted per-Feature records.
    for (const feature of snapshot.features) {
      const state = await featureNativeReplySchema.parse(
        await featureRequest({ contractVersion: 1, generation: 0, action: 'snapshot' }),
      );
      assert.ok(state.snapshot?.features.some((f) => f.featureId === feature.featureId));
    }
    assert.equal(records.length, 3);
    for (const row of records) terminalLayoutRecordSchema.parse(JSON.parse(String(row.metadata)));
  } finally {
    db.close();
  }
  for (let slot = 0; slot < count; slot++) {
    const journal = new DatabaseSync(join(fixture, `state-${slot}/terminal.sqlite`), {
      readOnly: true,
    });
    try {
      assert.equal(journal.prepare('SELECT COUNT(*) AS n FROM terminal_attempts').get()?.n, 1);
    } finally {
      journal.close();
    }
  }
  // Stop only through existing signed controls, then retire after all owned exits.
  for (const feature of snapshot.features) {
    const current = featureNativeReplySchema.parse(
      await featureRequest({ contractVersion: 1, generation: 0, action: 'snapshot' }),
    ).snapshot!;
    assert.equal(
      featureNativeReplySchema.parse(
        await featureRequest({
          contractVersion: 1,
          generation: current.generation,
          action: 'select',
          featureId: feature.featureId,
          expectedRevision: current.view.revision,
        }),
      ).status,
      'ok',
    );
    await layoutWork;
    for (const slot of layout.order) {
      send({ kind: 'layout-open', slot });
      await expect.poll(() => layout.visible.includes(slot)).toBe(true);
      await layoutWork;
      // A separate explicit synthetic input review proves the original PTY is still alive.
      // Feature selection itself sent no task and granted no lease.
      const frame = frames[slot]!;
      const pongs = ((await frame.locator('#terminal').innerText()).match(/SYNTHETIC:PONG/g) ?? [])
        .length;
      await frame.locator('#input').click();
      await expect(frame.locator('main')).toHaveAttribute('data-next', 'typing');
      await workspace.keyboard.type('ping');
      await workspace.keyboard.press('Enter');
      await expect
        .poll(
          async () =>
            ((await frame.locator('#terminal').innerText()).match(/SYNTHETIC:PONG/g) ?? []).length,
        )
        .toBeGreaterThan(pongs);
      assert.equal(await frame.locator('#status').getAttribute('data-instance-id'), ids[slot]);
      assert.equal(starts, 6);
      await frames[slot]!.locator('#stop').click();
      await expect(frames[slot]!.locator('#status')).toHaveAttribute('data-state', 'exited');
    }
  }
  await browser.close();
  browser = undefined;
  workspace = undefined;
  assert.equal(retired(await retireSelection()), true);
  assert.equal((await readdir(join(fixture, 'admission'))).includes('active-pair.json'), false);
  child.stdin.end('shutdown\n');
  const [code, signal] = await exited;
  assert.equal(code, 0);
  assert.equal(signal, null);
  retiredAndClosed = true;
  console.log(
    JSON.stringify({
      status: 'passed',
      language,
      artifacts,
      starts,
      ptyCount: 6,
      featureCounts: [3, 2, 1],
      switches: 15,
      layoutMessages: layoutMessages.length,
      native: 'Chromium facade only; no WebKit/provider acceptance',
    }),
  );
} finally {
  clearTimeout(deadline);
  // Closing Chromium stops read polling, while the original private host stays valid.
  await browser?.close();
  workspace = undefined;
  let cleanupRetirement = false;
  if (
    !retiredAndClosed &&
    child.exitCode === null &&
    child.signalCode === null &&
    !child.stdin.destroyed &&
    !child.stdin.writableEnded
  ) {
    try {
      await cleanupKnownInstances();
      cleanupRetirement = true;
    } catch {
      // Uncertain cleanup is evidence, never permission to retry/adopt/signal.
    }
  }
  lines.close();
  if (!child.stdin.destroyed && !child.stdin.writableEnded) child.stdin.end('shutdown\n');
  // No forced signal after losing the host. A failed fixture stays intact for review.
  if (retiredAndClosed) await rm(fixture, { recursive: true, force: true });
  else {
    let hostClosed = child.exitCode === 0 && child.signalCode === null;
    if (child.exitCode === null && child.signalCode === null) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const [code, signal] = await Promise.race([
          exited,
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('Synthetic host exit unconfirmed')), 6500);
          }),
        ]);
        hostClosed = code === 0 && signal === null;
      } catch {
        /* Preserve the host and evidence; never force an uncertain exit. */
      } finally {
        clearTimeout(timer);
      }
    }
    await writeFile(
      join(fixture, 'cleanup-result.json'),
      JSON.stringify({
        status:
          cleanupRetirement && hostClosed
            ? 'signed-retirement-and-host-exit-confirmed'
            : 'uncertain',
        instanceIds: ids,
        hostClosed,
        signedRetirement: cleanupRetirement,
      }),
      { mode: 0o600 },
    );
    if (child.exitCode === null && child.signalCode === null) {
      // Detach this failed runner's transports, without signalling/adopting an uncertain host.
      child.unref();
      child.stdout.destroy();
      child.stderr.destroy();
    }
    console.error(`Synthetic fixture/evidence preserved for review: ${fixture}`);
  }
}
