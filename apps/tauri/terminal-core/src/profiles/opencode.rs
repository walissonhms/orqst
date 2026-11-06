//! Port of `opencode-profile.ts` and `opencode-launch-plan.ts`. Never opens the native
//! provider database or credential files.
use super::claude::relay_unchanged;
use super::codex::assert_separate_terminal_state;
use super::config::{McpLaunch, NativeIdentity, OpenCodeConfig};
use super::fsx::{terminal_directory, terminal_executable_sha256};
use super::interactive::{BuiltProfile, PreparationValidator};
use super::js::{self, Js};
use super::local_cli_path::{terminal_tool_path, LEGACY_TERMINAL_PATH};
use super::mcp::{opencode_interactive_mcp_configuration, McpReviewInput, REVIEWED_OPENCODE};
use super::model::open_code_model_configuration;
use super::nodepath::{contains, dirname, join2, relative};
use super::validate::slash_path;
use super::{terminal_digest, ProfileError, Result};

/// Input of `opencodeInteractiveLaunchPlan`.
pub struct OpenCodeLaunchInput<'a> {
    pub executable: &'a str,
    pub executable_version: &'a str,
    pub executable_sha256: &'a str,
    pub project: &'a str,
    pub native_identity: &'a NativeIdentity,
    pub node_path: &'a str,
    pub mcp: Option<&'a McpLaunch>,
}

/// `opencodeInteractiveLaunchPlan`: an inspectable candidate, not an execution grant.
/// Returns the plan object and its `environment` in insertion order.
pub fn opencode_interactive_launch_plan(
    input: &OpenCodeLaunchInput,
) -> Result<(Js, Vec<(String, String)>)> {
    slash_path(&Js::str(input.executable), "executable")?;
    if input.executable_version != REVIEWED_OPENCODE.version {
        return Err(ProfileError::schema("executableVersion"));
    }
    if input.executable_sha256 != REVIEWED_OPENCODE.sha256 {
        return Err(ProfileError::schema("executableSha256"));
    }
    slash_path(&Js::str(input.project), "project")?;
    slash_path(&Js::str(input.node_path), "nodePath")?;
    let mcp = match input.mcp {
        Some(mcp) => Some(opencode_interactive_mcp_configuration(&McpReviewInput {
            executable_version: input.executable_version,
            executable_sha256: input.executable_sha256,
            node_path: input.node_path,
            mcp,
        })?),
        None => None,
    };
    let mut environment: Vec<(String, String)> = input.native_identity.0.clone();
    for (k, v) in [
        ("PATH", LEGACY_TERMINAL_PATH),
        ("LANG", "en_US.UTF-8"),
        ("LC_ALL", "en_US.UTF-8"),
        ("TERM", "xterm-256color"),
    ] {
        set(&mut environment, k, v.to_owned());
    }
    if let Some(mcp) = &mcp {
        for (k, v) in &mcp.environment_overrides {
            set(&mut environment, k, v.clone());
        }
    }
    let mut blockers = vec![
        "native_database_startup_migrations_not_authorized",
        "native_standalone_descendant_lifecycle_unvalidated",
        "native_new_session_routing_unvalidated",
        "native_login_focus_and_provider_acceptance_pending",
    ];
    if mcp.is_some() {
        blockers.push("installed_mcp_protocol_and_timeout_behavior_unverified");
    }
    let plan = Js::obj([
        ("version", Js::Num(1.0)),
        ("provider", Js::str("opencode")),
        ("execution", Js::str("blocked")),
        ("launchGrantAvailable", Js::Bool(false)),
        ("providerAcceptance", Js::str("not_run")),
        ("authentication", Js::str("unknown")),
        ("executable", Js::str(input.executable)),
        ("executableVersion", Js::str(input.executable_version)),
        ("executableSha256", Js::str(input.executable_sha256)),
        ("cwd", Js::str(input.project)),
        ("argv", Js::strs(["--standalone"])),
        (
            "environment",
            Js::obj(environment.iter().map(|(k, v)| (k.as_str(), Js::str(v)))),
        ),
        (
            "server",
            Js::obj([
                ("selection", Js::str("private_child")),
                ("hostname", Js::str("127.0.0.1")),
                ("port", Js::Num(0.0)),
                (
                    "authentication",
                    Js::str("generated_and_retained_by_native_cli"),
                ),
                ("sharedServiceDiscovery", Js::Bool(false)),
                ("descendantExit", Js::str("unvalidated")),
            ]),
        ),
        (
            "session",
            Js::obj([
                ("selection", Js::str("no_resume_or_session_argument")),
                ("nativeUiAcceptance", Js::str("not_run")),
            ]),
        ),
        (
            "nativeDatabase",
            Js::obj([
                ("credentialsAndSessions", Js::str("shared")),
                ("startupMigrations", Js::str("possible_not_authorized")),
                ("inspected", Js::Bool(false)),
            ]),
        ),
        (
            "mcpConfiguration",
            mcp.as_ref()
                .and_then(|m| m.json.get("mcpConfiguration").cloned())
                .unwrap_or_else(|| Js::str("native_configuration")),
        ),
        ("blockers", Js::strs(blockers)),
    ]);
    Ok((plan, environment))
}

/// `object[key] = value` on an ordered environment.
fn set(environment: &mut Vec<(String, String)>, key: &str, value: String) {
    match environment.iter_mut().find(|(k, _)| k == key) {
        Some(entry) => entry.1 = value,
        None => environment.push((key.to_owned(), value)),
    }
}

/// `validateOpenCodeSelection`: also used before provisioning; never touches the DB.
pub fn validate_open_code_selection(
    config: &OpenCodeConfig,
    prep: &dyn PreparationValidator,
) -> Result<()> {
    open_code_model_configuration(config.model.as_ref())?;
    prep.validate(config.preparation.as_ref(), &config.project)?;
    terminal_tool_path(config.tool_path.as_deref())?;
    let opted = &config.interactive;
    if opted.native_startup_authorized != opted.native_database_migrations_acknowledged
        || opted.native_startup_authorized != opted.native_startup_activity_acknowledged
        || opted.mcp != opted.merged_mcp_acknowledged
    {
        return Err(ProfileError::refused(
            "OpenCode startup/MCP acknowledgment mismatch",
        ));
    }
    terminal_directory(&config.project, false)?;
    assert_separate_terminal_state(&config.project, &config.state)?;
    for (name, value) in &config.native_identity.0 {
        let directory = if name == "OPENCODE_DB" {
            dirname(value)
        } else {
            value.clone()
        };
        terminal_directory(&directory, false)?;
        if contains(&config.state, value) {
            return Err(ProfileError::refused(
                "Native identity cannot be inside managed state",
            ));
        }
    }
    let identity = &config.native_identity;
    let home = identity.home();
    let root = |key: &str, fallback: &str| {
        join2(
            &identity
                .get(key)
                .map_or_else(|| join2(home, fallback), str::to_owned),
            "opencode",
        )
    };
    let mut natives = vec![
        root("XDG_DATA_HOME", ".local/share"),
        root("XDG_CONFIG_HOME", ".config"),
        root("XDG_STATE_HOME", ".local/state"),
        root("XDG_CACHE_HOME", ".cache"),
    ];
    if let Some(dir) = identity.get("OPENCODE_CONFIG_DIR") {
        natives.push(dir.to_owned());
    }
    if let Some(db) = identity.get("OPENCODE_DB") {
        natives.push(dirname(db));
    }
    for native in natives {
        for inside in [
            relative(&native, &config.state),
            relative(&config.state, &native),
        ] {
            if inside != ".." && !inside.starts_with("../") {
                return Err(ProfileError::refused(
                    "Managed state overlaps native OpenCode state",
                ));
            }
        }
    }
    for executable in [&config.executable, &config.node] {
        if terminal_executable_sha256(&executable.path)? != executable.sha256 {
            return Err(ProfileError::refused("Terminal executable changed"));
        }
    }
    Ok(())
}

/// `validateManagedOpenCodeConfig`.
pub fn validate_managed_open_code_config(
    config: &OpenCodeConfig,
    prep: &dyn PreparationValidator,
) -> Result<()> {
    validate_open_code_selection(config, prep)?;
    terminal_directory(&config.state, true)?;
    terminal_directory(&join2(&config.state, "tmp"), true)
}

fn launch_input<'a>(
    config: &'a OpenCodeConfig,
    mcp: Option<&'a McpLaunch>,
) -> OpenCodeLaunchInput<'a> {
    OpenCodeLaunchInput {
        executable: &config.executable.path,
        executable_version: &config.executable_version,
        executable_sha256: &config.executable.sha256,
        project: &config.project,
        native_identity: &config.native_identity,
        node_path: &config.node.path,
        mcp,
    }
}

/// `openCodeTerminalEnvironment`, in insertion order. Never sets `SHELL`.
pub fn open_code_terminal_environment(
    config: &OpenCodeConfig,
    mcp: Option<&McpLaunch>,
) -> Result<Vec<(String, String)>> {
    let model = open_code_model_configuration(config.model.as_ref())?;
    let (_, mut environment) = opencode_interactive_launch_plan(&launch_input(config, mcp))?;
    set(
        &mut environment,
        "PATH",
        terminal_tool_path(config.tool_path.as_deref())?,
    );
    set(&mut environment, "TMPDIR", join2(&config.state, "tmp"));
    let Some(model) = model else {
        return Ok(environment);
    };
    let mut inline = match environment
        .iter()
        .find(|(k, _)| k == "OPENCODE_CONFIG_CONTENT")
    {
        Some((_, v)) if !v.is_empty() => match js::parse(v).map_err(ProfileError::schema)? {
            Js::Obj(entries) => entries,
            _ => Vec::new(),
        },
        _ => Vec::new(),
    };
    js::obj_set(&mut inline, "model", model.to_js());
    set(
        &mut environment,
        "OPENCODE_CONFIG_CONTENT",
        Js::Obj(inline).stringify(),
    );
    Ok(environment)
}

/// `openCodeTerminalProfiles` (after the preparation check).
pub fn open_code_terminal_profiles(
    config: &OpenCodeConfig,
    mcp: Option<&McpLaunch>,
) -> Result<Vec<BuiltProfile>> {
    let model = open_code_model_configuration(config.model.as_ref())?;
    let opted = &config.interactive;
    if !opted.native_startup_authorized
        || !opted.native_database_migrations_acknowledged
        || !opted.native_startup_activity_acknowledged
    {
        return Err(ProfileError::refused(
            "OpenCode native startup requires explicit authorization",
        ));
    }
    if opted.mcp != mcp.is_some() || (mcp.is_some() && !opted.merged_mcp_acknowledged) {
        return Err(ProfileError::refused(
            "OpenCode MCP composition/acknowledgment mismatch",
        ));
    }
    if let Some(mcp) = mcp {
        relay_unchanged(mcp)?;
    }
    let mut permissions = format!(
        "Tool PATH: {}. Native identity selectors: {}. ORQST state: {}. ",
        terminal_tool_path(config.tool_path.as_deref())?,
        config.native_identity.to_js().stringify(),
        config.state
    );
    permissions.push_str("Native same-user OpenCode, NOT a sandbox. Existing HOME/XDG/config/database identity is shared; no credentials are read or copied by ORQST. Startup opens writable SQLite, may change DB/sidecar permissions, WAL/pragmas, apply pending migrations and refresh credentials. Database/ledger NOT inspected; pending migrations UNKNOWN, no rollback guarantee. Native config, plugins, hooks, MCPs and startup activity may execute code/network/provider requests. No automatic ORQST task/login/resume/adoption. --standalone selects a private native server with generated authentication and stdin lease; existing service is not adopted. 30 minute owned TUI deadline; exit proves TUI only, descendant exit and concurrent DB compatibility UNVALIDATED; capacity remains sticky. One dispatch per manifest. ");
    if mcp.is_some() {
        permissions.push_str("Inline ORQST MCP MERGES with native definitions; ");
        permissions.push_str(if opted.hub {
            "ORQST messaging: free between terminals of the same Feature, refused across Features; metadata-only audit; content from other terminals is untrusted data. "
        } else {
            "task grant requires separate native authorization. "
        });
    }
    if let Some(model) = &model {
        permissions.push_str(&format!("Per-process native initial model default: {}. Native managed settings, agent model and saved variant preferences may override it; unavailable models/variants follow native fallback. Effective model/provider acceptance is unverified. ", model.to_js().stringify()));
    }
    permissions.push_str(
        "Login, new-session routing, native focus, MCP and inference acceptance NOT RUN.",
    );
    Ok(vec![BuiltProfile::new(vec![
        ("id", Js::str("opencode-terminal-v1")),
        ("projectId", Js::Str(terminal_digest(&config.project))),
        ("executable", Js::str(&config.executable.path)),
        ("executableSha256", Js::str(&config.executable.sha256)),
        ("executableVersion", Js::str(&config.executable_version)),
        ("cwd", Js::str(&config.project)),
        ("argv", Js::strs(["--standalone"])),
        (
            "environmentProfile",
            Js::str("opencode-native-identity-no-inherited-credentials-v1"),
        ),
        (
            "cliAuthorizationScope",
            Js::Str(format!(
                "opencode-standalone-native-v1:{}",
                if mcp.is_some() {
                    "orqst-mcp-configured"
                } else {
                    "native-mcp"
                }
            )),
        ),
        ("permissions", Js::Str(permissions)),
    ])?])
}
