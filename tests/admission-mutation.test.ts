import assert from 'node:assert/strict';
import { fork, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import { acquireAdmissionMutation } from '../packages/core/src/terminal/admission-mutation.js';
import { AdministrativeReviewPipe } from '../apps/desktop/src/offline-recovery-wire.js';

function syntheticIdentity() {
  return {
    boot: 'a967f412-e7a2-4058-b62b-53574410d401',
    pid: process.pid,
    ppid: process.ppid,
    uid: process.getuid!(),
    startSec: 1,
    startUsec: 0,
    sid: 1,
    pgid: 1,
  };
}

test('private kernel reply is bound to the request and rejects malformed identity', async () => {
  const frames: object[] = [];
  const pipe = new AdministrativeReviewPipe((frame) => frames.push(frame));
  const pending = pipe.kernelIdentity();
  const request = frames[0] as { id: string };
  pipe.kernelAnswer({
    kind: 'kernel-answer',
    session: pipe.session,
    id: request.id,
    result: syntheticIdentity(),
  });
  assert.equal((await pending).pid, process.pid);
  const invalid = pipe.kernelIdentity();
  const second = frames[1] as { id: string };
  pipe.kernelAnswer({ kind: 'kernel-answer', session: pipe.session, id: second.id, result: null });
  await assert.rejects(invalid);
  pipe.close();
});

test('unreadable or partial mutation lock fails closed', async () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'orqst-mutation-')));
  try {
    writeFileSync(join(directory, 'admission-mutation.lock'), '{', { mode: 0o600 });
    await assert.rejects(
      acquireAdmissionMutation(directory, syntheticIdentity(), async () => false),
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('live holder blocks and one of two real successors wins after its death', async () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'orqst-mutation-')));
  const workerPath = join(directory, 'worker.cjs');
  const marker = join(directory, 'active-pair.json');
  const children: ChildProcess[] = [];
  const ask = (child: ChildProcess) =>
    new Promise<{ ok: boolean; error?: string }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Mutation worker timed out')), 5000);
      child.once('message', (message) => {
        clearTimeout(timer);
        resolve(message as { ok: boolean; error?: string });
      });
      child.send('acquire');
    });
  try {
    writeFileSync(marker, 'SYNTHETIC ORIGINAL', { flag: 'wx', mode: 0o600 });
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
          import { acquireAdmissionMutation } from './packages/core/src/terminal/admission-mutation.ts';
          process.on('message', async () => {
            const owner = {boot:'a967f412-e7a2-4058-b62b-53574410d401',pid:process.pid,ppid:process.ppid,uid:process.getuid!(),startSec:1,startUsec:0,sid:1,pgid:1};
            try { await acquireAdmissionMutation(process.argv[2]!, owner, async (p) => { try { process.kill(p.pid, 0); return true; } catch(e) { if ((e as NodeJS.ErrnoException).code === 'ESRCH') return false; throw e; } }); process.send!({ok:true}); }
            catch(e) { process.send!({ok:false,error:(e as Error).message}); }
          });
        `,
      },
    });
    const spawn = () => {
      const child = fork(workerPath, [directory], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
      children.push(child);
      return child;
    };
    const first = spawn();
    assert.equal((await ask(first)).ok, true);
    // A has the lock and has checked this exact inode; B cannot mutate its name.
    const checkedInode = statSync(marker, { bigint: true }).ino;
    const second = spawn();
    assert.match((await ask(second)).error ?? '', /in progress/);
    assert.equal(statSync(marker, { bigint: true }).ino, checkedInode);
    assert.equal(readFileSync(marker, 'utf8'), 'SYNTHETIC ORIGINAL');
    const exit = new Promise<void>((resolve) => first.once('exit', () => resolve()));
    first.kill();
    await exit;
    const third = spawn();
    const results = await Promise.all([ask(second), ask(third)]);
    assert.equal(results.filter((result) => result.ok).length, 1);
  } finally {
    for (const child of children) if (child.connected) child.disconnect();
    rmSync(directory, { recursive: true, force: true });
  }
});
