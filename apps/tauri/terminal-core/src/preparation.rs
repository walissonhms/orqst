//! Port of `preparation-context.ts` `validateTerminalPreparationBinding`: the manifest's
//! preparation fence is recomputed from the observer workspace catalogue (read-only) and the
//! private Feature store. View changes never terminate or move existing processes; new
//! launches require a fresh picker.
use crate::admission::json::js_number;
use crate::features::model::{stable_id, FeatureStatus};
use crate::features::FeatureContext;
use crate::profiles::config::PreparationBinding;
use crate::profiles::fsx::{getuid, lstat, realpath, terminal_directory};
use crate::profiles::interactive::PreparationValidator;
use crate::profiles::nodepath::dirname;
use crate::profiles::{ProfileError, Result};
use rusqlite::{Connection, OpenFlags, OptionalExtension};
use std::os::unix::fs::MetadataExt;
use std::path::PathBuf;

const CATALOGUE_LIMIT: u64 = 2 * 1024 * 1024 * 1024;

fn refused(message: &str) -> ProfileError {
    ProfileError::refused(message)
}

/// `readTerminalWorkspace(file, workspaceId)` (`@orqst/database`): read-only, query-only.
pub fn read_terminal_workspace(file: &str, workspace_id: &str) -> Result<String> {
    if !crate::authority::is_digest(workspace_id) {
        return Err(ProfileError::schema("workspaceId"));
    }
    let unavailable = || refused("Selected workspace unavailable");
    let db = Connection::open_with_flags(
        file,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|_| unavailable())?;
    db.execute_batch("PRAGMA query_only=ON; PRAGMA busy_timeout=1000;")
        .map_err(|_| unavailable())?;
    let row: Option<rusqlite::types::Value> = db
        .query_row(
            "SELECT path FROM workspaces WHERE id=? LIMIT 1",
            [workspace_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(|_| unavailable())?;
    match row {
        Some(rusqlite::types::Value::Text(path)) if path.encode_utf16().count() <= 2048 => Ok(path),
        _ => Err(unavailable()),
    }
}

/// The fence of `resolveTerminalPreparationContext`: `(project, fence)`.
pub fn resolve_terminal_preparation_context(
    observer_database: &str,
    preferences_directory: &str,
    workspace_id: &str,
    feature_id: Option<&str>,
) -> Result<(String, String)> {
    let db = lstat(observer_database)?;
    if !db.is_file()
        || db.file_type().is_symlink()
        || db.uid() != getuid()
        || db.mode() & 0o077 != 0
        || db.nlink() != 1
        || db.size() > CATALOGUE_LIMIT
        || realpath(observer_database)? != observer_database
    {
        return Err(refused("Unsafe workspace catalogue"));
    }
    terminal_directory(&dirname(observer_database), true)?;
    terminal_directory(preferences_directory, true)?;
    let project = read_terminal_workspace(observer_database, workspace_id)?;
    terminal_directory(&project, false)?;
    if stable_id(&["workspace", &project]) != workspace_id {
        return Err(refused("Workspace identity changed"));
    }
    let after = lstat(observer_database)?;
    if db.ino() != after.ino() || db.dev() != after.dev() {
        return Err(refused("Workspace catalogue changed"));
    }
    let features = FeatureContext::new(
        PathBuf::from(preferences_directory),
        workspace_id.to_owned(),
        String::new(),
        Vec::new(),
    );
    let store = |e: crate::features::FeatureError| ProfileError::refused(&e.to_string());
    let view = features.read_view().map_err(store)?;
    if view.feature_id.as_deref() != feature_id {
        return Err(refused("Selected Feature changed"));
    }
    let status = match feature_id {
        None => None,
        Some(id) => Some(features.read(id).map_err(store)?.status),
    };
    if status == Some(FeatureStatus::Archived) {
        return Err(refused("Selected Feature is archived"));
    }
    let directory = lstat(&project)?;
    let number = |n: u64| js_number(n as f64, None);
    let fence = format!(
        "[{},{},{},{},{},{},{},{}]",
        serde_json::to_string(workspace_id).unwrap(),
        feature_id.map_or("null".to_owned(), |id| serde_json::to_string(id).unwrap()),
        number(view.revision),
        status.map_or("null".to_owned(), |s| serde_json::to_string(s.as_str())
            .unwrap()),
        number(directory.dev() as u64),
        number(directory.ino()),
        number(db.dev() as u64),
        number(db.ino()),
    );
    Ok((project, fence))
}

/// The Core's preparation validator over the Feature store.
pub struct FeaturePreparation;

impl PreparationValidator for FeaturePreparation {
    fn validate(&self, binding: Option<&PreparationBinding>, project: &str) -> Result<()> {
        let Some(binding) = binding else {
            return Ok(());
        };
        let (current, fence) = resolve_terminal_preparation_context(
            &binding.observer_database,
            &binding.preferences_directory,
            &binding.workspace_id,
            binding.feature_id.as_deref(),
        )?;
        if current != project || fence != binding.fence {
            return Err(refused(
                "Workspace or Feature changed; reload terminal preparation",
            ));
        }
        Ok(())
    }
}
