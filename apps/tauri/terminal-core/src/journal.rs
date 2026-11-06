//! Port of `packages/database/src/terminal-journal.ts` on the same `terminal.sqlite` Store.
use crate::store::Store;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};

pub const MIGRATION: &str = "
CREATE TABLE terminal_schema (singleton INTEGER PRIMARY KEY CHECK(singleton=1), version INTEGER NOT NULL);
INSERT INTO terminal_schema VALUES (1,2);
CREATE TABLE terminal_owner (singleton INTEGER PRIMARY KEY CHECK(singleton=1), epoch TEXT NOT NULL);
CREATE TABLE terminal_attempts (
 instance_id TEXT PRIMARY KEY, epoch TEXT NOT NULL, project_id TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('prepared','starting','running','exited','start_failed','ownership_lost')),
 updated_at INTEGER NOT NULL, metadata TEXT NOT NULL CHECK(
   length(metadata)<=2048 AND json_valid(metadata)
   AND json_extract(metadata,'$.instanceId') IS instance_id
   AND json_extract(metadata,'$.epoch') IS epoch
   AND json_extract(metadata,'$.projectId') IS project_id
   AND json_extract(metadata,'$.state') IS state
   AND json_extract(metadata,'$.updatedAt') IS updated_at
 )
);
CREATE INDEX terminal_attempts_admission ON terminal_attempts(state,project_id);
";
pub const ATTEMPTS: i64 = 10_000;
pub const RETENTION_MS: i64 = 30 * 86_400_000;
pub const ACTIVE: usize = 2;
pub const PER_PROJECT: usize = 1;

/// Exit evidence: numeric from the owned PTY, or nullable code with a signal name.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Exit {
    pub exit_code: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub signal: Option<serde_json::Value>,
}

/// `terminalAttemptSchema`, in schema key order (zod parse output order).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Attempt {
    pub instance_id: String,
    pub epoch: String,
    pub client_id: String,
    pub project_id: String,
    pub manifest_digest: String,
    pub state: String,
    pub created_at: i64,
    pub updated_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit: Option<Exit>,
}

fn valid(record: &Attempt) -> bool {
    uuid::Uuid::parse_str(&record.instance_id).is_ok()
        && uuid::Uuid::parse_str(&record.epoch).is_ok()
        && (1..=128).contains(&record.client_id.chars().count())
        && (1..=128).contains(&record.project_id.chars().count())
        && crate::authority::is_digest(&record.manifest_digest)
        && STATES.contains(&record.state.as_str())
        && record.created_at >= 0
        && record.updated_at >= record.created_at
        && (record.state == "exited") == record.exit.is_some()
        && record.exit.as_ref().is_none_or(|exit| {
            exit.exit_code.is_some()
                || match &exit.signal {
                    Some(serde_json::Value::Number(n)) => n.as_i64().is_some_and(|n| n > 0),
                    Some(serde_json::Value::String(_)) => true,
                    _ => false,
                }
        })
}

pub const STATES: [&str; 6] = [
    "prepared",
    "starting",
    "running",
    "exited",
    "start_failed",
    "ownership_lost",
];

fn allowed(from: &str, to: &str) -> bool {
    matches!(
        (from, to),
        ("prepared", "starting" | "start_failed")
            | ("starting", "running" | "exited" | "ownership_lost")
            | ("running", "exited" | "ownership_lost")
    )
}

pub struct Journal {
    store: Store,
    pub epoch: String,
    released: bool,
    now: fn() -> i64,
}

type R<T> = Result<T, String>;
fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

impl Journal {
    pub fn open(store: Store, epoch: &str, recover: bool, now: fn() -> i64) -> R<Journal> {
        uuid::Uuid::parse_str(epoch).map_err(err)?;
        if !store.db.is_autocommit() {
            return Err("Terminal journal requires an independent commit".into());
        }
        store
            .db
            .execute_batch("PRAGMA synchronous=FULL")
            .map_err(err)?;
        let mut journal = Journal {
            store,
            epoch: epoch.to_owned(),
            released: false,
            now,
        };
        journal.commit(|j| {
            let exists = j
                .store
                .db
                .query_row(
                    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='terminal_schema'",
                    [],
                    |_| Ok(()),
                )
                .optional()
                .map_err(err)?
                .is_some();
            if !exists {
                j.store.db.execute_batch(MIGRATION).map_err(err)?;
            }
            let version = |j: &Journal| -> R<Option<i64>> {
                j.store
                    .db
                    .query_row(
                        "SELECT version FROM terminal_schema WHERE singleton=1",
                        [],
                        |r| r.get(0),
                    )
                    .optional()
                    .map_err(err)
            };
            if version(j)? == Some(1) {
                j.store
                    .db
                    .execute_batch("UPDATE terminal_schema SET version=2 WHERE singleton=1")
                    .map_err(err)?;
            }
            if version(j)? != Some(2) {
                return Err("Unsupported terminal journal schema".into());
            }
            let count: i64 = j
                .store
                .db
                .query_row("SELECT COUNT(*) AS count FROM terminal_attempts", [], |r| {
                    r.get(0)
                })
                .map_err(err)?;
            if count > ATTEMPTS {
                return Err("Terminal journal capacity exceeded".into());
            }
            let owner = j.owner()?;
            if owner.as_ref().is_some_and(|o| !recover || o == &j.epoch) {
                return Err("Terminal journal already owned".into());
            }
            j.reconcile()?;
            j.store
                .db
                .execute(
                    "INSERT OR REPLACE INTO terminal_owner VALUES (1,?)",
                    [&j.epoch],
                )
                .map_err(err)?;
            Ok(())
        })?;
        Ok(journal)
    }

    fn owner(&self) -> R<Option<String>> {
        self.store
            .db
            .query_row(
                "SELECT epoch FROM terminal_owner WHERE singleton=1",
                [],
                |r| r.get(0),
            )
            .optional()
            .map_err(err)
    }

    /// `transaction()`: BEGIN IMMEDIATE unless already inside one (nested callers join it).
    fn commit<T>(&mut self, action: impl FnOnce(&mut Journal) -> R<T>) -> R<T> {
        if !self.store.db.is_autocommit() {
            return action(self);
        }
        self.store
            .db
            .execute_batch("BEGIN IMMEDIATE")
            .map_err(err)?;
        match action(self) {
            Ok(value) => {
                self.store.db.execute_batch("COMMIT").map_err(err)?;
                Ok(value)
            }
            Err(error) => {
                let _ = self.store.db.execute_batch("ROLLBACK");
                Err(error)
            }
        }
    }

    pub fn read(&self, instance: &str) -> R<Option<Attempt>> {
        let row: Option<String> = self
            .store
            .db
            .query_row(
                "SELECT metadata FROM terminal_attempts WHERE instance_id=?",
                [instance],
                |r| r.get(0),
            )
            .optional()
            .map_err(err)?;
        match row {
            None => Ok(None),
            Some(text) => {
                let record: Attempt = serde_json::from_str(&text).map_err(err)?;
                if !valid(&record) {
                    return Err("Invalid terminal lifecycle evidence".into());
                }
                Ok(Some(record))
            }
        }
    }

    fn save(&self, record: &Attempt) -> R<()> {
        if !valid(record) {
            return Err("Invalid terminal lifecycle evidence".into());
        }
        self.store
            .db
            .execute(
                "UPDATE terminal_attempts SET state=?,updated_at=?,metadata=? WHERE instance_id=?",
                params![
                    record.state,
                    record.updated_at,
                    serde_json::to_string(record).map_err(err)?,
                    record.instance_id
                ],
            )
            .map_err(err)?;
        Ok(())
    }

    fn reconcile(&self) -> R<()> {
        let mut statement = self
            .store
            .db
            .prepare("SELECT metadata FROM terminal_attempts WHERE state IN ('prepared','starting','running')")
            .map_err(err)?;
        let rows: Vec<String> = statement
            .query_map([], |r| r.get(0))
            .map_err(err)?
            .collect::<Result<_, _>>()
            .map_err(err)?;
        drop(statement);
        for text in rows {
            let mut record: Attempt = serde_json::from_str(&text).map_err(err)?;
            record.state = if record.state == "prepared" {
                "start_failed"
            } else {
                "ownership_lost"
            }
            .into();
            record.updated_at = (self.now)().max(record.updated_at);
            self.save(&record)?;
        }
        Ok(())
    }

    pub fn assert_owner(&self) -> R<()> {
        if self.released || self.owner()?.as_deref() != Some(self.epoch.as_str()) {
            return Err("Terminal journal ownership unavailable".into());
        }
        Ok(())
    }

    pub fn preflight_start(&self, instance: &str) -> R<()> {
        self.assert_owner()?;
        let record = self.read(instance)?;
        let Some(record) = record.filter(|r| r.epoch == self.epoch && r.state == "prepared") else {
            return Err("Terminal journal start denied".into());
        };
        let mut statement = self
            .store
            .db
            .prepare("SELECT project_id FROM terminal_attempts WHERE state IN ('starting','running','ownership_lost')")
            .map_err(err)?;
        let active: Vec<String> = statement
            .query_map([], |r| r.get(0))
            .map_err(err)?
            .collect::<Result<_, _>>()
            .map_err(err)?;
        if active.len() >= ACTIVE
            || active.iter().filter(|p| **p == record.project_id).count() >= PER_PROJECT
        {
            return Err("Terminal durable admission limit exceeded".into());
        }
        Ok(())
    }

    /// Confirmed synchronous effects remain facts even when the backend later fails.
    pub fn with_owner<T>(&mut self, effect: impl FnOnce() -> R<T>) -> R<T> {
        let outcome = self.commit(|j| {
            j.assert_owner()?;
            Ok(effect())
        })?;
        outcome
    }

    pub fn prepare(
        &mut self,
        instance: &str,
        client: &str,
        project: &str,
        manifest: &str,
    ) -> R<()> {
        let (instance, client, project, manifest) = (
            instance.to_owned(),
            client.to_owned(),
            project.to_owned(),
            manifest.to_owned(),
        );
        self.commit(move |j| {
            j.assert_owner()?;
            let timestamp = (j.now)();
            let record = Attempt {
                instance_id: instance,
                epoch: j.epoch.clone(),
                client_id: client,
                project_id: project,
                manifest_digest: manifest,
                state: "prepared".into(),
                created_at: timestamp,
                updated_at: timestamp,
                exit: None,
            };
            if !valid(&record) {
                return Err("Invalid terminal lifecycle evidence".into());
            }
            j.store
                .db
                .execute("DELETE FROM terminal_attempts WHERE state IN ('exited','start_failed') AND updated_at<?", [timestamp - RETENTION_MS])
                .map_err(err)?;
            let count: i64 = j.store.db.query_row("SELECT COUNT(*) AS count FROM terminal_attempts", [], |r| r.get(0)).map_err(err)?;
            if count >= ATTEMPTS {
                return Err("Terminal journal capacity exceeded".into());
            }
            j.store
                .db
                .execute(
                    "INSERT INTO terminal_attempts VALUES (?,?,?,?,?,?)",
                    params![record.instance_id, record.epoch, record.project_id, record.state, timestamp, serde_json::to_string(&record).map_err(err)?],
                )
                .map_err(err)?;
            Ok(())
        })
    }

    pub fn transition(&mut self, instance: &str, state: &str, exit: Option<Exit>) -> R<()> {
        let (instance, state) = (instance.to_owned(), state.to_owned());
        self.commit(move |j| {
            j.assert_owner()?;
            let record = j.read(&instance)?;
            let Some(mut record) =
                record.filter(|r| r.epoch == j.epoch && allowed(&r.state, &state))
            else {
                return Err("Terminal journal transition denied".into());
            };
            if state == "starting" {
                j.preflight_start(&instance)?;
            }
            record.state = state;
            record.updated_at = (j.now)().max(record.updated_at);
            if exit.is_some() {
                record.exit = exit;
            }
            j.save(&record)
        })
    }

    pub fn release(&mut self) -> R<()> {
        self.commit(|j| {
            j.assert_owner()?;
            j.reconcile()?;
            j.store
                .db
                .execute(
                    "DELETE FROM terminal_owner WHERE singleton=1 AND epoch=?",
                    [&j.epoch],
                )
                .map_err(err)?;
            j.released = true;
            Ok(())
        })
    }
}
