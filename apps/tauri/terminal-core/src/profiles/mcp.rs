//! Port of `provider-mcp-config.ts`. Configuration review only: no filesystem, process or
//! credential access.
use super::config::McpLaunch;
use super::js::Js;
use super::validate::{bounded, hex64_pattern, uuid_pattern};
use super::{ProfileError, Result};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ReviewedBinary {
    pub version: &'static str,
    pub sha256: &'static str,
}

/// `reviewedProviderMcpBinaries.claude`.
pub const REVIEWED_CLAUDE_MCP: ReviewedBinary = ReviewedBinary {
    version: "2.1.178",
    sha256: "473495d0c15d6616cd0870480db5eb8aa0402fe4f8ead3277a1b521e94110309",
};
/// `reviewedProviderMcpBinaries.opencode`.
pub const REVIEWED_OPENCODE: ReviewedBinary = ReviewedBinary {
    version: "2.2.5",
    sha256: "abe4d88594bffb12b364375b8a6732d2d1f7a977195ed1a35c5c76f8e89c9e0e",
};
/// `reviewedClaudeTuiBinary` (`interactive-profile.ts`).
pub const REVIEWED_CLAUDE_TUI: ReviewedBinary = ReviewedBinary {
    version: "2.1.318",
    sha256: "677a2ea7bf576cedd20e191d973914ed8a41796f53a63b1923381ddc4d5b5e7d",
};
/// `reviewedClaudeMcpBinaries`.
pub const REVIEWED_CLAUDE_MCP_BINARIES: [ReviewedBinary; 2] = [
    REVIEWED_CLAUDE_MCP,
    ReviewedBinary {
        version: "2.1.318",
        sha256: "677a2ea7bf576cedd20e191d973914ed8a41796f53a63b1923381ddc4d5b5e7d",
    },
];

pub fn reviewed_claude_mcp_binary(version: &str, sha256: &str) -> Option<ReviewedBinary> {
    REVIEWED_CLAUDE_MCP_BINARIES
        .iter()
        .copied()
        .find(|b| b.version == version && b.sha256 == sha256)
}

const COMMON_BLOCKERS: [&str; 5] = [
    "native_launch_grant_required",
    "installed_mcp_protocol_unverified",
    "native_login_identity_unvalidated",
    "shared_native_session_writes_require_acknowledgment",
    "native_focus_and_provider_acceptance_pending",
];

/// The validated input of `claudeInteractiveMcpConfiguration`/`opencodeInteractiveMcpConfiguration`.
pub struct McpReviewInput<'a> {
    pub executable_version: &'a str,
    pub executable_sha256: &'a str,
    pub node_path: &'a str,
    pub mcp: &'a McpLaunch,
}

fn check_input(input: &McpReviewInput) -> Result<()> {
    bounded(
        &Js::str(input.executable_version),
        "executableVersion",
        1,
        64,
    )?;
    if !hex64_pattern().is_match(input.executable_sha256) {
        return Err(ProfileError::schema("executableSha256"));
    }
    super::validate::slash_path(&Js::str(input.node_path), "nodePath")?;
    Ok(())
}

fn not_reviewed() -> ProfileError {
    ProfileError::refused("No reviewed MCP configuration for this exact provider binary")
}

/// Result of `claudeInteractiveMcpConfiguration`.
#[derive(Clone, Debug, PartialEq)]
pub struct ClaudeMcpConfiguration {
    pub argv: Vec<String>,
    pub environment_overrides: Vec<(String, String)>,
    pub json: Js,
}

pub fn claude_interactive_mcp_configuration(
    input: &McpReviewInput,
    session_id: &str,
) -> Result<ClaudeMcpConfiguration> {
    check_input(input)?;
    if !uuid_pattern().is_match(session_id) {
        return Err(ProfileError::schema("sessionId"));
    }
    if reviewed_claude_mcp_binary(input.executable_version, input.executable_sha256).is_none() {
        return Err(not_reviewed());
    }
    let mcp = input.mcp;
    let config = Js::obj([(
        "mcpServers",
        Js::obj([(
            mcp.server_name.as_str(),
            Js::obj([
                ("type", Js::str("stdio")),
                ("command", Js::str(input.node_path)),
                ("args", Js::strs([&mcp.relay.path])),
                (
                    "env",
                    Js::obj([
                        ("ORQST_SOCKET_PATH", Js::str(&mcp.socket_path)),
                        ("ORQST_CAP_FILE", Js::str(&mcp.capability_file)),
                    ]),
                ),
            ]),
        )]),
    )]);
    let argv = vec![
        "--strict-mcp-config".to_owned(),
        "--mcp-config".to_owned(),
        config.stringify(),
        "--session-id".to_owned(),
        session_id.to_owned(),
    ];
    let environment_overrides = vec![
        ("MCP_TIMEOUT".to_owned(), "10000".to_owned()),
        ("MCP_TOOL_TIMEOUT".to_owned(), "125000".to_owned()),
    ];
    let mut blockers: Vec<&str> = COMMON_BLOCKERS.to_vec();
    blockers.extend([
        "strict_mcp_exclusion_requires_acknowledgment",
        "strict_project_mcp_approval_can_still_block_claude",
    ]);
    let json = Js::obj([
        ("provider", Js::str("claude")),
        ("executableVersion", Js::str(input.executable_version)),
        (
            "evidence",
            Js::str("passive_binary_metadata_and_official_documentation"),
        ),
        ("execution", Js::str("blocked")),
        ("providerAcceptance", Js::str("not_run")),
        ("argv", Js::strs(&argv)),
        (
            "environmentOverrides",
            Js::obj(
                environment_overrides
                    .iter()
                    .map(|(k, v)| (k.as_str(), Js::str(v))),
            ),
        ),
        (
            "nativeIdentityEnvironment",
            Js::strs(["HOME", "CLAUDE_CONFIG_DIR"]),
        ),
        ("mcpConfiguration", Js::str("strict_per_invocation")),
        ("blockers", Js::strs(blockers)),
    ]);
    Ok(ClaudeMcpConfiguration {
        argv,
        environment_overrides,
        json,
    })
}

/// Result of `opencodeInteractiveMcpConfiguration`.
#[derive(Clone, Debug, PartialEq)]
pub struct OpenCodeMcpConfiguration {
    pub environment_overrides: Vec<(String, String)>,
    pub json: Js,
}

pub fn opencode_interactive_mcp_configuration(
    input: &McpReviewInput,
) -> Result<OpenCodeMcpConfiguration> {
    check_input(input)?;
    if input.executable_version != REVIEWED_OPENCODE.version
        || input.executable_sha256 != REVIEWED_OPENCODE.sha256
    {
        return Err(not_reviewed());
    }
    let mcp = input.mcp;
    let content = Js::obj([(
        "mcp",
        Js::obj([(
            "servers",
            Js::obj([(
                mcp.server_name.as_str(),
                Js::obj([
                    ("type", Js::str("local")),
                    ("command", Js::strs([input.node_path, &mcp.relay.path])),
                    (
                        "environment",
                        Js::obj([
                            ("ORQST_SOCKET_PATH", Js::str(&mcp.socket_path)),
                            ("ORQST_CAP_FILE", Js::str(&mcp.capability_file)),
                        ]),
                    ),
                    ("disabled", Js::Bool(false)),
                    ("codemode", Js::Bool(false)),
                    ("protocol", Js::str("legacy")),
                    (
                        "timeout",
                        Js::obj([
                            ("startup", Js::Num(10000.0)),
                            ("catalog", Js::Num(10000.0)),
                            ("execution", Js::Num(125000.0)),
                        ]),
                    ),
                ]),
            )]),
        )]),
    )]);
    let environment_overrides = vec![("OPENCODE_CONFIG_CONTENT".to_owned(), content.stringify())];
    let mut blockers: Vec<&str> = COMMON_BLOCKERS.to_vec();
    blockers.extend([
        "native_auth_and_session_data_roots_coupled",
        "merged_plugins_hooks_and_managed_settings_unvalidated",
        "installed_tool_exposure_and_timeout_behavior_unvalidated",
        "native_database_startup_migrations_not_authorized",
        "native_standalone_descendant_lifecycle_unvalidated",
    ]);
    let json = Js::obj([
        ("provider", Js::str("opencode")),
        ("executableVersion", Js::str(input.executable_version)),
        (
            "evidence",
            Js::str("passive_binary_metadata_and_official_documentation"),
        ),
        ("execution", Js::str("blocked")),
        ("providerAcceptance", Js::str("not_run")),
        ("argv", Js::strs(["--standalone"])),
        (
            "environmentOverrides",
            Js::obj(
                environment_overrides
                    .iter()
                    .map(|(k, v)| (k.as_str(), Js::str(v))),
            ),
        ),
        (
            "nativeIdentityEnvironment",
            Js::strs(super::config::NATIVE_IDENTITY_KEYS),
        ),
        ("mcpConfiguration", Js::str("merged_inline_configuration")),
        (
            "installedTimeoutConfiguration",
            Js::str("separate_startup_catalog_execution"),
        ),
        ("blockers", Js::strs(blockers)),
    ]);
    Ok(OpenCodeMcpConfiguration {
        environment_overrides,
        json,
    })
}
