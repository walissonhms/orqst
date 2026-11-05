import { closeSync, lstatSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { preferencesSchema } from '@orqst/protocol';
import { terminalDirectory } from './codex-profile.js';
import { constants, fstatSync, openSync } from 'node:fs';

/** Existing observer preferences, read-only; no fallback enables notifications on read failure. */
export function ownedNotificationPreferences(admissionDirectory: string) {
  const directory = join(dirname(realpathSync(admissionDirectory)), 'core');
  const file = join(directory, 'orqst.db');
  return () => {
    terminalDirectory(directory, true);
    if (realpathSync(file) !== file) throw new Error('Unsafe notification preferences');
    for (const path of [file, `${file}-wal`, `${file}-shm`]) {
      try {
        const info = lstatSync(path);
        if (
          !info.isFile() ||
          info.nlink !== 1 ||
          info.uid !== process.getuid?.() ||
          info.mode & 0o077
        )
          throw new Error('Unsafe notification preferences');
      } catch (error) {
        if (path === file || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    let db: DatabaseSync | undefined;
    try {
      const before = fstatSync(fd);
      db = new DatabaseSync(file, { readOnly: true });
      db.exec('PRAGMA query_only=ON');
      const after = lstatSync(file);
      if (before.ino !== after.ino || before.dev !== after.dev)
        throw new Error('Changed notification preferences');
      const row = db
        .prepare("SELECT value FROM settings WHERE key='notifications' AND length(value)<=1024")
        .get();
      if (!row || typeof row.value !== 'string')
        throw new Error('Missing notification preferences');
      return preferencesSchema.parse(JSON.parse(row.value));
    } finally {
      db?.close();
      closeSync(fd);
    }
  };
}
