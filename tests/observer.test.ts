import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFile, mkdtemp, writeFile, rm, rename, symlink, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '@orqst/database';
import { CodexObserver } from '@orqst/adapter-codex';
import { meta, record, token } from './fixtures.js';
const jsonl = (value: unknown) => JSON.stringify(value) + '\n';

test('handles partial UTF-8 writes, malformed records, restart, truncation, rotation and duplicate replay', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'orqst-observer-'));
  const root = join(dir, 'sessions');
  await import('node:fs/promises').then((fs) => fs.mkdir(root));
  const file = join(root, 'rollout.jsonl');
  const store = new Store(join(dir, 'db'));
  let observer = new CodexObserver({ root, store });
  try {
    const message = record('response_item', {
      type: 'message',
      id: 'm1',
      role: 'assistant',
      phase: 'final_answer',
      content: [{ type: 'output_text', text: 'Synthetic ação 🦜' }],
    });
    const encoded = Buffer.from(JSON.stringify(message));
    const split = encoded.indexOf(Buffer.from('🦜')) + 2;
    await writeFile(file, jsonl(meta()) + '{broken}\n');
    await appendFile(file, encoded.subarray(0, split));
    await observer.scan();
    assert.equal(store.events().length, 1);
    assert.equal(observer.diagnostics.malformed, 1);
    await appendFile(file, Buffer.concat([encoded.subarray(split), Buffer.from('\n')]));
    await observer.scan();
    assert.equal(store.sessions()[0]?.result, 'Synthetic ação 🦜');
    assert.equal(store.events().length, 2);
    await observer.stop();
    observer = new CodexObserver({ root, store });
    await observer.scan();
    assert.equal(store.events().length, 2);
    await writeFile(
      file,
      jsonl(meta()) +
        jsonl(message) +
        jsonl(
          record('token_usage_record', { response_id: 'r1', thread_token_usage: token(100, 10) }),
        ),
    );
    await observer.scan();
    assert.equal(store.totals().total, 110);
    assert.equal(store.events().length, 3);
    await rename(file, join(root, 'rotated.jsonl'));
    await writeFile(file, jsonl(meta('second', '/synthetic/second')));
    await observer.scan();
    assert.equal(store.sessions().length, 2);
    assert.equal(store.totals().total, 110);
    await appendFile(
      file,
      jsonl(record('event_msg', { type: 'task_complete', last_agent_message: 'Synthetic done' })),
    );
    await observer.scan();
    assert.equal(store.sessions().find((s) => s.id === 'second')?.status, 'completed');
  } finally {
    await observer.stop();
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test('ignores symlinks, preserves source bytes, and skips oversized records without losing subsequent events', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'orqst-safety-'));
  const root = join(dir, 'sessions');
  const fs = await import('node:fs/promises');
  await fs.mkdir(root);
  const file = join(root, 'valid.jsonl'),
    outside = join(dir, 'outside.jsonl');
  const content =
    jsonl(meta()) +
    'x'.repeat(3 * 1024 * 1024) +
    '\n' +
    jsonl(record('event_msg', { type: 'task_complete' }));
  await writeFile(file, content);
  await writeFile(outside, jsonl(meta('outside')));
  await symlink(outside, join(root, 'escape.jsonl'));
  const store = new Store(':memory:');
  const observer = new CodexObserver({ root, store });
  try {
    await observer.scan();
    assert.equal(store.sessions().length, 1);
    assert.equal(store.sessions()[0]?.status, 'completed');
    assert.equal(observer.diagnostics.oversized, 1);
    assert.equal(await readFile(file, 'utf8'), content);
    await observer.scan();
    assert.equal(observer.diagnostics.oversized, 1);
  } finally {
    await observer.stop();
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test('watcher discovers external sessions and sends live completions only after initial import', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'orqst-watch-'));
  const store = new Store(':memory:');
  const received: { type: string; live: boolean }[] = [];
  const observer = new CodexObserver({
    root: dir,
    store,
    pollMs: 50,
    onEvent: (event, live) => received.push({ type: event.type, live }),
  });
  try {
    await writeFile(join(dir, 'a.jsonl'), jsonl(meta()));
    await observer.start();
    const now = new Date().toISOString();
    await appendFile(
      join(dir, 'a.jsonl'),
      jsonl({
        ...record('event_msg', {
          type: 'task_complete',
          last_agent_message: 'Synthetic live result',
        }),
        timestamp: now,
      }),
    );
    const timeout = Date.now() + 3000;
    while (!received.some((event) => event.live) && Date.now() < timeout)
      await new Promise((resolve) => setTimeout(resolve, 25));
    assert.ok(received.some((event) => event.type === 'agent.completed' && event.live));
    assert.equal(store.notifications().length, 1);
  } finally {
    await observer.stop();
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});
