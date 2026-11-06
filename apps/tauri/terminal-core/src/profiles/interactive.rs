//! Port of the dispatch in `interactive-profile.ts` plus the validate inputs of
//! `pty-backend.ts`. This is the entry point the Core dispatcher calls.
use super::claude::{
    claude_terminal_environment, claude_terminal_profiles, validate_managed_claude_config,
};
use super::codex::{
    managed_codex_environment, managed_codex_profiles, validate_managed_codex_config,
};
use super::config::{
    parse_claude_config, parse_codex_config, parse_opencode_config, InteractiveConfig, McpLaunch,
    PreparationBinding,
};
use super::fsx::{terminal_file, DEFAULT_FILE_BUDGET};
use super::hooks::validate_claude_owned_hooks;
use super::js::{self, Js};
use super::opencode::{
    open_code_terminal_environment, open_code_terminal_profiles, validate_managed_open_code_config,
};
use super::{terminal_digest, ProfileError, Result};
use crate::types::{LaunchPlan, TerminalProfile};

/// A profile together with the exact `JSON.stringify(profile)` text of the TypeScript object
/// (provider-specific key order). Digests and backend comparisons must use `json`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BuiltProfile {
    pub profile: TerminalProfile,
    pub json: String,
}

impl BuiltProfile {
    pub(crate) fn new(entries: Vec<(&str, Js)>) -> Result<Self> {
        let value = Js::Obj(
            entries
                .into_iter()
                .map(|(k, v)| (k.to_owned(), v))
                .collect(),
        );
        let json = value.stringify();
        let text = |k: &str| {
            value
                .get(k)
                .and_then(Js::as_str)
                .unwrap_or_default()
                .to_owned()
        };
        let argv = match value.get("argv") {
            Some(Js::Arr(items)) => items
                .iter()
                .filter_map(Js::as_str)
                .map(str::to_owned)
                .collect(),
            _ => Vec::new(),
        };
        let profile = TerminalProfile {
            id: text("id"),
            project_id: text("projectId"),
            executable: text("executable"),
            executable_sha256: text("executableSha256"),
            executable_version: text("executableVersion"),
            argv,
            cwd: text("cwd"),
            environment_profile: text("environmentProfile"),
            permissions: text("permissions"),
            cli_authorization_scope: value
                .get("cliAuthorizationScope")
                .and_then(Js::as_str)
                .map(str::to_owned),
        };
        Ok(BuiltProfile { profile, json })
    }
}

/// `JSON.stringify(profiles)` of a profile array.
pub fn profiles_json(profiles: &[BuiltProfile]) -> String {
    format!(
        "[{}]",
        profiles
            .iter()
            .map(|p| p.json.as_str())
            .collect::<Vec<_>>()
            .join(",")
    )
}

/// `validateTerminalPreparationBinding(binding, project)`. The binding reads the observer
/// catalogue and Feature store (`preparation-context.ts`), which belong to lane L4; the
/// dispatcher supplies that implementation. `None` must always succeed.
pub trait PreparationValidator {
    fn validate(&self, binding: Option<&PreparationBinding>, project: &str) -> Result<()>;
}

/// Refuses every preparation binding (fail closed) until the Feature store port exists.
pub struct NoPreparationStore;

impl PreparationValidator for NoPreparationStore {
    fn validate(&self, binding: Option<&PreparationBinding>, _project: &str) -> Result<()> {
        match binding {
            None => Ok(()),
            Some(_) => Err(ProfileError::refused(
                "Workspace or Feature changed; reload terminal preparation",
            )),
        }
    }
}

/// `interactiveProvider`.
pub fn interactive_provider(config: &InteractiveConfig) -> &'static str {
    match config {
        InteractiveConfig::Codex(_) => "codex",
        InteractiveConfig::Claude(_) => "claude",
        InteractiveConfig::OpenCode(_) => "opencode",
    }
}

/// The manifest bytes (`terminalFile(file, true)`); `pty-backend.ts` compares them again in
/// `validate` and binds the lifecycle receipt to their digest.
pub fn manifest_source(file: &str) -> Result<Vec<u8>> {
    terminal_file(file, true, DEFAULT_FILE_BUDGET, None)
}

/// `terminalDigest(terminalFile(file, true))` (receipt `configDigest`).
pub fn manifest_config_digest(file: &str) -> Result<String> {
    manifest_source(file).map(terminal_digest)
}

/// `readInteractiveTerminalConfig(file)`.
pub fn read_interactive_terminal_config(
    file: &str,
    prep: &dyn PreparationValidator,
) -> Result<InteractiveConfig> {
    let bytes = manifest_source(file)?;
    parse_and_validate_interactive_config(&bytes, prep)
}

/// `readInteractiveTerminalConfig` on already read manifest bytes.
pub fn parse_and_validate_interactive_config(
    bytes: &[u8],
    prep: &dyn PreparationValidator,
) -> Result<InteractiveConfig> {
    let raw = js::parse_bytes(bytes).map_err(ProfileError::schema)?;
    match raw.get("version") {
        Some(Js::Num(v)) if *v == 3.0 => {
            let config = parse_opencode_config(&raw)?;
            validate_managed_open_code_config(&config, prep)?;
            Ok(InteractiveConfig::OpenCode(config))
        }
        Some(Js::Num(v)) if *v == 2.0 => {
            let config = parse_claude_config(&raw)?;
            validate_managed_claude_config(&config, prep)?;
            validate_claude_owned_hooks(&config)?;
            Ok(InteractiveConfig::Claude(config))
        }
        _ => {
            let config = parse_codex_config(&raw)?;
            validate_managed_codex_config(&config, prep)?;
            Ok(InteractiveConfig::Codex(config))
        }
    }
}

/// `interactiveTerminalProfiles(config, mcp)`.
pub fn interactive_terminal_profiles(
    config: &InteractiveConfig,
    mcp: Option<&McpLaunch>,
    prep: &dyn PreparationValidator,
) -> Result<Vec<BuiltProfile>> {
    prep.validate(config.preparation(), config.project())?;
    match config {
        InteractiveConfig::Codex(c) => managed_codex_profiles(c, mcp, prep),
        InteractiveConfig::OpenCode(c) => open_code_terminal_profiles(c, mcp),
        InteractiveConfig::Claude(c) => claude_terminal_profiles(c, mcp),
    }
}

/// `interactiveTerminalEnvironment(config, mcp)` in insertion order. The PTY must pass it
/// through unchanged (no injected `SHELL`).
pub fn interactive_terminal_environment(
    config: &InteractiveConfig,
    mcp: Option<&McpLaunch>,
) -> Result<Vec<(String, String)>> {
    match config {
        InteractiveConfig::Codex(c) => managed_codex_environment(c),
        InteractiveConfig::OpenCode(c) => open_code_terminal_environment(c, mcp),
        InteractiveConfig::Claude(c) => claude_terminal_environment(c),
    }
}

/// Profiles plus the environment, as [`LaunchPlan`]s, with the exact profile JSON.
pub fn interactive_launch_plans(
    config: &InteractiveConfig,
    mcp: Option<&McpLaunch>,
    prep: &dyn PreparationValidator,
) -> Result<Vec<(LaunchPlan, String)>> {
    let profiles = interactive_terminal_profiles(config, mcp, prep)?;
    let env = interactive_terminal_environment(config, mcp)?;
    Ok(profiles
        .into_iter()
        .map(|built| {
            (
                LaunchPlan {
                    profile: built.profile,
                    env: env.clone(),
                },
                built.json,
            )
        })
        .collect())
}
