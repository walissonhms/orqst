// SYNTHETIC concurrent SQLite writer; tests the journal uniqueness constraints only.
import { DatabaseSync } from 'node:sqlite';
import type { CrossFeatureAudit, CrossFeatureMessage } from '@orqst/protocol';
const db = new DatabaseSync(process.argv[2]!);
db.exec('PRAGMA busy_timeout=5000');
process.send?.({ type: 'ready' });
process.once('message', (raw) => {
  const { message, audit } = raw as {
    message: CrossFeatureMessage;
    audit: Omit<CrossFeatureAudit, 'sequence'>;
  };
  try {
    db.exec('BEGIN IMMEDIATE');
    const g = message.grant,
      r = message.request;
    db.prepare('INSERT INTO cross_feature_messages VALUES (?,?,?,?,?,?,?,?,?)').run(
      r.messageId,
      r.taskId,
      g.workspaceId,
      g.target.paneId,
      r.idempotencyKey,
      g.grantId,
      g.intentId,
      g.nonce,
      JSON.stringify(message),
    );
    db.prepare('INSERT INTO cross_feature_usage VALUES (?,?,?,?,?)').run(
      r.messageId,
      g.actorId,
      g.target.paneId,
      message.state,
      message.createdAt,
    );
    const n = Number(
      db.prepare('SELECT COALESCE(MAX(sequence),0)+1 AS n FROM cross_feature_audit').get()?.n,
    );
    db.prepare('INSERT INTO cross_feature_audit VALUES (?,?)').run(n, JSON.stringify(audit));
    db.exec('COMMIT');
    process.send?.({ type: 'result', admitted: true }, () => {
      db.close();
      process.exit(0);
    });
  } catch {
    if (db.isTransaction) db.exec('ROLLBACK');
    process.send?.({ type: 'result', admitted: false }, () => {
      db.close();
      process.exit(0);
    });
  }
});
