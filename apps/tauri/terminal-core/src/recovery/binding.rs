//! Ports of `offline-historical-binding.ts` and `offline-physical-binding.ts`: administrative
//! evidence comparisons only, never imported by launch/claim validation. Model source content,
//! auth files and sessions are never opened.
use super::error::{fail, RecoveryError, Result};
use super::fsio::{dirname, FileRecord};
use super::js::{obj, s, stringify};
use crate::admission::enrollment::{
    terminal_digest, terminal_enrollment_file, terminal_enrollment_preimage,
};
use crate::admission::fs::{
    node_normalized, terminal_directory, terminal_file, DEFAULT_FILE_BUDGET,
};
use crate::authority::terminal_digest as digest_bytes;
use serde_json::Value;
use std::fs;
use std::os::unix::fs::MetadataExt;
use std::path::Path;

/// `terminalEnrollmentFile(file, config)` with the parsed config kept.
#[derive(Clone, Debug)]
pub struct Binding {
    pub file: String,
    pub config: Value,
    pub identities: Vec<Option<String>>,
    pub binding_digest: String,
}

pub fn enrollment_binding(file: &str, config: &Value) -> Result<Binding> {
    let binding = terminal_enrollment_file(Path::new(file), config)?;
    Ok(Binding {
        file: file.to_owned(),
        config: config.clone(),
        identities: binding.identities,
        binding_digest: binding.binding_digest,
    })
}

fn model_paths(config: &Value) -> Vec<String> {
    config
        .pointer("/model/files")
        .and_then(Value::as_array)
        .map(|files| {
            files
                .iter()
                .filter_map(|f| f.get("path").and_then(Value::as_str).map(str::to_owned))
                .collect()
        })
        .unwrap_or_default()
}

fn uid() -> u32 {
    // SAFETY: getuid cannot fail.
    unsafe { libc::getuid() }
}

/// One `offlineModelSourceMetadata` entry: `identity` is `[dev, ino, mode, uid, nlink]` or absent.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SourceMetadata {
    pub path: String,
    pub identity: Option<Vec<String>>,
}

impl SourceMetadata {
    pub fn to_value(&self) -> Value {
        obj([
            ("path", s(&self.path)),
            (
                "identity",
                self.identity.as_ref().map_or(Value::Null, |i| {
                    Value::Array(i.iter().map(|v| s(v)).collect())
                }),
            ),
        ])
    }
    pub fn from_value(value: &Value) -> SourceMetadata {
        SourceMetadata {
            path: value
                .get("path")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned(),
            identity: value
                .get("identity")
                .and_then(Value::as_array)
                .map(|items| {
                    items
                        .iter()
                        .map(|v| v.as_str().unwrap_or_default().to_owned())
                        .collect()
                }),
        }
    }
    fn short(&self) -> Option<String> {
        self.identity.as_ref().map(|i| format!("{}:{}", i[0], i[1]))
    }
}

pub fn sources_value(sources: &[SourceMetadata]) -> Value {
    Value::Array(sources.iter().map(SourceMetadata::to_value).collect())
}

fn critical(info: &fs::Metadata) -> Vec<String> {
    vec![
        info.dev().to_string(),
        info.ino().to_string(),
        info.mode().to_string(),
        info.uid().to_string(),
        info.nlink().to_string(),
    ]
}

fn realpath(path: &str) -> Result<String> {
    Ok(fs::canonicalize(path)?.to_string_lossy().into_owned())
}

/// `offlineModelSourceMetadata(paths)`.
pub fn offline_model_source_metadata(paths: &[String]) -> Result<Vec<SourceMetadata>> {
    paths
        .iter()
        .map(|path| {
            if !node_normalized(Path::new(path)) {
                return fail("Noncanonical offline model source");
            }
            let mut parent = dirname(path);
            loop {
                let attempt = (|| -> Result<()> {
                    if fs::symlink_metadata(&parent)?.file_type().is_symlink() {
                        return fail("Offline model source ancestor is a symlink");
                    }
                    terminal_directory(Path::new(&parent), false)?;
                    Ok(())
                })();
                match attempt {
                    Ok(()) => break,
                    Err(error) if error.is_not_found() && parent != "/" => {
                        parent = dirname(&parent)
                    }
                    Err(error) => return Err(error),
                }
            }
            let info = match fs::symlink_metadata(path) {
                Ok(info) => info,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                    return Ok(SourceMetadata {
                        path: path.clone(),
                        identity: None,
                    })
                }
                Err(error) => return Err(error.into()),
            };
            if !info.file_type().is_file()
                || info.nlink() != 1
                || info.uid() != uid()
                || info.mode() & 0o022 != 0
                || realpath(path)? != *path
            {
                return fail("Untrusted offline model source metadata");
            }
            Ok(SourceMetadata {
                path: path.clone(),
                identity: Some(critical(&info)),
            })
        })
        .collect()
}

fn enrollment_preimage_digest(
    binding: &Binding,
    identities: &[Option<String>],
    source: &[u8],
    model_sources: &[(String, Option<String>)],
) -> String {
    terminal_digest(&terminal_enrollment_preimage(
        &binding.config,
        identities,
        source,
        model_sources,
    ))
}

/// `verifyHistoricalBinding(evidence, binding, currentSources, historicalIdentities)`.
pub fn verify_historical_binding(
    evidence: &Value,
    binding: &Binding,
    current_sources: &[SourceMetadata],
    historical_identities: &[Option<String>],
) -> Result<()> {
    let evidence = super::schema::historical_evidence(evidence)?;
    let selected = &evidence["historicalModelSource"];
    let selected_index = selected["index"].as_u64().unwrap_or(0) as usize;
    let selected_path = selected["path"].as_str().unwrap_or_default();
    let selected_identity = selected["identity"].as_str().unwrap_or_default();
    let frozen = evidence["member"]["frozenBindingDigest"]
        .as_str()
        .unwrap_or_default();
    let sources = evidence["modelSources"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    let config_paths = model_paths(&binding.config);
    let has_model = binding.config.get("model").is_some_and(|m| !m.is_null());
    if binding.binding_digest == frozen
        || !has_model
        || config_paths.len() != sources.len()
        || current_sources.len() != sources.len()
    {
        return fail("Historical binding evidence is redundant or incomplete");
    }
    let mut model_sources = Vec::new();
    for (index, source) in sources.iter().enumerate() {
        let current = &current_sources[index];
        let current_identity = current.short();
        let path = source["path"].as_str().unwrap_or_default();
        let identity = source["identity"].as_str().map(str::to_owned);
        if path != config_paths[index] || path != current.path {
            return fail("Historical binding model source path changed");
        }
        if index == selected_index {
            let same_device = current
                .identity
                .as_ref()
                .is_some_and(|i| i[0] == selected_identity.split(':').next().unwrap_or_default());
            if path != selected_path
                || identity.as_deref() != Some(selected_identity)
                || current_identity.is_none()
                || current_identity.as_deref() == Some(selected_identity)
                || !same_device
            {
                return fail("Historical binding requires exactly one inode on the same device");
            }
        } else if identity != current_identity {
            return fail("Historical binding additional source drift");
        }
        model_sources.push((path.to_owned(), identity));
    }
    let source = terminal_file(Path::new(&binding.file), true, DEFAULT_FILE_BUDGET, None)?;
    if selected_index >= model_sources.len()
        || enrollment_preimage_digest(binding, historical_identities, &source, &model_sources)
            != frozen
    {
        return fail("Historical enrollment preimage does not match");
    }
    Ok(())
}

// ---------------------------------------------------------------------------------------------
// offline-physical-binding.ts
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DeviceDifference {
    pub historical_device: String,
    pub current_device: String,
}

/// `historicalIdentity(identity, difference)`.
pub fn historical_identity(
    identity: Option<&str>,
    difference: Option<&DeviceDifference>,
) -> Option<String> {
    let identity = identity?;
    let Some(difference) = difference else {
        return Some(identity.to_owned());
    };
    let mut parts = identity.split(':');
    let device = parts.next().unwrap_or_default();
    let inode = parts.next().map_or("undefined".to_owned(), str::to_owned);
    let device = if device == difference.current_device {
        &difference.historical_device
    } else {
        device
    };
    Some(format!("{device}:{inode}"))
}

/// `comparePhysicalFiles(saved, read)`.
pub fn compare_physical_files(
    saved: &Value,
    read: &mut dyn FnMut(&str) -> Result<FileRecord>,
) -> Result<Option<DeviceDifference>> {
    let files: Vec<FileRecord> = saved["files"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .iter()
        .map(FileRecord::from_value)
        .collect::<Result<_>>()?;
    let first = files
        .first()
        .ok_or_else(|| RecoveryError::Failed("files".into()))?;
    if read(&first.path)?.identity[0] == first.identity[0] {
        return Ok(None);
    }
    let mut pairs: Vec<(String, String)> = Vec::new();
    let mut paths: Vec<&str> = Vec::new();
    for original in &files {
        if paths.contains(&original.path.as_str())
            || digest_bytes(&original.raw()) != original.sha256
        {
            return fail("Recovery historical file record changed");
        }
        paths.push(&original.path);
        let current = read(&original.path)?;
        let pair = (original.identity[0].clone(), current.identity[0].clone());
        if !pairs.contains(&pair) {
            pairs.push(pair);
        }
        let mut normalized = current.clone();
        normalized.identity[0] = original.identity[0].clone();
        if stringify(&normalized.to_value()) != stringify(&original.to_value()) {
            return fail("Recovery physical comparison requires exact preserved files");
        }
    }
    let changed: Vec<&(String, String)> = pairs
        .iter()
        .filter(|(old, current)| old != current)
        .collect();
    if changed.is_empty() {
        return Ok(None);
    }
    if pairs.len() != 1 || changed.len() != 1 {
        return fail("Recovery mixed physical device mapping");
    }
    Ok(Some(DeviceDifference {
        historical_device: changed[0].0.clone(),
        current_device: changed[0].1.clone(),
    }))
}

/// `offlineBindingMetadata(binding)`.
pub fn offline_binding_metadata(binding: &Binding) -> Result<Vec<SourceMetadata>> {
    let pointer = |p: &str| {
        binding
            .config
            .pointer(p)
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned()
    };
    let paths = [
        binding.file.clone(),
        pointer("/state"),
        pointer("/project"),
        pointer("/executable/path"),
        pointer("/node/path"),
    ];
    let mut out = Vec::new();
    for (index, path) in paths.iter().enumerate() {
        let info = fs::symlink_metadata(path)?;
        let kind_ok = if index == 1 || index == 2 {
            info.file_type().is_dir()
        } else {
            info.file_type().is_file() && info.nlink() == 1
        };
        if realpath(path)? != *path
            || info.file_type().is_symlink()
            || info.mode() & 0o022 != 0
            || (info.uid() != uid() && (index < 3 || info.uid() != 0))
            || !kind_ok
        {
            return fail("Untrusted offline enrollment metadata");
        }
        let mut parent = Path::new(path).parent();
        while let Some(current) = parent {
            if current.parent().is_none() {
                break;
            }
            let ancestor = fs::symlink_metadata(current)?;
            if ancestor.file_type().is_symlink()
                || (ancestor.mode() & 0o022 != 0 && ancestor.mode() & 0o1000 == 0)
            {
                return fail("Untrusted offline enrollment ancestor");
            }
            parent = current.parent();
        }
        out.push(SourceMetadata {
            path: path.clone(),
            identity: Some(critical(&info)),
        });
    }
    out.extend(offline_model_source_metadata(&model_paths(
        &binding.config,
    ))?);
    Ok(out)
}

/// `physicalBindingDigest(binding, source, difference)`.
pub fn physical_binding_digest(
    binding: &Binding,
    source: &[u8],
    difference: &DeviceDifference,
) -> Result<String> {
    let current = offline_model_source_metadata(&model_paths(&binding.config))?;
    let identities: Vec<Option<String>> = binding
        .identities
        .iter()
        .map(|i| historical_identity(i.as_deref(), Some(difference)))
        .collect();
    let model: Vec<(String, Option<String>)> = current
        .iter()
        .map(|m| {
            (
                m.path.clone(),
                historical_identity(m.short().as_deref(), Some(difference)),
            )
        })
        .collect();
    Ok(enrollment_preimage_digest(
        binding,
        &identities,
        source,
        &model,
    ))
}

pub fn model_source_paths(config: &Value) -> Vec<String> {
    model_paths(config)
}
