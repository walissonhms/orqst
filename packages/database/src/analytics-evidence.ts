/** Shared SQL allowlist for durable evidence and read-only legacy projection. */
export const analyticsMetadataSql = `json_object(
  'id',json_extract(envelope,'$.id'),
  'timestamp',json_extract(envelope,'$.timestamp'),
  'machineId',json_extract(envelope,'$.machineId'),
  'agentId',json_extract(envelope,'$.agentId'),
  'adapter',json_extract(envelope,'$.adapter'),
  'sessionId',json_extract(envelope,'$.sessionId'),
  'workspaceId',json_extract(envelope,'$.workspaceId'),
  'source',json_object(
    'file',json_extract(envelope,'$.source.file'),
    'offset',json_extract(envelope,'$.source.offset'),
    'line',json_extract(envelope,'$.source.line'),
    'hash',json_extract(envelope,'$.source.hash'),
    'recordType',json_extract(envelope,'$.source.recordType')),
  'correlation',json_object('turnId',json_extract(envelope,'$.correlation.turnId')),
  'payload',json_object(
    'model',json_extract(envelope,'$.payload.model'),
    'usage',CASE WHEN json_type(envelope,'$.payload.usage')='object' THEN json_object(
      'input',json_extract(envelope,'$.payload.usage.input'),
      'output',json_extract(envelope,'$.payload.usage.output'),
      'cached',json_extract(envelope,'$.payload.usage.cached'),
      'total',json_extract(envelope,'$.payload.usage.total')) ELSE NULL END,
    'usageKind',json_extract(envelope,'$.payload.usageKind'),
    'responseId',json_extract(envelope,'$.payload.responseId'))
)`;
const metricPredicate = `(json_type(envelope,'$.payload.model') IS NOT NULL OR
  json_type(envelope,'$.payload.usage') IS NOT NULL)`;

export const analyticsEvidenceMigration = `
CREATE TABLE analytics_evidence (
 sequence INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE,
 session_id TEXT NOT NULL REFERENCES sessions(id), timestamp TEXT NOT NULL,
 metadata TEXT NOT NULL
);
CREATE INDEX analytics_evidence_session_sequence ON analytics_evidence(session_id,sequence);
CREATE INDEX analytics_evidence_timestamp ON analytics_evidence(timestamp);
INSERT INTO analytics_evidence(sequence,id,session_id,timestamp,metadata)
 SELECT sequence,id,session_id,timestamp,${analyticsMetadataSql} FROM events
 WHERE ${metricPredicate};
`;

/** Read each record once; retained envelopes still consume the original admission budget. */
export function analyticsEvidenceQueries(durable: boolean) {
  return {
    budget: durable
      ? `SELECT bytes FROM (
          SELECT sequence,length(CAST(envelope AS BLOB)) AS bytes FROM events WHERE session_id=?1
          UNION ALL
          SELECT sequence,length(CAST(metadata AS BLOB)) AS bytes FROM analytics_evidence c
          WHERE session_id=?1 AND NOT EXISTS (SELECT 1 FROM events e WHERE e.id=c.id)
        ) ORDER BY sequence LIMIT ?2`
      : `SELECT length(CAST(envelope AS BLOB)) AS bytes FROM events
         WHERE session_id=?1 ORDER BY sequence LIMIT ?2`,
    projection: durable
      ? `SELECT sequence,metadata FROM analytics_evidence WHERE session_id=?1
         UNION ALL
         SELECT sequence,${analyticsMetadataSql} AS metadata FROM events e
         WHERE session_id=?1 AND NOT EXISTS (SELECT 1 FROM analytics_evidence c WHERE c.id=e.id)
         AND ${metricPredicate} ORDER BY sequence`
      : `SELECT sequence,${analyticsMetadataSql} AS metadata FROM events
         WHERE session_id=?1 AND ${metricPredicate} ORDER BY sequence`,
  };
}
