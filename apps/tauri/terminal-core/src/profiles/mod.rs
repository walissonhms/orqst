//! Lane L2. Port of interactive-profile.ts, codex-profile.ts, opencode-profile.ts,
//! opencode-launch-plan.ts, interactive-adapters.ts, model-selection.ts, local-cli*.ts,
//! provider-mcp-config.ts, owned-claude-hooks.ts, owned-claude-session.ts, managed-files.ts,
//! identity.ts. Output must equal the TypeScript functions (golden tests).
//!
//! Refusals: an explicit TypeScript `throw new Error(message)` becomes
//! [`ProfileError::Refused`] with the identical message; a zod schema failure becomes
//! [`ProfileError::Schema`]; a propagated Node filesystem error becomes [`ProfileError::Io`]
//! carrying the Node error `code` (for example `ENOENT`).
use sha2::{Digest, Sha256};
use std::fmt;

pub mod adapters;
pub mod backend;
pub mod claude;
pub mod codex;
pub mod config;
pub mod fsx;
pub mod hooks;
pub mod identity;
pub mod interactive;
pub mod js;
pub mod local_cli;
pub mod local_cli_path;
pub mod managed_files;
pub mod mcp;
pub mod model;
pub mod nodepath;
pub mod opencode;
pub mod session;
pub mod validate;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ProfileError {
    /// zod refusal (input shape). The detail is diagnostic only.
    Schema(String),
    /// Explicit refusal; the message equals the TypeScript `Error.message`.
    Refused(String),
    /// Propagated filesystem error; the value is the Node error `code`.
    Io(String),
}

impl ProfileError {
    pub fn refused(message: &str) -> Self {
        ProfileError::Refused(message.to_owned())
    }
    pub fn schema(detail: impl Into<String>) -> Self {
        ProfileError::Schema(detail.into())
    }
    pub fn io_code(&self) -> Option<&str> {
        match self {
            ProfileError::Io(code) => Some(code),
            _ => None,
        }
    }
}

impl fmt::Display for ProfileError {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self {
            ProfileError::Schema(detail) => write!(f, "Invalid terminal input: {detail}"),
            ProfileError::Refused(message) => f.write_str(message),
            ProfileError::Io(code) => write!(f, "Terminal filesystem error: {code}"),
        }
    }
}

impl std::error::Error for ProfileError {}

pub type Result<T> = std::result::Result<T, ProfileError>;

/// `terminalDigest` (`authority.ts`): lowercase sha256 hex.
pub fn terminal_digest(value: impl AsRef<[u8]>) -> String {
    hex(&Sha256::digest(value.as_ref()))
}

pub(crate) fn hex(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push_str(&format!("{byte:02x}"));
    }
    out
}

#[cfg(test)]
thread_local! {
    static NOW: std::cell::Cell<Option<f64>> = const { std::cell::Cell::new(None) };
}

/// `Date.now()`. Tests may pin it per thread.
pub fn now_ms() -> f64 {
    #[cfg(test)]
    if let Some(now) = NOW.with(|n| n.get()) {
        return now;
    }
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as f64)
        .unwrap_or(0.0)
}

#[cfg(test)]
pub(crate) fn pin_now(value: Option<f64>) {
    NOW.with(|n| n.set(value));
}

#[cfg(test)]
mod golden;
