//! Manifest schemas of `codex-profile.ts`, `interactive-profile.ts`, `opencode-profile.ts`,
//! `opencode-launch-plan.ts`, `mcp-launch.ts`, `model-selection.ts` and
//! `preparation-context.ts`, parsed from [`Js`] with the same accept/refuse decisions.
use super::js::{js_len, Js};
use super::mcp::{REVIEWED_CLAUDE_MCP, REVIEWED_CLAUDE_TUI, REVIEWED_OPENCODE};
use super::validate::*;
use super::{ProfileError, Result};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Binary {
    pub path: String,
    pub sha256: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct McpLaunch {
    pub server_name: String,
    pub socket_path: String,
    pub capability_file: String,
    pub relay: Binary,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ModelSourceFile {
    pub path: String,
    pub codex_model: Option<String>,
    pub open_code_model: Option<String>,
    pub sha256: Option<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ModelSelection {
    pub value: Option<String>,
    /// `cli-default` | `native-config` | `cli-cache` | `official-alias` | `native-state`.
    pub source: String,
    pub expires_at: Option<f64>,
    pub files: Vec<ModelSourceFile>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PreparationBinding {
    pub observer_database: String,
    pub preferences_directory: String,
    pub workspace_id: String,
    pub feature_id: Option<String>,
    pub fence: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CodexInteractive {
    pub mcp: bool,
    pub hub: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CodexAuthentication {
    pub home: String,
    pub codex_home: String,
}

#[derive(Clone, Debug, PartialEq)]
pub struct CodexConfig {
    pub executable: Binary,
    pub executable_version: String,
    pub node: Binary,
    pub tool_path: Option<String>,
    pub identity: Option<String>,
    pub project: String,
    pub state: String,
    pub model: Option<ModelSelection>,
    pub preparation: Option<PreparationBinding>,
    pub interactive: Option<CodexInteractive>,
    pub authentication: Option<CodexAuthentication>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ClaudeInteractive {
    pub mcp: bool,
    pub strict_mcp_acknowledged: bool,
    pub hub: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ClaudeAuthentication {
    pub home: String,
    pub claude_config_directory: Option<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ClaudeConfig {
    pub executable: Binary,
    pub executable_version: String,
    pub node: Binary,
    pub tool_path: Option<String>,
    pub identity: Option<String>,
    pub project: String,
    pub state: String,
    pub model: Option<ModelSelection>,
    pub preparation: Option<PreparationBinding>,
    pub session_id: String,
    pub owned_hooks: bool,
    pub authentication: ClaudeAuthentication,
    pub interactive: ClaudeInteractive,
}

pub const NATIVE_IDENTITY_KEYS: [&str; 7] = [
    "HOME",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "XDG_STATE_HOME",
    "XDG_CACHE_HOME",
    "OPENCODE_CONFIG_DIR",
    "OPENCODE_DB",
];

/// `opencodeNativeIdentitySchema` output, in schema key order.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NativeIdentity(pub Vec<(String, String)>);

impl NativeIdentity {
    pub fn get(&self, key: &str) -> Option<&str> {
        self.0
            .iter()
            .find(|(k, _)| k == key)
            .map(|(_, v)| v.as_str())
    }
    pub fn home(&self) -> &str {
        self.get("HOME").unwrap_or_default()
    }
    pub fn to_js(&self) -> Js {
        Js::obj(self.0.iter().map(|(k, v)| (k.as_str(), Js::str(v))))
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OpenCodeInteractive {
    pub native_startup_authorized: bool,
    pub native_database_migrations_acknowledged: bool,
    pub native_startup_activity_acknowledged: bool,
    pub mcp: bool,
    pub merged_mcp_acknowledged: bool,
    pub hub: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub struct OpenCodeConfig {
    pub executable: Binary,
    pub executable_version: String,
    pub node: Binary,
    pub tool_path: Option<String>,
    pub identity: Option<String>,
    pub project: String,
    pub state: String,
    pub model: Option<ModelSelection>,
    pub preparation: Option<PreparationBinding>,
    pub native_identity: NativeIdentity,
    pub interactive: OpenCodeInteractive,
}

/// `InteractiveTerminalConfig` (manifest versions 1, 2 and 3).
#[derive(Clone, Debug, PartialEq)]
pub enum InteractiveConfig {
    Codex(CodexConfig),
    Claude(ClaudeConfig),
    OpenCode(OpenCodeConfig),
}

impl InteractiveConfig {
    pub fn version(&self) -> u8 {
        match self {
            InteractiveConfig::Codex(_) => 1,
            InteractiveConfig::Claude(_) => 2,
            InteractiveConfig::OpenCode(_) => 3,
        }
    }
    pub fn project(&self) -> &str {
        match self {
            InteractiveConfig::Codex(c) => &c.project,
            InteractiveConfig::Claude(c) => &c.project,
            InteractiveConfig::OpenCode(c) => &c.project,
        }
    }
    pub fn state(&self) -> &str {
        match self {
            InteractiveConfig::Codex(c) => &c.state,
            InteractiveConfig::Claude(c) => &c.state,
            InteractiveConfig::OpenCode(c) => &c.state,
        }
    }
    pub fn identity(&self) -> Option<&str> {
        match self {
            InteractiveConfig::Codex(c) => c.identity.as_deref(),
            InteractiveConfig::Claude(c) => c.identity.as_deref(),
            InteractiveConfig::OpenCode(c) => c.identity.as_deref(),
        }
    }
    pub fn node(&self) -> &Binary {
        match self {
            InteractiveConfig::Codex(c) => &c.node,
            InteractiveConfig::Claude(c) => &c.node,
            InteractiveConfig::OpenCode(c) => &c.node,
        }
    }
    /// `config.interactive` is present (always for versions 2 and 3).
    pub fn has_interactive(&self) -> bool {
        match self {
            InteractiveConfig::Codex(c) => c.interactive.is_some(),
            _ => true,
        }
    }
    pub fn has_authentication(&self) -> bool {
        match self {
            InteractiveConfig::Codex(c) => c.authentication.is_some(),
            _ => true,
        }
    }
    /// `config.interactive?.mcp`.
    pub fn mcp(&self) -> bool {
        match self {
            InteractiveConfig::Codex(c) => c.interactive.as_ref().is_some_and(|i| i.mcp),
            InteractiveConfig::Claude(c) => c.interactive.mcp,
            InteractiveConfig::OpenCode(c) => c.interactive.mcp,
        }
    }
    /// `config.interactive?.hub`.
    pub fn hub(&self) -> bool {
        match self {
            InteractiveConfig::Codex(c) => c.interactive.as_ref().is_some_and(|i| i.hub),
            InteractiveConfig::Claude(c) => c.interactive.hub,
            InteractiveConfig::OpenCode(c) => c.interactive.hub,
        }
    }
    pub fn preparation(&self) -> Option<&PreparationBinding> {
        match self {
            InteractiveConfig::Codex(c) => c.preparation.as_ref(),
            InteractiveConfig::Claude(c) => c.preparation.as_ref(),
            InteractiveConfig::OpenCode(c) => c.preparation.as_ref(),
        }
    }
}

fn opt<'a>(value: &'a Js, key: &str) -> Option<&'a Js> {
    value.get(key)
}

fn binary(value: &Js, field: &str, path: fn(&Js, &str) -> Result<String>) -> Result<Binary> {
    strict(value, field, &["path", "sha256"])?;
    Ok(Binary {
        path: path(required(value, "path")?, "path")?,
        sha256: hex64(required(value, "sha256")?, "sha256")?,
    })
}

/// `terminalMcpLaunchSchema`.
pub fn parse_mcp_launch(value: &Js) -> Result<McpLaunch> {
    strict(
        value,
        "mcp",
        &["serverName", "socketPath", "capabilityFile", "relay"],
    )?;
    let server_name = string(required(value, "serverName")?, "serverName")?;
    let valid = server_name.len() == 38
        && server_name.starts_with("orqst_")
        && server_name[6..]
            .bytes()
            .all(|b| matches!(b, b'a'..=b'f' | b'0'..=b'9'));
    if !valid {
        return schema("serverName");
    }
    Ok(McpLaunch {
        server_name: server_name.to_owned(),
        socket_path: slash_path(required(value, "socketPath")?, "socketPath")?,
        capability_file: slash_path(required(value, "capabilityFile")?, "capabilityFile")?,
        relay: binary(required(value, "relay")?, "relay", slash_path)?,
    })
}

impl McpLaunch {
    /// Schema key order, as `JSON.stringify(mcp)` in `pty-backend.ts`.
    pub fn to_js(&self) -> Js {
        Js::obj([
            ("serverName", Js::str(&self.server_name)),
            ("socketPath", Js::str(&self.socket_path)),
            ("capabilityFile", Js::str(&self.capability_file)),
            (
                "relay",
                Js::obj([
                    ("path", Js::str(&self.relay.path)),
                    ("sha256", Js::str(&self.relay.sha256)),
                ]),
            ),
        ])
    }
}

/// `terminalModelValueSchema`.
pub fn model_value(value: &Js, field: &str) -> Result<String> {
    let s = bounded(value, field, 1, 160)?;
    let mut bytes = s.bytes();
    let first_ok = bytes.next().is_some_and(|b| b.is_ascii_alphanumeric());
    let rest_ok = s
        .bytes()
        .skip(1)
        .all(|b| b.is_ascii_alphanumeric() || b"._:/#@+-".contains(&b));
    if !first_ok || !rest_ok {
        return schema(&format!("{field}: model value"));
    }
    Ok(s.to_owned())
}

pub const MODEL_SOURCES: [&str; 5] = [
    "cli-default",
    "native-config",
    "cli-cache",
    "official-alias",
    "native-state",
];

/// `terminalModelSelectionSchema`.
pub fn parse_model_selection(value: &Js) -> Result<ModelSelection> {
    strict(value, "model", &["value", "source", "expiresAt", "files"])?;
    let selected = match required(value, "value")? {
        Js::Null => None,
        other => Some(model_value(other, "value")?),
    };
    let source = string(required(value, "source")?, "source")?;
    if !MODEL_SOURCES.contains(&source) {
        return schema("source");
    }
    let expires_at = match opt(value, "expiresAt") {
        Some(v) => Some(positive_safe_int(v, "expiresAt")?),
        None => None,
    };
    let Js::Arr(items) = required(value, "files")? else {
        return schema("files");
    };
    if items.is_empty() || items.len() > 8 {
        return schema("files: length");
    }
    let mut files = Vec::new();
    for item in items {
        strict(
            item,
            "file",
            &["path", "codexModel", "openCodeModel", "sha256"],
        )?;
        let path = string(required(item, "path")?, "path")?;
        if !path.starts_with('/') || js_len(path) > 2048 {
            return schema("file.path");
        }
        files.push(ModelSourceFile {
            path: path.to_owned(),
            codex_model: opt(item, "codexModel")
                .map(|v| model_value(v, "codexModel"))
                .transpose()?,
            open_code_model: opt(item, "openCodeModel")
                .map(|v| model_value(v, "openCodeModel"))
                .transpose()?,
            sha256: match required(item, "sha256")? {
                Js::Null => None,
                other => Some(hex64(other, "sha256")?),
            },
        });
    }
    Ok(ModelSelection {
        value: selected,
        source: source.to_owned(),
        expires_at,
        files,
    })
}

/// `terminalPreparationBindingSchema`.
pub fn parse_preparation(value: &Js) -> Result<PreparationBinding> {
    strict(
        value,
        "preparation",
        &[
            "observerDatabase",
            "preferencesDirectory",
            "workspaceId",
            "featureId",
            "fence",
        ],
    )?;
    let path = |key: &str| -> Result<String> {
        let s = bounded(required(value, key)?, key, 1, 2048)?;
        if !s.starts_with('/') {
            return schema(key);
        }
        Ok(s.to_owned())
    };
    Ok(PreparationBinding {
        observer_database: path("observerDatabase")?,
        preferences_directory: path("preferencesDirectory")?,
        workspace_id: hex64(required(value, "workspaceId")?, "workspaceId")?,
        feature_id: match required(value, "featureId")? {
            Js::Null => None,
            other => Some(uuid(other, "featureId")?),
        },
        fence: bounded(required(value, "fence")?, "fence", 1, 4096)?.to_owned(),
    })
}

/// `terminalToolPathSchema`.
pub fn tool_path(value: &Js) -> Result<String> {
    let s = string(value, "toolPath")?;
    if s.is_empty() || s.len() > super::local_cli_path::MAXIMUM_PATH_BYTES {
        return schema("toolPath");
    }
    Ok(s.to_owned())
}

/// `terminalIdentitySchema` (`@orqst/protocol`).
fn identity(value: &Js) -> Result<String> {
    strict(value, "identity", &["terminalId"])?;
    uuid(required(value, "terminalId")?, "terminalId")
}

struct Common {
    executable: Binary,
    node: Binary,
    tool_path: Option<String>,
    identity: Option<String>,
    project: String,
    state: String,
    model: Option<ModelSelection>,
    preparation: Option<PreparationBinding>,
}

fn common(value: &Js, path: fn(&Js, &str) -> Result<String>) -> Result<Common> {
    Ok(Common {
        executable: binary(required(value, "executable")?, "executable", path)?,
        node: binary(required(value, "node")?, "node", path)?,
        tool_path: opt(value, "toolPath").map(tool_path).transpose()?,
        identity: opt(value, "identity").map(identity).transpose()?,
        project: path(required(value, "project")?, "project")?,
        state: path(required(value, "state")?, "state")?,
        model: opt(value, "model").map(parse_model_selection).transpose()?,
        preparation: opt(value, "preparation")
            .map(parse_preparation)
            .transpose()?,
    })
}

fn flag(value: &Js, key: &str) -> Result<bool> {
    match opt(value, key) {
        Some(v) => literal_true(v, key),
        None => Ok(false),
    }
}

/// `managedCodexConfigSchema`.
pub fn parse_codex_config(value: &Js) -> Result<CodexConfig> {
    strict(
        value,
        "config",
        &[
            "version",
            "trust",
            "executable",
            "executableVersion",
            "node",
            "toolPath",
            "identity",
            "project",
            "state",
            "model",
            "preparation",
            "interactive",
            "authentication",
        ],
    )?;
    if *required(value, "version")? != Js::Num(1.0) {
        return schema("version");
    }
    literal_str(required(value, "trust")?, "trust", "native-same-user")?;
    let executable_version = bounded(
        required(value, "executableVersion")?,
        "executableVersion",
        1,
        64,
    )?
    .to_owned();
    let c = common(value, absolute_path)?;
    let interactive = match opt(value, "interactive") {
        None => None,
        Some(i) => {
            strict(i, "interactive", &["sharedNativeSessions", "mcp", "hub"])?;
            literal_true(required(i, "sharedNativeSessions")?, "sharedNativeSessions")?;
            let (mcp, hub) = (flag(i, "mcp")?, flag(i, "hub")?);
            if hub && !mcp {
                return schema("The message hub requires MCP");
            }
            Some(CodexInteractive { mcp, hub })
        }
    };
    let authentication = match opt(value, "authentication") {
        None => None,
        Some(a) => {
            strict(
                a,
                "authentication",
                &["mode", "home", "codexHome", "sharedNativeConfiguration"],
            )?;
            literal_str(required(a, "mode")?, "mode", "reuse-existing")?;
            let home = absolute_path(required(a, "home")?, "home")?;
            let codex_home = absolute_path(required(a, "codexHome")?, "codexHome")?;
            literal_true(
                required(a, "sharedNativeConfiguration")?,
                "sharedNativeConfiguration",
            )?;
            Some(CodexAuthentication { home, codex_home })
        }
    };
    Ok(CodexConfig {
        executable: c.executable,
        executable_version,
        node: c.node,
        tool_path: c.tool_path,
        identity: c.identity,
        project: c.project,
        state: c.state,
        model: c.model,
        preparation: c.preparation,
        interactive,
        authentication,
    })
}

/// `managedClaudeConfigSchema`.
pub fn parse_claude_config(value: &Js) -> Result<ClaudeConfig> {
    strict(
        value,
        "config",
        &[
            "version",
            "provider",
            "trust",
            "executable",
            "executableVersion",
            "node",
            "toolPath",
            "identity",
            "project",
            "state",
            "model",
            "preparation",
            "sessionId",
            "ownedHooks",
            "authentication",
            "interactive",
        ],
    )?;
    if *required(value, "version")? != Js::Num(2.0) {
        return schema("version");
    }
    literal_str(required(value, "provider")?, "provider", "claude")?;
    literal_str(required(value, "trust")?, "trust", "native-same-user")?;
    let executable_version = string(required(value, "executableVersion")?, "executableVersion")?;
    if executable_version != REVIEWED_CLAUDE_MCP.version
        && executable_version != REVIEWED_CLAUDE_TUI.version
    {
        return schema("executableVersion");
    }
    let c = common(value, slash_path)?;
    let session_id = uuid(required(value, "sessionId")?, "sessionId")?;
    let owned_hooks = flag(value, "ownedHooks")?;
    let a = required(value, "authentication")?;
    strict(
        a,
        "authentication",
        &[
            "mode",
            "home",
            "claudeConfigDirectory",
            "sharedNativeConfiguration",
        ],
    )?;
    literal_str(required(a, "mode")?, "mode", "reuse-existing")?;
    let authentication = ClaudeAuthentication {
        home: slash_path(required(a, "home")?, "home")?,
        claude_config_directory: opt(a, "claudeConfigDirectory")
            .map(|v| slash_path(v, "claudeConfigDirectory"))
            .transpose()?,
    };
    literal_true(
        required(a, "sharedNativeConfiguration")?,
        "sharedNativeConfiguration",
    )?;
    let i = required(value, "interactive")?;
    strict(
        i,
        "interactive",
        &[
            "sharedNativeSessions",
            "mcp",
            "strictMcpAcknowledged",
            "hub",
        ],
    )?;
    literal_true(required(i, "sharedNativeSessions")?, "sharedNativeSessions")?;
    let interactive = ClaudeInteractive {
        mcp: flag(i, "mcp")?,
        strict_mcp_acknowledged: flag(i, "strictMcpAcknowledged")?,
        hub: flag(i, "hub")?,
    };
    if interactive.hub && !interactive.mcp {
        return schema("The message hub requires MCP");
    }
    Ok(ClaudeConfig {
        executable: c.executable,
        executable_version: executable_version.to_owned(),
        node: c.node,
        tool_path: c.tool_path,
        identity: c.identity,
        project: c.project,
        state: c.state,
        model: c.model,
        preparation: c.preparation,
        session_id,
        owned_hooks,
        authentication,
        interactive,
    })
}

/// `opencodeNativeIdentitySchema`.
pub fn parse_native_identity(value: &Js) -> Result<NativeIdentity> {
    strict(value, "nativeIdentity", &NATIVE_IDENTITY_KEYS)?;
    let mut out = Vec::new();
    for key in NATIVE_IDENTITY_KEYS {
        match opt(value, key) {
            Some(v) => out.push((key.to_owned(), slash_path(v, key)?)),
            None if key == "HOME" => return schema("HOME: required"),
            None => {}
        }
    }
    Ok(NativeIdentity(out))
}

/// `managedOpenCodeConfigSchema`.
pub fn parse_opencode_config(value: &Js) -> Result<OpenCodeConfig> {
    strict(
        value,
        "config",
        &[
            "version",
            "provider",
            "trust",
            "executable",
            "executableVersion",
            "node",
            "toolPath",
            "identity",
            "project",
            "state",
            "model",
            "preparation",
            "authentication",
            "interactive",
        ],
    )?;
    if *required(value, "version")? != Js::Num(3.0) {
        return schema("version");
    }
    literal_str(required(value, "provider")?, "provider", "opencode")?;
    literal_str(required(value, "trust")?, "trust", "native-same-user")?;
    literal_str(
        required(value, "executableVersion")?,
        "executableVersion",
        REVIEWED_OPENCODE.version,
    )?;
    let c = common(value, slash_path)?;
    if c.executable.sha256 != REVIEWED_OPENCODE.sha256 {
        return schema("executable.sha256");
    }
    let a = required(value, "authentication")?;
    strict(
        a,
        "authentication",
        &["mode", "nativeIdentity", "sharedNativeConfiguration"],
    )?;
    literal_str(required(a, "mode")?, "mode", "reuse-existing")?;
    let native_identity = parse_native_identity(required(a, "nativeIdentity")?)?;
    literal_true(
        required(a, "sharedNativeConfiguration")?,
        "sharedNativeConfiguration",
    )?;
    let i = required(value, "interactive")?;
    strict(
        i,
        "interactive",
        &[
            "sharedNativeSessions",
            "nativeStartupAuthorized",
            "nativeDatabaseMigrationsAcknowledged",
            "nativeStartupActivityAcknowledged",
            "mcp",
            "mergedMcpAcknowledged",
            "hub",
        ],
    )?;
    literal_true(required(i, "sharedNativeSessions")?, "sharedNativeSessions")?;
    let interactive = OpenCodeInteractive {
        native_startup_authorized: boolean(
            required(i, "nativeStartupAuthorized")?,
            "nativeStartupAuthorized",
        )?,
        native_database_migrations_acknowledged: flag(i, "nativeDatabaseMigrationsAcknowledged")?,
        native_startup_activity_acknowledged: flag(i, "nativeStartupActivityAcknowledged")?,
        mcp: flag(i, "mcp")?,
        merged_mcp_acknowledged: flag(i, "mergedMcpAcknowledged")?,
        hub: flag(i, "hub")?,
    };
    if interactive.hub && !interactive.mcp {
        return schema("The message hub requires MCP");
    }
    Ok(OpenCodeConfig {
        executable: c.executable,
        executable_version: REVIEWED_OPENCODE.version.to_owned(),
        node: c.node,
        tool_path: c.tool_path,
        identity: c.identity,
        project: c.project,
        state: c.state,
        model: c.model,
        preparation: c.preparation,
        native_identity,
        interactive,
    })
}

/// Version dispatch of `readInteractiveTerminalConfig` (schema only).
pub fn parse_interactive_config(value: &Js) -> Result<InteractiveConfig> {
    match value.get("version") {
        Some(Js::Num(v)) if *v == 3.0 => {
            parse_opencode_config(value).map(InteractiveConfig::OpenCode)
        }
        Some(Js::Num(v)) if *v == 2.0 => parse_claude_config(value).map(InteractiveConfig::Claude),
        _ if value.is_object() => parse_codex_config(value).map(InteractiveConfig::Codex),
        _ => Err(ProfileError::schema("config: expected object")),
    }
}
