//! SYNTHETIC golden tests for lane L6 (offline recovery of owned terminal reservations).
//! `tests/golden/recovery.ts` builds clearly-labeled synthetic reservation trees in disposable
//! temp directories with the TypeScript code and runs the TypeScript recovery on them; the Rust
//! port must produce identical snapshots (bytes), identical native review texts and fingerprints,
//! identical outcomes and identical helper IPC frames, and both implementations must accept each
//! other's durable records (capture → release → finalize across languages). Boot identities are
//! injected: the real `sysctl` is never called and real Application Support data is never used.
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use ed25519_dalek::{Signer, SigningKey, VerifyingKey};
use orqst_terminal_core::recovery::engine::{
    Dependencies, NativeAdministrativeRecovery, OfflineReservationRecovery,
};
use orqst_terminal_core::recovery::host::{serve, HostOverrides};
use orqst_terminal_core::recovery::intent::{AdminIntent, Challenge};
use orqst_terminal_core::recovery::js::stringify;
use orqst_terminal_core::recovery::snapshot::snapshot_offline_reservation;
use orqst_terminal_core::recovery::wire::{Inbound, Transport};
use orqst_terminal_core::recovery::{fsio, RecoveryError};
use serde_json::{json, Value};
use std::cell::{Cell, RefCell};
use std::collections::VecDeque;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::rc::Rc;

const BOOT_A: &str = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BOOT_B: &str = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const BOOT_C: &str = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const VARIANTS: [&str; 16] = [
    "basic",
    "wal",
    "shm",
    "enrollment",
    "lifecycle",
    "rollback",
    "retired",
    "orphan",
    "uncertain-receipt",
    "not-prepared",
    "mixed-project",
    "no-manifests",
    "duplicate",
    "bad-epoch",
    "binding-changed",
    "missing",
];

fn ts(args: &[&str]) -> Value {
    let script = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/golden/recovery.ts");
    let out = Command::new("pnpm")
        .args(["-s", "exec", "tsx"])
        .arg(&script)
        .args(args)
        .current_dir(env!("CARGO_MANIFEST_DIR"))
        .output()
        .expect("tsx (Node 24 toolchain on PATH)");
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    serde_json::from_slice(&out.stdout).unwrap()
}

fn base(name: &str) -> PathBuf {
    let base = std::env::temp_dir().canonicalize().unwrap().join(format!(
        "orqst-synthetic-recovery-{name}-{}",
        uuid::Uuid::new_v4()
    ));
    fs::create_dir_all(&base).unwrap();
    fs::set_permissions(&base, fs::Permissions::from_mode(0o700)).unwrap();
    base
}

fn p(path: &Path) -> &str {
    path.to_str().unwrap()
}

fn build(variant: &str) -> PathBuf {
    let base = base(variant);
    if variant != "missing" {
        ts(&["build", p(&base), variant]);
    } else {
        ts(&["build", p(&base), "basic"]);
        fs::remove_file(base.join("parent/managed-agents/active-pair.json")).unwrap();
    }
    base
}

fn signing_key() -> SigningKey {
    SigningKey::from_bytes(&[7u8; 32])
}

fn synthetic_uuid(seed: u32) -> Box<dyn FnMut() -> String> {
    let mut counter = 0u64;
    Box::new(move || {
        let value = format!("{seed:08x}-0000-4000-8000-{counter:012x}");
        counter += 1;
        value
    })
}

fn classify(error: &RecoveryError) -> String {
    error.classify()
}

struct TestAuthority {
    key: SigningKey,
    public: VerifyingKey,
    approve: bool,
    reviews: Vec<Value>,
}

impl NativeAdministrativeRecovery for TestAuthority {
    fn public_key(&self) -> &VerifyingKey {
        &self.public
    }
    fn review(
        &mut self,
        intent: &AdminIntent,
        full_review: &str,
        fingerprint: &str,
    ) -> orqst_terminal_core::recovery::Result<bool> {
        self.reviews.push(
            json!({"intent": intent.to_value(), "fingerprint": fingerprint, "review": full_review}),
        );
        Ok(self.approve)
    }
    fn sign(
        &mut self,
        challenge: &Challenge,
    ) -> orqst_terminal_core::recovery::Result<Option<(String, f64)>> {
        let signature = URL_SAFE_NO_PAD.encode(self.key.sign(&challenge.bytes()?).to_bytes());
        Ok(Some((signature, challenge.expires_at)))
    }
    fn revalidate(
        &mut self,
        challenge: &Challenge,
    ) -> orqst_terminal_core::recovery::Result<Option<f64>> {
        Ok(Some(challenge.expires_at))
    }
}

/// Mirror of the TypeScript `step` command.
fn rust_step(
    base: &Path,
    op: &str,
    boot: &'static str,
    approve: bool,
    seed: u32,
    bundle: Option<&str>,
) -> Value {
    let key = signing_key();
    let authority = TestAuthority {
        public: key.verifying_key(),
        key,
        approve,
        reviews: Vec::new(),
    };
    let deps = Dependencies {
        boot_uuid: Box::new(move || Ok(boot.to_owned())),
        now: Box::new(|| 1000.0),
        sync: fsio::native_sync(),
        boundary: None,
        uuid: synthetic_uuid(seed),
    };
    let mut engine = OfflineReservationRecovery::new(authority, deps);
    let parent = base.join("parent");
    let result = match op {
        "capture" => engine
            .capture(p(&parent.join("managed-agents")), p(&parent.join("administrative-recovery/bundles")), None)
            .map(|o| {
                json!({"operationId": o.operation_id, "bundle": o.bundle, "owner": o.owner, "epoch": o.epoch,
                       "beforeBoot": o.before_boot, "snapshotDigest": o.snapshot_digest})
            }),
        "continueCapture" => engine
            .continue_capture(bundle.unwrap())
            .map(|id| json!({"operationId": id, "bundle": bundle.unwrap(), "admissionBlocked": true})),
        "abort" => engine
            .abort(bundle.unwrap())
            .map(|id| json!({"operationId": id, "status": "aborted", "originalReservationPreserved": true})),
        "release" | "continueRelease" => {
            let outcome = if op == "release" { engine.release(bundle.unwrap()) } else { engine.continue_release(bundle.unwrap()) };
            outcome.map(|o| {
                let mut value = o.receipt.clone();
                value["bundle"] = json!(o.bundle);
                value["admissionBlocked"] = json!(true);
                value
            })
        }
        "finalize" => engine.finalize(bundle.unwrap()).map(|o| {
            json!({"operationId": o.operation_id, "status": "finalized", "releaseCommitted": true, "cleanup": o.cleanup})
        }),
        _ => unreachable!(),
    };
    let result = match result {
        Ok(value) => json!({"ok": value}),
        Err(error) => json!({"error": classify(&error)}),
    };
    json!({"result": result, "reviews": engine.authority().reviews})
}

fn ts_step(
    base: &Path,
    op: &str,
    boot: &str,
    approve: bool,
    seed: u32,
    bundle: Option<&str>,
) -> Value {
    let seed = seed.to_string();
    let mut args = vec![
        "step",
        p(base),
        op,
        boot,
        if approve { "1" } else { "0" },
        seed.as_str(),
    ];
    if let Some(bundle) = bundle {
        args.push(bundle);
    }
    ts(&args)
}

fn rust_snapshot(base: &Path, index: usize) -> Value {
    let scratch = base.join(format!("scratch-rs-{index}"));
    fs::create_dir(&scratch).unwrap();
    fs::set_permissions(&scratch, fs::Permissions::from_mode(0o700)).unwrap();
    let result = snapshot_offline_reservation(
        p(&base.join("parent/managed-agents")),
        p(&scratch),
        None,
        None,
        &fsio::native_sync(),
    );
    fs::remove_dir_all(&scratch).unwrap();
    match result {
        Ok(value) => json!({"ok": value}),
        Err(error) => json!({"error": classify(&error)}),
    }
}

fn ok(value: &Value) -> &Value {
    assert!(
        value["result"].get("ok").is_some(),
        "unexpected result {}",
        value["result"]
    );
    &value["result"]["ok"]
}

#[test]
fn snapshots_match_typescript_byte_for_byte() {
    for variant in VARIANTS {
        let base = build(variant);
        let expected = ts(&["snapshot", p(&base)]);
        let actual = rust_snapshot(&base, 0);
        assert_eq!(
            stringify(&actual),
            stringify(&expected),
            "variant {variant}"
        );
        let valid = ["basic", "wal", "shm", "enrollment"].contains(&variant);
        assert_eq!(
            expected.get("ok").is_some(),
            valid,
            "variant {variant}: {}",
            expected.get("error").unwrap_or(&Value::Null)
        );
        eprintln!(
            "{variant}: {}",
            expected
                .get("error")
                .map_or("ok".to_owned(), |e| e.to_string())
        );
        fs::remove_dir_all(&base).unwrap();
    }
}

#[test]
fn typescript_capture_rust_release_and_finalize() {
    let base = build("enrollment");
    let capture = ts_step(&base, "capture", BOOT_A, true, 1, None);
    let bundle = ok(&capture)["bundle"].as_str().unwrap().to_owned();
    // The same boot cannot release.
    for side in [
        ts_step(&base, "release", BOOT_A, true, 2, Some(&bundle)),
        rust_step(&base, "release", BOOT_A, true, 2, Some(&bundle)),
    ] {
        assert_eq!(
            side["result"],
            json!({"error": "Different kernel boot required"})
        );
    }
    // A denied release produces byte-identical native reviews and fingerprints.
    let ts_denied = ts_step(&base, "release", BOOT_B, false, 3, Some(&bundle));
    let rs_denied = rust_step(&base, "release", BOOT_B, false, 3, Some(&bundle));
    assert_eq!(
        ts_denied["result"],
        json!({"error": "Administrative recovery approval denied"})
    );
    assert_eq!(stringify(&rs_denied), stringify(&ts_denied));
    // Rust releases the TypeScript capture.
    let released = rust_step(&base, "release", BOOT_B, true, 4, Some(&bundle));
    assert_eq!(ok(&released)["status"], "release_prepared");
    // A repeated release needs an explicit continuation; its uncertain effect keeps the boot
    // lease, which then fences every other helper of that boot (TypeScript and Rust alike).
    let again_rs = rust_step(&base, "release", BOOT_B, true, 5, Some(&bundle));
    assert_eq!(
        again_rs["result"],
        json!({"error": "blocked:explicit_release_continuation_required"})
    );
    let again_ts = ts_step(&base, "release", BOOT_B, true, 5, Some(&bundle));
    assert_eq!(
        again_ts["result"],
        json!({"error": "blocked:same_boot_helper_fence_required"})
    );
    let fenced = rust_step(&base, "finalize", BOOT_B, true, 5, Some(&bundle));
    assert_eq!(fenced["result"], again_ts["result"]);
    // Finalize review (next kernel boot) is identical before the namespace commit.
    let ts_final = ts_step(&base, "finalize", BOOT_C, false, 6, Some(&bundle));
    let rs_final = rust_step(&base, "finalize", BOOT_C, false, 6, Some(&bundle));
    assert_eq!(
        ts_final["result"],
        json!({"error": "Administrative recovery approval denied"})
    );
    assert_eq!(stringify(&rs_final), stringify(&ts_final));
    let finalized = rust_step(&base, "finalize", BOOT_C, true, 7, Some(&bundle));
    assert_eq!(ok(&finalized)["cleanup"], "old_controls_removed");
    let directory = base.join("parent/managed-agents");
    let operation = ok(&capture)["operationId"].as_str().unwrap();
    assert!(!directory.join("active-pair.json").exists());
    assert!(directory
        .join(format!("recovered-{operation}.marker.json"))
        .exists());
    assert!(!directory.join("offline-recovery.json").exists());
    assert!(!directory.join("offline-recovery-operation.lock").exists());
    for name in [
        "capture.json",
        "snapshot.json",
        "archive.json",
        "receipt-prepared.json",
        "receipt.json",
        "finalized.json",
        "completion.json",
    ] {
        assert!(Path::new(&bundle).join(name).exists(), "{name}");
    }
    // A replay never repeats the namespace mutation, in either implementation.
    let replay_ts = ts_step(&base, "finalize", BOOT_C, true, 8, Some(&bundle));
    let replay_rs = rust_step(&base, "finalize", BOOT_C, true, 8, Some(&bundle));
    assert_eq!(
        replay_ts["result"],
        json!({"error": "blocked:already_finalized_original_commit_preserved"})
    );
    assert_eq!(
        stringify(&replay_rs["result"]),
        stringify(&replay_ts["result"])
    );
    fs::remove_dir_all(&base).unwrap();
}

#[test]
fn rust_capture_typescript_release_and_finalize() {
    let base = build("wal");
    let ts_denied = ts_step(&base, "capture", BOOT_A, false, 10, None);
    let rs_denied = rust_step(&base, "capture", BOOT_A, false, 11, None);
    // Only the fresh operation identity differs between the two denied captures.
    let normalize = |value: &Value, seed: u32| {
        stringify(&value["reviews"][0]["review"]).replace(
            &format!("{seed:08x}-0000-4000-8000-000000000000"),
            "OPERATION",
        )
    };
    assert_eq!(normalize(&rs_denied, 11), normalize(&ts_denied, 10));
    assert_eq!(rs_denied["result"], ts_denied["result"]);
    let capture = rust_step(&base, "capture", BOOT_A, true, 12, None);
    let bundle = ok(&capture)["bundle"].as_str().unwrap().to_owned();
    let released = ts_step(&base, "release", BOOT_B, true, 13, Some(&bundle));
    assert_eq!(ok(&released)["status"], "release_prepared");
    let finalized = ts_step(&base, "finalize", BOOT_B, true, 14, Some(&bundle));
    assert_eq!(ok(&finalized)["cleanup"], "old_controls_removed");
    fs::remove_dir_all(&base).unwrap();
}

#[test]
fn abort_and_source_changes_block_identically() {
    let base = build("basic");
    let capture = ts_step(&base, "capture", BOOT_A, true, 20, None);
    let bundle = ok(&capture)["bundle"].as_str().unwrap().to_owned();
    // A same-boot lease left by another helper is a fence, never adopted.
    let lease = Path::new(&bundle).join(format!("operation-{BOOT_B}.lock"));
    fs::write(&lease, "{}").unwrap();
    fs::set_permissions(&lease, fs::Permissions::from_mode(0o600)).unwrap();
    let fenced_ts = ts_step(&base, "release", BOOT_B, true, 21, Some(&bundle));
    let fenced_rs = rust_step(&base, "release", BOOT_B, true, 21, Some(&bundle));
    assert_eq!(
        fenced_ts["result"],
        json!({"error": "blocked:same_boot_helper_fence_required"})
    );
    assert_eq!(stringify(&fenced_rs), stringify(&fenced_ts));
    fs::remove_file(&lease).unwrap();
    // Abort reviews are identical; Rust performs the abort and preserves the reservation.
    let ts_abort = ts_step(&base, "abort", BOOT_A, false, 22, Some(&bundle));
    let rs_abort = rust_step(&base, "abort", BOOT_A, false, 22, Some(&bundle));
    assert_eq!(stringify(&rs_abort), stringify(&ts_abort));
    let aborted = rust_step(&base, "abort", BOOT_A, true, 23, Some(&bundle));
    assert_eq!(ok(&aborted)["status"], "aborted");
    assert!(base.join("parent/managed-agents/active-pair.json").exists());
    assert!(!base
        .join("parent/managed-agents/offline-recovery.json")
        .exists());
    for side in [
        ts_step(&base, "release", BOOT_B, true, 24, Some(&bundle)),
        rust_step(&base, "release", BOOT_B, true, 24, Some(&bundle)),
    ] {
        assert_eq!(
            side["result"],
            json!({"error": "blocked:operation_aborted_original_reservation_preserved"})
        );
    }
    // A changed source after capture blocks release in both implementations.
    let second = rust_step(&base, "capture", BOOT_A, true, 25, None);
    let bundle = ok(&second)["bundle"].as_str().unwrap().to_owned();
    let manifest = base.join("manifests/a.json");
    let mut text = fs::read_to_string(&manifest).unwrap();
    text.push(' ');
    fs::write(&manifest, text).unwrap();
    let changed_ts = ts_step(&base, "release", BOOT_B, true, 26, Some(&bundle));
    let changed_rs = rust_step(&base, "release", BOOT_B, true, 26, Some(&bundle));
    assert_eq!(stringify(&changed_rs), stringify(&changed_ts));
    assert!(changed_ts["result"].get("error").is_some());
    assert!(base.join("parent/managed-agents/active-pair.json").exists());
    fs::remove_dir_all(&base).unwrap();
}

/// In-memory native side: mirrors the scripted native of the TypeScript `host` command.
struct ScriptTransport {
    plan: VecDeque<Value>,
    frames: Rc<RefCell<Vec<Value>>>,
    queue: VecDeque<Value>,
    approve: Rc<Cell<bool>>,
    session: String,
    id: u64,
}

impl Transport for ScriptTransport {
    fn send(&mut self, value: &Value) {
        self.frames.borrow_mut().push(json!(["out", value]));
        match value["kind"].as_str() {
            Some("ready") => self.session = value["session"].as_str().unwrap().to_owned(),
            Some("review") => {
                let reply = json!({"kind":"answer","session":value["session"],"id":value["id"],"nonce":value["nonce"],
                                   "digest":value["digest"],"approved":self.approve.get()});
                self.frames.borrow_mut().push(json!(["in", reply]));
                self.queue.push_back(reply);
            }
            Some("authorize") => {
                let reply = json!({"kind":"authorized","session":value["session"],"id":value["id"],"nonce":value["nonce"],
                                   "digest":value["digest"],"requestNonce":value["requestNonce"],
                                   "proofDigest":value["proofDigest"],"remainingMs":30000});
                self.frames.borrow_mut().push(json!(["in", reply]));
                self.queue.push_back(reply);
            }
            _ => {}
        }
    }
    fn recv(&mut self, _deadline: f64) -> Inbound {
        if let Some(reply) = self.queue.pop_front() {
            return Inbound::Frame(reply);
        }
        let Some(step) = self.plan.pop_front() else {
            return Inbound::Closed;
        };
        self.approve.set(step["approve"].as_bool().unwrap());
        self.id += 1;
        let request = json!({"kind":"action","session":self.session,"id":self.id,"action":step["action"],"bundle":step["bundle"]});
        self.frames.borrow_mut().push(json!(["in", request]));
        Inbound::Frame(request)
    }
    fn now(&self) -> f64 {
        1000.0
    }
    fn close(&mut self) {}
}

fn rust_host(base: &Path, boot: &'static str, seed: u32, plan: &Value) -> Value {
    let frames = Rc::new(RefCell::new(Vec::new()));
    let transport = ScriptTransport {
        plan: plan.as_array().unwrap().iter().cloned().collect(),
        frames: frames.clone(),
        queue: VecDeque::new(),
        approve: Rc::new(Cell::new(false)),
        session: String::new(),
        id: 0,
    };
    let overrides = HostOverrides {
        boot_uuid: Some(Box::new(move || Ok(boot.to_owned()))),
        sync: None,
        uuid: Some(synthetic_uuid(seed)),
    };
    serve(p(&base.join("parent")), None, transport, overrides);
    let frames = frames.borrow().clone();
    json!({"frames": frames})
}

#[test]
fn helper_ipc_frames_match_typescript() {
    let base = build("enrollment");
    let bundles = base.join("parent/administrative-recovery/bundles");
    // Denied capture over the helper protocol: identical frames until the bundle identity.
    let capture_plan = json!([{"action":"capture","bundle":null,"approve":true}]);
    let ts_capture = ts(&["host", p(&base), BOOT_A, "30", &capture_plan.to_string()]);
    let complete = ts_capture["frames"]
        .as_array()
        .unwrap()
        .last()
        .unwrap()
        .clone();
    assert_eq!(complete[1]["outcome"], "captured", "{complete}");
    let bundle = fs::read_dir(&bundles)
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    let bundle = p(&bundle).to_owned();
    // Release denied, then a malformed (bundle-less) release: identical frames.
    let plan = json!([
        {"action":"release","bundle":bundle,"approve":false},
        {"action":"release","bundle":null,"approve":true},
        {"action":"bogus","bundle":null,"approve":true}
    ]);
    let ts_frames = ts(&["host", p(&base), BOOT_B, "31", &plan.to_string()]);
    let rs_frames = rust_host(&base, BOOT_B, 31, &plan);
    assert_eq!(stringify(&rs_frames), stringify(&ts_frames));
    let kinds: Vec<String> = ts_frames["frames"]
        .as_array()
        .unwrap()
        .iter()
        .map(|f| f[1]["kind"].as_str().unwrap().to_owned())
        .collect();
    assert_eq!(
        kinds,
        [
            "ready", "action", "review", "answer", "complete", "action", "complete", "action",
            "complete"
        ]
    );
    // Rust helper releases; the finalize review frames match; Rust helper finalizes.
    let release = json!([{"action":"release","bundle":bundle,"approve":true}]);
    let released = rust_host(&base, BOOT_B, 32, &release);
    assert_eq!(
        released["frames"].as_array().unwrap().last().unwrap()[1]["outcome"],
        "release_prepared"
    );
    let deny = json!([{"action":"finalize","bundle":bundle,"approve":false}]);
    let ts_deny = ts(&["host", p(&base), BOOT_B, "33", &deny.to_string()]);
    let rs_deny = rust_host(&base, BOOT_B, 33, &deny);
    assert_eq!(stringify(&rs_deny), stringify(&ts_deny));
    let finalize = json!([{"action":"finalize","bundle":bundle,"approve":true}]);
    let done = rust_host(&base, BOOT_B, 34, &finalize);
    assert_eq!(
        done["frames"].as_array().unwrap().last().unwrap()[1]["outcome"],
        "finalized"
    );
    fs::remove_dir_all(&base).unwrap();
}

#[test]
fn rust_installed_anchor_loads_in_typescript() {
    let base = base("anchor");
    let parent = base.join("parent");
    fs::create_dir(&parent).unwrap();
    fs::set_permissions(&parent, fs::Permissions::from_mode(0o700)).unwrap();
    let plan = json!([{"action":"install","bundle":null,"approve":true}, {"action":"install","bundle":null,"approve":true}]);
    let frames = rust_host(&base, BOOT_A, 40, &plan);
    let completes: Vec<Value> = frames["frames"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|f| f[1]["kind"] == "complete")
        .map(|f| f[1].clone())
        .collect();
    assert_eq!(completes[0]["outcome"], "installed");
    assert_eq!(completes[1]["status"], "blocked");
    let loaded = ts(&["anchor", p(&parent)]);
    assert_eq!(
        loaded["ok"]["directory"],
        json!(p(&parent.join("administrative-recovery/anchor")))
    );
    fs::remove_dir_all(&base).unwrap();
}
