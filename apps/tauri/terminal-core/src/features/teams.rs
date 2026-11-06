//! Ports of `openTerminalTeams` and `openTerminalLayouts` (`packages/database/src`).
use rusqlite::{params, OptionalExtension};

use super::error::{invalid, refused, Result};
use super::model::*;
use super::store::Db;

const TEAM_SETUP: &str = "CREATE TABLE IF NOT EXISTS terminal_team_schema (
      singleton INTEGER PRIMARY KEY CHECK(singleton=1), version INTEGER NOT NULL
    ); INSERT OR IGNORE INTO terminal_team_schema VALUES (1,1);";
const TEAM_TABLES: &str = "CREATE TABLE IF NOT EXISTS terminal_teams (
      selection_id TEXT PRIMARY KEY, revision INTEGER NOT NULL CHECK(revision>0),
      metadata TEXT NOT NULL CHECK(length(metadata)<=16384 AND json_valid(metadata))
    )";
const LAYOUT_SETUP: &str = "
      CREATE TABLE IF NOT EXISTS terminal_layout_schema (
        singleton INTEGER PRIMARY KEY CHECK(singleton=1), version INTEGER NOT NULL
      );
      INSERT OR IGNORE INTO terminal_layout_schema VALUES (1,1);
    ";
const LAYOUT_TABLES: &str = "CREATE TABLE IF NOT EXISTS terminal_layouts (
      selection_id TEXT PRIMARY KEY,
      metadata TEXT NOT NULL CHECK(length(metadata)<=16384 AND json_valid(metadata))
    )";
pub const LAYOUT_RECORDS: u64 = 1024;
pub const LAYOUT_BYTES: usize = 16 * 1024;

/// Membership check shared by team keys: 1..8 unique UUIDs (the strict team validator).
fn check_selection(ids: &[String]) -> Result<()> {
    if ids.is_empty() || !valid_ids(ids) {
        return Err(invalid("Invalid terminal selection"));
    }
    Ok(())
}

pub struct TerminalTeams<'a> {
    db: &'a Db,
    feature_id: Option<String>,
}

impl<'a> TerminalTeams<'a> {
    pub fn open(db: &'a Db, feature_id: Option<&str>) -> Result<Self> {
        if feature_id.is_some_and(|id| !is_uuid(id)) {
            return Err(invalid("Invalid feature"));
        }
        db.ensure_extension(
            TEAM_SETUP,
            "terminal_team_schema",
            TEAM_TABLES,
            "terminal team",
        )?;
        Ok(Self {
            db,
            feature_id: feature_id.map(str::to_owned),
        })
    }

    fn key(&self, workspace_id: &str, ids: &[String]) -> Result<String> {
        check_selection(ids)?;
        if !is_identifier(workspace_id) {
            return Err(invalid("Invalid workspace"));
        }
        let sorted = sorted_ids_json(ids);
        Ok(match &self.feature_id {
            None => stable_id(&["terminal-team", workspace_id, &sorted]),
            Some(feature) => stable_id(&["terminal-team-feature", workspace_id, feature, &sorted]),
        })
    }

    pub fn read(&self, workspace_id: &str, ids: &[String]) -> Result<TerminalTeamState> {
        let key = self.key(workspace_id, ids)?;
        let row: Option<(i64, String)> = self
            .db
            .conn
            .query_row(
                "SELECT revision, metadata FROM terminal_teams WHERE selection_id=?",
                [&key],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        let Some((revision, metadata)) = row else {
            return Ok(TerminalTeamState {
                revision: 0,
                configuration: None,
            });
        };
        if metadata.len() > 16384 {
            return Err(refused("Team too large"));
        }
        let value: serde_json::Value =
            serde_json::from_str(&metadata).map_err(|_| invalid("Invalid team"))?;
        let configuration: TerminalTeam = parse(&value, "team")?;
        configuration.validate()?;
        if revision < 0 {
            return Err(invalid("Invalid team revision"));
        }
        let state = TerminalTeamState {
            revision: check_safe(revision as u64, false)?,
            configuration: Some(configuration),
        };
        let members: Vec<String> = state
            .configuration
            .as_ref()
            .map(|c| c.members.iter().map(|m| m.terminal_id.clone()).collect())
            .unwrap_or_default();
        if self.key(workspace_id, &members)? != key {
            return Err(refused("Invalid team selection"));
        }
        Ok(state)
    }

    pub fn save(
        &self,
        workspace_id: &str,
        ids: &[String],
        input: &TerminalTeamSave,
    ) -> Result<TerminalTeamState> {
        self.db.transaction(|| {
            let selection = self.key(workspace_id, ids)?;
            let members: Vec<String> = input
                .configuration
                .members
                .iter()
                .map(|m| m.terminal_id.clone())
                .collect();
            if self.key(workspace_id, &members)? != selection {
                return Err(refused("Invalid team selection"));
            }
            let text = to_json(&input.configuration)?;
            if text.len() > 16384 {
                return Err(refused("Team too large"));
            }
            let before = self.read(workspace_id, ids)?;
            if before.revision != input.expected_revision || input.expected_revision >= MAX_SAFE {
                return Err(refused("Stale team configuration"));
            }
            if before.configuration.is_none()
                && self
                    .db
                    .count("SELECT COUNT(*) AS count FROM terminal_teams")?
                    >= 1024
            {
                return Err(refused("Terminal team capacity exceeded"));
            }
            self.db.conn.execute(
                "INSERT INTO terminal_teams VALUES (?,?,?) ON CONFLICT(selection_id)
        DO UPDATE SET revision=excluded.revision, metadata=excluded.metadata",
                params![selection, (input.expected_revision + 1) as i64, text],
            )?;
            self.read(workspace_id, ids)
        })
    }
}

pub struct TerminalLayouts<'a> {
    db: &'a Db,
    feature_id: Option<String>,
}

impl<'a> TerminalLayouts<'a> {
    pub fn open(db: &'a Db, feature_id: Option<&str>) -> Result<Self> {
        if feature_id.is_some_and(|id| !is_uuid(id)) {
            return Err(invalid("Invalid feature"));
        }
        db.ensure_extension(
            LAYOUT_SETUP,
            "terminal_layout_schema",
            LAYOUT_TABLES,
            "terminal layout",
        )?;
        Ok(Self {
            db,
            feature_id: feature_id.map(str::to_owned),
        })
    }

    fn selection(&self, ids: &[String]) -> Result<String> {
        // Validate membership without granting any runtime authority.
        if ids.is_empty() || !valid_ids(ids) {
            return Err(invalid("Invalid layout selection"));
        }
        let sorted = sorted_ids_json(ids);
        Ok(match &self.feature_id {
            None => stable_id(&["terminal-layout", &sorted]),
            Some(feature) => stable_id(&["terminal-layout-feature", feature, &sorted]),
        })
    }

    pub fn read(&self, ids: &[String]) -> Result<Option<TerminalLayoutRecord>> {
        let key = self.selection(ids)?;
        let row: Option<String> = self
            .db
            .conn
            .query_row(
                "SELECT metadata FROM terminal_layouts WHERE selection_id=?",
                [&key],
                |r| r.get(0),
            )
            .optional()?;
        let Some(text) = row else { return Ok(None) };
        if text.len() > LAYOUT_BYTES {
            return Err(refused("Layout too large"));
        }
        let value: serde_json::Value =
            serde_json::from_str(&text).map_err(|_| invalid("Invalid layout"))?;
        let record = TerminalLayoutRecord::parse(&value)?;
        if self.selection(&record.order)? != key {
            return Err(refused("Invalid layout selection"));
        }
        Ok(Some(record))
    }

    fn write(&self, ids: &[String], record: &TerminalLayoutRecord) -> Result<()> {
        record.validate()?;
        let key = self.selection(ids)?;
        if self.selection(&record.order)? != key {
            return Err(refused("Invalid layout selection"));
        }
        let text = to_json(record)?;
        if text.len() > LAYOUT_BYTES {
            return Err(refused("Layout too large"));
        }
        let exists: Option<i64> = self
            .db
            .conn
            .query_row(
                "SELECT 1 FROM terminal_layouts WHERE selection_id=?",
                [&key],
                |r| r.get(0),
            )
            .optional()?;
        if exists.is_none()
            && self
                .db
                .count("SELECT COUNT(*) AS count FROM terminal_layouts")?
                >= LAYOUT_RECORDS
        {
            return Err(refused("Terminal layout capacity exceeded"));
        }
        self.db.conn.execute(
            "INSERT INTO terminal_layouts VALUES (?,?)
      ON CONFLICT(selection_id) DO UPDATE SET metadata=excluded.metadata",
            params![key, text],
        )?;
        Ok(())
    }

    pub fn save(&self, ids: &[String], record: &TerminalLayoutRecord) -> Result<()> {
        self.db.transaction(|| self.write(ids, record))
    }

    /// First valid import wins atomically; never overwrite SQLite with a stale JSON copy.
    pub fn import(
        &self,
        ids: &[String],
        record: &TerminalLayoutRecord,
    ) -> Result<TerminalLayoutRecord> {
        self.db.transaction(|| {
            if let Some(existing) = self.read(ids)? {
                return Ok(existing);
            }
            self.write(ids, record)?;
            self.read(ids)?.ok_or_else(|| refused("Layout import lost"))
        })
    }
}
