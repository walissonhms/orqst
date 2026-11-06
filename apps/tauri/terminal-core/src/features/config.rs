//! Port of `featureConfigurationDatabase` (`feature-configuration.ts`), `terminalTeamDatabase`
//! (`team-database.ts`), `terminalLayoutDatabase` (`layout-database.ts`) and the pair RPC
//! cases of `host.ts` that call them. Replies are the exact JSON text Node would send as
//! `value` (`None` = `undefined`, e.g. `layoutSave`).
use std::path::PathBuf;

use serde_json::Value;

use super::error::{invalid, refused, FeatureError, Result};
use super::features::{Env, Features};
use super::model::*;
use super::permissions::FeaturePermissions;
use super::store::{with_terminal_preferences, Db};
use super::teams::{TerminalLayouts, TerminalTeams};

/// What the Core host supplies (process.argv[4], reviewed selection, project digests).
pub struct FeatureContext {
    /// Private preferences directory (`process.argv[4]`).
    pub preferences: PathBuf,
    /// `stableId('workspace', project)`: Feature/permission/Feature-team workspace.
    pub workspace_id: String,
    /// `terminalDigest(project)`: workspace of the selection-wide `teamRead/teamSave`.
    pub team_workspace_id: String,
    /// Reviewed terminal ids by slot (`selection.map(terminalIdentity)`), enrolled included.
    pub terminal_ids: Vec<String>,
    pub env: Env,
}

impl FeatureContext {
    pub fn new(
        preferences: PathBuf,
        workspace_id: String,
        team_workspace_id: String,
        terminal_ids: Vec<String>,
    ) -> Self {
        Self {
            preferences,
            workspace_id,
            team_workspace_id,
            terminal_ids,
            env: Env::default(),
        }
    }

    fn with<T>(&self, action: impl FnOnce(&Db) -> Result<T>) -> Result<T> {
        with_terminal_preferences(&self.preferences, action)
    }

    /// `withFeature`: one transaction that reads the Feature first.
    fn with_feature<T>(
        &self,
        feature_id: &str,
        action: impl FnOnce(&Db, &Env, Vec<String>) -> Result<T>,
    ) -> Result<T> {
        self.with(|db| {
            db.transaction(|| {
                check_scope(&self.workspace_id, feature_id)?;
                let feature =
                    Features::open(db, &self.env)?.read(&self.workspace_id, feature_id)?;
                action(db, &self.env, feature.terminal_ids)
            })
        })
    }

    pub fn read_view(&self) -> Result<FeatureViewState> {
        self.with(|db| Features::open(db, &self.env)?.read_view(&self.workspace_id))
    }
    pub fn save_view(&self, input: &FeatureViewSave) -> Result<FeatureViewState> {
        self.with(|db| Features::open(db, &self.env)?.save_view(&self.workspace_id, input))
    }
    pub fn list(&self) -> Result<Vec<WorkspaceFeature>> {
        self.with(|db| Features::open(db, &self.env)?.list(&self.workspace_id))
    }
    pub fn read(&self, feature_id: &str) -> Result<WorkspaceFeature> {
        self.with(|db| {
            check_scope(&self.workspace_id, feature_id)?;
            Features::open(db, &self.env)?.read(&self.workspace_id, feature_id)
        })
    }
    pub fn create(&self, input: &FeatureCreate) -> Result<WorkspaceFeature> {
        self.with(|db| Features::open(db, &self.env)?.create(&self.workspace_id, input))
    }
    pub fn update(&self, feature_id: &str, input: &FeatureUpdate) -> Result<WorkspaceFeature> {
        self.with(|db| {
            check_scope(&self.workspace_id, feature_id)?;
            Features::open(db, &self.env)?.update(&self.workspace_id, feature_id, input)
        })
    }
    pub fn assign_terminal(
        &self,
        feature_id: &str,
        terminal_id: &str,
        expected_revision: u64,
    ) -> Result<WorkspaceFeature> {
        self.with(|db| {
            check_scope(&self.workspace_id, feature_id)?;
            Features::open(db, &self.env)?.assign_terminal(
                &self.workspace_id,
                feature_id,
                terminal_id,
                expected_revision,
            )
        })
    }
    pub fn read_permissions(&self, feature_id: &str) -> Result<FeaturePermissionState> {
        self.with_feature(feature_id, |db, env, _| {
            FeaturePermissions::open(Features::open(db, env)?)?.read(&self.workspace_id, feature_id)
        })
    }
    pub fn save_permissions(
        &self,
        feature_id: &str,
        actor_id: &str,
        input: &FeaturePermissionSave,
    ) -> Result<FeaturePermissionState> {
        self.with_feature(feature_id, |db, env, _| {
            FeaturePermissions::open(Features::open(db, env)?)?.save(
                &self.workspace_id,
                feature_id,
                actor_id,
                input,
            )
        })
    }
    pub fn read_team(&self, feature_id: &str) -> Result<TerminalTeamState> {
        self.with_feature(feature_id, |db, _, ids| {
            if ids.is_empty() {
                return Ok(TerminalTeamState {
                    revision: 0,
                    configuration: None,
                });
            }
            TerminalTeams::open(db, Some(feature_id))?.read(&self.workspace_id, &ids)
        })
    }
    pub fn save_team(
        &self,
        feature_id: &str,
        input: &TerminalTeamSave,
    ) -> Result<TerminalTeamState> {
        self.with_feature(feature_id, |db, _, ids| {
            TerminalTeams::open(db, Some(feature_id))?.save(&self.workspace_id, &ids, input)
        })
    }
    pub fn read_layout(&self, feature_id: &str) -> Result<Option<TerminalLayoutRecord>> {
        self.with_feature(feature_id, |db, _, ids| {
            if ids.is_empty() {
                return Ok(None);
            }
            TerminalLayouts::open(db, Some(feature_id))?.read(&ids)
        })
    }
    pub fn save_layout(&self, feature_id: &str, record: &TerminalLayoutRecord) -> Result<()> {
        self.with_feature(feature_id, |db, _, ids| {
            TerminalLayouts::open(db, Some(feature_id))?.save(&ids, record)
        })
    }
    /// `terminalTeamDatabase(directory, selection ids, terminalDigest(project))`.
    pub fn selection_team_read(&self) -> Result<TerminalTeamState> {
        self.with(|db| {
            TerminalTeams::open(db, None)?.read(&self.team_workspace_id, &self.terminal_ids)
        })
    }
    pub fn selection_team_save(&self, input: &TerminalTeamSave) -> Result<TerminalTeamState> {
        self.with(|db| {
            TerminalTeams::open(db, None)?.save(&self.team_workspace_id, &self.terminal_ids, input)
        })
    }
    /// `terminalLayoutDatabase(directory, selection ids)`.
    pub fn selection_layout_read(&self) -> Result<Option<TerminalLayoutRecord>> {
        self.with(|db| TerminalLayouts::open(db, None)?.read(&self.terminal_ids))
    }
    pub fn selection_layout_save(&self, record: &TerminalLayoutRecord) -> Result<()> {
        self.with(|db| TerminalLayouts::open(db, None)?.save(&self.terminal_ids, record))
    }
    pub fn selection_layout_import(
        &self,
        record: &TerminalLayoutRecord,
    ) -> Result<TerminalLayoutRecord> {
        self.with(|db| TerminalLayouts::open(db, None)?.import(&self.terminal_ids, record))
    }
}

/// Pair RPC kinds this module answers.
pub const FEATURE_KINDS: &[&str] = &[
    "featureViewRead",
    "featureViewSave",
    "featureList",
    "featureRead",
    "featureCreate",
    "featureUpdate",
    "featureAssign",
    "featurePermissionsRead",
    "featurePermissionsSave",
    "featureTeamRead",
    "featureTeamSave",
    "featureLayoutRead",
    "featureLayoutSave",
    "teamRead",
    "teamSave",
    "layoutRead",
    "layoutSave",
    "layoutImport",
];

pub fn handles(kind: &str) -> bool {
    FEATURE_KINDS.contains(&kind)
}

fn some<T: serde::Serialize>(value: Result<T>) -> Result<Option<String>> {
    value.and_then(|v| to_json(&v)).map(Some)
}

fn field<'a>(request: &'a serde_json::Map<String, Value>, name: &str) -> Result<&'a Value> {
    request
        .get(name)
        .ok_or_else(|| invalid("Missing request field"))
}
fn uuid_field(request: &serde_json::Map<String, Value>, name: &str) -> Result<String> {
    match field(request, name)? {
        Value::String(id) if is_uuid(id) => Ok(id.clone()),
        _ => Err(invalid("Invalid request id")),
    }
}

/// Validates one `terminalPairRPCSchema` request of a [`FEATURE_KINDS`] kind (strict keys)
/// and runs it. `Ok(None)` is `undefined`; the caller wraps the result as
/// `{ id, ok: true, value }`, or `{ id, ok: false }` on any `Err`.
pub fn dispatch(ctx: &FeatureContext, request: &Value) -> Result<Option<String>> {
    let Value::Object(map) = request else {
        return Err(invalid("Invalid request"));
    };
    let kind = match map.get("kind") {
        Some(Value::String(kind)) if handles(kind) => kind.as_str(),
        _ => return Err(invalid("Unsupported request kind")),
    };
    let extra: &[&str] = match kind {
        "featureViewSave" | "featureCreate" | "teamSave" => &["input"],
        "featureRead" | "featurePermissionsRead" | "featureTeamRead" | "featureLayoutRead" => {
            &["featureId"]
        }
        "featureUpdate" | "featureTeamSave" => &["featureId", "input"],
        "featureAssign" => &["featureId", "slot", "expectedRevision"],
        "featurePermissionsSave" => &["featureId", "actorId", "input"],
        "featureLayoutSave" => &["featureId", "record"],
        "layoutSave" | "layoutImport" => &["record"],
        _ => &[],
    };
    if map.len() != 2 + extra.len() || !extra.iter().all(|k| map.contains_key(*k)) {
        return Err(invalid("Invalid request shape"));
    }
    uuid_field(map, "id")?;
    let feature_id = || uuid_field(map, "featureId");
    match kind {
        "featureViewRead" => some(ctx.read_view()),
        "featureViewSave" => some(ctx.save_view(&FeatureViewSave::parse(field(map, "input")?)?)),
        "featureList" => some(ctx.list()),
        "featureRead" => some(ctx.read(&feature_id()?)),
        "featureCreate" => some(ctx.create(&FeatureCreate::parse(field(map, "input")?)?)),
        "featureUpdate" => {
            let id = feature_id()?;
            some(ctx.update(&id, &FeatureUpdate::parse(field(map, "input")?)?))
        }
        "featureAssign" => {
            let id = feature_id()?;
            let slot = field(map, "slot")?
                .as_u64()
                .filter(|s| (*s as usize) < TERMINAL_SLOT_CEILING);
            let expected = field(map, "expectedRevision")?
                .as_u64()
                .filter(|r| (1..=MAX_SAFE).contains(r));
            let (Some(slot), Some(expected)) = (slot, expected) else {
                return Err(invalid("Invalid assignment"));
            };
            let terminal = ctx
                .terminal_ids
                .get(slot as usize)
                .ok_or_else(|| refused("Unknown reviewed terminal"))?;
            some(ctx.assign_terminal(&id, terminal, expected))
        }
        "featurePermissionsRead" => some(ctx.read_permissions(&feature_id()?)),
        "featurePermissionsSave" => {
            let id = feature_id()?;
            let actor = match field(map, "actorId")? {
                Value::String(actor) if (1..=128).contains(&utf16_len(actor)) => actor.clone(),
                _ => return Err(invalid("Invalid actor")),
            };
            let input = FeaturePermissionSave::parse(field(map, "input")?)?;
            match ctx.save_permissions(&id, &actor, &input) {
                Ok(state) => Ok(Some(format!(
                    r#"{{"status":"ok","permissions":{}}}"#,
                    to_json(&state)?
                ))),
                Err(FeatureError::Conflict(_)) => Ok(Some(r#"{"status":"conflict"}"#.into())),
                Err(error) => Err(error),
            }
        }
        "featureTeamRead" => some(ctx.read_team(&feature_id()?)),
        "featureTeamSave" => {
            let id = feature_id()?;
            some(ctx.save_team(&id, &TerminalTeamSave::parse(field(map, "input")?)?))
        }
        "featureLayoutRead" => some(ctx.read_layout(&feature_id()?)),
        "featureLayoutSave" => {
            let id = feature_id()?;
            ctx.save_layout(&id, &TerminalLayoutRecord::parse(field(map, "record")?)?)?;
            // Node returns `undefined` from `saveLayout` (the Store `save` has no value).
            Ok(None)
        }
        "teamRead" => some(ctx.selection_team_read()),
        "teamSave" => {
            some(ctx.selection_team_save(&TerminalTeamSave::parse(field(map, "input")?)?))
        }
        "layoutRead" => some(ctx.selection_layout_read()),
        "layoutSave" => {
            ctx.selection_layout_save(&TerminalLayoutRecord::parse(field(map, "record")?)?)?;
            Ok(None)
        }
        "layoutImport" => {
            some(ctx.selection_layout_import(&TerminalLayoutRecord::parse(field(map, "record")?)?))
        }
        _ => Err(invalid("Unsupported request kind")),
    }
}
