//! Port of `managed-codex/lifecycle-receipt.ts`: `lifecycle-<instanceId>.jsonl` in the private
//! terminal state. `O_CREAT|O_EXCL|O_APPEND|O_NOFOLLOW`, 0600, `nlink` 1, at most 4096 bytes,
//! file and directory fsync, strict order prepared → armed → started|spawn_failed → exit.
use super::error::{invalid, AdmissionError, Result};
use super::fs::{self as tfs, terminal_directory};
use super::json::{self, literal_one, safe_int, strict};
use serde::Serialize;
use serde_json::Value;
use std::fs::{File, OpenOptions};
use std::io::Write;
use std::os::fd::AsRawFd;
use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
use std::path::{Path, PathBuf};

const MAXIMUM_BYTES: usize = 4096;

/// `lifecycleBindingSchema`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LifecycleBinding {
    pub instance_id: String,
    pub epoch: String,
    pub manifest_digest: String,
    pub config_digest: String,
}

impl LifecycleBinding {
    pub fn parse(value: &Value) -> Result<Self> {
        let map = strict(
            value,
            &["instanceId", "epoch", "manifestDigest", "configDigest"],
        )?;
        let binding = Self {
            instance_id: json::uuid(map, "instanceId")?,
            epoch: json::uuid(map, "epoch")?,
            manifest_digest: json::string(map, "manifestDigest")?.to_owned(),
            config_digest: json::string(map, "configDigest")?.to_owned(),
        };
        binding.validate()?;
        Ok(binding)
    }

    pub fn validate(&self) -> Result<()> {
        if !json::is_uuid(&self.instance_id)
            || !json::is_uuid(&self.epoch)
            || !json::is_digest(&self.manifest_digest)
            || !json::is_digest(&self.config_digest)
        {
            return Err(invalid("lifecycle binding"));
        }
        Ok(())
    }
}

/// The `prepared` header line.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct LifecycleHeader {
    #[serde(rename = "type")]
    pub kind: &'static str,
    pub version: u8,
    pub binding: LifecycleBinding,
    pub at: u64,
}

/// One appended record (`armed`, `started`, `spawn_failed`, `exit`), schema key order.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct LifecycleRecord {
    #[serde(rename = "type")]
    pub kind: &'static str,
    pub at: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<Option<i64>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub signal: Option<Option<String>>,
}

/// Events the host appends after `armed`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum LifecycleEvent {
    Started,
    SpawnFailed,
    Exit {
        code: Option<i64>,
        signal: Option<String>,
    },
}

fn timestamp(value: Option<&Value>) -> Result<u64> {
    value
        .and_then(safe_int)
        .filter(|at| *at >= 0)
        .map(|at| at as u64)
        .ok_or_else(|| invalid("at"))
}

fn valid_signal(signal: &str) -> bool {
    let Some(rest) = signal.strip_prefix("SIG") else {
        return false;
    };
    (1..=29).contains(&rest.len())
        && rest
            .bytes()
            .all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit())
}

fn parse_header(value: &Value) -> Result<LifecycleHeader> {
    let map = strict(value, &["type", "version", "binding", "at"])?;
    if map.get("type").and_then(Value::as_str) != Some("prepared")
        || !literal_one(map.get("version"))
    {
        return Err(invalid("header"));
    }
    let binding = LifecycleBinding::parse(
        map.get("binding")
            .ok_or_else(|| invalid("binding: required"))?,
    )?;
    Ok(LifecycleHeader {
        kind: "prepared",
        version: 1,
        binding,
        at: timestamp(map.get("at"))?,
    })
}

fn parse_record(value: &Value) -> Result<LifecycleRecord> {
    let kind = value
        .get("type")
        .and_then(Value::as_str)
        .ok_or_else(|| invalid("type"))?;
    let kind: &'static str = match kind {
        "armed" => "armed",
        "started" => "started",
        "spawn_failed" => "spawn_failed",
        "exit" => "exit",
        _ => return Err(invalid("type")),
    };
    if kind != "exit" {
        let map = strict(value, &["type", "at"])?;
        return Ok(LifecycleRecord {
            kind,
            at: timestamp(map.get("at"))?,
            code: None,
            signal: None,
        });
    }
    let map = strict(value, &["type", "at", "code", "signal"])?;
    let at = timestamp(map.get("at"))?;
    let code = match map.get("code") {
        Some(Value::Null) => None,
        Some(code) => Some(safe_int(code).ok_or_else(|| invalid("code"))?),
        None => return Err(invalid("code: required")),
    };
    let signal = match map.get("signal") {
        Some(Value::Null) => None,
        Some(Value::String(signal)) if valid_signal(signal) => Some(signal.clone()),
        _ => return Err(invalid("signal")),
    };
    if code.is_none() && signal.is_none() {
        return Err(invalid("exit evidence"));
    }
    Ok(LifecycleRecord {
        kind,
        at,
        code: Some(code),
        signal: Some(signal),
    })
}

fn inspect(file: &File) -> Result<Vec<u8>> {
    let info = file.metadata()?;
    if !tfs::is_file(&info)
        || info.uid() != tfs::uid()
        || info.mode() & 0o077 != 0
        || info.nlink() != 1
        || info.size() > MAXIMUM_BYTES as u64
    {
        return Err(AdmissionError::Rejected(
            "Private lifecycle receipt unavailable",
        ));
    }
    let mut bytes = vec![0u8; MAXIMUM_BYTES + 1];
    // One positional read, as `readSync(fd, bytes, 0, length, 0)`.
    // SAFETY: the buffer is valid for `bytes.len()` writable bytes and the descriptor is open.
    let size = unsafe { libc::pread(file.as_raw_fd(), bytes.as_mut_ptr().cast(), bytes.len(), 0) };
    if size < 0 {
        return Err(std::io::Error::last_os_error().into());
    }
    let size = size as usize;
    if size > MAXIMUM_BYTES {
        return Err(AdmissionError::Rejected("Lifecycle receipt limit"));
    }
    bytes.truncate(size);
    Ok(bytes)
}

fn write_all(mut file: &File, bytes: &[u8]) -> Result<()> {
    let mut offset = 0;
    while offset < bytes.len() {
        let written = file.write(&bytes[offset..])?;
        if written == 0 {
            return Err(AdmissionError::Rejected(
                "Lifecycle receipt write unavailable",
            ));
        }
        offset += written;
    }
    Ok(())
}

fn append(file: &File, line: &str) -> Result<()> {
    let bytes = format!("{line}\n");
    if file.metadata()?.size() as usize + bytes.len() > MAXIMUM_BYTES {
        return Err(AdmissionError::Rejected("Lifecycle receipt limit"));
    }
    write_all(file, bytes.as_bytes())?;
    tfs::fsync(file)
}

fn receipt_path(state: &Path, binding: &LifecycleBinding) -> Result<PathBuf> {
    binding.validate()?;
    terminal_directory(state, true)?;
    Ok(state.join(format!("lifecycle-{}.jsonl", binding.instance_id)))
}

/// `createLifecycleReceipt(state, binding)`: exclusive pre-dispatch file. Only this descriptor is
/// inherited; the host never opens a path. An incomplete receipt is never deleted.
pub fn create_lifecycle_receipt(
    state: &Path,
    binding: &LifecycleBinding,
    now_ms: u64,
) -> Result<File> {
    let file = OpenOptions::new()
        .read(true)
        .append(true)
        .create_new(true)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW)
        .open(receipt_path(state, binding)?)?;
    inspect(&file)?;
    let header = LifecycleHeader {
        kind: "prepared",
        version: 1,
        binding: binding.clone(),
        at: now_ms,
    };
    append(&file, &json::stringify_serialize(&header))?;
    let directory = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_DIRECTORY)
        .open(state)?;
    tfs::fsync(&directory)?;
    Ok(file)
}

/// `assertLifecycleConfig(fd, configDigest)`: checks the inherited receipt without changing it.
pub fn assert_lifecycle_config(
    file: &File,
    config_digest: &str,
) -> Result<(String, LifecycleHeader)> {
    let bytes = String::from_utf8_lossy(&inspect(file)?).into_owned();
    if !bytes.ends_with('\n') || bytes.split('\n').count() != 2 {
        return Err(AdmissionError::Rejected("Lifecycle receipt already used"));
    }
    let header = parse_header(&json::parse(bytes.as_bytes())?)?;
    if header.binding.config_digest != config_digest {
        return Err(AdmissionError::Rejected("Lifecycle config mismatch"));
    }
    Ok((bytes, header))
}

/// Host-only writer returned by `arm_lifecycle_receipt`. Records are written synchronously in
/// admission order; a failed write poisons every successor.
pub struct LifecycleRecorder {
    file: File,
    previous: u64,
    phase: &'static str,
    size: usize,
    failed: bool,
}

/// `armLifecycleReceipt(fd, configDigest)`: persistence precedes spawn and lifecycle IPC.
pub fn arm_lifecycle_receipt(
    file: File,
    config_digest: &str,
    now_ms: u64,
) -> Result<LifecycleRecorder> {
    let (bytes, header) = assert_lifecycle_config(&file, config_digest)?;
    let armed = LifecycleRecord {
        kind: "armed",
        at: header.at.max(now_ms),
        code: None,
        signal: None,
    };
    let line = json::stringify_serialize(&armed);
    append(&file, &line)?; // Still before spawn: failure prevents any child dispatch.
    Ok(LifecycleRecorder {
        size: bytes.len() + line.len() + 1,
        file,
        previous: armed.at,
        phase: "armed",
        failed: false,
    })
}

impl LifecycleRecorder {
    pub fn record(&mut self, event: LifecycleEvent, now_ms: u64) -> Result<()> {
        let at = self.previous.max(now_ms);
        let next = match event {
            LifecycleEvent::Started => LifecycleRecord {
                kind: "started",
                at,
                code: None,
                signal: None,
            },
            LifecycleEvent::SpawnFailed => LifecycleRecord {
                kind: "spawn_failed",
                at,
                code: None,
                signal: None,
            },
            LifecycleEvent::Exit { code, signal } => {
                if (code.is_none() && signal.is_none())
                    || signal
                        .as_deref()
                        .is_some_and(|signal| !valid_signal(signal))
                    || code.is_some_and(|code| code.abs() > 9_007_199_254_740_991)
                {
                    return Err(invalid("exit record"));
                }
                LifecycleRecord {
                    kind: "exit",
                    at,
                    code: Some(code),
                    signal: Some(signal),
                }
            }
        };
        let allowed: &[&str] = match self.phase {
            "armed" => &["started", "spawn_failed"],
            "started" => &["exit"],
            _ => &[],
        };
        if !allowed.contains(&next.kind) {
            return Err(AdmissionError::Rejected("Lifecycle receipt order"));
        }
        let line = json::stringify_serialize(&next) + "\n";
        self.size += line.len();
        if self.size > MAXIMUM_BYTES {
            return Err(AdmissionError::Rejected("Lifecycle receipt limit"));
        }
        self.phase = next.kind;
        self.previous = next.at;
        if self.failed {
            return Err(AdmissionError::Rejected(
                "Lifecycle receipt writer unavailable",
            ));
        }
        let result = write_all(&self.file, line.as_bytes()).and_then(|()| tfs::fsync(&self.file));
        if result.is_err() {
            self.failed = true;
        }
        result
    }
}

/// `readLifecycleReceipt` result.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum LifecycleReceiptRead {
    Missing,
    Invalid,
    Incomplete {
        header: LifecycleHeader,
        records: Vec<LifecycleRecord>,
    },
    RecordedExit {
        header: LifecycleHeader,
        records: Vec<LifecycleRecord>,
    },
}

/// `readLifecycleReceipt(state, binding)`: explicit read-only evidence inspection; never opens a
/// Store, adopts a PID or frees capacity.
pub fn read_lifecycle_receipt(state: &Path, binding: &LifecycleBinding) -> LifecycleReceiptRead {
    match read(state, binding) {
        Ok(read) => read,
        Err(error) if error.is_not_found() => LifecycleReceiptRead::Missing,
        Err(_) => LifecycleReceiptRead::Invalid,
    }
}

fn read(state: &Path, binding: &LifecycleBinding) -> Result<LifecycleReceiptRead> {
    let file = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
        .open(receipt_path(state, binding)?)?;
    let bytes = String::from_utf8_lossy(&inspect(&file)?).into_owned();
    let body = bytes
        .strip_suffix('\n')
        .ok_or_else(|| invalid("Partial lifecycle receipt"))?;
    let mut lines = body.split('\n');
    if body.split('\n').count() > 4 {
        return Err(AdmissionError::Rejected("Lifecycle receipt limit"));
    }
    let header = parse_header(&json::parse(lines.next().unwrap_or("").as_bytes())?)?;
    if header.binding != *binding {
        return Err(AdmissionError::Rejected("Lifecycle identity mismatch"));
    }
    let records = lines
        .map(|line| parse_record(&json::parse(line.as_bytes())?))
        .collect::<Result<Vec<_>>>()?;
    let mut phase = "prepared";
    let mut at = header.at;
    for record in &records {
        let allowed: &[&str] = match phase {
            "prepared" => &["armed"],
            "armed" => &["started", "spawn_failed"],
            "started" => &["exit"],
            _ => &[],
        };
        if !allowed.contains(&record.kind) || record.at < at {
            return Err(AdmissionError::Rejected("Lifecycle receipt order"));
        }
        phase = record.kind;
        at = record.at;
    }
    Ok(if phase == "exit" {
        LifecycleReceiptRead::RecordedExit { header, records }
    } else {
        LifecycleReceiptRead::Incomplete { header, records }
    })
}
