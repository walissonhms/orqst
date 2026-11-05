import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  featureScopeSchema,
  featureViewStateSchema,
  featureViewSaveSchema,
  featureCreateSchema,
  featureUpdateSchema,
  workspaceFeatureSchema,
  featureConfigurationEventSchema,
  type FeatureScope,
  type WorkspaceFeature,
} from '@orqst/protocol';
import { z } from 'zod';

/** Additive metadata only. No process/session table, journal ownership or restored authority. */
export function openFeatures(
  db: DatabaseSync,
  transaction: <T>(action: () => T) => T,
  now = Date.now,
) {
  transaction(() => {
    db.exec(`CREATE TABLE IF NOT EXISTS feature_configuration_schema (
      singleton INTEGER PRIMARY KEY CHECK(singleton=1), version INTEGER NOT NULL
    ); INSERT OR IGNORE INTO feature_configuration_schema VALUES (1,1);`);
    if (
      db.prepare('SELECT version FROM feature_configuration_schema WHERE singleton=1').get()
        ?.version !== 1
    )
      throw new Error('Unsupported feature configuration schema');
    db.exec(`CREATE TABLE IF NOT EXISTS features (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, name TEXT NOT NULL,
      description TEXT NOT NULL, status TEXT NOT NULL, revision INTEGER NOT NULL,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    ); CREATE INDEX IF NOT EXISTS features_workspace ON features(workspace_id);
    CREATE TABLE IF NOT EXISTS feature_terminal_assignments (
      terminal_id TEXT PRIMARY KEY, feature_id TEXT NOT NULL REFERENCES features(id)
    ); CREATE TABLE IF NOT EXISTS feature_orchestrator_labels (
      feature_id TEXT PRIMARY KEY REFERENCES features(id), terminal_id TEXT NOT NULL REFERENCES feature_terminal_assignments(terminal_id)
    ); CREATE TABLE IF NOT EXISTS feature_configuration_events (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT, metadata TEXT NOT NULL CHECK(json_valid(metadata))
    );`);
  });
  transaction(() => {
    db.exec(`CREATE TABLE IF NOT EXISTS feature_view_schema (
      singleton INTEGER PRIMARY KEY CHECK(singleton=1), version INTEGER NOT NULL
    ); INSERT OR IGNORE INTO feature_view_schema VALUES (1,1);`);
    if (
      db.prepare('SELECT version FROM feature_view_schema WHERE singleton=1').get()?.version !== 1
    )
      throw new Error('Unsupported feature view schema');
    db.exec(`CREATE TABLE IF NOT EXISTS feature_views (
      workspace_id TEXT PRIMARY KEY, feature_id TEXT REFERENCES features(id), revision INTEGER NOT NULL
    );`);
  });
  const readView = (workspaceId: string) => {
    featureScopeSchema.shape.workspaceId.parse(workspaceId);
    const row = db.prepare('SELECT * FROM feature_views WHERE workspace_id=?').get(workspaceId);
    return featureViewStateSchema.parse({
      contractVersion: 1,
      storage: 'core',
      workspaceId,
      featureId: row?.feature_id ?? null,
      revision: row?.revision ?? 0,
    });
  };
  const read = (raw: FeatureScope): WorkspaceFeature => {
    const scope = featureScopeSchema.parse(raw);
    const row = db
      .prepare('SELECT * FROM features WHERE id=? AND workspace_id=?')
      .get(scope.featureId, scope.workspaceId);
    if (!row) throw new Error('Feature unavailable in workspace');
    return workspaceFeatureSchema.parse({
      schemaVersion: 1,
      featureId: row.id,
      workspaceId: row.workspace_id,
      name: row.name,
      description: row.description,
      status: row.status,
      revision: row.revision,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      terminalIds: db
        .prepare(
          'SELECT terminal_id FROM feature_terminal_assignments WHERE feature_id=? ORDER BY rowid',
        )
        .all(scope.featureId)
        .map((r) => r.terminal_id),
      orchestratorTerminalId:
        db
          .prepare('SELECT terminal_id FROM feature_orchestrator_labels WHERE feature_id=?')
          .get(scope.featureId)?.terminal_id ?? null,
    });
  };
  const audit = (
    feature: WorkspaceFeature,
    action: z.infer<typeof featureConfigurationEventSchema>['action'],
    terminalId: string | null = null,
  ) => {
    if (
      Number(
        db.prepare('SELECT COUNT(*) AS count FROM feature_configuration_events').get()?.count,
      ) >= 32768
    )
      throw new Error('Feature audit capacity exceeded');
    const event = featureConfigurationEventSchema.omit({ sequence: true }).parse({
      schemaVersion: 1,
      workspaceId: feature.workspaceId,
      featureId: feature.featureId,
      action,
      revision: feature.revision,
      timestamp: feature.updatedAt,
      terminalId,
    });
    db.prepare('INSERT INTO feature_configuration_events(metadata) VALUES (?)').run(
      JSON.stringify(event),
    );
  };
  const advance = (feature: WorkspaceFeature) => {
    if (feature.revision >= Number.MAX_SAFE_INTEGER) throw new Error('Feature revision exhausted');
    db.prepare('UPDATE features SET revision=revision+1, updated_at=? WHERE id=?').run(
      now(),
      feature.featureId,
    );
  };
  return {
    read,
    readView,
    saveView: (workspaceId: string, input: unknown) =>
      transaction(() => {
        const value = featureViewSaveSchema.parse(input);
        const before = readView(workspaceId);
        if (before.revision !== value.expectedRevision)
          throw new Error('Stale feature view revision');
        if (before.revision >= Number.MAX_SAFE_INTEGER)
          throw new Error('Feature view revision exhausted');
        if (value.featureId !== null) read({ workspaceId, featureId: value.featureId });
        if (
          before.revision === 0 &&
          Number(db.prepare('SELECT COUNT(*) AS n FROM feature_views').get()?.n) >= 1024
        )
          throw new Error('Feature view capacity exceeded');
        db.prepare(
          `INSERT INTO feature_views VALUES (?,?,?) ON CONFLICT(workspace_id)
        DO UPDATE SET feature_id=excluded.feature_id, revision=excluded.revision`,
        ).run(workspaceId, value.featureId, before.revision + 1);
        return readView(workspaceId);
      }),
    list: (workspaceId: string) => {
      featureScopeSchema.shape.workspaceId.parse(workspaceId);
      return db
        .prepare('SELECT id FROM features WHERE workspace_id=? ORDER BY rowid')
        .all(workspaceId)
        .map((r) => read({ workspaceId, featureId: String(r.id) }));
    },
    create: (input: unknown) =>
      transaction(() => {
        const value = featureCreateSchema.parse(input);
        if (Number(db.prepare('SELECT COUNT(*) AS count FROM features').get()?.count) >= 1024)
          throw new Error('Feature capacity exceeded');
        const featureId = randomUUID();
        const timestamp = now();
        db.prepare('INSERT INTO features VALUES (?,?,?,?,?,?,?,?)').run(
          featureId,
          value.workspaceId,
          value.name,
          value.description,
          value.status,
          1,
          timestamp,
          timestamp,
        );
        const feature = read({ workspaceId: value.workspaceId, featureId });
        audit(feature, 'feature.created');
        return feature;
      }),
    update: (scope: FeatureScope, input: unknown) =>
      transaction(() => {
        const value = featureUpdateSchema.parse(input);
        const before = read(scope);
        if (before.revision !== value.expectedRevision) throw new Error('Stale feature revision');
        if (
          value.orchestratorTerminalId &&
          !before.terminalIds.includes(value.orchestratorTerminalId)
        )
          throw new Error('Orchestrator must be a member of the Feature');
        // Native active-work/archive decisions are not implemented here; never guess their safety.
        if (value.status === 'archived' && before.terminalIds.length)
          throw new Error(
            'Feature with assigned terminals requires lifecycle review before archive',
          );
        db.prepare('UPDATE features SET name=?, description=?, status=? WHERE id=?').run(
          value.name ?? before.name,
          value.description ?? before.description,
          value.status ?? before.status,
          before.featureId,
        );
        if (value.orchestratorTerminalId !== undefined) {
          db.prepare('DELETE FROM feature_orchestrator_labels WHERE feature_id=?').run(
            before.featureId,
          );
          if (value.orchestratorTerminalId !== null)
            db.prepare('INSERT INTO feature_orchestrator_labels VALUES (?,?)').run(
              before.featureId,
              value.orchestratorTerminalId,
            );
        }
        advance(before);
        const after = read(scope);
        audit(after, value.status === 'archived' ? 'feature.archived' : 'feature.updated');
        return after;
      }),
    assignTerminal: (scope: FeatureScope, terminalId: string, expectedRevision: number) =>
      transaction(() => {
        z.uuid().parse(terminalId);
        const feature = read(scope);
        if (feature.revision !== z.number().int().positive().safe().parse(expectedRevision))
          throw new Error('Stale feature revision');
        if (feature.status === 'archived') throw new Error('Archived feature');
        if (feature.terminalIds.length >= 8) throw new Error('Feature terminal capacity exceeded');
        // A stable terminal belongs to one Feature. No move/adoption/reassignment from metadata.
        if (
          db
            .prepare('SELECT 1 FROM feature_terminal_assignments WHERE terminal_id=?')
            .get(terminalId)
        )
          throw new Error('Terminal already assigned to a Feature');
        db.prepare('INSERT INTO feature_terminal_assignments VALUES (?,?)').run(
          terminalId,
          feature.featureId,
        );
        advance(feature);
        const after = read(scope);
        audit(after, 'feature.terminal_added', terminalId);
        return after;
      }),
    events: (scope: FeatureScope, after = 0) => {
      read(scope);
      z.number().int().nonnegative().safe().parse(after);
      return db
        .prepare(
          'SELECT sequence,metadata FROM feature_configuration_events WHERE sequence>? ORDER BY sequence',
        )
        .all(after)
        .map((r) =>
          featureConfigurationEventSchema.parse({
            ...JSON.parse(String(r.metadata)),
            sequence: r.sequence,
          }),
        )
        .filter(
          (event) => event.workspaceId === scope.workspaceId && event.featureId === scope.featureId,
        );
    },
  };
}
