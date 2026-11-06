//! SYNTHETIC golden tests for the Rust message hub: (1) the same tool-call steps give the same
//! replies, refusals and metadata evidence as the TypeScript `TerminalMessageHub`; (2) the
//! unchanged Node relay transport (`connectMcpInstance`) interoperates with the Rust endpoint.
use std::path::PathBuf;
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use orqst_terminal_core::hub::hub::{
    HubError, HubEvidence, HubMember, MessageKind, TerminalMessageHub,
};
use orqst_terminal_core::hub::{open_hub_endpoint, TerminalBinding};
use serde_json::{json, Value};

fn manifest() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn tsx(args: &[&std::ffi::OsStr]) -> Value {
    let out = Command::new("pnpm")
        .args(["-s", "exec", "tsx"])
        .args(args)
        .current_dir(manifest())
        .output()
        .expect("tsx (Node 24 toolchain on PATH)");
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    serde_json::from_slice(&out.stdout).unwrap()
}

fn member(value: &Value) -> HubMember {
    HubMember {
        terminal_id: value["terminalId"].as_str().unwrap().into(),
        alias: value["alias"].as_str().unwrap().into(),
        name: value["name"].as_str().unwrap().into(),
        provider: value["provider"].as_str().unwrap().into(),
        feature_id: value["featureId"].as_str().map(Into::into),
        running: value["running"].as_bool().unwrap(),
    }
}

fn evidence_json(event: &HubEvidence) -> Value {
    let kind = match event.kind {
        MessageKind::Message => "message",
        MessageKind::Task => "task",
        MessageKind::Result => "result",
    };
    let mut value = json!({
        "messageId": event.message_id, "kind": kind, "from": event.from, "to": event.to,
        "featureId": event.feature_id, "at": event.at,
    });
    if let Some(task) = &event.task_id {
        value["taskId"] = task.as_str().into();
    }
    value
}

#[test]
fn hub_steps_match_the_typescript_hub() {
    let steps_file = manifest().join("tests/golden/hub-steps.json");
    let node = tsx(&[
        manifest().join("tests/golden/hub.ts").as_os_str(),
        steps_file.as_os_str(),
    ]);
    let fixture: Value =
        serde_json::from_str(&std::fs::read_to_string(&steps_file).unwrap()).unwrap();
    let members = Arc::new(Mutex::new(
        fixture["members"]
            .as_array()
            .unwrap()
            .iter()
            .map(member)
            .collect::<Vec<_>>(),
    ));
    let clock = Arc::new(AtomicU64::new(1_000_000));
    let ids = Arc::new(AtomicU64::new(0));
    let evidence = Arc::new(Mutex::new(Vec::new()));
    let (m, c, e) = (members.clone(), clock.clone(), evidence.clone());
    let hub = TerminalMessageHub::with_clock(
        move || Ok(m.lock().unwrap().clone()),
        move |event| e.lock().unwrap().push(evidence_json(event)),
        move || c.load(Ordering::SeqCst),
        move || {
            format!(
                "00000000-0000-4000-8000-{:x}",
                0x1000_0000_0000u64 + ids.fetch_add(1, Ordering::SeqCst) + 1
            )
        },
    );
    let mut last_task = "00000000-0000-4000-8000-000000000000".to_string();
    for (index, step) in fixture["steps"].as_array().unwrap().iter().enumerate() {
        let result = match step["op"].as_str().unwrap() {
            "call" => {
                let call: Value =
                    serde_json::from_str(&step["call"].to_string().replace("$TASK", &last_task))
                        .unwrap();
                hub.call(step["from"].as_str().unwrap(), &call)
                    .map(|reply| {
                        let text = serde_json::to_string(&reply).unwrap();
                        if call["name"] == "delegate_task" {
                            let value: Value = serde_json::from_str(&text).unwrap();
                            last_task = value["taskId"].as_str().unwrap().into();
                        }
                        text
                    })
            }
            "owner" => hub
                .owner_send(
                    step["featureId"].as_str().unwrap(),
                    step["to"].as_str().unwrap(),
                    step["text"].as_str().unwrap(),
                )
                .map(|sent| serde_json::to_string(&sent).unwrap()),
            other => {
                match other {
                    "advance" => {
                        clock.fetch_add(step["ms"].as_u64().unwrap(), Ordering::SeqCst);
                    }
                    "stop" => {
                        let mut list = members.lock().unwrap();
                        list.iter_mut()
                            .find(|m| m.terminal_id == step["terminal"])
                            .unwrap()
                            .running = false;
                    }
                    "forget" => hub.forget(step["terminal"].as_str().unwrap()),
                    "close" => hub.close(),
                    _ => {}
                }
                Ok("null".to_string())
            }
        };
        let got = match result {
            Ok(text) => format!("ok:{text}"),
            Err(HubError::Refused(code)) => format!("refused:{code}"),
            Err(HubError::Failed) => "error".into(),
        };
        // Byte equality of the serialized reply text (key order included).
        assert_eq!(
            got,
            node["results"][index].as_str().unwrap(),
            "step {index}: {step}"
        );
    }
    assert_eq!(
        Value::Array(evidence.lock().unwrap().clone()),
        node["evidence"]
    );
}

#[test]
fn node_relay_transport_talks_to_the_rust_endpoint() {
    let (a, b) = (
        "00000000-0000-4000-8000-0000000000a1",
        "00000000-0000-4000-8000-0000000000b1",
    );
    let feature = "00000000-0000-4000-8000-0000000000f1";
    let members = vec![
        HubMember {
            terminal_id: a.into(),
            alias: "T-001".into(),
            name: "Codex".into(),
            provider: "codex".into(),
            feature_id: Some(feature.into()),
            running: true,
        },
        HubMember {
            terminal_id: b.into(),
            alias: "T-002".into(),
            name: "Claude Code".into(),
            provider: "claude".into(),
            feature_id: Some(feature.into()),
            running: true,
        },
    ];
    let hub = Arc::new(TerminalMessageHub::new(move || Ok(members.clone()), |_| {}));
    let parent = std::fs::canonicalize(std::env::temp_dir()).unwrap();
    let mut endpoint =
        open_hub_endpoint(hub.clone(), TerminalBinding::Fixed(a.into()), &parent).unwrap();
    use std::os::unix::fs::{FileTypeExt, MetadataExt};
    let socket = std::fs::symlink_metadata(&endpoint.socket_path).unwrap();
    let cap = std::fs::symlink_metadata(&endpoint.capability_file).unwrap();
    let dir = std::fs::symlink_metadata(endpoint.socket_path.parent().unwrap()).unwrap();
    assert!(socket.file_type().is_socket());
    assert_eq!(
        (
            socket.mode() & 0o777,
            cap.mode() & 0o777,
            cap.size(),
            dir.mode() & 0o777
        ),
        (0o600, 0o600, 43, 0o700)
    );

    let node = tsx(&[
        manifest().join("tests/golden/relay.ts").as_os_str(),
        endpoint.socket_path.as_os_str(),
        endpoint.capability_file.as_os_str(),
    ]);
    assert_eq!(node["role"], "terminal");
    assert_eq!(node["second"], "refused");
    let results = node["results"].as_array().unwrap();
    assert_eq!(
        results[0],
        json!({"ok": {"terminals": [{"handle": "T-002", "name": "Claude Code", "cli": "claude", "state": "running", "queued": 0}]}})
    );
    assert_eq!(results[1]["ok"]["state"], "queued");
    assert_eq!(results[1]["ok"]["sent"][0]["to"], "T-002");
    assert_eq!(results[2]["ok"]["refused"], "unknown_terminal");
    assert!(results[2]["ok"]["message"]
        .as_str()
        .unwrap()
        .starts_with("No such terminal"));
    assert_eq!(results[3], json!({"ok": {"messages": [], "remaining": 0}}));
    // Invalid arguments (limit > 20) answer `{ id, ok: false }`, which the relay rejects.
    assert_eq!(results[4], json!({"error": "MCP operation denied"}));
    // The message reached T-002's inbox through the Rust hub.
    let read = hub
        .call(b, &json!({"name": "read_messages", "arguments": {}}))
        .unwrap();
    let read = serde_json::to_value(read).unwrap();
    assert_eq!(read["messages"][0]["text"], "hello from the relay ✓");
    assert_eq!(read["messages"][0]["from"], "T-001");
    let directory = endpoint.socket_path.parent().unwrap().to_path_buf();
    endpoint.close();
    assert!(!directory.exists());
}
