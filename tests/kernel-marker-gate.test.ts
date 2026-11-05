// Real child processes contend only on a disposable synthetic marker.
import assert from 'node:assert/strict';
import { fork, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

function exchange(child: ChildProcess, command: string) {
  return new Promise<unknown>((resolveReply, reject) => {
    const timeout = setTimeout(() => reject(new Error('Synthetic child timed out')), 5000);
    child.once('message', (reply) => {
      clearTimeout(timeout);
      resolveReply(reply);
    });
    child.send(command, (error) => {
      if (error) {
        clearTimeout(timeout);
        reject(error);
      }
    });
  });
}

test('exclusive marker blocks another Core during review; the original inode is archived', async () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'orqst-kernel-gate-')));
  const fixture = resolve('tests/helpers/kernel-marker-fixture.mjs');
  const owner = fork(fixture, [directory, 'owner'], {
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  const contender = fork(fixture, [directory, 'contender'], {
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  try {
    assert.equal(await exchange(owner, 'reserve'), 'reserved');
    const marker = join(directory, 'active-pair.json');
    const original = statSync(marker, { bigint: true });
    assert.equal(await exchange(owner, 'verify'), 'verifying');
    assert.equal(await exchange(contender, 'claim'), 'reserved');
    assert.equal(readFileSync(marker, 'utf8'), 'SYNTHETIC-OWNER\n');
    assert.equal(await exchange(owner, 'release'), 'released');
    const archive = join(directory, 'released-original.json');
    assert.equal(statSync(archive, { bigint: true }).ino, original.ino);
    assert.equal(readFileSync(archive, 'utf8'), 'SYNTHETIC-OWNER\n');
    assert.equal(await exchange(contender, 'claim'), 'claimed');
    assert.equal(readFileSync(marker, 'utf8'), 'SYNTHETIC-CONTENDER\n');
  } finally {
    owner.disconnect();
    contender.disconnect();
    rmSync(directory, { recursive: true, force: true });
  }
});
