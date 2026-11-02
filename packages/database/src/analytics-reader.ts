import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { lstatSync, realpathSync } from 'node:fs';
import {
  modelAnalyticsQuerySchema,
  type ModelAnalyticsQuery,
  type ModelAnalyticsSummary,
} from '@orqst/protocol';
import {
  aggregateModelAnalyticsSummary,
  type AnalyticsSession,
  type AnalyticsEvent,
} from './analytics.js';

/** Limits cover all retained selected history, before model/window attribution. */
export const ANALYTICS_READ_LIMITS = Object.freeze({
  sessions: 5000,
  events: 250000,
  evidenceBytes: 256 * 1024 * 1024,
  recordBytes: 8 * 1024 * 1024,
  projectionBytes: 64 * 1024 * 1024,
  summaryBytes: 2 * 1024 * 1024,
});
export class AnalyticsReadCapacityError extends Error {}

/** A separate read-only connection: never construct Store, migrate, or reserve a write lock. */
export function readModelAnalyticsSummary(
  file: string,
  input: ModelAnalyticsQuery = {},
  limits: Readonly<typeof ANALYTICS_READ_LIMITS> = ANALYTICS_READ_LIMITS,
): ModelAnalyticsSummary {
  const query = modelAnalyticsQuerySchema.parse(input);
  if (lstatSync(file).isSymbolicLink() || realpathSync(file) !== file)
    throw new Error('Analytics database path must be canonical');
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=100; BEGIN');
    if (db.prepare('PRAGMA user_version').get()?.user_version !== 1)
      throw new Error('Unsupported Analytics database schema');
    if (db.prepare('PRAGMA journal_mode').get()?.journal_mode !== 'wal')
      throw new Error('Analytics requires WAL');
    const conditions: string[] = [];
    const params: SQLInputValue[] = [];
    for (const [column, value] of [
      ['s.workspace_id', query.workspaceId],
      ['s.agent_id', query.agentId],
      ['a.adapter', query.adapter],
    ] as const) {
      if (value !== undefined) {
        conditions.push(`${column}=?`);
        params.push(value);
      }
    }
    if (query.from || query.to) {
      const window = (column: string) => {
        const clauses: string[] = [];
        if (query.from) {
          clauses.push(`julianday(${column})>=julianday(?)`);
          params.push(query.from);
        }
        if (query.to) {
          clauses.push(`julianday(${column})<julianday(?)`);
          params.push(query.to);
        }
        return clauses.join(' AND ');
      };
      conditions.push(
        `(EXISTS (SELECT 1 FROM events e WHERE e.session_id=s.id AND ${window('e.timestamp')}) OR (${window('t.timestamp')}))`,
      );
    }
    const rows = db
      .prepare(
        `SELECT s.id,s.workspace_id,s.agent_id,a.machine_id,a.adapter,t.input,t.output,t.cached,t.total,t.timestamp,t.source_priority
       FROM sessions s JOIN agents a ON a.id=s.agent_id LEFT JOIN token_usage t ON t.session_id=s.id
       ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''} ORDER BY s.id LIMIT ?`,
      )
      .all(...params, limits.sessions + 1);
    if (rows.length > limits.sessions) throw new AnalyticsReadCapacityError();
    let events = 0;
    let bytes = 0;
    const budget = db.prepare(
      `SELECT length(CAST(envelope AS BLOB)) AS bytes FROM events
       WHERE session_id=? ORDER BY sequence LIMIT ?`,
    );
    // No JSON parsing before every selected session passes admission. Message-only
    // records and out-of-period baselines consume the same scan budget.
    for (const row of rows) {
      for (const record of budget.iterate(String(row.id), limits.events - events + 1)) {
        events++;
        const size = Number(record.bytes);
        bytes += size;
        if (events > limits.events || bytes > limits.evidenceBytes || size > limits.recordBytes)
          throw new AnalyticsReadCapacityError();
      }
    }
    // SQLite inspects bounded envelopes, but never transfers messages, tool arguments,
    // results or cwd to JavaScript. Provenance remains worker-local and is stripped
    // by the summary projection before crossing the worker boundary.
    const projection = db.prepare(
      `SELECT sequence,json_object(
         'id',json_extract(envelope,'$.id'),
         'timestamp',json_extract(envelope,'$.timestamp'),
         'machineId',json_extract(envelope,'$.machineId'),
         'agentId',json_extract(envelope,'$.agentId'),
         'adapter',json_extract(envelope,'$.adapter'),
         'source',json_extract(envelope,'$.source'),
         'correlation',json_object('turnId',json_extract(envelope,'$.correlation.turnId')),
         'payload',json_object(
           'model',json_extract(envelope,'$.payload.model'),
           'usage',json_extract(envelope,'$.payload.usage'),
           'usageKind',json_extract(envelope,'$.payload.usageKind'),
           'responseId',json_extract(envelope,'$.payload.responseId'))
       ) AS metadata FROM events WHERE session_id=? AND
       (json_type(envelope,'$.payload.model') IS NOT NULL OR json_type(envelope,'$.payload.usage') IS NOT NULL)
       ORDER BY sequence`,
    );
    let projectedBytes = 0;
    function* sessions(): Generator<AnalyticsSession> {
      for (const row of rows) {
        const retained: AnalyticsEvent[] = [];
        for (const record of projection.iterate(String(row.id))) {
          const metadata = String(record.metadata);
          projectedBytes += Buffer.byteLength(metadata);
          if (projectedBytes > limits.projectionBytes) throw new AnalyticsReadCapacityError();
          retained.push({
            ...JSON.parse(metadata),
            sequence: Number(record.sequence),
          } as AnalyticsEvent);
        }
        yield {
          id: String(row.id),
          machineId: String(row.machine_id),
          workspaceId: String(row.workspace_id),
          agentId: String(row.agent_id),
          adapter: row.adapter as AnalyticsSession['adapter'],
          canonical:
            row.timestamp === null
              ? null
              : {
                  usage: {
                    input: Number(row.input),
                    output: Number(row.output),
                    cached: Number(row.cached),
                    total: Number(row.total),
                  },
                  timestamp: String(row.timestamp),
                  priority: Number(row.source_priority),
                },
          events: retained,
        };
      }
    }
    const report = aggregateModelAnalyticsSummary(sessions(), query);
    // Bound structured clone and JSON serialization on the observer thread as well.
    if (Buffer.byteLength(JSON.stringify(report)) > limits.summaryBytes)
      throw new AnalyticsReadCapacityError();
    return report;
  } finally {
    // close rolls back the read transaction and releases its bounded WAL snapshot.
    db.close();
  }
}
