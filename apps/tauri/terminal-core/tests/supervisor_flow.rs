//! Supervisor flow with a synthetic backend and real ed25519 proofs.
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use ed25519_dalek::{Signer, SigningKey};
use orqst_terminal_core::authority::{challenge_bytes, now_ms, Authority, Challenge};
use orqst_terminal_core::supervisor::*;
use orqst_terminal_core::types::TerminalProfile;
use std::sync::{Arc, Mutex};

#[derive(Default)]
struct Log(Vec<String>);
struct Fake(Arc<Mutex<Log>>);
struct FakeHandle(Arc<Mutex<Log>>);
impl Handle for FakeHandle {
    fn write(&mut self, t: &str) -> Result<(), String> {
        self.0.lock().unwrap().0.push(format!("write:{t}"));
        Ok(())
    }
    fn resize(&mut self, c: u16, r: u16) -> Result<(), String> {
        self.0.lock().unwrap().0.push(format!("resize:{c}x{r}"));
        Ok(())
    }
    fn signal(&mut self, s: &str) -> Result<(), String> {
        self.0.lock().unwrap().0.push(format!("signal:{s}"));
        Ok(())
    }
}
impl Backend for Fake {
    fn validate(&mut self, _p: &PreparedProfile) -> bool {
        true
    }
    fn start(&mut self, p: &PreparedProfile, _i: &Identity) -> Result<Box<dyn Handle>, String> {
        self.0
            .lock()
            .unwrap()
            .0
            .push(format!("start:{}", p.profile.id));
        Ok(Box::new(FakeHandle(self.0.clone())))
    }
}

fn profile() -> PreparedProfile {
    let profile = TerminalProfile {
        id: "synthetic-terminal-v1".into(),
        project_id: "p".into(),
        executable: "/bin/sh".into(),
        executable_sha256: "a".repeat(64),
        executable_version: "1".into(),
        argv: vec![],
        cwd: "/tmp".into(),
        environment_profile: "synthetic".into(),
        permissions: "synthetic".into(),
        cli_authorization_scope: None,
    };
    let json = serde_json::to_string(&profile).unwrap();
    PreparedProfile { profile, json }
}

fn proof(key: &SigningKey, c: &Challenge) -> serde_json::Value {
    serde_json::json!({"challengeId": c.challenge_id,
        "signature": URL_SAFE_NO_PAD.encode(key.sign(&challenge_bytes(c)).to_bytes())})
}

#[test]
fn open_attach_input_write_read_and_stop() {
    let key = SigningKey::from_bytes(&[3u8; 32]);
    let log = Arc::new(Mutex::new(Log::default()));
    let authority = Authority::new(
        vec![("desktop-managed".into(), key.verifying_key())],
        now_ms,
    )
    .unwrap();
    let mut s = Supervisor::new(
        std::rc::Rc::new(std::cell::RefCell::new(authority)),
        Box::new(Fake(log.clone())),
        vec![profile()],
        None,
        None,
    )
    .unwrap();
    let prepared = s
        .prepare("desktop-managed", "synthetic-terminal-v1")
        .unwrap();
    let id = prepared.attempt_id.clone();
    assert!(
        s.request_attach("desktop-managed", &id).is_err(),
        "attach before running"
    );
    s.launch(&id, &proof(&key, &prepared.challenge)).unwrap();
    assert_eq!(s.state(&id), Some("starting"));
    assert!(
        s.launch(&id, &proof(&key, &prepared.challenge)).is_err(),
        "one-use"
    );
    s.event(
        &id,
        BackendEvent::Started {
            started_at: Some(5),
        },
    );
    s.event(&id, BackendEvent::Data(b"hello".to_vec()));
    let c = s.request_attach("desktop-managed", &id).unwrap();
    let attachment = s.attach(&id, &proof(&key, &c)).unwrap();
    let c = s.request_input(&id, &attachment).unwrap();
    let lease = s.enable_input(&id, &attachment, &proof(&key, &c)).unwrap();
    s.write(&id, &attachment, &lease, 0, "ls\r").unwrap();
    assert!(
        s.write(&id, &attachment, &lease, 0, "x").is_err(),
        "sequence replay"
    );
    s.resize(&id, &attachment, 100, 30).unwrap();
    let read = s.read(&id, &attachment, 0).unwrap();
    assert_eq!(read.bytes, b"hello");
    let c = s.request_stop("desktop-managed", &id, "SIGTERM").unwrap();
    s.stop(&id, "SIGTERM", &proof(&key, &c)).unwrap();
    s.event(
        &id,
        BackendEvent::Exit {
            exit_code: 0,
            signal: Some(15),
            evidence: Some((5, 9)),
        },
    );
    assert_eq!(
        s.snapshot(&id).unwrap(),
        serde_json::json!({"instanceId": id, "epoch": s.authority.borrow().epoch.clone(), "state": "exited",
            "exit": {"exitCode": 0, "signal": 15}, "lifecycle": {"startedAt": 5, "exitedAt": 9}})
    );
    assert_eq!(
        log.lock().unwrap().0,
        vec![
            "start:synthetic-terminal-v1",
            "write:ls\r",
            "resize:100x30",
            "signal:SIGTERM"
        ]
    );
}

#[test]
fn a_start_without_started_evidence_becomes_uncertain() {
    let key = SigningKey::from_bytes(&[4u8; 32]);
    let log = Arc::new(Mutex::new(Log::default()));
    static NOW: std::sync::atomic::AtomicI64 = std::sync::atomic::AtomicI64::new(1_000_000);
    fn now() -> i64 {
        NOW.load(std::sync::atomic::Ordering::SeqCst)
    }
    let authority =
        Authority::new(vec![("desktop-managed".into(), key.verifying_key())], now).unwrap();
    let mut s = Supervisor::new(
        std::rc::Rc::new(std::cell::RefCell::new(authority)),
        Box::new(Fake(log)),
        vec![profile()],
        None,
        None,
    )
    .unwrap();
    let prepared = s
        .prepare("desktop-managed", "synthetic-terminal-v1")
        .unwrap();
    s.launch(&prepared.attempt_id, &proof(&key, &prepared.challenge))
        .unwrap();
    NOW.fetch_add(10_001, std::sync::atomic::Ordering::SeqCst);
    s.tick();
    assert_eq!(s.state(&prepared.attempt_id), Some("ownership_lost"));
    // Late evidence never revives an uncertain attempt.
    s.event(
        &prepared.attempt_id,
        BackendEvent::Exit {
            exit_code: 0,
            signal: Some(0),
            evidence: None,
        },
    );
    assert_eq!(s.state(&prepared.attempt_id), Some("ownership_lost"));
}
