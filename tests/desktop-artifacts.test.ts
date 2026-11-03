// All bodies, paths and identities are disposable synthetic fixtures.
import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IpcMainInvokeEvent, Session, WebContents } from 'electron';
import { artifactSaveRequestSchema, type ArtifactExtractionRequest } from '@orqst/protocol';
import {
  ArtifactSaver,
  readSaveOriginal,
  validateExtractedArtifact,
  type SaveDependencies,
} from '../apps/desktop/src/artifacts.js';
import { projectArtifactReference } from '../packages/core/src/lifecycle.js';
import { meta, normalized, record } from './fixtures.js';
import { MarkdownDestination } from '../apps/desktop/src/artifact-files.js';
import { authorizedArtifactSender } from '../apps/desktop/src/artifact-sender.js';

const selection: ArtifactExtractionRequest = {
  contractVersion: 1,
  sequence: 1,
  eventId: 'synthetic-event',
  sessionId: 'synthetic-session',
  machineId: 'synthetic-machine',
  adapter: 'codex',
  workspaceId: 'synthetic-workspace',
  agentId: 'synthetic-agent',
  sourceHash: 'a'.repeat(64),
};
const input = { contractVersion: 1, selection, representation: 'original', openAfterSave: false };

function retained() {
  const event = {
    ...normalized([
      meta(),
      record('response_item', {
        type: 'message',
        role: 'assistant',
        content: '# Synthetic retained 😀',
      }),
    ]).find((event) => event.payload.role === 'assistant')!,
    sequence: 1,
  };
  const ref = projectArtifactReference(event);
  assert.equal(ref.availability, 'available');
  if (ref.availability !== 'available') throw new Error('Synthetic fixture unavailable');
  const request: ArtifactExtractionRequest = {
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
  const result = {
    availability: 'available',
    value: {
      contract: 'orqst.artifacts',
      contractVersion: 1,
      selection: 'manual_message',
      eventSchemaVersion: 1,
      reference: ref.value,
      original: {
        text: event.payload.text!,
        representation: 'retained_redacted_text',
        completeness: 'not_verified',
      },
    },
  };
  return { request, result };
}

test('main reextraction validates every identity and the complete response contract', () => {
  const { request, result } = retained();
  assert.equal(validateExtractedArtifact(result, request), '# Synthetic retained 😀');
  for (const key of [
    'eventId',
    'sessionId',
    'machineId',
    'adapter',
    'workspaceId',
    'agentId',
    'sourceHash',
    'sequence',
  ] as const)
    assert.throws(() =>
      validateExtractedArtifact(result, {
        ...request,
        [key]: key === 'sequence' ? 2 : 'synthetic-mismatch',
      }),
    );
  for (const changed of [
    { ...result, extra: true },
    { ...result, value: { ...result.value, contractVersion: 2 } },
    {
      ...result,
      value: { ...result.value, original: { ...result.value.original, completeness: 'complete' } },
    },
    { availability: 'unavailable', reason: 'event_not_retained' },
  ])
    assert.throws(() => validateExtractedArtifact(changed, request));
});

test('main HTTP extraction requires JSON, caps streamed bytes and denies stale documents', async () => {
  const { request, result } = retained();
  const origin = 'http://127.0.0.1:4321';
  const fetcher: typeof fetch = async (url, init) => {
    assert.equal(url, origin + '/api/artifacts/extract');
    assert.equal(init?.redirect, 'error');
    assert.equal(init?.credentials, 'include');
    assert.deepEqual(JSON.parse(init!.body as string), request);
    return Response.json(result);
  };
  assert.equal(await readSaveOriginal(fetcher, origin, request), '# Synthetic retained 😀');
  for (const mime of ['text/html', 'text/plain', 'application/jsonp', ''])
    await assert.rejects(
      readSaveOriginal(
        async () => new Response(JSON.stringify(result), { headers: { 'Content-Type': mime } }),
        origin,
        request,
      ),
      /Artifact unavailable/,
    );
  await assert.rejects(
    readSaveOriginal(
      async () =>
        new Response('x'.repeat(262145), { headers: { 'Content-Type': 'application/json' } }),
      origin,
      request,
    ),
    /Artifact response limit/,
  );
  let called = false;
  await assert.rejects(
    readSaveOriginal(
      async () => {
        called = true;
        return Response.json(result);
      },
      origin,
      request,
      () => false,
    ),
    /Revoked operation/,
  );
  assert.equal(called, false);
  let live = true;
  await assert.rejects(
    readSaveOriginal(
      async () => {
        live = false;
        return Response.json(result);
      },
      origin,
      request,
      () => live,
    ),
    /Artifact unavailable/,
  );
});
function fixture(t: TestContext) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'orqst-save-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, 'synthetic.md');
  const opened: string[] = [];
  const deps: SaveDependencies = {
    authorized: () => true,
    original: async () => '# Synthetic retained original',
    choose: async () => path,
    confirm: async () => false,
    open: async (value) => {
      opened.push(value);
      return '';
    },
  };
  return { root, path, deps, opened, saver: new ArtifactSaver() };
}

test('save DTO strictly separates original and draft and bounds UTF-8 without replacement characters', () => {
  assert.equal(artifactSaveRequestSchema.safeParse(input).success, true);
  for (const value of [
    { ...input, path: '/synthetic.md' },
    { ...input, grant: 'old-grant' },
    { ...input, url: 'file:///synthetic.md' },
    { ...input, draft: 'forged original' },
    { ...input, representation: 'draft' },
    { ...input, contractVersion: '1' },
    { ...input, selection: { ...selection, path: 'synthetic.md' } },
  ])
    assert.equal(artifactSaveRequestSchema.safeParse(value).success, false);
  const draft = { ...input, representation: 'draft', draft: '😀'.repeat(8192) };
  assert.equal(artifactSaveRequestSchema.safeParse(draft).success, true);
  for (const text of [draft.draft + 'a', '\ud800', '\udfff', 'a\0b'])
    assert.equal(artifactSaveRequestSchema.safeParse({ ...draft, draft: text }).success, false);
});

test('save original reextracts while hostile draft bytes are saved inertly and only current saved file opens', async (t) => {
  const ctx = fixture(t);
  assert.deepEqual(await ctx.saver.save(input, ctx.deps), { status: 'saved' });
  assert.equal(readFileSync(ctx.path, 'utf8'), '# Synthetic retained original');
  assert.deepEqual(ctx.opened, []);
  const hostile = '# 😀\n<script>bad()</script>\n[run](javascript:bad())\n$(bad)';
  ctx.deps.choose = async () => join(ctx.root, 'draft.md');
  assert.deepEqual(
    await ctx.saver.save(
      { ...input, representation: 'draft', draft: hostile, openAfterSave: true },
      ctx.deps,
    ),
    { status: 'saved_opened' },
  );
  assert.deepEqual(ctx.opened, [join(ctx.root, 'draft.md')]);
  assert.equal(readFileSync(ctx.opened[0]!, 'utf8'), hostile);
  assert.equal(readFileSync(ctx.path, 'utf8'), '# Synthetic retained original');
});

test('cancel and denied overwrite make no file changes; explicit confirmation replaces the verified file', async (t) => {
  const ctx = fixture(t);
  ctx.deps.choose = async () => undefined;
  assert.deepEqual(await ctx.saver.save(input, ctx.deps), { status: 'cancelled' });
  assert.equal(existsSync(ctx.path), false);
  writeFileSync(ctx.path, 'Synthetic previous longer document');
  ctx.deps.choose = async () => ctx.path;
  assert.deepEqual(await ctx.saver.save(input, ctx.deps), { status: 'cancelled' });
  assert.equal(readFileSync(ctx.path, 'utf8'), 'Synthetic previous longer document');
  ctx.deps.confirm = async (path) => {
    assert.equal(path, ctx.path);
    return true;
  };
  assert.deepEqual(await ctx.saver.save(input, ctx.deps), { status: 'saved' });
  assert.equal(readFileSync(ctx.path, 'utf8'), '# Synthetic retained original');
});

test('destinations reject symlinks, hardlinks, executable files, oversized files, directories and non-md names', (t) => {
  const ctx = fixture(t);
  const victim = join(ctx.root, 'victim.md');
  writeFileSync(victim, 'Synthetic untouched');
  symlinkSync(victim, ctx.path);
  assert.throws(() => new MarkdownDestination(ctx.path));
  rmSync(ctx.path);
  linkSync(victim, ctx.path);
  assert.throws(() => new MarkdownDestination(ctx.path));
  rmSync(ctx.path);
  chmodSync(victim, 0o700);
  assert.throws(() => new MarkdownDestination(victim));
  chmodSync(victim, 0o600);
  writeFileSync(ctx.path, 'x'.repeat(32769));
  assert.throws(() => new MarkdownDestination(ctx.path));
  rmSync(ctx.path);
  mkdirSync(ctx.path);
  assert.throws(() => new MarkdownDestination(ctx.path));
  for (const path of ['relative.md', join(ctx.root, 'x.sh'), join(ctx.root, 'x.md.command')])
    assert.throws(() => new MarkdownDestination(path));
  assert.equal(readFileSync(victim, 'utf8'), 'Synthetic untouched');
});

test('target replacement, symlink or content change during confirmation fails without truncation', async (t) => {
  for (const change of ['replace', 'symlink', 'content']) {
    const ctx = fixture(t);
    writeFileSync(ctx.path, 'Synthetic previous');
    const moved = join(ctx.root, 'moved.md');
    ctx.deps.confirm = async () => {
      if (change === 'content') writeFileSync(ctx.path, 'Synthetic changed');
      else {
        renameSync(ctx.path, moved);
        if (change === 'symlink') symlinkSync(moved, ctx.path);
        else writeFileSync(ctx.path, 'Synthetic replacement');
      }
      return true;
    };
    assert.deepEqual(await ctx.saver.save({ ...input, openAfterSave: true }, ctx.deps), {
      status: 'failed',
    });
    assert.equal(
      readFileSync(ctx.path, 'utf8'),
      change === 'content'
        ? 'Synthetic changed'
        : change === 'symlink'
          ? 'Synthetic previous'
          : 'Synthetic replacement',
    );
    if (change !== 'content') assert.equal(readFileSync(moved, 'utf8'), 'Synthetic previous');
    assert.deepEqual(ctx.opened, []);
  }
});

test('O_EXCL rejects a newly appeared target and parent replacement invalidates a grant', (t) => {
  const ctx = fixture(t);
  const grant = new MarkdownDestination(ctx.path);
  writeFileSync(ctx.path, 'Synthetic appeared');
  assert.throws(() => grant.write('Synthetic new'));
  grant.close();
  assert.equal(readFileSync(ctx.path, 'utf8'), 'Synthetic appeared');
  const parent = join(ctx.root, 'parent');
  mkdirSync(parent);
  const other = new MarkdownDestination(join(parent, 'file.md'));
  renameSync(parent, join(ctx.root, 'old-parent'));
  mkdirSync(parent);
  assert.throws(() => other.write('Synthetic new'));
  other.close();
  assert.equal(existsSync(join(parent, 'file.md')), false);
});

test('saved verification rejects replacement/content change and closed grants cannot be replayed', (t) => {
  const ctx = fixture(t);
  const destination = new MarkdownDestination(ctx.path);
  destination.write('Synthetic saved');
  destination.verifySaved();
  writeFileSync(ctx.path, 'Synthetic changed');
  assert.throws(() => destination.verifySaved());
  destination.close();
  assert.throws(() => destination.verifySaved());
});

test('one operation only, no queue, revoked document cannot save or open and replay requires a fresh dialog', async (t) => {
  const ctx = fixture(t);
  let release!: (path: string) => void;
  let authorized = true;
  ctx.deps.authorized = () => authorized;
  ctx.deps.choose = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  const first = ctx.saver.save(input, ctx.deps);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(await ctx.saver.save(input, ctx.deps), { status: 'failed' });
  authorized = false;
  release(ctx.path);
  assert.deepEqual(await first, { status: 'failed' });
  assert.equal(existsSync(ctx.path), false);
  authorized = true;
  let dialogs = 0;
  ctx.deps.choose = async () => {
    dialogs++;
    return undefined;
  };
  await ctx.saver.save(input, ctx.deps);
  await ctx.saver.save(input, ctx.deps);
  assert.equal(dialogs, 2);
});

test('open failure is distinct from successful saving and sanitized', async (t) => {
  const ctx = fixture(t);
  ctx.deps.open = async () => {
    throw new Error('PRIVATE synthetic path and text');
  };
  assert.deepEqual(await ctx.saver.save({ ...input, openAfterSave: true }, ctx.deps), {
    status: 'saved_open_failed',
  });
  assert.equal(readFileSync(ctx.path, 'utf8'), '# Synthetic retained original');
});

test('sender must be the live main frame, expected webContents, session and exact dashboard origin and routes', () => {
  const session = {} as Session;
  const origin = 'http://127.0.0.1:4321';
  const frame = { url: origin + '/', detached: false, isDestroyed: () => false };
  const sender = {
    session,
    mainFrame: frame,
    getURL: () => frame.url,
    isDestroyed: () => false,
  } as unknown as WebContents;
  const event = { sender, senderFrame: frame } as unknown as IpcMainInvokeEvent;
  const check = (value = event) => authorizedArtifactSender(value, sender, session, origin);
  for (const path of [
    '/',
    '/overview',
    '/workspaces',
    '/agents',
    '/models',
    '/settings',
    '/artifacts',
    '/overview#session=synthetic',
    '/overview/sessions/synthetic',
    '/overview/sessions/synthetic%20%3F%23%20sess%C3%A3o',
  ]) {
    frame.url = origin + path;
    assert.equal(check(), true, path);
  }
  assert.equal(
    check({ ...event, senderFrame: { ...frame } } as unknown as IpcMainInvokeEvent),
    false,
  );
  assert.equal(check({ ...event, sender: {} } as unknown as IpcMainInvokeEvent), false);
  assert.equal(authorizedArtifactSender(event, sender, {} as Session, origin), false);
  frame.detached = true;
  assert.equal(check(), false);
  frame.detached = false;
  for (const url of [
    'file:///synthetic.md',
    origin + '/api/bootstrap',
    ...[
      '/overview/',
      '/overview/sessions/a%2Fb',
      '/overview/sessions/a%252Fb',
      '/overview/sessions/id/extra',
      '/overview/sessions/id?x=1',
      '/settings/nested',
      '/arbitrary',
      '/%73ettings',
      '/settings?x=1',
      '/ws',
      '/assets/app.js',
    ].map((path) => origin + path),
    origin + '/?x=1',
    'orqst-desktop://offline/',
    'http://localhost:4321/',
  ]) {
    frame.url = url;
    assert.equal(check(), false);
  }
});
