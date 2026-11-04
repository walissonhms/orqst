import { z } from 'zod';
import type { DatabaseSync } from 'node:sqlite';
import {
  featureScopeSchema,
  terminalTeamSaveSchema,
  terminalTeamStateSchema,
  type TerminalTeamSave,
} from '@orqst/protocol';
import { stableId } from '@orqst/shared';

/** Opt-in metadata extension of Store. Never opens communication/terminal journals. */
export function openTerminalTeams(
  db: DatabaseSync,
  transaction: <T>(action: () => T) => T,
  featureId?: string,
) {
  if (featureId !== undefined) z.uuid().parse(featureId);
  transaction(() => {
    db.exec(`CREATE TABLE IF NOT EXISTS terminal_team_schema (
      singleton INTEGER PRIMARY KEY CHECK(singleton=1), version INTEGER NOT NULL
    ); INSERT OR IGNORE INTO terminal_team_schema VALUES (1,1);`);
    if (
      db.prepare('SELECT version FROM terminal_team_schema WHERE singleton=1').get()?.version !== 1
    )
      throw new Error('Unsupported terminal team schema');
    db.exec(`CREATE TABLE IF NOT EXISTS terminal_teams (
      selection_id TEXT PRIMARY KEY, revision INTEGER NOT NULL CHECK(revision>0),
      metadata TEXT NOT NULL CHECK(length(metadata)<=16384 AND json_valid(metadata))
    )`);
  });
  const key = (workspaceId: string, ids: string[]) => {
    // Reuse the strict domain validator for UUID/duplicate/count checks.
    terminalTeamSaveSchema.parse({
      expectedRevision: 0,
      configuration: {
        version: 1,
        name: 'Selection',
        members: ids.map((id, index) => ({
          terminalId: id,
          name: 'Member',
          handle: `terminal-${index}`,
          role: 'worker',
          allowedTargetTerminalIds: [],
        })),
      },
    });
    featureScopeSchema.shape.workspaceId.parse(workspaceId);
    return featureId === undefined
      ? stableId('terminal-team', workspaceId, JSON.stringify([...ids].sort()))
      : stableId('terminal-team-feature', workspaceId, featureId, JSON.stringify([...ids].sort()));
  };
  const read = (workspaceId: string, ids: string[]) => {
    const row = db
      .prepare('SELECT revision, metadata FROM terminal_teams WHERE selection_id=?')
      .get(key(workspaceId, ids));
    if (!row) return terminalTeamStateSchema.parse({ revision: 0, configuration: null });
    if (Buffer.byteLength(String(row.metadata)) > 16384) throw new Error('Team too large');
    const state = terminalTeamStateSchema.parse({
      revision: row.revision,
      configuration: JSON.parse(String(row.metadata)),
    });
    if (
      key(
        workspaceId,
        state.configuration!.members.map((m) => m.terminalId),
      ) !== key(workspaceId, ids)
    )
      throw new Error('Invalid team selection');
    return state;
  };
  return {
    read,
    save: (workspaceId: string, ids: string[], raw: TerminalTeamSave) =>
      transaction(() => {
        const { expectedRevision, configuration } = terminalTeamSaveSchema.parse(raw);
        const selection = key(workspaceId, ids);
        if (
          key(
            workspaceId,
            configuration.members.map((m) => m.terminalId),
          ) !== selection
        )
          throw new Error('Invalid team selection');
        const text = JSON.stringify(configuration);
        if (Buffer.byteLength(text) > 16384) throw new Error('Team too large');
        const before = read(workspaceId, ids);
        if (before.revision !== expectedRevision || expectedRevision >= Number.MAX_SAFE_INTEGER)
          throw new Error('Stale team configuration');
        if (
          !before.configuration &&
          Number(db.prepare('SELECT COUNT(*) AS count FROM terminal_teams').get()?.count) >= 1024
        )
          throw new Error('Terminal team capacity exceeded');
        db.prepare(
          `INSERT INTO terminal_teams VALUES (?,?,?) ON CONFLICT(selection_id)
        DO UPDATE SET revision=excluded.revision, metadata=excluded.metadata`,
        ).run(selection, expectedRevision + 1, text);
        return read(workspaceId, ids);
      }),
  };
}
