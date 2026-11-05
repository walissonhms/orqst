//! Best-effort native diagnostics. No text, identifiers or payloads from a CLI enter this API.
//! Disk work belongs to one bounded writer, never the caller/UI thread.
use std::collections::hash_map::RandomState;
use std::hash::BuildHasher;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{sync_channel, SyncSender};
use std::sync::OnceLock;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

const QUEUE_LIMIT: usize = 256;
const RECORD_LIMIT: usize = 512;
const FILE_LIMIT: u64 = 1024 * 1024;
static WRITER: OnceLock<SyncSender<Record>> = OnceLock::new();
static DROPPED: AtomicU64 = AtomicU64::new(0);
static SERIAL: AtomicU64 = AtomicU64::new(0);

/// Closed vocabularies. Parsing selects a static label and never retains the input.
macro_rules! vocabulary {
    ($name:ident { $($variant:ident => $label:literal),+ $(,)? }) => {
        #[derive(Clone, Copy, Debug, PartialEq, Eq)]
        pub enum $name { $($variant),+ }
        impl $name {
            pub fn parse(value: &str) -> Self {
                match value { $($label => Self::$variant,)+ _ => Self::Unconfirmed }
            }
            fn name(self) -> &'static str {
                match self { $(Self::$variant => $label,)+ }
            }
        }
    };
}
vocabulary!(Stage {
    Attempt => "attempt", NativeSetup => "native_setup", NativeExit => "native_exit",
    ObserverStartup => "observer_startup", ObserverStream => "observer_stream",
    HelperSpawn => "helper_spawn", HelperStream => "helper_stream", HelperComplete => "helper_complete",
    Bootstrap => "bootstrap", Request => "request", Catalog => "catalog", Selection => "selection",
    Plan => "plan", Review => "review", Revalidation => "revalidation", Commit => "commit",
    Provision => "provision", Inspection => "inspection", FeatureAssignment => "feature_assignment",
    Opening => "opening", CliOpening => "cli_opening", AdmissionPreflight => "admission_preflight", CoreAdmission => "core_admission", CoreStartup => "core_startup",
    HostSpawn => "host_spawn", HostStream => "host_stream", Enrollment => "enrollment",
    Presentation => "presentation", Unconfirmed => "unconfirmed",
});
vocabulary!(Outcome {
    Started => "started", Requested => "requested", Ready => "ready", Succeeded => "succeeded",
    Cancelled => "cancelled", Approved => "approved", Declined => "declined", Allowed => "allowed",
    Refused => "refused", Failed => "failed", Timeout => "timeout", Eof => "eof",
    ProtocolRejected => "protocol_rejected", TransportFailed => "transport_failed",
    CatalogChanged => "catalog_changed", SelectionUnavailable => "selection_unavailable",
    CapacityExceeded => "capacity_exceeded", ReviewTooLarge => "review_too_large",
    SelectionBlocked => "selection_blocked", CapacityReserved => "capacity_reserved",
    AdmissionInvalid => "admission_invalid", StartupFailed => "startup_failed",
    EnrollmentBindingChanged => "enrollment_binding_changed",
    StartupTimeout => "startup_timeout", StartupEof => "startup_eof", StartupProtocol => "startup_protocol",
    StudioInvalidRequest => "studio_invalid_request", StudioIdentity => "studio_identity",
    StudioFocus => "studio_focus", StudioContextChanged => "studio_context_changed",
    StudioMainMissing => "studio_main_missing", StudioReviewEmpty => "studio_review_empty",
    StudioLatchUnavailable => "studio_latch_unavailable", StudioPostIdentity => "studio_post_identity",
    FeatureInvalidRequest => "feature_invalid_request", FeatureIdentity => "feature_identity",
    FeatureMainMissing => "feature_main_missing", FeatureTargetIdentity => "feature_target_identity",
    FeatureFocusOrContext => "feature_focus_or_context", FeaturePostContext => "feature_post_context",
    Uncertain => "uncertain", Unconfirmed => "unconfirmed",
});
vocabulary!(Effects {
    NotStarted => "not_started", Possible => "possible", Unconfirmed => "unconfirmed",
});

/// Opaque UUID-shaped diagnostic correlation only. Never a capability or session identity.
#[derive(Clone)]
pub struct Attempt {
    id: String,
    started: Instant,
}

impl Default for Attempt {
    fn default() -> Self {
        Self::begin()
    }
}

impl Attempt {
    pub fn begin() -> Self {
        // RandomState seeds independent hash keys from the standard library's random source.
        // No application identity, path, credential or terminal data contributes to the ID.
        let serial = SERIAL.fetch_add(1, Ordering::Relaxed);
        let a = RandomState::new().hash_one(serial);
        let b = RandomState::new().hash_one(serial);
        let mut bytes = [0u8; 16];
        bytes[..8].copy_from_slice(&a.to_be_bytes());
        bytes[8..].copy_from_slice(&b.to_be_bytes());
        bytes[6] = (bytes[6] & 0x0f) | 0x40;
        bytes[8] = (bytes[8] & 0x3f) | 0x80;
        let hex: String = bytes.iter().map(|byte| format!("{byte:02x}")).collect();
        let attempt = Self {
            id: format!(
                "{}-{}-{}-{}-{}",
                &hex[..8],
                &hex[8..12],
                &hex[12..16],
                &hex[16..20],
                &hex[20..]
            ),
            started: Instant::now(),
        };
        attempt.record(Stage::Attempt, Outcome::Started, Effects::Unconfirmed);
        attempt
    }

    pub fn id(&self) -> &str {
        &self.id
    }

    /// Does not await, lock an application mutex, touch disk or report errors to the caller.
    pub fn record(&self, stage: Stage, outcome: Outcome, effects: Effects) {
        let Some(writer) = WRITER.get() else { return };
        let record = Record {
            attempt: self.id().to_owned(),
            unix_ms: millis(
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default(),
            ),
            elapsed_ms: millis(self.started.elapsed()),
            stage,
            outcome,
            effects,
        };
        if writer.try_send(record).is_err() {
            // Saturation is diagnostic loss, never backpressure on the operation.
            let _ = DROPPED.try_update(Ordering::Relaxed, Ordering::Relaxed, |count| {
                Some(count.saturating_add(1))
            });
        }
    }
}

fn millis(duration: std::time::Duration) -> u64 {
    duration.as_millis().min(u64::MAX as u128) as u64
}

struct Record {
    attempt: String,
    unix_ms: u64,
    elapsed_ms: u64,
    stage: Stage,
    outcome: Outcome,
    effects: Effects,
}

impl Record {
    fn line(&self, dropped: u64) -> String {
        // All strings originate above, never from runtime errors or an untrusted payload.
        format!(
            "{{\"v\":1,\"unix_ms\":{},\"elapsed_ms\":{},\"attempt\":\"{}\",\"stage\":\"{}\",\"outcome\":\"{}\",\"effects\":\"{}\",\"dropped_before\":{}}}\n",
            self.unix_ms, self.elapsed_ms, self.attempt, self.stage.name(), self.outcome.name(), self.effects.name(), dropped
        )
    }
}

/// Call once during native setup with app_data_dir(), never a renderer-supplied path.
/// Failure (including an unsupported platform) silently disables this optional sink.
pub fn install(parent: PathBuf) {
    let (sender, receiver) = sync_channel::<Record>(QUEUE_LIMIT);
    if WRITER.set(sender).is_err() {
        return;
    }
    let _ = std::thread::Builder::new()
        .name("orqst-diagnostics".into())
        .spawn(move || {
            #[cfg(any(target_os = "macos", target_os = "linux"))]
            {
                let Ok(mut sink) = disk::Sink::open(&parent, FILE_LIMIT) else {
                    return;
                };
                while let Ok(record) = receiver.recv() {
                    let dropped = DROPPED.swap(0, Ordering::Relaxed);
                    let line = record.line(dropped);
                    if line.len() > RECORD_LIMIT || sink.append(line.as_bytes()).is_err() {
                        // Disable after the first disk failure: no retry loop or stderr fallback.
                        return;
                    }
                }
            }
            #[cfg(not(any(target_os = "macos", target_os = "linux")))]
            let _ = (parent, receiver);
        });
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
mod disk {
    use std::fs::{self, DirBuilder, File, OpenOptions, Permissions};
    use std::io::{self, Write};
    use std::os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt, PermissionsExt};
    use std::path::{Path, PathBuf};

    #[cfg(target_os = "macos")]
    const NOFOLLOW: i32 = 0x100;
    #[cfg(target_os = "linux")]
    const NOFOLLOW: i32 = 0x20000;

    #[cfg(target_os = "macos")]
    const NONBLOCK: i32 = 0x4;
    #[cfg(target_os = "linux")]
    const NONBLOCK: i32 = 0x800;

    fn refused() -> io::Error {
        io::Error::new(
            io::ErrorKind::PermissionDenied,
            "Diagnostic sink unavailable",
        )
    }

    fn private_file(path: &Path) -> io::Result<File> {
        let file = OpenOptions::new()
            .create(true)
            .append(true)
            .mode(0o600)
            .custom_flags(NOFOLLOW | NONBLOCK)
            .open(path)?;
        let metadata = file.metadata()?;
        if !metadata.is_file()
            || metadata.nlink() != 1
            || metadata.uid() != fs::metadata(path.parent().ok_or_else(refused)?)?.uid()
        {
            return Err(refused());
        }
        file.set_permissions(Permissions::from_mode(0o600))?;
        Ok(file)
    }

    pub(super) struct Sink {
        dir: PathBuf,
        _lock: File,
        limit: u64,
    }

    impl Sink {
        pub(super) fn open(parent: &Path, limit: u64) -> io::Result<Self> {
            if !parent.is_absolute() {
                return Err(refused());
            }
            // Refuse existing symlink ancestors before creation, then verify again.
            for pass in 0..2 {
                for ancestor in parent.ancestors() {
                    match fs::symlink_metadata(ancestor) {
                        Ok(metadata) if metadata.is_dir() && !metadata.is_symlink() => {}
                        Err(error) if pass == 0 && error.kind() == io::ErrorKind::NotFound => {}
                        _ => return Err(refused()),
                    }
                }
                if pass == 0 {
                    DirBuilder::new()
                        .recursive(true)
                        .mode(0o700)
                        .create(parent)?;
                }
            }
            let dir = parent.join("diagnostics");
            match DirBuilder::new().mode(0o700).create(&dir) {
                Ok(()) => {}
                Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
                Err(error) => return Err(error),
            }
            let metadata = fs::symlink_metadata(&dir)?;
            if !metadata.is_dir()
                || metadata.is_symlink()
                || metadata.uid() != fs::metadata(parent)?.uid()
            {
                return Err(refused());
            }
            fs::set_permissions(&dir, Permissions::from_mode(0o700))?;
            let lock = private_file(&dir.join("native.lock"))?;
            // One writer across concurrent app instances sharing this app-data directory.
            // Stale lock files are harmless: the OS releases the advisory lock at process exit.
            if lock.metadata()?.len() != 0 {
                return Err(refused());
            }
            lock.try_lock().map_err(|_| refused())?;
            for name in ["native.jsonl", "native.1.jsonl", "native.2.jsonl"] {
                let path = dir.join(name);
                match fs::symlink_metadata(&path) {
                    Ok(_) => {
                        let file = private_file(&path)?;
                        if file.metadata()?.len() > limit {
                            // Never append to an oversized pre-existing sink.
                            return Err(refused());
                        }
                    }
                    Err(error) if error.kind() == io::ErrorKind::NotFound => {}
                    Err(error) => return Err(error),
                }
            }
            Ok(Self {
                dir,
                _lock: lock,
                limit,
            })
        }

        pub(super) fn append(&mut self, bytes: &[u8]) -> io::Result<()> {
            if bytes.len() as u64 > self.limit {
                return Err(refused());
            }
            let path = self.dir.join("native.jsonl");
            let file = private_file(&path)?;
            if file.metadata()?.len().saturating_add(bytes.len() as u64) > self.limit {
                drop(file);
                // Rename fixed names only. No scanning/deletion of unrelated app/user files.
                for (from, to) in [
                    ("native.1.jsonl", "native.2.jsonl"),
                    ("native.jsonl", "native.1.jsonl"),
                ] {
                    let from = self.dir.join(from);
                    if from.try_exists()? {
                        private_file(&from)?;
                        fs::rename(from, self.dir.join(to))?;
                    }
                }
            }
            private_file(&path)?.write_all(bytes)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn preparation_denial_reasons_are_closed_and_sanitized() {
        for label in [
            "studio_invalid_request",
            "studio_identity",
            "studio_focus",
            "studio_context_changed",
            "studio_main_missing",
            "studio_review_empty",
            "studio_latch_unavailable",
            "studio_post_identity",
            "feature_invalid_request",
            "feature_identity",
            "feature_main_missing",
            "feature_target_identity",
            "feature_focus_or_context",
            "feature_post_context",
        ] {
            assert_eq!(Outcome::parse(label).name(), label);
        }
        assert_eq!(Outcome::parse("/private/sensitive").name(), "unconfirmed");
    }

    fn temporary() -> PathBuf {
        let path = std::env::temp_dir()
            .canonicalize()
            .unwrap()
            .join(format!("orqst-log-test-{}", Attempt::begin().id()));
        fs::create_dir(&path).unwrap();
        path
    }

    #[test]
    fn correlation_is_opaque_uuid_and_clone_keeps_attempt() {
        let one = Attempt::begin();
        let two = Attempt::begin();
        assert_ne!(one.id(), two.id());
        assert_eq!(one.id(), one.clone().id());
        assert_eq!(one.id().len(), 36);
        assert_eq!(&one.id()[14..15], "4");
        assert!(matches!(&one.id()[19..20], "8" | "9" | "a" | "b"));
        assert!(one
            .id()
            .chars()
            .all(|ch| ch.is_ascii_hexdigit() || ch == '-'));
    }

    #[test]
    fn serialization_has_only_fixed_fields_and_queue_never_waits() {
        let record = Record {
            attempt: Attempt::begin().id,
            unix_ms: 1,
            elapsed_ms: 2,
            stage: Stage::Enrollment,
            outcome: Outcome::Uncertain,
            effects: Effects::Possible,
        };
        let line = record.line(3);
        assert_eq!(line, format!("{{\"v\":1,\"unix_ms\":1,\"elapsed_ms\":2,\"attempt\":\"{}\",\"stage\":\"enrollment\",\"outcome\":\"uncertain\",\"effects\":\"possible\",\"dropped_before\":3}}\n", record.attempt));
        assert!(line.len() < 512);
        let (sender, _receiver) = sync_channel(1);
        assert!(sender.try_send(record).is_ok());
        assert!(sender
            .try_send(Record {
                attempt: String::new(),
                unix_ms: 0,
                elapsed_ms: 0,
                stage: Stage::Attempt,
                outcome: Outcome::Failed,
                effects: Effects::Unconfirmed,
            })
            .is_err());
    }

    #[test]
    fn private_strings_cannot_escape_allowlisted_fields_and_records_have_a_budget() {
        for value in [
            "startup-123",
            "private-token",
            "/private/session.jsonl",
            "owner-epoch-proof",
            "prompt\nwith terminal output",
            "failed\",\"secret\":\"credential",
        ] {
            let record = Record {
                attempt: Attempt::begin().id,
                unix_ms: u64::MAX,
                elapsed_ms: u64::MAX,
                stage: Stage::parse(value),
                outcome: Outcome::parse(value),
                effects: Effects::parse(value),
            };
            let line = record.line(u64::MAX);
            assert!(!line.contains(value));
            assert!(line.contains("\"stage\":\"unconfirmed\""));
            assert!(line.len() <= RECORD_LIMIT);
        }
        assert_eq!(Stage::parse("core_admission"), Stage::CoreAdmission);
        assert_eq!(Outcome::parse("startup_eof"), Outcome::StartupEof);
        assert_eq!(Effects::parse("possible"), Effects::Possible);
    }

    #[test]
    fn helper_open_and_host_records_keep_one_attempt_without_reusing_authority() {
        let diagnostic = Attempt::begin();
        let host = diagnostic.clone();
        assert_eq!(diagnostic.started, host.started);
        let mut attempts = std::collections::HashSet::new();
        for _ in 0..512 {
            assert!(attempts.insert(Attempt::begin().id));
        }
        for (attempt, stage) in [
            (&diagnostic, Stage::HelperSpawn),
            (&diagnostic, Stage::Opening),
            (&host, Stage::CoreStartup),
        ] {
            let line = Record {
                attempt: attempt.id.clone(),
                unix_ms: 0,
                elapsed_ms: 0,
                stage,
                outcome: Outcome::Requested,
                effects: Effects::Unconfirmed,
            }
            .line(0);
            assert!(line.contains(diagnostic.id()));
            assert!(!line.contains("startup-"));
        }
    }

    #[test]
    fn public_record_tolerates_full_and_disconnected_writer() {
        let (sender, receiver) = sync_channel(1);
        assert!(WRITER.set(sender).is_ok());
        let attempt = Attempt::begin();
        // The automatic begin event fills this synthetic writer. These calls must return.
        for _ in 0..1024 {
            attempt.record(
                Stage::CoreStartup,
                Outcome::StartupTimeout,
                Effects::Possible,
            );
        }
        assert!(DROPPED.load(Ordering::Relaxed) >= 1024);
        assert!(receiver.try_recv().is_ok());
        drop(receiver);
        attempt.record(Stage::Attempt, Outcome::Succeeded, Effects::Unconfirmed);
        assert!(DROPPED.load(Ordering::Relaxed) >= 1025);
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    #[test]
    fn rotation_permissions_and_writer_exclusion_are_bounded() {
        use std::os::unix::fs::PermissionsExt;
        let parent = temporary();
        let mut sink = disk::Sink::open(&parent, 20).unwrap();
        assert!(disk::Sink::open(&parent, 20).is_err());
        for _ in 0..8 {
            sink.append(b"synthetic\n").unwrap();
        }
        let dir = parent.join("diagnostics");
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 4);
        assert_eq!(
            fs::metadata(&dir).unwrap().permissions().mode() & 0o777,
            0o700
        );
        for name in ["native.jsonl", "native.1.jsonl", "native.2.jsonl"] {
            let metadata = fs::metadata(dir.join(name)).unwrap();
            assert!(metadata.len() <= 20);
            assert_eq!(metadata.permissions().mode() & 0o777, 0o600);
        }
        drop(sink);
        assert!(disk::Sink::open(&parent, 20).is_ok());
        fs::remove_dir_all(parent).unwrap();
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    #[test]
    fn unsafe_sinks_are_refused_without_modifying_the_target() {
        use std::os::unix::fs::symlink;
        let parent = temporary();
        let target = parent.join("private-target");
        fs::write(&target, b"synthetic sentinel").unwrap();
        fs::create_dir(parent.join("diagnostics")).unwrap();
        symlink(&target, parent.join("diagnostics/native.jsonl")).unwrap();
        assert!(disk::Sink::open(&parent, 64).is_err());
        assert_eq!(fs::read(&target).unwrap(), b"synthetic sentinel");
        fs::remove_file(parent.join("diagnostics/native.jsonl")).unwrap();
        fs::hard_link(&target, parent.join("diagnostics/native.jsonl")).unwrap();
        assert!(disk::Sink::open(&parent, 64).is_err());
        fs::remove_dir_all(parent).unwrap();
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    #[test]
    fn directory_symlinks_and_oversize_records_are_refused() {
        use std::os::unix::fs::symlink;
        let parent = temporary();
        let alias = parent.join("alias");
        symlink(&parent, &alias).unwrap();
        assert!(disk::Sink::open(&alias.join("nested"), 20).is_err());
        let mut sink = disk::Sink::open(&parent, 20).unwrap();
        assert!(sink.append(&[b'x'; 21]).is_err());
        fs::remove_dir_all(parent).unwrap();
    }
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    #[test]
    fn old_oversized_segments_disable_sink_without_cleanup_and_rotation_preserves_other_files() {
        let parent = temporary();
        let mut sink = disk::Sink::open(&parent, 16).unwrap();
        let sentinel = parent.join("diagnostics/unrelated");
        fs::write(&sentinel, b"synthetic sentinel").unwrap();
        for _ in 0..10 {
            sink.append(b"01234567").unwrap();
        }
        assert_eq!(fs::read(&sentinel).unwrap(), b"synthetic sentinel");
        drop(sink);
        let active = parent.join("diagnostics/native.jsonl");
        fs::write(&active, [b'x'; 17]).unwrap();
        assert!(disk::Sink::open(&parent, 16).is_err());
        assert_eq!(fs::read(active).unwrap(), [b'x'; 17]);
        fs::remove_dir_all(parent).unwrap();
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    #[test]
    #[ignore = "requires FIFO fixtures from scripts/test-local-diagnostics.mjs"]
    fn fifo_without_reader_is_refused_without_waiting() {
        use std::os::unix::fs::FileTypeExt;
        for name in ["native.lock", "native.jsonl"] {
            let parent = temporary();
            fs::create_dir(parent.join("diagnostics")).unwrap();
            let fifo = parent.join("diagnostics").join(name);
            // The standalone runner creates disposable FIFOs before concurrent tests.
            let fixtures = std::env::var_os("ORQST_DIAGNOSTIC_FIFO_FIXTURE")
                .expect("standalone runner FIFO fixtures");
            fs::rename(PathBuf::from(fixtures).join(name), &fifo).unwrap();
            assert!(disk::Sink::open(&parent, 64).is_err());
            assert!(fs::symlink_metadata(&fifo).unwrap().file_type().is_fifo());
            fs::remove_dir_all(parent).unwrap();
        }
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    #[test]
    fn append_error_preserves_unrelated_data_and_does_not_repair_the_sink() {
        let parent = temporary();
        let mut sink = disk::Sink::open(&parent, 64).unwrap();
        let sentinel = parent.join("diagnostics/unrelated");
        fs::write(&sentinel, b"synthetic sentinel").unwrap();
        let active = parent.join("diagnostics/native.jsonl");
        fs::create_dir(&active).unwrap();
        assert!(sink.append(b"synthetic\n").is_err());
        assert!(active.is_dir());
        assert_eq!(fs::read(sentinel).unwrap(), b"synthetic sentinel");
        fs::remove_dir_all(parent).unwrap();
    }
}
