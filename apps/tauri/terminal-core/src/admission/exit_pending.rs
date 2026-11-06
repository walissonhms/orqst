//! Port of `terminal/exit-pending.ts`: `exit-pending-<owner>.json` (exclusive, 0600, fsync) and
//! the `pending-pair-<owner>.json` namespace handoff. Passive evidence only: never signals,
//! retires, deletes a reservation or adopts a PID.
use super::error::{invalid, AdmissionError, Result};
use super::fs::{self as tfs, terminal_directory, terminal_file, terminal_text};
use super::json::{self, literal_one, strict};
use super::owned_shutdown::{parse_owned_shutdown_inventory, OwnedShutdownInventory};
use serde::Serialize;
use serde_json::Value;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
use std::path::Path;

pub const MAXIMUM_PENDING_OWNED_EXITS: usize = 64;
const EXIT_MARKER_LIMIT: usize = 256 * 1024;

/// `ownedExitPendingSchema` output (schema key order).
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct OwnedExitPending {
    pub version: u8,
    pub status: &'static str,
    pub owner: String,
    pub evidence: OwnedShutdownInventory,
}

pub const LEADER_EXITED_RETIREMENT_PENDING: &str = "leader_exited_retirement_pending";

/// `ownedExitPendingSchema.parse(value)` including the exit-evidence refinement.
pub fn parse_owned_exit_pending(value: &Value) -> Result<OwnedExitPending> {
    let map = strict(value, &["version", "status", "owner", "evidence"])?;
    if !literal_one(map.get("version")) {
        return Err(invalid("version"));
    }
    if map.get("status").and_then(Value::as_str) != Some(LEADER_EXITED_RETIREMENT_PENDING) {
        return Err(invalid("status"));
    }
    let owner = json::uuid(map, "owner")?;
    let evidence = parse_owned_shutdown_inventory(
        map.get("evidence")
            .ok_or_else(|| invalid("evidence: required"))?,
    )?;
    let attempts = &evidence.attempts;
    if !attempts
        .iter()
        .any(|a| a.state == "exited" && a.exit.is_some())
        || !attempts.iter().all(|a| {
            a.epoch == evidence.epoch
                && (matches!(a.state.as_str(), "prepared" | "start_failed")
                    || (a.state == "exited" && a.exit.is_some()))
        })
    {
        return Err(invalid("Owned exit evidence required"));
    }
    Ok(OwnedExitPending {
        version: 1,
        status: LEADER_EXITED_RETIREMENT_PENDING,
        owner,
        evidence,
    })
}

impl OwnedExitPending {
    /// `JSON.stringify(record)`.
    pub fn to_json(&self) -> String {
        json::stringify_serialize(self)
    }
}

/// `readOwnedExitPending(directory, owner, epoch)`.
pub fn read_owned_exit_pending(
    directory: &Path,
    owner: &str,
    epoch: &str,
) -> Result<Option<OwnedExitPending>> {
    terminal_directory(directory, true)?;
    if !json::is_uuid(owner) {
        return Err(invalid("owner: invalid uuid"));
    }
    let file = directory.join(format!("exit-pending-{owner}.json"));
    let info = match fs::symlink_metadata(&file) {
        Ok(info) => info,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.into()),
    };
    if !tfs::is_file(&info) || info.nlink() != 1 {
        return Err(AdmissionError::Rejected("Unsafe owned exit marker"));
    }
    let record = parse_owned_exit_pending(&json::parse(&terminal_file(
        &file,
        true,
        EXIT_MARKER_LIMIT,
        None,
    )?)?)?;
    if record.owner != owner || record.evidence.epoch != epoch {
        return Err(AdmissionError::Rejected("Owned exit marker scope changed"));
    }
    Ok(Some(record))
}

/// `preserveOwnedExitPending`: Core owner only. Exclusive durable append; the original
/// active-pair and receipts stay intact.
pub fn preserve_owned_exit_pending(
    directory: &Path,
    value: &Value,
    assert_owner: &dyn Fn() -> Result<()>,
) -> Result<OwnedExitPending> {
    assert_owner()?;
    terminal_directory(directory, true)?;
    let record = parse_owned_exit_pending(value)?;
    if let Some(existing) =
        read_owned_exit_pending(directory, &record.owner, &record.evidence.epoch)?
    {
        if existing.to_json() != record.to_json() {
            return Err(AdmissionError::Rejected("Owned exit evidence changed"));
        }
        return Ok(existing);
    }
    let file = directory.join(format!("exit-pending-{}.json", record.owner));
    let bytes = record.to_json() + "\n";
    if bytes.len() > EXIT_MARKER_LIMIT {
        return Err(AdmissionError::Rejected("Owned exit marker limit"));
    }
    let mut handle = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW)
        .open(&file)?;
    handle.write_all(bytes.as_bytes())?;
    tfs::fsync(&handle)?;
    drop(handle);
    tfs::sync_directory(directory)?;
    assert_owner()?;
    read_owned_exit_pending(directory, &record.owner, &record.evidence.epoch)?
        .ok_or_else(|| invalid("exit marker disappeared"))
}

/// `pendingOwnedExitNoticeSchema`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingOwnedExitNotice {
    pub id: String,
    pub code: &'static str,
    pub principal_count: u32,
}

/// `z.object({ owner: z.uuid(), epoch: z.uuid() })` (non-strict).
fn admission_identity(value: &Value) -> Result<(String, String)> {
    let map = json::object(value)?;
    Ok((json::uuid(map, "owner")?, json::uuid(map, "epoch")?))
}

fn pending_name(name: &str) -> bool {
    let Some(middle) = name
        .strip_prefix("pending-pair-")
        .and_then(|n| n.strip_suffix(".json"))
    else {
        return false;
    };
    middle.len() == 36
        && middle
            .bytes()
            .all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f' | b'-'))
}

/// `inspectPendingOwnedExits(directory)`: bounded deterministic notices. Preserved reservations
/// are never adopted or automatically deleted.
pub fn inspect_pending_owned_exits(directory: &Path) -> Result<Vec<PendingOwnedExitNotice>> {
    match terminal_directory(directory, true) {
        Err(error) if error.is_not_found() => return Ok(Vec::new()),
        result => result?,
    }
    let mut names = Vec::new();
    for (entries, entry) in fs::read_dir(directory)?.enumerate() {
        if entries >= 4096 {
            return Err(AdmissionError::Rejected("Pending directory entry budget"));
        }
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if pending_name(&name) {
            names.push(name);
        }
        if names.len() > MAXIMUM_PENDING_OWNED_EXITS {
            return Err(AdmissionError::Rejected("Pending reservation limit"));
        }
    }
    names.sort();
    names
        .iter()
        .map(|name| {
            let file = directory.join(name);
            let info = fs::symlink_metadata(&file)?;
            if !tfs::is_file(&info) || info.nlink() != 1 {
                return Err(AdmissionError::Rejected("Unsafe pending reservation"));
            }
            let (owner, epoch) = admission_identity(&json::parse(&terminal_file(
                &file,
                true,
                tfs::DEFAULT_FILE_BUDGET,
                None,
            )?)?)?;
            if *name != format!("pending-pair-{owner}.json") {
                return Err(AdmissionError::Rejected("Pending reservation identity"));
            }
            let marker = read_owned_exit_pending(directory, &owner, &epoch)?
                .ok_or(AdmissionError::Rejected("Pending exit evidence missing"))?;
            let principal_count = marker
                .evidence
                .attempts
                .iter()
                .filter(|a| a.state == "exited")
                .count() as u32;
            if !(1..=1024).contains(&principal_count) {
                return Err(invalid("principalCount"));
            }
            Ok(PendingOwnedExitNotice {
                id: owner,
                code: "owned_exit_pending",
                principal_count,
            })
        })
        .collect()
}

/// Injectable effects for `detachOwnedExitPending` (TypeScript `operations`).
pub struct DetachOperations<'a> {
    pub rename: &'a mut dyn FnMut(&Path, &Path) -> Result<()>,
    pub sync: &'a mut dyn FnMut(&Path) -> Result<()>,
}

/// `detachOwnedExitPending` with the default `renameSync` / directory fsync.
pub fn detach_owned_exit_pending(
    directory: &Path,
    expected_marker: &str,
    assert_owner: &dyn Fn() -> Result<()>,
) -> Result<()> {
    let mut rename = |from: &Path, to: &Path| fs::rename(from, to).map_err(AdmissionError::from);
    let mut sync = |directory: &Path| tfs::sync_directory(directory);
    detach_owned_exit_pending_with(
        directory,
        expected_marker,
        assert_owner,
        DetachOperations {
            rename: &mut rename,
            sync: &mut sync,
        },
    )
}

/// Core-owned namespace handoff, never retirement. Rename and fsync stay in one verified
/// directory; only the same bytes move to the pending namespace.
pub fn detach_owned_exit_pending_with(
    directory: &Path,
    expected_marker: &str,
    assert_owner: &dyn Fn() -> Result<()>,
    operations: DetachOperations<'_>,
) -> Result<()> {
    terminal_directory(directory, true)?;
    let (owner, epoch) = admission_identity(&json::parse(expected_marker.as_bytes())?)?;
    if read_owned_exit_pending(directory, &owner, &epoch)?.is_none() {
        return Err(AdmissionError::Rejected("Durable pending exit required"));
    }
    let source = directory.join("active-pair.json");
    let target = directory.join(format!("pending-pair-{owner}.json"));
    let existing = match terminal_text(&target, true, tfs::DEFAULT_FILE_BUDGET) {
        Ok(text) => Some(text),
        Err(error) if error.is_not_found() => None,
        Err(error) => return Err(error),
    };
    if let Some(existing) = existing {
        if existing != expected_marker {
            return Err(AdmissionError::Rejected("Pending reservation changed"));
        }
        // A repeated ACK may arrive after a new owner claims active-pair. Never touch it.
        let active = match terminal_text(&source, true, tfs::DEFAULT_FILE_BUDGET) {
            Ok(text) => Some(text),
            Err(error) if error.is_not_found() => None,
            Err(error) => return Err(error),
        };
        if active.as_deref() == Some(expected_marker) {
            return Err(AdmissionError::Rejected(
                "Duplicate pending reservation namespace",
            ));
        }
        return (operations.sync)(directory);
    }
    if inspect_pending_owned_exits(directory)?.len() >= MAXIMUM_PENDING_OWNED_EXITS {
        return Err(AdmissionError::Rejected("Pending reservation limit"));
    }
    assert_owner()?;
    if terminal_text(&source, true, tfs::DEFAULT_FILE_BUDGET)? != expected_marker {
        return Err(AdmissionError::Rejected("Active reservation changed"));
    }
    (operations.rename)(&source, &target)?;
    (operations.sync)(directory)?;
    if terminal_text(&target, true, tfs::DEFAULT_FILE_BUDGET)? != expected_marker {
        return Err(AdmissionError::Rejected(
            "Pending reservation durability unconfirmed",
        ));
    }
    Ok(())
}
