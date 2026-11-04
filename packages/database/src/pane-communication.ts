import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import {
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
  const tx: CommunicationTransaction = {
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
      } else if (tx.messages().length >= communicationLimits.messages)
        throw new Error('Message history capacity');
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
