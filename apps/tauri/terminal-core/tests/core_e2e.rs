//! End-to-end over the pair-RPC JSON contract with a real PTY (/bin/sh), a real journal
//! and signed proofs. Synthetic profile and admission; no provider CLI, no user data.
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use ed25519_dalek::{Signer, SigningKey};
use orqst_terminal_core::authority::{challenge_bytes, now_ms, Authority, Challenge};
use orqst_terminal_core::backend::{PtyBackend, Receipt, SlotProfiles};
use orqst_terminal_core::core::{events, Core, CoreEvent, NoExtensions, Startup};
use orqst_terminal_core::journal::Journal;
use orqst_terminal_core::pair::{Admission, Pair, Slot};
use orqst_terminal_core::store::Store;
use orqst_terminal_core::supervisor::{Identity, PreparedProfile};
use orqst_terminal_core::types::TerminalProfile;
use serde_json::{json, Value};
use std::cell::RefCell;
use std::rc::Rc;
use std::time::{Duration, Instant};

struct SyntheticReceipt;
impl Receipt for SyntheticReceipt {
    fn started(&mut self) -> Result<i64, String> { Ok(now_ms()) }
    fn spawn_failed(&mut self) -> Result<(), String> { Ok(()) }
    fn exit(&mut self, _c: Option<i64>, _s: Option<&str>) -> Result<i64, String> { Ok(now_ms()) }
}
struct SyntheticProfiles;
impl SlotProfiles for SyntheticProfiles {
    fn validate(&mut self, _p: &PreparedProfile) -> bool { true }
    fn environment(&self, _p: &PreparedProfile) -> Result<Vec<(String, String)>, String> {
        Ok(vec![("PATH".into(), "/usr/bin:/bin".into())])
    }
    fn receipt(&mut self, _i: &Identity) -> Result<Box<dyn Receipt>, String> { Ok(Box::new(SyntheticReceipt)) }
}
struct SyntheticAdmission;
impl Admission for SyntheticAdmission {
    fn claim(&mut self) -> Result<(), String> { Ok(()) }
    fn assert_owner(&self) -> Result<(), String> { Ok(()) }
    fn prepare_release(&mut self, _e: &Value) -> Result<Box<dyn FnMut() -> Result<(), String>>, String> {
        Ok(Box::new(|| Ok(())))
    }
}

fn sign(key: &SigningKey, challenge: &Value) -> Value {
    let c: Challenge = Challenge {
        version: 1,
        epoch: challenge["epoch"].as_str().unwrap().into(),
        client_id: challenge["clientId"].as_str().unwrap().into(),
        challenge_id: challenge["challengeId"].as_str().unwrap().into(),
        expires_at: challenge["expiresAt"].as_i64().unwrap(),
        operation: challenge["operation"].as_str().unwrap().into(),
        target: challenge["target"].as_str().unwrap().into(),
        digest: challenge["digest"].as_str().unwrap().into(),
    };
    json!({"challengeId": c.challenge_id, "signature": URL_SAFE_NO_PAD.encode(key.sign(&challenge_bytes(&c)).to_bytes())})
}

#[test]
fn pair_rpc_drives_a_real_owned_pty() {
    let base = std::env::temp_dir().join(format!("orqst-synthetic-core-{}", uuid::Uuid::new_v4()));
    let key = SigningKey::from_bytes(&[9u8; 32]);
    let authority = Rc::new(RefCell::new(Authority::new(vec![("desktop-managed".into(), key.verifying_key())], now_ms).unwrap()));
    let epoch = authority.borrow().epoch.clone();
    let journal = Journal::open(Store::open(&base.join("terminal.sqlite")).unwrap(), &epoch, false, now_ms).unwrap();
    let profile = TerminalProfile {
        id: "codex-terminal-v1".into(), project_id: "p".into(), executable: "/bin/sh".into(),
        executable_sha256: "a".repeat(64), executable_version: "synthetic".into(),
        argv: vec!["-c".into(), "read line; echo got=$line; exit 4".into()], cwd: "/tmp".into(),
        environment_profile: "synthetic".into(), permissions: "synthetic".into(), cli_authorization_scope: None,
    };
    let json_text = serde_json::to_string(&profile).unwrap();
    let (sender, receiver) = events();
    let backend = PtyBackend::new(0, Box::new(SyntheticProfiles), env!("CARGO_BIN_EXE_orqst-terminal-core").into(), sender.clone());
    let slot = Slot { profiles: vec![PreparedProfile { profile, json: json_text }], backend: Box::new(backend), journal };
    let pair = Pair::new(authority, vec![slot], Box::new(SyntheticAdmission), 8).unwrap();
    let mut core = Core::new(Startup { ready: json!({}), pair, opencode: false }, Box::new(NoExtensions));
    let call = |core: &mut Core, operation: &str, args: Value| -> Value {
        let id = uuid::Uuid::new_v4().to_string();
        let reply = core.handle(&json!({"kind": "terminal", "slot": 0, "request": {"id": id, "operation": operation, "args": args}})).expect("valid");
        assert_eq!(reply["id"], id);
        assert_eq!(reply["ok"], true, "{operation}: {reply}");
        reply["value"].clone()
    };
    let pump = |core: &mut Core, until: &dyn Fn(&mut Core) -> bool| {
        let deadline = Instant::now() + Duration::from_secs(10);
        while !until(core) {
            assert!(Instant::now() < deadline, "timeout");
            if let Ok(CoreEvent::Backend(d)) = receiver.recv_timeout(Duration::from_millis(50)) {
                core.backend(d);
            }
        }
    };
    let prepared = call(&mut core, "prepare", json!(["desktop-managed", "codex-terminal-v1"]));
    let id = prepared["attemptId"].as_str().unwrap().to_owned();
    assert_eq!(prepared["profile"]["argv"][0], "-c");
    assert_eq!(call(&mut core, "launch", json!([id, sign(&key, &prepared["challenge"])])), Value::Null);
    let state = |core: &mut Core, id: &str| {
        let r = core.handle(&json!({"kind": "terminal", "slot": 0, "request": {"id": uuid::Uuid::new_v4().to_string(), "operation": "snapshot", "args": [id]}})).unwrap();
        r["value"]["state"].as_str().unwrap().to_owned()
    };
    pump(&mut core, &|c| state(c, &id) == "running");
    let challenge = call(&mut core, "requestAttach", json!(["desktop-managed", id]));
    let attachment = call(&mut core, "attach", json!([id, sign(&key, &challenge)]));
    let challenge = call(&mut core, "requestInput", json!([id, attachment]));
    let lease = call(&mut core, "enableInput", json!([id, attachment, sign(&key, &challenge)]));
    call(&mut core, "write", json!([id, attachment, lease, 0, "hi\r"]));
    pump(&mut core, &|c| state(c, &id) == "exited");
    let snapshot = call(&mut core, "snapshot", json!([id]));
    assert_eq!(snapshot["exit"], json!({"exitCode": 4, "signal": 0}));
    assert!(snapshot["lifecycle"]["exitedAt"].as_i64().unwrap() >= snapshot["lifecycle"]["startedAt"].as_i64().unwrap());
    let read = call(&mut core, "read", json!([id, attachment, 0]));
    let bytes: Vec<u8> = read["bytes"].as_array().unwrap().iter().map(|b| b.as_u64().unwrap() as u8).collect();
    assert!(String::from_utf8_lossy(&bytes).contains("got=hi"), "{}", String::from_utf8_lossy(&bytes));
    // Invalid request shape is a protocol violation (host shuts the Core down).
    assert!(core.handle(&json!({"kind": "terminal", "slot": 0, "request": {"id": "x", "operation": "snapshot", "args": [id]}})).is_none());
    // Retirement: exits are owned, so the signed retire succeeds once.
    let r = core.handle(&json!({"kind": "prepareRetire", "id": uuid::Uuid::new_v4().to_string()})).unwrap();
    assert_eq!(r["ok"], true, "{r}");
    let proof = sign(&key, &r["value"]["challenge"]);
    let r = core.handle(&json!({"kind": "retire", "id": uuid::Uuid::new_v4().to_string(), "proof": proof})).unwrap();
    assert_eq!(r["ok"], true, "{r}");
    std::fs::remove_dir_all(base).unwrap();
}
