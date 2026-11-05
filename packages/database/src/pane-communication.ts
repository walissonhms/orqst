import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import {
  crossFeatureMessageSchema,
  crossFeatureAuditSchema,
  communicationAuditSchema,
  communicationLimits,
  communicationMessageSchema,
  communicationPaneSchema,
  paneSendSchema,
  type CommunicationJournal,
  type CommunicationTransaction,
} from '@orqst/protocol';

const migration = `
CREATE TABLE communication_schema (singleton INTEGER PRIMARY KEY CHECK(singleton=1), version INTEGER NOT NULL);
INSERT INTO communication_schema VALUES (1,1);
CREATE TABLE communication_owner (singleton INTEGER PRIMARY KEY CHECK(singleton=1), epoch TEXT NOT NULL);
CREATE TABLE communication_panes (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, display_id TEXT NOT NULL, metadata TEXT NOT NULL CHECK(json_valid(metadata)),
 UNIQUE(workspace_id,display_id)
);
CREATE TABLE communication_messages (
 id TEXT PRIMARY KEY, task_id TEXT NOT NULL UNIQUE, workspace_id TEXT NOT NULL,
 target_id TEXT NOT NULL REFERENCES communication_panes(id), idempotency_key TEXT NOT NULL,
 metadata TEXT NOT NULL CHECK(json_valid(metadata)), UNIQUE(workspace_id,target_id,idempotency_key)
);
CREATE TABLE communication_audit (
 sequence INTEGER PRIMARY KEY AUTOINCREMENT, metadata TEXT NOT NULL CHECK(json_valid(metadata))
);
`;

/** Opt-in schema on the existing Store writer; never opens a second database or source file. */
export function openCommunicationJournal(
  db: DatabaseSync,
  transaction: <T>(action: () => T) => T,
  epoch: string,
  recover: boolean,
  now: () => number = Date.now,
): CommunicationJournal {
  z.uuid().parse(epoch);
  z.boolean().parse(recover);
  if (db.isTransaction) throw new Error('Communication requires an independent commit');
  db.exec('PRAGMA synchronous=FULL');
  const crossExists = () =>
    Boolean(
      db
        .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='cross_feature_messages'")
        .get(),
    );
  const tx: CommunicationTransaction = {
    crossMessages: () =>
      crossExists()
        ? db
            .prepare('SELECT metadata FROM cross_feature_messages ORDER BY rowid')
            .all()
            .map((row) => crossFeatureMessageSchema.parse(JSON.parse(String(row.metadata))))
        : [],
    crossEvents: () =>
      crossExists()
        ? db
            .prepare('SELECT sequence, metadata FROM cross_feature_audit ORDER BY sequence')
            .all()
            .map((row) =>
              crossFeatureAuditSchema.parse({
                ...JSON.parse(String(row.metadata)),
                sequence: row.sequence,
              }),
            )
        : [],
    insertCross: (input, event) => {
      const message = crossFeatureMessageSchema.parse(input);
      if (message.state !== 'queued') throw new Error('Invalid cross-Feature admission');
      const g = message.grant;
      db.prepare(
        `INSERT INTO cross_feature_messages
        (message_id, task_id, workspace_id, target_id, idempotency_key, grant_id, intent_id, nonce, metadata)
        VALUES (?,?,?,?,?,?,?,?,?)`,
      ).run(
        message.request.messageId,
        message.request.taskId,
        g.workspaceId,
        g.target.paneId,
        message.request.idempotencyKey,
        g.grantId,
        g.intentId,
        g.nonce,
        JSON.stringify(message),
      );
      crossAudit(message, event, 'admitted');
    },
    updateCross: (input, event) => {
      const message = crossFeatureMessageSchema.parse(input);
      const old = tx.crossMessages().find((m) => m.request.messageId === message.request.messageId);
      if (
        !old ||
        old.state !== 'queued' ||
        message.state !== 'dispatching' ||
        JSON.stringify(old.grant) !== JSON.stringify(message.grant) ||
        JSON.stringify(old.request) !== JSON.stringify(message.request) ||
        old.createdAt !== message.createdAt
      )
        throw new Error('Invalid cross-Feature transition');
      db.prepare('UPDATE cross_feature_messages SET metadata=? WHERE message_id=?').run(
        JSON.stringify(message),
        message.request.messageId,
      );
      crossAudit(message, event, 'dispatch_claimed');
    },
    panes: () =>
      db
        .prepare('SELECT metadata FROM communication_panes ORDER BY rowid')
        .all()
        .map((row) => communicationPaneSchema.parse(JSON.parse(String(row.metadata)))),
    messages: () =>
      db
        .prepare('SELECT metadata FROM communication_messages ORDER BY rowid')
        .all()
        .map((row) => communicationMessageSchema.parse(JSON.parse(String(row.metadata)))),
    savePane: (input) => {
      const pane = communicationPaneSchema.parse(input);
      if (
        pane.routing &&
        tx
          .panes()
          .some(
            (p) =>
              p.paneId !== pane.paneId &&
              p.workspaceId === pane.workspaceId &&
              p.featureId === pane.featureId &&
              p.routing?.handle === pane.routing?.handle,
          )
      )
        throw new Error('Mention handle already registered');
      const previous = db
        .prepare('SELECT metadata FROM communication_panes WHERE id=?')
        .get(pane.paneId);
      if (previous) {
        const old = communicationPaneSchema.parse(JSON.parse(String(previous.metadata)));
        if (
          old.workspaceId !== pane.workspaceId ||
          old.featureId !== pane.featureId ||
          old.terminalId !== pane.terminalId ||
          old.displayId !== pane.displayId ||
          old.createdAt !== pane.createdAt ||
          JSON.stringify(old.binding) !== JSON.stringify(pane.binding)
        )
          throw new Error('Immutable pane identity');
      } else if (tx.panes().length >= communicationLimits.panes)
        throw new Error('Pane history capacity');
      db.prepare(
        `INSERT INTO communication_panes VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET metadata=excluded.metadata`,
      ).run(pane.paneId, pane.workspaceId, pane.displayId, JSON.stringify(pane));
    },
    saveMessage: (input) => {
      const message = communicationMessageSchema.parse(input);
      const previous = tx.messages().find((m) => m.messageId === message.messageId);
      if (previous) {
        const envelope = (value: typeof message) =>
          Object.fromEntries(
            Object.keys(paneSendSchema.shape).map((key) => [key, value[key as keyof typeof value]]),
          );
        if (
          JSON.stringify(envelope(previous)) !== JSON.stringify(envelope(message)) ||
          previous.actorId !== message.actorId ||
          previous.depth !== message.depth ||
          previous.createdAt !== message.createdAt
        )
          throw new Error('Immutable message identity');
      } else {
        if (tx.messages().length >= communicationLimits.messages)
          throw new Error('Message history capacity');
        if (
          crossExists() &&
          db
            .prepare(
              `SELECT 1 FROM cross_feature_messages WHERE message_id=? OR task_id=?
          OR (workspace_id=? AND target_id=? AND idempotency_key=?) LIMIT 1`,
            )
            .get(
              message.messageId,
              message.taskId,
              message.workspaceId,
              message.targetPaneId,
              message.idempotencyKey,
            )
        )
          throw new Error('Message identity already used');
      }
      db.prepare(
        `INSERT INTO communication_messages VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET metadata=excluded.metadata`,
      ).run(
        message.messageId,
        message.taskId,
        message.workspaceId,
        message.targetPaneId,
        message.idempotencyKey,
        JSON.stringify(message),
      );
    },
    audit: (input) => {
      if (
        Number(db.prepare('SELECT COUNT(*) AS n FROM communication_audit').get()?.n) >=
        communicationLimits.auditEvents
      )
        throw new Error('Communication audit capacity');
      const sequence = Number(
        db.prepare('SELECT COALESCE(MAX(sequence),0)+1 AS n FROM communication_audit').get()?.n,
      );
      const event = communicationAuditSchema.parse({ ...input, sequence });
      db.prepare('INSERT INTO communication_audit VALUES (?,?)').run(
        sequence,
        JSON.stringify(event),
      );
    },
    events: (after, scope) => {
      z.number().int().nonnegative().safe().parse(after);
      const statement = scope
        ? db.prepare(
            "SELECT metadata FROM communication_audit WHERE sequence>? AND json_extract(metadata,'$.workspaceId')=? AND json_extract(metadata,'$.paneId')=? AND (json_extract(metadata,'$.actorId') IS NULL OR json_extract(metadata,'$.actorId')=?) ORDER BY sequence LIMIT 256",
          )
        : db.prepare(
            'SELECT metadata FROM communication_audit WHERE sequence>? ORDER BY sequence LIMIT 256',
          );
      return statement
        .all(...(scope ? [after, scope.workspaceId, scope.paneId, scope.actorId] : [after]))
        .map((row) => communicationAuditSchema.parse(JSON.parse(String(row.metadata))));
    },
  };
  const crossAudit = (
    message: import('@orqst/protocol').CrossFeatureMessage,
    event: Omit<import('@orqst/protocol').CrossFeatureAudit, 'sequence'>,
    outcome: import('@orqst/protocol').CrossFeatureAudit['outcome'],
  ) => {
    const g = message.grant;
    if (
      Number(db.prepare('SELECT COUNT(*) AS n FROM cross_feature_audit').get()?.n) >=
      communicationLimits.auditEvents
    )
      throw new Error('Cross-Feature audit capacity');
    const sequence = Number(
      db.prepare('SELECT COALESCE(MAX(sequence),0)+1 AS n FROM cross_feature_audit').get()?.n,
    );
    const audit = crossFeatureAuditSchema.parse({ ...event, sequence });
    if (
      audit.outcome !== outcome ||
      audit.grantId !== g.grantId ||
      audit.intentId !== g.intentId ||
      audit.actorId !== g.actorId ||
      audit.workspaceId !== g.workspaceId ||
      audit.messageId !== message.request.messageId ||
      audit.sourceFeatureId !== g.source.featureId ||
      audit.targetFeatureId !== g.target.featureId ||
      audit.sourceTerminalId !== g.source.terminalId ||
      audit.targetTerminalId !== g.target.terminalId ||
      audit.sourcePaneId !== g.source.paneId ||
      audit.targetPaneId !== g.target.paneId ||
      audit.sourceRevision !== g.sourceRevision ||
      audit.targetRevision !== g.targetRevision
    )
      throw new Error('Invalid cross-Feature audit scope');
    db.prepare('INSERT INTO cross_feature_audit(sequence, metadata) VALUES (?,?)').run(
      sequence,
      JSON.stringify(event),
    );
  };
  const enableCross = () => {
    const existed = crossExists();
    db.exec(`CREATE TABLE IF NOT EXISTS cross_feature_journal_schema (singleton INTEGER PRIMARY KEY CHECK(singleton=1), version INTEGER NOT NULL);
      INSERT OR IGNORE INTO cross_feature_journal_schema VALUES(1,1);`);
    if (
      db.prepare('SELECT version FROM cross_feature_journal_schema WHERE singleton=1').get()
        ?.version !== 1
    )
      throw new Error('Unsupported cross-Feature journal schema');
    db.exec(`CREATE TABLE IF NOT EXISTS cross_feature_messages (
        message_id TEXT PRIMARY KEY, task_id TEXT NOT NULL UNIQUE, workspace_id TEXT NOT NULL,
        target_id TEXT NOT NULL, idempotency_key TEXT NOT NULL, grant_id TEXT NOT NULL UNIQUE,
        intent_id TEXT NOT NULL UNIQUE, nonce TEXT NOT NULL UNIQUE, metadata TEXT NOT NULL CHECK(json_valid(metadata)),
        UNIQUE(workspace_id,target_id,idempotency_key));
      CREATE TABLE IF NOT EXISTS cross_feature_audit (
        sequence INTEGER PRIMARY KEY, metadata TEXT NOT NULL CHECK(json_valid(metadata)));`);
    if (
      db.prepare('SELECT version FROM cross_feature_journal_schema WHERE singleton=1').get()
        ?.version !== 1
    )
      throw new Error('Unsupported cross-Feature journal schema');
    db.exec(`CREATE TABLE IF NOT EXISTS cross_feature_owner
      (singleton INTEGER PRIMARY KEY CHECK(singleton=1), epoch TEXT NOT NULL)`);
    const prior = db.prepare('SELECT epoch FROM cross_feature_owner WHERE singleton=1').get();
    if (existed && (!prior || prior.epoch !== epoch)) {
      for (const message of tx.crossMessages()) {
        if (message.state !== 'dispatching') continue;
        const g = message.grant;
        const timestamp = Math.max(now(), message.updatedAt);
        const recovered = { ...message, state: 'outcome_unknown' as const, updatedAt: timestamp };
        db.prepare('UPDATE cross_feature_messages SET metadata=? WHERE message_id=?').run(
          JSON.stringify(recovered),
          message.request.messageId,
        );
        crossAudit(
          recovered,
          {
            schemaVersion: 1,
            eventId: randomUUID(),
            timestamp,
            actorId: g.actorId,
            workspaceId: g.workspaceId,
            sourceFeatureId: g.source.featureId,
            targetFeatureId: g.target.featureId,
            sourceTerminalId: g.source.terminalId,
            targetTerminalId: g.target.terminalId,
            sourcePaneId: g.source.paneId,
            targetPaneId: g.target.paneId,
            operation: g.operation,
            grantId: g.grantId,
            intentId: g.intentId,
            messageId: message.request.messageId,
            sourceRevision: g.sourceRevision,
            targetRevision: g.targetRevision,
            outcome: 'outcome_unknown',
          },
          'outcome_unknown',
        );
      }
    }
    db.prepare('INSERT OR REPLACE INTO cross_feature_owner VALUES (1,?)').run(epoch);
  };
  const commit = <T>(action: () => T): T => {
    if (db.isTransaction) throw new Error('Communication requires an independent commit');
    return transaction(action);
  };
  commit(() => {
    if (
      !db
        .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='communication_schema'")
        .get()
    )
      db.exec(migration);
    if (
      db.prepare('SELECT version FROM communication_schema WHERE singleton=1').get()?.version !== 1
    )
      throw new Error('Unsupported communication schema');
    const owner = db.prepare('SELECT epoch FROM communication_owner WHERE singleton=1').get();
    if (owner && (!recover || owner.epoch === epoch))
      throw new Error('Communication already owned');
    if (owner) {
      for (const pane of tx.panes())
        if (pane.state !== 'closed') tx.savePane({ ...pane, state: 'unavailable' });
      for (const message of tx.messages()) {
        if (message.taskState === 'pending' && message.deliveryState === 'queued') continue;
        if (['completed', 'failed', 'cancelled', 'outcome_unknown'].includes(message.taskState))
          continue;
        const recovered = {
          ...message,
          deliveryState:
            message.deliveryState === 'dispatching'
              ? ('delivery_unknown' as const)
              : message.deliveryState,
          taskState: 'outcome_unknown' as const,
          reason: 'core_recovery' as const,
          updatedAt: Math.max(now(), message.updatedAt),
        };
        tx.saveMessage(recovered);
        tx.audit({
          timestamp: recovered.updatedAt,
          actorId: message.actorId,
          workspaceId: message.workspaceId,
          ...(message.featureId === undefined ? {} : { featureId: message.featureId }),
          paneId: message.sourcePaneId,
          messageId: message.messageId,
          action: 'state_changed',
          deliveryState: recovered.deliveryState,
          taskState: recovered.taskState,
        });
      }
    }
    db.prepare('INSERT OR REPLACE INTO communication_owner VALUES (1,?)').run(epoch);
  });
  return {
    epoch,
    enableCross: () =>
      commit(() => {
        if (
          db.prepare('SELECT epoch FROM communication_owner WHERE singleton=1').get()?.epoch !==
          epoch
        )
          throw new Error('Communication owner fenced');
        enableCross();
      }),
    transaction: (action) =>
      commit(() => {
        if (
          db.prepare('SELECT epoch FROM communication_owner WHERE singleton=1').get()?.epoch !==
          epoch
        )
          throw new Error('Communication owner fenced');
        let active = true;
        // The transaction handle cannot be retained and used to bypass ownership/commit checks.
        const guarded = Object.fromEntries(
          Object.entries(tx).map(([key, method]) => [
            key,
            (...args: never[]) => {
              if (!active) throw new Error('Communication transaction expired');
              return (method as (...values: never[]) => unknown)(...args);
            },
          ]),
        ) as unknown as CommunicationTransaction;
        try {
          const result = action(guarded);
          if (result && typeof (result as { then?: unknown }).then === 'function')
            throw new Error('Communication transaction must be synchronous');
          return result;
        } finally {
          active = false;
        }
      }),
  };
}
