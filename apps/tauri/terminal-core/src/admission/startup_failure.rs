//! Port of `terminal/startup-failure.ts`: the strict inherited-IPC/stdout `startup-failure`
//! envelope. Correlation never comes from a renderer.
use super::error::{invalid, RefusalCode, Result};
use super::json::{self, strict};
use serde::Serialize;
use serde_json::Value;

const STAGES: [&str; 15] = [
    "bootstrap",
    "request",
    "catalog",
    "selection",
    "plan",
    "review",
    "revalidation",
    "commit",
    "provision",
    "inspection",
    "feature_assignment",
    "opening",
    "admission_preflight",
    "core_admission",
    "core_startup",
];
const CODES: [&str; 13] = [
    "failed",
    "catalog_changed",
    "selection_unavailable",
    "capacity_exceeded",
    "review_too_large",
    "selection_blocked",
    "capacity_reserved",
    "owned_exit_pending",
    "admission_invalid",
    "startup_failed",
    "startup_timeout",
    "startup_eof",
    "startup_protocol",
];
const STARTUP_CODES: [&str; 7] = [
    "capacity_reserved",
    "owned_exit_pending",
    "admission_invalid",
    "startup_failed",
    "startup_timeout",
    "startup_eof",
    "startup_protocol",
];

/// `TerminalPreparationFailure` (schema key order).
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct TerminalPreparationFailure {
    pub stage: String,
    pub code: String,
    pub effects: String,
}

impl TerminalPreparationFailure {
    pub fn new(stage: &str, code: &str) -> Self {
        Self {
            stage: stage.into(),
            code: code.into(),
            effects: "possible".into(),
        }
    }

    /// `terminalPreparationFailureSchema` including its refinement.
    pub fn is_valid(&self) -> bool {
        STAGES.contains(&self.stage.as_str())
            && CODES.contains(&self.code.as_str())
            && matches!(self.effects.as_str(), "not_started" | "possible")
            && (self.effects == "possible"
                || (!self.code.starts_with("startup_")
                    && ![
                        "bootstrap",
                        "provision",
                        "inspection",
                        "feature_assignment",
                        "opening",
                        "core_admission",
                        "core_startup",
                    ]
                    .contains(&self.stage.as_str())))
    }

    /// The startup envelope refinement: core stage, possible effects, startup code.
    pub fn is_startup(&self) -> bool {
        self.is_valid()
            && matches!(self.stage.as_str(), "core_admission" | "core_startup")
            && self.effects == "possible"
            && STARTUP_CODES.contains(&self.code.as_str())
    }

    pub fn parse(value: &Value) -> Result<Self> {
        let map = strict(value, &["stage", "code", "effects"])?;
        let failure = Self {
            stage: json::string(map, "stage")?.into(),
            code: json::string(map, "code")?.into(),
            effects: json::string(map, "effects")?.into(),
        };
        if !failure.is_valid() {
            return Err(invalid("failure"));
        }
        Ok(failure)
    }
}

/// `terminalStartupIdSchema`: a UUID or `startup-<1..20 digits, no leading zero>`.
pub fn is_startup_id(id: &str) -> bool {
    if json::is_uuid(id) {
        return true;
    }
    let Some(digits) = id.strip_prefix("startup-") else {
        return false;
    };
    (1..=20).contains(&digits.len())
        && digits.bytes().all(|byte| byte.is_ascii_digit())
        && !digits.starts_with('0')
}

/// `terminalStartupFailure(error)`: a valid startup failure, else the generic core failure.
pub fn terminal_startup_failure(
    failure: Option<&TerminalPreparationFailure>,
) -> TerminalPreparationFailure {
    match failure {
        Some(failure) if failure.is_startup() => failure.clone(),
        _ => TerminalPreparationFailure::new("core_startup", "startup_failed"),
    }
}

/// `host.ts` `startupFailed`: the Core's IPC `startup-failure` message for a stage and an
/// optional admission refusal (`DesktopAdmissionRefused` code, else `startup_failed`).
pub fn core_startup_failure_message(
    id: &str,
    stage: &str,
    refusal: Option<RefusalCode>,
) -> Result<Value> {
    let failure = TerminalPreparationFailure::new(
        stage,
        refusal.map_or("startup_failed", RefusalCode::as_str),
    );
    if !is_startup_id(id) || !failure.is_startup() {
        return Err(invalid("startup-failure"));
    }
    Ok(serde_json::json!({ "type": "startup-failure", "id": id, "failure": failure }))
}

/// `terminalStartupFailureSchema.parse(value)`.
pub fn parse_startup_failure_message(
    value: &Value,
) -> Result<(String, TerminalPreparationFailure)> {
    let map = strict(value, &["type", "id", "failure"])?;
    if map.get("type").and_then(Value::as_str) != Some("startup-failure") {
        return Err(invalid("type"));
    }
    let id = json::string(map, "id")?;
    if !is_startup_id(id) {
        return Err(invalid("id"));
    }
    let failure =
        TerminalPreparationFailure::parse(map.get("failure").ok_or_else(|| invalid("failure"))?)?;
    if !failure.is_startup() {
        return Err(invalid("failure"));
    }
    Ok((id.to_owned(), failure))
}

/// `terminalStartupHostFailure(id, error)`.
pub fn terminal_startup_host_failure(
    id: &str,
    failure: Option<&TerminalPreparationFailure>,
) -> Result<Value> {
    if !is_startup_id(id) {
        return Err(invalid("id"));
    }
    Ok(serde_json::json!({
        "kind": "failure",
        "id": id,
        "failure": terminal_startup_failure(failure),
    }))
}
