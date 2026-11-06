//! `orqst-terminal-core` behind a real Node IPC parent (`serialization: 'json'`), on SYNTHETIC
//! manifests in a disposable directory. The synthetic "executables" carry a Mach-O magic
//! header only so the profile checks accept them; they are never executed (no launch here).
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use ed25519_dalek::SigningKey;
use orqst_terminal_core::profiles::codex::managed_codex_settings;
use orqst_terminal_core::profiles::config::{parse_interactive_config, InteractiveConfig};
use orqst_terminal_core::profiles::fsx::terminal_executable_sha256;
use orqst_terminal_core::profiles::js;
use serde_json::{json, Value};
use std::fs;
use std::os::unix::fs::{DirBuilderExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::process::Command;

struct Synthetic {
    root: PathBuf,
    manifest: String,
    preferences: String,
}

impl Drop for Synthetic {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

fn dir(path: &Path, mode: u32) {
    fs::DirBuilder::new().mode(mode).create(path).unwrap();
    fs::set_permissions(path, fs::Permissions::from_mode(mode)).unwrap();
}

fn executable(path: &Path, name: &str) -> String {
    let mut bytes = vec![0xcf, 0xfa, 0xed, 0xfe];
    bytes.extend_from_slice(
        format!("SYNTHETIC ORQST test fixture executable {name}; never run\n").as_bytes(),
    );
    fs::write(path, bytes).unwrap();
    fs::set_permissions(path, fs::Permissions::from_mode(0o755)).unwrap();
    terminal_executable_sha256(path.to_str().unwrap()).unwrap()
}

/// One separate-login Codex manifest (version 1), the legacy reviewed shape.
fn synthetic() -> Synthetic {
    synthetic_with(false)
}

/// `hub`: a native-session Codex manifest with the Feature-scoped hub (reuse-existing login
/// pointing at a SYNTHETIC home inside the disposable root).
fn synthetic_with(hub: bool) -> Synthetic {
    let base = fs::canonicalize(std::env::temp_dir()).unwrap();
    let root = base.join(format!("orqst-synthetic-startup-{}", uuid::Uuid::new_v4()));
    dir(&root, 0o700);
    for d in ["bin", "project", "state", "manifests", "preferences"] {
        dir(
            &root.join(d),
            if d == "bin" || d == "project" {
                0o755
            } else {
                0o700
            },
        );
    }
    for d in ["home", "codex", "tmp"] {
        dir(&root.join("state").join(d), 0o700);
    }
    let p = |s: &str| root.join(s).to_string_lossy().into_owned();
    let codex = executable(&root.join("bin/codex"), "codex");
    let node = executable(&root.join("bin/node"), "node");
    let mut manifest = json!({
        "version": 1,
        "trust": "native-same-user",
        "executable": {"path": p("bin/codex"), "sha256": codex},
        "executableVersion": "codex-cli 0.162.1",
        "node": {"path": p("bin/node"), "sha256": node},
        "project": p("project"),
        "state": p("state"),
    });
    if hub {
        dir(&root.join("home"), 0o755);
        dir(&root.join("home/.codex"), 0o755);
        let m = manifest.as_object_mut().unwrap();
        m.insert("toolPath".into(), p("bin").into());
        m.insert("identity".into(), json!({"terminalId": id()}));
        m.insert(
            "interactive".into(),
            json!({"sharedNativeSessions": true, "mcp": true, "hub": true}),
        );
        m.insert("authentication".into(), json!({"mode": "reuse-existing", "home": p("home"), "codexHome": p("home/.codex"), "sharedNativeConfiguration": true}));
    }
    let InteractiveConfig::Codex(config) =
        parse_interactive_config(&js::parse(&manifest.to_string()).unwrap()).unwrap()
    else {
        panic!("codex")
    };
    let settings = root.join("state/codex/config.toml");
    fs::write(&settings, managed_codex_settings(&config)).unwrap();
    fs::set_permissions(&settings, fs::Permissions::from_mode(0o600)).unwrap();
    let auth = root.join("state/codex/auth.json");
    fs::write(&auth, "{\"synthetic\":true}").unwrap();
    fs::set_permissions(&auth, fs::Permissions::from_mode(0o600)).unwrap();
    let file = root.join("manifests/terminal.json");
    fs::write(&file, manifest.to_string()).unwrap();
    fs::set_permissions(&file, fs::Permissions::from_mode(0o600)).unwrap();
    Synthetic {
        manifest: file.to_string_lossy().into_owned(),
        preferences: p("preferences"),
        root,
    }
}

fn node() -> String {
    if let Ok(node) = std::env::var("ORQST_TEST_NODE") {
        return node;
    }
    let toolchain = Path::new(&std::env::var("HOME").unwrap_or_default())
        .join(".local/share/orqst/toolchain/bin/node");
    if toolchain.exists() {
        return toolchain.to_string_lossy().into_owned();
    }
    "node".into()
}

fn public_key() -> String {
    let key = SigningKey::from_bytes(&[7u8; 32]).verifying_key();
    let mut der = vec![
        0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
    ];
    der.extend_from_slice(key.as_bytes());
    URL_SAFE_NO_PAD.encode(der)
}

/// Runs the binary under the Node IPC parent; returns the observed events.
fn run(core_args: &[String], requests: Value) -> Vec<Value> {
    let parent = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/ipc-parent.mjs");
    let output = Command::new(node())
        .arg(parent)
        .arg(env!("CARGO_BIN_EXE_orqst-terminal-core"))
        .arg(requests.to_string())
        .args(core_args)
        .output()
        .expect("node parent");
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout)
        .unwrap()
        .lines()
        .map(|l| serde_json::from_str(l).unwrap())
        .collect()
}

fn id() -> String {
    uuid::Uuid::new_v4().to_string()
}

#[test]
fn ready_prepare_and_clean_disconnect_over_node_ipc() {
    let s = synthetic();
    let startup = id();
    let (prepare, features) = (id(), id());
    let args = vec![
        json!([s.manifest]).to_string(),
        public_key(),
        s.preferences.clone(),
        "2".into(),
        startup.clone(),
    ];
    let events = run(
        &args,
        json!([
            {"kind": "terminal", "slot": 0, "request": {"id": prepare, "operation": "prepare", "args": ["desktop-managed", "codex-terminal-v1"]}},
            {"kind": "featureList", "id": features},
        ]),
    );
    let ready = &events[0]["message"];
    let keys: Vec<&str> = ready
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    assert_eq!(
        keys,
        [
            "type",
            "pendingOwnedExits",
            "id",
            "epoch",
            "admissionOwner",
            "initialFiles",
            "identities"
        ]
    );
    assert_eq!(ready["type"], "ready");
    assert_eq!(ready["id"], startup.as_str());
    assert_eq!(ready["pendingOwnedExits"], json!([]));
    assert_eq!(ready["initialFiles"], json!([s.manifest]));
    let identity = &ready["identities"][0];
    let keys: Vec<&str> = identity
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    assert_eq!(keys, ["slot", "terminalId", "alias", "provider"]);
    assert_eq!(identity["provider"], "codex");
    assert_eq!(
        identity["alias"],
        format!("P-{}", identity["terminalId"].as_str().unwrap())
    );
    // Prepare: a signed challenge for the reviewed profile; nothing is launched.
    let reply = &events[1]["message"];
    assert_eq!(reply["id"], prepare.as_str());
    assert_eq!(reply["ok"], true, "{reply}");
    assert_eq!(reply["value"]["profile"]["id"], "codex-terminal-v1");
    assert_eq!(reply["value"]["challenge"]["epoch"], ready["epoch"]);
    assert_eq!(reply["value"]["challenge"]["operation"], "start");
    // An extension kind answered by the Feature store.
    assert_eq!(
        events[2]["message"],
        json!({"id": features, "ok": true, "value": []})
    );
    assert_eq!(events[3], json!({"event": "disconnect"}));
    assert_eq!(
        events[4],
        json!({"event": "exit", "code": 0, "signal": null})
    );
    // The admission marker stays (owned capacity until retirement); a journal was created.
    let marker: Value = serde_json::from_str(
        &fs::read_to_string(Path::new(&s.preferences).join("active-pair.json"))
            .unwrap_or_else(|_| "null".into()),
    )
    .unwrap();
    assert!(marker.is_null(), "prepare never claims capacity: {marker}");
    assert!(s.root.join("state/terminal.sqlite").exists());
}

#[test]
fn startup_failures_carry_stage_and_code() {
    // core_startup: an invalid slot limit.
    let s = synthetic();
    let startup = id();
    let args = vec![
        json!([s.manifest]).to_string(),
        public_key(),
        s.preferences.clone(),
        "9".into(),
        startup.clone(),
    ];
    let events = run(&args, json!([]));
    assert_eq!(
        events[0]["message"],
        json!({"type": "startup-failure", "id": startup, "failure": {"stage": "core_startup", "code": "startup_failed", "effects": "possible"}})
    );
    assert!(events.iter().any(|e| e["event"] == "disconnect"));
    assert!(events
        .iter()
        .any(|e| e == &json!({"event": "exit", "code": 1, "signal": null})));
    // core_admission: capacity already reserved by another owner.
    let s = synthetic();
    let marker = Path::new(&s.preferences).join("active-pair.json");
    let other =
        json!({"version": 1, "owner": id(), "manifests": ["/synthetic/other.json"], "epoch": id()});
    fs::write(&marker, other.to_string() + "\n").unwrap();
    fs::set_permissions(&marker, fs::Permissions::from_mode(0o600)).unwrap();
    let startup = format!("startup-{}", 42);
    let args = vec![
        json!([s.manifest]).to_string(),
        public_key(),
        s.preferences.clone(),
        "2".into(),
        startup.clone(),
    ];
    let events = run(&args, json!([]));
    assert_eq!(
        events[0]["message"]["failure"]["stage"], "core_admission",
        "{events:?}"
    );
    assert_eq!(events[0]["message"]["id"], startup.as_str());
    assert_eq!(
        events[0]["message"]["failure"]["code"], "capacity_reserved",
        "{events:?}"
    );
}

/// The hub composition in process: endpoints opened ahead, hub launch in the profile,
/// Feature kinds, composer delivery through the hub and the owner-only projection.
#[test]
fn hub_composition_routes_owner_mentions() {
    use orqst_terminal_core::core::{events, Core};
    use orqst_terminal_core::startup::{start, Args};
    let s = synthetic_with(true);
    let core_dir = s.root.join("core");
    dir(&core_dir, 0o755);
    fs::write(
        core_dir.join("orqst-mcp-relay.cjs"),
        "// SYNTHETIC ORQST relay fixture; never run\n",
    )
    .unwrap();
    let startup = id();
    let args = Args {
        files: json!([s.manifest]).to_string(),
        public_key: public_key(),
        preferences: s.preferences.clone(),
        limit: "3".into(),
        startup_id: startup.clone(),
    };
    let (sender, _receiver) = events();
    let (startup_value, extensions) = match start(
        &args,
        sender,
        env!("CARGO_BIN_EXE_orqst-terminal-core").into(),
        &core_dir,
    ) {
        Ok(v) => v,
        Err(failure) => panic!("{failure:?}"),
    };
    let ready = startup_value.ready.clone();
    let terminal = ready["identities"][0]["terminalId"]
        .as_str()
        .unwrap()
        .to_owned();
    let mut core = Core::new(startup_value, Box::new(extensions));
    let mut call = |request: Value| core.handle(&request).expect("valid request");
    // The prepared profile carries the slot's hub launch (relay path and digest).
    let r = call(
        json!({"kind": "terminal", "slot": 0, "request": {"id": id(), "operation": "prepare", "args": ["desktop-managed", "codex-terminal-v1"]}}),
    );
    assert_eq!(r["ok"], true, "{r}");
    let argv = r["value"]["profile"]["argv"].to_string();
    assert!(
        argv.contains("orqst-mcp-relay.cjs") && argv.contains("orqst_"),
        "{argv}"
    );
    let r =
        call(json!({"kind": "featureCreate", "id": id(), "input": {"name": "Synthetic feature"}}));
    assert_eq!(r["ok"], true, "{r}");
    let feature = r["value"]["featureId"].as_str().unwrap().to_owned();
    let revision = r["value"]["revision"].clone();
    let r = call(
        json!({"kind": "featureAssign", "id": id(), "featureId": feature, "slot": 0, "expectedRevision": revision}),
    );
    assert_eq!(r["ok"], true, "{r}");
    let r = call(
        json!({"kind": "composerMention", "id": id(), "featureId": feature, "input": {"from": {"kind": "user"}, "to": [terminal], "text": "SYNTHETIC hello"}}),
    );
    assert_eq!(r["ok"], true, "{r}");
    // Parity with host.ts, including its known defect: the hub member provider re-opens the
    // Feature store while the composer transaction holds `BEGIN IMMEDIATE`, so the owner send
    // fails with "database is locked" and the outcome is honestly `denied/unavailable` (the
    // TypeScript path behaves identically; reported upstream, not silently diverged here).
    assert_eq!(
        r["value"]["outcomes"],
        json!([{"terminalId": terminal, "delivery": "denied", "reason": "unavailable"}])
    );
    // Capacity is not claimed before a launch: the owner-only projection refuses.
    let r = call(json!({"kind": "communicationProjection", "id": id(), "featureId": feature}));
    assert_eq!(r["ok"], false, "{r}");
    // The legacy pair MCP is never opted in.
    let r = call(json!({"kind": "prepareMcp", "id": id()}));
    assert_eq!(r["ok"], false);
    // Enrollment inspection lists the initial member in schema order.
    let r = call(json!({"kind": "enrollmentInspect", "id": id()}));
    assert_eq!(r["ok"], true, "{r}");
    let member = &r["value"]["members"][0];
    let keys: Vec<&str> = member
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    assert_eq!(
        keys,
        [
            "slot",
            "terminalId",
            "alias",
            "provider",
            "workspaceId",
            "featureId",
            "admissionRevision",
            "bindingDigest",
            "status"
        ]
    );
    assert_eq!(r["value"]["capacity"], 3);
    assert_eq!(r["value"]["reservedSlots"], 1);
    let journal = Path::new(&s.preferences)
        .join("hub-communication")
        .join(format!("{}.jsonl", ready["epoch"].as_str().unwrap()));
    // The hub audit journal exists (0600) and holds no message text.
    let text = fs::read_to_string(&journal).unwrap();
    assert!(!text.contains("SYNTHETIC hello"));
    assert_eq!(
        fs::metadata(&journal).unwrap().permissions().mode() & 0o777,
        0o600
    );
}
