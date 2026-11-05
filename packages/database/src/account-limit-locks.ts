import type { DatabaseSync } from 'node:sqlite';

/** Private ORQST preference only; no account credential or provider state is stored. */
export function openAccountLimitLocks(db: DatabaseSync, transaction: <T>(action: () => T) => T) {
  transaction(() => {
    db.exec(`CREATE TABLE IF NOT EXISTS account_limit_lock_schema (
      singleton INTEGER PRIMARY KEY CHECK(singleton=1), version INTEGER NOT NULL
    ); INSERT OR IGNORE INTO account_limit_lock_schema VALUES (1,1);`);
    if (
      db.prepare('SELECT version FROM account_limit_lock_schema WHERE singleton=1').get()
        ?.version !== 1
    )
      throw new Error('Unsupported account lock schema');
    db.exec(`CREATE TABLE IF NOT EXISTS account_limit_locks (
      account_id TEXT PRIMARY KEY CHECK(length(account_id) BETWEEN 1 AND 64),
      locked INTEGER NOT NULL CHECK(locked IN (0,1))
    )`);
  });
  const id = (value: string) => {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,63}$/.test(value)) throw new Error('Invalid account');
    return value;
  };
  return {
    read: (accountId: string) => {
      const row = db
        .prepare('SELECT locked FROM account_limit_locks WHERE account_id=?')
        .get(id(accountId));
      if (!row) return false;
      if (row.locked !== 0 && row.locked !== 1) throw new Error('Invalid account lock');
      return row.locked === 1;
    },
    write: (accountId: string, locked: boolean) =>
      transaction(() => {
        if (typeof locked !== 'boolean') throw new Error('Invalid account lock');
        const account = id(accountId);
        if (
          !db.prepare('SELECT 1 FROM account_limit_locks WHERE account_id=?').get(account) &&
          Number(db.prepare('SELECT COUNT(*) AS count FROM account_limit_locks').get()?.count) >= 32
        )
          throw new Error('Account lock capacity exceeded');
        db.prepare(
          `INSERT INTO account_limit_locks(account_id,locked) VALUES (?,?)
        ON CONFLICT(account_id) DO UPDATE SET locked=excluded.locked`,
        ).run(account, locked ? 1 : 0);
      }),
  };
}
