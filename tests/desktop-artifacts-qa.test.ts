// Independent save-Markdown QA. Temporary directories only; no Electron/user files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chmodSync,
  linkSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  artifactExtractionRequestSchema,
  artifactSaveRequestSchema,
  artifactExtractionResultSchema,
  artifactTextLimit,
  type ArtifactExtractionRequest,
} from '@orqst/protocol';
import {
  ArtifactSaver,
  readSaveOriginal,
  type SaveDependencies,
} from '../apps/desktop/src/artifacts.js';
import { MarkdownDestination } from '../apps/desktop/src/artifact-files.js';

const selection: ArtifactExtractionRequest = artifactExtractionRequestSchema.parse({
  contractVersion: 1,
  sequence: 1,
  eventId: 'synthetic-event',
  sessionId: 'synthetic-session',
  machineId: 'synthetic-machine',
  adapter: 'codex',
  workspaceId: 'synthetic-workspace',
  agentId: 'synthetic-agent',
  sourceHash: 'a'.repeat(64),
});
const saveInput = (openAfterSave = false) =>
  artifactSaveRequestSchema.parse({
    contractVersion: 1,
    selection,
    representation: 'original',
    openAfterSave,
  });

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'orqst-save-qa-'));
  return {
    dir,
    path: join(dir, 'artifact.md'),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

function deps(overrides: Partial<SaveDependencies> = {}): SaveDependencies {
  return {
    authorized: () => true,
    original: async () => 'Original retained text',
    choose: async () => undefined,
    confirm: async () => false,
    open: async () => '',
    ...overrides,
  };
}

test('save contract is strict, discriminates original/draft and rejects paths/extra fields', () => {
  assert.equal(artifactSaveRequestSchema.safeParse(saveInput()).success, true);
  assert.equal(
    artifactSaveRequestSchema.safeParse({ ...saveInput(), representation: 'draft', draft: 'd' })
      .success,
    true,
  );
  for (const invalid of [
    { ...saveInput(), path: '/tmp/x.md' },
    { ...saveInput(), url: 'https://example.invalid' },
    { ...saveInput(), contractVersion: 2 },
    { ...saveInput(), selection: { ...selection, sequence: 0 } },
    { ...saveInput(), representation: 'draft' },
    { ...saveInput(), representation: 'draft', draft: 'x'.repeat(artifactTextLimit + 1) },
    { ...saveInput(), openAfterSave: 'yes' },
  ])
    assert.equal(artifactSaveRequestSchema.safeParse(invalid).success, false);
  assert.equal(
    artifactSaveRequestSchema.safeParse({
      ...saveInput(),
      representation: 'draft',
      draft: 'é'.repeat(artifactTextLimit / 2),
    }).success,
    true,
  );
  assert.equal(
    artifactSaveRequestSchema.safeParse({
      ...saveInput(),
      representation: 'draft',
      draft: 'é'.repeat(artifactTextLimit / 2 + 1),
    }).success,
    false,
  );
});

test('saver cancels without effects, overwrites only after confirmation and never opens on cancel', async () => {
  const ctx = tempDir();
  const saver = new ArtifactSaver();
  try {
    let opened = false;
    const cancel = await saver.save(
      saveInput(true),
      deps({
        choose: async () => undefined,
        open: async () => {
          opened = true;
          return '';
        },
      }),
    );
    assert.deepEqual(cancel, { status: 'cancelled' });
    assert.equal(opened, false);
    assert.throws(() => readFileSync(ctx.path), /ENOENT/);

    writeFileSync(ctx.path, 'old');
    const denied = await saver.save(
      saveInput(),
      deps({ choose: async () => ctx.path, confirm: async () => false }),
    );
    assert.deepEqual(denied, { status: 'cancelled' });
    assert.equal(readFileSync(ctx.path, 'utf8'), 'old');

    const saved = await saver.save(
      saveInput(),
      deps({ choose: async () => ctx.path, confirm: async () => true }),
    );
    assert.deepEqual(saved, { status: 'saved' });
    assert.equal(readFileSync(ctx.path, 'utf8'), 'Original retained text');

    writeFileSync(ctx.path, 'old again');
    const openedSave = await saver.save(
      saveInput(true),
      deps({ choose: async () => ctx.path, confirm: async () => true, open: async () => '' }),
    );
    assert.deepEqual(openedSave, { status: 'saved_opened' });

    const openFailed = await saver.save(
      saveInput(true),
      deps({
        choose: async () => ctx.path,
        confirm: async () => true,
        open: async () => 'synthetic failure',
      }),
    );
    assert.deepEqual(openFailed, { status: 'saved_open_failed' });
  } finally {
    ctx.cleanup();
  }
});

test('draft uses draft text while original is still re-extracted; invalid input and revoked auth have no effects', async () => {
  const ctx = tempDir();
  const saver = new ArtifactSaver();
  try {
    let originalCalls = 0;
    const draftInput = artifactSaveRequestSchema.parse({
      contractVersion: 1,
      selection,
      representation: 'draft',
      draft: 'Draft only',
      openAfterSave: false,
    });
    const saved = await saver.save(
      draftInput,
      deps({
        original: async () => {
          originalCalls++;
          return 'Original must not be written';
        },
        choose: async () => ctx.path,
        confirm: async () => false,
      }),
    );
    assert.deepEqual(saved, { status: 'saved' });
    assert.equal(originalCalls, 1);
    assert.equal(readFileSync(ctx.path, 'utf8'), 'Draft only');

    let called = false;
    const invalid = await saver.save(
      { ...saveInput(), path: '/tmp/forbidden.md' },
      deps({
        original: async () => {
          called = true;
          return 'x';
        },
      }),
    );
    assert.deepEqual(invalid, { status: 'failed' });
    assert.equal(called, false);

    const revoked = await saver.save(
      saveInput(),
      deps({
        authorized: () => false,
        original: async () => {
          called = true;
          return 'x';
        },
      }),
    );
    assert.deepEqual(revoked, { status: 'failed' });
    assert.equal(called, false);
  } finally {
    ctx.cleanup();
  }
});

test('one operation at a time; revocation after write prevents open but leaves saved file', async () => {
  const ctx = tempDir();
  const saver = new ArtifactSaver();
  try {
    let release!: (value: string) => void;
    let chooseCalls = 0;
    const gate = new Promise<string>((resolve) => {
      release = resolve;
    });
    const first = saver.save(
      saveInput(),
      deps({
        original: async () => gate,
        choose: async () => {
          chooseCalls++;
          return ctx.path;
        },
        confirm: async () => false,
      }),
    );
    assert.deepEqual(await saver.save(saveInput(), deps()), { status: 'failed' });
    release('First content');
    assert.deepEqual(await first, { status: 'saved' });
    assert.equal(readFileSync(ctx.path, 'utf8'), 'First content');
    assert.equal(chooseCalls, 1);

    let authCalls = 0;
    let opened = false;
    const openAfter = await saver.save(
      saveInput(true),
      deps({
        authorized: () => {
          authCalls++;
          return authCalls <= 5;
        },
        choose: async () => ctx.path,
        confirm: async () => true,
        open: async () => {
          opened = true;
          return '';
        },
      }),
    );
    assert.deepEqual(openAfter, { status: 'saved_open_failed' });
    assert.equal(opened, false);
    assert.equal(readFileSync(ctx.path, 'utf8'), 'Original retained text');
  } finally {
    ctx.cleanup();
  }
});

test('destination rejects unsafe existing files and detects target swaps before write', () => {
  const ctx = tempDir();
  try {
    const unsafe = join(ctx.dir, 'unsafe.md');
    writeFileSync(unsafe, 'x');
    chmodSync(unsafe, 0o755);
    assert.throws(() => new MarkdownDestination(unsafe), /Unsafe destination/);

    const hard = join(ctx.dir, 'hard.md');
    writeFileSync(hard, 'x');
    linkSync(hard, join(ctx.dir, 'alias.md'));
    assert.throws(() => new MarkdownDestination(hard), /Unsafe destination/);

    const target = join(ctx.dir, 'target.md');
    writeFileSync(target, 'x');
    symlinkSync(target, join(ctx.dir, 'link.md'));
    assert.throws(() => new MarkdownDestination(join(ctx.dir, 'link.md')), /Unsafe destination/);

    const large = join(ctx.dir, 'large.md');
    writeFileSync(large, 'x'.repeat(artifactTextLimit + 1));
    assert.throws(() => new MarkdownDestination(large), /Unsafe destination/);

    assert.throws(() => new MarkdownDestination('relative.md'), /Invalid destination/);
    assert.throws(
      () => new MarkdownDestination(join(ctx.dir, 'artifact.txt')),
      /Invalid destination/,
    );

    const path = join(ctx.dir, 'swap.md');
    const other = join(ctx.dir, 'other.md');
    writeFileSync(path, 'old');
    const destination = new MarkdownDestination(path);
    try {
      writeFileSync(other, 'third');
      // Replace the pathname after the destination was opened. The fd points to
      // the old inode; write must fail before touching the replacement.
      rmSync(path);
      writeFileSync(path, 'third');
      assert.throws(() => destination.write('new'), /Destination changed/);
      assert.equal(readFileSync(path, 'utf8'), 'third');
    } finally {
      destination.close();
    }
  } finally {
    ctx.cleanup();
  }
});

test('destination writes new/existing files with no early truncation and rejects post-confirmation drift', async () => {
  const ctx = tempDir();
  const saver = new ArtifactSaver();
  try {
    const destination = new MarkdownDestination(ctx.path);
    try {
      assert.equal(destination.exists, false);
      destination.write('new content');
      destination.verifySaved();
      assert.equal(readFileSync(ctx.path, 'utf8'), 'new content');
    } finally {
      destination.close();
    }

    writeFileSync(ctx.path, 'old content that is longer');
    const existing = new MarkdownDestination(ctx.path);
    try {
      existing.write('short');
      existing.verifySaved();
      assert.equal(readFileSync(ctx.path, 'utf8'), 'short');
    } finally {
      existing.close();
    }

    writeFileSync(ctx.path, 'stable');
    const drift = await saver.save(
      saveInput(),
      deps({
        choose: async () => ctx.path,
        confirm: async () => {
          writeFileSync(ctx.path, 'changed during confirmation');
          return true;
        },
      }),
    );
    assert.deepEqual(drift, { status: 'failed' });
    assert.equal(readFileSync(ctx.path, 'utf8'), 'changed during confirmation');
  } finally {
    ctx.cleanup();
  }
});

test('readSaveOriginal rejects mismatched identity, malformed/oversize bodies and non-JSON MIME', async () => {
  const reference = {
    contract: 'orqst.lifecycle' as const,
    contractVersion: 1 as const,
    type: 'artifact.reference' as const,
    kind: 'message_reference' as const,
    identity: {
      sessionRef: {
        machineId: selection.machineId,
        adapterId: selection.adapter,
        nativeSessionId: selection.sessionId,
      },
      workspaceId: selection.workspaceId,
      observedAgent: { id: selection.agentId, basis: 'v1_agent_id' as const },
      agentInstanceId: { availability: 'unavailable' as const, reason: 'not_recorded' as const },
    },
    evidence: {
      kind: 'retained_v1_event' as const,
      eventId: selection.eventId,
      sequence: selection.sequence,
      occurredAt: '2026-11-02T12:00:00.000Z',
      observedAt: { availability: 'unavailable' as const, reason: 'not_recorded' as const },
      sourceVerification: 'not_rechecked' as const,
      source: {
        file: 'synthetic/artifact.jsonl',
        offset: 0,
        line: 1,
        hash: selection.sourceHash,
        recordType: 'response_item:message',
      },
    },
    turnIdentity: { availability: 'unavailable' as const, reason: 'not_recorded' as const },
    role: 'assistant' as const,
    content: { availability: 'unavailable' as const, reason: 'reference_only' as const },
  };
  const valid = artifactExtractionResultSchema.parse({
    availability: 'available',
    value: {
      contract: 'orqst.artifacts',
      contractVersion: 1,
      selection: 'manual_message',
      eventSchemaVersion: 1,
      reference,
      original: {
        text: 'Synthetic save body',
        representation: 'retained_redacted_text',
        completeness: 'not_verified',
      },
    },
  });
  const response =
    (body: string, contentType = 'application/json') =>
    async () =>
      new Response(body, { status: 200, headers: { 'content-type': contentType } });
  const origin = 'http://127.0.0.1:4322';
  assert.equal(
    await readSaveOriginal(response(JSON.stringify(valid)), origin, selection),
    'Synthetic save body',
  );

  const mismatched = JSON.parse(JSON.stringify(valid)) as typeof valid;
  if (mismatched.availability === 'available')
    mismatched.value.reference.evidence.eventId = 'other';
  await assert.rejects(
    readSaveOriginal(response(JSON.stringify(mismatched)), origin, selection),
    /Artifact mismatch/,
  );
  await assert.rejects(readSaveOriginal(response('{'), origin, selection));
  await assert.rejects(
    readSaveOriginal(response('x'.repeat(262145)), origin, selection),
    /Artifact response limit/,
  );
  await assert.rejects(
    readSaveOriginal(response(JSON.stringify(valid), 'text/plain'), origin, selection),
    /Artifact/,
  );
});

test('revocation during choose/confirm prevents write and open', async () => {
  const ctx = tempDir();
  const saver = new ArtifactSaver();
  try {
    let allow = true;
    let chooseCalls = 0;
    const chooseRevoked = await saver.save(
      saveInput(true),
      deps({
        authorized: () => allow,
        choose: async () => {
          chooseCalls++;
          allow = false;
          return ctx.path;
        },
        open: async () => '',
      }),
    );
    assert.deepEqual(chooseRevoked, { status: 'failed' });
    assert.equal(chooseCalls, 1);
    assert.throws(() => readFileSync(ctx.path), /ENOENT/);

    writeFileSync(ctx.path, 'stable');
    allow = true;
    let confirmCalls = 0;
    let opened = false;
    const confirmRevoked = await saver.save(
      saveInput(true),
      deps({
        authorized: () => allow,
        choose: async () => ctx.path,
        confirm: async () => {
          confirmCalls++;
          allow = false;
          return true;
        },
        open: async () => {
          opened = true;
          return '';
        },
      }),
    );
    assert.deepEqual(confirmRevoked, { status: 'failed' });
    assert.equal(confirmCalls, 1);
    assert.equal(opened, false);
    assert.equal(readFileSync(ctx.path, 'utf8'), 'stable');
  } finally {
    ctx.cleanup();
  }
});

test('main/preload keep one narrow save IPC and no generic filesystem or shell surface', () => {
  const main = readFileSync(join(process.cwd(), 'apps/desktop/src/main.ts'), 'utf8');
  const sender = readFileSync(join(process.cwd(), 'apps/desktop/src/artifact-sender.ts'), 'utf8');
  const preload = readFileSync(join(process.cwd(), 'apps/desktop/src/preload.ts'), 'utf8');
  const panel = readFileSync(join(process.cwd(), 'apps/dashboard/src/ArtifactPanel.tsx'), 'utf8');
  for (const value of [
    "ipcMain.handle('orqst:save-markdown'",
    'documentGeneration',
    "on('did-start-navigation'",
    "on('destroyed'",
    "removeHandler('orqst:save-markdown')",
    'dialog.showSaveDialog',
    'showOverwriteConfirmation',
    'shell.openPath',
  ])
    assert.ok(main.includes(value), value);
  for (const value of [
    'frame === expected.mainFrame',
    'event.sender === expected',
    'expected.session === session',
    '!frame.detached',
    '!frame.isDestroyed()',
    'frame.url === expected.getURL()',
    'allowedNavigation(frame.url, origin)',
  ])
    assert.ok(sender.includes(value), value);
  for (const forbidden of ['readFileSync', 'writeFileSync', 'child_process', 'exec(', 'spawn('])
    assert.equal(preload.includes(forbidden), false, forbidden);
  assert.ok(preload.includes("ipcRenderer.invoke('orqst:save-markdown'"));
  assert.ok(preload.includes('contextBridge.exposeInMainWorld'));
  assert.equal(preload.includes('shell.'), false);
  assert.equal(panel.includes('path:'), false);
  assert.ok(panel.includes('window.orqstArtifacts'));
  assert.ok(panel.includes('openAfterSave'));
});
