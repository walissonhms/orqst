//! Native administrative helper: port of `apps/desktop/src/tauri-offline-recovery-host.ts`,
//! `tauri-offline-recovery.ts` and `offline-recovery-arguments.ts`. Speaks the exact newline
//! JSON protocol that `apps/tauri/src-tauri/src/offline_recovery.rs` drives over stdin/stdout:
//!
//! helper → native: `ready`, `review`, `authorize`, `complete`;
//! native → helper: `action`, `answer`, `authorized`.
//!
//! Run as `orqst-terminal-core recovery <parent> [--offline-recovery-binding-evidence <file>]`,
//! i.e. the Node helper argv after the script path. Not wired into the app.
use super::anchor::{
    assert_administrative_anchor, install_administrative_anchor, load_administrative_anchor,
    recovery_locations, Anchor, InstallPorts,
};
use super::engine::{Dependencies, NativeAdministrativeRecovery, OfflineReservationRecovery};
use super::error::{fail, invalid, RecoveryError, Result};
use super::fsio::{self, dirname, tdir};
use super::intent::{AdminIntent, Challenge};
use super::js::{number, obj, parse, pretty, s, stringify};
use super::schema::{self, strict};
use super::wire::{
    ready_frame, Inbound, ReviewPipe, Transport, ACTIONS, ADMIN_FRAME_BYTES, ADMIN_SESSION_BYTES,
    SESSION_MS,
};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use ed25519_dalek::{Signer, VerifyingKey};
use serde_json::Value;
use std::cell::RefCell;
use std::rc::Rc;
use std::time::Instant;

/// `offlineRecoveryHelperArguments(args)`: fixed native argv vector.
pub fn helper_arguments(args: &[String]) -> Result<(String, Option<String>)> {
    let absolute = |value: &str| -> Result<String> {
        if !value.starts_with('/')
            || crate::admission::json::utf16_len(value) > 2048
            || value.contains('\0')
        {
            return Err(invalid("path"));
        }
        Ok(value.to_owned())
    };
    match args {
        [parent] => Ok((absolute(parent)?, None)),
        [parent, flag, file] if flag == "--offline-recovery-binding-evidence" => {
            Ok((absolute(parent)?, Some(absolute(file)?)))
        }
        _ => fail("Invalid administrative helper arguments"),
    }
}

/// `administrativeBlockedOutcome(error)`.
pub fn blocked_outcome(error: &RecoveryError) -> Vec<(&'static str, Value)> {
    let mut out = vec![("status", s("blocked")), ("outcome", s("unconfirmed"))];
    if matches!(error, RecoveryError::BindingChanged) {
        out.push((
            "failure",
            obj([
                ("stage", s("inspection")),
                ("code", s("enrollment_binding_changed")),
            ]),
        ));
    }
    out
}

pub type SharedPipe<T> = Rc<RefCell<ReviewPipe<T>>>;

struct Reviewed {
    intent: AdminIntent,
    detail: String,
    fingerprint: String,
    binding: String,
}

struct Signed {
    challenge: String,
    binding: String,
    deadline: f64,
}

/// The native authority composed from the anchor and the review pipe.
struct PipeAuthority<T: Transport> {
    parent: String,
    pipe: SharedPipe<T>,
    anchor: Anchor,
    action: Rc<RefCell<Option<String>>>,
    reviewed: Option<Reviewed>,
    signed: Option<Signed>,
}

impl<T: Transport> NativeAdministrativeRecovery for PipeAuthority<T> {
    fn public_key(&self) -> &VerifyingKey {
        &self.anchor.public_key
    }
    fn review(&mut self, intent: &AdminIntent, detail: &str, fingerprint: &str) -> Result<bool> {
        self.reviewed = None;
        self.signed = None;
        let action = self.action.borrow().clone();
        let Some(action) = action else {
            return Ok(false);
        };
        let phase = match action.as_str() {
            "continueCapture" => "capture",
            "continueRelease" => "release",
            other => other,
        };
        if intent.phase != phase || !self.pipe.borrow().current() {
            return Ok(false);
        }
        assert_administrative_anchor(&self.parent, &self.anchor)?;
        if intent.digest(detail) != fingerprint {
            return fail("Administrative intent binding changed");
        }
        let binding = stringify(&obj([
            ("intent", intent.to_value()),
            ("fingerprint", s(fingerprint)),
        ]));
        let displayed = pretty(&obj([
            ("intentFingerprint", s(fingerprint)),
            ("review", parse(detail.as_bytes())?),
        ]));
        if !self
            .pipe
            .borrow_mut()
            .review(&action, &displayed, &binding)?
            || !self.pipe.borrow().current()
        {
            return Ok(false);
        }
        assert_administrative_anchor(&self.parent, &self.anchor)?;
        self.reviewed = Some(Reviewed {
            intent: intent.clone(),
            detail: detail.to_owned(),
            fingerprint: fingerprint.to_owned(),
            binding,
        });
        Ok(true)
    }
    fn sign(&mut self, challenge: &Challenge) -> Result<Option<(String, f64)>> {
        let Some(reviewed) = self.reviewed.take() else {
            return Ok(None);
        };
        if challenge.version != 2
            || challenge.intent_digest.as_deref() != Some(reviewed.fingerprint.as_str())
            || challenge.admin_intent().bytes() != reviewed.intent.bytes()
            || reviewed.intent.digest(&reviewed.detail) != reviewed.fingerprint
        {
            return Ok(None);
        }
        let serialized = stringify(&challenge.created());
        let granted = self
            .pipe
            .borrow_mut()
            .authorize(&reviewed.binding, &serialized, false);
        let Some(granted) = granted.filter(|_| self.pipe.borrow().current()) else {
            return Ok(None);
        };
        assert_administrative_anchor(&self.parent, &self.anchor)?;
        let deadline = challenge.expires_at.min(granted);
        self.signed = Some(Signed {
            challenge: serialized,
            binding: reviewed.binding,
            deadline,
        });
        let signature =
            URL_SAFE_NO_PAD.encode(self.anchor.private_key.sign(&challenge.bytes()?).to_bytes());
        Ok(Some((signature, deadline)))
    }
    fn revalidate(&mut self, challenge: &Challenge) -> Result<Option<f64>> {
        let serialized = stringify(&challenge.created());
        let Some(signed) = self.signed.as_ref().filter(|s| s.challenge == serialized) else {
            return Ok(None);
        };
        let (binding, text) = (signed.binding.clone(), signed.challenge.clone());
        let granted = self.pipe.borrow_mut().authorize(&binding, &text, true);
        let Some(granted) = granted.filter(|_| self.pipe.borrow().current()) else {
            return Ok(None);
        };
        assert_administrative_anchor(&self.parent, &self.anchor)?;
        let signed = self.signed.as_mut().expect("signed");
        signed.deadline = signed.deadline.min(granted);
        Ok(Some(signed.deadline))
    }
}

struct Installer<'a, T: Transport> {
    pipe: &'a SharedPipe<T>,
    uuid: &'a SharedUuid,
}

impl<T: Transport> InstallPorts for Installer<'_, T> {
    fn review(&mut self, detail: &str, binding: &str) -> Result<bool> {
        self.pipe.borrow_mut().review("install", detail, binding)
    }
    fn current(&self) -> bool {
        self.pipe.borrow().current()
    }
    fn authorize(&mut self, challenge: &str, binding: &str, check: bool) -> Option<f64> {
        self.pipe.borrow_mut().authorize(binding, challenge, check)
    }
    fn now(&self) -> f64 {
        self.pipe.borrow().now()
    }
    fn uuid(&mut self) -> String {
        next(self.uuid)
    }
}

/// Fixture composition only. The production helper passes no overrides.
#[derive(Default)]
pub struct HostOverrides {
    pub boot_uuid: Option<Box<dyn FnMut() -> Result<String>>>,
    pub sync: Option<fsio::Sync>,
    /// `randomUUID` shared by the pipe, the anchor installation and the recovery engine.
    pub uuid: Option<Box<dyn FnMut() -> String>>,
}

type SharedUuid = Rc<RefCell<Box<dyn FnMut() -> String>>>;

fn next(uuid: &SharedUuid) -> String {
    (uuid.borrow_mut())()
}

/// `TauriOfflineRecovery`.
pub struct TauriOfflineRecovery<T: Transport + 'static> {
    parent: String,
    pipe: SharedPipe<T>,
    historical_evidence_file: Option<String>,
    recovery: Option<OfflineReservationRecovery<PipeAuthority<T>>>,
    action: Rc<RefCell<Option<String>>>,
    sequence: f64,
    overrides: Option<HostOverrides>,
    uuid: SharedUuid,
}

impl<T: Transport + 'static> TauriOfflineRecovery<T> {
    pub fn new(
        parent: &str,
        pipe: SharedPipe<T>,
        historical_evidence_file: Option<String>,
        overrides: HostOverrides,
        uuid: SharedUuid,
    ) -> Self {
        TauriOfflineRecovery {
            uuid,
            parent: parent.to_owned(),
            pipe,
            historical_evidence_file,
            recovery: None,
            action: Rc::new(RefCell::new(None)),
            sequence: 0.0,
            overrides: Some(overrides),
        }
    }

    /// `receive(input)` → outcome string.
    pub fn receive(&mut self, input: &Value) -> Result<String> {
        let map = strict(input, &["kind", "id", "session", "action", "bundle"])?;
        schema::literal_str(map.get("kind"), "action", "kind")?;
        let id = schema::int(map.get("id"), "id", 1, schema::SAFE)? as f64;
        let session = schema::uuid(map.get("session"), "session")?;
        let action = schema::string(map.get("action"), "action")?;
        if !ACTIONS.contains(&action.as_str()) {
            return Err(invalid("action"));
        }
        let bundle = match map.get("bundle") {
            Some(Value::Null) => None,
            some => Some(schema::abs_path(some, "bundle")?),
        };
        if !self.pipe.borrow().current()
            || session != self.pipe.borrow().session
            || id <= self.sequence
        {
            return fail("Administrative request refused");
        }
        self.sequence = id;
        *self.action.borrow_mut() = Some(action.clone());
        let result = self.run(&action, bundle);
        if let Some(recovery) = self.recovery.as_mut() {
            let authority = recovery.authority();
            authority.reviewed = None;
            authority.signed = None;
        }
        *self.action.borrow_mut() = None;
        result
    }

    fn run(&mut self, action: &str, bundle: Option<String>) -> Result<String> {
        let paths = recovery_locations(&self.parent)?;
        if action == "install" {
            if bundle.is_some() || self.recovery.is_some() {
                return fail("Invalid anchor installation");
            }
            let sync = self
                .overrides
                .as_ref()
                .and_then(|o| o.sync.clone())
                .unwrap_or_else(fsio::native_sync);
            install_administrative_anchor(
                &self.parent,
                &mut Installer {
                    pipe: &self.pipe,
                    uuid: &self.uuid,
                },
                &sync,
            )?;
            if !self.pipe.borrow().current() {
                return fail("Administrative installation effects are unconfirmed");
            }
            return Ok("installed".into());
        }
        if self.recovery.is_none() {
            let anchor = load_administrative_anchor(&self.parent)?;
            let authority = PipeAuthority {
                parent: self.parent.clone(),
                pipe: self.pipe.clone(),
                anchor,
                action: self.action.clone(),
                reviewed: None,
                signed: None,
            };
            let mut deps = Dependencies::default();
            let overrides = self.overrides.take().unwrap_or_default();
            if let Some(boot) = overrides.boot_uuid {
                deps.boot_uuid = boot;
            }
            if let Some(sync) = overrides.sync {
                deps.sync = sync;
            }
            let uuid = self.uuid.clone();
            deps.uuid = Box::new(move || next(&uuid));
            let pipe = self.pipe.clone();
            deps.now = Box::new(move || {
                let pipe = pipe.borrow();
                if pipe.current() {
                    pipe.now()
                } else {
                    f64::INFINITY
                }
            });
            self.recovery = Some(OfflineReservationRecovery::new(authority, deps));
        }
        let recovery = self.recovery.as_mut().expect("recovery");
        let outcome = if action == "capture" {
            if bundle.is_some() {
                return fail("Capture cannot supply a bundle");
            }
            recovery.capture(
                &paths.admission,
                &paths.bundles,
                self.historical_evidence_file.as_deref(),
            )?;
            "captured".to_owned()
        } else {
            let Some(bundle) = bundle else {
                return Err(invalid("bundle"));
            };
            tdir(&paths.bundles, true)?;
            tdir(&bundle, true)?;
            let name = bundle.rsplit('/').next().unwrap_or_default();
            let named = name.len() == 44
                && name.starts_with("offline-")
                && name[8..]
                    .bytes()
                    .all(|b| matches!(b, b'a'..=b'f' | b'0'..=b'9' | b'-'));
            if dirname(&bundle) != paths.bundles || !named {
                return fail("Native bundle containment refused");
            }
            match action {
                "finalize" => {
                    let result = recovery.finalize(&bundle)?;
                    if result.cleanup == "changed_controls_preserved" {
                        "finalized_controls_preserved".to_owned()
                    } else {
                        "finalized".to_owned()
                    }
                }
                "release" | "continueRelease" => {
                    let result = if action == "release" {
                        recovery.release(&bundle)?
                    } else {
                        recovery.continue_release(&bundle)?
                    };
                    if result.receipt["version"].as_f64() != Some(2.0)
                        || result.receipt["status"] != s("release_prepared")
                    {
                        return fail("Administrative preparation unconfirmed");
                    }
                    "release_prepared".to_owned()
                }
                "abort" => {
                    recovery.abort(&bundle)?;
                    "aborted".to_owned()
                }
                _ => {
                    recovery.continue_capture(&bundle)?;
                    "capture_continued".to_owned()
                }
            }
        };
        if !self.pipe.borrow().current() {
            return fail("Administrative phase effects are unconfirmed after pipe close");
        }
        Ok(outcome)
    }
}

/// Newline-delimited JSON over fds 0/1 with the helper's byte budgets and deadlines.
pub struct StdioTransport {
    start: Instant,
    buffer: Vec<u8>,
    received: usize,
    sent: usize,
    closed: Rc<RefCell<bool>>,
    session_deadline: f64,
}

impl StdioTransport {
    pub fn new() -> Self {
        StdioTransport {
            start: Instant::now(),
            buffer: Vec::new(),
            received: 0,
            sent: 0,
            closed: Rc::new(RefCell::new(false)),
            session_deadline: SESSION_MS,
        }
    }
    pub fn is_closed(&self) -> bool {
        *self.closed.borrow()
    }
}

impl Default for StdioTransport {
    fn default() -> Self {
        Self::new()
    }
}

impl Transport for StdioTransport {
    fn send(&mut self, value: &Value) {
        if self.is_closed() {
            return;
        }
        let line = format!("{}\n", stringify(value));
        self.sent += line.len();
        if line.len() > ADMIN_FRAME_BYTES || self.sent > ADMIN_SESSION_BYTES {
            self.close();
            return;
        }
        let mut offset = 0;
        while offset < line.len() {
            // SAFETY: writes from an owned buffer to stdout.
            let written =
                unsafe { libc::write(1, line.as_ptr().add(offset).cast(), line.len() - offset) };
            if written <= 0 {
                if std::io::Error::last_os_error().kind() == std::io::ErrorKind::Interrupted {
                    continue;
                }
                self.close();
                return;
            }
            offset += written as usize;
        }
    }
    fn recv(&mut self, deadline: f64) -> Inbound {
        loop {
            if self.is_closed() {
                return Inbound::Closed;
            }
            let limit = deadline.min(self.session_deadline);
            let remaining = limit - self.now();
            if remaining <= 0.0 {
                self.close();
                return Inbound::Closed;
            }
            let mut fd = libc::pollfd {
                fd: 0,
                events: libc::POLLIN,
                revents: 0,
            };
            // SAFETY: one valid pollfd for the duration of the call.
            let ready =
                unsafe { libc::poll(&mut fd, 1, remaining.ceil().min(i32::MAX as f64) as i32) };
            if ready < 0 {
                if std::io::Error::last_os_error().kind() == std::io::ErrorKind::Interrupted {
                    continue;
                }
                self.close();
                return Inbound::Closed;
            }
            if ready == 0 {
                continue;
            }
            let mut chunk = [0u8; 65536];
            // SAFETY: reads into an owned buffer from stdin.
            let read = unsafe { libc::read(0, chunk.as_mut_ptr().cast(), chunk.len()) };
            if read < 0 && std::io::Error::last_os_error().kind() == std::io::ErrorKind::Interrupted
            {
                continue;
            }
            if read <= 0 {
                self.close();
                return Inbound::Closed;
            }
            let read = read as usize;
            self.received += read;
            self.buffer.extend_from_slice(&chunk[..read]);
            if self.buffer.len() > 16 * 1024 || self.received > ADMIN_SESSION_BYTES {
                self.close();
                return Inbound::Closed;
            }
            let Some(end) = self.buffer.iter().position(|b| *b == b'\n') else {
                continue;
            };
            let line: Vec<u8> = self.buffer.drain(..=end).collect();
            // No pipelining or old ACK queued for a later phase.
            if !self.buffer.is_empty() {
                self.close();
                return Inbound::Closed;
            }
            return match parse(&line[..line.len() - 1]) {
                Ok(value) if value.is_object() => Inbound::Frame(value),
                _ => {
                    self.close();
                    Inbound::Closed
                }
            };
        }
    }
    fn now(&self) -> f64 {
        self.start.elapsed().as_secs_f64() * 1000.0
    }
    fn close(&mut self) {
        *self.closed.borrow_mut() = true;
    }
}

/// The helper loop over any transport (tests drive it with an in-memory transport).
pub fn serve<T: Transport + 'static>(
    parent: &str,
    historical: Option<String>,
    transport: T,
    mut overrides: HostOverrides,
) {
    let uuid: SharedUuid =
        Rc::new(RefCell::new(overrides.uuid.take().unwrap_or_else(|| {
            Box::new(|| uuid::Uuid::new_v4().to_string())
        })));
    let shared = uuid.clone();
    let pipe: SharedPipe<T> = Rc::new(RefCell::new(ReviewPipe::new(
        transport,
        Box::new(move || next(&shared)),
    )));
    let mut recovery = TauriOfflineRecovery::new(parent, pipe.clone(), historical, overrides, uuid);
    let session = pipe.borrow().session.clone();
    pipe.borrow_mut().transport.send(&ready_frame(&session));
    loop {
        if !pipe.borrow().current() {
            return;
        }
        let deadline = SESSION_MS;
        let inbound = pipe.borrow_mut().transport.recv(deadline);
        let value = match inbound {
            Inbound::Frame(value) => value,
            Inbound::Closed => {
                pipe.borrow_mut().close();
                return;
            }
        };
        let kind = value.get("kind").and_then(Value::as_str);
        if matches!(kind, Some("answer" | "authorized")) {
            // Nothing is pending outside an action: the TypeScript pipe closes.
            pipe.borrow_mut().unsolicited();
            return;
        }
        let id = value.get("id").cloned().unwrap_or(Value::Null);
        let outcome = recovery.receive(&value);
        let mut frame = vec![
            ("kind", s("complete")),
            ("session", s(&session)),
            ("id", id),
        ];
        match outcome {
            Ok(outcome) => {
                frame.push(("status", s("done")));
                frame.push(("outcome", s(&outcome)));
            }
            Err(error) => frame.extend(blocked_outcome(&error)),
        }
        let mut map = serde_json::Map::new();
        for (key, value) in frame {
            map.insert(key.into(), value);
        }
        if pipe.borrow().current() {
            pipe.borrow_mut().transport.send(&Value::Object(map));
        }
    }
}

/// `orqst-terminal-core recovery ...` entry. Returns the process exit code.
pub fn main_entry(args: &[String]) -> i32 {
    // SAFETY: umask has no preconditions.
    unsafe { libc::umask(0o077) };
    // SAFETY: getuid cannot fail.
    let root = unsafe { libc::getuid() } == 0;
    if !cfg!(all(target_os = "macos", target_arch = "aarch64"))
        || root
        || ![1, 3].contains(&args.len())
    {
        return 1;
    }
    let Ok((parent, historical)) = helper_arguments(args) else {
        return 1;
    };
    serve(
        &parent,
        historical,
        StdioTransport::new(),
        HostOverrides::default(),
    );
    0
}

pub fn number_value(value: f64) -> Value {
    number(value)
}
