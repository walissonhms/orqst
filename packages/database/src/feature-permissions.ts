import type { DatabaseSync } from 'node:sqlite';
import {
  featureScopeSchema,
  featurePermissionSaveSchema,
  featurePermissionStateSchema,
  featurePermissionEventSchema,
  type FeatureScope,
  type FeaturePermissionConfiguration,
} from '@orqst/protocol';
import { openFeatures } from './features.js';
import { z } from 'zod';

export class FeaturePermissionRevisionConflict extends Error {}

const bytes = 16384;
const policyLimit = 1024;
const auditLimit = 32768;

/** Opt-in additive metadata extension. No execution journal, grant or observer migration. */
export function openFeaturePermissions(
  db: DatabaseSync,
  transaction: <T>(action: () => T) => T,
  now = Date.now,
) {
  const features = openFeatures(db, transaction, now);
  const checkVersion = () => {
    if (
      db.prepare('SELECT version FROM feature_permission_schema WHERE singleton=1').get()
        ?.version !== 1
    )
      throw new Error('Unsupported Feature permission schema');
  };
  transaction(() => {
    db.exec(`CREATE TABLE IF NOT EXISTS feature_permission_schema (
      singleton INTEGER PRIMARY KEY CHECK(singleton=1), version INTEGER NOT NULL
    ); INSERT OR IGNORE INTO feature_permission_schema VALUES (1,1);`);
    checkVersion();
    db.exec(`CREATE TABLE IF NOT EXISTS feature_permissions (
      feature_id TEXT PRIMARY KEY REFERENCES features(id), workspace_id TEXT NOT NULL,
      revision INTEGER NOT NULL CHECK(revision>0),
      metadata TEXT NOT NULL CHECK(json_valid(metadata) AND length(metadata)<=16384)
    ); CREATE INDEX IF NOT EXISTS feature_permissions_workspace ON feature_permissions(workspace_id);
    CREATE TABLE IF NOT EXISTS feature_permission_events (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT, workspace_id TEXT NOT NULL,
      feature_id TEXT NOT NULL REFERENCES features(id),
      metadata TEXT NOT NULL CHECK(json_valid(metadata) AND length(metadata)<=32768)
    ); CREATE INDEX IF NOT EXISTS feature_permission_events_feature ON feature_permission_events(feature_id,sequence);`);
  });
  const count = (table: 'feature_permissions' | 'feature_permission_events') =>
    Number(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n);
  const scopeFeature = (raw: FeatureScope) => {
    checkVersion();
    const scope = featureScopeSchema.parse(raw);
    const feature = features.read(scope);
    if (feature.status === 'archived') throw new Error('Archived Feature permission scope');
    return feature;
  };
  const members = (ids: string[], configuration: FeaturePermissionConfiguration | null) => {
    if (
      configuration?.rules.some(
        (r) => !ids.includes(r.sourceTerminalId) || !ids.includes(r.targetTerminalId),
      )
    )
      throw new Error('Foreign Feature permission terminal');
  };
  const read = (raw: FeatureScope) => {
    const feature = scopeFeature(raw);
    if (
      count('feature_permissions') >= policyLimit ||
      count('feature_permission_events') >= auditLimit
    )
      throw new Error('Feature permission capacity exceeded');
    const row = db
      .prepare('SELECT * FROM feature_permissions WHERE feature_id=?')
      .get(feature.featureId);
    if (
      row &&
      (row.workspace_id !== feature.workspaceId || Buffer.byteLength(String(row.metadata)) > bytes)
    )
      throw new Error('Invalid Feature permission scope or size');
    const state = featurePermissionStateSchema.parse({
      schemaVersion: 1,
      workspaceId: feature.workspaceId,
      featureId: feature.featureId,
      revision: row?.revision ?? 0,
      configuration: row ? JSON.parse(String(row.metadata)) : null,
    });
    members(feature.terminalIds, state.configuration);
    const latest = db
      .prepare(
        `SELECT * FROM feature_permission_events
      WHERE feature_id=? ORDER BY sequence DESC LIMIT 1`,
      )
      .get(feature.featureId);
    if (Boolean(row) !== Boolean(latest)) throw new Error('Feature permission audit missing');
    const auditCount = Number(
      db
        .prepare('SELECT COUNT(*) AS n FROM feature_permission_events WHERE feature_id=?')
        .get(feature.featureId)?.n,
    );
    if (auditCount !== state.revision)
      throw new Error('Feature permission audit history incomplete');
    if (latest) {
      if (Buffer.byteLength(String(latest.metadata)) > 32768)
        throw new Error('Feature permission audit too large');
      const event = featurePermissionEventSchema.parse({
        ...JSON.parse(String(latest.metadata)),
        sequence: latest.sequence,
      });
      if (
        latest.workspace_id !== feature.workspaceId ||
        event.workspaceId !== feature.workspaceId ||
        event.featureId !== feature.featureId ||
        event.revision !== state.revision ||
        JSON.stringify(event.configuration) !== JSON.stringify(state.configuration)
      )
        throw new Error('Feature permission audit inconsistent');
    }
    return state;
  };
  return {
    read: (scope: FeatureScope) => transaction(() => read(scope)),
    save: (scope: FeatureScope, actorId: string, raw: unknown) =>
      transaction(() => {
        const {
          expectedRevision,
          expectedFeatureRevision,
          expectedViewRevision,
          configuration,
          reviewDigest,
        } = featurePermissionSaveSchema.parse(raw);
        const feature = scopeFeature(scope);
        if (expectedFeatureRevision !== undefined && feature.revision !== expectedFeatureRevision)
          throw new FeaturePermissionRevisionConflict('Stale Feature permission scope');
        if (expectedViewRevision !== undefined) {
          const view = features.readView(feature.workspaceId);
          if (view.revision !== expectedViewRevision || view.featureId !== feature.featureId)
            throw new FeaturePermissionRevisionConflict('Stale active Feature view');
        }
        members(feature.terminalIds, configuration);
        const before = read(scope);
        if (before.revision !== expectedRevision)
          throw new FeaturePermissionRevisionConflict('Stale Feature permission revision');
        if (expectedRevision >= Number.MAX_SAFE_INTEGER)
          throw new Error('Feature permission revision limit exceeded');
        const metadata = JSON.stringify(configuration);
        if (Buffer.byteLength(metadata) > bytes)
          throw new Error('Feature permission policy too large');
        const event = {
          schemaVersion: 1,
          workspaceId: feature.workspaceId,
          featureId: feature.featureId,
          timestamp: now(),
          actorId,
          action: 'feature.permissions.updated',
          previousRevision: before.revision,
          revision: before.revision + 1,
          previousConfiguration: before.configuration,
          configuration,
          ...(reviewDigest ? { reviewDigest } : {}),
        };
        const audit = JSON.stringify(event);
        if (Buffer.byteLength(audit) > 32768) throw new Error('Feature permission audit too large');
        db.prepare(
          `INSERT INTO feature_permissions VALUES (?,?,?,?) ON CONFLICT(feature_id)
        DO UPDATE SET revision=excluded.revision, metadata=excluded.metadata`,
        ).run(feature.featureId, feature.workspaceId, event.revision, metadata);
        const inserted = db
          .prepare(
            'INSERT INTO feature_permission_events(workspace_id, feature_id, metadata) VALUES (?,?,?)',
          )
          .run(feature.workspaceId, feature.featureId, audit);
        featurePermissionEventSchema.parse({
          ...event,
          sequence: Number(inserted.lastInsertRowid),
        });
        // A saturated store denies even reads; returning through read also rolls back a saturating save.
        return read(scope);
      }),
    events: (scope: FeatureScope, after = 0) =>
      transaction(() => {
        read(scope);
        z.number().int().nonnegative().safe().parse(after);
        if (count('feature_permission_events') >= auditLimit)
          throw new Error('Feature permission audit capacity exceeded');
        return db
          .prepare(
            `SELECT * FROM feature_permission_events
        WHERE workspace_id=? AND feature_id=? AND sequence>? ORDER BY sequence LIMIT 256`,
          )
          .all(scope.workspaceId, scope.featureId, after)
          .map((row) => {
            if (Buffer.byteLength(String(row.metadata)) > 32768)
              throw new Error('Feature permission audit too large');
            const event = featurePermissionEventSchema.parse({
              ...JSON.parse(String(row.metadata)),
              sequence: row.sequence,
            });
            if (event.workspaceId !== row.workspace_id || event.featureId !== row.feature_id)
              throw new Error('Invalid Feature permission audit scope');
            return event;
          });
      }),
  };
}
