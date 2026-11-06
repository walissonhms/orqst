//! Error model of the offline recovery port. `Blocked` is `OfflineRecoveryBlocked`,
//! `BindingChanged` is `OfflineEnrollmentBindingChanged`; every other refusal keeps the exact
//! TypeScript `Error.message`. Schema failures are `Invalid` (zod text is not part of the contract).
use crate::admission::AdmissionError;
use crate::profiles::ProfileError;
use std::fmt;
use std::io;

#[derive(Debug)]
pub enum RecoveryError {
    /// `OfflineRecoveryBlocked(reason, bundle)`.
    Blocked { reason: String, bundle: String },
    /// `OfflineEnrollmentBindingChanged` (stage `inspection`, code `enrollment_binding_changed`).
    BindingChanged,
    /// A filesystem error with its errno (`NodeJS.ErrnoException`).
    Io(io::Error),
    /// `JSON.parse` / zod failure.
    Invalid(String),
    /// `new Error(message)`.
    Failed(String),
}

pub type Result<T> = std::result::Result<T, RecoveryError>;

pub fn fail<T>(message: &str) -> Result<T> {
    Err(RecoveryError::Failed(message.to_owned()))
}

pub fn blocked<T>(reason: &str, bundle: &str) -> Result<T> {
    Err(RecoveryError::Blocked {
        reason: reason.to_owned(),
        bundle: bundle.to_owned(),
    })
}

pub fn invalid(detail: impl Into<String>) -> RecoveryError {
    RecoveryError::Invalid(detail.into())
}

impl RecoveryError {
    pub fn is_not_found(&self) -> bool {
        matches!(self, RecoveryError::Io(error) if error.kind() == io::ErrorKind::NotFound)
    }
    pub fn is_blocked(&self) -> bool {
        matches!(self, RecoveryError::Blocked { .. })
    }
    /// Stable classification shared with the TypeScript golden driver.
    pub fn classify(&self) -> String {
        match self {
            RecoveryError::Blocked { reason, .. } => format!("blocked:{reason}"),
            RecoveryError::BindingChanged => "enrollment_binding_changed".into(),
            RecoveryError::Io(error) => match error.raw_os_error() {
                Some(libc::ENOENT) => "ENOENT".into(),
                Some(libc::EEXIST) => "EEXIST".into(),
                Some(libc::ELOOP) => "ELOOP".into(),
                Some(libc::ENOTDIR) => "ENOTDIR".into(),
                Some(libc::EACCES) => "EACCES".into(),
                Some(libc::EPERM) => "EPERM".into(),
                Some(code) => format!("errno:{code}"),
                None => "io".into(),
            },
            RecoveryError::Invalid(_) => "invalid".into(),
            RecoveryError::Failed(message) => message.clone(),
        }
    }
}

impl fmt::Display for RecoveryError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            RecoveryError::Blocked { reason, bundle } => write!(
                f,
                "Offline recovery blocked: {reason}; preserve bundle {bundle}"
            ),
            RecoveryError::BindingChanged => f.write_str("Recovery manifest enrollment binding"),
            RecoveryError::Io(error) => write!(f, "{error}"),
            RecoveryError::Invalid(detail) => write!(f, "Invalid record: {detail}"),
            RecoveryError::Failed(message) => f.write_str(message),
        }
    }
}

impl std::error::Error for RecoveryError {}

impl From<io::Error> for RecoveryError {
    fn from(error: io::Error) -> Self {
        RecoveryError::Io(error)
    }
}

impl From<AdmissionError> for RecoveryError {
    fn from(error: AdmissionError) -> Self {
        match error {
            AdmissionError::Io(error) => RecoveryError::Io(error),
            AdmissionError::Rejected(message) => RecoveryError::Failed(message.into()),
            AdmissionError::Invalid(detail) => RecoveryError::Invalid(detail),
            other => RecoveryError::Failed(other.to_string()),
        }
    }
}

impl From<ProfileError> for RecoveryError {
    fn from(error: ProfileError) -> Self {
        match error {
            ProfileError::Schema(detail) => RecoveryError::Invalid(detail),
            ProfileError::Refused(message) => RecoveryError::Failed(message),
            ProfileError::Io(code) => RecoveryError::Io(io::Error::from_raw_os_error(errno(&code))),
        }
    }
}

fn errno(code: &str) -> i32 {
    match code {
        "ENOENT" => libc::ENOENT,
        "EEXIST" => libc::EEXIST,
        "ELOOP" => libc::ELOOP,
        "ENOTDIR" => libc::ENOTDIR,
        "EACCES" => libc::EACCES,
        "EPERM" => libc::EPERM,
        _ => libc::EIO,
    }
}
