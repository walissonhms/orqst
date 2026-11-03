import type { DatabaseSync } from 'node:sqlite';
import {
  compactMetricMetadataSchema,
  sessionModelHistoryLimits as limits,
  sessionModelHistoryResultSchema,
  type SessionModelHistoryResult,
} from '@orqst/protocol';

type Reason = Extract<SessionModelHistoryResult, { availability: 'unavailable' }>['reason'];
const unavailable = (reason: Reason): SessionModelHistoryResult => ({
  availability: 'unavailable',
  reason,
});

/** Latest compact records, not model changes or original declaration times. Never opens sources. */
export function readSessionModelHistory(
  db: DatabaseSync,
  sessionId: string,
): SessionModelHistoryResult {
  const ownTransaction = !db.isTransaction;
  try {
    if (ownTransaction) db.exec('BEGIN');
    if (
      db.prepare('PRAGMA user_version').get()?.user_version !== 2 ||
      !db
        .prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='analytics_evidence'")
        .get()
    )
      return unavailable('unsupported_schema');
    const canonical = db
      .prepare(
        `SELECT s.id,s.agent_id,a.machine_id,a.adapter FROM sessions s
         JOIN agents a ON a.id=s.agent_id WHERE s.id=?`,
      )
      .get(sessionId);
    if (!canonical) return unavailable('session_not_found');
    if (canonical.adapter !== 'codex') return unavailable('unsupported_adapter');
    const window = db
      .prepare(
        `SELECT sequence,length(CAST(metadata AS BLOB)) AS bytes FROM analytics_evidence
         WHERE session_id=? ORDER BY sequence DESC LIMIT ?`,
      )
      .all(sessionId, limits.records);
    if (!window.length) return unavailable('evidence_missing');
    let bytes = 0;
    for (const row of window) {
      const size = Number(row.bytes);
      bytes += size;
      if (
        !Number.isSafeInteger(row.sequence) ||
        Number(row.sequence) <= 0 ||
        !Number.isSafeInteger(size) ||
        size <= 0 ||
        size > limits.recordBytes ||
        bytes > limits.evidenceBytes
      )
        return unavailable('evidence_limit');
    }
    const entries = [];
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
        !Number.isSafeInteger(event.source.line) ||
        !Number.isSafeInteger(event.source.offset)
      )
        return unavailable('invalid_evidence');
      if (
        event.sessionId !== canonical.id ||
        event.machineId !== canonical.machine_id ||
        event.agentId !== canonical.agent_id ||
        event.adapter !== canonical.adapter
      )
        return unavailable('identity_conflict');
      entries.push({
        sequence: row.sequence,
        normalizedEventAt: event.timestamp,
        model: event.payload.model,
        source: { hash: event.source.hash, recordType: event.source.recordType },
      });
    }
    const result = sessionModelHistoryResultSchema.safeParse({
      availability: 'available',
      value: {
        contract: 'orqst.session-model-history',
        contractVersion: 1,
        sessionId,
        adapter: 'codex',
        coverage: 'partial',
        basis: 'normalized_event_carried_identifier',
        sourceVerification: 'not_rechecked',
        entries,
      },
    });
    if (!result.success) return unavailable('invalid_evidence');
    if (Buffer.byteLength(JSON.stringify(result.data), 'utf8') > limits.responseBytes)
      return unavailable('evidence_limit');
    return result.data;
  } catch {
    // Do not expose SQLite, schema, JSON diagnostics or captured metadata.
    return unavailable('invalid_evidence');
  } finally {
    if (ownTransaction && db.isTransaction) db.exec('ROLLBACK');
  }
}
