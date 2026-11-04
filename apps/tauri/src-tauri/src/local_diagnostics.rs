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
const FILE_LIMIT: u64 = 1024 * 1024;
static WRITER: OnceLock<SyncSender<Record>> = OnceLock::new();
static DROPPED: AtomicU64 = AtomicU64::new(0);
static SERIAL: AtomicU64 = AtomicU64::new(0);

/// Closed vocabulary: adding a diagnostic requires source review, not arbitrary log fields.
#[derive(Clone, Copy, Debug)]
pub enum Event {
    AttemptStarted,
    AttemptSucceeded,
    AttemptFailed,
    HelperSpawnRequested,
    HelperSpawned,
    HelperFailure,
    HelperComplete,
    ReviewRequested,
    ReviewApproved,
    ReviewDeclined,
    CommitAllowed,
    CommitRefused,
    OpeningRequested,
    HostSpawnRequested,
    HostSpawned,
    HostReady,
    HostRejected,
    HostTimeout,
    HostEof,
    HostProtocolRejected,
    HostTransportFailed,
    EnrollmentRequested,
    EnrollmentReady,
    EnrollmentRejected,
    EnrollmentUncertain,
    PresentationRequested,
    PresentationReady,
    PresentationFailed,
    CoreStartRequested,
    CoreReady,
    CoreUnavailable,
    NativeSetupStarted,
    NativeSetupReady,
    NativeExit,
}

impl Event {
    fn name(self) -> &'static str {
        match self {
            Self::AttemptStarted => "attempt_started",
            Self::AttemptSucceeded => "attempt_succeeded",
            Self::AttemptFailed => "attempt_failed",
            Self::HelperSpawnRequested => "helper_spawn_requested",
            Self::HelperSpawned => "helper_spawned",
            Self::HelperFailure => "helper_failure",
            Self::HelperComplete => "helper_complete",
            Self::ReviewRequested => "review_requested",
            Self::ReviewApproved => "review_approved",
            Self::ReviewDeclined => "review_declined",
            Self::CommitAllowed => "commit_allowed",
            Self::CommitRefused => "commit_refused",
            Self::OpeningRequested => "opening_requested",
            Self::HostSpawnRequested => "host_spawn_requested",
            Self::HostSpawned => "host_spawned",
            Self::HostReady => "host_ready",
            Self::HostRejected => "host_rejected",
            Self::HostTimeout => "host_timeout",
            Self::HostEof => "host_eof",
            Self::HostProtocolRejected => "host_protocol_rejected",
            Self::HostTransportFailed => "host_transport_failed",
            Self::EnrollmentRequested => "enrollment_requested",
            Self::EnrollmentReady => "enrollment_ready",
            Self::EnrollmentRejected => "enrollment_rejected",
            Self::EnrollmentUncertain => "enrollment_uncertain",
            Self::PresentationRequested => "presentation_requested",
            Self::PresentationReady => "presentation_ready",
            Self::PresentationFailed => "presentation_failed",
            Self::CoreStartRequested => "core_start_requested",
            Self::CoreReady => "core_ready",
            Self::CoreUnavailable => "core_unavailable",
            Self::NativeSetupStarted => "native_setup_started",
            Self::NativeSetupReady => "native_setup_ready",
            Self::NativeExit => "native_exit",
        }
    }

    fn level(self) -> &'static str {
        match self {
            Self::AttemptFailed
            | Self::HelperFailure
            | Self::HostRejected
            | Self::HostTimeout
            | Self::HostEof
            | Self::HostProtocolRejected
            | Self::HostTransportFailed
            | Self::EnrollmentRejected
            | Self::EnrollmentUncertain
            | Self::PresentationFailed
            | Self::CoreUnavailable => "warn",
            _ => "info",
        }
    }
}

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
        attempt.record(Event::AttemptStarted);
        attempt
    }

    pub fn id(&self) -> &str {
        &self.id
    }

    /// Does not await, lock an application mutex, touch disk or report errors to the caller.
    pub fn record(&self, event: Event) {
        let Some(writer) = WRITER.get() else { return };
        let record = Record {
            attempt: self.id.clone(),
            unix_ms: millis(
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default(),
            ),
            elapsed_ms: millis(self.started.elapsed()),
            event,
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
    event: Event,
}

impl Record {
    fn line(&self, dropped: u64) -> String {
        // All strings originate above, never from runtime errors or an untrusted payload.
        format!(
            "{{\"v\":1,\"unix_ms\":{},\"elapsed_ms\":{},\"attempt\":\"{}\",\"level\":\"{}\",\"event\":\"{}\",\"dropped_before\":{}}}\n",
            self.unix_ms, self.elapsed_ms, self.attempt, self.event.level(), self.event.name(), dropped
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
                    if sink.append(record.line(dropped).as_bytes()).is_err() {
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
            .custom_flags(NOFOLLOW)
            .open(path)?;
        let metadata = file.metadata()?;
        if !metadata.is_file() || metadata.nlink() != 1 {
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
            if !metadata.is_dir() || metadata.is_symlink() {
                return Err(refused());
            }
            fs::set_permissions(&dir, Permissions::from_mode(0o700))?;
            let lock = private_file(&dir.join("native.lock"))?;
            // One writer across concurrent app instances sharing this app-data directory.
            // Stale lock files are harmless: the OS releases the advisory lock at process exit.
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
            event: Event::EnrollmentUncertain,
        };
        let line = record.line(3);
        assert_eq!(line, format!("{{\"v\":1,\"unix_ms\":1,\"elapsed_ms\":2,\"attempt\":\"{}\",\"level\":\"warn\",\"event\":\"enrollment_uncertain\",\"dropped_before\":3}}\n", record.attempt));
        assert!(line.len() < 512);
        let (sender, _receiver) = sync_channel(1);
        assert!(sender.try_send(record).is_ok());
        assert!(sender
            .try_send(Record {
                attempt: String::new(),
                unix_ms: 0,
                elapsed_ms: 0,
                event: Event::AttemptFailed
            })
            .is_err());
    }

    #[test]
    fn public_record_tolerates_full_and_disconnected_writer() {
        let (sender, receiver) = sync_channel(1);
        assert!(WRITER.set(sender).is_ok());
        let attempt = Attempt::begin();
        // The automatic begin event fills this synthetic writer. These calls must return.
        for _ in 0..1024 {
            attempt.record(Event::HostTimeout);
        }
        assert!(DROPPED.load(Ordering::Relaxed) >= 1024);
        assert!(receiver.try_recv().is_ok());
        drop(receiver);
        attempt.record(Event::AttemptSucceeded);
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
}
