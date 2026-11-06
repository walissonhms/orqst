//! The profile side of `managedTerminalBackend` (`pty-backend.ts`): manifest pinning,
//! `validate`, the owned environment and Claude session evidence. Process spawning and
//! lifecycle receipts stay in the Core supervisor/PTY lanes.
use super::codex::codex_managed_auth_metadata_ok;
use super::config::{InteractiveConfig, McpLaunch};
use super::interactive::{
    interactive_terminal_environment, interactive_terminal_profiles, manifest_source,
    profiles_json, read_interactive_terminal_config, BuiltProfile, PreparationValidator,
};
use super::js::Js;
use super::session::{LifecycleBinding, OwnedClaudeSession, SessionSnapshot};
use super::{terminal_digest, Result};

pub struct ManagedProfileBackend {
    file: String,
    mcp: Option<McpLaunch>,
    config: InteractiveConfig,
    expected: Vec<BuiltProfile>,
    expected_json: String,
    source: Vec<u8>,
    dispatched: bool,
}

impl ManagedProfileBackend {
    /// Construction of `managedTerminalBackend(file, host, mcp)`: read, validate, pin.
    pub fn new(
        file: &str,
        mcp: Option<McpLaunch>,
        prep: &dyn PreparationValidator,
    ) -> Result<Self> {
        let config = read_interactive_terminal_config(file, prep)?;
        let expected = interactive_terminal_profiles(&config, mcp.as_ref(), prep)?;
        let source = manifest_source(file)?;
        Ok(ManagedProfileBackend {
            file: file.to_owned(),
            expected_json: profiles_json(&expected),
            mcp,
            config,
            expected,
            source,
            dispatched: false,
        })
    }

    pub fn config(&self) -> &InteractiveConfig {
        &self.config
    }
    pub fn profiles(&self) -> &[BuiltProfile] {
        &self.expected
    }
    /// `terminalDigest(source)`: the lifecycle receipt `configDigest`.
    pub fn config_digest(&self) -> String {
        terminal_digest(&self.source)
    }
    /// `JSON.stringify(mcp)` as passed to the PTY host argv.
    pub fn mcp_json(&self) -> Option<String> {
        self.mcp.as_ref().map(|m| m.to_js().stringify())
    }

    /// `validate(profile)`: `profile_json` is `JSON.stringify(profile)`. Any error is `false`.
    pub fn validate(&self, profile_json: &str, prep: &dyn PreparationValidator) -> bool {
        self.validate_inner(profile_json, prep).unwrap_or(false)
    }

    fn validate_inner(&self, profile_json: &str, prep: &dyn PreparationValidator) -> Result<bool> {
        if self.config.version() != 1 && self.dispatched {
            return Ok(false);
        }
        if self.source != manifest_source(&self.file)? {
            return Ok(false);
        }
        let current = read_interactive_terminal_config(&self.file, prep)?;
        let current = interactive_terminal_profiles(&current, self.mcp.as_ref(), prep)?;
        if profiles_json(&current) != self.expected_json {
            return Ok(false);
        }
        let Some(profile) = self.expected.iter().find(|p| p.json == profile_json) else {
            return Ok(false);
        };
        if let InteractiveConfig::Codex(codex) = &self.config {
            if profile.profile.id == "codex-terminal-v1" && codex.authentication.is_none() {
                return codex_managed_auth_metadata_ok(codex);
            }
        }
        Ok(true)
    }

    /// Call at the last synchronous dispatch boundary, after a successful `validate`:
    /// native Claude/OpenCode manifests are single-dispatch, including failed starts.
    /// Returns the Claude session reader (created before marking dispatch, as in TypeScript).
    pub fn mark_dispatched(&mut self, binding: &LifecycleBinding) -> Option<OwnedClaudeSession> {
        let session = match &self.config {
            InteractiveConfig::Claude(claude) => OwnedClaudeSession::new(claude, binding),
            _ => None,
        };
        self.dispatched = true;
        session
    }

    /// `interactiveTerminalEnvironment(config, mcp)` in insertion order (no `SHELL`).
    pub fn environment(&self) -> Result<Vec<(String, String)>> {
        interactive_terminal_environment(&self.config, self.mcp.as_ref())
    }
}

impl SessionSnapshot {
    /// The object `ownedClaudeSession` evidence returns, in TypeScript key order.
    pub fn to_js(&self) -> Js {
        let mut entries = vec![
            (
                "session".to_owned(),
                Js::obj([
                    ("provider", Js::str("claude")),
                    ("sessionId", Js::str(&self.session_id)),
                    ("bindingEvidence", Js::str("claude-argv-receipt-transcript")),
                ]),
            ),
            (
                "activities".to_owned(),
                Js::Arr(
                    self.activities
                        .iter()
                        .map(|a| {
                            Js::obj([
                                ("at", Js::Num(a.at as f64)),
                                ("kind", Js::str(a.kind)),
                                ("label", Js::str(&a.label)),
                            ])
                        })
                        .collect(),
                ),
            ),
            ("agentState".to_owned(), Js::str(self.turn.agent_state)),
        ];
        if let Some(turn) = &self.turn.turn_id {
            entries.push(("turnId".to_owned(), Js::str(turn)));
        }
        Js::Obj(entries)
    }
}
