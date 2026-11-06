//! Shared types mirroring `supervisor.ts`. Field names serialize exactly as in TypeScript.
use serde::{Deserialize, Serialize};

/// `TerminalProfile` (`supervisor.ts`). Immutable once prepared.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TerminalProfile {
    pub id: String,
    pub project_id: String,
    pub executable: String,
    pub executable_sha256: String,
    pub executable_version: String,
    pub argv: Vec<String>,
    pub cwd: String,
    pub environment_profile: String,
    pub permissions: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cli_authorization_scope: Option<String>,
}

/// Owned process environment. Built by `profiles`; the PTY passes it through unchanged
/// (no injected `SHELL`, unlike portable-pty's `CommandBuilder`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LaunchPlan {
    pub profile: TerminalProfile,
    pub env: Vec<(String, String)>,
}

pub type Signal = &'static str;
pub const SIGTERM: Signal = "SIGTERM";
pub const SIGKILL: Signal = "SIGKILL";
