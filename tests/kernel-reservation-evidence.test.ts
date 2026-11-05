// Entirely synthetic receipt files in private temporary directories.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { closeSync, mkdtempSync, realpathSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  createLifecycleReceipt,
  armLifecycleReceipt,
} from '../packages/core/src/managed-codex/lifecycle-receipt.js';
import { createKernelLifecycleReceipt } from '../packages/core/src/managed-codex/kernel-lifecycle-receipt.js';
import { inspectKernelMember } from '../packages/core/src/terminal/kernel-reservation-evidence.js';

function fixture() {
  const state = realpathSync(mkdtempSync(join(tmpdir(), 'orqst-kernel-evidence-')));
  const owner = randomUUID();
  const binding = {
    instanceId: randomUUID(),
    epoch: randomUUID(),
    manifestDigest: 'a'.repeat(64),
    configDigest: 'b'.repeat(64),
  };
  const core = {
    boot: randomUUID(),
    pid: 100,
    ppid: 1,
    uid: 501,
    startSec: 1,
    startUsec: 1,
    sid: 100,
    pgid: 100,
  };
  const host = { ...core, pid: 101, ppid: 100, startUsec: 2 };
  const leader = { ...host, pid: 102, ppid: 101, startUsec: 3, sid: 102, pgid: 102 };
  return {
    state,
    owner,
    binding,
    core,
    host,
    leader,
    close: () => rmSync(state, { recursive: true, force: true }),
  };
}

test('binds complete immutable receipts even when their old journal row was pruned', async () => {
  const f = fixture();
  try {
    const fd = createLifecycleReceipt(f.state, f.binding);
    const lifecycle = armLifecycleReceipt(fd, f.binding.configDigest);
    await lifecycle.record({ type: 'started' });
    closeSync(fd);
    const writer = createKernelLifecycleReceipt(f.state, { ...f.binding, owner: f.owner });
    writer.core(f.core);
    writer.host(f.host);
    writer.leader(f.leader);
    writer.close();
    const result = inspectKernelMember(
      f.state,
      f.owner,
      f.binding.epoch,
      f.binding.configDigest,
      [],
    );
    assert.equal(result.length, 1);
    assert.deepEqual(result[0]?.core, f.core);
    assert.deepEqual(result[0]?.leader, f.leader);
    assert.throws(() =>
      inspectKernelMember(f.state, randomUUID(), f.binding.epoch, f.binding.configDigest, []),
    );
    unlinkSync(join(f.state, `lifecycle-kernel-${f.binding.instanceId}.jsonl`));
    assert.throws(
      () => inspectKernelMember(f.state, f.owner, f.binding.epoch, f.binding.configDigest, []),
      /not recorded/,
    );
  } finally {
    f.close();
  }
});

test('missing identity for a dispatched journal entry denies, while a prepared-only member is inert', () => {
  const f = fixture();
  try {
    const attempt = {
      instanceId: f.binding.instanceId,
      epoch: f.binding.epoch,
      clientId: 'desktop-managed',
      projectId: 'synthetic',
      manifestDigest: f.binding.manifestDigest,
      state: 'prepared' as const,
      createdAt: 1,
      updatedAt: 1,
    };
    assert.deepEqual(
      inspectKernelMember(f.state, f.owner, f.binding.epoch, f.binding.configDigest, [attempt]),
      [],
    );
    assert.throws(
      () =>
        inspectKernelMember(f.state, f.owner, f.binding.epoch, f.binding.configDigest, [
          { ...attempt, state: 'starting' },
        ]),
      /missing/,
    );
  } finally {
    f.close();
  }
});
