//! Errors of the Feature configuration port. The pair RPC answers every error with
//! `{ id, ok: false }` (messages never cross the transport); only a permission revision
//! conflict has its own reply (`{ status: 'conflict' }`, `FeaturePermissionRevisionConflict`).
use std::fmt;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FeatureError {
    /// Input or stored metadata failed the protocol schema.
    Invalid(String),
    /// `FeaturePermissionRevisionConflict` (stale permission, Feature or view revision).
    Conflict(String),
    /// Domain refusal (stale revision, capacity, archived, foreign terminal, ...).
    Refused(String),
    /// Unsafe file, unsupported schema or SQLite failure.
    Store(String),
}

pub type Result<T> = std::result::Result<T, FeatureError>;

pub fn invalid(message: impl Into<String>) -> FeatureError {
    FeatureError::Invalid(message.into())
}
pub fn refused(message: impl Into<String>) -> FeatureError {
    FeatureError::Refused(message.into())
}
pub fn store(message: impl Into<String>) -> FeatureError {
    FeatureError::Store(message.into())
}

impl fmt::Display for FeatureError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Invalid(m) | Self::Conflict(m) | Self::Refused(m) | Self::Store(m) => {
                f.write_str(m)
            }
        }
    }
}

impl std::error::Error for FeatureError {}

impl From<rusqlite::Error> for FeatureError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Store(format!("SQLite: {error}"))
    }
}

impl From<std::io::Error> for FeatureError {
    fn from(error: std::io::Error) -> Self {
        Self::Store(format!("I/O: {}", error.kind()))
    }
}
