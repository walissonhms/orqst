//! Port of `managed-files.ts`: inspect the complete selection before creating a Core,
//! journal or admission marker.
use super::config::InteractiveConfig;
use super::fsx::lstat;
use super::identity::terminal_identity;
use super::interactive::{
    interactive_provider, read_interactive_terminal_config, PreparationValidator,
};
use super::nodepath::{join2, relative};
use super::{ProfileError, Result};
use std::collections::HashSet;
use std::os::unix::fs::MetadataExt;

/// `TERMINAL_SLOT_CEILING` / `DEFAULT_TERMINAL_SLOTS` (`@orqst/protocol`).
pub const TERMINAL_SLOT_CEILING: u32 = 8;
pub const DEFAULT_TERMINAL_SLOTS: u32 = 2;

/// One inspected manifest. `blocker` is `reuse_unavailable` | `existing_state` |
/// `opencode_startup_required`.
#[derive(Clone, Debug, PartialEq)]
pub struct ManagedSelection {
    pub config: InteractiveConfig,
    pub blocker: Option<&'static str>,
}

/// `inspectManagedTerminalFiles(files, limit)`.
pub fn inspect_managed_terminal_files(
    files: &[String],
    limit: Option<u32>,
    prep: &dyn PreparationValidator,
) -> Result<Vec<ManagedSelection>> {
    let capacity = limit.unwrap_or(DEFAULT_TERMINAL_SLOTS);
    if !(1..=TERMINAL_SLOT_CEILING).contains(&capacity) {
        return Err(ProfileError::schema("terminal slot limit"));
    }
    if files.is_empty() || files.len() > capacity as usize {
        return Err(ProfileError::refused("Terminal selection exceeds capacity"));
    }
    let mut terminal_ids = HashSet::new();
    let mut identities = HashSet::new();
    let mut states: Vec<String> = Vec::new();
    let mut sessions = HashSet::new();
    let mut selection = Vec::new();
    for file in files {
        let config = read_interactive_terminal_config(file, prep)?;
        let (terminal_id, _) = terminal_identity(config.state(), config.identity());
        if !terminal_ids.insert(terminal_id) {
            return Err(ProfileError::refused("Duplicate terminal identity"));
        }
        if let InteractiveConfig::Claude(claude) = &config {
            if !sessions.insert(claude.session_id.clone()) {
                return Err(ProfileError::refused("Duplicate Claude session UUID"));
            }
        }
        for path in [file.as_str(), config.state()] {
            let info = lstat(path)?;
            if !identities.insert((info.dev(), info.ino())) {
                return Err(ProfileError::refused(
                    "Duplicate terminal manifest or state",
                ));
            }
        }
        for state in &states {
            for path in [
                relative(state, config.state()),
                relative(config.state(), state),
            ] {
                if path.is_empty() || (path != ".." && !path.starts_with("../")) {
                    return Err(ProfileError::refused("Overlapping terminal state"));
                }
            }
        }
        states.push(config.state().to_owned());
        let mut blocker = (config.has_authentication() && !config.has_interactive())
            .then_some("reuse_unavailable");
        if let InteractiveConfig::OpenCode(open) = &config {
            if !open.interactive.native_startup_authorized {
                blocker = Some("opencode_startup_required");
            }
        }
        for name in ["terminal.sqlite", "desktop-communication.sqlite"] {
            match lstat(&join2(config.state(), name)) {
                Ok(_) => {
                    blocker.get_or_insert("existing_state");
                }
                Err(error) if error.io_code() == Some("ENOENT") => {}
                Err(error) => return Err(error),
            }
        }
        selection.push(ManagedSelection { config, blocker });
    }
    let providers: HashSet<&str> = selection
        .iter()
        .map(|s| interactive_provider(&s.config))
        .collect();
    let hub = selection.iter().any(|s| s.config.hub());
    let codex_open_code_pair =
        selection.len() == 2 && providers.contains("codex") && providers.contains("opencode");
    let mcp_pair = selection.len() == 2
        && providers.len() == 2
        && selection.iter().all(|s| s.config.mcp() && !s.config.hub());
    if providers.len() != 1 && !codex_open_code_pair && !mcp_pair && !hub {
        return Err(ProfileError::refused(
            "Terminal team requires one provider except for a reviewed pair or the hub",
        ));
    }
    let first = selection[0].config.project().to_owned();
    if selection.iter().any(|s| s.config.project() != first) {
        return Err(ProfileError::refused(
            "Terminal team requires one workspace",
        ));
    }
    if hub {
        if selection.iter().any(|s| !s.config.hub()) {
            return Err(ProfileError::refused(
                "Hub terminals cannot share a Core with non-hub terminals",
            ));
        }
    } else if selection.iter().any(|s| s.config.mcp())
        && (selection.len() != 2
            || selection.iter().any(|s| !s.config.mcp())
            || selection[0].config.project() != selection[1].config.project())
    {
        return Err(ProfileError::refused(
            "MCP requires two opted-in terminals in one workspace",
        ));
    }
    Ok(selection)
}
