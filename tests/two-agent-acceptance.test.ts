// SYNTHETIC acceptance results only. No native CLI, credentials or provider access.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { closeSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  assertTwoAgentAcceptanceResults,
  twoAgentCleanupConfirmed,
  twoAgentAcceptancePrompts,
} from '../scripts/terminal/two-agent-acceptance.js';
import {
  armLifecycleReceipt,
  createLifecycleReceipt,
  readLifecycleReceipt,
} from '../packages/core/src/managed-codex/lifecycle-receipt.js';

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

test('acceptance requires matching durable and still-owned exits, preserving signal-only evidence', async () => {
  const state = realpathSync(mkdtempSync(join(tmpdir(), 'orqst-synthetic-acceptance-receipt-')));
  const binding = {
    instanceId: randomUUID(),
    epoch: randomUUID(),
    manifestDigest: 'a'.repeat(64),
    configDigest: 'b'.repeat(64),
  };
  const fd = createLifecycleReceipt(state, binding);
  try {
    const writer = armLifecycleReceipt(fd, binding.configDigest);
    await writer.record({ type: 'started' });
    const snapshot = {
      state: 'exited' as const,
      nativeExit: { code: null, signal: 'SIGTERM' },
    };
    assert.equal(twoAgentCleanupConfirmed(snapshot, readLifecycleReceipt(state, binding)), false);
    await writer.record({ type: 'exit', ...snapshot.nativeExit });
    const receipt = readLifecycleReceipt(state, binding);
    assert.equal(twoAgentCleanupConfirmed(snapshot, receipt), true);
    assert.equal(
      twoAgentCleanupConfirmed({ ...snapshot, state: 'ownership_lost' }, receipt),
      false,
    );
    assert.equal(twoAgentCleanupConfirmed({ ...snapshot, nativeExit: null }, receipt), false);
    assert.equal(
      twoAgentCleanupConfirmed({ ...snapshot, nativeExit: { code: 0, signal: null } }, receipt),
      false,
    );
    assert.equal(
      twoAgentCleanupConfirmed(
        { ...snapshot, nativeExit: { code: null, signal: 'SIGKILL' } },
        receipt,
      ),
      false,
    );
    assert.equal(
      twoAgentCleanupConfirmed(
        snapshot,
        readLifecycleReceipt(state, { ...binding, epoch: randomUUID() }),
      ),
      false,
    );
    assert.equal(twoAgentCleanupConfirmed(snapshot, { status: 'missing' }), false);
  } finally {
    closeSync(fd);
    rmSync(state, { recursive: true, force: true });
  }
});
