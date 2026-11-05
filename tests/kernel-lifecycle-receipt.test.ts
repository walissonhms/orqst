// Synthetic lifecycle records: these tests never inspect real application data or start providers.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  createKernelLifecycleReceipt,
  readKernelLifecycleReceipt,
} from '../packages/core/src/managed-codex/kernel-lifecycle-receipt.js';

function fixture() {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'orqst-kernel-receipt-')));
  const binding = {
    owner: randomUUID(),
    instanceId: randomUUID(),
    epoch: randomUUID(),
    manifestDigest: 'a'.repeat(64),
    configDigest: 'b'.repeat(64),
  };
  const host = {
    boot: randomUUID(),
    pid: 200,
    ppid: 100,
    uid: 501,
    startSec: 123,
    startUsec: 400,
    sid: 100,
    pgid: 100,
  };
  const leader = { ...host, pid: 201, ppid: 200, startUsec: 500, sid: 201, pgid: 201 };
  const path = join(directory, `lifecycle-kernel-${binding.instanceId}.jsonl`);
  return {
    directory,
    binding,
    host,
    leader,
    path,
    close: () => rmSync(directory, { recursive: true, force: true }),
  };
}

test('durable receipt requires both a bound host and its new session leader', () => {
  const f = fixture();
  try {
    const receipt = createKernelLifecycleReceipt(f.directory, f.binding);
    assert.deepEqual(readKernelLifecycleReceipt(f.directory, f.binding), { status: 'unavailable' });
    receipt.host(f.host);
    assert.deepEqual(readKernelLifecycleReceipt(f.directory, f.binding), { status: 'unavailable' });
    assert.throws(() => receipt.leader({ ...f.leader, ppid: 999 }));
    assert.throws(() => receipt.leader({ ...f.leader, startUsec: f.host.startUsec }));
    receipt.leader(f.leader);
    receipt.close();
    assert.deepEqual(readKernelLifecycleReceipt(f.directory, f.binding), {
      status: 'complete',
      host: f.host,
      leader: f.leader,
    });
    assert.deepEqual(
      readKernelLifecycleReceipt(f.directory, { ...f.binding, owner: randomUUID() }),
      {
        status: 'unavailable',
      },
    );
    const bytes = readFileSync(f.path);
    writeFileSync(f.path, bytes.subarray(0, bytes.length - 1));
    assert.deepEqual(readKernelLifecycleReceipt(f.directory, f.binding), { status: 'unavailable' });
    assert.throws(() => createKernelLifecycleReceipt(f.directory, f.binding));
  } finally {
    f.close();
  }
});

test('leader must remain in the same boot and uid and lead its own session and group', () => {
  for (const patch of [{ boot: randomUUID() }, { uid: 502 }, { sid: 202 }, { pgid: 202 }]) {
    const f = fixture();
    try {
      const receipt = createKernelLifecycleReceipt(f.directory, f.binding);
      receipt.host(f.host);
      assert.throws(() => receipt.leader({ ...f.leader, ...patch }));
      receipt.close();
      assert.deepEqual(readKernelLifecycleReceipt(f.directory, f.binding), {
        status: 'unavailable',
      });
    } finally {
      f.close();
    }
  }
});
