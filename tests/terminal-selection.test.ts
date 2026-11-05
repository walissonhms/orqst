// Disposable synthetic manifests only. No Electron, native provider, credentials or native DB.
import assert from 'node:assert/strict';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import {
  TerminalSelection,
  inspectTerminalSelection,
  TerminalPreCoreFailure,
} from '../apps/desktop/src/terminal-selection.js';
import {
  managedCodexSettings,
  terminalExecutableSha256,
  type ManagedCodexConfig,
} from '../packages/core/src/terminal/codex-profile.js';

const node = realpathSync(process.execPath);
const binary = { path: node, sha256: terminalExecutableSha256(node) };

test('legacy Claude TUI remains inspectable but is refused before selection or Core', async () => {
  const f = fixture();
  try {
    const file = f.files[0]!;
    const state = join(f.root, 'a');
    writeFileSync(
      file,
      JSON.stringify({
        version: 2,
        provider: 'claude',
        trust: 'native-same-user',
        executable: binary,
        executableVersion: '2.1.178',
        node: binary,
        project: join(f.root, 'project'),
        state,
        sessionId: randomUUID(),
        authentication: {
          mode: 'reuse-existing',
          home: join(f.root, 'b'),
          sharedNativeConfiguration: true,
        },
        interactive: { sharedNativeSessions: true },
      }),
      { mode: 0o600 },
    );
    assert.equal(
      JSON.parse(inspectTerminalSelection([file]).detail)[0].blocker,
      'launch_unavailable',
    );
    let confirms = 0;
    const selection = new TerminalSelection();
    assert.equal(
      await selection.review({
        current: () => true,
        choose: async () => [file],
        confirm: async () => {
          confirms++;
          return true;
        },
      }),
      'launch_unavailable',
    );
    assert.equal(confirms, 0);
    assert.throws(() => selection.take(), /No available/);
    assert.equal(selection.locked, false);
  } finally {
    f.close();
  }
});

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'orqst-synthetic-selection-')));
  chmodSync(root, 0o700);
  const project = join(root, 'project');
  mkdirSync(project, { mode: 0o700 });
  const files = ['a', 'b'].map((slot) => {
    const state = join(root, slot);
    mkdirSync(state, { mode: 0o700 });
    for (const name of ['home', 'codex', 'tmp']) mkdirSync(join(state, name), { mode: 0o700 });
    const config: ManagedCodexConfig = {
      version: 1,
      trust: 'native-same-user',
      executable: binary,
      executableVersion: 'SYNTHETIC-NEVER-EXECUTED',
      node: binary,
      project,
      state,
    };
    writeFileSync(join(state, 'codex/config.toml'), managedCodexSettings(config), { mode: 0o600 });
    const file = join(state, 'terminal.json');
    writeFileSync(file, JSON.stringify(config), { mode: 0o600 });
    return file;
  });
  const before = () => readdirSync(root, { recursive: true });
  return {
    root,
    files,
    before,
    ports: {
      current: () => true,
      choose: async () => files,
      confirm: async () => true,
    },
    close: () => rmSync(root, { recursive: true, force: true }),
  };
}

test('native selection reviews complete ordered manifests without writes; opening consumes once', async () => {
  const f = fixture();
  try {
    const before = f.before();
    const selection = new TerminalSelection();
    let confirmations = 0;
    assert.equal(
      await selection.review({
        ...f.ports,
        confirm: async (detail) => {
          const displayed = JSON.parse(detail);
          assert.deepEqual(
            displayed.map((slot: { file: string }) => slot.file),
            f.files,
          );
          assert.equal(displayed[0].config.executable.sha256, binary.sha256);
          assert.equal(displayed[0].blocker, null);
          confirmations++;
          return true;
        },
      }),
      'reviewed',
    );
    assert.equal(confirmations, 1);
    assert.equal(selection.count, 2);
    assert.deepEqual(f.before(), before);
    assert.deepEqual(selection.take(), f.files);
    assert.equal(selection.locked, true);
    assert.deepEqual(f.before(), before);
    assert.throws(() => selection.take(), /available/);
    assert.equal(await selection.review(f.ports), 'denied');
  } finally {
    f.close();
  }
});

test('only native pre-Core failure evidence releases the latch and discards the old selection', async () => {
  const f = fixture();
  try {
    const selection = new TerminalSelection();
    assert.equal(await selection.review(f.ports), 'reviewed');
    selection.take();
    assert.throws(() => selection.retryBeforeCore(new Error('uncertain')), /proven/);
    assert.equal(selection.locked, true);
    selection.retryBeforeCore(new TerminalPreCoreFailure('SYNTHETIC cleanup before Core'));
    assert.equal(selection.locked, false);
    assert.equal(selection.count, 0);
    assert.throws(() => selection.take(), /available/);
    assert.equal(await selection.review(f.ports), 'reviewed');
    assert.deepEqual(selection.take(), f.files);
  } finally {
    f.close();
  }
});

test('cancel, absent focus and expired/stale dialogs cannot register a selection', async () => {
  const f = fixture();
  try {
    for (const stage of [
      'choose-cancel',
      'confirm-cancel',
      'before',
      'choose',
      'confirm',
      'expiry',
    ]) {
      let current = stage !== 'before';
      let time = 0;
      const selection = new TerminalSelection(() => time);
      const result = await selection.review({
        current: () => current,
        choose: async () => {
          if (stage === 'choose') current = false;
          return stage === 'choose-cancel' ? undefined : f.files;
        },
        confirm: async () => {
          if (stage === 'confirm') current = false;
          if (stage === 'expiry') time = 60000;
          return stage !== 'confirm-cancel';
        },
      });
      assert.equal(result, stage.endsWith('cancel') ? 'cancelled' : 'denied', stage);
      assert.equal(selection.count, 0, stage);
      assert.equal(selection.locked, false, stage);
    }
  } finally {
    f.close();
  }
});

test('pending review is exclusive and an earlier in-memory selection survives cancellation', async () => {
  const f = fixture();
  try {
    const selection = new TerminalSelection();
    assert.equal(
      await selection.review({ ...f.ports, choose: async () => [f.files[0]!] }),
      'reviewed',
    );
    let release!: () => void;
    const paused = selection.review({
      ...f.ports,
      choose: async () => {
        await new Promise<void>((done) => {
          release = done;
        });
        return undefined;
      },
    });
    assert.equal(await selection.review(f.ports), 'busy');
    assert.throws(() => selection.take(), /available/);
    release();
    assert.equal(await paused, 'cancelled');
    assert.equal(selection.count, 1);
    assert.deepEqual(selection.take(), [f.files[0]!]);
  } finally {
    f.close();
  }
});

test('manifest drift during confirmation, after review, and same-byte inode replacement fail closed', async () => {
  const f = fixture();
  try {
    const file = f.files[0]!;
    const original = readFileSync(file);
    const selection = new TerminalSelection();
    assert.equal(
      await selection.review({
        ...f.ports,
        confirm: async () => {
          writeFileSync(file, Buffer.concat([original, Buffer.from('\n')]));
          return true;
        },
      }),
      'denied',
    );
    writeFileSync(file, original);
    assert.equal(await selection.review(f.ports), 'reviewed');
    writeFileSync(file, Buffer.concat([original, Buffer.from('\n')]));
    assert.throws(() => selection.take(), /changed/);
    assert.equal(selection.locked, false);
    writeFileSync(file, original);
    assert.equal(await selection.review(f.ports), 'reviewed');
    renameSync(file, file + '.old');
    writeFileSync(file, original, { mode: 0o600 });
    assert.throws(() => selection.take(), /changed/);
    assert.equal(selection.locked, false);
  } finally {
    f.close();
  }
});

test('new journals and changed executable pins cannot be hidden between review and opening', async () => {
  const f = fixture();
  try {
    const selection = new TerminalSelection();
    assert.equal(await selection.review(f.ports), 'reviewed');
    writeFileSync(join(f.root, 'a/terminal.sqlite'), 'SYNTHETIC-NOT-A-DATABASE', { mode: 0o600 });
    assert.throws(() => selection.take(), /changed/);
    // Reviewing existing state preserves its blocker; it never adopts the journal.
    const inspected = JSON.parse(inspectTerminalSelection(f.files).detail);
    assert.equal(inspected[0].blocker, 'existing_state');
    const file = f.files[1]!;
    const config: ManagedCodexConfig = JSON.parse(readFileSync(file, 'utf8'));
    config.node.sha256 = '0'.repeat(64);
    writeFileSync(file, JSON.stringify(config));
    assert.equal(await selection.review(f.ports), 'denied');
  } finally {
    f.close();
  }
});

test('native review rejects duplicate, symlinked, public, oversized or unsupported manifests', async () => {
  const f = fixture();
  try {
    const file = f.files[0]!;
    const alias = join(f.root, 'alias.json');
    symlinkSync(file, alias);
    for (const files of [[], [...f.files, file], [file, file], [alias]])
      assert.throws(() => inspectTerminalSelection(files));
    chmodSync(file, 0o644);
    assert.throws(() => inspectTerminalSelection([file]), /private/);
    chmodSync(file, 0o600);
    const original = readFileSync(file);
    writeFileSync(file, JSON.stringify({ ...JSON.parse(original.toString()), argv: ['--resume'] }));
    assert.throws(() => inspectTerminalSelection([file]));
    writeFileSync(file, ' '.repeat(16385));
    assert.throws(() => inspectTerminalSelection([file]), /Untrusted/);
  } finally {
    f.close();
  }
});

test('native review escapes invisible controls, pages complete details and rejects oversized pages', () => {
  const f = fixture();
  try {
    const project = join(f.root, 'project-\u202e');
    mkdirSync(project, { mode: 0o700 });
    const updateProject = (project: string, nativeReuse = false) => {
      for (const file of f.files) {
        const config: ManagedCodexConfig = JSON.parse(readFileSync(file, 'utf8'));
        config.project = project;
        if (nativeReuse)
          config.authentication = {
            mode: 'reuse-existing',
            home: project,
            codexHome: project,
            sharedNativeConfiguration: true,
          };
        writeFileSync(file, JSON.stringify(config));
        writeFileSync(join(config.state, 'codex/config.toml'), managedCodexSettings(config));
      }
    };
    updateProject(project);
    const review = inspectTerminalSelection(f.files);
    assert.equal(review.detail.includes('\u202e'), false);
    assert.ok(review.detail.includes('\\u{202e}'));
    const longProject = join(f.root, ...Array.from({ length: 4 }, () => 'p'.repeat(190)));
    mkdirSync(longProject, { recursive: true, mode: 0o700 });
    updateProject(longProject, true);
    const paged = inspectTerminalSelection(f.files);
    assert.equal(paged.pages.length, 2);
    assert.ok(paged.pages.every((page) => page.length <= 4096));
    assert.deepEqual(
      paged.pages.flatMap((page) => JSON.parse(page)).map((slot) => slot.file),
      f.files,
    );
    const oversized = join(f.root, ...Array.from({ length: 3 }, () => '\u202e'.repeat(60)));
    mkdirSync(oversized, { recursive: true, mode: 0o700 });
    updateProject(oversized, true);
    assert.throws(() => inspectTerminalSelection(f.files), /too large/);
  } finally {
    f.close();
  }
});
