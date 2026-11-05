// SYNTHETIC real Node processes against one disposable SQLite journal.
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import test from 'node:test';
import type { CrossFeatureAudit, CrossFeatureMessage } from '@orqst/protocol';
import { fixture } from './helpers/cross-feature-fixture.js';

type Result = { type: string; admitted?: boolean };
function child(file: string) {
  return spawn(
    process.execPath,
    ['--import', 'tsx', resolve('tests/helpers/cross-feature-consumer.ts'), file],
    { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] },
  );
}
function messages(p: ChildProcess) {
  const values: Result[] = [];
  const waiters: ((value: Result) => void)[] = [];
  p.on('message', (raw) => {
    const waiter = waiters.shift();
    if (waiter) waiter(raw as Result);
    else values.push(raw as Result);
  });
  return () =>
    new Promise<Result>((resolveMessage) => {
      const value = values.shift();
      if (value) resolveMessage(value);
      else waiters.push(resolveMessage);
    });
}
function exit(p: ChildProcess) {
  return new Promise<number | null>((done) => p.once('exit', done));
}
function bounded<T>(p: Promise<T>): Promise<T> {
  return new Promise<T>((done, fail) => {
    const timer = setTimeout(() => fail(new Error('SYNTHETIC consumer timeout')), 8000);
    p.then(
      (v) => {
        clearTimeout(timer);
        done(v);
      },
      (error) => {
        clearTimeout(timer);
        fail(error);
      },
    );
  });
}
test(
  'two real concurrent SQLite consumers cannot commit the same grant twice',
  { timeout: 15000 },
  async () => {
    const f = fixture();
    const processes = [child(join(f.dir, 'journal.sqlite')), child(join(f.dir, 'journal.sqlite'))];
    const next = processes.map(messages),
      ends = processes.map(exit);
    try {
      assert.deepEqual(
        (await bounded(Promise.all(next.map((n) => n())))).map((m) => m.type),
        ['ready', 'ready'],
      );
      const timestamp = Date.now();
      const message: CrossFeatureMessage = {
        schemaVersion: 1,
        grant: f.grant,
        request: f.request,
        state: 'queued',
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      const g = f.grant;
      const audit: Omit<CrossFeatureAudit, 'sequence'> = {
        schemaVersion: 1,
        eventId: randomUUID(),
        timestamp,
        actorId: g.actorId,
        workspaceId: g.workspaceId,
        sourceFeatureId: g.source.featureId,
        targetFeatureId: g.target.featureId,
        sourceTerminalId: g.source.terminalId,
        targetTerminalId: g.target.terminalId,
        sourcePaneId: g.source.paneId,
        targetPaneId: g.target.paneId,
        operation: g.operation,
        grantId: g.grantId,
        intentId: g.intentId,
        messageId: f.request.messageId,
        sourceRevision: g.sourceRevision,
        targetRevision: g.targetRevision,
        outcome: 'admitted',
      };
      for (const p of processes) p.send!({ message, audit });
      const results = await bounded(Promise.all(next.map((n) => n())));
      assert.deepEqual(results.map((m) => m.admitted).sort(), [false, true]);
      assert.deepEqual(await bounded(Promise.all(ends)), [0, 0]);
      assert.equal(
        f.journal.transaction((tx) => tx.crossMessages().length),
        1,
      );
      assert.equal(
        f.journal.transaction((tx) => tx.crossEvents().length),
        1,
      );
    } finally {
      for (const p of processes) if (p.exitCode === null && p.signalCode === null) p.kill();
      await bounded(Promise.all(ends));
      f.close();
    }
  },
);
