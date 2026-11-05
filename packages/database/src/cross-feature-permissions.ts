import type { DatabaseSync } from 'node:sqlite';
import {
  crossFeaturePolicySchema,
  crossFeaturePolicyStateSchema,
  featureScopeSchema,
  type CrossFeaturePolicy,
  type FeatureScope,
} from '@orqst/protocol';
import { openFeatures } from './features.js';

/** Separate, versioned policy metadata; no communication journal or native authority. */
export function openCrossFeaturePermissions(db: DatabaseSync, transaction: <T>(fn: () => T) => T) {
  const features = openFeatures(db, transaction);
  transaction(() => {
    db.exec(`CREATE TABLE IF NOT EXISTS cross_feature_permission_schema (
      singleton INTEGER PRIMARY KEY CHECK(singleton=1), version INTEGER NOT NULL
    ); INSERT OR IGNORE INTO cross_feature_permission_schema VALUES (1,1);`);
    if (
      db.prepare('SELECT version FROM cross_feature_permission_schema WHERE singleton=1').get()
        ?.version !== 1
    )
      throw new Error('Unsupported cross-Feature permission schema');
    db.exec(`CREATE TABLE IF NOT EXISTS cross_feature_permissions (
      feature_id TEXT PRIMARY KEY REFERENCES features(id), workspace_id TEXT NOT NULL,
      revision INTEGER NOT NULL CHECK(revision>0), metadata TEXT NOT NULL CHECK(json_valid(metadata))
    ); CREATE TABLE IF NOT EXISTS cross_feature_permission_events (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT, feature_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL, revision INTEGER NOT NULL, actor_id TEXT NOT NULL,
      timestamp INTEGER NOT NULL, metadata TEXT NOT NULL CHECK(json_valid(metadata)),
      UNIQUE(feature_id, revision)
    );`);
  });
  const version = () => {
    if (
      db.prepare('SELECT version FROM cross_feature_permission_schema WHERE singleton=1').get()
        ?.version !== 1
    )
      throw new Error('Unsupported cross-Feature permission schema');
  };
  const read = (scopeInput: FeatureScope) => {
    version();
    const scope = featureScopeSchema.parse(scopeInput);
    const feature = features.read(scope);
    if (feature.status === 'archived') throw new Error('Archived Feature');
    const row = db
      .prepare('SELECT * FROM cross_feature_permissions WHERE feature_id=?')
      .get(scope.featureId);
    const latest = db
      .prepare(
        'SELECT * FROM cross_feature_permission_events WHERE feature_id=? ORDER BY revision DESC LIMIT 1',
      )
      .get(scope.featureId);
    const count = Number(
      db
        .prepare('SELECT COUNT(*) AS n FROM cross_feature_permission_events WHERE feature_id=?')
        .get(scope.featureId)?.n,
    );
    if (
      row &&
      (row.workspace_id !== scope.workspaceId || Buffer.byteLength(String(row.metadata)) > 65536)
    )
      throw new Error('Invalid cross-Feature policy');
    const state = crossFeaturePolicyStateSchema.parse({
      schemaVersion: 1,
      ...scope,
      revision: row?.revision ?? 0,
      policy: row ? JSON.parse(String(row.metadata)) : null,
    });
    if (
      count !== state.revision ||
      Boolean(row) !== Boolean(latest) ||
      (row &&
        latest &&
        (latest.workspace_id !== scope.workspaceId ||
          latest.revision !== row.revision ||
          latest.metadata !== row.metadata))
    )
      throw new Error('Invalid cross-Feature policy audit');
    if (
      state.policy?.rules.some(
        (rule) =>
          !feature.terminalIds.includes(rule.localTerminalId) ||
          rule.remoteFeatureId === scope.featureId,
      )
    )
      throw new Error('Invalid cross-Feature policy membership');
    return { feature, state };
  };
  return {
    read: (scope: FeatureScope) => transaction(() => read(scope)),
    save: (
      scopeInput: FeatureScope,
      actorId: string,
      expectedRevision: number,
      input: CrossFeaturePolicy,
    ) =>
      transaction(() => {
        const scope = featureScopeSchema.parse(scopeInput);
        if (!/^[a-zA-Z0-9_-]{1,128}$/.test(actorId)) throw new Error('Invalid actor');
        const before = read(scope);
        const policy = crossFeaturePolicySchema.parse(input);
        if (
          before.state.revision !== expectedRevision ||
          expectedRevision >= Number.MAX_SAFE_INTEGER
        )
          throw new Error('Stale cross-Feature policy revision');
        for (const rule of policy.rules) {
          if (
            !before.feature.terminalIds.includes(rule.localTerminalId) ||
            rule.remoteFeatureId === scope.featureId
          )
            throw new Error('Invalid local terminal');
          const remote = features.read({
            workspaceId: scope.workspaceId,
            featureId: rule.remoteFeatureId,
          });
          if (remote.status === 'archived' || !remote.terminalIds.includes(rule.remoteTerminalId))
            throw new Error('Invalid remote terminal');
        }
        const metadata = JSON.stringify(policy);
        if (Buffer.byteLength(metadata) > 65536) throw new Error('Cross-Feature policy too large');
        const next = expectedRevision + 1;
        db.prepare(
          `INSERT INTO cross_feature_permissions VALUES (?,?,?,?) ON CONFLICT(feature_id)
        DO UPDATE SET revision=excluded.revision, metadata=excluded.metadata`,
        ).run(scope.featureId, scope.workspaceId, next, metadata);
        db.prepare(
          'INSERT INTO cross_feature_permission_events(feature_id, workspace_id, revision, actor_id, timestamp, metadata) VALUES (?,?,?,?,?,?)',
        ).run(scope.featureId, scope.workspaceId, next, actorId, Date.now(), metadata);
        return read(scope);
      }),
  };
}
