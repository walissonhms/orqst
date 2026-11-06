//! Port of `local-cli-path.ts`. Passive local metadata only; never sources a shell profile.
use super::fsx::{getuid, lstat, realpath};
use super::js::Js;
use super::nodepath::{dirname, is_absolute, join2, root};
use super::{ProfileError, Result};
use std::collections::HashSet;
use std::os::unix::fs::MetadataExt;

pub const MAXIMUM_PATH_BYTES: usize = 32768;
pub const MAXIMUM_DIRECTORIES: usize = 128;
/// `legacyTerminalPath`.
pub const LEGACY_TERMINAL_PATH: &str = "/usr/bin:/bin:/usr/sbin:/sbin";

/// `localCliFallbackDirectories`.
pub fn local_cli_fallback_directories(home: &str) -> Result<Vec<String>> {
    if !is_absolute(home) || home.contains('\0') {
        return Err(ProfileError::refused("Absolute CLI home required"));
    }
    Ok(vec![
        join2(home, ".local/bin"),
        join2(home, ".claude/local"),
        "/opt/homebrew/bin".into(),
        "/usr/local/bin".into(),
        join2(home, ".opencode/bin"),
    ])
}

fn trusted_directory(path: &str) -> Result<Option<(u64, u64)>> {
    let info = lstat(path)?;
    let uid = getuid();
    if !info.is_dir() || (info.uid() != 0 && info.uid() != uid) || info.mode() & 0o022 != 0 {
        return Ok(None);
    }
    let mut ancestor = dirname(path);
    while ancestor != root(&ancestor) {
        let parent = lstat(&ancestor)?;
        if (parent.uid() != 0 && parent.uid() != uid)
            || (parent.mode() & 0o022 != 0 && parent.mode() & 0o1000 == 0)
        {
            return Ok(None);
        }
        ancestor = dirname(&ancestor);
    }
    Ok(Some((info.dev(), info.ino())))
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Origin {
    Env,
    Fallback,
}

impl Origin {
    pub fn as_str(self) -> &'static str {
        match self {
            Origin::Env => "env",
            Origin::Fallback => "fallback",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PathDirectory {
    pub path: String,
    pub origin: Origin,
}

/// Result of `localCliPathDirectories`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PathDirectories {
    pub path: String,
    pub directories: Vec<PathDirectory>,
    /// Rejected entries; the reason is always `unsafe_directory`.
    pub rejected: Vec<PathDirectory>,
    /// `selected-installers-system` or `explicit-env-first`.
    pub precedence: &'static str,
    /// `complete` or `limited`.
    pub inspection: &'static str,
}

impl PathDirectories {
    pub fn rejected_js(&self) -> Js {
        Js::Arr(
            self.rejected
                .iter()
                .map(|r| {
                    Js::obj([
                        ("path", Js::str(&r.path)),
                        ("origin", Js::str(r.origin.as_str())),
                        ("reason", Js::str("unsafe_directory")),
                    ])
                })
                .collect(),
        )
    }
    pub fn to_js(&self) -> Js {
        Js::obj([
            ("path", Js::str(&self.path)),
            (
                "directories",
                Js::Arr(
                    self.directories
                        .iter()
                        .map(|d| {
                            Js::obj([
                                ("path", Js::str(&d.path)),
                                ("origin", Js::str(d.origin.as_str())),
                            ])
                        })
                        .collect(),
                ),
            ),
            ("rejected", self.rejected_js()),
            ("precedence", Js::str(self.precedence)),
            ("inspection", Js::str(self.inspection)),
        ])
    }
}

fn selected_unsafe() -> ProfileError {
    ProfileError::refused("Selected CLI tool directory is unavailable or unsafe")
}

/// `localCliPathDirectories(searchPath, home, selectedDirectories)`. An empty `home` is absent.
pub fn local_cli_path_directories(
    search_path: &str,
    home: Option<&str>,
    selected_directories: &[String],
) -> Result<PathDirectories> {
    if search_path.len() > MAXIMUM_PATH_BYTES {
        return Err(ProfileError::refused(
            "CLI discovery PATH exceeds the inspection budget",
        ));
    }
    if selected_directories.len() > MAXIMUM_DIRECTORIES
        || selected_directories.join(":").len() > MAXIMUM_PATH_BYTES
    {
        return Err(ProfileError::refused(
            "Selected CLI tool directories exceed the inspection budget",
        ));
    }
    for path in selected_directories {
        let ok = (|| -> Result<bool> {
            Ok(!(path == root(path)
                || !is_absolute(path)
                || path.contains('\0')
                || path.contains(':')
                || realpath(path)? != *path
                || trusted_directory(path)?.is_none()))
        })();
        if !matches!(ok, Ok(true)) {
            return Err(selected_unsafe());
        }
    }
    let environment: Vec<PathDirectory> = search_path
        .split(':')
        .filter(|p| is_absolute(p) && !p.contains('\0'))
        .map(|p| PathDirectory {
            path: p.to_owned(),
            origin: Origin::Env,
        })
        .collect();
    let installers: Vec<PathDirectory> = match home {
        Some(home) if !home.is_empty() => local_cli_fallback_directories(home)?
            .into_iter()
            .map(|path| PathDirectory {
                path,
                origin: Origin::Fallback,
            })
            .collect(),
        _ => Vec::new(),
    };
    let selected: Vec<PathDirectory> = selected_directories
        .iter()
        .map(|p| PathDirectory {
            path: p.clone(),
            origin: Origin::Fallback,
        })
        .collect();
    let system: HashSet<&str> = LEGACY_TERMINAL_PATH.split(':').collect();
    let gui_minimal = environment
        .iter()
        .all(|d| system.contains(d.path.trim_end_matches('/')));
    let inputs: Vec<PathDirectory> = if gui_minimal {
        [selected, installers, environment].concat()
    } else {
        [environment, installers, selected].concat()
    };
    let mut unique: Vec<PathDirectory> = Vec::new();
    let mut seen_paths = HashSet::new();
    for input in inputs {
        if seen_paths.insert(input.path.clone()) {
            unique.push(input);
        }
    }
    let mut limited = unique.len() > MAXIMUM_DIRECTORIES;
    let mut directories = Vec::new();
    let mut rejected = Vec::new();
    let mut seen = HashSet::new();
    for input in unique.into_iter().take(MAXIMUM_DIRECTORIES) {
        type Inspected = Option<(String, Option<(u64, u64)>)>;
        let outcome = (|| -> Result<Inspected> {
            let path = realpath(&input.path)?;
            if path == root(&path) || path.contains(':') {
                return Ok(None);
            }
            let info = trusted_directory(&path)?;
            Ok(Some((path, info)))
        })();
        match outcome {
            Ok(None) | Ok(Some((_, None))) => rejected.push(input),
            Ok(Some((path, Some(identity)))) => {
                if seen.insert(identity) {
                    directories.push(PathDirectory {
                        path,
                        origin: input.origin,
                    });
                }
            }
            Err(error) => {
                if error.io_code() != Some("ENOENT") {
                    limited = true;
                }
            }
        }
    }
    if selected_directories
        .iter()
        .any(|p| !directories.iter().any(|d| d.path == *p))
    {
        return Err(selected_unsafe());
    }
    let path = directories
        .iter()
        .map(|d| d.path.as_str())
        .collect::<Vec<_>>()
        .join(":");
    if path.len() > MAXIMUM_PATH_BYTES {
        return Err(ProfileError::refused(
            "Canonical CLI PATH exceeds the inspection budget",
        ));
    }
    Ok(PathDirectories {
        path,
        directories,
        rejected,
        precedence: if gui_minimal {
            "selected-installers-system"
        } else {
            "explicit-env-first"
        },
        inspection: if limited { "limited" } else { "complete" },
    })
}

/// `terminalToolPath(reviewed)`.
pub fn terminal_tool_path(reviewed: Option<&str>) -> Result<String> {
    let Some(reviewed) = reviewed else {
        return Ok(LEGACY_TERMINAL_PATH.into());
    };
    if reviewed.is_empty() || reviewed.len() > MAXIMUM_PATH_BYTES {
        return Err(ProfileError::refused(
            "Reviewed terminal PATH is invalid or exceeds the byte budget",
        ));
    }
    let entries: Vec<&str> = reviewed.split(':').collect();
    if entries.len() > MAXIMUM_DIRECTORIES {
        return Err(ProfileError::refused(
            "Reviewed terminal PATH exceeds the directory budget",
        ));
    }
    let mut identities = HashSet::new();
    for path in entries {
        if path == root(path) {
            return Err(ProfileError::refused(
                "Reviewed terminal PATH cannot contain filesystem root",
            ));
        }
        if !is_absolute(path) || path.contains('\0') {
            return Err(ProfileError::refused(
                "Reviewed terminal PATH contains an empty or nonabsolute directory",
            ));
        }
        let (canonical, info) = match realpath(path).and_then(|c| {
            let info = trusted_directory(&c)?;
            Ok((c, info))
        }) {
            Ok(value) => value,
            Err(_) => {
                return Err(ProfileError::refused(
                    "Reviewed terminal PATH directory is missing or inaccessible",
                ))
            }
        };
        if canonical != path {
            return Err(ProfileError::refused(
                "Reviewed terminal PATH directory is no longer canonical",
            ));
        }
        let Some(identity) = info else {
            return Err(ProfileError::refused(
                "Reviewed terminal PATH directory ownership or permissions changed",
            ));
        };
        if !identities.insert(identity) {
            return Err(ProfileError::refused(
                "Reviewed terminal PATH contains duplicate directory identities",
            ));
        }
    }
    let current = local_cli_path_directories(reviewed, None, &[])?;
    if current.inspection != "complete" {
        return Err(ProfileError::refused(
            "Reviewed terminal PATH metadata inspection is incomplete",
        ));
    }
    if current.path != reviewed {
        return Err(ProfileError::refused(
            "Reviewed terminal PATH directory changed during validation",
        ));
    }
    Ok(current.path)
}
