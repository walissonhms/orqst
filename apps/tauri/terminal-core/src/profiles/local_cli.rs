//! Port of `local-cli.ts`. Passive executable discovery only; never executes a CLI.
use super::adapters::interactive_cli_status;
use super::fsx::{is_file_or_symlink, lstat, realpath};
use super::js::Js;
use super::local_cli_path::{local_cli_path_directories, Origin, PathDirectories};
use super::nodepath::join2;
use super::{ProfileError, Result};
use std::collections::HashSet;
use std::ffi::CString;
use std::os::unix::fs::MetadataExt;

pub const LOCAL_CLI_PROVIDERS: [&str; 3] = ["codex", "claude", "opencode"];
pub const MAXIMUM_CANDIDATES: usize = 16;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Candidate {
    pub launcher: String,
    pub canonical: String,
    pub origin: Origin,
}

/// `LocalCliDiscovery`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalCliDiscovery {
    pub provider: &'static str,
    /// `candidate_found` | `not_found` | `incomplete`.
    pub lookup: &'static str,
    pub candidates: Vec<Candidate>,
    /// `complete` | `limited`.
    pub inspection: &'static str,
    pub search: PathDirectories,
}

impl LocalCliDiscovery {
    pub fn to_js(&self) -> Js {
        Js::obj([
            ("provider", Js::str(self.provider)),
            ("lookup", Js::str(self.lookup)),
            (
                "candidates",
                Js::Arr(
                    self.candidates
                        .iter()
                        .map(|c| {
                            Js::obj([
                                ("launcher", Js::str(&c.launcher)),
                                ("canonical", Js::str(&c.canonical)),
                                ("origin", Js::str(c.origin.as_str())),
                            ])
                        })
                        .collect(),
                ),
            ),
            ("inspection", Js::str(self.inspection)),
            ("rejectedDirectories", self.search.rejected_js()),
            ("pathPrecedence", Js::str(self.search.precedence)),
            ("version", Js::Null),
            ("authentication", Js::str("unknown")),
            ("execution", Js::str("not_authorized")),
        ])
    }
}

fn access_x(path: &str) -> Result<()> {
    let c = CString::new(path).map_err(|_| ProfileError::Io("ERR_INVALID_ARG_VALUE".into()))?;
    // SAFETY: `c` is a valid NUL-terminated string for the duration of the call.
    if unsafe { libc::access(c.as_ptr(), libc::X_OK) } != 0 {
        return Err(super::fsx::io(std::io::Error::last_os_error()));
    }
    Ok(())
}

/// `discoverLocalClis(searchPath, home, selectedDirectories)`.
pub fn discover_local_clis(
    search_path: &str,
    home: Option<&str>,
    selected_directories: &[String],
) -> Result<Vec<LocalCliDiscovery>> {
    let search = local_cli_path_directories(search_path, home, selected_directories)?;
    Ok(LOCAL_CLI_PROVIDERS
        .iter()
        .map(|provider| {
            let mut candidates: Vec<Candidate> = Vec::new();
            let mut seen = HashSet::new();
            let mut incomplete = search.inspection == "limited" || !search.rejected.is_empty();
            for directory in &search.directories {
                if candidates.len() == MAXIMUM_CANDIDATES {
                    incomplete = true;
                    break;
                }
                let launcher = join2(&directory.path, provider);
                let outcome = (|| -> Result<Option<String>> {
                    let entry = lstat(&launcher)?;
                    if !is_file_or_symlink(&entry) {
                        return Ok(None);
                    }
                    let canonical = realpath(&launcher)?;
                    let info = lstat(&canonical)?;
                    if !info.is_file() || info.mode() & 0o111 == 0 || seen.contains(&canonical) {
                        return Ok(None);
                    }
                    access_x(&canonical)?;
                    Ok(Some(canonical))
                })();
                match outcome {
                    Ok(Some(canonical)) => {
                        seen.insert(canonical.clone());
                        candidates.push(Candidate {
                            launcher,
                            canonical,
                            origin: directory.origin,
                        });
                    }
                    Ok(None) => {}
                    Err(error) => {
                        if error.io_code() != Some("ENOENT") {
                            incomplete = true;
                        }
                    }
                }
            }
            LocalCliDiscovery {
                provider,
                lookup: if !candidates.is_empty() {
                    "candidate_found"
                } else if incomplete {
                    "incomplete"
                } else {
                    "not_found"
                },
                candidates,
                inspection: if incomplete { "limited" } else { "complete" },
                search: search.clone(),
            }
        })
        .collect())
}

fn reuse_blockers(provider: &str) -> &'static [&'static str] {
    match provider {
        "codex" => &[
            "codex_auth_and_session_root_coupled",
            "installed_protocol_unverified",
        ],
        "claude" => &[
            "claude_native_shared_state_acknowledgment_required",
            "native_provider_acceptance_pending",
        ],
        _ => &[
            "opencode_native_database_credentials_and_sessions_coupled",
            "native_database_startup_migrations_not_authorized",
            "native_standalone_descendant_lifecycle_unvalidated",
            "native_provider_acceptance_pending",
        ],
    }
}

/// `localCliIntegrationPlan(discovery)`: deliberately incapable of launching or logging in.
pub fn local_cli_integration_plan(discovery: &LocalCliDiscovery) -> Js {
    let mut blockers: Vec<&str> = Vec::new();
    if discovery.lookup == "not_found" {
        blockers.push("executable_not_found");
    }
    if discovery.inspection == "limited" {
        blockers.push("discovery_incomplete");
    }
    if discovery.candidates.len() > 1 {
        blockers.push("explicit_executable_selection_required");
    }
    blockers.push("exact_binary_review_required");
    blockers.extend(reuse_blockers(discovery.provider));
    blockers.push("owner_execution_approval_required");
    Js::obj([
        ("provider", Js::str(discovery.provider)),
        ("authenticationPolicy", Js::str("reuse_existing")),
        ("authentication", Js::str("unknown")),
        ("providerOwnsCredentials", Js::Bool(true)),
        ("automaticInstall", Js::Bool(false)),
        ("automaticLogin", Js::Bool(false)),
        ("execution", Js::str("blocked")),
        ("interactive", interactive_cli_status(discovery.provider)),
        ("blockers", Js::strs(blockers)),
    ])
}
