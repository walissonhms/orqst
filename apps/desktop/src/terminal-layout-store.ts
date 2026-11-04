import { createHash, randomUUID } from 'node:crypto';
import {
  constants,
  closeSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  renameSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import {
  terminalLayoutRecordSchema as layoutSchema,
  type TerminalLayoutRecord,
} from '@orqst/protocol';
import {
  terminalDirectory,
  terminalFile,
} from '../../../packages/core/src/terminal/codex-profile.js';
import { type TerminalLayoutPreferences } from './terminal-layout.js';

/** Main-owned preferences only; neither renderer paths nor process/session recovery data. */
export function legacyTerminalLayoutStore(userData: string, identities: string[]) {
  const directory = join(realpathSync(userData), 'terminal-layouts');
  const key = createHash('sha256')
    .update(JSON.stringify([...identities].sort()))
    .digest('hex');
  const file = join(directory, `${key}.json`);
  const prepare = () => {
    mkdirSync(directory, { mode: 0o700 });
  };
  try {
    prepare();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  const check = () => terminalDirectory(directory, true);
  check();
  return {
    load(): TerminalLayoutPreferences | undefined {
      check();
      let raw: Buffer;
      try {
        raw = terminalFile(file, true);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
        throw error;
      }
      const saved = layoutSchema.parse(JSON.parse(raw.toString('utf8')));
      if (
        saved.order.length !== identities.length ||
        saved.order.some((id) => !identities.includes(id)) ||
        saved.shown.some((id) => !identities.includes(id)) ||
        !identities.includes(saved.active) ||
        (saved.maximized !== null && !saved.shown.includes(saved.maximized)) ||
        saved.names.some(({ id }) => !identities.includes(id))
      )
        throw new Error('Invalid layout identities');
      return {
        axis: saved.axis,
        columns: saved.columns,
        percent: saved.percent,
        order: saved.order.map((id) => identities.indexOf(id)),
        shown: saved.shown.map((id) => identities.indexOf(id)),
        active: identities.indexOf(saved.active),
        maximized: saved.maximized === null ? null : identities.indexOf(saved.maximized),
        names: identities.map((id) => saved.names.find((name) => name.id === id)?.name ?? ''),
      };
    },
    save(state: TerminalLayoutPreferences): void {
      check();
      const value = layoutSchema.parse({
        version: 1,
        axis: state.axis,
        columns: state.columns,
        percent: state.percent,
        order: state.order.map((index) => identities[index]),
        shown: state.shown.map((index) => identities[index]),
        active: identities[state.active],
        maximized: state.maximized === null ? null : identities[state.maximized],
        names: state.names.flatMap((name, index) =>
          name ? [{ id: identities[index], name }] : [],
        ),
      });
      try {
        const existing = lstatSync(file);
        if (
          !existing.isFile() ||
          existing.nlink !== 1 ||
          existing.uid !== process.getuid?.() ||
          existing.mode & 0o077
        )
          throw new Error('Unsafe layout file');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      const temporary = join(directory, `${key}.${randomUUID()}.tmp`);
      try {
        const fd = openSync(
          temporary,
          constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
          0o600,
        );
        try {
          if (!fstatSync(fd).isFile()) throw new Error('Unsafe layout file');
          writeFileSync(fd, JSON.stringify(value) + '\n');
          fsyncSync(fd);
        } finally {
          closeSync(fd);
        }
        check();
        renameSync(temporary, file);
      } finally {
        try {
          unlinkSync(temporary);
        } catch {
          // Cleanup must not replace a write failure; a leftover private temp grants no authority.
        }
      }
    },
  };
}

/** Client-only UUID mapping and preserved JSON reader. SQLite lives in the owned Core. */
export function terminalLayoutStore(
  userData: string,
  identities: string[],
  backend: {
    read(): Promise<TerminalLayoutRecord | null>;
    save(record: TerminalLayoutRecord): Promise<unknown>;
    import(record: TerminalLayoutRecord): Promise<TerminalLayoutRecord>;
  },
) {
  const legacy = legacyTerminalLayoutStore(userData, identities);
  const record = (state: TerminalLayoutPreferences) =>
    layoutSchema.parse({
      version: 1,
      axis: state.axis,
      columns: state.columns,
      percent: state.percent,
      order: state.order.map((index) => identities[index]),
      shown: state.shown.map((index) => identities[index]),
      active: identities[state.active],
      maximized: state.maximized === null ? null : identities[state.maximized],
      names: state.names.flatMap((name, index) => (name ? [{ id: identities[index], name }] : [])),
    });
  const decode = (raw: unknown): TerminalLayoutPreferences => {
    const saved = layoutSchema.parse(raw);
    if (
      saved.order.length !== identities.length ||
      saved.order.some((id) => !identities.includes(id))
    )
      throw new Error('Invalid layout identities');
    return {
      axis: saved.axis,
      columns: saved.columns,
      percent: saved.percent,
      order: saved.order.map((id) => identities.indexOf(id)),
      shown: saved.shown.map((id) => identities.indexOf(id)),
      active: identities.indexOf(saved.active),
      maximized: saved.maximized === null ? null : identities.indexOf(saved.maximized),
      names: identities.map((id) => saved.names.find((name) => name.id === id)?.name ?? ''),
    };
  };
  return {
    async load(): Promise<TerminalLayoutPreferences | undefined> {
      let saved = await backend.read();
      if (saved === null) {
        const previous = legacy.load();
        if (!previous) return;
        saved = await backend.import(record(previous));
      }
      return decode(saved);
    },
    async save(state: TerminalLayoutPreferences): Promise<void> {
      await backend.save(record(state));
    },
  };
}
