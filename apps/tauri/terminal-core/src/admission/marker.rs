//! Port of `managed-codex/desktop-admission.ts` and `desktop-admission-inspection.ts`:
//! the sticky `managed-agents/active-pair.json` reservation, enrollment records and the
//! `retired-<owner>-<uuid>.json` archive. No TTL, PID probe or automatic takeover.
use super::error::{invalid, AdmissionError, RefusalCode, Result};
use super::exit_pending::{detach_owned_exit_pending, read_owned_exit_pending};
use super::fs::{
    self as tfs, assert_no_offline_recovery, sync_directory, terminal_directory, terminal_file,
    terminal_text, write_exclusive,
};
use super::json::{self, literal_one, strict, utf16_len};
use serde_json::{json, Map, Value};
use std::fs;
use std::os::unix::fs::{DirBuilderExt, MetadataExt};
use std::path::{Path, PathBuf};

pub const ACTIVE_PAIR: &str = "active-pair.json";
pub const RETIREMENT_ARCHIVE_LIMIT: usize = 1024 * 1024;
const MARKER_READ_LIMIT: usize = 16 * 1024;

fn is_manifest_path(value: &Value) -> bool {
    value.as_str().is_some_and(|path| {
        path.starts_with('/') && utf16_len(path) <= 2048 && !path.contains('\0')
    })
}

fn manifests(value: Option<&Value>, minimum: usize) -> Result<Vec<String>> {
    let items = value
        .and_then(Value::as_array)
        .ok_or_else(|| invalid("manifests"))?;
    if items.len() > 8 || items.len() < minimum || !items.iter().all(is_manifest_path) {
        return Err(invalid("manifests"));
    }
    Ok(items
        .iter()
        .filter_map(|item| item.as_str().map(str::to_owned))
        .collect())
}

/// `desktopAdmissionMarkerSchema` output.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DesktopAdmissionMarker {
    pub owner: String,
    pub manifests: Vec<String>,
    pub epoch: Option<String>,
}

pub fn parse_desktop_admission_marker(value: &Value) -> Result<DesktopAdmissionMarker> {
    let map = strict(value, &["version", "owner", "manifests", "epoch"])?;
    if !literal_one(map.get("version")) {
        return Err(invalid("version"));
    }
    let owner = json::uuid(map, "owner")?;
    let manifests = manifests(map.get("manifests"), 0)?;
    let epoch = match map.get("epoch") {
        None => None,
        Some(_) => Some(json::uuid(map, "epoch")?),
    };
    Ok(DesktopAdmissionMarker {
        owner,
        manifests,
        epoch,
    })
}

/// `desktopAdmissionContextSchema`: private owned-Core evidence only, never from a renderer.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DesktopAdmissionContext {
    pub owner: String,
    pub epoch: String,
    pub initial_files: Vec<String>,
}

impl DesktopAdmissionContext {
    pub fn parse(value: &Value) -> Result<Self> {
        let map = strict(value, &["owner", "epoch", "initialFiles"])?;
        Ok(Self {
            owner: json::uuid(map, "owner")?,
            epoch: json::uuid(map, "epoch")?,
            initial_files: manifests(map.get("initialFiles"), 1)?,
        })
    }

    fn validate(&self) -> Result<()> {
        let value = json!({
            "owner": self.owner, "epoch": self.epoch, "initialFiles": self.initial_files,
        });
        Self::parse(&value).map(|_| ())
    }
}

#[derive(PartialEq, Eq)]
struct Stat {
    dev: u64,
    ino: u64,
    mode: u32,
    uid: u32,
    nlink: u64,
    size: u64,
    mtime_ns: i128,
    ctime_ns: i128,
    file: bool,
    dir: bool,
}

fn stat(path: &Path) -> std::io::Result<Stat> {
    let info = fs::symlink_metadata(path)?;
    Ok(Stat {
        dev: info.dev(),
        ino: info.ino(),
        mode: info.mode(),
        uid: info.uid(),
        nlink: info.nlink(),
        size: info.size(),
        mtime_ns: info.mtime() as i128 * 1_000_000_000 + info.mtime_nsec() as i128,
        ctime_ns: info.ctime() as i128 * 1_000_000_000 + info.ctime_nsec() as i128,
        file: tfs::is_file(&info),
        dir: tfs::is_dir(&info),
    })
}

fn same_directory(a: &Stat, b: &Stat) -> bool {
    a.dev == b.dev && a.ino == b.ino && a.mode == b.mode && a.uid == b.uid
}

fn strings(values: &[Option<String>]) -> String {
    json::stringify(&Value::Array(
        values
            .iter()
            .map(|value| value.clone().map_or(Value::Null, Value::String))
            .collect(),
    ))
}

/// `inspectDesktopAdmission(directory, current)`: passive, bounded inspection. No mkdir, Store,
/// claim, cleanup, PID probe or takeover. Every failure is a `Refused` code.
pub fn inspect_desktop_admission(
    directory: &Path,
    current: Option<&DesktopAdmissionContext>,
) -> Result<String> {
    match inspect(directory, current) {
        Err(AdmissionError::Refused(code)) => Err(AdmissionError::Refused(code)),
        Err(_) => Err(AdmissionError::Refused(RefusalCode::AdmissionInvalid)),
        Ok(value) => Ok(value),
    }
}

fn inspect(directory: &Path, current: Option<&DesktopAdmissionContext>) -> Result<String> {
    if let Some(current) = current {
        current.validate()?;
    }
    if let Err(error) = fs::symlink_metadata(directory) {
        if current.is_some() || error.kind() != std::io::ErrorKind::NotFound {
            return Err(error.into());
        }
        if !directory.is_absolute() || !tfs::node_normalized(directory) {
            return Err(error.into());
        }
        let parent = directory.parent().ok_or_else(|| invalid("root"))?;
        terminal_directory(parent, true)?;
        let ancestor = stat(parent)?;
        return Ok(strings(&[
            Some(ancestor.dev.to_string()),
            Some(ancestor.ino.to_string()),
            Some("absent-directory".into()),
        ]));
    }
    terminal_directory(directory, true)?;
    assert_no_offline_recovery(directory)?;
    let parent = stat(directory)?;
    if !parent.dir || parent.uid != tfs::uid() || parent.mode & 0o077 != 0 {
        return Err(invalid("directory"));
    }
    let file = directory.join(ACTIVE_PAIR);
    let before = match stat(&file) {
        Ok(before) => before,
        Err(error) => {
            if error.kind() != std::io::ErrorKind::NotFound {
                return Err(error.into());
            }
            let after = stat(directory)?;
            if !same_directory(&parent, &after) {
                return Err(error.into());
            }
            return Ok(strings(&[
                Some(parent.dev.to_string()),
                Some(parent.ino.to_string()),
                None,
            ]));
        }
    };
    if !before.file || before.nlink != 1 {
        return Err(invalid("marker"));
    }
    // The canonical/O_NOFOLLOW/private owner/mode and bounded-read implementation.
    let marker = parse_desktop_admission_marker(&json::parse(&terminal_file(
        &file,
        true,
        MARKER_READ_LIMIT,
        Some((before.dev, before.ino)),
    )?)?)?;
    let after = stat(&file)?;
    let parent_after = stat(directory)?;
    if !same_directory(&parent, &parent_after)
        || before.dev != after.dev
        || before.ino != after.ino
        || before.size != after.size
        || before.mtime_ns != after.mtime_ns
        || before.ctime_ns != after.ctime_ns
        || before.mode != after.mode
        || before.uid != after.uid
        || after.nlink != 1
    {
        return Err(invalid("marker changed"));
    }
    let matches = current.is_some_and(|current| {
        marker.owner == current.owner
            && marker.epoch.as_deref() == Some(current.epoch.as_str())
            && marker.manifests == current.initial_files
    });
    if !matches {
        if current.is_none() {
            if let Some(epoch) = &marker.epoch {
                if read_owned_exit_pending(directory, &marker.owner, epoch)?.is_some() {
                    return Err(AdmissionError::Refused(RefusalCode::OwnedExitPending));
                }
            }
        }
        return Err(AdmissionError::Refused(RefusalCode::CapacityReserved));
    }
    Ok(strings(&[
        Some(parent.dev.to_string()),
        Some(parent.ino.to_string()),
        Some(before.dev.to_string()),
        Some(before.ino.to_string()),
        Some(before.mtime_ns.to_string()),
        Some(before.ctime_ns.to_string()),
    ]))
}

/// Identity and clock sources. Production uses random v4 UUIDs and `Date.now()`.
pub struct AdmissionSources {
    pub uuid: Box<dyn FnMut() -> String + Send>,
    pub now_ms: Box<dyn FnMut() -> u64 + Send>,
}

impl Default for AdmissionSources {
    fn default() -> Self {
        Self {
            uuid: Box::new(|| uuid::Uuid::new_v4().to_string()),
            now_ms: Box::new(|| {
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|elapsed| elapsed.as_millis() as u64)
                    .unwrap_or(0)
            }),
        }
    }
}

/// Returned by `reserve_enrollment`; pass to `finish_enrollment` with the receipt.
#[derive(Clone, Debug)]
pub struct EnrollmentReservation {
    pub path: PathBuf,
}

/// Returned by `prepare_release`; the caller must fence the runtime before `finish_release`.
#[derive(Clone, Debug)]
pub struct ReleasePreparation {
    pub archive: PathBuf,
    bytes: String,
}

/// `desktopAgentsAdmission(directory, manifests, epoch)`. Sticky process admission across client
/// restarts.
pub struct DesktopAdmission {
    directory: PathBuf,
    file: PathBuf,
    owner: String,
    marker: String,
    epoch: Option<String>,
    claimed: bool,
    retired: bool,
    enrollment_files: Vec<(PathBuf, String)>,
    sources: AdmissionSources,
}

impl DesktopAdmission {
    pub fn open(directory: &Path, manifests: &[String], epoch: Option<&str>) -> Result<Self> {
        Self::open_with(directory, manifests, epoch, AdmissionSources::default())
    }

    pub fn open_with(
        directory: &Path,
        manifests: &[String],
        epoch: Option<&str>,
        mut sources: AdmissionSources,
    ) -> Result<Self> {
        if let Err(error) = fs::DirBuilder::new().mode(0o700).create(directory) {
            if error.kind() != std::io::ErrorKind::AlreadyExists {
                return Err(error.into());
            }
        }
        terminal_directory(directory, true)?;
        inspect_desktop_admission(directory, None)?;
        let identity = (sources.uuid)();
        let mut marker = Map::new();
        marker.insert("version".into(), json!(1));
        marker.insert("owner".into(), json!(identity));
        marker.insert("manifests".into(), json!(manifests));
        if let Some(epoch) = epoch.filter(|epoch| !epoch.is_empty()) {
            marker.insert("epoch".into(), json!(epoch));
        }
        let marker = json::stringify(&Value::Object(marker)) + "\n";
        Ok(Self {
            directory: directory.to_owned(),
            file: directory.join(ACTIVE_PAIR),
            owner: identity,
            marker,
            epoch: epoch.filter(|epoch| !epoch.is_empty()).map(str::to_owned),
            claimed: false,
            retired: false,
            enrollment_files: Vec::new(),
            sources,
        })
    }

    /// Admission owner UUID (`admission.owner`).
    pub fn owner(&self) -> &str {
        &self.owner
    }

    /// Exact `active-pair.json` bytes this owner writes.
    pub fn marker_bytes(&self) -> &str {
        &self.marker
    }

    pub fn directory(&self) -> &Path {
        &self.directory
    }

    pub fn assert_owner(&self) -> Result<()> {
        assert_no_offline_recovery(&self.directory)?;
        if !self.claimed
            || self.retired
            || terminal_text(&self.file, true, tfs::DEFAULT_FILE_BUDGET)? != self.marker
        {
            return Err(AdmissionError::Rejected(
                "Desktop pair admission owner changed",
            ));
        }
        for (path, bytes) in &self.enrollment_files {
            if terminal_text(path, true, tfs::DEFAULT_FILE_BUDGET)? != *bytes {
                return Err(AdmissionError::Rejected(
                    "Desktop enrollment admission changed",
                ));
            }
        }
        Ok(())
    }

    /// `preservePendingExit()`: namespace handoff to `pending-pair-<owner>.json`.
    pub fn preserve_pending_exit(&self) -> Result<()> {
        if self.epoch.is_none() {
            return Err(AdmissionError::Rejected("Owned Core epoch required"));
        }
        detach_owned_exit_pending(&self.directory, &self.marker, &|| self.assert_owner())
    }

    pub fn preflight(&self) -> Result<()> {
        terminal_directory(&self.directory, true)?;
        assert_no_offline_recovery(&self.directory)?;
        if self.claimed {
            return self.assert_owner();
        }
        if self.retired {
            return Err(AdmissionError::Rejected("Desktop admission retired"));
        }
        match fs::symlink_metadata(&self.file) {
            Ok(_) => Err(AdmissionError::Rejected(
                "Desktop capacity already reserved",
            )),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error.into()),
        }
    }

    pub fn claim(&mut self) -> Result<()> {
        assert_no_offline_recovery(&self.directory)?;
        if self.retired {
            return Err(AdmissionError::Rejected("Desktop admission retired"));
        }
        if self.claimed {
            return self.assert_owner();
        }
        write_exclusive(&self.file, self.marker.as_bytes())?;
        sync_directory(&self.directory)?;
        self.claimed = true;
        Ok(())
    }

    /// `reserveEnrollment({ input, manifestFile, member })`. Exclusive append records; a partial
    /// write/fsync failure is preserved and the caller retains an uncertain slot.
    pub fn reserve_enrollment(
        &mut self,
        input: &Value,
        manifest_file: &str,
        member: &Value,
    ) -> Result<EnrollmentReservation> {
        self.assert_owner()?;
        let op_id = input
            .get("opId")
            .and_then(Value::as_str)
            .filter(|op_id| json::is_uuid(op_id))
            .ok_or_else(|| invalid("input.opId"))?;
        let path = self
            .directory
            .join(format!("enrollment-{}-{op_id}.json", self.owner));
        let mut record = Map::new();
        record.insert("version".into(), json!(1));
        record.insert("owner".into(), json!(self.owner));
        record.insert("input".into(), input.clone());
        record.insert("manifestFile".into(), json!(manifest_file));
        record.insert("member".into(), member.clone());
        let bytes = json::stringify(&Value::Object(record)) + "\n";
        write_exclusive(&path, bytes.as_bytes())?;
        sync_directory(&self.directory)?;
        self.set_enrollment(path.clone(), bytes);
        self.assert_owner()?;
        Ok(EnrollmentReservation { path })
    }

    /// The finisher returned by `reserveEnrollment`: writes `<record>.receipt.json`.
    pub fn finish_enrollment(
        &mut self,
        reservation: &EnrollmentReservation,
        receipt: &Value,
    ) -> Result<()> {
        self.assert_owner()?;
        let text = reservation.path.to_string_lossy();
        let result = PathBuf::from(match text.strip_suffix(".json") {
            Some(stem) => format!("{stem}.receipt.json"),
            None => text.into_owned(),
        });
        let mut content = Map::new();
        content.insert("version".into(), json!(1));
        content.insert("owner".into(), json!(self.owner));
        content.insert("receipt".into(), receipt.clone());
        let content = json::stringify(&Value::Object(content)) + "\n";
        write_exclusive(&result, content.as_bytes())?;
        sync_directory(&self.directory)?;
        self.set_enrollment(result, content);
        self.assert_owner()
    }

    fn set_enrollment(&mut self, path: PathBuf, bytes: String) {
        match self
            .enrollment_files
            .iter_mut()
            .find(|(existing, _)| *existing == path)
        {
            Some(entry) => entry.1 = bytes,
            None => self.enrollment_files.push((path, bytes)),
        }
    }

    /// `prepareRelease(evidence)`: every attempt is exclusive; a failed/partial archive is
    /// retained, never overwritten.
    pub fn prepare_release(&mut self, evidence: &Value) -> Result<ReleasePreparation> {
        self.assert_owner()?;
        let record = json::parse(self.marker.as_bytes())?;
        let archive = self.directory.join(format!(
            "retired-{}-{}.json",
            self.owner,
            (self.sources.uuid)()
        ));
        let mut enrollments = Vec::new();
        for (path, bytes) in &self.enrollment_files {
            let mut entry = Map::new();
            entry.insert("path".into(), json!(path.to_string_lossy()));
            entry.insert("record".into(), json::parse(bytes.as_bytes())?);
            enrollments.push(Value::Object(entry));
        }
        let mut document = Map::new();
        document.insert("admission".into(), record);
        document.insert("enrollments".into(), Value::Array(enrollments));
        document.insert(
            "retirementPreparedAt".into(),
            json!((self.sources.now_ms)()),
        );
        document.insert("evidence".into(), evidence.clone());
        let bytes = json::stringify(&Value::Object(document)) + "\n";
        if bytes.len() > RETIREMENT_ARCHIVE_LIMIT {
            return Err(AdmissionError::Rejected(
                "Desktop retirement evidence exceeds archive budget",
            ));
        }
        write_exclusive(&archive, bytes.as_bytes())?;
        sync_directory(&self.directory)?;
        self.assert_owner()?;
        Ok(ReleasePreparation { archive, bytes })
    }

    /// The marker-only finalizer returned by `prepareRelease`.
    pub fn finish_release(&mut self, preparation: &ReleasePreparation) -> Result<()> {
        self.assert_owner()?;
        if terminal_text(&preparation.archive, true, RETIREMENT_ARCHIVE_LIMIT)? != preparation.bytes
        {
            return Err(AdmissionError::Rejected(
                "Desktop retirement archive changed",
            ));
        }
        fs::remove_file(&self.file)?;
        sync_directory(&self.directory)?;
        self.claimed = false;
        self.retired = true;
        Ok(())
    }
}
