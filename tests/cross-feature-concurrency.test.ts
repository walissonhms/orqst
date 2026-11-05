// SYNTHETIC cross-process SQLite proof; no application or provider is started.
import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { constants, mkdtempSync, rmSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

type Message = {
  type: string;
  dir?: string;
  target?: string;
  admitted?: boolean;
  claimed?: boolean;
};
const worker = resolve('tests/helpers/cross-feature-process.ts');
function start(...args: string[]) {
  return spawn(process.execPath, ['--import', 'tsx', worker, ...args], {
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  });
}
function messages(child: ChildProcess) {
  const queue: Message[] = [];
  const waiters: ((m: Message) => void)[] = [];
  child.on('message', (value) => {
    const message = value as Message;
    const waiter = waiters.shift();
    if (waiter) waiter(message);
    else queue.push(message);
  });
  return () =>
    new Promise<Message>((resolveMessage) => {
      const item = queue.shift();
      if (item) resolveMessage(item);
      else waiters.push(resolveMessage);
    });
}
function exited(child: ChildProcess) {
  return new Promise<number | null>((resolveExit) => child.once('exit', resolveExit));
}
async function release(fifo: string) {
  const deadline = Date.now() + 5000;
  for (;;) {
    try {
      const file = await open(fifo, constants.O_WRONLY | constants.O_NONBLOCK);
      try {
        await file.writeFile('continue');
      } finally {
        await file.close();
      }
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENXIO' || Date.now() >= deadline) throw error;
      // Retry only while the FIFO has no reader, with a bounded deadline.
      await delay(10);
    }
  }
}
async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('SYNTHETIC process barrier timeout')), 8000);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
async function scenario(mode: string, writePolicy: boolean) {
  const root = mkdtempSync(join(tmpdir(), 'orqst-SYNTHETIC-barrier-'));
  const fifo = join(root, 'barrier');
  assert.equal(spawnSync('mkfifo', [fifo]).status, 0);
  const child = start(mode, fifo);
  const next = messages(child);
  const end = exited(child);
  let writer: ChildProcess | undefined;
  let writerEnd: Promise<number | null> | undefined;
  let directory: string | undefined;
  try {
    const ready = await bounded(next());
    assert.equal(ready.type, 'ready');
    directory = ready.dir!;
    child.send!('go');
    if (writePolicy) {
      assert.equal((await bounded(next())).type, 'barrier');
      writer = start('writer', directory, ready.target!);
      const writerMessages = messages(writer);
      writerEnd = exited(writer);
      assert.equal((await bounded(writerMessages())).type, 'written');
      assert.equal(await bounded(writerEnd), 0);
      await bounded(release(fifo));
    }
    let result: Message | undefined;
    if (!mode.startsWith('crash')) result = await bounded(next());
    const code = await bounded(end);
    const db = new DatabaseSync(join(directory, 'journal.sqlite'), { readOnly: true });
    try {
      const count = Number(db.prepare('SELECT count(*) AS n FROM cross_feature_messages').get()?.n);
      const audit = Number(db.prepare('SELECT count(*) AS n FROM cross_feature_audit').get()?.n);
      const state = db.prepare('SELECT metadata FROM cross_feature_messages').get()?.metadata;
      const status = state ? JSON.parse(String(state)).state : undefined;
      return { result, code, count, audit, status };
    } finally {
      db.close();
    }
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    if (writer && writer.exitCode === null && writer.signalCode === null) writer.kill();
    await bounded(end);
    if (writerEnd) await bounded(writerEnd);
    if (directory) rmSync(directory, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
}
test('revocation committed before snapshot denies admission', { timeout: 15000 }, async () => {
  const r = await scenario('before', true);
  assert.equal(r.code, 0);
  assert.equal(r.result?.admitted, false);
  assert.equal(r.count, 0);
  assert.equal(r.audit, 0);
});
test(
  'revocation after snapshot orders after admission and denies next claim',
  { timeout: 15000 },
  async () => {
    const r = await scenario('after', true);
    assert.equal(r.code, 0);
    assert.equal(r.result?.admitted, true);
    assert.equal(r.result?.claimed, false);
    assert.equal(r.count, 1);
    assert.equal(r.audit, 1);
  },
);
test('concurrent writer completes while claim holds journal', { timeout: 15000 }, async () => {
  const r = await scenario('claim', true);
  assert.equal(r.code, 0);
  assert.equal(r.result?.admitted, true);
  assert.equal(r.result?.claimed, false);
  assert.equal(r.count, 1);
  assert.equal(r.audit, 1);
  assert.equal(r.status, 'queued');
});
test(
  'crash before journal commit admits nothing; crash after persists exactly once',
  { timeout: 15000 },
  async () => {
    const before = await scenario('crash-before', false);
    assert.equal(before.code, 19);
    assert.equal(before.count, 0);
    assert.equal(before.audit, 0);
    const after = await scenario('crash-after', false);
    assert.equal(after.code, 19);
    assert.equal(after.count, 1);
    assert.equal(after.audit, 1);
  },
);
