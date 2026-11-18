import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  DEFAULT_FEATURE_NAME,
  defaultFeatureId,
  featureScopeSchema,
  featureViewStateSchema,
  featureViewSaveSchema,
  featureCreateSchema,
  featureUpdateSchema,
  terminalDisplayNameSchema,
  terminalDisplayId,
  workspaceFeatureSchema,
  featureConfigurationEventSchema,
  type FeatureScope,
  type WorkspaceFeature,
} from '@orqst/protocol';
import { z } from 'zod';
import { openTerminalLayouts } from './terminal-layouts.js';
import { openTerminalTeams } from './terminal-teams.js';

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
    ); CREATE TABLE IF NOT EXISTS feature_terminal_displays (
      terminal_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, ordinal INTEGER NOT NULL
        CHECK (ordinal BETWEEN 1 AND 99999), replaced_by TEXT,
      released_manifest TEXT, released_epoch TEXT, removed_at INTEGER
    ); CREATE UNIQUE INDEX IF NOT EXISTS feature_terminal_current_ordinal
      ON feature_terminal_displays(workspace_id,ordinal) WHERE replaced_by IS NULL;
    CREATE TABLE IF NOT EXISTS feature_orchestrator_labels (
      feature_id TEXT PRIMARY KEY REFERENCES features(id), terminal_id TEXT NOT NULL REFERENCES feature_terminal_assignments(terminal_id)
    ); CREATE TABLE IF NOT EXISTS feature_configuration_events (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT, metadata TEXT NOT NULL CHECK(json_valid(metadata))
    );`);
    // Import unlabelled memberships in persisted assignment order. Allocate after
    // existing ordinals, including terminals already removed from the Feature.
    db.exec(`INSERT INTO feature_terminal_displays (terminal_id,workspace_id,ordinal)
      SELECT a.terminal_id,f.workspace_id,
        ROW_NUMBER() OVER (PARTITION BY f.workspace_id ORDER BY a.rowid) +
        COALESCE((SELECT MAX(d.ordinal) FROM feature_terminal_displays d WHERE d.workspace_id=f.workspace_id),0)
      FROM feature_terminal_assignments a JOIN features f ON f.id=a.feature_id
      LEFT JOIN feature_terminal_displays d ON d.terminal_id=a.terminal_id
      WHERE d.terminal_id IS NULL;`);
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
    const members = db
      .prepare(
        `SELECT a.terminal_id,d.ordinal,d.released_epoch FROM feature_terminal_assignments a
       JOIN feature_terminal_displays d ON d.terminal_id=a.terminal_id AND d.workspace_id=?
       AND d.replaced_by IS NULL AND d.removed_at IS NULL WHERE a.feature_id=? ORDER BY a.rowid`,
      )
      .all(scope.workspaceId, scope.featureId);
    if (
      Number(
        db
          .prepare('SELECT COUNT(*) AS n FROM feature_terminal_assignments WHERE feature_id=?')
          .get(scope.featureId)?.n,
      ) !== members.length
    )
      throw new Error('Feature terminal display identity changed');
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
      terminalIds: members.map((member) => member.terminal_id),
      ...(members.length
        ? {
            terminalDisplays: members.map((member) => ({
              terminalId: member.terminal_id,
              displayId: terminalDisplayId(Number(member.ordinal)),
              ...(member.released_epoch ? { released: true } : {}),
            })),
          }
        : {}),
      orchestratorTerminalId:
        db
          .prepare('SELECT terminal_id FROM feature_orchestrator_labels WHERE feature_id=?')
          .get(scope.featureId)?.terminal_id ?? null,
    });
  };
  const readAssignmentTarget = (workspaceId: string, featureId: string | null) => {
    const scope = { workspaceId, featureId: featureId ?? defaultFeatureId(workspaceId) };
    if (featureId === null && !db.prepare('SELECT 1 FROM features WHERE id=?').get(scope.featureId))
      return null;
    return read(scope);
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
  const ensureDefaultRow = (
    workspaceId: string,
    defaultName: string = DEFAULT_FEATURE_NAME,
    expectedRevision?: number,
  ): WorkspaceFeature => {
    featureScopeSchema.shape.workspaceId.parse(workspaceId);
    const title = terminalDisplayNameSchema.parse(defaultName);
    const featureId = defaultFeatureId(workspaceId);
    const row = db.prepare('SELECT id FROM features WHERE id=?').get(featureId);
    if (!row) {
      if (expectedRevision !== undefined && expectedRevision !== 1)
        throw new Error('Stale feature revision');
      if (Number(db.prepare('SELECT COUNT(*) AS count FROM features').get()?.count) >= 1024)
        throw new Error('Feature capacity exceeded');
      const timestamp = now();
      db.prepare('INSERT INTO features VALUES (?,?,?,?,?,?,?,?)').run(
        featureId,
        workspaceId,
        title,
        '',
        'active',
        1,
        timestamp,
        timestamp,
      );
      const created = read({ workspaceId, featureId });
      audit(created, 'feature.created');
      return created;
    }
    const existing = read({ workspaceId, featureId });
    if (expectedRevision !== undefined && existing.revision !== expectedRevision)
      throw new Error('Stale feature revision');
    if (existing.status === 'archived') {
      db.prepare('UPDATE features SET status=? WHERE id=?').run('active', featureId);
      advance(existing);
      const reopened = read({ workspaceId, featureId });
      audit(reopened, 'feature.updated');
      return reopened;
    }
    return existing;
  };
  const insertAssignment = (feature: WorkspaceFeature, terminalId: string): WorkspaceFeature => {
    if (feature.terminalIds.length >= 8) throw new Error('Feature terminal capacity exceeded');
    // A stable terminal belongs to one Feature. No move/adoption/reassignment from metadata.
    if (
      db.prepare('SELECT 1 FROM feature_terminal_assignments WHERE terminal_id=?').get(terminalId)
    )
      throw new Error('Terminal already assigned to a Feature');
    db.prepare(
      `INSERT INTO feature_terminal_displays (terminal_id,workspace_id,ordinal)
       SELECT ?, ?, COALESCE(MAX(ordinal),0)+1 FROM feature_terminal_displays WHERE workspace_id=?`,
    ).run(terminalId, feature.workspaceId, feature.workspaceId);
    db.prepare('INSERT INTO feature_terminal_assignments VALUES (?,?)').run(
      terminalId,
      feature.featureId,
    );
    if (feature.terminalIds.length)
      openTerminalLayouts(db, transaction, feature.featureId).appendFeatureMember(
        feature.terminalIds,
        terminalId,
      );
    advance(feature);
    const after = read({ workspaceId: feature.workspaceId, featureId: feature.featureId });
    audit(after, 'feature.terminal_added', terminalId);
    return after;
  };
  const releasedTerminal = (scope: FeatureScope, terminalId: string) => {
    const feature = read(scope);
    z.uuid().parse(terminalId);
    if (!feature.terminalIds.includes(terminalId)) return;
    const row = db
      .prepare(
        `SELECT released_epoch,released_manifest FROM feature_terminal_displays
       WHERE terminal_id=? AND workspace_id=? AND replaced_by IS NULL AND removed_at IS NULL`,
      )
      .get(terminalId, scope.workspaceId);
    if (typeof row?.released_manifest !== 'string') return;
    return {
      epoch: z.uuid().parse(row.released_epoch),
      file: z.string().startsWith('/').max(2048).parse(row.released_manifest),
    };
  };
  const checkMembershipRevision = (scope: FeatureScope, expectedRevision: number) => {
    const feature = read(scope);
    if (feature.revision !== expectedRevision) throw new Error('Stale feature revision');
    if (feature.status === 'archived') throw new Error('Archived feature');
    return feature;
  };
  return {
    read,
    readView,
    readAssignmentScope: (workspaceId: string) =>
      transaction(() => {
        const view = readView(workspaceId);
        return { view, target: readAssignmentTarget(workspaceId, view.featureId) };
      }),
    saveView: (workspaceId: string, input: unknown) =>
      transaction(() => {
        const value = featureViewSaveSchema.parse(input);
        const before = readView(workspaceId);
        if (before.revision !== value.expectedRevision)
          throw new Error('Stale feature view revision');
        if (before.revision >= Number.MAX_SAFE_INTEGER)
          throw new Error('Feature view revision exhausted');
        if (
          before.revision === 0 &&
          Number(db.prepare('SELECT COUNT(*) AS n FROM feature_views').get()?.n) >= 1024
        )
          throw new Error('Feature view capacity exceeded');
        if (value.featureId !== null) {
          if (value.featureId === defaultFeatureId(workspaceId)) ensureDefaultRow(workspaceId);
          else read({ workspaceId, featureId: value.featureId });
        }
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
        const parsedScope = featureScopeSchema.parse(scope);
        const expected = z.number().int().positive().safe().parse(expectedRevision);
        const feature =
          parsedScope.featureId === defaultFeatureId(parsedScope.workspaceId)
            ? ensureDefaultRow(parsedScope.workspaceId, DEFAULT_FEATURE_NAME, expected)
            : (() => {
                const existing = read(parsedScope);
                if (existing.revision !== expected) throw new Error('Stale feature revision');
                if (existing.status === 'archived') throw new Error('Archived feature');
                return existing;
              })();
        return insertAssignment(feature, terminalId);
      }),
    releasedTerminal,
    /** Trusted Core callback after the original owned slot has been fenced. */
    recordTerminalRelease: (
      workspaceId: string,
      terminalId: string,
      manifest: string,
      epoch: string,
    ) =>
      transaction(() => {
        featureScopeSchema.shape.workspaceId.parse(workspaceId);
        z.uuid().parse(terminalId);
        z.uuid().parse(epoch);
        z.string().startsWith('/').max(2048).parse(manifest);
        const row = db
          .prepare(
            `SELECT released_manifest,released_epoch FROM feature_terminal_displays
           WHERE terminal_id=? AND workspace_id=? AND replaced_by IS NULL AND removed_at IS NULL`,
          )
          .get(terminalId, workspaceId);
        if (!row) return;
        if (
          row.released_epoch &&
          (row.released_epoch !== epoch || row.released_manifest !== manifest)
        )
          throw new Error('Terminal release evidence changed');
        db.prepare(
          'UPDATE feature_terminal_displays SET released_manifest=?,released_epoch=? WHERE terminal_id=?',
        ).run(manifest, epoch, terminalId);
      }),
    replaceReleasedTerminal: (
      scope: FeatureScope,
      terminalId: string,
      replacementId: string,
      expected: { viewRevision: number; featureRevision: number },
    ) =>
      transaction(() => {
        z.uuid().parse(replacementId);
        const before = checkMembershipRevision(scope, expected.featureRevision);
        const view = readView(scope.workspaceId);
        if (
          view.featureId !== scope.featureId ||
          view.revision !== expected.viewRevision ||
          !releasedTerminal(scope, terminalId)
        )
          throw new Error('Released terminal scope changed');
        const layouts = openTerminalLayouts(db, transaction, scope.featureId);
        const previousLayout = layouts.read(before.terminalIds) ?? null;
        const teams = openTerminalTeams(db, transaction, scope.featureId);
        const previousTeam = teams.read(scope.workspaceId, before.terminalIds).configuration;
        db.prepare('UPDATE feature_terminal_displays SET replaced_by=? WHERE terminal_id=?').run(
          replacementId,
          terminalId,
        );
        db.prepare(
          `INSERT INTO feature_terminal_displays (terminal_id,workspace_id,ordinal)
           SELECT ?,workspace_id,ordinal FROM feature_terminal_displays WHERE terminal_id=?`,
        ).run(replacementId, terminalId);
        if (before.orchestratorTerminalId === terminalId)
          db.prepare('DELETE FROM feature_orchestrator_labels WHERE feature_id=?').run(
            scope.featureId,
          );
        db.prepare('UPDATE feature_terminal_assignments SET terminal_id=? WHERE terminal_id=?').run(
          replacementId,
          terminalId,
        );
        if (before.orchestratorTerminalId === terminalId)
          db.prepare('INSERT INTO feature_orchestrator_labels VALUES (?,?)').run(
            scope.featureId,
            replacementId,
          );
        const replace = (id: string) => (id === terminalId ? replacementId : id);
        const replacementMembers = before.terminalIds.map(replace);
        if (previousTeam) {
          teams.save(scope.workspaceId, replacementMembers, {
            expectedRevision: 0,
            configuration: {
              ...previousTeam,
              members: previousTeam.members.map((member) =>
                member.terminalId === terminalId
                  ? {
                      ...member,
                      terminalId: replacementId,
                      role: 'worker',
                      allowedTargetTerminalIds: [],
                    }
                  : {
                      ...member,
                      allowedTargetTerminalIds: member.allowedTargetTerminalIds.filter(
                        (id) => id !== terminalId,
                      ),
                    },
              ),
            },
          });
        }
        if (previousLayout)
          layouts.save(replacementMembers, {
            ...previousLayout,
            order: previousLayout.order.map(replace),
            shown: previousLayout.shown.map(replace),
            active: replace(previousLayout.active),
            maximized: previousLayout.maximized && replace(previousLayout.maximized),
            names: previousLayout.names.map(({ id, name }) => ({ id: replace(id), name })),
          });
        advance(before);
        const feature = read(scope);
        audit(feature, 'feature.terminal_reopened', replacementId);
        return { feature, view, previousLayout: layouts.read(feature.terminalIds) ?? null };
      }),
    removeReleasedTerminal: (scope: FeatureScope, terminalId: string, expectedRevision: number) =>
      transaction(() => {
        const before = checkMembershipRevision(scope, expectedRevision);
        if (!releasedTerminal(scope, terminalId))
          throw new Error('Terminal release is unconfirmed');
        const layouts = openTerminalLayouts(db, transaction, scope.featureId);
        const previous = layouts.read(before.terminalIds);
        db.prepare(
          'DELETE FROM feature_orchestrator_labels WHERE feature_id=? AND terminal_id=?',
        ).run(scope.featureId, terminalId);
        db.prepare(
          'DELETE FROM feature_terminal_assignments WHERE feature_id=? AND terminal_id=?',
        ).run(scope.featureId, terminalId);
        db.prepare('UPDATE feature_terminal_displays SET removed_at=? WHERE terminal_id=?').run(
          now(),
          terminalId,
        );
        const keep = (id: string) => id !== terminalId;
        const remaining = before.terminalIds.filter(keep);
        if (previous && remaining.length) {
          const order = previous.order.filter(keep);
          const shown = previous.shown.filter(keep);
          layouts.save(remaining, {
            ...previous,
            order,
            shown,
            active: keep(previous.active) ? previous.active : (shown[0] ?? order[0]!),
            maximized: previous.maximized === terminalId ? null : previous.maximized,
            names: previous.names.filter(({ id }) => keep(id)),
          });
        }
        advance(before);
        const feature = read(scope);
        audit(feature, 'feature.terminal_removed', terminalId);
        return feature;
      }),
    assignToOpenOrDefault: (
      workspaceId: string,
      requestedFeatureId: string | null,
      terminalIds: readonly string[],
      options?: {
        defaultName?: string;
        expected?: { viewRevision: number; featureRevision: number | null };
      },
    ) =>
      transaction(() => {
        featureScopeSchema.shape.workspaceId.parse(workspaceId);
        const ids = z
          .array(z.uuid())
          .min(1)
          .max(8)
          .refine((list) => new Set(list).size === list.length)
          .parse(terminalIds);
        const beforeView = readView(workspaceId);
        const expected = options?.expected;
        if (expected) {
          if (
            beforeView.featureId !== requestedFeatureId ||
            beforeView.revision !== expected.viewRevision
          )
            throw new Error('Stale feature view revision');
          const target = readAssignmentTarget(workspaceId, requestedFeatureId);
          if ((target?.revision ?? null) !== expected.featureRevision)
            throw new Error('Stale feature revision');
        }
        let feature =
          requestedFeatureId === null
            ? ensureDefaultRow(workspaceId, options?.defaultName ?? DEFAULT_FEATURE_NAME)
            : (() => {
                const existing = read({
                  workspaceId,
                  featureId: z.uuid().parse(requestedFeatureId),
                });
                if (existing.status === 'archived') throw new Error('Archived feature');
                return existing;
              })();
        const previousLayout = feature.terminalIds.length
          ? (openTerminalLayouts(db, transaction, feature.featureId).read(feature.terminalIds) ??
            null)
          : null;
        for (const terminalId of ids) feature = insertAssignment(feature, terminalId);
        if (beforeView.featureId !== feature.featureId) {
          if (beforeView.revision >= Number.MAX_SAFE_INTEGER)
            throw new Error('Feature view revision exhausted');
          if (
            beforeView.revision === 0 &&
            Number(db.prepare('SELECT COUNT(*) AS n FROM feature_views').get()?.n) >= 1024
          )
            throw new Error('Feature view capacity exceeded');
          db.prepare(
            `INSERT INTO feature_views VALUES (?,?,?) ON CONFLICT(workspace_id)
          DO UPDATE SET feature_id=excluded.feature_id, revision=excluded.revision`,
          ).run(workspaceId, feature.featureId, beforeView.revision + 1);
        }
        return { feature, view: readView(workspaceId), previousLayout };
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
