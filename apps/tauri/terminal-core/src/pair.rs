//! Port of `managed-pair.ts`: one owner, a bounded team of independent slots sharing one
//! authority. No provider semantics are inferred from PTY text.
use crate::authority::{terminal_digest, Binding};
use crate::rpc::Request;
use crate::supervisor::{Backend, Handle, Identity, PreparedProfile, Shared, StartBinding, Supervisor};
use crate::journal::Journal;
use serde_json::{json, Map, Value};
use std::cell::RefCell;
use std::collections::HashSet;
use std::rc::Rc;

type R<T> = Result<T, String>;

/// `TerminalPairAdmission` (desktop admission marker). Implemented by `admission` (lane L3).
pub trait Admission {
    fn preflight(&mut self) -> R<()> {
        Ok(())
    }
    fn claim(&mut self) -> R<()>;
    fn assert_owner(&self) -> R<()>;
    /// Validates the release against `evidence`; the returned step performs it once.
    fn prepare_release(&mut self, evidence: &Value) -> R<Box<dyn FnMut() -> R<()>>>;
}

pub struct Slot {
    pub profiles: Vec<PreparedProfile>,
    pub backend: Box<dyn Backend>,
    pub journal: Journal,
}

struct State {
    admission: Box<dyn Admission>,
    reserved: bool,
    fenced: bool,
    retired: bool,
    dispatched: HashSet<String>,
}

impl State {
    fn active(&self) -> R<()> {
        if self.fenced || self.retired {
            return Err("Terminal pair is fenced".into());
        }
        Ok(())
    }
}

/// Wraps a slot backend with the pair's admission checks (`managed-pair.ts` supervisor()).
struct PairBackend {
    inner: Box<dyn Backend>,
    state: Rc<RefCell<State>>,
}

impl Backend for PairBackend {
    fn preflight(&mut self) -> R<()> {
        self.state.borrow().active()?;
        self.inner.preflight()?;
        let mut state = self.state.borrow_mut();
        state.admission.preflight()?;
        if state.reserved {
            state.admission.assert_owner()?;
        }
        Ok(())
    }

    fn validate(&mut self, profile: &PreparedProfile) -> bool {
        self.inner.validate(profile)
    }

    fn start(&mut self, profile: &PreparedProfile, identity: &Identity) -> R<Box<dyn Handle>> {
        {
            let mut state = self.state.borrow_mut();
            state.active()?;
            // The supervisor consumed the native proof and durably recorded starting first.
            state.admission.claim()?;
            state.reserved = true;
            state.admission.assert_owner()?;
            state.dispatched.insert(identity.instance_id.clone());
        }
        self.inner.start(profile, identity)
    }
}

pub struct Pair {
    authority: Shared,
    slots: Vec<Option<Supervisor>>,
    attempts: Vec<Vec<String>>,
    state: Rc<RefCell<State>>,
    retirement: Option<Value>,
    finish: Option<Box<dyn FnMut() -> R<()>>>,
    pub capacity: usize,
}

impl Pair {
    pub fn new(authority: Shared, slots: Vec<Slot>, admission: Box<dyn Admission>, capacity: usize) -> R<Pair> {
        if slots.is_empty() || slots.len() > capacity {
            return Err("Terminal slots exceed configured capacity".into());
        }
        let state = Rc::new(RefCell::new(State {
            admission,
            reserved: false,
            fenced: false,
            retired: false,
            dispatched: HashSet::new(),
        }));
        let mut pair = Pair {
            authority,
            slots: Vec::new(),
            attempts: Vec::new(),
            state,
            retirement: None,
            finish: None,
            capacity,
        };
        for slot in slots {
            let supervisor = pair.supervisor(slot, None)?;
            pair.slots.push(Some(supervisor));
            pair.attempts.push(Vec::new());
        }
        Ok(pair)
    }

    fn supervisor(&self, slot: Slot, binding: Option<StartBinding>) -> R<Supervisor> {
        let backend = PairBackend { inner: slot.backend, state: self.state.clone() };
        Supervisor::new(self.authority.clone(), Box::new(backend), slot.profiles, Some(slot.journal), binding)
    }

    pub fn len(&self) -> usize {
        self.slots.len()
    }

    pub fn is_empty(&self) -> bool {
        self.slots.is_empty()
    }

    pub fn supervisor_mut(&mut self, slot: usize) -> Option<&mut Supervisor> {
        self.slots.get_mut(slot).and_then(Option::as_mut)
    }

    /// Returns `Ok(None)` for operations without a value (the reply omits `value`).
    pub fn dispatch(&mut self, slot: usize, request: &Request) -> R<Option<Value>> {
        self.state.borrow().active()?;
        let supervisor = self.slots.get_mut(slot).and_then(Option::as_mut).ok_or("Unknown terminal slot")?;
        {
            let state = self.state.borrow();
            if state.reserved && request.operation != "snapshot" {
                state.admission.assert_owner()?;
            }
        }
        let a = |i: usize| request.args.get(i).cloned().unwrap_or(Value::Null);
        let s = |i: usize| request.args.get(i).and_then(Value::as_str).unwrap_or("").to_owned();
        let n = |i: usize| request.args.get(i).and_then(Value::as_i64).unwrap_or(-1);
        let value = match request.operation.as_str() {
            "prepare" => {
                let prepared = supervisor.prepare(&s(0), &s(1))?;
                self.attempts[slot].push(prepared.attempt_id.clone());
                let profile: Value = serde_json::from_str(&prepared.profile.json).map_err(|e| e.to_string())?;
                let policy: Value = serde_json::from_str(crate::supervisor::POLICY_JSON).unwrap();
                Some(json!({
                    "attemptId": prepared.attempt_id,
                    "profile": profile,
                    "policy": policy,
                    "challenge": prepared.challenge,
                }))
            }
            "launch" => supervisor.launch(&s(0), &a(1)).map(|_| None)?,
            "snapshot" => Some(supervisor.snapshot(&s(0))?),
            "canvasSessionEvidence" => Some(supervisor.canvas_session_evidence(&s(0))?),
            "requestAttach" => Some(json!(supervisor.request_attach(&s(0), &s(1))?)),
            "attach" => Some(Value::from(supervisor.attach(&s(0), &a(1))?)),
            "requestInput" => Some(json!(supervisor.request_input(&s(0), &s(1))?)),
            "enableInput" => Some(Value::from(supervisor.enable_input(&s(0), &s(1), &a(2))?)),
            "requestPaste" => Some(json!(supervisor.request_paste(&s(0), &s(1), &s(2), n(3), &s(4))?)),
            "paste" => supervisor.paste(&s(0), &s(1), &s(2), n(3), &s(4), &a(5)).map(|_| None)?,
            "requestStop" => Some(json!(supervisor.request_stop(&s(0), &s(1), &s(2))?)),
            "stop" => supervisor.stop(&s(0), &s(1), &a(2)).map(|_| None)?,
            "write" => supervisor.write(&s(0), &s(1), &s(2), n(3), &s(4)).map(|_| None)?,
            "resize" => supervisor.resize(&s(0), &s(1), n(2), n(3)).map(|_| None)?,
            "read" => {
                let cursor = request.args.get(2).and_then(Value::as_u64).unwrap_or(u64::MAX);
                let read = supervisor.read(&s(0), &s(1), cursor)?;
                Some(json!({"bytes": read.bytes, "nextCursor": read.next_cursor, "gap": read.gap}))
            }
            "detach" => supervisor.detach(&s(0), &s(1)).map(|_| None)?,
            "revokeInput" => supervisor.revoke_input(&s(0), &s(1)).map(|_| None)?,
            _ => return Err("Unknown terminal operation".into()),
        };
        Ok(value)
    }

    fn authority_snapshot(&mut self, slot: usize, id: &str) -> R<Value> {
        let snapshot = self.slots[slot].as_mut().ok_or("Unknown terminal slot")?.snapshot(id)?;
        let mut out = Map::new();
        out.insert("slot".into(), slot.into());
        for key in ["instanceId", "epoch", "state", "exit"] {
            if let Some(value) = snapshot.get(key) {
                out.insert(key.into(), value.clone());
            }
        }
        Ok(out.into())
    }

    fn all_snapshots(&mut self) -> R<Vec<Value>> {
        let mut attempts = Vec::new();
        for slot in 0..self.attempts.len() {
            for id in self.attempts[slot].clone() {
                attempts.push(self.authority_snapshot(slot, &id)?);
            }
        }
        Ok(attempts)
    }

    fn assert_journals(&self) -> R<()> {
        for supervisor in self.slots.iter().flatten() {
            if let Some(journal) = supervisor_journal(supervisor) {
                journal.assert_owner()?;
            }
        }
        Ok(())
    }

    fn evidence(&mut self) -> R<Value> {
        {
            let state = self.state.borrow();
            if !state.reserved || state.retired {
                return Err("No retirable terminal reservation".into());
            }
            state.admission.assert_owner()?;
        }
        if let Some(evidence) = &self.retirement {
            return Ok(evidence.clone());
        }
        self.assert_journals()?;
        let attempts = self.all_snapshots()?;
        let dispatched = self.state.borrow().dispatched.clone();
        let unreleased = attempts.iter().any(|a| {
            let state = a["state"].as_str().unwrap_or("");
            !["prepared", "exited", "start_failed"].contains(&state)
                || (a["instanceId"].as_str().is_some_and(|id| dispatched.contains(id))
                    && (state != "exited" || a.get("exit").is_none()))
        });
        if unreleased {
            return Err("Every dispatched terminal requires its owned exit".into());
        }
        Ok(json!({"epoch": self.authority.borrow().epoch, "attempts": attempts}))
    }

    /// Native shutdown inventory only: checks ownership, never stops or releases anything.
    pub fn owned_shutdown_inventory(&mut self) -> R<Value> {
        self.state.borrow().active()?;
        {
            let state = self.state.borrow();
            if state.reserved {
                state.admission.assert_owner()?;
            }
        }
        self.assert_journals()?;
        let attempts = self.all_snapshots()?;
        Ok(json!({"epoch": self.authority.borrow().epoch, "attempts": attempts}))
    }

    pub fn owned_exit_evidence(&mut self) -> R<Value> {
        self.evidence()
    }

    fn retire_binding(&self, evidence: &Value) -> Binding {
        Binding {
            operation: "retire".into(),
            target: self.authority.borrow().epoch.clone(),
            digest: terminal_digest(serde_json::to_string(evidence).unwrap().as_bytes()),
        }
    }

    pub fn prepare_retire(&mut self) -> R<Value> {
        let evidence = self.evidence()?;
        let binding = self.retire_binding(&evidence);
        let challenge = self.authority.borrow_mut().prepare("desktop-managed", &binding)?;
        Ok(json!({"evidence": evidence, "challenge": challenge}))
    }

    pub fn retire(&mut self, proof: &Value) -> R<()> {
        let evidence = self.evidence()?;
        let binding = self.retire_binding(&evidence);
        self.authority.borrow_mut().consume(proof, &binding)?;
        if self.finish.is_none() {
            let finish = self.state.borrow_mut().admission.prepare_release(&evidence)?;
            self.retirement = Some(evidence);
            self.finish = Some(finish);
            self.close(); // Fence all dispatch before releasing shared capacity.
        }
        (self.finish.as_mut().unwrap())()?;
        self.state.borrow_mut().retired = true;
        Ok(())
    }

    pub fn close_slot(&mut self, slot: usize) {
        if let Some(Some(supervisor)) = self.slots.get_mut(slot) {
            supervisor.shutdown();
        }
    }

    pub fn close(&mut self) {
        if self.state.borrow().fenced {
            return;
        }
        self.state.borrow_mut().fenced = true;
        for supervisor in self.slots.iter_mut().flatten() {
            supervisor.shutdown();
        }
    }

    pub fn reserved(&self) -> bool {
        self.state.borrow().reserved
    }
}

fn supervisor_journal(supervisor: &Supervisor) -> Option<&Journal> {
    supervisor.journal()
}
