import {
  constants,
  closeSync,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { eventSchema, accountLimitsSchema } from '@orqst/protocol';
import { z } from 'zod';

const MAX_LINE = 2 * 1024 * 1024;
const MAX_CANDIDATES = 256;
const MAX_TOTAL_BYTES = 8 * 1024 * 1024;
const recordSchema = z.object({
  timestamp: z.iso.datetime({ offset: true }),
  type: z.literal('event_msg'),
  payload: z.object({
    type: z.literal('token_count'),
    rate_limits: z.object({
      plan_type: z.string().optional().nullable(),
      limit_id: z.string().optional().nullable(),
      normal_model_slug: z.string().optional().nullable(),
      primary: z.unknown().optional().nullable(),
      secondary: z.unknown().optional().nullable(),
    }),
  }),
});
const windowSchema = z.object({
  used_percent: z.number().finite().min(0).max(100).optional(),
  window_minutes: z.number().int().positive().max(10000000),
  resets_at: z.number().int().nonnegative().safe().optional().nullable(),
  resets_in_seconds: z.number().int().nonnegative().safe().optional().nullable(),
});
const milliseconds = (value: number) =>
  Number.isSafeInteger(value) && value >= 0 ? value : undefined;

/** Project only the fixed fields needed for the panel from an authenticated source record. */
export function parseCodexRateLimitRecord(raw: unknown, observedAt: number) {
  const parsed = recordSchema.safeParse(raw);
  if (!parsed.success) return undefined;
  const bucket = parsed.data.payload.rate_limits.limit_id;
  if (
    (bucket != null && bucket !== 'codex') ||
    parsed.data.payload.rate_limits.normal_model_slug != null
  )
    return undefined;
  const updatedAt = Date.parse(parsed.data.timestamp);
  if (!Number.isSafeInteger(updatedAt) || updatedAt < 0 || updatedAt > observedAt) return undefined;
  const windows = (['primary', 'secondary'] as const).flatMap((slot) => {
    const value = windowSchema.safeParse(parsed.data.payload.rate_limits[slot]);
    if (
      !value.success ||
      (value.data.used_percent === undefined &&
        value.data.resets_at == null &&
        value.data.resets_in_seconds == null)
    )
      return [];
    const minutes = value.data.window_minutes;
    const label =
      minutes % 1440 === 0
        ? `${minutes / 1440}d`
        : minutes % 60 === 0
          ? `${minutes / 60}h`
          : `${minutes}m`;
    const resetsAt =
      value.data.resets_at != null
        ? milliseconds(value.data.resets_at * 1000)
        : value.data.resets_in_seconds != null
          ? milliseconds(updatedAt + value.data.resets_in_seconds * 1000)
          : undefined;
    return [
      {
        id: `window-${minutes}m`,
        label,
        ...(value.data.used_percent === undefined ? {} : { usedPercent: value.data.used_percent }),
        ...(resetsAt === undefined ? {} : { resetsAt }),
      },
    ];
  });
  if (!windows.length || new Set(windows.map((window) => window.id)).size !== windows.length)
    return undefined;
  const plan = parsed.data.payload.rate_limits.plan_type;
  return {
    updatedAt,
    windows,
    ...(typeof plan === 'string' && /^[a-zA-Z0-9 _.-]{1,16}$/.test(plan) ? { plan } : {}),
  };
}

function checkedFile(file: string) {
  const before = lstatSync(file);
  if (!before.isFile() || before.isSymbolicLink()) throw new Error('Unsafe source file');
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const after = fstatSync(fd);
    if (!after.isFile() || before.ino !== after.ino || before.dev !== after.dev)
      throw new Error('Changed source file');
    return { fd, stat: after };
  } catch (error) {
    closeSync(fd);
    throw error;
  }
}

/**
 * Read only source records already indexed by the existing observer. Source path,
 * byte offset and SHA-256 must all still match; files/checkpoints are never changed.
 */
export function readObservedCodexLimits(
  observerDatabase: string,
  sessionsRoot: string,
  observedAt: number,
) {
  const root = realpathSync(sessionsRoot);
  const dbFile = resolve(observerDatabase);
  if (realpathSync(dbFile) !== dbFile) throw new Error('Unsafe observer database');
  for (const name of [dbFile, `${dbFile}-wal`, `${dbFile}-shm`]) {
    try {
      const info = lstatSync(name);
      if (
        !info.isFile() ||
        info.isSymbolicLink() ||
        info.uid !== process.getuid?.() ||
        (info.mode & 0o077) !== 0
      )
        throw new Error('Unsafe observer database file');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || name === dbFile) throw error;
    }
  }
  const identity = checkedFile(dbFile);
  closeSync(identity.fd);
  const db = new DatabaseSync(dbFile, { readOnly: true });
  try {
    db.exec('PRAGMA query_only=ON');
    const after = lstatSync(dbFile);
    if (after.ino !== identity.stat.ino || after.dev !== identity.stat.dev)
      throw new Error('Changed observer database');
    const rows = db
      .prepare(
        `SELECT envelope FROM events WHERE type='agent.tokens.updated'
      AND length(envelope)<=65536 ORDER BY timestamp DESC, sequence DESC LIMIT ?`,
      )
      .all(MAX_CANDIDATES);
    let remaining = MAX_TOTAL_BYTES;
    let latest: ReturnType<typeof parseCodexRateLimitRecord>;
    for (const row of rows) {
      if (remaining <= 0) return undefined;
      const parsed = eventSchema.safeParse(JSON.parse(String(row.envelope)));
      if (
        !parsed.success ||
        parsed.data.adapter !== 'codex' ||
        parsed.data.source.recordType !== 'event_msg:token_count'
      )
        continue;
      const event = parsed.data;
      if (latest && Date.parse(event.timestamp) < latest.updatedAt) return latest;
      const source = event.source;
      if (
        !Number.isSafeInteger(source.offset) ||
        !/^[a-f0-9]{64}$/.test(source.hash) ||
        !source.file.endsWith('.jsonl') ||
        isAbsolute(source.file) ||
        source.file.split('/').some((part) => !part || part === '.' || part === '..')
      )
        continue;
      const file = resolve(root, source.file);
      const rel = relative(root, file);
      if (!rel || rel.startsWith('..' + sep) || isAbsolute(rel)) continue;
      try {
        const canonical = realpathSync(file);
        if (!canonical.startsWith(root + sep) || canonical !== file) continue;
        const opened = checkedFile(file);
        try {
          if (source.offset >= opened.stat.size) continue;
          const bytes = Buffer.alloc(
            Math.min(MAX_LINE + 1, opened.stat.size - source.offset, remaining),
          );
          let length = 0;
          while (length < bytes.length) {
            const n = readSync(
              opened.fd,
              bytes,
              length,
              Math.min(16 * 1024, bytes.length - length),
              source.offset + length,
            );
            if (!n) break;
            length += n;
            remaining -= n;
            if (bytes.subarray(0, length).includes(10)) break;
          }
          const end = bytes.subarray(0, length).indexOf(10);
          if (end < 0 || end > MAX_LINE) continue;
          const line = bytes.subarray(0, end);
          const current = lstatSync(file);
          if (
            createHash('sha256').update(line).digest('hex') !== source.hash ||
            realpathSync(file) !== canonical ||
            !current.isFile() ||
            current.ino !== opened.stat.ino ||
            current.dev !== opened.stat.dev
          )
            continue;
          const raw: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(line));
          const result = parseCodexRateLimitRecord(raw, observedAt);
          if (
            result &&
            new Date(result.updatedAt).toISOString() === new Date(event.timestamp).toISOString()
          ) {
            if (latest && JSON.stringify(latest) !== JSON.stringify(result)) return undefined;
            latest = result;
          }
        } finally {
          closeSync(opened.fd);
        }
      } catch {
        /* Missing, replaced, malformed or inaccessible evidence is never adopted. */
      }
    }
    if (latest && rows.length === MAX_CANDIDATES) {
      const last = eventSchema.safeParse(JSON.parse(String(rows.at(-1)?.envelope)));
      if (!last.success || Date.parse(last.data.timestamp) >= latest.updatedAt) return undefined;
    }
    return latest;
  } finally {
    db.close();
  }
}

export function defaultCodexAccountLimits(
  readAt: number,
  locked: boolean,
  result: ReturnType<typeof readObservedCodexLimits>,
) {
  return accountLimitsSchema.parse({
    readAt,
    accounts: result
      ? [{ id: 'codex-default', provider: 'codex', index: 1, locked, ...result }]
      : [],
  });
}
