import { z } from 'zod';
import type { DatabaseSync } from 'node:sqlite';
import { terminalLayoutRecordSchema, type TerminalLayoutRecord } from '@orqst/protocol';
import { stableId } from '@orqst/shared';

export const TERMINAL_LAYOUT_LIMITS = Object.freeze({ records: 1024, bytes: 16 * 1024 });

/** Existing Store transaction/connection; no terminal journal, owner claim or recovery. */
export function openTerminalLayouts(
  db: DatabaseSync,
  transaction: <T>(action: () => T) => T,
  featureId?: string,
) {
  if (featureId !== undefined) z.uuid().parse(featureId);
  transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS terminal_layout_schema (
        singleton INTEGER PRIMARY KEY CHECK(singleton=1), version INTEGER NOT NULL
      );
      INSERT OR IGNORE INTO terminal_layout_schema VALUES (1,1);
    `);
    if (
      db.prepare('SELECT version FROM terminal_layout_schema WHERE singleton=1').get()?.version !==
      1
    )
      throw new Error('Unsupported terminal layout schema');
    db.exec(`CREATE TABLE IF NOT EXISTS terminal_layouts (
      selection_id TEXT PRIMARY KEY,
      metadata TEXT NOT NULL CHECK(length(metadata)<=16384 AND json_valid(metadata))
    )`);
  });
  const selection = (ids: string[]) => {
    // Validate membership without granting any runtime authority.
    terminalLayoutRecordSchema.parse({
      version: 1,
      order: ids,
      shown: [],
      active: ids[0],
      maximized: null,
      axis: 'columns',
      columns: 2,
      percent: 50,
      names: [],
    });
    return featureId === undefined
      ? stableId('terminal-layout', JSON.stringify([...ids].sort()))
      : stableId('terminal-layout-feature', featureId, JSON.stringify([...ids].sort()));
  };
  const read = (ids: string[]): TerminalLayoutRecord | undefined => {
    const row = db
      .prepare('SELECT metadata FROM terminal_layouts WHERE selection_id=?')
      .get(selection(ids));
    if (!row) return;
    const text = String(row.metadata);
    if (Buffer.byteLength(text) > TERMINAL_LAYOUT_LIMITS.bytes) throw new Error('Layout too large');
    const record = terminalLayoutRecordSchema.parse(JSON.parse(text));
    if (selection(record.order) !== selection(ids)) throw new Error('Invalid layout selection');
    return record;
  };
  const write = (ids: string[], raw: TerminalLayoutRecord) => {
    const record = terminalLayoutRecordSchema.parse(raw);
    const key = selection(ids);
    if (selection(record.order) !== key) throw new Error('Invalid layout selection');
    const text = JSON.stringify(record);
    if (Buffer.byteLength(text) > TERMINAL_LAYOUT_LIMITS.bytes) throw new Error('Layout too large');
    if (
      !db.prepare('SELECT 1 FROM terminal_layouts WHERE selection_id=?').get(key) &&
      Number(db.prepare('SELECT COUNT(*) AS count FROM terminal_layouts').get()?.count) >=
        TERMINAL_LAYOUT_LIMITS.records
    )
      throw new Error('Terminal layout capacity exceeded');
    db.prepare(
      `INSERT INTO terminal_layouts VALUES (?,?)
      ON CONFLICT(selection_id) DO UPDATE SET metadata=excluded.metadata`,
    ).run(key, text);
  };
  return {
    read,
    save: (ids: string[], record: TerminalLayoutRecord) => transaction(() => write(ids, record)),
    /** First valid import wins atomically; never overwrite SQLite with a stale JSON copy. */
    import: (ids: string[], record: TerminalLayoutRecord) =>
      transaction(() => {
        const existing = read(ids);
        if (existing) return existing;
        write(ids, record);
        return read(ids)!;
      }),
  };
}
