//! `Pair::enroll` / `enrollment_inspect` (port of `ManagedTerminalPair.enroll`) with a
//! SYNTHETIC admission and a synthetic slot. No provider CLI, no user data, nothing launched.
use ed25519_dalek::SigningKey;
use orqst_terminal_core::authority::{now_ms, Authority};
use orqst_terminal_core::journal::Journal;
use orqst_terminal_core::pair::{Admission, EnrollmentCandidate, EnrollmentFinish, Pair, Slot};
use orqst_terminal_core::store::Store;
use orqst_terminal_core::supervisor::{Backend, Handle, Identity, PreparedProfile};
use serde_json::{json, Map, Value};
use std::cell::RefCell;
use std::rc::Rc;

struct NoBackend;
impl Backend for NoBackend {
    fn validate(&mut self, _p: &PreparedProfile) -> bool {
        false
    }
    fn start(&mut self, _p: &PreparedProfile, _i: &Identity) -> Result<Box<dyn Handle>, String> {
        Err("synthetic".into())
    }
}

#[derive(Default)]
struct Log(Rc<RefCell<Vec<Value>>>);
impl Admission for Log {
    fn claim(&mut self) -> Result<(), String> {
        Ok(())
    }
    fn assert_owner(&self) -> Result<(), String> {
        Ok(())
    }
    fn prepare_release(
        &mut self,
        _e: &Value,
    ) -> Result<Box<dyn FnMut() -> Result<(), String>>, String> {
        Ok(Box::new(|| Ok(())))
    }
    fn reserve_enrollment(
        &mut self,
        input: &Value,
        manifest: &str,
        member: &Value,
    ) -> Result<EnrollmentFinish, String> {
        self.0
            .borrow_mut()
            .push(json!({"input": input, "manifestFile": manifest, "member": member}));
        let log = self.0.clone();
        Ok(Box::new(move |receipt| {
            log.borrow_mut().push(json!({"receipt": receipt}));
            Ok(())
        }))
    }
}

fn slot(base: &std::path::Path, name: &str, epoch: &str) -> Slot {
    let journal = Journal::open(
        Store::open(&base.join(name).join("terminal.sqlite")).unwrap(),
        epoch,
        false,
        now_ms,
    )
    .unwrap();
    Slot {
        profiles: Vec::new(),
        backend: Box::new(NoBackend),
        journal,
    }
}

#[test]
fn enrollment_receipts_revisions_and_idempotency() {
    let base = std::fs::canonicalize(std::env::temp_dir())
        .unwrap()
        .join(format!("orqst-synthetic-enroll-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&base).unwrap();
    let key = SigningKey::from_bytes(&[3u8; 32]).verifying_key();
    let authority = Rc::new(RefCell::new(
        Authority::new(vec![("desktop-managed".into(), key)], now_ms).unwrap(),
    ));
    let epoch = authority.borrow().epoch.clone();
    let log = Rc::new(RefCell::new(Vec::new()));
    let mut pair = Pair::new(
        authority,
        vec![slot(&base, "a", &epoch)],
        Box::new(Log(log.clone())),
        2,
    )
    .unwrap();
    let workspace = "c".repeat(64);
    let input = |op: &str, revision: u64| json!({"version": 1, "epoch": epoch, "opId": op, "expectedRevision": revision, "workspaceId": workspace, "featureId": null});
    let terminal = uuid::Uuid::new_v4().to_string();
    let member = || {
        let mut m = Map::new();
        m.insert("terminalId".into(), terminal.clone().into());
        m.insert("alias".into(), format!("P-{terminal}").into());
        m.insert("provider".into(), "codex".into());
        m.insert("requestedModel".into(), Value::Null);
        m.insert("workspaceId".into(), workspace.clone().into());
        m.insert("featureId".into(), Value::Null);
        m.insert("bindingDigest".into(), "d".repeat(64).into());
        m
    };
    // Revision conflict is rejected without effects.
    let op1 = uuid::Uuid::new_v4().to_string();
    let r = pair
        .enroll(&input(&op1, 5), "/synthetic/b.json", || {
            panic!("not inspected")
        })
        .unwrap();
    assert_eq!(
        (r["status"].as_str(), r["reason"].as_str(), &r["member"]),
        (Some("rejected"), Some("revision_conflict"), &Value::Null)
    );
    // Invalid profile: the inspection refuses.
    let op2 = uuid::Uuid::new_v4().to_string();
    let r = pair
        .enroll(&input(&op2, 0), "/synthetic/b.json", || {
            Err("synthetic refusal".into())
        })
        .unwrap();
    assert_eq!(r["reason"], "invalid_profile");
    assert!(log.borrow().is_empty());
    // Admitted: slot 1, revision 1, durable record then receipt.
    let op3 = uuid::Uuid::new_v4().to_string();
    let base2 = base.clone();
    let epoch2 = epoch.clone();
    let r = pair
        .enroll(&input(&op3, 0), "/synthetic/b.json", || {
            Ok(EnrollmentCandidate {
                member: member(),
                create: Box::new(move |_| Ok(slot(&base2, "b", &epoch2))),
            })
        })
        .unwrap();
    assert_eq!(
        (
            r["status"].as_str(),
            r["reason"].as_str(),
            r["revision"].as_u64()
        ),
        (Some("ready"), Some("admitted"), Some(1))
    );
    let keys: Vec<&str> = r["member"]
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    assert_eq!(
        keys,
        [
            "terminalId",
            "alias",
            "provider",
            "requestedModel",
            "workspaceId",
            "featureId",
            "bindingDigest",
            "slot",
            "admissionRevision",
            "status"
        ]
    );
    assert_eq!(log.borrow()[0]["member"]["status"], "uncertain");
    assert_eq!(log.borrow()[1]["receipt"], r);
    assert_eq!(pair.len(), 2);
    // Same opId and request: the recorded receipt, no new effect. Rebinding is refused.
    assert_eq!(
        pair.enroll(&input(&op3, 0), "/synthetic/b.json", || panic!(
            "idempotent"
        ))
        .unwrap(),
        r
    );
    assert!(pair
        .enroll(&input(&op3, 0), "/synthetic/other.json", || panic!(
            "rebound"
        ))
        .is_err());
    // Capacity is exhausted.
    let op4 = uuid::Uuid::new_v4().to_string();
    assert_eq!(
        pair.enroll(&input(&op4, 1), "/synthetic/c.json", || panic!("full"))
            .unwrap()["reason"],
        "capacity"
    );
    let inspection = pair.enrollment_inspect(Some(&op3)).unwrap();
    assert_eq!(
        (
            inspection["revision"].as_u64(),
            inspection["reservedSlots"].as_u64()
        ),
        (Some(1), Some(2))
    );
    assert_eq!(inspection["members"].as_array().unwrap().len(), 1);
    assert_eq!(inspection["receipt"], r);
    // Wrong epoch is an error, not a receipt.
    let mut wrong = input(&uuid::Uuid::new_v4().to_string(), 1);
    wrong["epoch"] = uuid::Uuid::new_v4().to_string().into();
    assert!(pair
        .enroll(&wrong, "/synthetic/d.json", || panic!("epoch"))
        .is_err());
    std::fs::remove_dir_all(base).unwrap();
}

#[test]
fn failed_slot_creation_leaves_an_uncertain_reservation() {
    let base = std::fs::canonicalize(std::env::temp_dir())
        .unwrap()
        .join(format!("orqst-synthetic-enroll-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&base).unwrap();
    let key = SigningKey::from_bytes(&[4u8; 32]).verifying_key();
    let authority = Rc::new(RefCell::new(
        Authority::new(vec![("desktop-managed".into(), key)], now_ms).unwrap(),
    ));
    let epoch = authority.borrow().epoch.clone();
    let log = Rc::new(RefCell::new(Vec::new()));
    let mut pair = Pair::new(
        authority,
        vec![slot(&base, "a", &epoch)],
        Box::new(Log(log.clone())),
        3,
    )
    .unwrap();
    let op = uuid::Uuid::new_v4().to_string();
    let input = json!({"version": 1, "epoch": epoch, "opId": op, "expectedRevision": 0, "workspaceId": "c".repeat(64), "featureId": null});
    let mut member = Map::new();
    member.insert("terminalId".into(), uuid::Uuid::new_v4().to_string().into());
    member.insert("provider".into(), "claude".into());
    member.insert("workspaceId".into(), "c".repeat(64).into());
    member.insert("featureId".into(), Value::Null);
    member.insert("bindingDigest".into(), "e".repeat(64).into());
    let r = pair
        .enroll(&input, "/synthetic/x.json", || {
            Ok(EnrollmentCandidate {
                member,
                create: Box::new(|_| Err("synthetic journal failure".into())),
            })
        })
        .unwrap();
    assert_eq!(
        (r["status"].as_str(), r["reason"].as_str()),
        (Some("uncertain"), Some("effect_uncertain"))
    );
    // The uncertain receipt was written once; the slot is reserved but unusable.
    assert_eq!(log.borrow().len(), 2);
    let request = orqst_terminal_core::rpc::parse(&json!({"id": uuid::Uuid::new_v4().to_string(), "operation": "snapshot", "args": [uuid::Uuid::new_v4().to_string()]})).unwrap();
    assert!(pair.dispatch(1, &request).is_err());
    let next = json!({"version": 1, "epoch": input["epoch"], "opId": uuid::Uuid::new_v4().to_string(), "expectedRevision": 1, "workspaceId": "c".repeat(64), "featureId": null});
    assert_eq!(
        pair.enroll(&next, "/synthetic/y.json", || panic!("blocked"))
            .unwrap()["reason"],
        "effect_uncertain"
    );
    assert!(pair.owned_exit_evidence().is_err());
    std::fs::remove_dir_all(base).unwrap();
}
