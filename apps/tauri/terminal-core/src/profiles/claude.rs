//! Claude parts of `interactive-profile.ts`.
use super::codex::assert_separate_terminal_state;
use super::config::{ClaudeConfig, McpLaunch};
use super::fsx::{terminal_directory, terminal_executable_sha256, terminal_file};
use super::hooks::{claude_owned_hooks_path, validate_claude_owned_hooks};
use super::interactive::{BuiltProfile, PreparationValidator};
use super::js::Js;
use super::local_cli_path::terminal_tool_path;
use super::mcp::{
    claude_interactive_mcp_configuration, reviewed_claude_mcp_binary, McpReviewInput,
    REVIEWED_CLAUDE_MCP, REVIEWED_CLAUDE_TUI,
};
use super::model::{terminal_model_arguments, validate_terminal_model_selection};
use super::nodepath::{contains, join2};
use super::{terminal_digest, ProfileError, Result};

/// `validateClaudeLaunchContract`.
pub fn validate_claude_launch_contract(config: &ClaudeConfig) -> Result<()> {
    let mcp = config.interactive.mcp;
    let pin = if mcp {
        reviewed_claude_mcp_binary(&config.executable_version, &config.executable.sha256)
            .unwrap_or(REVIEWED_CLAUDE_MCP)
    } else if config.executable_version == REVIEWED_CLAUDE_TUI.version {
        REVIEWED_CLAUDE_TUI
    } else {
        REVIEWED_CLAUDE_MCP
    };
    if config.executable_version != pin.version || config.executable.sha256 != pin.sha256 {
        return Err(ProfileError::refused(if mcp {
            "No reviewed Claude MCP launch contract for this version/hash"
        } else {
            "No reviewed launch contract for this exact Claude binary version/hash"
        }));
    }
    if config.owned_hooks
        && (config.executable_version != "2.1.318" || (mcp && !config.interactive.hub))
    {
        return Err(ProfileError::refused(
            "Owned hooks require the reviewed Claude TUI contract",
        ));
    }
    Ok(())
}

/// `validateManagedClaudeConfig`.
pub fn validate_managed_claude_config(
    config: &ClaudeConfig,
    prep: &dyn PreparationValidator,
) -> Result<()> {
    validate_terminal_model_selection(config.model.as_ref())?;
    prep.validate(config.preparation.as_ref(), &config.project)?;
    terminal_tool_path(config.tool_path.as_deref())?;
    validate_claude_launch_contract(config)?;
    if config.interactive.mcp != config.interactive.strict_mcp_acknowledged {
        return Err(ProfileError::refused(
            "Claude MCP requires explicit strict-MCP exclusion acknowledgment",
        ));
    }
    terminal_directory(&config.project, false)?;
    terminal_directory(&config.state, true)?;
    terminal_directory(&join2(&config.state, "tmp"), true)?;
    assert_separate_terminal_state(&config.project, &config.state)?;
    let auth = &config.authentication;
    for directory in [Some(&auth.home), auth.claude_config_directory.as_ref()]
        .into_iter()
        .flatten()
    {
        if directory.is_empty() {
            continue;
        }
        terminal_directory(directory, false)?;
        if contains(&config.state, directory) {
            return Err(ProfileError::refused(
                "Native identity cannot be inside managed state",
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

pub(crate) fn relay_unchanged(mcp: &McpLaunch) -> Result<()> {
    if terminal_digest(terminal_file(
        &mcp.relay.path,
        false,
        16 * 1024 * 1024,
        None,
    )?) != mcp.relay.sha256
    {
        return Err(ProfileError::refused("MCP relay changed"));
    }
    Ok(())
}

/// Claude branch of `interactiveTerminalProfiles` (after the preparation check).
pub fn claude_terminal_profiles(
    config: &ClaudeConfig,
    mcp: Option<&McpLaunch>,
) -> Result<Vec<BuiltProfile>> {
    validate_claude_launch_contract(config)?;
    validate_claude_owned_hooks(config)?;
    if config.interactive.mcp != mcp.is_some()
        || (mcp.is_some() && !config.interactive.strict_mcp_acknowledged)
    {
        return Err(ProfileError::refused(
            "Claude MCP composition/acknowledgment mismatch",
        ));
    }
    if let Some(mcp) = mcp {
        relay_unchanged(mcp)?;
    }
    let candidate = match mcp {
        Some(mcp) => Some(claude_interactive_mcp_configuration(
            &McpReviewInput {
                executable_version: &config.executable_version,
                executable_sha256: &config.executable.sha256,
                node_path: &config.node.path,
                mcp,
            },
            &config.session_id,
        )?),
        None => None,
    };
    let mut argv = match &candidate {
        Some(candidate) => candidate.argv.clone(),
        None => vec!["--session-id".to_owned(), config.session_id.clone()],
    };
    if config.owned_hooks {
        argv.extend(["--settings".to_owned(), claude_owned_hooks_path(config)]);
    }
    argv.extend(terminal_model_arguments(config.model.as_ref())?);
    let scope = format!(
        "claude-native-v1:{}{}",
        if mcp.is_some() {
            "orqst-mcp-configured"
        } else {
            "native-mcp"
        },
        if config.owned_hooks {
            ":orqst-owned-hooks-v1"
        } else {
            ""
        }
    );
    let mut permissions = format!(
        "Tool PATH: {}. ",
        terminal_tool_path(config.tool_path.as_deref())?
    );
    permissions.push_str("Native same-user Claude process, NOT a container or read-only sandbox. Native HOME/config/Keychain identity, hooks, plugins, policy and session writes stay shared. Credential refresh is provider-owned. One dispatch per manifest with a new UUID; existing UUIDs are rejected by the reviewed CLI. No prompt, resume, adoption, permission bypass or automatic login. 30 minute owned-process deadline; no descendant containment. ");
    if config.owned_hooks {
        permissions.push_str("ORQST adds private metadata-only prompt/notification/stop hooks through an additional owned settings file; existing settings and policy remain effective. ");
    }
    if mcp.is_some() {
        permissions.push_str("Only supplied MCP servers are selected: native MCP definitions are excluded. Strict startup/project approval can block Claude. ");
        permissions.push_str(if config.interactive.hub {
            "ORQST messaging: free between terminals of the same Feature, refused across Features; metadata-only audit; content from other terminals is untrusted data. "
        } else {
            "ORQST task grant requires separate native authorization. "
        });
    } else {
        permissions.push_str("Native MCP definitions may start. ");
    }
    permissions.push_str("Login, native focus, MCP tool/timeout behavior and inference acceptance remain unvalidated.");
    Ok(vec![BuiltProfile::new(vec![
        ("id", Js::str("claude-terminal-v1")),
        ("projectId", Js::Str(terminal_digest(&config.project))),
        ("executable", Js::str(&config.executable.path)),
        ("executableSha256", Js::str(&config.executable.sha256)),
        ("executableVersion", Js::str(&config.executable_version)),
        ("cwd", Js::str(&config.project)),
        ("argv", Js::strs(argv)),
        (
            "environmentProfile",
            Js::str("claude-native-identity-no-inherited-credentials-v1"),
        ),
        ("cliAuthorizationScope", Js::Str(scope)),
        ("permissions", Js::Str(permissions)),
    ])?])
}

/// Claude branch of `interactiveTerminalEnvironment`, in insertion order. Never sets `SHELL`.
pub fn claude_terminal_environment(config: &ClaudeConfig) -> Result<Vec<(String, String)>> {
    let mut env = vec![("HOME".to_owned(), config.authentication.home.clone())];
    if let Some(dir) = config
        .authentication
        .claude_config_directory
        .as_ref()
        .filter(|d| !d.is_empty())
    {
        env.push(("CLAUDE_CONFIG_DIR".into(), dir.clone()));
    }
    env.extend([
        ("TMPDIR".to_owned(), join2(&config.state, "tmp")),
        (
            "PATH".to_owned(),
            terminal_tool_path(config.tool_path.as_deref())?,
        ),
        ("LANG".to_owned(), "en_US.UTF-8".to_owned()),
        ("LC_ALL".to_owned(), "en_US.UTF-8".to_owned()),
        ("TERM".to_owned(), "xterm-256color".to_owned()),
        ("DISABLE_AUTOUPDATER".to_owned(), "1".to_owned()),
        (
            "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC".to_owned(),
            "1".to_owned(),
        ),
    ]);
    if config.interactive.mcp {
        env.push(("MCP_TIMEOUT".into(), "10000".into()));
        env.push(("MCP_TOOL_TIMEOUT".into(), "125000".into()));
    }
    Ok(env)
}
