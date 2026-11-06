//! Port of `managed-pair.ts`: one owner, a bounded team of independent slots sharing one
//! authority. No provider semantics are inferred from PTY text.
use crate::authority::{terminal_digest, Binding};
use crate::journal::Journal;
use crate::rpc::Request;
use crate::supervisor::{
    Backend, Handle, Identity, PreparedProfile, Shared, StartBinding, Supervisor,
};
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
    /// `reserveEnrollment({ input, manifestFile, member })`: durable exclusive record; the
    /// returned finisher writes the receipt once.
    fn reserve_enrollment(
        &mut self,
        _input: &Value,
        _manifest_file: &str,
        _member: &Value,
    ) -> R<EnrollmentFinish> {
        Err("Incremental admission unavailable".into())
    }
}

/// Writes the enrollment receipt once (`reserveEnrollment`'s returned finisher).
pub type EnrollmentFinish = Box<dyn FnMut(&Value) -> R<()>>;

/// What `enroll`'s inspection returns: the member metadata (without slot, revision, status)
/// in `inspectTerminalEnrollment` key order and the slot factory (may open a journal).
pub struct EnrollmentCandidate {
    pub member: Map<String, Value>,
    pub create: Box<dyn FnOnce(usize) -> R<Slot>>,
}

const MAX_SAFE: u64 = 9_007_199_254_740_991;

fn is_uuid_text(value: &str) -> bool {
    crate::rpc::is_uuid(&Value::String(value.to_owned()))
}

/// `terminalEnrollmentInputSchema.parse` (strict), in schema key order.
pub fn parse_enrollment_input(raw: &Value) -> R<Map<String, Value>> {
    let object = raw.as_object().ok_or("Invalid enrollment input")?;
    let keys = [
        "version",
        "epoch",
        "opId",
        "expectedRevision",
        "workspaceId",
        "featureId",
    ];
    if object.len() != keys.len() || !keys.iter().all(|k| object.contains_key(*k)) {
        return Err("Invalid enrollment input".into());
    }
    let valid = object["version"].as_u64() == Some(1)
        && object["version"].is_u64()
        && object["epoch"].as_str().is_some_and(is_uuid_text)
        && object["opId"].as_str().is_some_and(is_uuid_text)
        && object["expectedRevision"]
            .as_u64()
            .is_some_and(|r| r <= MAX_SAFE)
        && object["workspaceId"]
            .as_str()
            .is_some_and(crate::authority::is_digest)
        && (object["featureId"].is_null()
            || object["featureId"].as_str().is_some_and(is_uuid_text));
    if !valid {
        return Err("Invalid enrollment input".into());
    }
    Ok(keys
        .iter()
        .map(|k| ((*k).to_owned(), object[*k].clone()))
        .collect())
}

/// `terminalEnrollmentMemberSchema` validation; returns the member in schema key order.
pub fn member_schema_order(member: &Map<String, Value>) -> R<Value> {
    let keys = [
        "slot",
        "terminalId",
        "alias",
        "provider",
        "requestedModel",
        "workspaceId",
        "featureId",
        "admissionRevision",
        "bindingDigest",
        "status",
    ];
    if member.keys().any(|k| !keys.contains(&k.as_str())) {
        return Err("Invalid enrollment member".into());
    }
    let text = |k: &str| member.get(k).and_then(Value::as_str);
    let length = |v: &str, max: usize| (1..=max).contains(&v.encode_utf16().count());
    let valid = member
        .get("slot")
        .and_then(Value::as_u64)
        .is_some_and(|s| s < 8)
        && text("terminalId").is_some_and(is_uuid_text)
        && member
            .get("alias")
            .is_none_or(|a| a.as_str().is_some_and(|a| length(a, 128)))
        && text("provider").is_some_and(|p| ["codex", "claude", "opencode"].contains(&p))
        && member
            .get("requestedModel")
            .is_none_or(|m| m.is_null() || m.as_str().is_some_and(|m| length(m, 160)))
        && text("workspaceId").is_some_and(crate::authority::is_digest)
        && member
            .get("featureId")
            .is_some_and(|f| f.is_null() || f.as_str().is_some_and(is_uuid_text))
        && member
            .get("admissionRevision")
            .and_then(Value::as_u64)
            .is_some_and(|r| r <= MAX_SAFE)
        && text("bindingDigest").is_some_and(crate::authority::is_digest)
        && text("status").is_some_and(|s| s == "ready" || s == "uncertain");
    if !valid {
        return Err("Invalid enrollment member".into());
    }
    Ok(Value::Object(
        keys.iter()
            .filter_map(|k| member.get(*k).map(|v| ((*k).to_owned(), v.clone())))
            .collect(),
    ))
}

/// `terminalEnrollmentReceiptSchema.parse` output order (refinement checked by construction).
pub fn receipt_schema_order(receipt: &Value) -> R<Value> {
    let object = receipt.as_object().ok_or("Invalid enrollment receipt")?;
    let mut out = Map::new();
    for key in [
        "version",
        "epoch",
        "opId",
        "expectedRevision",
        "workspaceId",
        "featureId",
        "revision",
        "status",
        "reason",
    ] {
        out.insert(
            key.into(),
            object
                .get(key)
                .cloned()
                .ok_or("Invalid enrollment receipt")?,
        );
    }
    let member = match object.get("member") {
        Some(Value::Object(member)) => member_schema_order(member)?,
        _ => Value::Null,
    };
    out.insert("member".into(), member);
    Ok(Value::Object(out))
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
    revision: u64,
    /// opId -> (request key, receipt as recorded, insertion order).
    enrollments: Vec<(String, String, Value)>,
    enrolled: Vec<Map<String, Value>>,
}

impl Pair {
    pub fn new(
        authority: Shared,
        slots: Vec<Slot>,
        admission: Box<dyn Admission>,
        capacity: usize,
    ) -> R<Pair> {
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
            revision: 0,
            enrollments: Vec::new(),
            enrolled: Vec::new(),
        };
        for slot in slots {
            let supervisor = pair.supervisor(slot, None)?;
            pair.slots.push(Some(supervisor));
            pair.attempts.push(Vec::new());
        }
        Ok(pair)
    }

    fn supervisor(&self, slot: Slot, binding: Option<StartBinding>) -> R<Supervisor> {
        let backend = PairBackend {
            inner: slot.backend,
            state: self.state.clone(),
        };
        Supervisor::new(
            self.authority.clone(),
            Box::new(backend),
            slot.profiles,
            Some(slot.journal),
            binding,
        )
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
        if self.slots.get(slot).and_then(Option::as_ref).is_none() {
            return Err("Unknown terminal slot".into());
        }
        if self.uncertain_slot(slot) {
            return Err("Terminal enrollment uncertain".into());
        }
        let supervisor = self
            .slots
            .get_mut(slot)
            .and_then(Option::as_mut)
            .ok_or("Unknown terminal slot")?;
        {
            let state = self.state.borrow();
            if state.reserved && request.operation != "snapshot" {
                state.admission.assert_owner()?;
            }
        }
        let a = |i: usize| request.args.get(i).cloned().unwrap_or(Value::Null);
        let s = |i: usize| {
            request
                .args
                .get(i)
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_owned()
        };
        let n = |i: usize| request.args.get(i).and_then(Value::as_i64).unwrap_or(-1);
        let value = match request.operation.as_str() {
            "prepare" => {
                let prepared = supervisor.prepare(&s(0), &s(1))?;
                self.attempts[slot].push(prepared.attempt_id.clone());
                let profile: Value =
                    serde_json::from_str(&prepared.profile.json).map_err(|e| e.to_string())?;
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
            "requestPaste" => Some(json!(supervisor.request_paste(
                &s(0),
                &s(1),
                &s(2),
                n(3),
                &s(4)
            )?)),
            "paste" => supervisor
                .paste(&s(0), &s(1), &s(2), n(3), &s(4), &a(5))
                .map(|_| None)?,
            "requestStop" => Some(json!(supervisor.request_stop(&s(0), &s(1), &s(2))?)),
            "stop" => supervisor.stop(&s(0), &s(1), &a(2)).map(|_| None)?,
            "write" => supervisor
                .write(&s(0), &s(1), &s(2), n(3), &s(4))
                .map(|_| None)?,
            "resize" => supervisor.resize(&s(0), &s(1), n(2), n(3)).map(|_| None)?,
            "read" => {
                let cursor = request
                    .args
                    .get(2)
                    .and_then(Value::as_u64)
                    .unwrap_or(u64::MAX);
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
        let snapshot = self.slots[slot]
            .as_mut()
            .ok_or("Unknown terminal slot")?
            .snapshot(id)?;
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
        if self.any_uncertain() {
            return Err("Uncertain enrollment retains terminal capacity".into());
        }
        self.assert_journals()?;
        let attempts = self.all_snapshots()?;
        let dispatched = self.state.borrow().dispatched.clone();
        let unreleased = attempts.iter().any(|a| {
            let state = a["state"].as_str().unwrap_or("");
            !["prepared", "exited", "start_failed"].contains(&state)
                || (a["instanceId"]
                    .as_str()
                    .is_some_and(|id| dispatched.contains(id))
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
        let challenge = self
            .authority
            .borrow_mut()
            .prepare("desktop-managed", &binding)?;
        Ok(json!({"evidence": evidence, "challenge": challenge}))
    }

    pub fn retire(&mut self, proof: &Value) -> R<()> {
        let evidence = self.evidence()?;
        let binding = self.retire_binding(&evidence);
        self.authority.borrow_mut().consume(proof, &binding)?;
        if self.finish.is_none() {
            let finish = self
                .state
                .borrow_mut()
                .admission
                .prepare_release(&evidence)?;
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

    fn uncertain_slot(&self, slot: usize) -> bool {
        self.enrolled
            .iter()
            .any(|m| m["slot"].as_u64() == Some(slot as u64) && m["status"] != "ready")
    }

    fn any_uncertain(&self) -> bool {
        self.enrolled.iter().any(|m| m["status"] != "ready")
    }

    /// `enrollmentInspect(opId)`: read-only. Members are the enrolled ones (insertion order);
    /// the receipt is the recorded one, if any.
    pub fn enrollment_inspect(&self, op_id: Option<&str>) -> R<Value> {
        self.state.borrow().active()?;
        let receipt = op_id
            .and_then(|op| self.enrollments.iter().find(|(id, _, _)| id == op))
            .map(|(_, _, receipt)| receipt.clone())
            .unwrap_or(Value::Null);
        Ok(json!({
            "version": 1,
            "epoch": self.authority.borrow().epoch,
            "revision": self.revision,
            "capacity": self.capacity,
            "reservedSlots": self.slots.len(),
            "members": self.enrolled.iter().cloned().map(Value::Object).collect::<Vec<_>>(),
            "receipt": receipt,
        }))
    }

    /// Port of `ManagedTerminalPair.enroll`: append one slot on this owner. Inspection is
    /// read-only; `create` may open a journal. After the effect boundary nothing is rolled
    /// back, released, retried, signalled or adopted. Returns the receipt in insertion order
    /// (the durable record order); the host reorders it for the reply.
    pub fn enroll(
        &mut self,
        raw: &Value,
        manifest_file: &str,
        inspect: impl FnOnce() -> R<EnrollmentCandidate>,
    ) -> R<Value> {
        self.state.borrow().active()?;
        let input = parse_enrollment_input(raw)?;
        if input["epoch"].as_str() != Some(self.authority.borrow().epoch.as_str()) {
            return Err("Enrollment epoch changed".into());
        }
        let op_id = input["opId"].as_str().unwrap_or_default().to_owned();
        let key = terminal_digest(
            serde_json::to_string(&json!([Value::Object(input.clone()), manifest_file]))
                .map_err(|e| e.to_string())?
                .as_bytes(),
        );
        if let Some((_, previous_key, receipt)) =
            self.enrollments.iter().find(|(id, _, _)| *id == op_id)
        {
            if *previous_key != key {
                return Err("Enrollment operation rebound".into());
            }
            return Ok(receipt.clone());
        }
        if self.enrollments.len() >= 128 {
            return Err("Enrollment operation budget exceeded".into());
        }
        let receipt = |revision: u64, status: &str, reason: &str, member: Value| {
            let mut out = input.clone();
            out.insert("revision".into(), revision.into());
            out.insert("status".into(), status.into());
            out.insert("reason".into(), reason.into());
            out.insert("member".into(), member);
            Value::Object(out)
        };
        let rejected = |pair: &mut Pair, reason: &str| {
            let value = receipt(pair.revision, "rejected", reason, Value::Null);
            pair.enrollments
                .push((op_id.clone(), key.clone(), value.clone()));
            Ok(value)
        };
        if input["expectedRevision"].as_u64() != Some(self.revision) {
            return rejected(self, "revision_conflict");
        }
        if self.slots.len() >= self.capacity {
            return rejected(self, "capacity");
        }
        if self.any_uncertain() {
            return rejected(self, "effect_uncertain");
        }
        let slot = self.slots.len();
        let candidate = (|| -> R<EnrollmentCandidate> {
            self.state.borrow_mut().admission.preflight()?;
            let candidate = inspect()?;
            let mut check = candidate.member.clone();
            check.insert("slot".into(), slot.into());
            check.insert("admissionRevision".into(), (self.revision + 1).into());
            check.insert("status".into(), "uncertain".into());
            member_schema_order(&check)?;
            if candidate.member.get("workspaceId") != input.get("workspaceId")
                || candidate.member.get("featureId") != input.get("featureId")
            {
                return Err("Enrollment scope changed".into());
            }
            Ok(candidate)
        })();
        let Ok(candidate) = candidate else {
            return rejected(self, "invalid_profile");
        };
        // Enter the effect boundary. Partial file/journal writes retain this UUID/slot.
        self.revision += 1;
        let mut member = candidate.member;
        member.insert("slot".into(), slot.into());
        member.insert("admissionRevision".into(), self.revision.into());
        member.insert("status".into(), "uncertain".into());
        self.slots.push(None);
        self.attempts.push(Vec::new());
        self.enrolled.push(member.clone());
        let index = self.enrolled.len() - 1;
        let mut finish: Option<EnrollmentFinish> = None;
        let mut receipt_attempted = false;
        let outcome = (|| -> R<Value> {
            {
                let mut state = self.state.borrow_mut();
                state.reserved = true;
                state.admission.claim()?;
                finish = Some(state.admission.reserve_enrollment(
                    &Value::Object(input.clone()),
                    manifest_file,
                    &Value::Object(member.clone()),
                )?);
            }
            let created = (candidate.create)(slot)?;
            let digest = member["bindingDigest"]
                .as_str()
                .unwrap_or_default()
                .to_owned();
            let supervisor = self.supervisor(
                created,
                Some(StartBinding {
                    binding_digest: digest,
                    admission_revision: self.revision as i64,
                }),
            )?;
            self.slots[slot] = Some(supervisor);
            let mut ready = member.clone();
            ready.insert("status".into(), "ready".into());
            let value = receipt(self.revision, "ready", "admitted", Value::Object(ready));
            receipt_attempted = true;
            (finish.as_mut().unwrap())(&value)?;
            self.enrolled[index].insert("status".into(), "ready".into());
            Ok(value)
        })();
        let value = match outcome {
            Ok(value) => value,
            Err(_) => {
                let value = receipt(
                    self.revision,
                    "uncertain",
                    "effect_uncertain",
                    Value::Object(member),
                );
                if let (Some(finish), false) = (finish.as_mut(), receipt_attempted) {
                    let _ = finish(&value); // Preserve partial evidence, never retry.
                }
                value
            }
        };
        self.enrollments.push((op_id, key, value.clone()));
        Ok(value)
    }
}

fn supervisor_journal(supervisor: &Supervisor) -> Option<&Journal> {
    supervisor.journal()
}
