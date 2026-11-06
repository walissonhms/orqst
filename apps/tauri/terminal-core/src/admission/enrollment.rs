//! Port of the filesystem part of `terminal/enrollment-files.ts`: the exact historical
//! enrollment serializer and binding digest. `inspectTerminalEnrollment` needs the profile chain
//! (`managed-files.ts`, `interactive-profile.ts`, lane L2) and is not ported here.
use super::error::{AdmissionError, Result};
use super::fs::{self as tfs, terminal_file};
use super::json;
use base64::Engine;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::fs;
use std::os::unix::fs::MetadataExt;
use std::path::Path;

/// Node `${info.dev}:${info.ino}` from a non-bigint `lstatSync` (JavaScript numbers).
pub fn inode(path: &Path, missing: bool) -> Result<Option<String>> {
    match fs::symlink_metadata(path) {
        Ok(info) => {
            if info.file_type().is_symlink() {
                return Err(AdmissionError::Rejected("Enrollment source is a symlink"));
            }
            Ok(Some(format!(
                "{}:{}",
                json::js_number(info.dev() as f64, None),
                json::js_number(info.ino() as f64, None)
            )))
        }
        Err(error) if missing && error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.into()),
    }
}

/// `terminalEnrollmentPreimage(config, identities, source, modelSources)`. `config` must be the
/// `InteractiveTerminalConfig` value in its original key order.
pub fn terminal_enrollment_preimage(
    config: &Value,
    identities: &[Option<String>],
    source: &[u8],
    model_sources: &[(String, Option<String>)],
) -> String {
    let optional = |value: &Option<String>| value.clone().map_or(Value::Null, Value::String);
    json::stringify(&Value::Array(vec![
        config.clone(),
        Value::Array(identities.iter().map(optional).collect()),
        Value::String(base64::engine::general_purpose::STANDARD.encode(source)),
        Value::Array(
            model_sources
                .iter()
                .map(|(path, identity)| {
                    Value::Array(vec![Value::String(path.clone()), optional(identity)])
                })
                .collect(),
        ),
    ]))
}

/// `terminalDigest(string)`: SHA-256 hex of the UTF-8 bytes.
pub fn terminal_digest(value: &str) -> String {
    Sha256::digest(value.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

/// `terminalEnrollmentFile(file, config)` without the config copy.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TerminalEnrollmentBinding {
    pub identities: Vec<Option<String>>,
    pub binding_digest: String,
}

fn config_path<'a>(config: &'a Value, pointer: &str) -> Result<&'a str> {
    config
        .pointer(pointer)
        .and_then(Value::as_str)
        .ok_or_else(|| super::error::invalid(format!("config{pointer}")))
}

/// Frozen originals are compared as metadata, never re-inspected as fresh/empty profiles.
pub fn terminal_enrollment_file(file: &Path, config: &Value) -> Result<TerminalEnrollmentBinding> {
    let paths = [
        file.to_string_lossy().into_owned(),
        config_path(config, "/state")?.to_owned(),
        config_path(config, "/project")?.to_owned(),
        config_path(config, "/executable/path")?.to_owned(),
        config_path(config, "/node/path")?.to_owned(),
    ];
    let identities = paths
        .iter()
        .map(|path| inode(Path::new(path), false))
        .collect::<Result<Vec<_>>>()?;
    let source = terminal_file(file, true, tfs::DEFAULT_FILE_BUDGET, None)?;
    let mut model_sources = Vec::new();
    if let Some(files) = config.pointer("/model/files").and_then(Value::as_array) {
        for entry in files {
            let path = config_path(entry, "/path")?;
            model_sources.push((path.to_owned(), inode(Path::new(path), true)?));
        }
    }
    let binding_digest = terminal_digest(&terminal_enrollment_preimage(
        config,
        &identities,
        &source,
        &model_sources,
    ));
    Ok(TerminalEnrollmentBinding {
        identities,
        binding_digest,
    })
}
