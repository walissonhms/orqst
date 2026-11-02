import type { DatabaseSync } from 'node:sqlite';
import {
  compactMetricMetadataSchema,
  confirmedUsageSchema,
  sessionMetricsResultSchema,
  type SessionMetricsResult,
} from '@orqst/protocol';

export const SESSION_METRICS_LIMITS = Object.freeze({
  records: 256,
  recordBytes: 16 * 1024,
  evidenceBytes: 256 * 1024,
  responseBytes: 16 * 1024,
});
const unavailable = (
  reason: Extract<SessionMetricsResult, { availability: 'unavailable' }>['reason'],
): SessionMetricsResult => ({ availability: 'unavailable', reason });

/** Synchronous bounded read on the existing connection. No write lock, source access or replay. */
export function readSessionMetrics(db: DatabaseSync, sessionId: string): SessionMetricsResult {
  const ownTransaction = !db.isTransaction;
  if (ownTransaction) db.exec('BEGIN');
  try {
    const canonical = db
      .prepare(
        `SELECT s.id,s.agent_id,a.machine_id,a.adapter,
         t.input,t.output,t.cached,t.total,t.timestamp,t.source_priority
         FROM sessions s JOIN agents a ON a.id=s.agent_id
         LEFT JOIN token_usage t ON t.session_id=s.id WHERE s.id=?`,
      )
      .get(sessionId);
    if (!canonical) return unavailable('session_not_found');
    if (canonical.adapter !== 'codex') return unavailable('unsupported_adapter');
    if (canonical.timestamp === null) return unavailable('usage_not_recorded');
    const usage = confirmedUsageSchema.safeParse({
      input: canonical.input,
      output: canonical.output,
      cached: canonical.cached,
      total: canonical.total,
    });
    if (!usage.success) return unavailable('invalid_evidence');

    // Read sizes only through the session/sequence index. No metadata crosses into JS
    // until the entire bounded window passes admission; no full-history JSON predicates.
    const window = db
      .prepare(
        `SELECT sequence,length(CAST(metadata AS BLOB)) AS bytes FROM analytics_evidence
         WHERE session_id=? ORDER BY sequence DESC LIMIT ?`,
      )
      .all(sessionId, SESSION_METRICS_LIMITS.records);
    let bytes = 0;
    for (const row of window) {
      const size = Number(row.bytes);
      bytes += size;
      if (
        !Number.isSafeInteger(size) ||
        size < 0 ||
        size > SESSION_METRICS_LIMITS.recordBytes ||
        bytes > SESSION_METRICS_LIMITS.evidenceBytes
      )
        return unavailable('evidence_limit');
    }
    const record = db.prepare(
      'SELECT sequence,id,session_id,timestamp,metadata FROM analytics_evidence WHERE sequence=?',
    );
    for (const admitted of window) {
      const row = record.get(admitted.sequence!);
      if (!row || typeof row.metadata !== 'string') return unavailable('invalid_evidence');
      const parsed = compactMetricMetadataSchema.safeParse(JSON.parse(row.metadata) as unknown);
      if (!parsed.success) return unavailable('invalid_evidence');
      const event = parsed.data;
      if (
        row.id !== event.id ||
        row.session_id !== event.sessionId ||
        row.session_id !== sessionId ||
        row.timestamp !== event.timestamp ||
        row.sequence !== admitted.sequence ||
        !Number.isSafeInteger(row.sequence) ||
        Number(row.sequence) <= 0
      )
        return unavailable('invalid_evidence');
      const priority = event.source.recordType === 'token_usage_record' ? 2 : 1;
      if (
        event.payload.usageKind !== 'session_cumulative' ||
        !event.payload.usage ||
        event.timestamp !== canonical.timestamp ||
        priority !== canonical.source_priority ||
        Object.entries(usage.data).some(
          ([key, value]) => event.payload.usage?.[key as keyof typeof usage.data] !== value,
        )
      )
        continue;
      // This is the newest matching candidate, including ties accepted by Store.
      // Never fall back to an older identity when a later conflicting record won.
      if (
        event.machineId !== canonical.machine_id ||
        event.agentId !== canonical.agent_id ||
        event.adapter !== canonical.adapter ||
        event.sessionId !== canonical.id
      )
        return unavailable('identity_conflict');
      if (!['token_usage_record', 'event_msg:token_count'].includes(event.source.recordType))
        return unavailable('invalid_evidence');
      const result = sessionMetricsResultSchema.safeParse({
        availability: 'available',
        value: {
          contract: 'orqst.live-metrics',
          contractVersion: 1,
          identity: {
            sessionRef: {
              machineId: event.machineId,
              adapterId: event.adapter,
              nativeSessionId: event.sessionId,
            },
            agentId: event.agentId,
            sourceWorkspaceId: event.workspaceId,
          },
          usage: usage.data,
          usageKind: 'session_cumulative',
          normalization: 'codex_session_snapshot',
          fieldPresence: 'not_preserved',
          evidence: {
            kind: 'compact_evidence',
            eventId: event.id,
            sequence: row.sequence,
            occurredAt: event.timestamp,
            observedAt: { availability: 'unavailable', reason: 'not_recorded' },
            sourceVerification: 'not_rechecked',
            source: event.source,
            turnId: event.correlation.turnId,
            responseId: event.payload.responseId,
          },
        },
      });
      if (!result.success) return unavailable('invalid_evidence');
      if (Buffer.byteLength(JSON.stringify(result.data)) > SESSION_METRICS_LIMITS.responseBytes)
        return unavailable('evidence_limit');
      return result.data;
    }
    return unavailable(
      window.length === SESSION_METRICS_LIMITS.records ? 'evidence_limit' : 'evidence_missing',
    );
  } catch {
    // SQLite/JSON errors may contain local paths or captured metadata.
    return unavailable('invalid_evidence');
  } finally {
    if (ownTransaction) db.exec('ROLLBACK');
  }
}
