//! One error type for lane L3. Messages match the TypeScript `Error` messages exactly so
//! callers and golden tests can compare refusals.
use std::fmt;
use std::io;

/// Desktop admission refusal codes (`DesktopAdmissionRefused` in
/// `desktop-admission-inspection.ts`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RefusalCode {
    CapacityReserved,
    AdmissionInvalid,
    OwnedExitPending,
}

impl RefusalCode {
    pub fn as_str(self) -> &'static str {
        match self {
            RefusalCode::CapacityReserved => "capacity_reserved",
            RefusalCode::AdmissionInvalid => "admission_invalid",
            RefusalCode::OwnedExitPending => "owned_exit_pending",
        }
    }
}

#[derive(Debug)]
pub enum AdmissionError {
    /// A filesystem error with its errno (TypeScript `NodeJS.ErrnoException`).
    Io(io::Error),
    /// A TypeScript `new Error(message)` refusal.
    Rejected(&'static str),
    /// A `JSON.parse` or zod schema failure (the TypeScript text is not part of the contract).
    Invalid(String),
    /// `DesktopAdmissionRefused` with its code.
    Refused(RefusalCode),
}

impl AdmissionError {
    pub fn is_not_found(&self) -> bool {
        matches!(self, AdmissionError::Io(error) if error.kind() == io::ErrorKind::NotFound)
    }

    pub fn errno(&self) -> Option<i32> {
        match self {
            AdmissionError::Io(error) => error.raw_os_error(),
            _ => None,
        }
    }

    /// Stable classification used by golden tests: errno name, refusal code, `invalid`, or the
    /// exact TypeScript message.
    pub fn classify(&self) -> String {
        match self {
            AdmissionError::Io(error) => match error.raw_os_error() {
                Some(libc::ENOENT) => "ENOENT".into(),
                Some(libc::EEXIST) => "EEXIST".into(),
                Some(libc::ELOOP) => "ELOOP".into(),
                Some(libc::ENOTDIR) => "ENOTDIR".into(),
                Some(libc::EACCES) => "EACCES".into(),
                Some(libc::EPERM) => "EPERM".into(),
                Some(code) => format!("errno:{code}"),
                None => format!("io:{error}"),
            },
            AdmissionError::Rejected(message) => (*message).into(),
            AdmissionError::Invalid(_) => "invalid".into(),
            AdmissionError::Refused(code) => format!("refused:{}", code.as_str()),
        }
    }
}

impl fmt::Display for AdmissionError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            AdmissionError::Io(error) => write!(formatter, "{error}"),
            AdmissionError::Rejected(message) => formatter.write_str(message),
            AdmissionError::Invalid(detail) => write!(formatter, "Invalid record: {detail}"),
            AdmissionError::Refused(_) => {
                formatter.write_str("Previous Desktop pair requires evidence-backed reconciliation")
            }
        }
    }
}

impl std::error::Error for AdmissionError {}

impl From<io::Error> for AdmissionError {
    fn from(error: io::Error) -> Self {
        AdmissionError::Io(error)
    }
}

pub type Result<T> = std::result::Result<T, AdmissionError>;

pub(crate) fn invalid(detail: impl Into<String>) -> AdmissionError {
    AdmissionError::Invalid(detail.into())
}
