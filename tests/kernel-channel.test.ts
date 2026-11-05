// Synthetic inherited-IPC frames; no real processes or application state.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import {
  kernelIdentityClient,
  kernelIdentityQuerySchema,
  kernelLivenessClient,
} from '../packages/core/src/terminal/kernel-channel.js';

test('private identity reply is bound to the exact outstanding request and PID', async () => {
  const sent: unknown[] = [];
  const client = kernelIdentityClient((value) => sent.push(value));
  const pending = client.query(123);
  const query = kernelIdentityQuerySchema.parse(sent[0]);
  const identity = {
    boot: randomUUID(),
    pid: 123,
    ppid: 100,
    uid: 501,
    startSec: 100,
    startUsec: 1,
    sid: 123,
    pgid: 123,
  };
  assert.equal(
    client.accept({ kind: 'kernel-identity-reply', id: randomUUID(), ok: true, identity }),
    false,
  );
  assert.equal(
    client.accept({ kind: 'kernel-identity-reply', id: query.id, ok: true, identity }),
    true,
  );
  assert.deepEqual(await pending, identity);
  assert.equal(
    client.accept({ kind: 'kernel-identity-reply', id: query.id, ok: true, identity }),
    false,
  );
  client.close();
});

test('private liveness query binds replies and never treats query failure as absence', async () => {
  const sent: { id: string }[] = [];
  const client = kernelLivenessClient((value) => sent.push(value as { id: string }));
  const identity = {
    boot: randomUUID(),
    pid: 123,
    ppid: 1,
    uid: 501,
    startSec: 1,
    startUsec: 1,
    sid: 123,
    pgid: 123,
  };
  const pending = client.query(identity);
  assert.equal(
    client.accept({ kind: 'kernel-liveness-reply', id: randomUUID(), exists: false }),
    false,
  );
  assert.equal(
    client.accept({ kind: 'kernel-liveness-reply', id: sent[0]!.id, exists: null }),
    true,
  );
  await assert.rejects(pending);
  const next = client.query(identity);
  client.close();
  await assert.rejects(next);
});

test('wrong PID, failed query and closed transport refuse rather than infer absence', async () => {
  const sent: unknown[] = [];
  const client = kernelIdentityClient((value) => sent.push(value));
  const first = client.query(123);
  const query = kernelIdentityQuerySchema.parse(sent[0]);
  const identity = {
    boot: randomUUID(),
    pid: 124,
    ppid: 100,
    uid: 501,
    startSec: 100,
    startUsec: 1,
    sid: 124,
    pgid: 124,
  };
  assert.equal(
    client.accept({ kind: 'kernel-identity-reply', id: query.id, ok: true, identity }),
    true,
  );
  await assert.rejects(first);
  const second = client.query(125);
  client.close();
  await assert.rejects(second);
  await assert.rejects(client.query(126));
});
