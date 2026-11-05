// SYNTHETIC real Node processes against one disposable SQLite journal.
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { join, resolve } from 'node:path';
import test from 'node:test';
import type { CrossFeatureAudit, CrossFeatureMessage } from '@orqst/protocol';
import { fixture } from './helpers/cross-feature-fixture.js';

type Result = { type: string; admitted?: boolean; dir?: string; epoch?: string; error?: string };
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

function databaseState(file: string) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const tables = db
      .prepare("SELECT name, sql FROM sqlite_master WHERE type='table' ORDER BY name")
      .all();
    return tables.map((table) => ({
      table,
      rows: db
        .prepare(`SELECT * FROM "${String(table.name).replaceAll('"', '""')}"`)
        .all()
        .map((row) => JSON.stringify(row))
        .sort(),
    }));
  } finally {
    db.close();
  }
}

test(
  'a second real process cannot open the owned journal or change its state',
  { timeout: 15000 },
  async () => {
    const worker = resolve('tests/helpers/cross-feature-owner.ts');
    const start = (mode: string) =>
      spawn(process.execPath, ['--import', 'tsx', worker, mode], {
        stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
      });
    const owner = start('owner');
    const ownerNext = messages(owner);
    const ownerEnd = exit(owner);
    let contender: ChildProcess | undefined;
    let contenderEnd: Promise<number | null> | undefined;
    let directory: string | undefined;
    try {
      const ready = await bounded(ownerNext());
      assert.equal(ready.type, 'ready');
      assert.ok(ready.dir && ready.epoch);
      directory = ready.dir;
      const journal = join(ready.dir, 'journal.sqlite');
      const preferences = join(ready.dir, 'terminal-layouts', 'preferences.sqlite');
      const before = [databaseState(journal), databaseState(preferences)];
      contender = start('contender');
      const contenderNext = messages(contender);
      contenderEnd = exit(contender);
      assert.equal((await bounded(contenderNext())).type, 'ready');
      contender.send!({ file: journal, epoch: ready.epoch });
      assert.deepEqual(await bounded(contenderNext()), {
        type: 'result',
        error: 'Communication already owned',
      });
      assert.equal(await bounded(contenderEnd), 0);
      assert.deepEqual([databaseState(journal), databaseState(preferences)], before);
      owner.send!('stop');
      assert.equal(await bounded(ownerEnd), 0);
    } finally {
      for (const p of [owner, contender])
        if (p && p.exitCode === null && p.signalCode === null) p.kill();
      await bounded(ownerEnd);
      if (contenderEnd) await bounded(contenderEnd);
      if (directory) rmSync(directory, { recursive: true, force: true });
    }
  },
);
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
