//! In-process owned PTY backend: the Rust equivalent of `pty-backend.ts` + `pty-host.ts`.
//! The CLI is spawned directly (no extra Node process); lifecycle receipts and profile
//! revalidation come from the `admission` and `profiles` ports.
use crate::pty::{self, Event, Pty, Spawn};
use crate::supervisor::{Backend, BackendEvent, Handle, Identity, PreparedProfile};
use std::ffi::OsString;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::Sender;
use std::sync::{Arc, Mutex};

type R<T> = Result<T, String>;

/// Lifecycle receipt (`managed-codex/lifecycle-receipt.ts`), created before dispatch.
/// Each record returns its `at` timestamp. Implemented by `admission` (lane L3).
pub trait Receipt: Send {
    fn started(&mut self) -> R<i64>;
    fn spawn_failed(&mut self) -> R<()>;
    /// `code` is null when signalled; `signal` is the name (`SIGTERM`) or null.
    fn exit(&mut self, code: Option<i64>, signal: Option<&str>) -> R<i64>;
}

/// Profile side of one slot (`profiles`, lane L2): revalidation, environment, receipts.
pub trait SlotProfiles {
    fn validate(&mut self, profile: &PreparedProfile) -> bool;
    fn environment(&self, profile: &PreparedProfile) -> R<Vec<(String, String)>>;
    fn receipt(&mut self, identity: &Identity) -> R<Box<dyn Receipt>>;
    fn session_evidence(&self, _identity: &Identity) -> Option<serde_json::Value> {
        None
    }
}

/// Events from every owned PTY, delivered to the single Core thread.
pub struct Delivery {
    pub slot: usize,
    pub instance: String,
    pub event: BackendEvent,
}

pub struct PtyBackend {
    slot: usize,
    profiles: Box<dyn SlotProfiles>,
    helper: OsString,
    events: Sender<crate::core::CoreEvent>,
}

impl PtyBackend {
    pub fn new(slot: usize, profiles: Box<dyn SlotProfiles>, helper: OsString, events: Sender<crate::core::CoreEvent>) -> Self {
        PtyBackend { slot, profiles, helper, events }
    }
}

struct PtyHandle {
    pty: Arc<Pty>,
    exited: Arc<AtomicBool>,
    evidence: Option<serde_json::Value>,
}

impl Handle for PtyHandle {
    fn write(&mut self, text: &str) -> R<()> {
        self.pty.write(text.as_bytes()).map_err(|e| e.to_string())
    }
    fn resize(&mut self, cols: u16, rows: u16) -> R<()> {
        self.pty.resize(cols, rows).map_err(|e| e.to_string())
    }
    fn signal(&mut self, signal: &str) -> R<()> {
        if self.exited.load(Ordering::SeqCst) {
            return Err("Terminal already exited".into());
        }
        self.pty.signal(signal).map_err(|e| e.to_string())
    }
    fn session_evidence(&self) -> Option<serde_json::Value> {
        self.evidence.clone()
    }
    // Dispose releases listeners only: the PTY stays owned by its watcher until exit.
}

impl Backend for PtyBackend {
    fn validate(&mut self, profile: &PreparedProfile) -> bool {
        self.profiles.validate(profile)
    }

    fn start(&mut self, profile: &PreparedProfile, identity: &Identity) -> R<Box<dyn Handle>> {
        // Repeat at the last synchronous dispatch boundary.
        if !self.profiles.validate(profile) {
            return Err("Managed profile changed".into());
        }
        let env = self.profiles.environment(profile)?;
        let evidence = self.profiles.session_evidence(identity);
        let receipt = Arc::new(Mutex::new(self.profiles.receipt(identity)?));
        let p = &profile.profile;
        let spec = Spawn { executable: &p.executable, argv: &p.argv, cwd: &p.cwd, env: &env, cols: 80, rows: 24 };
        let (pty, receiver) = match Pty::spawn(&spec, &self.helper) {
            Ok(spawned) => spawned,
            Err(error) => {
                let _ = receipt.lock().unwrap().spawn_failed();
                return Err(error.to_string());
            }
        };
        let pty = Arc::new(pty);
        let exited = Arc::new(AtomicBool::new(false));
        let (slot, instance, events) = (self.slot, identity.instance_id.clone(), self.events.clone());
        let send = move |event: BackendEvent| {
            let _ = events.send(crate::core::CoreEvent::Backend(Delivery { slot, instance: instance.clone(), event }));
        };
        // Successful PTY creation is OS process evidence, not provider readiness.
        let started_at = match receipt.lock().unwrap().started() {
            Ok(at) => at,
            Err(_) => {
                // Receipt failure is uncertainty; the process may run. Never invent exit.
                send(BackendEvent::Lost);
                return Ok(Box::new(PtyHandle { pty, exited, evidence }));
            }
        };
        send(BackendEvent::Started { started_at: Some(started_at) });
        let watch_pty = pty.clone();
        let watch_exited = exited.clone();
        let lifetime_pty = pty.clone();
        let lifetime_exited = exited.clone();
        std::thread::spawn(move || {
            // The owned deadline: SIGTERM after 30 minutes, SIGKILL 5 s later.
            let deadline = std::time::Instant::now() + pty::LIFETIME;
            while std::time::Instant::now() < deadline {
                if lifetime_exited.load(Ordering::SeqCst) {
                    return;
                }
                std::thread::sleep(std::time::Duration::from_secs(1));
            }
            if lifetime_exited.load(Ordering::SeqCst) {
                return;
            }
            let _ = lifetime_pty.signal("SIGTERM");
            std::thread::sleep(pty::ESCALATION);
            if !lifetime_exited.load(Ordering::SeqCst) {
                let _ = lifetime_pty.signal("SIGKILL");
            }
        });
        std::thread::spawn(move || {
            let _owned = watch_pty; // Keep the master open until the process exits.
            for event in receiver {
                match event {
                    Event::Data(bytes) => send(BackendEvent::Data(bytes)),
                    Event::Exit { exit_code, signal } => {
                        watch_exited.store(true, Ordering::SeqCst);
                        let name = if signal != 0 { pty::signal_name(signal) } else { None };
                        let code = if signal != 0 { None } else { Some(exit_code as i64) };
                        match receipt.lock().unwrap().exit(code, name) {
                            Ok(exited_at) => send(BackendEvent::Exit {
                                exit_code: exit_code as i64,
                                signal: Some(signal as i64),
                                evidence: Some((started_at, exited_at)),
                            }),
                            Err(_) => send(BackendEvent::Lost),
                        }
                        break;
                    }
                }
            }
        });
        Ok(Box::new(PtyHandle { pty, exited, evidence }))
    }
}

/// The owned lifecycle receipt: created (prepared) and armed before spawn, exactly like
/// `createLifecycleReceipt` + `armLifecycleReceipt` around the Node PTY host.
pub struct LifecycleReceipt(crate::admission::lifecycle_receipt::LifecycleRecorder);

impl LifecycleReceipt {
    pub fn create(state: &std::path::Path, identity: &Identity, config_digest: &str) -> R<Box<dyn Receipt>> {
        use crate::admission::lifecycle_receipt::{arm_lifecycle_receipt, create_lifecycle_receipt, LifecycleBinding};
        let binding = LifecycleBinding {
            instance_id: identity.instance_id.clone(),
            epoch: identity.epoch.clone(),
            manifest_digest: identity.manifest_digest.clone(),
            config_digest: config_digest.to_owned(),
        };
        let now = || crate::authority::now_ms().max(0) as u64;
        let file = create_lifecycle_receipt(state, &binding, now()).map_err(|e| e.to_string())?;
        let recorder = arm_lifecycle_receipt(file, config_digest, now()).map_err(|e| e.to_string())?;
        Ok(Box::new(LifecycleReceipt(recorder)))
    }
}

impl Receipt for LifecycleReceipt {
    fn started(&mut self) -> R<i64> {
        use crate::admission::lifecycle_receipt::LifecycleEvent;
        self.0.record(LifecycleEvent::Started, crate::authority::now_ms().max(0) as u64).map_err(|e| e.to_string())?;
        Ok(self.0.last_at() as i64)
    }
    fn spawn_failed(&mut self) -> R<()> {
        use crate::admission::lifecycle_receipt::LifecycleEvent;
        self.0.record(LifecycleEvent::SpawnFailed, crate::authority::now_ms().max(0) as u64).map_err(|e| e.to_string())
    }
    fn exit(&mut self, code: Option<i64>, signal: Option<&str>) -> R<i64> {
        use crate::admission::lifecycle_receipt::LifecycleEvent;
        let event = LifecycleEvent::Exit { code, signal: signal.map(str::to_owned) };
        self.0.record(event, crate::authority::now_ms().max(0) as u64).map_err(|e| e.to_string())?;
        Ok(self.0.last_at() as i64)
    }
}
