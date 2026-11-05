import { DatabaseSync } from 'node:sqlite';
import { terminalAttemptSchema } from '@orqst/protocol';
import { TERMINAL_JOURNAL_LIMITS, terminalJournalMigration } from './terminal-journal.js';

export const OFFLINE_JOURNAL_BYTES = 16 * 1024 * 1024;

/** Pure committed WAL overlay. Does not open source SQLite or its SHM. */
export function committedTerminalImage(base: Buffer, wal: Buffer | null): Buffer {
  if (
    base.length < 100 ||
    base.length > OFFLINE_JOURNAL_BYTES ||
    base.subarray(0, 16).toString('binary') !== 'SQLite format 3\0'
  )
    throw new Error('Invalid offline database');
  const size = base.readUInt16BE(16) === 1 ? 65536 : base.readUInt16BE(16);
  if (size < 512 || size > 65536 || size & (size - 1) || base.length % size)
    throw new Error('Invalid offline page size');
  let result = Buffer.from(base);
  if (wal?.length) {
    if (wal.length < 32) throw new Error('Invalid offline WAL');
    const magic = wal.readUInt32BE(0);
    if (
      wal.length < 32 ||
      wal.length > OFFLINE_JOURNAL_BYTES ||
      ![0x377f0682, 0x377f0683].includes(magic) ||
      wal.readUInt32BE(4) !== 3007000 ||
      wal.readUInt32BE(8) !== size ||
      (wal.length - 32) % (size + 24)
    )
      throw new Error('Invalid offline WAL');
    let first = 0;
    let second = 0;
    const checksum = (bytes: Buffer) => {
      for (let offset = 0; offset < bytes.length; offset += 8) {
        const a = magic === 0x377f0682 ? bytes.readUInt32LE(offset) : bytes.readUInt32BE(offset);
        const b =
          magic === 0x377f0682 ? bytes.readUInt32LE(offset + 4) : bytes.readUInt32BE(offset + 4);
        first = (first + a + second) >>> 0;
        second = (second + b + first) >>> 0;
      }
    };
    checksum(wal.subarray(0, 24));
    if (first !== wal.readUInt32BE(24) || second !== wal.readUInt32BE(28))
      throw new Error('Offline WAL header checksum');
    const pages = new Map<number, Buffer>();
    let committedPages = 0;
    let lastCommit = 32;
    for (let offset = 32; offset < wal.length; offset += size + 24) {
      const page = wal.readUInt32BE(offset);
      const end = wal.readUInt32BE(offset + 4);
      if (
        !page ||
        page * size > OFFLINE_JOURNAL_BYTES ||
        end * size > OFFLINE_JOURNAL_BYTES ||
        !wal.subarray(offset + 8, offset + 16).equals(wal.subarray(16, 24))
      )
        throw new Error('Offline WAL frame binding');
      checksum(wal.subarray(offset, offset + 8));
      checksum(wal.subarray(offset + 24, offset + 24 + size));
      if (first !== wal.readUInt32BE(offset + 16) || second !== wal.readUInt32BE(offset + 20))
        throw new Error('Offline WAL frame checksum');
      pages.set(page, wal.subarray(offset + 24, offset + 24 + size));
      if (end) {
        committedPages = end;
        lastCommit = offset + size + 24;
      }
    }
    // A header-only WAL is valid; any uncommitted frame/tail is uncertain.
    if (lastCommit !== wal.length) throw new Error('Uncommitted offline WAL tail');
    if (committedPages) {
      result = Buffer.alloc(committedPages * size);
      base.copy(result, 0, 0, result.length);
      for (const [page, bytes] of pages)
        if (page <= committedPages) bytes.copy(result, (page - 1) * size);
    }
  }
  // Only the derived image changes to rollback mode; original bytes are preserved.
  result[18] = 1;
  result[19] = 1;
  return result;
}

/** Caller supplies its private, bounded, immutable derived copy, never a live journal. */
function inspectTerminalImage(file: string, allowDispatched: boolean) {
  if (/[%?#\n]/.test(file)) throw new Error('Unsupported offline image path');
  const db = new DatabaseSync(`file:${file}?immutable=1`, {
    readOnly: true,
    enableDoubleQuotedStringLiterals: false,
    allowExtension: false,
  });
  try {
    db.exec('PRAGMA trusted_schema=OFF; PRAGMA query_only=ON');
    if (db.prepare('PRAGMA integrity_check').get()?.integrity_check !== 'ok')
      throw new Error('Corrupt offline journal');
    const schema = db.prepare('SELECT * FROM terminal_schema').all();
    const owners = db.prepare('SELECT * FROM terminal_owner').all();
    if (
      schema.length !== 1 ||
      schema[0]?.singleton !== 1 ||
      schema[0]?.version !== 2 ||
      owners.length !== 1 ||
      owners[0]?.singleton !== 1 ||
      typeof owners[0]?.epoch !== 'string'
    )
      throw new Error('Unsupported offline journal owner/schema');
    terminalAttemptSchema.shape.epoch.parse(owners[0]!.epoch);
    const definitionSQL =
      "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name GLOB 'terminal_*' OR tbl_name GLOB 'terminal_*' ORDER BY type,name";
    const definitions = db.prepare(definitionSQL).all();
    const reference = new DatabaseSync(':memory:');
    try {
      reference.exec(terminalJournalMigration);
      if (JSON.stringify(definitions) !== JSON.stringify(reference.prepare(definitionSQL).all()))
        throw new Error('Unsupported offline journal definition');
    } finally {
      reference.close();
    }
    const rows = db
      .prepare(
        `SELECT * FROM terminal_attempts ORDER BY instance_id LIMIT ${TERMINAL_JOURNAL_LIMITS.attempts + 1}`,
      )
      .all();
    if (rows.length > TERMINAL_JOURNAL_LIMITS.attempts) throw new Error('Offline attempt budget');
    const attempts = rows.map((row) => {
      if (typeof row.metadata !== 'string' || row.metadata.length > 2048)
        throw new Error('Invalid offline attempt metadata');
      const attempt = terminalAttemptSchema.parse(JSON.parse(row.metadata));
      if (
        attempt.instanceId !== row.instance_id ||
        attempt.epoch !== row.epoch ||
        attempt.projectId !== row.project_id ||
        attempt.state !== row.state ||
        attempt.updatedAt !== row.updated_at ||
        attempt.epoch !== owners[0]!.epoch ||
        (!allowDispatched && (attempt.state !== 'prepared' || attempt.exit !== undefined))
      )
        throw new Error('Offline non-dispatch proof denied');
      return attempt;
    });
    return { schemaVersion: 2, epoch: String(owners[0]!.epoch), definitions, attempts };
  } finally {
    db.close();
  }
}

/** Original offline policy: only a prepared, never-dispatched image is admissible. */
export function inspectOfflineTerminalImage(file: string) {
  return inspectTerminalImage(file, false);
}

/** Kernel recovery reads all valid lifecycle states without rewriting them or inferring exit. */
export function inspectKernelTerminalImage(file: string) {
  return inspectTerminalImage(file, true);
}
