//! Port of `openFeaturePermissions` (`packages/database/src/feature-permissions.ts`).
use rusqlite::{params, OptionalExtension};

use super::error::{refused, FeatureError, Result};
use super::features::Features;
use super::model::*;

const BYTES: usize = 16384;
const POLICY_LIMIT: u64 = 1024;
const AUDIT_LIMIT: u64 = 32768;

const SETUP: &str = "CREATE TABLE IF NOT EXISTS feature_permission_schema (
      singleton INTEGER PRIMARY KEY CHECK(singleton=1), version INTEGER NOT NULL
    ); INSERT OR IGNORE INTO feature_permission_schema VALUES (1,1);";
const TABLES: &str = "CREATE TABLE IF NOT EXISTS feature_permissions (
      feature_id TEXT PRIMARY KEY REFERENCES features(id), workspace_id TEXT NOT NULL,
      revision INTEGER NOT NULL CHECK(revision>0),
      metadata TEXT NOT NULL CHECK(json_valid(metadata) AND length(metadata)<=16384)
    ); CREATE INDEX IF NOT EXISTS feature_permissions_workspace ON feature_permissions(workspace_id);
    CREATE TABLE IF NOT EXISTS feature_permission_events (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT, workspace_id TEXT NOT NULL,
      feature_id TEXT NOT NULL REFERENCES features(id),
      metadata TEXT NOT NULL CHECK(json_valid(metadata) AND length(metadata)<=32768)
    ); CREATE INDEX IF NOT EXISTS feature_permission_events_feature ON feature_permission_events(feature_id,sequence);";

fn conflict(message: &str) -> FeatureError {
    FeatureError::Conflict(message.into())
}

pub struct FeaturePermissions<'a> {
    features: Features<'a>,
}

impl<'a> FeaturePermissions<'a> {
    pub fn open(features: Features<'a>) -> Result<Self> {
        features.db.ensure_extension(
            SETUP,
            "feature_permission_schema",
            TABLES,
            "Feature permission",
        )?;
        Ok(Self { features })
    }

    fn check_version(&self) -> Result<()> {
        let version: Option<i64> = self
            .features
            .db
            .conn
            .query_row(
                "SELECT version FROM feature_permission_schema WHERE singleton=1",
                [],
                |r| r.get(0),
            )
            .optional()?;
        if version != Some(1) {
            return Err(refused("Unsupported Feature permission schema"));
        }
        Ok(())
    }

    fn scope_feature(&self, workspace_id: &str, feature_id: &str) -> Result<WorkspaceFeature> {
        self.check_version()?;
        check_scope(workspace_id, feature_id)?;
        let feature = self.features.read(workspace_id, feature_id)?;
        if feature.status == FeatureStatus::Archived {
            return Err(refused("Archived Feature permission scope"));
        }
        Ok(feature)
    }

    fn members(ids: &[String], configuration: Option<&PermissionConfiguration>) -> Result<()> {
        if configuration.is_some_and(|c| {
            c.rules.iter().any(|r| {
                !ids.contains(&r.source_terminal_id) || !ids.contains(&r.target_terminal_id)
            })
        }) {
            return Err(refused("Foreign Feature permission terminal"));
        }
        Ok(())
    }

    fn read_inner(&self, workspace_id: &str, feature_id: &str) -> Result<FeaturePermissionState> {
        let feature = self.scope_feature(workspace_id, feature_id)?;
        let db = self.features.db;
        if db.count("SELECT COUNT(*) AS n FROM feature_permissions")? >= POLICY_LIMIT
            || db.count("SELECT COUNT(*) AS n FROM feature_permission_events")? >= AUDIT_LIMIT
        {
            return Err(refused("Feature permission capacity exceeded"));
        }
        let row: Option<(String, i64, String)> = db
            .conn
            .query_row(
                "SELECT workspace_id, revision, metadata FROM feature_permissions WHERE feature_id=?",
                [&feature.feature_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()?;
        if let Some((workspace, _, metadata)) = &row {
            if *workspace != feature.workspace_id || metadata.len() > BYTES {
                return Err(refused("Invalid Feature permission scope or size"));
            }
        }
        let (revision, configuration) = match &row {
            None => (0, None),
            Some((_, revision, metadata)) => {
                let value: serde_json::Value = serde_json::from_str(metadata)
                    .map_err(|_| super::error::invalid("Invalid permission policy"))?;
                let configuration: PermissionConfiguration = parse(&value, "permission policy")?;
                configuration.validate()?;
                if *revision < 0 {
                    return Err(super::error::invalid("Invalid permission revision"));
                }
                (check_safe(*revision as u64, false)?, Some(configuration))
            }
        };
        if (revision == 0) != configuration.is_none() {
            return Err(super::error::invalid("Invalid Feature permission revision"));
        }
        let state = FeaturePermissionState {
            workspace_id: feature.workspace_id.clone(),
            feature_id: feature.feature_id.clone(),
            schema_version: 1,
            revision,
            configuration,
        };
        Self::members(&feature.terminal_ids, state.configuration.as_ref())?;
        let latest: Option<(i64, String, String)> = db
            .conn
            .query_row(
                "SELECT sequence, workspace_id, metadata FROM feature_permission_events
      WHERE feature_id=? ORDER BY sequence DESC LIMIT 1",
                [&feature.feature_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()?;
        if row.is_some() != latest.is_some() {
            return Err(refused("Feature permission audit missing"));
        }
        let audit_count: i64 = db.conn.query_row(
            "SELECT COUNT(*) AS n FROM feature_permission_events WHERE feature_id=?",
            [&feature.feature_id],
            |r| r.get(0),
        )?;
        if audit_count as u64 != state.revision {
            return Err(refused("Feature permission audit history incomplete"));
        }
        if let Some((_, workspace, metadata)) = latest {
            if metadata.len() > 32768 {
                return Err(refused("Feature permission audit too large"));
            }
            let event = PermissionEventRead::parse(&metadata)?;
            if workspace != feature.workspace_id
                || event.workspace_id != feature.workspace_id
                || event.feature_id != feature.feature_id
                || event.revision != state.revision
                || to_json(&event.configuration)? != to_json(&state.configuration)?
            {
                return Err(refused("Feature permission audit inconsistent"));
            }
        }
        Ok(state)
    }

    pub fn read(&self, workspace_id: &str, feature_id: &str) -> Result<FeaturePermissionState> {
        self.features
            .db
            .transaction(|| self.read_inner(workspace_id, feature_id))
    }

    pub fn save(
        &self,
        workspace_id: &str,
        feature_id: &str,
        actor_id: &str,
        input: &FeaturePermissionSave,
    ) -> Result<FeaturePermissionState> {
        let db = self.features.db;
        db.transaction(|| {
            let feature = self.scope_feature(workspace_id, feature_id)?;
            if input.expected_feature_revision.is_some_and(|r| r != feature.revision) {
                return Err(conflict("Stale Feature permission scope"));
            }
            if let Some(expected) = input.expected_view_revision {
                let view = self.features.read_view(&feature.workspace_id)?;
                if view.revision != expected || view.feature_id.as_deref() != Some(feature.feature_id.as_str()) {
                    return Err(conflict("Stale active Feature view"));
                }
            }
            Self::members(&feature.terminal_ids, Some(&input.configuration))?;
            let before = self.read_inner(workspace_id, feature_id)?;
            if before.revision != input.expected_revision {
                return Err(conflict("Stale Feature permission revision"));
            }
            if input.expected_revision >= MAX_SAFE {
                return Err(refused("Feature permission revision limit exceeded"));
            }
            let metadata = to_json(&input.configuration)?;
            if metadata.len() > BYTES {
                return Err(refused("Feature permission policy too large"));
            }
            let revision = before.revision + 1;
            let event = PermissionEventWrite {
                schema_version: 1,
                workspace_id: &feature.workspace_id,
                feature_id: &feature.feature_id,
                timestamp: (self.features.env.now)(),
                actor_id,
                action: "feature.permissions.updated",
                previous_revision: before.revision,
                revision,
                previous_configuration: &before.configuration,
                configuration: &input.configuration,
                review_digest: input.review_digest.as_deref(),
            };
            let audit = to_json(&event)?;
            if audit.len() > 32768 {
                return Err(refused("Feature permission audit too large"));
            }
            // Node validates the event (actor id pattern) right after the inserts, inside the
            // transaction; refusing before writing has the same durable outcome.
            check_safe(event.timestamp, false)?;
            if !is_identifier(actor_id) {
                return Err(super::error::invalid("Invalid permission actor"));
            }
            db.conn.execute(
                "INSERT INTO feature_permissions VALUES (?,?,?,?) ON CONFLICT(feature_id)
        DO UPDATE SET revision=excluded.revision, metadata=excluded.metadata",
                params![feature.feature_id, feature.workspace_id, revision as i64, metadata],
            )?;
            db.conn.execute(
                "INSERT INTO feature_permission_events(workspace_id, feature_id, metadata) VALUES (?,?,?)",
                params![feature.workspace_id, feature.feature_id, audit],
            )?;
            // A saturated store denies even reads; returning through read also rolls back a
            // saturating save.
            self.read_inner(workspace_id, feature_id)
        })
    }
}
