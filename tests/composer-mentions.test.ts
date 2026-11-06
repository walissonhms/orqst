// Synthetic private directory only; no provider, PTY or network.
import assert from 'node:assert/strict';
import { chmod, mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { recordComposerMention } from '../packages/core/src/terminal/composer-mentions.js';

const a = '00000000-0000-4000-8000-000000000011';
const b = '00000000-0000-4000-8000-000000000012';
const stranger = '00000000-0000-4000-8000-000000000099';

test('mentions are recorded privately and never claim delivery', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'orqst-mentions-'));
  await chmod(directory, 0o700);
  try {
    const reply = recordComposerMention(directory, 'synthetic-workspace', null, [a, b], {
      from: { kind: 'user' },
      to: [b, stranger],
      text: 'synthetic request',
    });
    assert.deepEqual(reply.outcomes, [
      { terminalId: b, delivery: 'unsupported', reason: 'no_structured_route' },
      { terminalId: stranger, delivery: 'denied', reason: 'unknown_terminal' },
    ]);
    const outsider = recordComposerMention(directory, 'synthetic-workspace', null, [a, b], {
      from: { kind: 'terminal', terminalId: stranger },
      to: [a],
      text: 'synthetic',
    });
    assert.deepEqual(outsider.outcomes, [
      { terminalId: a, delivery: 'denied', reason: 'not_member' },
    ]);
    const root = join(directory, 'composer-mentions');
    const files = await readdir(root);
    assert.equal(files.length, 2);
    const info = await stat(join(root, files[0]!));
    assert.equal(info.mode & 0o077, 0, 'journal entries are private');
    const record = JSON.parse(await readFile(join(root, `${reply.id}.json`), 'utf8'));
    assert.equal(record.text, 'synthetic request');
    assert.deepEqual(record.from, { kind: 'user' });
    assert.throws(() =>
      recordComposerMention(directory, 'synthetic-workspace', null, [a], {
        from: { kind: 'user' },
        to: [a, a],
        text: 'dup',
      }),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('hub delivery applies only to owner messages inside a Feature', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'orqst-mentions-'));
  await chmod(directory, 0o700);
  try {
    let delivered = 0;
    // Unassigned terminals have no Feature: the owner note stays recorded, not delivered.
    const reply = recordComposerMention(
      directory,
      'synthetic-workspace',
      null,
      [a, b],
      { from: { kind: 'user' }, to: [b], text: 'synthetic' },
      () => {
        delivered++;
        return { delivery: 'queued', reason: 'hub_inbox' };
      },
    );
    assert.equal(delivered, 0);
    assert.deepEqual(reply.outcomes, [
      { terminalId: b, delivery: 'unsupported', reason: 'no_structured_route' },
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
