import {
  constants,
  closeSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
} from 'node:fs';
import { join } from 'node:path';
import { Store, readStudioFeatures } from '@orqst/database';
import type { TerminalLayoutRecord } from '@orqst/protocol';
import { terminalDirectory } from './codex-profile.js';

function checkedPreferencesFile(userData: string, readOnly: boolean) {
  const directory = join(realpathSync(userData), 'terminal-layouts');
  if (!readOnly)
    try {
      mkdirSync(directory, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  const file = join(directory, 'preferences.sqlite');
  const checkFile = (path: string) => {
    try {
      const info = lstatSync(path);
      if (
        !info.isFile() ||
        info.size > 64 * 1024 * 1024 ||
        info.nlink !== 1 ||
        info.uid !== process.getuid?.() ||
        info.mode & 0o077 ||
        realpathSync(path) !== path
      )
        throw new Error('Unsafe layout database');
      const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const opened = fstatSync(fd);
        if (opened.ino !== info.ino || opened.dev !== info.dev)
          throw new Error('Changed layout database');
      } finally {
        closeSync(fd);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  };

  try {
    lstatSync(directory);
  } catch (error) {
    if (readOnly && (error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
  terminalDirectory(directory, true);
  for (const suffix of ['', '-wal', '-shm', '-journal']) checkFile(file + suffix);
  return file;
}

/** Read durable metadata without migrating preferences or claiming terminal ownership. */
export function readStudioFeatureTree(userData: string) {
  const file = checkedPreferencesFile(userData, true);
  if (!file) return [];
  try {
    lstatSync(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  return readStudioFeatures(file);
}

/** Core-only visual metadata writer; never opens an execution journal or claims ownership. */
export function withTerminalPreferences<T>(userData: string, action: (store: Store) => T): T {
  const file = checkedPreferencesFile(userData, false);
  if (!file) throw new Error('Layout database unavailable');
  try {
    const fd = openSync(
      file,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
      0o600,
    );
    closeSync(fd);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  const store = new Store(file);
  try {
    return action(store);
  } finally {
    store.close();
  }
}

export function terminalLayoutDatabase(userData: string, identities: string[]) {
  const withStore = <T>(action: (layouts: ReturnType<Store['terminalLayouts']>) => T) =>
    withTerminalPreferences(userData, (store) => action(store.terminalLayouts()));
  return {
    read: () => withStore((layouts) => layouts.read(identities) ?? null),
    save: (record: TerminalLayoutRecord) =>
      withStore((layouts) => layouts.save(identities, record)),
    import: (record: TerminalLayoutRecord) =>
      withStore((layouts) => layouts.import(identities, record)),
  };
}
