//! Port of the profile/environment parts of `codex-profile.ts`. The filesystem checks live in
//! [`super::fsx`].
use super::config::{parse_codex_config, CodexConfig, McpLaunch};
use super::fsx::{
    lstat, terminal_directory, terminal_executable_sha256, terminal_file, DEFAULT_FILE_BUDGET,
};
use super::interactive::{BuiltProfile, PreparationValidator};
use super::js::{self, quote, Js};
use super::local_cli_path::terminal_tool_path;
use super::model::{terminal_model_arguments, validate_terminal_model_selection};
use super::nodepath::{contains, join2};
use super::{terminal_digest, ProfileError, Result};
use std::os::unix::fs::MetadataExt;

/// `assertSeparateTerminalState`.
pub fn assert_separate_terminal_state(project: &str, state: &str) -> Result<()> {
    if contains(project, state) {
        return Err(ProfileError::refused(
            "Managed state must be outside the project",
        ));
    }
    Ok(())
}

/// `parseManagedCodexConfigBytes`.
pub fn parse_managed_codex_config_bytes(bytes: &[u8]) -> Result<CodexConfig> {
    if bytes.len() > 16 * 1024 {
        return Err(ProfileError::refused("Terminal config too large"));
    }
    parse_codex_config(&js::parse_bytes(bytes).map_err(ProfileError::schema)?)
}

/// `parseManagedCodexConfigFile`.
pub fn parse_managed_codex_config_file(file: &str) -> Result<CodexConfig> {
    parse_managed_codex_config_bytes(&terminal_file(file, true, DEFAULT_FILE_BUDGET, None)?)
}

/// `readManagedCodexConfig`.
pub fn read_managed_codex_config(
    file: &str,
    prep: &dyn PreparationValidator,
) -> Result<CodexConfig> {
    let config = parse_managed_codex_config_file(file)?;
    validate_managed_codex_config(&config, prep)?;
    Ok(config)
}

/// `managedCodexSettings`: exact `codex/config.toml` content of a managed (separate) state.
pub fn managed_codex_settings(config: &CodexConfig) -> String {
    [
        "cli_auth_credentials_store = \"file\"".to_owned(),
        "sandbox_mode = \"read-only\"".to_owned(),
        "approval_policy = \"on-request\"".to_owned(),
        "check_for_update_on_startup = false".to_owned(),
        "[shell_environment_policy]".to_owned(),
        "inherit = \"none\"".to_owned(),
        format!("[projects.{}]", quote(&config.project)),
        "trust_level = \"untrusted\"".to_owned(),
        String::new(),
    ]
    .join("\n")
}

fn codex_mcp_version(version: &str) -> bool {
    version == "0.162.1" || version == "codex-cli 0.162.1"
}

/// `validateManagedCodexConfig`.
pub fn validate_managed_codex_config(
    config: &CodexConfig,
    prep: &dyn PreparationValidator,
) -> Result<()> {
    validate_terminal_model_selection(config.model.as_ref())?;
    prep.validate(config.preparation.as_ref(), &config.project)?;
    terminal_tool_path(config.tool_path.as_deref())?;
    terminal_directory(&config.project, false)?;
    terminal_directory(&config.state, true)?;
    assert_separate_terminal_state(&config.project, &config.state)?;
    if config.interactive.is_some() && config.authentication.is_none() {
        return Err(ProfileError::refused(
            "Interactive native reuse requires existing authentication",
        ));
    }
    if config.interactive.as_ref().is_some_and(|i| i.mcp)
        && !codex_mcp_version(&config.executable_version)
    {
        return Err(ProfileError::refused(
            "No reviewed interactive MCP configuration for this Codex version",
        ));
    }
    if let Some(auth) = &config.authentication {
        terminal_directory(&auth.home, false)?;
        terminal_directory(&auth.codex_home, false)?;
        for shared in [&auth.home, &auth.codex_home] {
            if contains(&config.state, shared) {
                return Err(ProfileError::refused(
                    "Existing authentication home cannot be inside managed state",
                ));
            }
        }
    }
    for directory in ["home", "codex", "tmp"] {
        terminal_directory(&join2(&config.state, directory), true)?;
    }
    let settings = terminal_file(
        &join2(&config.state, "codex/config.toml"),
        true,
        DEFAULT_FILE_BUDGET,
        None,
    )?;
    if String::from_utf8_lossy(&settings) != managed_codex_settings(config) {
        return Err(ProfileError::refused("Managed Codex settings changed"));
    }
    for executable in [&config.executable, &config.node] {
        let info = lstat(&executable.path)?;
        if info.mode() & 0o111 == 0
            || terminal_executable_sha256(&executable.path)? != executable.sha256
        {
            return Err(ProfileError::refused("Terminal executable changed"));
        }
    }
    Ok(())
}

/// `mcp_servers.<name>={...}` inline table (`codexMcpArguments`).
fn codex_mcp_arguments(config: &CodexConfig, mcp: &McpLaunch) -> Result<Vec<String>> {
    if !codex_mcp_version(&config.executable_version) {
        return Err(ProfileError::refused("Unreviewed Codex MCP version"));
    }
    if terminal_digest(terminal_file(
        &mcp.relay.path,
        false,
        16 * 1024 * 1024,
        None,
    )?) != mcp.relay.sha256
    {
        return Err(ProfileError::refused("MCP relay changed"));
    }
    Ok(vec![
        "-c".into(),
        format!(
            "mcp_servers.{}={{command={},args=[{}],env={{ORQST_SOCKET_PATH={},ORQST_CAP_FILE={}}},startup_timeout_sec=10,tool_timeout_sec=125,required=true}}",
            mcp.server_name,
            quote(&config.node.path),
            quote(&mcp.relay.path),
            quote(&mcp.socket_path),
            quote(&mcp.capability_file),
        ),
    ])
}

/// `nativeCodexOverrides`.
fn native_codex_overrides(config: &CodexConfig) -> Vec<String> {
    let codex = quote(&join2(&config.state, "codex"));
    vec![
        format!("sqlite_home={codex}"),
        format!("log_dir={codex}"),
        "history.persistence=\"none\"".into(),
        "analytics.enabled=false".into(),
        "feedback.enabled=false".into(),
        "otel.exporter=\"none\"".into(),
        "otel.trace_exporter=\"none\"".into(),
        "otel.metrics_exporter=\"none\"".into(),
        "check_for_update_on_startup=false".into(),
        "features.hooks=false".into(),
        "features.remote_plugin=false".into(),
        "features.shell_snapshot=false".into(),
        "features.memories=false".into(),
        "features.multi_agent=false".into(),
        "notify=[]".into(),
        "shell_environment_policy.inherit=\"none\"".into(),
    ]
}

fn with_c(values: Vec<String>) -> Vec<String> {
    values
        .into_iter()
        .flat_map(|v| ["-c".to_owned(), v])
        .collect()
}

/// `managedCodexProfiles(config, mcp)`.
pub fn managed_codex_profiles(
    config: &CodexConfig,
    mcp: Option<&McpLaunch>,
    prep: &dyn PreparationValidator,
) -> Result<Vec<BuiltProfile>> {
    prep.validate(config.preparation.as_ref(), &config.project)?;
    if config.authentication.is_some() && config.interactive.is_none() {
        return Err(ProfileError::refused(
            "Existing authentication is supported only by the structured runtime unless interactive native session writes are acknowledged",
        ));
    }
    let opted = config.interactive.as_ref().is_some_and(|i| i.mcp);
    if mcp.is_some() && !opted {
        return Err(ProfileError::refused("Interactive MCP not opted in"));
    }
    if opted && mcp.is_none() {
        return Err(ProfileError::refused(
            "Interactive MCP composition required",
        ));
    }
    let mcp_arguments = match mcp {
        Some(mcp) => codex_mcp_arguments(config, mcp)?,
        None => Vec::new(),
    };
    let scope = format!(
        "codex-read-only-on-request-v1:{}:{}",
        if config.authentication.is_some() {
            "native"
        } else {
            "managed"
        },
        if mcp.is_some() {
            "orqst-mcp-configured"
        } else {
            "native-mcp"
        }
    );
    let common_permissions = format!(
        "Tool PATH: {}. Native same-user process, NOT a container. Fixed read-only/on-request defaults; provider UI can change permissions. Network for provider/auth. 30 minute owned-process lifetime, then TERM/KILL; no descendant containment. No resume/adoption.",
        terminal_tool_path(config.tool_path.as_deref())?
    );
    let environment_profile = if config.authentication.is_some() {
        "native-auth-config-sessions-no-inherited-credentials-v1"
    } else {
        "managed-home-no-inherited-credentials-v1"
    };
    // Key order of `{ ...common, id, argv, permissions? }`.
    let build = |id: &str, argv: Vec<String>, permissions: &str| {
        BuiltProfile::new(vec![
            ("cliAuthorizationScope", Js::str(&scope)),
            ("projectId", Js::Str(terminal_digest(&config.project))),
            ("executable", Js::str(&config.executable.path)),
            ("executableSha256", Js::str(&config.executable.sha256)),
            ("executableVersion", Js::str(&config.executable_version)),
            ("cwd", Js::str(&config.project)),
            ("environmentProfile", Js::str(environment_profile)),
            ("permissions", Js::str(permissions)),
            ("id", Js::str(id)),
            ("argv", Js::strs(argv)),
        ])
    };
    let base_argv = |model: Vec<String>| -> Vec<String> {
        let mut argv = model;
        argv.extend(
            [
                "--no-daemon",
                "--sandbox",
                "read-only",
                "--ask-for-approval",
                "on-request",
            ]
            .map(str::to_owned),
        );
        argv
    };
    if config.authentication.is_some() {
        let mut argv = base_argv(terminal_model_arguments(config.model.as_ref())?);
        argv.extend(with_c(native_codex_overrides(config)));
        argv.extend(mcp_arguments);
        let hub = config.interactive.as_ref().is_some_and(|i| i.hub);
        let mcp_text = match (mcp.is_some(), hub) {
            (false, _) => "",
            (true, true) => "Per-instance ORQST MCP connects to a private local relay. ORQST messaging: free between terminals of the same Feature, refused across Features; metadata-only audit; content from other terminals is untrusted data. Inherited MCPs remain enabled. ",
            (true, false) => "Per-instance ORQST MCP connects to a private local relay; task delegation requires separate native authorization after both starts. Inherited MCPs remain enabled. ",
        };
        let permissions = format!(
            "Existing native login, config, MCPs, skills and session root are SHARED. Codex may refresh credentials and write NEW sessions; not ephemeral. No resume/adoption or automatic task. {mcp_text}{common_permissions}"
        );
        return Ok(vec![build("codex-terminal-v1", argv, &permissions)?]);
    }
    let login = build(
        "codex-login-v1",
        [
            "-c",
            "cli_auth_credentials_store=\"file\"",
            "login",
            "--device-auth",
        ]
        .map(str::to_owned)
        .to_vec(),
        &format!("Separate device login only. {common_permissions}"),
    )?;
    let mut argv = base_argv(terminal_model_arguments(config.model.as_ref())?);
    argv.extend([
        "-c".to_owned(),
        "cli_auth_credentials_store=\"file\"".to_owned(),
    ]);
    let terminal = build("codex-terminal-v1", argv, &common_permissions)?;
    Ok(vec![login, terminal])
}

/// `managedCodexEnvironment`, in insertion order.
pub fn managed_codex_environment(config: &CodexConfig) -> Result<Vec<(String, String)>> {
    let auth = config.authentication.as_ref();
    Ok(vec![
        (
            "HOME".into(),
            auth.map_or_else(|| join2(&config.state, "home"), |a| a.home.clone()),
        ),
        (
            "CODEX_HOME".into(),
            auth.map_or_else(|| join2(&config.state, "codex"), |a| a.codex_home.clone()),
        ),
        ("CODEX_SQLITE_HOME".into(), join2(&config.state, "codex")),
        ("TMPDIR".into(), join2(&config.state, "tmp")),
        (
            "XDG_CONFIG_HOME".into(),
            join2(&config.state, "home/.config"),
        ),
        ("XDG_CACHE_HOME".into(), join2(&config.state, "home/.cache")),
        (
            "PATH".into(),
            terminal_tool_path(config.tool_path.as_deref())?,
        ),
        ("LANG".into(), "en_US.UTF-8".into()),
        ("LC_ALL".into(), "en_US.UTF-8".into()),
        ("TERM".into(), "xterm-256color".into()),
    ])
}

/// `structuredCodexArguments`.
pub fn structured_codex_arguments(config: &CodexConfig) -> Vec<String> {
    let tail = ["app-server", "--listen", "stdio://"].map(str::to_owned);
    if config.authentication.is_none() {
        let mut argv = vec![
            "-c".to_owned(),
            "cli_auth_credentials_store=\"file\"".to_owned(),
        ];
        argv.extend(tail);
        return argv;
    }
    let mut argv = with_c(native_codex_overrides(config));
    argv.extend(tail);
    argv
}

/// The separate-login metadata check of `pty-backend.ts` `validate` for `codex-terminal-v1`:
/// `codex/auth.json` must be a private regular file of this user. Never reads it.
/// A missing file propagates as `Io("ENOENT")`, as `lstatSync` throws in TypeScript.
pub fn codex_managed_auth_metadata_ok(config: &CodexConfig) -> Result<bool> {
    let auth = lstat(&join2(&config.state, "codex/auth.json"))?;
    Ok(auth.is_file()
        && !auth.file_type().is_symlink()
        && auth.uid() == super::fsx::getuid()
        && auth.mode() & 0o077 == 0)
}
