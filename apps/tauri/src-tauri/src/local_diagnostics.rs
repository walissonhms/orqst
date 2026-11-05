//! Best-effort native diagnostics. No text, identifiers or payloads from a CLI enter this API.
//! Disk work belongs to one bounded writer, never the caller/UI thread.
use std::collections::hash_map::RandomState;
use std::hash::BuildHasher;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{sync_channel, SyncSender};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

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
            #[cfg(test)]
            const ALL: &'static [Self] = &[$(Self::$variant),+];
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
    HostSpawn => "host_spawn", HostStream => "host_stream", OwnedShutdown => "owned_shutdown", Enrollment => "enrollment",
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
    FeatureFocus => "feature_focus", FeatureSourceChanged => "feature_source_changed",
    FeatureTargetChanged => "feature_target_changed", FeatureMetadataChanged => "feature_metadata_changed",
    FeatureAdmissionChanged => "feature_admission_changed", FeatureNavigationChanged => "feature_navigation_changed",
    FeatureScopeChanged => "feature_scope_changed", FeaturePostContext => "feature_post_context",
    RateLimited => "rate_limited",
    Uncertain => "uncertain", Unconfirmed => "unconfirmed",
});
vocabulary!(Effects {
    NotStarted => "not_started", Possible => "possible", Unconfirmed => "unconfirmed",
});

// Only explicitly classified renderer requests enter the bounded request window. One fixed, bounded window
// is drained by the existing writer; labels are closed and contain no document ID.
const REFUSAL_WINDOW: Duration = Duration::from_secs(60);
const REFUSAL_LIMIT: usize = 8;
static REFUSALS: OnceLock<Mutex<RefusalWindow>> = OnceLock::new();

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum RefusalSource {
    Studio,
    Feature,
    Terminal,
    Agents,
    Files,
}
impl RefusalSource {
    fn name(self) -> &'static str {
        match self {
            Self::Studio => "studio",
            Self::Feature => "feature",
            Self::Terminal => "terminal",
            Self::Agents => "agents",
            Self::Files => "files",
        }
    }
}
type RefusalEntry = (RefusalSource, Stage, Outcome, Effects);
type RefusalBatch = (Vec<RefusalEntry>, u64);
struct RefusalWindow {
    started: Instant,
    entries: Vec<RefusalEntry>,
    suppressed: u64,
}
impl RefusalWindow {
    fn new(now: Instant) -> Self {
        Self {
            started: now,
            entries: Vec::new(),
            suppressed: 0,
        }
    }
    fn add(&mut self, source: RefusalSource, stage: Stage, outcome: Outcome, effects: Effects) {
        if self
            .entries
            .iter()
            .any(|(s, st, o, _)| *s == source && *st == stage && *o == outcome)
            || self.entries.len() >= REFUSAL_LIMIT
        {
            self.suppressed = self.suppressed.saturating_add(1);
        } else {
            self.entries.push((source, stage, outcome, effects));
        }
    }
    fn drain(&mut self, now: Instant) -> Option<RefusalBatch> {
        if now.saturating_duration_since(self.started) < REFUSAL_WINDOW {
            return None;
        }
        self.started = now;
        Some((
            std::mem::take(&mut self.entries),
            std::mem::take(&mut self.suppressed),
        ))
    }
}
/// The caller supplies only a fixed source and an enumerated reason, never renderer data.
pub fn refusal(source: RefusalSource, outcome: Outcome, effects: Effects) {
    if is_renderer_request(Stage::Request, outcome) {
        renderer_record(source, Stage::Request, outcome, effects);
    } else {
        Attempt::begin().record_native(Stage::Request, outcome, effects);
    }
}

// A separate aggregate guarantees one rate-limit record per source and window even
// when the general renderer refusal vocabulary is saturated.
static RATE_LIMITS: OnceLock<Mutex<RateWindow>> = OnceLock::new();
struct RateWindow {
    started: Instant,
    counts: [u64; 5],
}
impl RateWindow {
    fn new(now: Instant) -> Self {
        Self {
            started: now,
            counts: [0; 5],
        }
    }
    fn add(&mut self, source: RefusalSource) {
        let index = match source {
            RefusalSource::Studio => 0,
            RefusalSource::Feature => 1,
            RefusalSource::Terminal => 2,
            RefusalSource::Agents => 3,
            RefusalSource::Files => 4,
        };
        self.counts[index] = self.counts[index].saturating_add(1);
    }
    fn drain(&mut self, now: Instant) -> Option<[u64; 5]> {
        if now.saturating_duration_since(self.started) < REFUSAL_WINDOW {
            return None;
        }
        self.started = now;
        Some(std::mem::take(&mut self.counts))
    }
}
pub fn rate_limited(source: RefusalSource) {
    if WRITER.get().is_none() {
        return;
    }
    if let Ok(mut state) = RATE_LIMITS
        .get_or_init(|| Mutex::new(RateWindow::new(Instant::now())))
        .lock()
    {
        state.add(source);
    }
}
fn rate_lines(now: Instant) -> Vec<String> {
    let Some(state) = RATE_LIMITS.get() else {
        return Vec::new();
    };
    let Ok(mut state) = state.lock() else {
        return Vec::new();
    };
    let Some(counts) = state.drain(now) else {
        return Vec::new();
    };
    let unix_ms = millis(
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default(),
    );
    [RefusalSource::Studio, RefusalSource::Feature, RefusalSource::Terminal, RefusalSource::Agents, RefusalSource::Files].into_iter()
        .zip(counts).filter(|(_, count)| *count > 0)
        .map(|(source, count)| format!("{{\"v\":1,\"unix_ms\":{},\"source\":\"{}\",\"stage\":\"request\",\"outcome\":\"{}\",\"effects\":\"not_started\",\"count\":{}}}\n", unix_ms, source.name(), Outcome::RateLimited.name(), count))
        .collect()
}

// A closed request-event allowlist. Every other event is native by default,
// including future enum variants and outcomes with possible transport effects.
fn is_renderer_request(stage: Stage, outcome: Outcome) -> bool {
    stage == Stage::Request
        && matches!(
            outcome,
            Outcome::Requested
                | Outcome::Succeeded
                | Outcome::StudioInvalidRequest
                | Outcome::StudioIdentity
                | Outcome::StudioFocus
                | Outcome::StudioContextChanged
                | Outcome::StudioMainMissing
                | Outcome::StudioReviewEmpty
                | Outcome::StudioLatchUnavailable
                | Outcome::StudioPostIdentity
                | Outcome::FeatureInvalidRequest
                | Outcome::FeatureIdentity
                | Outcome::FeatureMainMissing
                | Outcome::FeatureTargetIdentity
                | Outcome::FeatureFocus
                | Outcome::FeatureSourceChanged
                | Outcome::FeatureTargetChanged
                | Outcome::FeatureMetadataChanged
                | Outcome::FeatureAdmissionChanged
                | Outcome::FeatureNavigationChanged
                | Outcome::FeatureScopeChanged
                | Outcome::FeaturePostContext
        )
}

fn renderer_record(source: RefusalSource, stage: Stage, outcome: Outcome, effects: Effects) {
    if WRITER.get().is_none() {
        return;
    }
    let state = REFUSALS.get_or_init(|| Mutex::new(RefusalWindow::new(Instant::now())));
    if let Ok(mut window) = state.lock() {
        window.add(source, stage, outcome, effects);
    }
}
fn refusal_lines(now: Instant) -> Vec<String> {
    let Some(state) = REFUSALS.get() else {
        return Vec::new();
    };
    let Ok(mut window) = state.lock() else {
        return Vec::new();
    };
    let Some((entries, suppressed)) = window.drain(now) else {
        return Vec::new();
    };
    drop(window);
    format_refusals(entries, suppressed)
}
fn format_refusals(entries: Vec<RefusalEntry>, suppressed: u64) -> Vec<String> {
    let unix_ms = millis(
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default(),
    );
    let mut lines: Vec<_> = entries
        .into_iter()
        .map(|(source, stage, outcome, effects)| {
            format!(
        "{{\"v\":1,\"unix_ms\":{},\"source\":\"{}\",\"stage\":\"{}\",\"outcome\":\"{}\",\"effects\":\"{}\"}}\n",
        unix_ms, source.name(), stage.name(), outcome.name(), effects.name())
        })
        .collect();
    if suppressed > 0 {
        lines.push(format!(
            "{{\"v\":1,\"unix_ms\":{},\"suppressed\":{}}}\n",
            unix_ms, suppressed
        ));
    }
    lines
}

/// Opaque UUID-shaped diagnostic correlation only. Never a capability or session identity.
#[derive(Clone)]
pub struct Attempt {
    id: String,
    started: Instant,
    renderer: Option<RefusalSource>,
}

impl Default for Attempt {
    fn default() -> Self {
        Self::begin()
    }
}

impl Attempt {
    pub fn begin() -> Self {
        Self::new(None)
    }

    pub fn renderer(source: RefusalSource) -> Self {
        Self::new(Some(source))
    }

    pub fn into_renderer(mut self, source: RefusalSource) -> Self {
        self.renderer = Some(source);
        self
    }

    fn new(renderer: Option<RefusalSource>) -> Self {
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
            renderer,
        };
        if renderer.is_some() {
            attempt.record(Stage::Request, Outcome::Requested, Effects::Unconfirmed);
        } else {
            attempt.record(Stage::Attempt, Outcome::Started, Effects::Unconfirmed);
        }
        attempt
    }

    pub fn id(&self) -> &str {
        &self.id
    }

    /// Does not await, lock an application mutex, touch disk or report errors to the caller.
    pub fn record(&self, stage: Stage, outcome: Outcome, effects: Effects) {
        if let Some(source) = self
            .renderer
            .filter(|_| is_renderer_request(stage, outcome))
        {
            renderer_record(source, stage, outcome, effects);
            return;
        }
        self.record_native(stage, outcome, effects);
    }

    pub fn record_native(&self, stage: Stage, outcome: Outcome, effects: Effects) {
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
                let mut refusal_sink_available = true;
                loop {
                    for line in refusal_lines(Instant::now())
                        .into_iter()
                        .chain(rate_lines(Instant::now()))
                    {
                        if refusal_sink_available
                            && (line.len() > RECORD_LIMIT
                                || sink.append_refusal(line.as_bytes()).is_err())
                        {
                            refusal_sink_available = false;
                        }
                    }
                    let record = match receiver.recv_timeout(Duration::from_secs(1)) {
                        Ok(record) => record,
                        Err(std::sync::mpsc::RecvTimeoutError::Timeout) => continue,
                        Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => return,
                    };
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
            self.append_to(bytes, ["native.jsonl", "native.1.jsonl", "native.2.jsonl"])
        }

        pub(super) fn append_refusal(&mut self, bytes: &[u8]) -> io::Result<()> {
            self.append_to(
                bytes,
                ["refusals.jsonl", "refusals.1.jsonl", "refusals.2.jsonl"],
            )
        }

        fn append_to(&mut self, bytes: &[u8], names: [&str; 3]) -> io::Result<()> {
            if bytes.len() as u64 > self.limit {
                return Err(refused());
            }
            let path = self.dir.join(names[0]);
            let file = private_file(&path)?;
            if file.metadata()?.len() > self.limit {
                return Err(refused());
            }
            if file.metadata()?.len().saturating_add(bytes.len() as u64) > self.limit {
                drop(file);
                // Rename fixed names only. No scanning/deletion of unrelated app/user files.
                for (from, to) in [(names[1], names[2]), (names[0], names[1])] {
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
    fn renderer_quota_is_a_closed_request_allowlist() {
        let allowed = [
            Outcome::Requested,
            Outcome::Succeeded,
            Outcome::StudioInvalidRequest,
            Outcome::StudioIdentity,
            Outcome::StudioFocus,
            Outcome::StudioContextChanged,
            Outcome::StudioMainMissing,
            Outcome::StudioReviewEmpty,
            Outcome::StudioLatchUnavailable,
            Outcome::StudioPostIdentity,
            Outcome::FeatureInvalidRequest,
            Outcome::FeatureIdentity,
            Outcome::FeatureMainMissing,
            Outcome::FeatureTargetIdentity,
            Outcome::FeatureFocus,
            Outcome::FeatureSourceChanged,
            Outcome::FeatureTargetChanged,
            Outcome::FeatureMetadataChanged,
            Outcome::FeatureAdmissionChanged,
            Outcome::FeatureNavigationChanged,
            Outcome::FeatureScopeChanged,
            Outcome::FeaturePostContext,
        ];
        for &stage in Stage::ALL {
            for &outcome in Outcome::ALL {
                assert_eq!(
                    is_renderer_request(stage, outcome),
                    stage == Stage::Request && allowed.contains(&outcome),
                    "{stage:?} {outcome:?}"
                );
            }
        }
        assert_eq!(Effects::ALL.len(), 3);
    }

    #[test]
    fn rate_limit_aggregate_counts_flood_once_per_source_and_window() {
        let now = Instant::now();
        let mut window = RateWindow::new(now);
        for _ in 0..1000 {
            window.add(RefusalSource::Studio);
        }
        for _ in 0..500 {
            window.add(RefusalSource::Terminal);
        }
        assert!(window
            .drain(now + REFUSAL_WINDOW - Duration::from_millis(1))
            .is_none());
        assert_eq!(
            window.drain(now + REFUSAL_WINDOW),
            Some([1000, 0, 500, 0, 0])
        );
        assert_eq!(
            window.drain(now + REFUSAL_WINDOW * 2),
            Some([0, 0, 0, 0, 0])
        );
    }

    #[test]
    fn refusal_flood_is_deduplicated_bounded_and_renews() {
        let start = Instant::now();
        let mut window = RefusalWindow::new(start);
        for _ in 0..10_000 {
            window.add(
                RefusalSource::Studio,
                Stage::Request,
                Outcome::StudioInvalidRequest,
                Effects::NotStarted,
            );
            window.add(
                RefusalSource::Feature,
                Stage::Request,
                Outcome::FeatureInvalidRequest,
                Effects::NotStarted,
            );
        }
        assert!(window.drain(start + Duration::from_secs(59)).is_none());
        let (entries, suppressed) = window.drain(start + REFUSAL_WINDOW).unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(suppressed, 19_998);
        let lines = format_refusals(entries, suppressed);
        assert_eq!(lines.len(), 3);
        assert_eq!(
            lines
                .iter()
                .filter(|line| line.contains("\"suppressed\""))
                .count(),
            1
        );
        assert!(lines[2].contains("\"suppressed\":19998"));
        #[cfg(any(target_os = "macos", target_os = "linux"))]
        {
            let parent = temporary();
            let mut sink = disk::Sink::open(&parent, 1024).unwrap();
            sink.append(b"legitimate startup\n").unwrap();
            for line in &lines {
                sink.append_refusal(line.as_bytes()).unwrap();
            }
            sink.append(b"legitimate quit\n").unwrap();
            let dir = parent.join("diagnostics");
            assert_eq!(fs::read_dir(&dir).unwrap().count(), 3);
            assert_eq!(
                fs::read(dir.join("native.jsonl")).unwrap(),
                b"legitimate startup\nlegitimate quit\n"
            );
            assert_eq!(
                fs::read_to_string(dir.join("refusals.jsonl"))
                    .unwrap()
                    .lines()
                    .count(),
                3
            );
            drop(sink);
            fs::remove_dir_all(parent).unwrap();
        }
        window.add(
            RefusalSource::Studio,
            Stage::Request,
            Outcome::StudioInvalidRequest,
            Effects::NotStarted,
        );
        assert_eq!(window.drain(start + REFUSAL_WINDOW * 2).unwrap().0.len(), 1);
        for reason in [
            Outcome::StudioIdentity,
            Outcome::StudioFocus,
            Outcome::StudioContextChanged,
            Outcome::StudioMainMissing,
            Outcome::StudioReviewEmpty,
            Outcome::StudioLatchUnavailable,
            Outcome::StudioPostIdentity,
            Outcome::FeatureIdentity,
            Outcome::FeatureFocus,
        ] {
            window.add(
                RefusalSource::Studio,
                Stage::Request,
                reason,
                Effects::NotStarted,
            );
        }
        let (entries, suppressed) = window.drain(start + REFUSAL_WINDOW * 3).unwrap();
        assert_eq!(entries.len(), REFUSAL_LIMIT);
        assert_eq!(suppressed, 1);
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    #[test]
    fn catalog_and_mixed_renderer_flood_share_quota_and_preserve_native() {
        let start = Instant::now();
        let mut window = RefusalWindow::new(start);
        let parent = temporary();
        let mut sink = disk::Sink::open(&parent, 1024).unwrap();
        sink.append(b"legitimate startup\n").unwrap();
        for mixed in [false, true] {
            for _ in 0..10_000 {
                for (stage, outcome) in [
                    (Stage::Attempt, Outcome::Started),
                    (Stage::HelperSpawn, Outcome::Requested),
                    (Stage::HelperSpawn, Outcome::Started),
                    (Stage::Catalog, Outcome::Failed),
                ] {
                    window.add(RefusalSource::Studio, stage, outcome, Effects::Unconfirmed);
                }
                if mixed {
                    window.add(
                        RefusalSource::Studio,
                        Stage::Request,
                        Outcome::StudioIdentity,
                        Effects::NotStarted,
                    );
                    window.add(
                        RefusalSource::Feature,
                        Stage::Request,
                        Outcome::FeatureFocus,
                        Effects::NotStarted,
                    );
                }
            }
            let (entries, suppressed) = window
                .drain(start + REFUSAL_WINDOW * if mixed { 2 } else { 1 })
                .unwrap();
            assert_eq!(entries.len(), if mixed { 6 } else { 4 });
            assert_eq!(suppressed, if mixed { 59_994 } else { 39_996 });
            let lines = format_refusals(entries, suppressed);
            assert!(lines
                .last()
                .unwrap()
                .contains(&format!("\"suppressed\":{suppressed}")));
            for line in lines {
                sink.append_refusal(line.as_bytes()).unwrap();
            }
        }
        window.add(
            RefusalSource::Studio,
            Stage::HelperSpawn,
            Outcome::Requested,
            Effects::Unconfirmed,
        );
        assert_eq!(window.drain(start + REFUSAL_WINDOW * 3).unwrap().0.len(), 1);
        sink.append(b"legitimate quit\n").unwrap();
        assert_eq!(
            fs::read(parent.join("diagnostics/native.jsonl")).unwrap(),
            b"legitimate startup\nlegitimate quit\n"
        );
        drop(sink);
        fs::remove_dir_all(parent).unwrap();
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    #[test]
    fn renderer_flood_cannot_suppress_synthetic_host_lifecycle() {
        const CHILD: &str = "ORQST_DIAGNOSTIC_FLOOD_CHILD";
        if std::env::var_os(CHILD).is_none() {
            let output = std::process::Command::new(std::env::current_exe().unwrap())
                .args(["--exact", "local_diagnostics::tests::renderer_flood_cannot_suppress_synthetic_host_lifecycle"])
                .env(CHILD, "1")
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "{}",
                String::from_utf8_lossy(&output.stderr)
            );
            assert!(String::from_utf8_lossy(&output.stdout).contains("1 passed"));
            return;
        }
        let (sender, receiver) = sync_channel(256);
        assert!(WRITER.set(sender).is_ok());
        let parent = temporary();
        let mut sink = disk::Sink::open(&parent, 1024 * 1024).unwrap();
        let start = Instant::now();
        let native = Attempt::begin();
        native.record_native(Stage::NativeSetup, Outcome::Ready, Effects::Unconfirmed);
        let mut catalogs = 0;
        let mut opens = 0;
        for _ in 0..1000 {
            if crate::renderer_admission::admit(
                "main",
                "synthetic",
                1,
                crate::renderer_admission::Action::Catalog,
                RefusalSource::Studio,
            ) {
                catalogs += 1;
                let request = Attempt::renderer(RefusalSource::Studio);
                request.record(Stage::HelperSpawn, Outcome::Requested, Effects::Unconfirmed);
                request.record(Stage::HelperSpawn, Outcome::Started, Effects::Possible);
                request.record(Stage::HelperComplete, Outcome::Succeeded, Effects::Possible);
            }
            if crate::renderer_admission::admit(
                "terminal-0",
                "synthetic",
                1,
                crate::renderer_admission::Action::Open,
                RefusalSource::Terminal,
            ) {
                opens += 1;
                let request = Attempt::renderer(RefusalSource::Terminal);
                request.record(Stage::CliOpening, Outcome::Requested, Effects::Unconfirmed);
                request.record(Stage::CliOpening, Outcome::Refused, Effects::Possible);
            }
        }
        assert_eq!((catalogs, opens), (12, 12));
        native.record_native(Stage::NativeExit, Outcome::Succeeded, Effects::Unconfirmed);
        for _ in 0..10_000 {
            let request = Attempt::renderer(RefusalSource::Studio);
            request.record(Stage::Request, Outcome::Requested, Effects::Unconfirmed);
            request.record(Stage::Request, Outcome::Succeeded, Effects::Possible);
        }
        for _ in 0..10_000 {
            refusal(
                RefusalSource::Feature,
                Outcome::FeatureFocus,
                Effects::NotStarted,
            );
        }
        // Exercise the same transport error and timeout helpers used by enrollment.
        let transport = Attempt::renderer(RefusalSource::Studio);
        use std::io::Write;
        let (mut pipe, peer) = std::os::unix::net::UnixStream::pair().unwrap();
        drop(peer);
        let failed = crate::terminal::enrollment_write(|| pipe.write_all(b"synthetic"), &transport);
        assert!(failed.is_err());
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_time()
            .build()
            .unwrap();
        let (_tx, rx) = tokio::sync::oneshot::channel();
        assert!(runtime
            .block_on(crate::terminal::enrollment_receive(
                rx,
                Duration::ZERO,
                &transport
            ))
            .is_err());
        // Synthetic lifecycle events carry a renderer-created attempt, as in the host path.
        let host = Attempt::renderer(RefusalSource::Studio);
        host.record_native(Stage::HostSpawn, Outcome::Requested, Effects::Unconfirmed);
        host.record_native(Stage::HostSpawn, Outcome::Started, Effects::Possible);
        host.record_native(
            Stage::CoreStartup,
            Outcome::StartupTimeout,
            Effects::Possible,
        );
        host.record_native(Stage::HostStream, Outcome::Eof, Effects::Possible);
        for record in receiver.try_iter() {
            sink.append(record.line(0).as_bytes()).unwrap();
        }
        let window = REFUSALS.get().unwrap();
        let (entries, suppressed) = window
            .lock()
            .unwrap()
            .drain(start + REFUSAL_WINDOW * 2)
            .unwrap();
        assert_eq!(entries.len(), 4);
        assert_eq!(suppressed, 40_022);
        for line in format_refusals(entries, suppressed) {
            sink.append_refusal(line.as_bytes()).unwrap();
        }
        let native_lines = fs::read_to_string(parent.join("diagnostics/native.jsonl")).unwrap();
        assert_eq!(
            native_lines.matches("\"stage\":\"helper_spawn\"").count(),
            24
        );
        assert_eq!(
            native_lines
                .matches("\"stage\":\"helper_complete\"")
                .count(),
            12
        );
        assert_eq!(
            native_lines.matches("\"stage\":\"cli_opening\"").count(),
            24
        );
        assert!(native_lines.contains("\"stage\":\"native_exit\""));
        let rate = RATE_LIMITS
            .get()
            .unwrap()
            .lock()
            .unwrap()
            .drain(start + REFUSAL_WINDOW * 2)
            .unwrap();
        assert_eq!(rate, [988, 0, 988, 0, 0]);
        for value in [
            "native_setup",
            "host_spawn",
            "startup_timeout",
            "host_stream",
            "\"stage\":\"enrollment\",\"outcome\":\"transport_failed\"",
            "\"stage\":\"enrollment\",\"outcome\":\"timeout\"",
        ] {
            assert!(native_lines.contains(value), "missing {value}");
        }
        let requests = fs::read_to_string(parent.join("diagnostics/refusals.jsonl")).unwrap();
        assert_eq!(requests.lines().count(), 5);
        assert!(requests.contains("\"suppressed\":40022"));
        drop(sink);
        fs::remove_dir_all(parent).unwrap();
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    #[test]
    fn refusal_rotation_never_evicts_native_records() {
        let parent = temporary();
        let mut sink = disk::Sink::open(&parent, 64).unwrap();
        sink.append(b"legitimate startup\n").unwrap();
        for _ in 0..1000 {
            sink.append_refusal(b"refusal\n").unwrap();
        }
        sink.append(b"legitimate quit\n").unwrap();
        let dir = parent.join("diagnostics");
        assert_eq!(
            fs::read(dir.join("native.jsonl")).unwrap(),
            b"legitimate startup\nlegitimate quit\n"
        );
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 5);
        drop(sink);
        fs::remove_dir_all(parent).unwrap();
    }

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
            "feature_focus",
            "feature_source_changed",
            "feature_target_changed",
            "feature_metadata_changed",
            "feature_admission_changed",
            "feature_navigation_changed",
            "feature_scope_changed",
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
        let routed = one.clone().into_renderer(RefusalSource::Terminal);
        assert_eq!(one.id(), routed.id());
        assert!(one.renderer.is_none());
        assert!(routed.renderer == Some(RefusalSource::Terminal));
        assert!(Attempt::renderer(RefusalSource::Studio).renderer == Some(RefusalSource::Studio));
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
        // Keep unrelated parallel test subprocess creation out of this lock lifetime.
        const CHILD: &str = "ORQST_DIAGNOSTIC_LOCK_CHILD";
        if std::env::var_os(CHILD).is_none() {
            let output = std::process::Command::new(std::env::current_exe().unwrap())
                .args(["--exact", "local_diagnostics::tests::rotation_permissions_and_writer_exclusion_are_bounded"])
                .env(CHILD, "1")
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "{}\n{}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            );
            return;
        }
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
        disk::Sink::open(&parent, 20).expect("reopen after releasing lock");
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
