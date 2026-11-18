//! Port of `antigravity-profile.ts` and `antigravity-launch-plan.ts`. Never opens native
//! `~/.gemini` databases or credential files.
use super::cli_review::accepted_review;
use super::codex::assert_separate_terminal_state;
use super::config::{model_value, AntigravityConfig, McpLaunch};
use super::fsx::{terminal_directory, terminal_executable_sha256};
use super::interactive::{BuiltProfile, PreparationValidator};
use super::js::Js;
use super::local_cli_path::{terminal_tool_path, LEGACY_TERMINAL_PATH};
use super::mcp::REVIEWED_ANTIGRAVITY;
use super::model::{terminal_model_arguments, validate_terminal_model_selection};
use super::nodepath::{contains, join2, relative};
use super::validate::slash_path;
use super::{terminal_digest, ProfileError, Result};

/// Input of `antigravityInteractiveLaunchPlan`.
pub struct AntigravityLaunchInput<'a> {
    pub executable: &'a str,
    pub executable_version: &'a str,
    pub executable_sha256: &'a str,
    pub project: &'a str,
    pub home: &'a str,
    pub model: Option<Option<&'a str>>,
}

/// `antigravityInteractiveLaunchPlan`: an inspectable candidate, not an execution grant.
pub fn antigravity_interactive_launch_plan(
    input: &AntigravityLaunchInput,
) -> Result<(Js, Vec<(String, String)>)> {
    interactive_launch_plan(input, false)
}

fn interactive_launch_plan(
    input: &AntigravityLaunchInput,
    reviewed: bool,
) -> Result<(Js, Vec<(String, String)>)> {
    slash_path(&Js::str(input.executable), "executable")?;
    if !reviewed && input.executable_version != REVIEWED_ANTIGRAVITY.version {
        return Err(ProfileError::schema("executableVersion"));
    }
    if !reviewed && input.executable_sha256 != REVIEWED_ANTIGRAVITY.sha256 {
        return Err(ProfileError::schema("executableSha256"));
    }
    slash_path(&Js::str(input.project), "project")?;
    slash_path(&Js::str(input.home), "home")?;
    let argv: Vec<String> = match input.model.flatten() {
        Some(value) => vec!["--model".into(), model_value(&Js::str(value), "model")?],
        None => Vec::new(),
    };
    let environment: Vec<(String, String)> = vec![
        ("HOME".into(), input.home.to_owned()),
        ("PATH".into(), LEGACY_TERMINAL_PATH.into()),
        ("LANG".into(), "en_US.UTF-8".into()),
        ("LC_ALL".into(), "en_US.UTF-8".into()),
        ("TERM".into(), "xterm-256color".into()),
    ];
    let plan = Js::obj([
        ("version", Js::Num(1.0)),
        ("provider", Js::str("antigravity")),
        ("execution", Js::str("blocked")),
        ("launchGrantAvailable", Js::Bool(false)),
        ("providerAcceptance", Js::str("not_run")),
        ("authentication", Js::str("unknown")),
        ("executable", Js::str(input.executable)),
        ("executableVersion", Js::str(input.executable_version)),
        ("executableSha256", Js::str(input.executable_sha256)),
        ("cwd", Js::str(input.project)),
        ("argv", Js::strs(&argv)),
        (
            "environment",
            Js::obj(environment.iter().map(|(k, v)| (k.as_str(), Js::str(v)))),
        ),
        (
            "session",
            Js::obj([
                ("selection", Js::str("no_resume_or_conversation_argument")),
                ("nativeUiAcceptance", Js::str("not_run")),
            ]),
        ),
        (
            "mcpConfiguration",
            Js::str("unavailable_global_or_workspace_only"),
        ),
        (
            "blockers",
            Js::strs([
                "shared_native_gemini_state_requires_acknowledgment",
                "per_session_mcp_configuration_unavailable",
                "native_login_focus_and_provider_acceptance_pending",
            ]),
        ),
    ]);
    Ok((plan, environment))
}

fn set(environment: &mut Vec<(String, String)>, key: &str, value: String) {
    match environment.iter_mut().find(|(k, _)| k == key) {
        Some(entry) => entry.1 = value,
        None => environment.push((key.to_owned(), value)),
    }
}

/// `validateAntigravitySelection`: checks directories only, never `~/.gemini` databases or auth.
pub fn validate_antigravity_selection(
    config: &AntigravityConfig,
    prep: &dyn PreparationValidator,
) -> Result<()> {
    validate_terminal_model_selection(config.model.as_ref())?;
    prep.validate(config.preparation.as_ref(), &config.project)?;
    if (config.executable_version != REVIEWED_ANTIGRAVITY.version || config.executable.sha256 != REVIEWED_ANTIGRAVITY.sha256)
        && !accepted_review("antigravity", &config.executable, &config.executable_version, config.preparation.as_ref())
    {
        return Err(ProfileError::refused("No reviewed antigravity executable"));
    }
    terminal_tool_path(config.tool_path.as_deref())?;
    terminal_directory(&config.project, false)?;
    assert_separate_terminal_state(&config.project, &config.state)?;
    terminal_directory(&config.home, false)?;
    if contains(&config.state, &config.home) {
        return Err(ProfileError::refused(
            "Native identity cannot be inside managed state",
        ));
    }
    let native_gemini = join2(&config.home, ".gemini");
    for inside in [
        relative(&native_gemini, &config.state),
        relative(&config.state, &native_gemini),
    ] {
        if inside != ".." && !inside.starts_with("../") {
            return Err(ProfileError::refused(
                "Managed state overlaps native Antigravity state",
            ));
        }
    }
    for executable in [&config.executable, &config.node] {
        if terminal_executable_sha256(&executable.path)? != executable.sha256 {
            return Err(ProfileError::refused("Terminal executable changed"));
        }
    }
    Ok(())
}

/// `validateManagedAntigravityConfig`.
pub fn validate_managed_antigravity_config(
    config: &AntigravityConfig,
    prep: &dyn PreparationValidator,
) -> Result<()> {
    validate_antigravity_selection(config, prep)?;
    terminal_directory(&config.state, true)?;
    terminal_directory(&join2(&config.state, "tmp"), true)
}

/// `antigravityTerminalEnvironment`, in insertion order. Never sets `SHELL`.
pub fn antigravity_terminal_environment(
    config: &AntigravityConfig,
    mcp: Option<&McpLaunch>,
) -> Result<Vec<(String, String)>> {
    if mcp.is_some() {
        return Err(ProfileError::refused(
            "Antigravity has no per-session MCP launch contract",
        ));
    }
    validate_terminal_model_selection(config.model.as_ref())?;
    let (_, mut environment) = interactive_launch_plan(&AntigravityLaunchInput {
        executable: &config.executable.path,
        executable_version: &config.executable_version,
        executable_sha256: &config.executable.sha256,
        project: &config.project,
        home: &config.home,
        model: config.model.as_ref().map(|m| m.value.as_deref()),
    }, accepted_review("antigravity", &config.executable, &config.executable_version, config.preparation.as_ref()))?;
    set(
        &mut environment,
        "PATH",
        terminal_tool_path(config.tool_path.as_deref())?,
    );
    set(&mut environment, "TMPDIR", join2(&config.state, "tmp"));
    Ok(environment)
}

/// `antigravityTerminalProfiles` (after the preparation check).
pub fn antigravity_terminal_profiles(
    config: &AntigravityConfig,
    mcp: Option<&McpLaunch>,
) -> Result<Vec<BuiltProfile>> {
    if mcp.is_some() {
        return Err(ProfileError::refused(
            "Antigravity has no per-session MCP launch contract",
        ));
    }
    let argv = terminal_model_arguments(config.model.as_ref())?;
    let mut permissions = format!(
        "Tool PATH: {}. Native HOME: {}. ORQST state: {}. ",
        terminal_tool_path(config.tool_path.as_deref())?,
        config.home,
        config.state
    );
    permissions.push_str("Native same-user Antigravity (agy), NOT a sandbox. Existing HOME and ~/.gemini configuration, credentials, conversation SQLite database, plugins, skills, hooks and global MCP servers stay shared; no credentials are read or copied by ORQST. Startup writes under ~/.gemini/config and ~/.gemini/antigravity-cli and may refresh credentials or run configured hooks/MCPs. Per-session ORQST MCP relay is UNAVAILABLE because agy 1.5.10 only reads global ~/.gemini/config or workspace .agents plugins. No automatic ORQST prompt, resume, adoption or permission bypass. 30 minute owned-process deadline; no descendant containment. One dispatch per manifest. ");
    if let Some(model) = config.model.as_ref().and_then(|m| m.value.as_deref()) {
        permissions.push_str(&format!(
            "Requested initial CLI model: {} (unverified availability). ",
            Js::str(model).stringify()
        ));
    }
    permissions.push_str("Login, native focus and inference acceptance NOT RUN.");
    Ok(vec![BuiltProfile::new(vec![
        ("id", Js::str("antigravity-terminal-v1")),
        ("projectId", Js::Str(terminal_digest(&config.project))),
        ("executable", Js::str(&config.executable.path)),
        ("executableSha256", Js::str(&config.executable.sha256)),
        ("executableVersion", Js::str(&config.executable_version)),
        ("cwd", Js::str(&config.project)),
        ("argv", Js::strs(&argv)),
        (
            "environmentProfile",
            Js::str("antigravity-native-identity-no-inherited-credentials-v1"),
        ),
        (
            "cliAuthorizationScope",
            Js::str("antigravity-native-v1:native-mcp-only"),
        ),
        ("permissions", Js::Str(permissions)),
    ])?])
}
