//! SYNTHETIC golden tests for lane L3: the Rust admission, exit-pending, retirement, startup
//! failure, owned shutdown and lifecycle receipt ports produce the same files (byte for byte)
//! and the same refusals as the TypeScript functions driven by `tests/golden/admission.ts`.
//! Every directory is a disposable temp directory; real Application Support data is never used.
use orqst_terminal_core::admission::enrollment::terminal_digest;
use orqst_terminal_core::admission::enrollment::terminal_enrollment_preimage;
use orqst_terminal_core::admission::error::AdmissionError;
use orqst_terminal_core::admission::exit_pending::{
    inspect_pending_owned_exits, preserve_owned_exit_pending, read_owned_exit_pending,
};
use orqst_terminal_core::admission::json::stringify;
use orqst_terminal_core::admission::lifecycle_receipt::{
    arm_lifecycle_receipt, assert_lifecycle_config, create_lifecycle_receipt,
    read_lifecycle_receipt, LifecycleBinding, LifecycleEvent, LifecycleReceiptRead,
};
use orqst_terminal_core::admission::marker::{
    inspect_desktop_admission, AdmissionSources, DesktopAdmission, DesktopAdmissionContext,
};
use orqst_terminal_core::admission::owned_shutdown::{
    parse_owned_shutdown_inventory, OwnedShutdownAttempt, OwnedShutdownPorts,
    OwnedTerminalShutdown, PortFailure,
};
use orqst_terminal_core::admission::startup_failure::{
    core_startup_failure_message, terminal_startup_host_failure, TerminalPreparationFailure,
};
use orqst_terminal_core::admission::RefusalCode;
use serde_json::{json, Value};
use std::collections::VecDeque;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::process::Command;

const OWNER: &str = "11111111-1111-4111-8111-111111111111";
const EPOCH: &str = "22222222-2222-4222-8222-222222222222";
const ARCHIVE: &str = "33333333-3333-4333-8333-333333333333";
const OP: &str = "44444444-4444-4444-8444-444444444444";
const A: &str = "55555555-5555-4555-8555-555555555555";
const B: &str = "66666666-6666-4666-8666-666666666666";
const OWNER2: &str = "77777777-7777-4777-8777-777777777777";
const TERMINAL: &str = "88888888-8888-4888-8888-888888888888";
const T0: u64 = 1_700_000_000_000;

fn manifests() -> Vec<String> {
    vec!["/synthetic/a.json".into(), "/synthetic/b.json".into()]
}

#[derive(Default)]
struct Steps(Vec<Value>);
impl Steps {
    fn step(&mut self, name: &str, result: Result<Value, AdmissionError>) {
        self.0.push(match result {
            Ok(value) => json!([name, "ok", value]),
            Err(error) => json!([name, error.classify()]),
        });
    }
    fn unit(&mut self, name: &str, result: Result<(), AdmissionError>) {
        self.step(name, result.map(|()| Value::Null));
    }
}

fn files(dir: &Path) -> Value {
    let mut names: Vec<String> = fs::read_dir(dir)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .filter(|name| !name.starts_with('.'))
        .collect();
    names.sort();
    let mut map = serde_json::Map::new();
    for name in names {
        let text = fs::read(dir.join(&name))
            .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
            .unwrap_or_else(|_| "<unreadable>".into());
        map.insert(name, Value::String(text));
    }
    Value::Object(map)
}

fn shape(text: &str) -> Value {
    let values: Vec<Value> = serde_json::from_str(text).unwrap();
    Value::String(stringify(&Value::Array(
        values
            .into_iter()
            .map(|value| match value.as_str() {
                Some(s)
                    if s.trim_start_matches('-')
                        .bytes()
                        .all(|b| b.is_ascii_digit())
                        && !s.is_empty() =>
                {
                    json!("N")
                }
                _ => value,
            })
            .collect(),
    )))
}

fn sources(uuids: &[&str], now: u64) -> AdmissionSources {
    let mut queue: VecDeque<String> = uuids.iter().map(|s| s.to_string()).collect();
    AdmissionSources {
        uuid: Box::new(move || queue.pop_front().expect("synthetic uuid sequence")),
        now_ms: Box::new(move || now),
    }
}

fn write_private(path: &Path, bytes: &[u8]) {
    let mut file = OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(path)
        .unwrap();
    file.write_all(bytes).unwrap();
}

fn evidence() -> Value {
    json!({
        "epoch": EPOCH,
        "attempts": [
            { "slot": 0, "instanceId": A, "epoch": EPOCH, "state": "exited", "exit": { "exitCode": 0 } },
            { "slot": 1, "instanceId": B, "epoch": EPOCH, "state": "prepared" },
        ],
    })
}

/// Runs the TypeScript scenario in `<base>/ts`, returning its JSON with paths mapped to `rs`.
fn typescript(scenario: &str, base: &Path) -> Value {
    let ts = base.join("ts");
    let rs = base.join("rs");
    for dir in [&ts, &rs] {
        fs::create_dir_all(dir).unwrap();
        fs::set_permissions(dir, fs::Permissions::from_mode(0o700)).unwrap();
    }
    let script = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/golden/admission.ts");
    let out = Command::new("pnpm")
        .args(["-s", "exec", "tsx"])
        .arg(&script)
        .arg(scenario)
        .arg(&ts)
        .current_dir(env!("CARGO_MANIFEST_DIR"))
        .output()
        .expect("tsx (Node 24 toolchain on PATH)");
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let text = String::from_utf8(out.stdout)
        .unwrap()
        .replace(ts.to_str().unwrap(), rs.to_str().unwrap());
    serde_json::from_str(&text).unwrap()
}

fn base(scenario: &str) -> PathBuf {
    let base = std::env::temp_dir().canonicalize().unwrap().join(format!(
        "orqst-synthetic-admission-{scenario}-{}",
        uuid::Uuid::new_v4()
    ));
    fs::create_dir_all(&base).unwrap();
    base
}

fn assert_same(scenario: &str, base: &Path, expected: Value, actual: Value) {
    if expected != actual {
        let pretty = |v: &Value| serde_json::to_string_pretty(v).unwrap();
        panic!(
            "{scenario}: TypeScript\n{}\nRust\n{}",
            pretty(&expected),
            pretty(&actual)
        );
    }
    fs::remove_dir_all(base).unwrap();
}

#[test]
fn marker_enrollment_and_retirement_match_typescript() {
    let base = base("marker");
    let expected = typescript("marker", &base);
    let dir = base.join("rs/managed-agents");
    let mut steps = Steps::default();
    let mut admission = DesktopAdmission::open_with(
        &dir,
        &manifests(),
        Some(EPOCH),
        sources(&[OWNER, ARCHIVE], T0 + 5),
    )
    .unwrap();
    steps.step("open", Ok(json!(admission.owner())));
    steps.unit("assertBeforeClaim", admission.assert_owner());
    steps.unit("preflight", admission.preflight());
    steps.unit("claim", admission.claim());
    steps.unit("claimAgain", admission.claim());
    steps.unit("preflightClaimed", admission.preflight());
    steps.step(
        "secondOpen",
        DesktopAdmission::open(&dir, &manifests(), Some(EPOCH)).map(|a| json!(a.owner())),
    );
    let context = DesktopAdmissionContext {
        owner: OWNER.into(),
        epoch: EPOCH.into(),
        initial_files: manifests(),
    };
    steps.step(
        "inspectCurrent",
        inspect_desktop_admission(&dir, Some(&context)).map(|s| shape(&s)),
    );
    let other = DesktopAdmissionContext {
        initial_files: vec!["/synthetic/other.json".into()],
        ..context
    };
    steps.step(
        "inspectOtherFiles",
        inspect_desktop_admission(&dir, Some(&other)).map(Value::String),
    );
    let input = json!({
        "version": 1, "epoch": EPOCH, "opId": OP, "expectedRevision": 0,
        "workspaceId": "c".repeat(64), "featureId": null,
    });
    let member = |status: &str| {
        json!({
            "terminalId": TERMINAL, "alias": format!("P-{TERMINAL}"), "provider": "codex",
            "requestedModel": "synthetic-model", "workspaceId": "c".repeat(64), "featureId": null,
            "bindingDigest": "d".repeat(64), "slot": 2, "admissionRevision": 1, "status": status,
        })
    };
    let reservation =
        admission.reserve_enrollment(&input, "/synthetic/c.json", &member("uncertain"));
    let reservation = match reservation {
        Ok(reservation) => {
            steps.step("reserveEnrollment", Ok(Value::Null));
            reservation
        }
        Err(error) => panic!("reserve: {error}"),
    };
    let mut receipt = input.clone();
    let map = receipt.as_object_mut().unwrap();
    map.insert("revision".into(), json!(1));
    map.insert("status".into(), json!("ready"));
    map.insert("reason".into(), json!("admitted"));
    map.insert("member".into(), member("ready"));
    steps.unit(
        "finishEnrollment",
        admission.finish_enrollment(&reservation, &receipt),
    );
    steps.step(
        "reserveDuplicate",
        admission
            .reserve_enrollment(&input, "/synthetic/c.json", &member("uncertain"))
            .map(|_| Value::Null),
    );
    let mut release_evidence = evidence();
    let map = release_evidence.as_object_mut().unwrap();
    map.insert("note".into(), json!("synthetic \u{2028} \"q\" é"));
    map.insert("ratio".into(), json!(1.5));
    let release = admission.prepare_release(&release_evidence);
    steps.step(
        "prepareRelease",
        release
            .as_ref()
            .map(|_| Value::Null)
            .map_err(|e| AdmissionError::Invalid(e.to_string())),
    );
    steps.unit("finishRelease", admission.finish_release(&release.unwrap()));
    steps.unit("claimRetired", admission.claim());
    steps.unit("preflightRetired", admission.preflight());
    steps.unit("assertRetired", admission.assert_owner());
    let actual = json!({ "results": steps.0, "files": files(&dir) });
    assert_same("marker", &base, expected, actual);
}

#[test]
fn admission_refusals_match_typescript() {
    let base = base("refusals");
    let expected = typescript("refusals", &base);
    let rs = base.join("rs");
    let dir = rs.join("managed-agents");
    let absent = rs.join("absent");
    let mut steps = Steps::default();
    steps.step(
        "inspectAbsent",
        inspect_desktop_admission(&absent, None).map(|s| shape(&s)),
    );
    let trailing = PathBuf::from(format!("{}/", absent.display()));
    steps.step(
        "inspectAbsentTrailing",
        inspect_desktop_admission(&trailing, None).map(Value::String),
    );
    let context = DesktopAdmissionContext {
        owner: OWNER.into(),
        epoch: EPOCH.into(),
        initial_files: manifests(),
    };
    steps.step(
        "inspectAbsentWithContext",
        inspect_desktop_admission(&absent, Some(&context)).map(Value::String),
    );
    fs::create_dir(&dir).unwrap();
    fs::set_permissions(&dir, fs::Permissions::from_mode(0o700)).unwrap();
    steps.step(
        "inspectEmpty",
        inspect_desktop_admission(&dir, None).map(|s| shape(&s)),
    );
    let bad = DesktopAdmissionContext {
        owner: "x".into(),
        ..context
    };
    steps.step(
        "badContext",
        inspect_desktop_admission(&dir, Some(&bad)).map(Value::String),
    );
    let marker = dir.join("active-pair.json");
    let line = |value: Value| stringify(&value) + "\n";
    let cases: Vec<(&str, String, Option<u32>)> = vec![
        ("garbage", "not json\n".into(), None),
        (
            "extraKey",
            line(json!({"version": 1, "owner": OWNER, "manifests": manifests(), "extra": 1})),
            None,
        ),
        (
            "badVersion",
            line(json!({"version": 2, "owner": OWNER, "manifests": manifests()})),
            None,
        ),
        (
            "relativeManifest",
            line(json!({"version": 1, "owner": OWNER, "manifests": ["a"]})),
            None,
        ),
        (
            "groupReadable",
            line(json!({"version": 1, "owner": OWNER, "manifests": manifests()})),
            Some(0o640),
        ),
        (
            "floatVersion",
            format!("{{\"version\":1.0,\"owner\":\"{OWNER}\",\"manifests\":[]}}"),
            None,
        ),
        (
            "duplicateKey",
            format!("{{\"version\":1,\"owner\":\"bad\",\"owner\":\"{OWNER}\",\"manifests\":[]}}"),
            None,
        ),
        (
            "noEpoch",
            line(json!({"version": 1, "owner": OWNER, "manifests": manifests()})),
            None,
        ),
    ];
    for (name, content, mode) in cases {
        write_private(&marker, content.as_bytes());
        if let Some(mode) = mode {
            fs::set_permissions(&marker, fs::Permissions::from_mode(mode)).unwrap();
        }
        steps.step(
            name,
            inspect_desktop_admission(&dir, None).map(Value::String),
        );
        steps.step(
            &format!("{name}Open"),
            DesktopAdmission::open(&dir, &manifests(), Some(EPOCH)).map(|a| json!(a.owner())),
        );
        fs::remove_file(&marker).unwrap();
    }
    std::os::unix::fs::symlink("/synthetic/target", &marker).unwrap();
    steps.step(
        "symlinkMarker",
        inspect_desktop_admission(&dir, None).map(Value::String),
    );
    fs::remove_file(&marker).unwrap();
    write_private(&dir.join("offline-recovery.json"), b"{}");
    steps.step(
        "offlineGate",
        inspect_desktop_admission(&dir, None).map(Value::String),
    );
    steps.step(
        "offlineGateOpen",
        DesktopAdmission::open(&dir, &manifests(), None).map(|a| json!(a.owner())),
    );
    fs::remove_file(dir.join("offline-recovery.json")).unwrap();
    let mut admission =
        DesktopAdmission::open_with(&dir, &manifests(), None, sources(&[OWNER], T0)).unwrap();
    write_private(&dir.join("offline-recovery-operation.lock"), b"");
    steps.unit("claimWithLock", admission.claim());
    steps.unit("preflightWithLock", admission.preflight());
    fs::remove_file(dir.join("offline-recovery-operation.lock")).unwrap();
    write_private(&marker, b"foreign\n");
    steps.unit("preflightForeign", admission.preflight());
    steps.unit("claimForeign", admission.claim());
    steps.unit("preserveWithoutEpoch", admission.preserve_pending_exit());
    let actual = json!({ "results": steps.0, "files": files(&dir) });
    assert_same("refusals", &base, expected, actual);
}

#[test]
fn exit_pending_matches_typescript() {
    let base = base("exit-pending");
    let expected = typescript("exit-pending", &base);
    let rs = base.join("rs");
    let dir = rs.join("managed-agents");
    let mut steps = Steps::default();
    let mut admission =
        DesktopAdmission::open_with(&dir, &manifests(), Some(EPOCH), sources(&[OWNER], T0))
            .unwrap();
    steps.unit("claim", admission.claim());
    let attempts = json!([
        { "exit": { "signal": 15, "exitCode": -1.0 }, "state": "exited", "epoch": EPOCH, "instanceId": A, "slot": 0 },
        { "slot": 1, "instanceId": B, "epoch": EPOCH, "state": "start_failed" },
    ]);
    let record = |attempts: Value| {
        json!({
            "evidence": { "attempts": attempts, "epoch": EPOCH },
            "owner": OWNER,
            "status": "leader_exited_retirement_pending",
            "version": 1,
        })
    };
    let assert = || admission.assert_owner();
    let to_value = |r: Result<_, AdmissionError>| {
        r.map(|record: orqst_terminal_core::admission::OwnedExitPending| {
            serde_json::to_value(record).unwrap()
        })
    };
    let running = json!([{ "slot": 0, "instanceId": A, "epoch": EPOCH, "state": "running" }]);
    steps.step(
        "invalidRunning",
        to_value(preserve_owned_exit_pending(&dir, &record(running), &assert)),
    );
    steps.step(
        "readMissing",
        read_owned_exit_pending(&dir, OWNER, EPOCH)
            .map(|r| r.map_or(Value::Null, |r| serde_json::to_value(r).unwrap())),
    );
    steps.unit("detachWithoutMarker", admission.preserve_pending_exit());
    steps.step(
        "preserve",
        to_value(preserve_owned_exit_pending(
            &dir,
            &record(attempts.clone()),
            &assert,
        )),
    );
    steps.step(
        "preserveSame",
        to_value(preserve_owned_exit_pending(
            &dir,
            &record(attempts.clone()),
            &assert,
        )),
    );
    let first = json!([attempts[0].clone()]);
    steps.step(
        "preserveChanged",
        to_value(preserve_owned_exit_pending(&dir, &record(first), &assert)),
    );
    let read = |owner: &str, epoch: &str| {
        read_owned_exit_pending(&dir, owner, epoch)
            .map(|r| r.map_or(Value::Null, |r| serde_json::to_value(r).unwrap()))
    };
    steps.step("readOtherEpoch", read(OWNER, OWNER2));
    steps.step("readBadOwner", read("nope", EPOCH));
    steps.step(
        "inspectBefore",
        inspect_desktop_admission(&dir, None).map(Value::String),
    );
    let notices =
        |path: &Path| inspect_pending_owned_exits(path).map(|n| serde_json::to_value(n).unwrap());
    steps.step("pendingBefore", notices(&dir));
    steps.unit("detach", admission.preserve_pending_exit());
    steps.unit("detachAgain", admission.preserve_pending_exit());
    steps.step("pendingAfter", notices(&dir));
    steps.step("pendingAbsentDir", notices(&rs.join("absent")));
    steps.step(
        "reopen",
        DesktopAdmission::open_with(&dir, &manifests(), Some(EPOCH), sources(&[OWNER2], T0))
            .map(|a| json!(a.owner())),
    );
    let _ = &mut admission;
    let actual = json!({ "results": steps.0, "files": files(&dir) });
    assert_same("exit-pending", &base, expected, actual);
}

fn read_json(read: LifecycleReceiptRead) -> Value {
    match read {
        LifecycleReceiptRead::Missing => json!({ "status": "missing" }),
        LifecycleReceiptRead::Invalid => json!({ "status": "invalid" }),
        LifecycleReceiptRead::Incomplete { header, records } => {
            json!({ "status": "incomplete", "header": header, "records": records })
        }
        LifecycleReceiptRead::RecordedExit { header, records } => {
            json!({ "status": "recorded_exit", "header": header, "records": records })
        }
    }
}

#[test]
fn lifecycle_receipts_match_typescript() {
    let base = base("lifecycle");
    let expected = typescript("lifecycle", &base);
    let rs = base.join("rs");
    let state = rs.join("state");
    fs::create_dir(&state).unwrap();
    fs::set_permissions(&state, fs::Permissions::from_mode(0o700)).unwrap();
    let binding = |instance: &str| LifecycleBinding {
        instance_id: instance.into(),
        epoch: EPOCH.into(),
        manifest_digest: "f".repeat(64),
        config_digest: "e".repeat(64),
    };
    let digest = "e".repeat(64);
    let mut steps = Steps::default();
    let file = create_lifecycle_receipt(&state, &binding(A), T0).unwrap();
    steps.step("create", Ok(Value::Null));
    steps.step(
        "createAgain",
        create_lifecycle_receipt(&state, &binding(A), T0).map(|_| Value::Null),
    );
    steps.step(
        "wrongConfig",
        assert_lifecycle_config(&file, &"0".repeat(64)).map(|_| Value::Null),
    );
    steps.step(
        "readPrepared",
        Ok(read_json(read_lifecycle_receipt(&state, &binding(A)))),
    );
    let again = file.try_clone().unwrap();
    let mut recorder = arm_lifecycle_receipt(file, &digest, T0 - 10).unwrap();
    steps.step("arm", Ok(Value::Null));
    steps.step(
        "armAgain",
        arm_lifecycle_receipt(again, &digest, T0 - 10).map(|_| Value::Null),
    );
    let exit = |code: Option<i64>, signal: Option<&str>| LifecycleEvent::Exit {
        code,
        signal: signal.map(str::to_owned),
    };
    steps.unit(
        "exitBeforeStart",
        recorder.record(exit(Some(1), None), T0 + 20),
    );
    steps.unit("started", recorder.record(LifecycleEvent::Started, T0 + 20));
    steps.unit("badExit", recorder.record(exit(None, None), T0 + 20));
    steps.unit(
        "exit",
        recorder.record(exit(None, Some("SIGTERM")), T0 + 21),
    );
    steps.unit(
        "afterExit",
        recorder.record(LifecycleEvent::Started, T0 + 21),
    );
    steps.step(
        "readExit",
        Ok(read_json(read_lifecycle_receipt(&state, &binding(A)))),
    );
    let second = create_lifecycle_receipt(&state, &binding(B), T0 + 21).unwrap();
    steps.step("create2", Ok(Value::Null));
    let mut recorder2 = arm_lifecycle_receipt(second, &digest, T0 + 21).unwrap();
    steps.unit(
        "spawnFailed",
        recorder2.record(LifecycleEvent::SpawnFailed, T0 + 21),
    );
    steps.step(
        "readSpawnFailed",
        Ok(read_json(read_lifecycle_receipt(&state, &binding(B)))),
    );
    steps.step(
        "readMissing",
        Ok(read_json(read_lifecycle_receipt(&state, &binding(OWNER2)))),
    );
    let other = LifecycleBinding {
        config_digest: "1".repeat(64),
        ..binding(B)
    };
    steps.step(
        "readOtherBinding",
        Ok(read_json(read_lifecycle_receipt(&state, &other))),
    );
    let bad = LifecycleBinding {
        epoch: "x".into(),
        ..binding(B)
    };
    steps.step(
        "readBadBinding",
        Ok(read_json(read_lifecycle_receipt(&state, &bad))),
    );
    write_private(
        &state.join(format!("lifecycle-{OWNER}.jsonl")),
        b"{\"type\":\"prepared\"}",
    );
    steps.step(
        "readPartial",
        Ok(read_json(read_lifecycle_receipt(&state, &binding(OWNER)))),
    );
    steps.step(
        "readMissingState",
        Ok(read_json(read_lifecycle_receipt(
            &rs.join("absent"),
            &binding(A),
        ))),
    );
    let actual = json!({ "results": steps.0, "files": files(&state) });
    assert_same("lifecycle", &base, expected, actual);
}

#[test]
fn pure_serializers_match_typescript() {
    let base = base("pure");
    let expected = typescript("pure", &base);
    let mut steps = Steps::default();
    let failure = |stage: &str, code: &str, effects: &str| TerminalPreparationFailure {
        stage: stage.into(),
        code: code.into(),
        effects: effects.into(),
    };
    let cases = [
        (
            "startup-1",
            Some(failure("core_admission", "capacity_reserved", "possible")),
        ),
        ("startup-01", None),
        (
            A,
            Some(failure("core_startup", "startup_timeout", "possible")),
        ),
        (A, Some(failure("core_startup", "failed", "possible"))),
        (A, Some(failure("opening", "startup_eof", "possible"))),
        (
            A,
            Some(failure(
                "core_admission",
                "admission_invalid",
                "not_started",
            )),
        ),
        (A, None),
    ];
    for (id, failure) in &cases {
        let code = failure
            .as_ref()
            .map_or("undefined".to_string(), |f| f.code.clone());
        steps.step(
            &format!("host:{id}:{code}"),
            terminal_startup_host_failure(id, failure.as_ref()),
        );
    }
    for (code, refusal) in [
        ("capacity_reserved", Some(RefusalCode::CapacityReserved)),
        ("owned_exit_pending", Some(RefusalCode::OwnedExitPending)),
        ("admission_invalid", Some(RefusalCode::AdmissionInvalid)),
        ("startup_failed", None),
    ] {
        steps.step(
            &format!("core:{code}"),
            core_startup_failure_message("startup-42", "core_admission", refusal),
        );
    }
    let config = json!({
        "version": 2,
        "state": "/synthetic/state",
        "z": { "b": 1, "a": [1.5, 1e21, 1e-7, -0.0, 123456789012u64, 0.1] },
        "text": "é \u{2028} \u{0001} \"quoted\" \\ / <tag>",
        "model": { "value": "m", "files": [{ "path": "/synthetic/model.json" }] },
    });
    let preimage = terminal_enrollment_preimage(
        &config,
        &[Some("1:2".into()), None],
        "synthetic source \u{00ff}".as_bytes(),
        &[("/synthetic/model.json".into(), None)],
    );
    let digest = terminal_digest(&preimage);
    steps.step(
        "preimage",
        Ok(json!({ "preimage": preimage, "digest": digest })),
    );
    let inventory = parse_owned_shutdown_inventory(&evidence()).unwrap();
    steps.step(
        "retireDigest",
        Ok(json!(terminal_digest(&stringify(&inventory.to_value())))),
    );
    let reordered = json!({
        "attempts": [{ "exit": { "signal": 9, "exitCode": 2 }, "state": "exited", "epoch": EPOCH, "instanceId": A, "slot": 7 }],
        "epoch": EPOCH,
    });
    steps.step(
        "inventoryOrder",
        parse_owned_shutdown_inventory(&reordered).map(|i| json!(stringify(&i.to_value()))),
    );
    let actual = json!({ "results": steps.0 });
    assert_same("pure", &base, expected, actual);
}

#[derive(Clone, Copy, PartialEq)]
enum Outcome {
    Ok,
    Fail,
    Absent,
}

struct FakePorts {
    inventories: Vec<Value>,
    stop_fails: bool,
    prepare: Outcome,
    preserve: Outcome,
    inventory_fails: bool,
    owns: bool,
    now: u64,
    calls: usize,
    stops: Vec<String>,
}

impl FakePorts {
    fn inventory_at(&self, index: usize) -> Value {
        let attempts = self.inventories[index.min(self.inventories.len() - 1)].clone();
        json!({ "epoch": EPOCH, "attempts": attempts })
    }
}

impl OwnedShutdownPorts for FakePorts {
    fn current(&mut self) -> bool {
        true
    }
    fn inventory(&mut self, _: u64) -> Result<Value, PortFailure> {
        if self.inventory_fails {
            return Err(PortFailure);
        }
        self.calls += 1;
        Ok(self.inventory_at(self.calls - 1))
    }
    fn owns(&mut self, _: &OwnedShutdownAttempt) -> bool {
        self.owns
    }
    fn stop(&mut self, attempt: &OwnedShutdownAttempt, _: u64) -> Result<(), PortFailure> {
        self.stops.push(attempt.instance_id.clone());
        if self.stop_fails {
            Err(PortFailure)
        } else {
            Ok(())
        }
    }
    fn prepare_retirement(&mut self, _: u64) -> Result<Value, PortFailure> {
        if self.prepare != Outcome::Ok {
            return Err(PortFailure);
        }
        Ok(json!({ "evidence": self.inventory_at(self.calls - 1), "challenge": "synthetic" }))
    }
    fn preserve_exit(&mut self, _: u64) -> Option<Result<Value, PortFailure>> {
        match self.preserve {
            Outcome::Absent => None,
            Outcome::Fail => Some(Err(PortFailure)),
            Outcome::Ok => Some(Ok(json!({
                "status": "leader_exited_retirement_pending",
                "evidence": self.inventory_at(self.calls - 1),
            }))),
        }
    }
    fn supports_preserve_exit(&self) -> bool {
        self.preserve != Outcome::Absent
    }
    fn now_ms(&mut self) -> u64 {
        self.now
    }
    fn wait(&mut self, ms: u64) {
        self.now += ms;
    }
}

#[test]
fn owned_shutdown_matches_typescript() {
    let base = base("shutdown");
    let expected = typescript("shutdown", &base);
    let attempt = |state: &str, exit: Option<Value>| {
        let mut value = json!({ "slot": 0, "instanceId": A, "epoch": EPOCH, "state": state });
        if let Some(exit) = exit {
            value.as_object_mut().unwrap().insert("exit".into(), exit);
        }
        json!([value])
    };
    let exited = || attempt("exited", Some(json!({ "exitCode": 0 })));
    let plan = |inventories: Vec<Value>| FakePorts {
        inventories,
        stop_fails: false,
        prepare: Outcome::Fail,
        preserve: Outcome::Fail,
        inventory_fails: false,
        owns: true,
        now: 0,
        calls: 0,
        stops: Vec::new(),
    };
    let plans = vec![
        (
            "ready",
            FakePorts {
                prepare: Outcome::Ok,
                ..plan(vec![attempt("running", None), exited()])
            },
        ),
        (
            "stopTransport",
            FakePorts {
                stop_fails: true,
                ..plan(vec![attempt("running", None)])
            },
        ),
        (
            "preserved",
            FakePorts {
                preserve: Outcome::Ok,
                ..plan(vec![exited()])
            },
        ),
        (
            "retirementUnavailable",
            FakePorts {
                preserve: Outcome::Absent,
                ..plan(vec![exited()])
            },
        ),
        ("preserveFails", plan(vec![exited()])),
        ("ownershipLost", plan(vec![attempt("ownership_lost", None)])),
        (
            "inventoryFails",
            FakePorts {
                inventory_fails: true,
                ..plan(vec![json!([])])
            },
        ),
        (
            "notOwned",
            FakePorts {
                owns: false,
                ..plan(vec![attempt("running", None)])
            },
        ),
        ("startingTimeout", plan(vec![attempt("starting", None)])),
        ("runningTimeout", plan(vec![attempt("running", None)])),
    ];
    let mut results = Vec::new();
    for (name, mut ports) in plans {
        let mut machine = OwnedTerminalShutdown::new(200).unwrap();
        let first = serde_json::to_value(machine.run(&mut ports)).unwrap();
        let second = if ports.stop_fails {
            serde_json::to_value(machine.run(&mut ports)).unwrap()
        } else {
            Value::Null
        };
        results.push(json!([name, first, second, ports.stops]));
    }
    let mut steps = Steps(results);
    steps.step(
        "badDeadline",
        OwnedTerminalShutdown::new(0).map(|_| Value::Null),
    );
    let actual = json!({ "results": steps.0 });
    assert_same("shutdown", &base, expected, actual);
}

#[test]
fn shared_admission_implements_the_pair_trait() {
    use orqst_terminal_core::admission::SharedDesktopAdmission;
    use orqst_terminal_core::pair::Admission;
    let base = base("pair-trait");
    let dir = base.join("managed-agents");
    let opened = DesktopAdmission::open_with(
        &dir,
        &manifests(),
        Some(EPOCH),
        sources(&[OWNER, ARCHIVE], T0),
    )
    .unwrap();
    let mut shared = SharedDesktopAdmission::new(opened);
    assert!(
        shared.assert_owner().is_err(),
        "unclaimed admission has no owner"
    );
    shared.preflight().unwrap();
    shared.claim().unwrap();
    shared.assert_owner().unwrap();
    let marker = fs::read_to_string(dir.join("active-pair.json")).unwrap();
    assert_eq!(
        marker,
        shared.with(|a| a.marker_bytes().to_owned()).unwrap()
    );
    let mut step = shared.prepare_release(&evidence()).unwrap();
    let archive = dir.join(format!("retired-{OWNER}-{ARCHIVE}.json"));
    assert!(archive.exists() && dir.join("active-pair.json").exists());
    step().unwrap();
    assert!(!dir.join("active-pair.json").exists() && archive.exists());
    assert!(step().is_err(), "the release step is one-shot");
    assert!(shared.claim().is_err(), "retired admission never reclaims");
    fs::remove_dir_all(base).unwrap();
}
