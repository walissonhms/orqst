// SYNTHETIC acceptance results only. No native CLI, credentials or provider access.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertTwoAgentAcceptanceResults,
  twoAgentAcceptancePrompts,
} from '../scripts/terminal/two-agent-acceptance.js';

test('acceptance rejects a correct root receipt when the actual worker marker is missing or wrong', () => {
  const marker = 'ORQST_B_SYNTHETIC';
  const root = Buffer.from(`A_RECEIVED:${marker}`);
  const worker = Buffer.from(marker);
  assertTwoAgentAcceptanceResults(marker, [worker], root);
  for (const results of [[], [Buffer.from('SYNTHETIC_WRONG')], [worker, worker]])
    assert.throws(() => assertTwoAgentAcceptanceResults(marker, results, root));
  assert.throws(() =>
    assertTwoAgentAcceptanceResults(marker, [worker], Buffer.from('SYNTHETIC_WRONG')),
  );
});

test('acceptance prompts bind the exact target/task within existing UTF-8 request limits', () => {
  const target = '369d7bfd-af2e-4636-93b8-2fe32c0523f5';
  const marker = 'ORQST_B_369d7bfd-af2e-4636-93b8-2fe32c0523f5';
  const { delegatedTask, text } = twoAgentAcceptancePrompts(target, marker);
  assert.ok(text.includes(JSON.stringify(target)));
  assert.ok(text.includes(JSON.stringify(delegatedTask)));
  assert.ok(text.includes(`A_RECEIVED:${marker}`));
  assert.ok(Buffer.byteLength(text) <= 4096);
  assert.ok(Buffer.byteLength(delegatedTask) <= 2048);
});
