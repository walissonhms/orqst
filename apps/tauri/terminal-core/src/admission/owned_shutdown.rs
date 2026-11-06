//! Port of `terminal/owned-shutdown.ts`: the owned shutdown inventory schema and the bounded
//! release transaction. The TypeScript class is asynchronous; this port is synchronous and each
//! port receives the absolute deadline it must honor. Callers serialize `run` (the TypeScript
//! `inFlight` sharing is a caller-side `Mutex`).
use super::error::{invalid, AdmissionError, Result};
use super::json::{self, safe_int, strict};
use serde::Serialize;
use serde_json::Value;
use std::collections::HashSet;

pub const TERMINAL_STATES: [&str; 6] = [
    "prepared",
    "starting",
    "running",
    "exited",
    "start_failed",
    "ownership_lost",
];

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OwnedExit {
    pub exit_code: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub signal: Option<i64>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OwnedShutdownAttempt {
    pub slot: u8,
    pub instance_id: String,
    pub epoch: String,
    pub state: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit: Option<OwnedExit>,
}

impl OwnedShutdownAttempt {
    /// `prepared` / `start_failed`, or `exited` with exit evidence.
    pub fn settled(&self) -> bool {
        matches!(self.state.as_str(), "prepared" | "start_failed")
            || (self.state == "exited" && self.exit.is_some())
    }
}

/// `ownedShutdownInventorySchema`; also the managed-pair retirement evidence (`PairEvidence`).
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct OwnedShutdownInventory {
    pub epoch: String,
    pub attempts: Vec<OwnedShutdownAttempt>,
}

impl OwnedShutdownInventory {
    pub fn to_value(&self) -> Value {
        serde_json::to_value(self).expect("inventory serialization")
    }
}

fn parse_exit(value: &Value) -> Result<OwnedExit> {
    let map = strict(value, &["exitCode", "signal"])?;
    let exit_code = map
        .get("exitCode")
        .and_then(safe_int)
        .ok_or_else(|| invalid("exitCode: expected int"))?;
    let signal = match map.get("signal") {
        None => None,
        Some(signal) => Some(safe_int(signal).ok_or_else(|| invalid("signal: expected int"))?),
    };
    Ok(OwnedExit { exit_code, signal })
}

fn parse_attempt(value: &Value) -> Result<OwnedShutdownAttempt> {
    let map = strict(value, &["slot", "instanceId", "epoch", "state", "exit"])?;
    let slot = map
        .get("slot")
        .and_then(safe_int)
        .filter(|slot| (0..=7).contains(slot))
        .ok_or_else(|| invalid("slot"))? as u8;
    let instance_id = json::uuid(map, "instanceId")?;
    let epoch = json::uuid(map, "epoch")?;
    let state = json::string(map, "state")?;
    if !TERMINAL_STATES.contains(&state) {
        return Err(invalid("state"));
    }
    let exit = match map.get("exit") {
        None => None,
        Some(exit) => Some(parse_exit(exit)?),
    };
    Ok(OwnedShutdownAttempt {
        slot,
        instance_id,
        epoch,
        state: state.to_owned(),
        exit,
    })
}

/// `ownedShutdownInventorySchema.parse(value)`; the result serializes in schema key order.
pub fn parse_owned_shutdown_inventory(value: &Value) -> Result<OwnedShutdownInventory> {
    let map = strict(value, &["epoch", "attempts"])?;
    let epoch = json::uuid(map, "epoch")?;
    let attempts = map
        .get("attempts")
        .and_then(Value::as_array)
        .ok_or_else(|| invalid("attempts: expected array"))?;
    if attempts.len() > 1024 {
        return Err(invalid("attempts: too many"));
    }
    let attempts = attempts
        .iter()
        .map(parse_attempt)
        .collect::<Result<Vec<_>>>()?;
    Ok(OwnedShutdownInventory { epoch, attempts })
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ShutdownStatus {
    Ready,
    Uncertain,
    ExitedRetirementUnavailable,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum UncertainReason {
    Timeout,
    OwnershipLost,
    Transport,
    RetirementUnavailable,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UncertainAttempt {
    pub slot: u8,
    pub instance_id: String,
    pub reason: UncertainReason,
}

/// `OwnedShutdownResult`; serializes with the exact TypeScript key presence and order.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct OwnedShutdownResult {
    pub status: ShutdownStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<UncertainReason>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub evidence: Option<OwnedShutdownInventory>,
    pub uncertain: Vec<UncertainAttempt>,
}

/// Port failure. Any error is treated as the TypeScript rejected promise.
#[derive(Debug)]
pub struct PortFailure;

/// Native ports. Every call receives the absolute deadline (`now_ms` clock) and must return by
/// it; a result that arrives after the deadline is discarded as `Shutdown deadline`.
pub trait OwnedShutdownPorts {
    /// Native Quit/CloseRequested pipe only, never a renderer or terminal-focus claim.
    fn current(&mut self) -> bool;
    fn inventory(&mut self, deadline_ms: u64) -> std::result::Result<Value, PortFailure>;
    fn owns(&mut self, attempt: &OwnedShutdownAttempt) -> bool;
    /// SIGTERM only. The port must re-check `current()` and the deadline after asynchronous
    /// preparation, before signing or any effect.
    fn stop(
        &mut self,
        attempt: &OwnedShutdownAttempt,
        deadline_ms: u64,
    ) -> std::result::Result<(), PortFailure>;
    fn prepare_retirement(&mut self, deadline_ms: u64) -> std::result::Result<Value, PortFailure>;
    /// `None` when the port is absent. Only a durable Core-owned pending marker can permit exit
    /// without retirement.
    fn preserve_exit(
        &mut self,
        deadline_ms: u64,
    ) -> Option<std::result::Result<Value, PortFailure>>;
    /// TypeScript `ports.preserveExit !== undefined`.
    fn supports_preserve_exit(&self) -> bool {
        true
    }
    fn now_ms(&mut self) -> u64;
    fn wait(&mut self, ms: u64);
}

/// Bounded release transaction over existing owned Core handles. No process discovery or
/// recovery; no automatic retry or SIGKILL escalation.
pub struct OwnedTerminalShutdown {
    signalled: HashSet<String>,
    epoch: Option<String>,
    timeout_ms: u64,
}

struct Run<'a, P: OwnedShutdownPorts> {
    ports: &'a mut P,
    deadline: u64,
    active: bool,
    errors: Vec<UncertainAttempt>,
}

impl<P: OwnedShutdownPorts> Run<'_, P> {
    fn current(&mut self) -> bool {
        self.active && self.ports.current() && self.ports.now_ms() < self.deadline
    }
    fn expired(&mut self) -> bool {
        self.ports.now_ms() >= self.deadline
    }
    fn remaining(&mut self) -> std::result::Result<(), PortFailure> {
        if self.expired() {
            Err(PortFailure)
        } else {
            Ok(())
        }
    }
    fn uncertain(&mut self, attempt: &OwnedShutdownAttempt, reason: UncertainReason) {
        let entry = UncertainAttempt {
            slot: attempt.slot,
            instance_id: attempt.instance_id.clone(),
            reason,
        };
        // Map#set keeps the first insertion position.
        match self
            .errors
            .iter_mut()
            .find(|error| error.instance_id == attempt.instance_id)
        {
            Some(existing) => *existing = entry,
            None => self.errors.push(entry),
        }
    }
    fn bounded<T>(
        &mut self,
        call: impl FnOnce(&mut P, u64) -> std::result::Result<T, PortFailure>,
    ) -> std::result::Result<T, PortFailure> {
        self.remaining()?;
        let deadline = self.deadline;
        let value = call(self.ports, deadline)?;
        self.remaining()?;
        Ok(value)
    }
}

impl OwnedTerminalShutdown {
    pub fn new(timeout_ms: u64) -> Result<Self> {
        if !(1..=5000).contains(&timeout_ms) {
            return Err(AdmissionError::Rejected("Invalid owned shutdown deadline"));
        }
        Ok(Self {
            signalled: HashSet::new(),
            epoch: None,
            timeout_ms,
        })
    }

    /// Later retries only recheck receipts, never signal twice.
    pub fn run<P: OwnedShutdownPorts>(&mut self, ports: &mut P) -> OwnedShutdownResult {
        let deadline = ports.now_ms() + self.timeout_ms;
        let mut run = Run {
            ports,
            deadline,
            active: true,
            errors: Vec::new(),
        };
        let mut evidence: Option<OwnedShutdownInventory> = None;
        let outcome = self.perform(&mut run, &mut evidence);
        let result = match outcome {
            Ok(Some(result)) => result,
            Ok(None) | Err(PortFailure) => {
                let failed = outcome.is_err();
                let expired = run.expired();
                for attempt in evidence
                    .iter()
                    .flat_map(|evidence| evidence.attempts.iter())
                {
                    if !attempt.settled() {
                        let reason = if !failed || expired {
                            UncertainReason::Timeout
                        } else {
                            UncertainReason::Transport
                        };
                        run.uncertain(attempt, reason);
                    }
                }
                run.active = false;
                // Missing evidence is uncertainty too, even if no instance identity can be listed.
                let reason = if run.expired() {
                    UncertainReason::Timeout
                } else {
                    UncertainReason::Transport
                };
                return OwnedShutdownResult {
                    status: ShutdownStatus::Uncertain,
                    reason: Some(reason),
                    evidence,
                    uncertain: run.errors,
                };
            }
        };
        run.active = false;
        result
    }

    fn perform<P: OwnedShutdownPorts>(
        &mut self,
        run: &mut Run<'_, P>,
        evidence_slot: &mut Option<OwnedShutdownInventory>,
    ) -> std::result::Result<Option<OwnedShutdownResult>, PortFailure> {
        while run.current() {
            let raw = run.bounded(|ports, deadline| ports.inventory(deadline))?;
            let evidence = parse_owned_shutdown_inventory(&raw).map_err(|_| PortFailure)?;
            *evidence_slot = Some(evidence.clone());
            let epoch = self
                .epoch
                .get_or_insert_with(|| evidence.epoch.clone())
                .clone();
            if evidence.epoch != epoch
                || evidence
                    .attempts
                    .iter()
                    .any(|attempt| attempt.epoch != epoch || !run.ports.owns(attempt))
            {
                return Err(PortFailure);
            }
            run.errors.clear();
            let mut waiting = false;
            for attempt in &evidence.attempts {
                if attempt.settled() {
                    continue;
                }
                if !matches!(attempt.state.as_str(), "starting" | "running") {
                    run.uncertain(attempt, UncertainReason::OwnershipLost);
                    continue;
                }
                waiting = true;
                if attempt.state == "starting" {
                    continue;
                }
                if !self.signalled.contains(&attempt.instance_id) {
                    if !run.current() {
                        run.uncertain(attempt, UncertainReason::Timeout);
                        continue;
                    }
                    // Latch before a possibly consumed proof.
                    self.signalled.insert(attempt.instance_id.clone());
                    if run
                        .bounded(|ports, deadline| ports.stop(attempt, deadline))
                        .is_err()
                    {
                        run.uncertain(attempt, UncertainReason::Transport);
                    }
                }
            }
            if !waiting && run.errors.is_empty() {
                let prepared = run
                    .bounded(|ports, deadline| ports.prepare_retirement(deadline))
                    .ok()
                    .and_then(|value| prepared_evidence(&value, false));
                if let Some(prepared) = prepared {
                    if run.current() && prepared == evidence {
                        return Ok(Some(OwnedShutdownResult {
                            status: ShutdownStatus::Ready,
                            reason: None,
                            evidence: Some(evidence),
                            uncertain: Vec::new(),
                        }));
                    }
                }
                if run.ports.supports_preserve_exit() && run.current() {
                    let preserved = run
                        .bounded(|ports, deadline| {
                            ports.preserve_exit(deadline).unwrap_or(Err(PortFailure))
                        })
                        .ok()
                        .and_then(|value| prepared_evidence(&value, true));
                    if let Some(preserved) = preserved {
                        if run.current() && preserved == evidence {
                            return Ok(Some(OwnedShutdownResult {
                                status: ShutdownStatus::ExitedRetirementUnavailable,
                                reason: Some(UncertainReason::RetirementUnavailable),
                                evidence: Some(evidence),
                                uncertain: Vec::new(),
                            }));
                        }
                    }
                }
                for attempt in &evidence.attempts {
                    run.uncertain(attempt, UncertainReason::RetirementUnavailable);
                }
                return Ok(Some(OwnedShutdownResult {
                    status: ShutdownStatus::Uncertain,
                    reason: None,
                    evidence: Some(evidence),
                    uncertain: std::mem::take(&mut run.errors),
                }));
            }
            if !run.errors.is_empty() {
                return Ok(Some(OwnedShutdownResult {
                    status: ShutdownStatus::Uncertain,
                    reason: None,
                    evidence: Some(evidence),
                    uncertain: std::mem::take(&mut run.errors),
                }));
            }
            let now = run.ports.now_ms();
            let ms = 50.min(run.deadline.saturating_sub(now).max(1));
            run.bounded(|ports, _| {
                ports.wait(ms);
                Ok(())
            })?;
        }
        Ok(None)
    }
}

/// `z.object({ evidence })` (prepared) or `z.object({ status: literal, evidence })` (preserved).
fn prepared_evidence(value: &Value, preserved: bool) -> Option<OwnedShutdownInventory> {
    let map = json::object(value).ok()?;
    if preserved
        && map.get("status").and_then(Value::as_str) != Some("leader_exited_retirement_pending")
    {
        return None;
    }
    parse_owned_shutdown_inventory(map.get("evidence")?).ok()
}
