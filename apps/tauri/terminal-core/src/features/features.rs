//! Port of `openFeatures` (`packages/database/src/features.ts`). Additive metadata only.
use rusqlite::{params, OptionalExtension};

use super::error::{refused, Result};
use super::model::*;
use super::store::Db;

/// Clock and id source; injectable so golden tests are deterministic.
pub struct Env {
    pub now: Box<dyn Fn() -> u64 + Send + Sync>,
    pub new_id: Box<dyn Fn() -> String + Send + Sync>,
}

impl Default for Env {
    fn default() -> Self {
        Self {
            now: Box::new(super::store::now_ms),
            new_id: Box::new(|| uuid::Uuid::new_v4().to_string()),
        }
    }
}

const FEATURE_SETUP: &str = "CREATE TABLE IF NOT EXISTS feature_configuration_schema (
      singleton INTEGER PRIMARY KEY CHECK(singleton=1), version INTEGER NOT NULL
    ); INSERT OR IGNORE INTO feature_configuration_schema VALUES (1,1);";
const FEATURE_TABLES: &str = "CREATE TABLE IF NOT EXISTS features (
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
    );";
const VIEW_SETUP: &str = "CREATE TABLE IF NOT EXISTS feature_view_schema (
      singleton INTEGER PRIMARY KEY CHECK(singleton=1), version INTEGER NOT NULL
    ); INSERT OR IGNORE INTO feature_view_schema VALUES (1,1);";
const VIEW_TABLES: &str = "CREATE TABLE IF NOT EXISTS feature_views (
      workspace_id TEXT PRIMARY KEY, feature_id TEXT REFERENCES features(id), revision INTEGER NOT NULL
    );";

fn nonneg(value: i64) -> Result<u64> {
    if value < 0 {
        return Err(invalid_row());
    }
    check_safe(value as u64, false)
}
fn invalid_row() -> super::error::FeatureError {
    super::error::invalid("Invalid feature row")
}

pub struct Features<'a> {
    pub db: &'a Db,
    pub env: &'a Env,
}

impl<'a> Features<'a> {
    /// `store.features()`: table setup on every open, like Node.
    pub fn open(db: &'a Db, env: &'a Env) -> Result<Self> {
        db.ensure_extension(
            FEATURE_SETUP,
            "feature_configuration_schema",
            FEATURE_TABLES,
            "feature configuration",
        )?;
        db.ensure_extension(
            VIEW_SETUP,
            "feature_view_schema",
            VIEW_TABLES,
            "feature view",
        )?;
        Ok(Self { db, env })
    }

    pub fn read_view(&self, workspace_id: &str) -> Result<FeatureViewState> {
        if !is_identifier(workspace_id) {
            return Err(super::error::invalid("Invalid workspace"));
        }
        let row: Option<(Option<String>, i64)> = self
            .db
            .conn
            .query_row(
                "SELECT feature_id, revision FROM feature_views WHERE workspace_id=?",
                [workspace_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?;
        let (feature_id, revision) = row.unwrap_or((None, 0));
        if feature_id.as_deref().is_some_and(|id| !is_uuid(id)) {
            return Err(invalid_row());
        }
        Ok(FeatureViewState {
            contract_version: 1,
            storage: "core",
            workspace_id: workspace_id.to_owned(),
            feature_id,
            revision: nonneg(revision)?,
        })
    }

    pub fn read(&self, workspace_id: &str, feature_id: &str) -> Result<WorkspaceFeature> {
        check_scope(workspace_id, feature_id)?;
        let conn = &self.db.conn;
        let row = conn
            .query_row(
                "SELECT id, workspace_id, name, description, status, revision, created_at, updated_at FROM features WHERE id=? AND workspace_id=?",
                [feature_id, workspace_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, String>(4)?,
                        row.get::<_, i64>(5)?,
                        row.get::<_, i64>(6)?,
                        row.get::<_, i64>(7)?,
                    ))
                },
            )
            .optional()?;
        let Some((id, workspace, name, description, status, revision, created, updated)) = row
        else {
            return Err(refused("Feature unavailable in workspace"));
        };
        let mut statement =
            conn.prepare("SELECT terminal_id FROM feature_terminal_assignments WHERE feature_id=? ORDER BY rowid")?;
        let terminal_ids = statement
            .query_map([feature_id], |row| row.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let orchestrator: Option<String> = conn
            .query_row(
                "SELECT terminal_id FROM feature_orchestrator_labels WHERE feature_id=?",
                [feature_id],
                |row| row.get(0),
            )
            .optional()?;
        let feature = WorkspaceFeature {
            workspace_id: workspace,
            feature_id: id,
            schema_version: 1,
            name,
            description,
            status: FeatureStatus::parse(&status)?,
            revision: nonneg(revision)?,
            terminal_ids,
            orchestrator_terminal_id: orchestrator,
            created_at: nonneg(created)?,
            updated_at: nonneg(updated)?,
        };
        feature.validate()?;
        Ok(feature)
    }

    fn audit(
        &self,
        feature: &WorkspaceFeature,
        action: &'static str,
        terminal_id: Option<&str>,
    ) -> Result<()> {
        if self
            .db
            .count("SELECT COUNT(*) AS count FROM feature_configuration_events")?
            >= 32768
        {
            return Err(refused("Feature audit capacity exceeded"));
        }
        let event = FeatureConfigurationEvent {
            workspace_id: &feature.workspace_id,
            feature_id: &feature.feature_id,
            schema_version: 1,
            action,
            revision: feature.revision,
            timestamp: feature.updated_at,
            terminal_id,
        };
        self.db.conn.execute(
            "INSERT INTO feature_configuration_events(metadata) VALUES (?)",
            [to_json(&event)?],
        )?;
        Ok(())
    }

    fn advance(&self, feature: &WorkspaceFeature) -> Result<()> {
        if feature.revision >= MAX_SAFE {
            return Err(refused("Feature revision exhausted"));
        }
        self.db.conn.execute(
            "UPDATE features SET revision=revision+1, updated_at=? WHERE id=?",
            params![(self.env.now)() as i64, feature.feature_id],
        )?;
        Ok(())
    }

    pub fn save_view(
        &self,
        workspace_id: &str,
        input: &FeatureViewSave,
    ) -> Result<FeatureViewState> {
        self.db.transaction(|| {
            let before = self.read_view(workspace_id)?;
            if before.revision != input.expected_revision {
                return Err(refused("Stale feature view revision"));
            }
            if before.revision >= MAX_SAFE {
                return Err(refused("Feature view revision exhausted"));
            }
            if let Some(feature_id) = &input.feature_id {
                self.read(workspace_id, feature_id)?;
            }
            if before.revision == 0
                && self.db.count("SELECT COUNT(*) AS n FROM feature_views")? >= 1024
            {
                return Err(refused("Feature view capacity exceeded"));
            }
            self.db.conn.execute(
                "INSERT INTO feature_views VALUES (?,?,?) ON CONFLICT(workspace_id)
        DO UPDATE SET feature_id=excluded.feature_id, revision=excluded.revision",
                params![workspace_id, input.feature_id, (before.revision + 1) as i64],
            )?;
            self.read_view(workspace_id)
        })
    }

    pub fn list(&self, workspace_id: &str) -> Result<Vec<WorkspaceFeature>> {
        if !is_identifier(workspace_id) {
            return Err(super::error::invalid("Invalid workspace"));
        }
        let mut statement = self
            .db
            .conn
            .prepare("SELECT id FROM features WHERE workspace_id=? ORDER BY rowid")?;
        let ids = statement
            .query_map([workspace_id], |row| row.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        ids.iter().map(|id| self.read(workspace_id, id)).collect()
    }

    pub fn create(&self, workspace_id: &str, input: &FeatureCreate) -> Result<WorkspaceFeature> {
        self.db.transaction(|| {
            if !is_identifier(workspace_id) {
                return Err(super::error::invalid("Invalid workspace"));
            }
            if self.db.count("SELECT COUNT(*) AS count FROM features")? >= 1024 {
                return Err(refused("Feature capacity exceeded"));
            }
            let feature_id = (self.env.new_id)();
            let timestamp = (self.env.now)() as i64;
            self.db.conn.execute(
                "INSERT INTO features VALUES (?,?,?,?,?,?,?,?)",
                params![
                    feature_id,
                    workspace_id,
                    input.name,
                    input.description,
                    input.status.as_str(),
                    1,
                    timestamp,
                    timestamp
                ],
            )?;
            let feature = self.read(workspace_id, &feature_id)?;
            self.audit(&feature, "feature.created", None)?;
            Ok(feature)
        })
    }

    pub fn update(
        &self,
        workspace_id: &str,
        feature_id: &str,
        input: &FeatureUpdate,
    ) -> Result<WorkspaceFeature> {
        self.db.transaction(|| {
            let before = self.read(workspace_id, feature_id)?;
            if before.revision != input.expected_revision {
                return Err(refused("Stale feature revision"));
            }
            if let Some(Some(id)) = &input.orchestrator_terminal_id {
                if !before.terminal_ids.contains(id) {
                    return Err(refused("Orchestrator must be a member of the Feature"));
                }
            }
            // Native active-work/archive decisions are not implemented here; never guess them.
            if input.status == Some(FeatureStatus::Archived) && !before.terminal_ids.is_empty() {
                return Err(refused(
                    "Feature with assigned terminals requires lifecycle review before archive",
                ));
            }
            self.db.conn.execute(
                "UPDATE features SET name=?, description=?, status=? WHERE id=?",
                params![
                    input.name.as_deref().unwrap_or(&before.name),
                    input.description.as_deref().unwrap_or(&before.description),
                    input.status.unwrap_or(before.status).as_str(),
                    before.feature_id
                ],
            )?;
            if let Some(orchestrator) = &input.orchestrator_terminal_id {
                self.db.conn.execute(
                    "DELETE FROM feature_orchestrator_labels WHERE feature_id=?",
                    [&before.feature_id],
                )?;
                if let Some(id) = orchestrator {
                    self.db.conn.execute(
                        "INSERT INTO feature_orchestrator_labels VALUES (?,?)",
                        [&before.feature_id, id],
                    )?;
                }
            }
            self.advance(&before)?;
            let after = self.read(workspace_id, feature_id)?;
            let action = if input.status == Some(FeatureStatus::Archived) {
                "feature.archived"
            } else {
                "feature.updated"
            };
            self.audit(&after, action, None)?;
            Ok(after)
        })
    }

    pub fn assign_terminal(
        &self,
        workspace_id: &str,
        feature_id: &str,
        terminal_id: &str,
        expected_revision: u64,
    ) -> Result<WorkspaceFeature> {
        self.db.transaction(|| {
            if !is_uuid(terminal_id) {
                return Err(super::error::invalid("Invalid terminal"));
            }
            let feature = self.read(workspace_id, feature_id)?;
            check_safe(expected_revision, true)?;
            if feature.revision != expected_revision {
                return Err(refused("Stale feature revision"));
            }
            if feature.status == FeatureStatus::Archived {
                return Err(refused("Archived feature"));
            }
            if feature.terminal_ids.len() >= 8 {
                return Err(refused("Feature terminal capacity exceeded"));
            }
            // A stable terminal belongs to one Feature. No move/adoption/reassignment.
            let assigned: Option<i64> = self
                .db
                .conn
                .query_row(
                    "SELECT 1 FROM feature_terminal_assignments WHERE terminal_id=?",
                    [terminal_id],
                    |row| row.get(0),
                )
                .optional()?;
            if assigned.is_some() {
                return Err(refused("Terminal already assigned to a Feature"));
            }
            self.db.conn.execute(
                "INSERT INTO feature_terminal_assignments VALUES (?,?)",
                [terminal_id, &feature.feature_id],
            )?;
            self.advance(&feature)?;
            let after = self.read(workspace_id, feature_id)?;
            self.audit(&after, "feature.terminal_added", Some(terminal_id))?;
            Ok(after)
        })
    }
}
