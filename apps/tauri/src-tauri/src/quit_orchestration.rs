//! Shared native Quit circuit. Ports isolate effects, not the decisions under test.
use crate::host_phase::{self, EvidenceStep, HostPhase, Phase, QuitDecision, QuitStep};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::future::Future;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tokio::sync::oneshot;

/// Core's deadline is 5s; the native pipe deliberately waits longer.
pub const PIPE_TIMEOUT: Duration = Duration::from_secs(8);

pub trait AgentsGate {
    fn active(&self) -> bool;
    /// True means a native review is pending; false means absent or already authorized.
    fn confirm_exit(&self) -> bool;
}

pub trait TerminalPipe {
    fn request_id(&self) -> String;
    /// Register the reply before writing the private request. No renderer payload enters here.
    fn send(&self, id: &str, kind: &str) -> Option<oneshot::Receiver<Value>>;
    fn cancel(&self, id: &str);
    fn confirm_exit(&self) -> bool;
}

pub trait ExitPort {
    fn request_exit(&self);
    fn start_owned_shutdown(&self);
    fn blocked(&self, reason: &str, uncertain: Value);
    fn fence(&self);
}

pub trait Timer {
    fn wait(
        &self,
        duration: Duration,
        receiver: oneshot::Receiver<Value>,
    ) -> impl Future<Output = Option<Value>> + Send;
}

/// The same ID router is used by the native reader and the scripted test transport.
/// Dropping it on EOF drops waiters; absence never manufactures a reply or evidence.
#[derive(Default)]
pub struct PendingReplies(HashMap<String, oneshot::Sender<Value>>);

impl PendingReplies {
    pub fn register(&mut self, id: String) -> oneshot::Receiver<Value> {
        let (sender, receiver) = oneshot::channel();
        self.0.insert(id, sender);
        receiver
    }

    pub fn cancel(&mut self, id: &str) {
        self.0.remove(id);
    }

    pub fn is_reply(value: &Value) -> bool {
        matches!(
            value["kind"].as_str(),
            Some("owned-shutdown" | "retirement" | "owned-shutdown-closed")
        )
    }

    pub fn deliver(&mut self, value: Value) -> bool {
        if !Self::is_reply(&value) {
            return false;
        }
        let sender = value["id"].as_str().and_then(|id| self.0.remove(id));
        sender.is_some_and(|sender| sender.send(value).is_ok())
    }
}

pub struct Coordinator {
    pub host: HostPhase,
    in_flight: AtomicBool,
}

impl Coordinator {
    pub const fn new() -> Self {
        Self {
            host: HostPhase::new(),
            in_flight: AtomicBool::new(false),
        }
    }

    fn blocked(&self, exit: &impl ExitPort, reason: &str, uncertain: Value) {
        self.in_flight.store(false, Ordering::SeqCst);
        exit.blocked(reason, uncertain);
    }

    /// All user Quit entries and owned ExitRequested callbacks use this same latch.
    pub fn request_quit(&self, agents: &impl AgentsGate, exit: &impl ExitPort) {
        if let Some(reason) = host_phase::pre_gate_block(self.host.phase()) {
            self.blocked(exit, reason, json!([]));
            return;
        }
        if self.in_flight.load(Ordering::SeqCst) {
            return;
        }
        let active = agents.active();
        let gate = active && agents.confirm_exit();
        // A native review may have allowed a concurrent start/loss. Revalidate its boundary.
        if let Some(reason) = host_phase::pre_gate_block(self.host.phase()) {
            self.blocked(exit, reason, json!([]));
            return;
        }
        match self.host.decide_quit(active, gate, false) {
            QuitDecision::BlockedLost => self.blocked(exit, "host_lost", json!([])),
            QuitDecision::BlockedStarting => self.blocked(exit, "starting", json!([])),
            QuitDecision::AgentsGate => {
                // Cancellation cannot strand a latch or signal a terminal.
                self.in_flight.store(false, Ordering::SeqCst);
            }
            QuitDecision::ExitDirect => exit.request_exit(),
            QuitDecision::AlreadyInFlight => {}
            QuitDecision::TerminalFlow => {
                if !self.in_flight.swap(true, Ordering::SeqCst) {
                    exit.start_owned_shutdown();
                }
            }
        }
    }

    /// Approval itself grants no bypass: the resulting ExitRequested re-enters the circuit.
    pub fn agents_approved(&self, exit: &impl ExitPort) {
        exit.request_exit();
    }

    /// Return true only when this ExitRequested may proceed; the shell prevents all others.
    pub fn exit_requested(
        &self,
        agents: &impl AgentsGate,
        terminal: &impl TerminalPipe,
        exit: &impl ExitPort,
    ) -> bool {
        if self.host.consume_exit_evidence() || self.host.phase() == Phase::ExitConsumed {
            return true;
        }
        if self.host.owned() {
            self.request_quit(agents, exit);
            return false;
        }
        // Retain the existing no-owned-host native gates, in their original order.
        if terminal.confirm_exit() || agents.confirm_exit() {
            return false;
        }
        // Native ExitRequested can arrive without request_quit. Reserve that exit too.
        if self.host.decide_quit(false, false, false) == QuitDecision::ExitDirect {
            return true;
        }
        self.request_quit(agents, exit);
        false
    }

    async fn pipe(
        &self,
        terminal: &impl TerminalPipe,
        timer: &impl Timer,
        kind: &str,
    ) -> Option<Value> {
        let id = terminal.request_id();
        let receiver = terminal.send(&id, kind)?;
        let value = timer.wait(PIPE_TIMEOUT, receiver).await;
        if value.is_none() {
            terminal.cancel(&id);
        }
        value
    }

    pub async fn quit_owned(
        &self,
        terminal: &impl TerminalPipe,
        exit: &impl ExitPort,
        timer: &impl Timer,
    ) {
        self.host.shutdown_started();
        let Some(shutdown) = self.pipe(terminal, timer, "shutdownOwned").await else {
            self.blocked(exit, "transport", json!([]));
            return;
        };
        let uncertain = shutdown["uncertain"].clone();
        match host_phase::shutdown_step(shutdown["status"].as_str()) {
            QuitStep::Retire => {
                exit.fence();
                let reply = self.pipe(terminal, timer, "retireOwned").await;
                match host_phase::retire_step(
                    reply.as_ref().and_then(|value| value["status"].as_str()),
                ) {
                    EvidenceStep::Exit => {
                        self.host.exit_evidence();
                        exit.request_exit();
                    }
                    EvidenceStep::Blocked(reason) => self.blocked(exit, reason, uncertain),
                }
            }
            QuitStep::ClosePreserved => {
                let reply = self.pipe(terminal, timer, "closePreservedOwned").await;
                match host_phase::close_step(
                    reply.as_ref().and_then(|value| value["status"].as_str()),
                ) {
                    EvidenceStep::Exit => {
                        self.host.exit_evidence();
                        exit.request_exit();
                    }
                    EvidenceStep::Blocked(reason) => self.blocked(exit, reason, uncertain),
                }
            }
            QuitStep::Blocked(reason) => {
                // Only an authenticated pre-fence refusal reopens presentation.
                if reason == "busy" || reason == "denied" {
                    self.host.rollback_busy();
                }
                self.blocked(exit, reason, uncertain);
            }
        }
    }
}

pub static QUIT: Coordinator = Coordinator::new();

#[cfg(test)]
#[path = "quit_orchestration_tests.rs"]
mod tests;
