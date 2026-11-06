//! Port of `interactive-adapters.ts`.
use super::js::Js;
use super::{ProfileError, Result};

/// `interactiveCliStatus(provider)`: integration evidence, never an execution grant.
pub fn interactive_cli_status(provider: &str) -> Js {
    Js::obj([
        ("provider", Js::str(provider)),
        (
            "terminal",
            Js::str(if provider == "codex" {
                "legacy_separate_login_fixture_validated"
            } else {
                "explicit_opt_in_synthetic_only"
            }),
        ),
        ("existingLoginPty", Js::str("explicit_opt_in_unvalidated")),
        ("perInstanceMcp", Js::str("synthetic_transport_only")),
        ("mcpConfiguration", Js::str("desktop_opt_in_synthetic_only")),
        ("installedVersionCompatibility", Js::str("unvalidated")),
        ("automaticTaskDelivery", Js::str("unvalidated")),
        ("providerAcceptance", Js::str("not_run")),
    ])
}

/// The refusal of `interactiveCliAdapter`. On success the adapter is this module's
/// `interactive::{read_interactive_terminal_config, interactive_terminal_profiles,
/// interactive_terminal_environment}` with the Core PTY backend.
pub fn interactive_cli_adapter(
    provider: &str,
    authentication: &str,
    native_session_writes_acknowledged: bool,
) -> Result<()> {
    if (provider == "opencode" && authentication != "reuse-existing")
        || (provider == "claude" && authentication != "reuse-existing")
        || (authentication == "reuse-existing" && !native_session_writes_acknowledged)
    {
        return Err(ProfileError::refused(
            "Interactive CLI adapter has no reviewed launch contract for this mode",
        ));
    }
    Ok(())
}
