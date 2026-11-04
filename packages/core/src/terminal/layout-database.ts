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
import { Store } from '@orqst/database';
import type { TerminalLayoutRecord } from '@orqst/protocol';
import { terminalDirectory } from './codex-profile.js';

/** Core-only visual metadata writer; never opens an execution journal or claims ownership. */
export function terminalLayoutDatabase(userData: string, identities: string[]) {
  const directory = join(realpathSync(userData), 'terminal-layouts');
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
  const withStore = <T>(action: (layouts: ReturnType<Store['terminalLayouts']>) => T): T => {
    terminalDirectory(directory, true);
    for (const suffix of ['', '-wal', '-shm', '-journal']) checkFile(file + suffix);
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
      return action(store.terminalLayouts());
    } finally {
      store.close();
    }
  };
  return {
    read: () => withStore((layouts) => layouts.read(identities) ?? null),
    save: (record: TerminalLayoutRecord) =>
      withStore((layouts) => layouts.save(identities, record)),
    import: (record: TerminalLayoutRecord) =>
      withStore((layouts) => layouts.import(identities, record)),
  };
}
