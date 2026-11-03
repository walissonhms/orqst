import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import {
  terminalAttemptSchema,
  type TerminalAttempt,
  type TerminalJournal,
  type TerminalState,
} from '@orqst/protocol';

const terminalJournalMigration = `
CREATE TABLE terminal_schema (singleton INTEGER PRIMARY KEY CHECK(singleton=1), version INTEGER NOT NULL);
INSERT INTO terminal_schema VALUES (1,2);
CREATE TABLE terminal_owner (singleton INTEGER PRIMARY KEY CHECK(singleton=1), epoch TEXT NOT NULL);
CREATE TABLE terminal_attempts (
 instance_id TEXT PRIMARY KEY, epoch TEXT NOT NULL, project_id TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('prepared','starting','running','exited','start_failed','ownership_lost')),
 updated_at INTEGER NOT NULL, metadata TEXT NOT NULL CHECK(
   length(metadata)<=2048 AND json_valid(metadata)
   AND json_extract(metadata,'$.instanceId') IS instance_id
   AND json_extract(metadata,'$.epoch') IS epoch
   AND json_extract(metadata,'$.projectId') IS project_id
   AND json_extract(metadata,'$.state') IS state
   AND json_extract(metadata,'$.updatedAt') IS updated_at
 )
);
CREATE INDEX terminal_attempts_admission ON terminal_attempts(state,project_id);
`;
export const TERMINAL_JOURNAL_LIMITS = Object.freeze({
  attempts: 10_000,
  retentionMs: 30 * 86400_000,
});
const transitions: Record<TerminalState, readonly TerminalState[]> = {
  prepared: ['starting', 'start_failed'],
  starting: ['running', 'exited', 'ownership_lost'],
  running: ['exited', 'ownership_lost'],
  exited: [],
  start_failed: [],
  ownership_lost: [],
};

/** Existing Store connection/transaction only; no second writer or filesystem access. */
export function openTerminalJournal(
  db: DatabaseSync,
  transaction: <T>(action: () => T) => T,
  epoch: string,
  recover: boolean,
  now: () => number = Date.now,
): TerminalJournal {
  z.uuid().parse(epoch);
  z.boolean().parse(recover);
  if (db.isTransaction) throw new Error('Terminal journal requires an independent commit');
  db.exec('PRAGMA synchronous=FULL');
  let released = false;
  let depth = 0;
  const commit = <T>(action: () => T): T => {
    if (db.isTransaction && !depth)
      throw new Error('Terminal journal requires an independent commit');
    return transaction(() => {
      depth++;
      try {
        return action();
      } finally {
        depth--;
      }
    });
  };
  const read = (instanceId: string): TerminalAttempt | undefined => {
    const row = db
      .prepare('SELECT metadata FROM terminal_attempts WHERE instance_id=?')
      .get(instanceId);
    return row ? terminalAttemptSchema.parse(JSON.parse(String(row.metadata))) : undefined;
  };
  const save = (record: TerminalAttempt) => {
    terminalAttemptSchema.parse(record);
    db.prepare(
      `UPDATE terminal_attempts SET state=?,updated_at=?,metadata=? WHERE instance_id=?`,
    ).run(record.state, record.updatedAt, JSON.stringify(record), record.instanceId);
  };
  const assertOwner = () => {
    if (
      released ||
      db.prepare('SELECT epoch FROM terminal_owner WHERE singleton=1').get()?.epoch !== epoch
    )
      throw new Error('Terminal journal ownership unavailable');
  };
  const reconcile = () => {
    const rows = db
      .prepare(
        "SELECT metadata FROM terminal_attempts WHERE state IN ('prepared','starting','running')",
      )
      .all();
    for (const row of rows) {
      const record = terminalAttemptSchema.parse(JSON.parse(String(row.metadata)));
      save({
        ...record,
        state: record.state === 'prepared' ? 'start_failed' : 'ownership_lost',
        updatedAt: Math.max(now(), record.updatedAt),
      });
    }
  };
  commit(() => {
    if (
      !db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='terminal_schema'").get()
    )
      db.exec(terminalJournalMigration);
    // Version 2 preserves v1 metadata and adds nullable-code/string-signal exit evidence.
    if (db.prepare('SELECT version FROM terminal_schema WHERE singleton=1').get()?.version === 1)
      db.exec('UPDATE terminal_schema SET version=2 WHERE singleton=1');
    if (db.prepare('SELECT version FROM terminal_schema WHERE singleton=1').get()?.version !== 2)
      throw new Error('Unsupported terminal journal schema');
    if (
      Number(db.prepare('SELECT COUNT(*) AS count FROM terminal_attempts').get()?.count) >
      TERMINAL_JOURNAL_LIMITS.attempts
    )
      throw new Error('Terminal journal capacity exceeded');
    const owner = db.prepare('SELECT epoch FROM terminal_owner WHERE singleton=1').get();
    // Recovery is an explicit trusted-composition decision, never inferred from inactivity.
    if (owner && (!recover || owner.epoch === epoch))
      throw new Error('Terminal journal already owned');
    reconcile();
    db.prepare('INSERT OR REPLACE INTO terminal_owner VALUES (1,?)').run(epoch);
  });
  return {
    epoch,
    assertOwner,
    withOwner: <T>(effect: () => T): T => {
      // Confirmed synchronous callbacks remain facts even when the backend later throws.
      const outcome = commit(() => {
        assertOwner();
        try {
          return { ok: true as const, value: effect() };
        } catch (error) {
          return { ok: false as const, error };
        }
      });
      if (!outcome.ok) throw outcome.error;
      return outcome.value;
    },
    read,
    prepare: (input) =>
      commit(() => {
        assertOwner();
        const timestamp = now();
        const record = terminalAttemptSchema.parse({
          ...input,
          epoch,
          state: 'prepared',
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        db.prepare(
          "DELETE FROM terminal_attempts WHERE state IN ('exited','start_failed') AND updated_at<?",
        ).run(timestamp - TERMINAL_JOURNAL_LIMITS.retentionMs);
        if (
          Number(db.prepare('SELECT COUNT(*) AS count FROM terminal_attempts').get()?.count) >=
          TERMINAL_JOURNAL_LIMITS.attempts
        )
          throw new Error('Terminal journal capacity exceeded');
        db.prepare('INSERT INTO terminal_attempts VALUES (?,?,?,?,?,?)').run(
          record.instanceId,
          epoch,
          record.projectId,
          record.state,
          timestamp,
          JSON.stringify(record),
        );
      }),
    transition: (instanceId, state, exit) =>
      commit(() => {
        assertOwner();
        const record = read(instanceId);
        if (!record || record.epoch !== epoch || !transitions[record.state].includes(state))
          throw new Error('Terminal journal transition denied');
        if (state === 'starting') {
          const active = db
            .prepare(
              "SELECT project_id FROM terminal_attempts WHERE state IN ('starting','running','ownership_lost')",
            )
            .all();
          if (active.length >= 2 || active.some((row) => row.project_id === record.projectId))
            throw new Error('Terminal durable admission limit exceeded');
        }
        save({
          ...record,
          state,
          updatedAt: Math.max(now(), record.updatedAt),
          ...(exit === undefined ? {} : { exit }),
        });
      }),
    release: () =>
      commit(() => {
        assertOwner();
        reconcile();
        db.prepare('DELETE FROM terminal_owner WHERE singleton=1 AND epoch=?').run(epoch);
        released = true;
      }),
  };
}
