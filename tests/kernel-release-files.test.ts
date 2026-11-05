import { fork, type ChildProcess } from 'node:child_process';
import { build } from 'esbuild';
// Synthetic marker and evidence files only; no Core, app or provider is started.
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  beginKernelRelease,
  reconcileKernelRelease,
  reconcileKernelReleases,
  verifyKernelReleaseSource,
} from '../packages/core/src/terminal/kernel-release-files.js';

function fixture() {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'orqst-kernel-release-')));
  const marker = join(directory, 'active-pair.json');
  writeFileSync(marker, 'SYNTHETIC-ORIGINAL\n', { flag: 'wx', mode: 0o600 });
  return { directory, marker, close: () => rmSync(directory, { recursive: true, force: true }) };
}

test('the same marker cannot start two recoveries; interruption before rename needs review', () => {
  const f = fixture();
  try {
    const { name, lock } = beginKernelRelease(f.directory);
    assert.throws(() => beginKernelRelease(f.directory), { code: 'EEXIST' });
    assert.deepEqual(verifyKernelReleaseSource(f.directory, name), lock);
    assert.equal(reconcileKernelRelease(f.directory, name).status, 'review_required');
    assert.equal(readFileSync(f.marker, 'utf8'), 'SYNTHETIC-ORIGINAL\n');
  } finally {
    f.close();
  }
});

test('a fresh fenced recovery preserves and references the previous marker lock', () => {
  const f = fixture();
  try {
    const original = beginKernelRelease(f.directory);
    const successor = beginKernelRelease(f.directory, { validate: () => {} });
    assert.equal(successor.lock.previousRecovery, original.lock.id);
    assert.notEqual(successor.name, original.name);
    assert.deepEqual(verifyKernelReleaseSource(f.directory, original.name), original.lock);
    assert.deepEqual(verifyKernelReleaseSource(f.directory, successor.name), successor.lock);
  } finally {
    f.close();
  }
});

test('interrupted post-rename commit records uncertain durability and leaves a new marker alone', () => {
  const f = fixture();
  try {
    const { name, lock } = beginKernelRelease(f.directory);
    renameSync(f.marker, join(f.directory, lock.destination));
    writeFileSync(f.marker, 'SYNTHETIC-NEW-OWNER\n', { flag: 'wx', mode: 0o600 });
    assert.throws(() => verifyKernelReleaseSource(f.directory, name), /changed/);
    assert.equal(reconcileKernelRelease(f.directory, name).status, 'released_durability_uncertain');
    assert.equal(reconcileKernelRelease(f.directory, name).status, 'released_durability_uncertain');
    assert.equal(reconcileKernelReleases(f.directory)[0]?.status, 'released_durability_uncertain');
    assert.equal(readFileSync(f.marker, 'utf8'), 'SYNTHETIC-NEW-OWNER\n');
    const observation = JSON.parse(
      readFileSync(join(f.directory, `release-observation-${lock.id}.json`), 'utf8'),
    );
    assert.equal(observation.limitation, 'descendants_not_validated');
  } finally {
    f.close();
  }
});

test('missing original and archive records uncertainty without creating a marker', () => {
  const f = fixture();
  try {
    const { name, lock } = beginKernelRelease(f.directory);
    rmSync(f.marker);
    assert.equal(reconcileKernelRelease(f.directory, name).status, 'uncertain');
    const observation = JSON.parse(
      readFileSync(join(f.directory, `release-observation-${lock.id}.json`), 'utf8'),
    );
    assert.equal(observation.status, 'uncertain');
    assert.throws(() => readFileSync(f.marker));
  } finally {
    f.close();
  }
});

test('two processes cannot lock the same marker and a post-rename crash is reconciled', async () => {
  const f = fixture();
  const workerPath = join(f.directory, 'synthetic-worker.cjs');
  let a: ChildProcess | undefined;
  let b: ChildProcess | undefined;
  const ask = (child: ChildProcess, command: string) =>
    new Promise<unknown>((resolveReply, reject) => {
      const timer = setTimeout(() => reject(new Error('Synthetic recovery timed out')), 5000);
      child.once('message', (value) => {
        clearTimeout(timer);
        resolveReply(value);
      });
      child.send(command, (error) => {
        if (error) {
          clearTimeout(timer);
          reject(error);
        }
      });
    });
  try {
    await build({
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'node24',
      outfile: workerPath,
      stdin: {
        resolveDir: process.cwd(),
        loader: 'ts',
        contents: `
        import { beginKernelRelease } from './packages/core/src/terminal/kernel-release-files.ts';
        import { renameSync } from 'node:fs';
        import { join } from 'node:path';
        let owned: ReturnType<typeof beginKernelRelease> | undefined;
        process.on('message', (message) => {
          if (message === 'begin') { try { owned = beginKernelRelease(process.argv[2]!); process.send!({ ok: true, ...owned }); } catch { process.send!({ ok: false }); } }
          if (message === 'crash' && owned) { renameSync(join(process.argv[2]!, 'active-pair.json'), join(process.argv[2]!, owned.lock.destination)); process.exit(79); }
        });
      `,
      },
    });
    a = fork(workerPath, [f.directory], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    b = fork(workerPath, [f.directory], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    const replies = await Promise.all([ask(a, 'begin'), ask(b, 'begin')]);
    const winners = replies
      .map((raw, index) => ({
        result: raw as { ok: boolean; name?: string; lock?: { destination: string } },
        child: index === 0 ? a! : b!,
      }))
      .filter(({ result }) => result.ok);
    assert.equal(winners.length, 1);
    const winner = winners[0]!;
    assert.equal(typeof winner.result.name, 'string');
    const exited = new Promise<number | null>((done) => winner.child.once('exit', done));
    winner.child.send('crash');
    assert.equal(await exited, 79);
    writeFileSync(f.marker, 'SYNTHETIC-NEW-OWNER\n', { flag: 'wx', mode: 0o600 });
    assert.throws(() => verifyKernelReleaseSource(f.directory, winner.result.name!), /changed/);
    assert.equal(
      reconcileKernelRelease(f.directory, winner.result.name!).status,
      'released_durability_uncertain',
    );
    assert.equal(readFileSync(f.marker, 'utf8'), 'SYNTHETIC-NEW-OWNER\n');
  } finally {
    if (a?.connected) a.disconnect();
    if (b?.connected) b.disconnect();
    f.close();
  }
});

test('an existing offline fence prevents a kernel release, including a late fence before commit', () => {
  const first = fixture();
  try {
    writeFileSync(join(first.directory, 'offline-recovery.json'), 'SYNTHETIC', { mode: 0o600 });
    assert.throws(() => beginKernelRelease(first.directory), /offline recovery/);
  } finally {
    first.close();
  }
  const second = fixture();
  try {
    const { name } = beginKernelRelease(second.directory);
    writeFileSync(join(second.directory, 'offline-recovery-operation.lock'), 'SYNTHETIC', {
      mode: 0o600,
    });
    assert.throws(() => verifyKernelReleaseSource(second.directory, name), /offline recovery/);
    assert.equal(readFileSync(second.marker, 'utf8'), 'SYNTHETIC-ORIGINAL\n');
  } finally {
    second.close();
  }
});
