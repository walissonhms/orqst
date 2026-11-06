//! Port of `supervisor.ts`: owned attempts only, no PID/session adoption. Every effect is
//! bound to a consumed native proof; transport loss is uncertainty, never exit.
use crate::authority::{terminal_digest, Authority, Binding, Challenge};
use crate::journal::{Exit, Journal};
use crate::output::{Read, TerminalOutput};
use crate::types::TerminalProfile;
use serde_json::Value;
use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;

/// One authority shared by every slot of the pair (`managed-pair.ts`).
pub type Shared = Rc<RefCell<Authority>>;

/// `JSON.stringify(terminalPolicy)`.
pub const POLICY_JSON: &str = r#"{"version":1,"activeInstances":2,"activeInstancesPerProject":1,"startupMs":10000,"inputLeaseMs":120000,"inputWriteBytes":4096,"inputBytesPerSecond":16384,"pasteBytes":16384,"replayBytes":1048576,"outputReadBytes":65536,"backendEventCodeUnits":65536,"resizePerSecond":10,"columns":[20,300],"rows":[5,100]}"#;
pub const ACTIVE: usize = 2;
pub const PER_PROJECT: usize = 1;
pub const STARTUP_MS: i64 = 10_000;
pub const INPUT_LEASE_MS: i64 = 120_000;
pub const INPUT_WRITE_BYTES: usize = 4096;
pub const INPUT_BYTES_PER_SECOND: usize = 16 * 1024;
pub const PASTE_BYTES: usize = 16 * 1024;
pub const REPLAY_BYTES: usize = 1024 * 1024;
pub const BACKEND_EVENT_CODE_UNITS: usize = 64 * 1024;
pub const RESIZE_PER_SECOND: u32 = 10;

/// A profile with the exact `JSON.stringify` text of the TypeScript object.
#[derive(Clone, Debug)]
pub struct PreparedProfile {
    pub profile: TerminalProfile,
    pub json: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StartBinding {
    pub binding_digest: String,
    pub admission_revision: i64,
}

pub struct Identity {
    pub instance_id: String,
    pub epoch: String,
    pub manifest_digest: String,
}

pub trait Handle {
    fn write(&mut self, text: &str) -> Result<(), String>;
    fn resize(&mut self, cols: u16, rows: u16) -> Result<(), String>;
    fn signal(&mut self, signal: &str) -> Result<(), String>;
    fn session_evidence(&self) -> Option<Value> {
        None
    }
    /// Release listeners only. Never signals the process.
    fn dispose(&mut self) {}
}

pub trait Backend {
    fn preflight(&mut self) -> Result<(), String> {
        Ok(())
    }
    fn validate(&mut self, profile: &PreparedProfile) -> bool;
    /// Started/data/exit/lost evidence is delivered later through `Supervisor::event`.
    fn start(&mut self, profile: &PreparedProfile, identity: &Identity) -> Result<Box<dyn Handle>, String>;
}

#[derive(Debug, PartialEq, Eq)]
pub enum BackendEvent {
    Started { started_at: Option<i64> },
    Data(Vec<u8>),
    Exit { exit_code: i64, signal: Option<i64>, evidence: Option<(i64, i64)> },
    Lost,
}

struct Lease {
    id: String,
    client: String,
    expires_at: i64,
    sequence: i64,
}

struct Attachment {
    generation: i64,
    id: String,
    client: String,
    lease: Option<Lease>,
}

struct Attempt {
    id: String,
    client: String,
    start_expires_at: i64,
    attachment_generation: i64,
    rate_at: i64,
    input_bytes: usize,
    resizes: u32,
    profile: PreparedProfile,
    digest: String,
    state: &'static str,
    output: TerminalOutput,
    handle: Option<Box<dyn Handle>>,
    attachment: Option<Attachment>,
    startup_deadline: Option<i64>,
    exit: Option<(i64, Option<i64>)>,
    lifecycle: Option<(i64, Option<i64>)>,
    evidence: Option<Value>,
}

pub struct Prepared {
    pub attempt_id: String,
    pub profile: PreparedProfile,
    pub challenge: Challenge,
}

type R<T> = Result<T, String>;
fn e(message: &str) -> String {
    message.to_owned()
}

fn utf16_len(text: &str) -> usize {
    text.encode_utf16().count()
}

pub struct Supervisor {
    pub authority: Shared,
    backend: Box<dyn Backend>,
    profiles: Vec<PreparedProfile>,
    attempts: HashMap<String, Attempt>,
    order: Vec<String>,
    closed: bool,
    journal: Option<Journal>,
    start_binding: Option<StartBinding>,
}

impl Supervisor {
    pub fn new(
        authority: Shared,
        backend: Box<dyn Backend>,
        profiles: Vec<PreparedProfile>,
        journal: Option<Journal>,
        start_binding: Option<StartBinding>,
    ) -> R<Supervisor> {
        if let Some(binding) = &start_binding {
            if !crate::authority::is_digest(&binding.binding_digest) || binding.admission_revision < 1 {
                return Err(e("Invalid terminal enrollment start binding"));
            }
        }
        if let Some(journal) = &journal {
            if journal.epoch != authority.borrow().epoch {
                return Err(e("Terminal journal epoch mismatch"));
            }
            journal.assert_owner()?;
        }
        if profiles.len() > 16 {
            return Err(e("Terminal profile limit exceeded"));
        }
        let mut seen: Vec<&str> = Vec::new();
        for p in &profiles {
            let profile = &p.profile;
            if profile.id.is_empty()
                || profile.id.chars().count() > 128
                || !crate::authority::is_digest(&profile.executable_sha256)
                || profile.executable_version.is_empty()
                || profile.project_id.is_empty()
                || profile.project_id.chars().count() > 128
                || seen.contains(&profile.id.as_str())
                || utf16_len(&p.json) > 16 * 1024
            {
                return Err(e("Invalid terminal profile"));
            }
            seen.push(&profile.id);
        }
        Ok(Supervisor {
            authority,
            backend,
            profiles,
            attempts: HashMap::new(),
            order: Vec::new(),
            closed: false,
            journal,
            start_binding,
        })
    }

    pub fn journal(&self) -> Option<&Journal> {
        self.journal.as_ref()
    }

    pub fn journal_mut(&mut self) -> Option<&mut Journal> {
        self.journal.as_mut()
    }

    fn assert_owner(&self) -> R<()> {
        match &self.journal {
            Some(journal) => journal.assert_owner(),
            None => Ok(()),
        }
    }

    fn start_digest(&self, profile: &PreparedProfile) -> String {
        let text = match &self.start_binding {
            Some(b) => format!(
                r#"["orqst.terminal-start",1,{},{},{{"version":1,"bindingDigest":{},"admissionRevision":{}}}]"#,
                profile.json,
                POLICY_JSON,
                serde_json::to_string(&b.binding_digest).unwrap(),
                b.admission_revision
            ),
            None => format!("[{},{}]", profile.json, POLICY_JSON),
        };
        terminal_digest(text.as_bytes())
    }

    fn valid_profile(&mut self, profile: &PreparedProfile) -> bool {
        self.backend.validate(profile)
    }

    pub fn prepare(&mut self, client: &str, profile_id: &str) -> R<Prepared> {
        if self.closed {
            return Err(e("Terminal supervisor is closed"));
        }
        self.assert_owner()?;
        let profile = self
            .profiles
            .iter()
            .find(|p| p.profile.id == profile_id)
            .cloned()
            .ok_or_else(|| e("Terminal profile unavailable"))?;
        if !self.valid_profile(&profile) {
            return Err(e("Terminal profile unavailable"));
        }
        if self.attempts.len() >= 128 {
            return Err(e("Terminal attempt limit exceeded"));
        }
        let id = uuid::Uuid::new_v4().to_string();
        let digest = self.start_digest(&profile);
        let challenge = self.authority.borrow_mut().prepare(
            client,
            &Binding { operation: "start".into(), target: id.clone(), digest: digest.clone() },
        )?;
        if let Some(journal) = self.journal.as_mut() {
            journal.prepare(&id, client, &profile.profile.project_id, &digest)?;
        }
        let now = self.authority.borrow().now();
        self.attempts.insert(
            id.clone(),
            Attempt {
                id: id.clone(),
                client: client.to_owned(),
                start_expires_at: challenge.expires_at,
                attachment_generation: 0,
                rate_at: now,
                input_bytes: 0,
                resizes: 0,
                profile: profile.clone(),
                digest,
                state: "prepared",
                output: TerminalOutput::new(REPLAY_BYTES)?,
                handle: None,
                attachment: None,
                startup_deadline: None,
                exit: None,
                lifecycle: None,
                evidence: None,
            },
        );
        self.order.push(id.clone());
        Ok(Prepared { attempt_id: id, profile, challenge })
    }

    /// `snapshot()` reply, in the TypeScript key order.
    pub fn snapshot(&mut self, id: &str) -> R<Value> {
        self.get(id)?;
        self.owned(id);
        let attempt = &self.attempts[id];
        let mut snapshot = serde_json::Map::new();
        snapshot.insert("instanceId".into(), id.into());
        snapshot.insert("epoch".into(), self.authority.borrow().epoch.clone().into());
        snapshot.insert("state".into(), attempt.state.into());
        if let Some((code, signal)) = attempt.exit {
            let mut exit = serde_json::Map::new();
            exit.insert("exitCode".into(), code.into());
            if let Some(signal) = signal {
                exit.insert("signal".into(), signal.into());
            }
            snapshot.insert("exit".into(), exit.into());
        }
        if let Some((started, exited)) = attempt.lifecycle {
            let mut lifecycle = serde_json::Map::new();
            lifecycle.insert("startedAt".into(), started.into());
            if let Some(exited) = exited {
                lifecycle.insert("exitedAt".into(), exited.into());
            }
            snapshot.insert("lifecycle".into(), lifecycle.into());
        }
        Ok(snapshot.into())
    }

    pub fn state(&self, id: &str) -> Option<&'static str> {
        self.attempts.get(id).map(|a| a.state)
    }

    pub fn canvas_session_evidence(&mut self, id: &str) -> R<Value> {
        self.get(id)?;
        if !self.owned(id) {
            return Ok(Value::Null);
        }
        let attempt = &self.attempts[id];
        let Some((_, exited)) = attempt.lifecycle else { return Ok(Value::Null) };
        if !["running", "exited"].contains(&attempt.state) || (attempt.state == "exited" && exited.is_none()) {
            return Ok(Value::Null);
        }
        Ok(attempt
            .handle
            .as_ref()
            .and_then(|h| h.session_evidence())
            .or_else(|| attempt.evidence.clone())
            .unwrap_or(Value::Null))
    }

    pub fn launch(&mut self, id: &str, proof: &Value) -> R<()> {
        if self.closed {
            return Err(e("Terminal supervisor is closed"));
        }
        let attempt = self.get(id)?;
        if attempt.state != "prepared" {
            return Err(e("Terminal attempt already used"));
        }
        let project = attempt.profile.profile.project_id.clone();
        let active: Vec<&Attempt> = self
            .attempts
            .values()
            .filter(|a| ["starting", "running", "ownership_lost"].contains(&a.state))
            .collect();
        if active.len() >= ACTIVE || active.iter().filter(|a| a.profile.profile.project_id == project).count() >= PER_PROJECT {
            return Err(e("Terminal admission limit exceeded"));
        }
        self.backend.preflight()?;
        if let Some(journal) = &self.journal {
            journal.preflight_start(id)?;
        }
        let profile = self.attempts[id].profile.clone();
        let digest = self.attempts[id].digest.clone();
        let valid = self.valid_profile(&profile);
        self.authority.borrow_mut().consume(proof, &Binding { operation: "start".into(), target: id.into(), digest: digest.clone() })?;
        if !valid {
            if let Some(journal) = self.journal.as_mut() {
                journal.transition(id, "start_failed", None)?;
            }
            self.attempts.get_mut(id).unwrap().state = "start_failed";
            return Ok(());
        }
        // Durable admission commits before the backend can have side effects. Never retry.
        if let Some(journal) = self.journal.as_mut() {
            journal.transition(id, "starting", None)?;
        }
        let now = self.authority.borrow().now();
        {
            let attempt = self.attempts.get_mut(id).unwrap();
            attempt.state = "starting";
            attempt.startup_deadline = Some(now + STARTUP_MS);
        }
        let (client, expires) = (self.attempts[id].client.clone(), self.attempts[id].start_expires_at);
        let identity = Identity { instance_id: id.into(), epoch: self.authority.borrow().epoch.clone(), manifest_digest: digest };
        let started = if !self.authority.borrow().is_enrolled(&client) || self.authority.borrow().now() >= expires {
            Err(e("Terminal start authorization expired"))
        } else {
            let backend = &mut self.backend;
            match self.journal.as_mut() {
                Some(journal) => journal.with_owner(|| backend.start(&profile, &identity)),
                None => backend.start(&profile, &identity),
            }
        };
        match started {
            Ok(handle) => {
                let attempt = self.attempts.get_mut(id).unwrap();
                attempt.evidence = handle.session_evidence();
                attempt.handle = Some(handle);
                if ["exited", "ownership_lost"].contains(&attempt.state) {
                    self.release_handle(id);
                }
            }
            // A failed start can have uncertain side effects. Never retry or signal a PID.
            Err(_) => self.lose(id),
        }
        Ok(())
    }

    /// Backend evidence for one owned attempt, in arrival order.
    pub fn event(&mut self, id: &str, event: BackendEvent) {
        let Some(state) = self.attempts.get(id).map(|a| a.state) else { return };
        match event {
            BackendEvent::Lost => self.lose(id),
            BackendEvent::Started { started_at } => {
                if state != "starting" || !self.record(id, "running", None) {
                    return;
                }
                let attempt = self.attempts.get_mut(id).unwrap();
                attempt.state = "running";
                if let Some(at) = started_at.filter(|at| *at >= 0) {
                    attempt.lifecycle = Some((at, None));
                }
                attempt.startup_deadline = None;
            }
            BackendEvent::Data(bytes) => {
                if !["starting", "running"].contains(&state) || !self.owned(id) {
                    return;
                }
                let units = String::from_utf8_lossy(&bytes).encode_utf16().count();
                if units > BACKEND_EVENT_CODE_UNITS {
                    return self.lose(id);
                }
                self.attempts.get_mut(id).unwrap().output.append(&bytes);
            }
            BackendEvent::Exit { exit_code, signal, evidence } => {
                if !["starting", "running"].contains(&state) {
                    return;
                }
                let exit = Exit { exit_code: Some(exit_code), signal: signal.map(Value::from) };
                if !self.record(id, "exited", Some(exit)) {
                    return;
                }
                let attempt = self.attempts.get_mut(id).unwrap();
                attempt.state = "exited";
                if let Some((started, exited)) = evidence.filter(|(s, x)| *s >= 0 && x >= s) {
                    attempt.lifecycle = Some((started, Some(exited)));
                }
                attempt.exit = Some((exit_code, signal));
                attempt.startup_deadline = None;
                if let Some(attachment) = attempt.attachment.as_mut() {
                    attachment.lease = None;
                }
                self.release_handle(id);
            }
        }
    }

    /// Startup timers: an attempt that never reported started is uncertain.
    pub fn tick(&mut self) {
        let now = self.authority.borrow().now();
        let late: Vec<String> = self
            .attempts
            .values()
            .filter(|a| a.state == "starting" && a.startup_deadline.is_some_and(|d| d <= now))
            .map(|a| a.id.clone())
            .collect();
        for id in late {
            self.lose(&id);
        }
    }

    pub fn next_deadline(&self) -> Option<i64> {
        self.attempts.values().filter_map(|a| a.startup_deadline).min()
    }

    fn binding(&self, operation: &str, id: &str, detail: &str) -> Binding {
        let attempt = &self.attempts[id];
        let text = serde_json::to_string(&serde_json::json!([attempt.digest, detail])).unwrap();
        Binding { operation: operation.into(), target: id.into(), digest: terminal_digest(text.as_bytes()) }
    }

    pub fn request_attach(&mut self, client: &str, id: &str) -> R<Challenge> {
        if self.closed {
            return Err(e("Terminal supervisor is closed"));
        }
        self.assert_owner()?;
        let attempt = self.get(id)?;
        if !["running", "exited"].contains(&attempt.state) {
            return Err(e("Terminal unavailable"));
        }
        let binding = self.binding("attach", id, &attempt.attachment_generation.to_string());
        self.authority.borrow_mut().prepare(client, &binding).map_err(e)
    }

    pub fn attach(&mut self, id: &str, proof: &Value) -> R<String> {
        if self.closed {
            return Err(e("Terminal supervisor is closed"));
        }
        self.assert_owner()?;
        let attempt = self.get(id)?;
        if !["running", "exited"].contains(&attempt.state) {
            return Err(e("Terminal unavailable"));
        }
        if attempt.attachment.as_ref().is_some_and(|a| self.authority.borrow().is_enrolled(&a.client)) {
            return Err(e("Terminal already attached"));
        }
        let binding = self.binding("attach", id, &attempt.attachment_generation.to_string());
        let client = self.authority.borrow_mut().consume(proof, &binding)?;
        let attachment = uuid::Uuid::new_v4().to_string();
        let attempt = self.attempts.get_mut(id).unwrap();
        attempt.attachment_generation += 1;
        attempt.attachment = Some(Attachment { id: attachment.clone(), client, generation: 0, lease: None });
        Ok(attachment)
    }

    pub fn detach(&mut self, id: &str, attachment: &str) -> R<()> {
        self.get(id)?;
        self.attachment(id, attachment)?;
        let attempt = self.attempts.get_mut(id).unwrap();
        attempt.attachment = None;
        attempt.attachment_generation += 1;
        Ok(())
    }

    pub fn read(&mut self, id: &str, attachment: &str, cursor: u64) -> R<Read> {
        self.get(id)?;
        self.attachment(id, attachment)?;
        self.attempts[id].output.read(cursor).map_err(e)
    }

    pub fn request_input(&mut self, id: &str, attachment: &str) -> R<Challenge> {
        self.live(id)?;
        let (client, generation) = self.attachment(id, attachment)?;
        let detail = serde_json::to_string(&serde_json::json!([attachment, generation])).unwrap();
        let binding = self.binding("input", id, &detail);
        self.authority.borrow_mut().prepare(&client, &binding).map_err(e)
    }

    pub fn enable_input(&mut self, id: &str, attachment: &str, proof: &Value) -> R<String> {
        self.live(id)?;
        let (expected, generation) = self.attachment(id, attachment)?;
        let detail = serde_json::to_string(&serde_json::json!([attachment, generation])).unwrap();
        let binding = self.binding("input", id, &detail);
        let client = self.authority.borrow_mut().consume(proof, &binding)?;
        if client != expected {
            return Err(e("Terminal client mismatch"));
        }
        let lease = uuid::Uuid::new_v4().to_string();
        let expires_at = self.authority.borrow().now() + INPUT_LEASE_MS;
        let attachment = self.attempts.get_mut(id).unwrap().attachment.as_mut().unwrap();
        attachment.generation += 1;
        attachment.lease = Some(Lease { id: lease.clone(), client, expires_at, sequence: 0 });
        Ok(lease)
    }

    /// Native broker calls this on blur, navigation or transport loss. Never renews.
    pub fn revoke_input(&mut self, id: &str, attachment: &str) -> R<()> {
        self.get(id)?;
        self.attachment(id, attachment)?;
        let attachment = self.attempts.get_mut(id).unwrap().attachment.as_mut().unwrap();
        attachment.lease = None;
        attachment.generation += 1;
        Ok(())
    }

    pub fn write(&mut self, id: &str, attachment: &str, lease: &str, sequence: i64, text: &str) -> R<()> {
        if utf16_len(text) > INPUT_WRITE_BYTES || text.len() > INPUT_WRITE_BYTES {
            return Err(e("Terminal input limit exceeded"));
        }
        self.write_authorized(id, attachment, lease, sequence, text)
    }

    fn paste_size(text: &str) -> R<()> {
        if utf16_len(text) > PASTE_BYTES || text.len() > PASTE_BYTES {
            return Err(e("Terminal paste limit exceeded"));
        }
        Ok(())
    }

    fn paste_binding(&self, id: &str, attachment: &str, lease: &str, sequence: i64, text: &str) -> Binding {
        let detail = serde_json::to_string(&serde_json::json!([attachment, lease, sequence, text])).unwrap();
        self.binding("paste", id, &detail)
    }

    pub fn request_paste(&mut self, id: &str, attachment: &str, lease: &str, sequence: i64, text: &str) -> R<Challenge> {
        self.live(id)?;
        let (client, _) = self.attachment(id, attachment)?;
        Self::paste_size(text)?;
        self.input_lease(id, lease, sequence)?;
        let binding = self.paste_binding(id, attachment, lease, sequence, text);
        self.authority.borrow_mut().prepare(&client, &binding).map_err(e)
    }

    pub fn paste(&mut self, id: &str, attachment: &str, lease: &str, sequence: i64, text: &str, proof: &Value) -> R<()> {
        self.live(id)?;
        self.attachment(id, attachment)?;
        Self::paste_size(text)?;
        self.input_lease(id, lease, sequence)?;
        let binding = self.paste_binding(id, attachment, lease, sequence, text);
        self.authority.borrow_mut().consume(proof, &binding)?;
        self.write_authorized(id, attachment, lease, sequence, text)
    }

    pub fn resize(&mut self, id: &str, attachment: &str, cols: i64, rows: i64) -> R<()> {
        self.live(id)?;
        self.attachment(id, attachment)?;
        if !(20..=300).contains(&cols) || !(5..=100).contains(&rows) {
            return Err(e("Invalid terminal dimensions"));
        }
        self.rate(id);
        let attempt = self.attempts.get_mut(id).unwrap();
        attempt.resizes += 1;
        if attempt.resizes > RESIZE_PER_SECOND {
            return Err(e("Terminal resize rate exceeded"));
        }
        self.effect(id, |h| h.resize(cols as u16, rows as u16))
    }

    pub fn request_stop(&mut self, client: &str, id: &str, signal: &str) -> R<Challenge> {
        self.live(id)?;
        Self::valid_signal(signal)?;
        let binding = self.binding("stop", id, signal);
        self.authority.borrow_mut().prepare(client, &binding).map_err(e)
    }

    pub fn stop(&mut self, id: &str, signal: &str, proof: &Value) -> R<()> {
        self.live(id)?;
        Self::valid_signal(signal)?;
        let binding = self.binding("stop", id, signal);
        self.authority.borrow_mut().consume(proof, &binding)?;
        // A successful signal call is not exit evidence. Escalation needs another grant.
        let signal = signal.to_owned();
        self.effect(id, move |h| h.signal(&signal))
    }

    /// Explicit Core teardown: revoke controls, keep uncertainty, never signal or retry.
    pub fn shutdown(&mut self) {
        if self.closed {
            return;
        }
        self.closed = true;
        for id in self.order.clone() {
            let state = self.attempts[&id].state;
            self.attempts.get_mut(&id).unwrap().attachment = None;
            if state == "prepared" {
                self.record(&id, "start_failed", None);
                self.attempts.get_mut(&id).unwrap().state = "start_failed";
            } else if ["starting", "running"].contains(&state) {
                self.lose(&id);
            }
        }
        if let Some(journal) = self.journal.as_mut() {
            let _ = journal.release();
        }
    }

    fn valid_signal(signal: &str) -> R<()> {
        if signal != "SIGTERM" && signal != "SIGKILL" {
            return Err(e("Invalid terminal stop signal"));
        }
        Ok(())
    }

    fn write_authorized(&mut self, id: &str, attachment: &str, lease: &str, sequence: i64, text: &str) -> R<()> {
        self.live(id)?;
        self.attachment(id, attachment)?;
        self.input_lease(id, lease, sequence)?;
        self.rate(id);
        let bytes = text.len();
        let attempt = self.attempts.get_mut(id).unwrap();
        if bytes == 0 || attempt.input_bytes + bytes > INPUT_BYTES_PER_SECOND {
            return Err(e("Terminal input rate exceeded"));
        }
        attempt.input_bytes += bytes;
        attempt.attachment.as_mut().unwrap().lease.as_mut().unwrap().sequence += 1;
        let text = text.to_owned();
        self.effect(id, move |h| h.write(&text))
    }

    fn input_lease(&self, id: &str, lease: &str, sequence: i64) -> R<()> {
        let attachment = self.attempts[id].attachment.as_ref();
        let ok = attachment.and_then(|a| a.lease.as_ref()).is_some_and(|l| {
            l.id == lease
                && l.expires_at > self.authority.borrow().now()
                && self.authority.borrow().is_enrolled(&l.client)
                && (0..=9_007_199_254_740_991).contains(&sequence)
                && sequence == l.sequence
        });
        if !ok {
            return Err(e("Terminal input authorization denied"));
        }
        Ok(())
    }

    fn rate(&mut self, id: &str) {
        let now = self.authority.borrow().now();
        let attempt = self.attempts.get_mut(id).unwrap();
        if now - attempt.rate_at >= 1000 {
            attempt.rate_at = now;
            attempt.input_bytes = 0;
            attempt.resizes = 0;
        }
    }

    fn get(&self, id: &str) -> R<&Attempt> {
        self.attempts.get(id).ok_or_else(|| e("Unknown terminal instance"))
    }

    fn live(&mut self, id: &str) -> R<()> {
        self.get(id)?;
        if !self.owned(id) {
            return Err(e("Terminal journal ownership lost"));
        }
        let attempt = &self.attempts[id];
        if attempt.state != "running" || attempt.handle.is_none() {
            return Err(e("Terminal is not owned and running"));
        }
        Ok(())
    }

    fn attachment(&mut self, id: &str, attachment: &str) -> R<(String, i64)> {
        if !self.owned(id) {
            return Err(e("Terminal journal ownership lost"));
        }
        match self.attempts[id].attachment.as_ref() {
            Some(a) if a.id == attachment && self.authority.borrow().is_enrolled(&a.client) => Ok((a.client.clone(), a.generation)),
            _ => Err(e("Terminal attachment unavailable")),
        }
    }

    fn effect(&mut self, id: &str, operation: impl FnOnce(&mut Box<dyn Handle>) -> R<()>) -> R<()> {
        let attempts = &mut self.attempts;
        let handle = attempts.get_mut(id).unwrap().handle.as_mut().unwrap();
        let result = match self.journal.as_mut() {
            Some(journal) => journal.with_owner(|| operation(handle)),
            None => operation(handle),
        };
        if result.is_err() {
            self.lose(id);
            return Err(e("Terminal effect uncertain; input revoked"));
        }
        Ok(())
    }

    fn lose(&mut self, id: &str) {
        let Some(state) = self.attempts.get(id).map(|a| a.state) else { return };
        if ["exited", "start_failed"].contains(&state) {
            return;
        }
        if state != "ownership_lost" {
            if let Some(journal) = self.journal.as_mut() {
                // Keep the last durable state uncertain; recovery never infers an exit.
                let _ = journal.transition(id, "ownership_lost", None);
            }
        }
        let attempt = self.attempts.get_mut(id).unwrap();
        attempt.state = "ownership_lost";
        attempt.attachment = None;
        attempt.startup_deadline = None;
        self.release_handle(id);
    }

    fn owned(&mut self, id: &str) -> bool {
        if self.assert_owner().is_ok() {
            return true;
        }
        self.lose(id);
        false
    }

    fn record(&mut self, id: &str, state: &str, exit: Option<Exit>) -> bool {
        let result = match self.journal.as_mut() {
            Some(journal) => journal.transition(id, state, exit),
            None => Ok(()),
        };
        if result.is_err() {
            self.lose(id);
            return false;
        }
        true
    }

    fn release_handle(&mut self, id: &str) {
        if let Some(mut handle) = self.attempts.get_mut(id).and_then(|a| a.handle.take()) {
            handle.dispose();
        }
    }
}
