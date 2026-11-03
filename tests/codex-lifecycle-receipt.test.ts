// SYNTHETIC receipts and owned disposable native children only. Never run a provider.
import assert from 'node:assert/strict';
import { fork, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import {
  chmodSync,
  closeSync,
  constants,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import { Store } from '@orqst/database';
import {
  armLifecycleReceipt,
  createLifecycleReceipt,
  readLifecycleReceipt,
  type LifecycleBinding,
} from '../packages/core/src/managed-codex/lifecycle-receipt.js';
import { terminalDigest } from '../packages/core/src/terminal/authority.js';
import {
  managedCodexSettings,
  terminalExecutableSha256,
  type ManagedCodexConfig,
} from '../packages/core/src/terminal/codex-profile.js';

function fixture() {
  const state = realpathSync(mkdtempSync(join(tmpdir(), 'orqst-SYNTHETIC-receipt-')));
  const binding: LifecycleBinding = {
    instanceId: randomUUID(),
    epoch: randomUUID(),
    manifestDigest: 'a'.repeat(64),
    configDigest: 'b'.repeat(64),
  };
  const path = join(state, `lifecycle-${binding.instanceId}.jsonl`);
  return { state, binding, path, close: () => rmSync(state, { recursive: true, force: true }) };
}

test('receipt preserves exact identity, ordered signal-only exit, permissions and exclusive creation', async () => {
  const f = fixture();
  let fd: number | undefined;
  try {
    fd = createLifecycleReceipt(f.state, f.binding);
    assert.equal(statSync(f.path).mode & 0o777, 0o600);
    assert.equal(readLifecycleReceipt(f.state, f.binding).status, 'incomplete');
    assert.throws(() => createLifecycleReceipt(f.state, f.binding));
    const writer = armLifecycleReceipt(fd, f.binding.configDigest);
    assert.throws(() => armLifecycleReceipt(fd!, f.binding.configDigest));
    assert.throws(() => writer.record({ type: 'exit', code: 0, signal: null }));
    await writer.record({ type: 'started' });
    await writer.record({ type: 'exit', code: null, signal: 'SIGTERM' });
    assert.throws(() => writer.record({ type: 'started' }));
    const evidence = readLifecycleReceipt(f.state, f.binding);
    assert.equal(evidence.status, 'recorded_exit');
    assert.deepEqual(evidence.records?.at(-1), {
      type: 'exit',
      code: null,
      signal: 'SIGTERM',
      at: evidence.records?.at(-1)?.at,
    });
    for (const field of ['instanceId', 'epoch', 'manifestDigest', 'configDigest'] as const) {
      const wrong = {
        ...f.binding,
        [field]: field.endsWith('Digest') ? 'c'.repeat(64) : randomUUID(),
      };
      assert.notEqual(readLifecycleReceipt(f.state, wrong).status, 'recorded_exit');
    }
  } finally {
    if (fd !== undefined) closeSync(fd);
    f.close();
  }
});

test('partial, excessive, reordered, symlinked and public receipts cannot establish exit', () => {
  const f = fixture();
  try {
    assert.equal(readLifecycleReceipt(f.state, f.binding).status, 'missing');
    closeSync(createLifecycleReceipt(f.state, f.binding));
    const header = readFileSync(f.path, 'utf8');
    const armed = JSON.stringify({ type: 'armed', at: Date.now() }) + '\n';
    const started = JSON.stringify({ type: 'started', at: Date.now() }) + '\n';
    const exit = JSON.stringify({ type: 'exit', at: Date.now(), code: 0, signal: null }) + '\n';
    for (const content of [
      header + armed + exit,
      header + armed + started + exit.slice(0, -1),
      header + 'x'.repeat(4097),
      header + armed + started + exit + exit,
    ]) {
      writeFileSync(f.path, content);
      assert.equal(readLifecycleReceipt(f.state, f.binding).status, 'invalid');
    }
    writeFileSync(f.path, header + armed + started + exit);
    chmodSync(f.path, 0o644);
    assert.equal(readLifecycleReceipt(f.state, f.binding).status, 'invalid');
    chmodSync(f.path, 0o600);
    const target = join(f.state, 'synthetic-target');
    writeFileSync(target, header + armed + started + exit, { mode: 0o600 });
    rmSync(f.path);
    symlinkSync(target, f.path);
    assert.equal(readLifecycleReceipt(f.state, f.binding).status, 'invalid');
    assert.throws(() => createLifecycleReceipt(f.state, f.binding));
    assert.equal(readFileSync(target, 'utf8'), header + armed + started + exit);
  } finally {
    f.close();
  }
});

test('receipt write failure is explicit and does not fabricate exit; reading never releases lost reservation', async () => {
  const f = fixture();
  const store = new Store(join(f.state, 'SYNTHETIC.sqlite'));
  try {
    const journal = store.terminalJournal(f.binding.epoch, { recover: false });
    journal.prepare({
      instanceId: f.binding.instanceId,
      manifestDigest: f.binding.manifestDigest,
      clientId: 'synthetic',
      projectId: 'synthetic-project',
    });
    journal.transition(f.binding.instanceId, 'starting');
    journal.transition(f.binding.instanceId, 'ownership_lost');
    const fd = createLifecycleReceipt(f.state, f.binding);
    const writer = armLifecycleReceipt(fd, f.binding.configDigest);
    await writer.record({ type: 'started' });
    await writer.record({ type: 'exit', code: 17, signal: null });
    closeSync(fd);
    assert.equal(readLifecycleReceipt(f.state, f.binding).status, 'recorded_exit');
    assert.equal(journal.read(f.binding.instanceId)?.state, 'ownership_lost');
    assert.throws(() => journal.transition(f.binding.instanceId, 'exited', { exitCode: 17 }));
    const next = randomUUID();
    journal.prepare({
      instanceId: next,
      manifestDigest: f.binding.manifestDigest,
      clientId: 'synthetic',
      projectId: 'synthetic-project',
    });
    assert.throws(() => journal.transition(next, 'starting'), /admission/);
    const other = { ...f.binding, instanceId: randomUUID() };
    closeSync(createLifecycleReceipt(f.state, other));
    const readonly = openSync(
      join(f.state, `lifecycle-${other.instanceId}.jsonl`),
      constants.O_RDONLY,
    );
    try {
      assert.throws(() => armLifecycleReceipt(readonly, other.configDigest));
    } finally {
      closeSync(readonly);
    }
    assert.equal(readLifecycleReceipt(f.state, other).status, 'incomplete');
    journal.release();
  } finally {
    store.close();
    f.close();
  }
});

test(
  'actual structured host persists its own child signal exit after IPC loss',
  { timeout: 15000, skip: process.platform !== 'darwin' || process.arch !== 'arm64' },
  async () => {
    const f = fixture();
    let host: ReturnType<typeof fork> | undefined;
    try {
      const executable = join(f.state, 'SYNTHETIC-native-child');
      const compile = spawnSync(
        '/usr/bin/cc',
        [resolve('tests/helpers/structured-lifecycle-fixture.c'), '-o', executable],
        { encoding: 'utf8' },
      );
      assert.equal(compile.status, 0, compile.stderr);
      chmodSync(executable, 0o700);
      const state = join(f.state, 'private-state');
      const project = join(f.state, 'empty-project');
      mkdirSync(project, { mode: 0o700 });
      mkdirSync(state, { mode: 0o700 });
      for (const directory of ['home', 'codex', 'tmp'])
        mkdirSync(join(state, directory), { mode: 0o700 });
      const config: ManagedCodexConfig = {
        version: 1,
        trust: 'native-same-user',
        executable: { path: executable, sha256: terminalExecutableSha256(executable) },
        executableVersion: 'SYNTHETIC-NOT-CODEX',
        node: {
          path: realpathSync(process.execPath),
          sha256: terminalExecutableSha256(realpathSync(process.execPath)),
        },
        state,
        project,
      };
      writeFileSync(join(state, 'codex/config.toml'), managedCodexSettings(config), {
        mode: 0o600,
      });
      const file = join(state, 'synthetic-config.json');
      const bytes = JSON.stringify(config);
      writeFileSync(file, bytes, { mode: 0o600 });
      const binding = { ...f.binding, configDigest: terminalDigest(bytes) };
      const bundle = join(f.state, 'SYNTHETIC-actual-host.cjs');
      await build({
        entryPoints: ['packages/core/src/managed-codex/native-host.ts'],
        outfile: bundle,
        bundle: true,
        platform: 'node',
        target: 'node24',
        format: 'cjs',
      });
      const fd = createLifecycleReceipt(state, binding);
      try {
        host = fork(bundle, [file], {
          execArgv: [],
          stdio: ['ignore', 'ignore', 'ignore', 'ipc', fd],
        });
      } finally {
        closeSync(fd);
      }
      const done = once(host, 'exit');
      const [message] = await once(host, 'message');
      assert.equal(message.type, 'started');
      assert.equal(readLifecycleReceipt(state, binding).status, 'incomplete');
      const disconnectedAt = Date.now();
      host.disconnect();
      await done;
      const evidence = readLifecycleReceipt(state, binding);
      assert.equal(evidence.status, 'recorded_exit');
      assert.equal(evidence.records?.at(-1)?.type, 'exit');
      assert.ok(evidence.records!.at(-1)!.at >= disconnectedAt);
      assert.deepEqual(evidence.records?.at(-1), {
        type: 'exit',
        code: null,
        signal: 'SIGTERM',
        at: evidence.records?.at(-1)?.at,
      });
      // A host exit with a pre-launch receipt alone would remain incomplete.
      const other = { ...binding, instanceId: randomUUID() };
      closeSync(createLifecycleReceipt(state, other));
      assert.equal(readLifecycleReceipt(state, other).status, 'incomplete');
    } finally {
      if (host?.connected) host.disconnect();
      f.close();
    }
  },
);

test('inspection CLI verifies only the selected receipt and never rewrites evidence', async () => {
  const f = fixture();
  try {
    const fd = createLifecycleReceipt(f.state, f.binding);
    const writer = armLifecycleReceipt(fd, f.binding.configDigest);
    await writer.record({ type: 'started' });
    await writer.record({ type: 'exit', code: 9, signal: null });
    closeSync(fd);
    const before = readFileSync(f.path);
    const args = [
      '--import',
      'tsx',
      resolve('scripts/inspect-codex-lifecycle.ts'),
      '--state',
      f.state,
      '--instance',
      f.binding.instanceId,
      '--epoch',
      f.binding.epoch,
      '--manifest-sha256',
      f.binding.manifestDigest,
      '--config-sha256',
      f.binding.configDigest,
    ];
    const result = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 5000 });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).status, 'recorded_exit');
    const denied = spawnSync(process.execPath, [...args, '--recover'], {
      encoding: 'utf8',
      timeout: 5000,
    });
    assert.equal(denied.status, 1);
    assert.equal(denied.stdout, '');
    assert.deepEqual(readFileSync(f.path), before);
  } finally {
    f.close();
  }
});

test('post-arm I/O failure poisons queued lifecycle evidence without manufacturing exit', async () => {
  const f = fixture();
  try {
    const fd = createLifecycleReceipt(f.state, f.binding);
    const writer = armLifecycleReceipt(fd, f.binding.configDigest);
    closeSync(fd); // Disposable injected storage failure, never a live provider descriptor.
    const results = await Promise.allSettled([
      writer.record({ type: 'started' }),
      writer.record({ type: 'exit', code: 0, signal: null }),
    ]);
    assert.deepEqual(
      results.map((result) => result.status),
      ['rejected', 'rejected'],
    );
    const evidence = readLifecycleReceipt(f.state, f.binding);
    assert.equal(evidence.status, 'incomplete');
    assert.deepEqual(
      evidence.records?.map((record) => record.type),
      ['armed'],
    );
  } finally {
    f.close();
  }
});
