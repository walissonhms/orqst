//! SYNTHETIC golden test: composer mention records, the hub metadata journal (1 MiB cap) and
//! the MCP pair communication journal are byte-identical to the TypeScript writers
//! (tests/golden/hub-records.ts). Temporary private directories only.
use std::os::unix::fs::{DirBuilderExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::process::Command;

use orqst_terminal_core::features::features::{Env, Features};
use orqst_terminal_core::features::model::stable_id;
use orqst_terminal_core::features::store::with_terminal_preferences;
use orqst_terminal_core::hub::communication::{CommunicationJournal, McpTaskEvidence};
use orqst_terminal_core::hub::hub::{HubEvidence, MessageKind};
use orqst_terminal_core::hub::mentions::{record_composer_mention, Delivery};
use orqst_terminal_core::hub::HubJournal;
use serde_json::{json, Value};

const A: &str = "00000000-0000-4000-8000-0000000000a1";
const B: &str = "00000000-0000-4000-8000-0000000000b1";
const C: &str = "00000000-0000-4000-8000-0000000000c1";
const D: &str = "00000000-0000-4000-8000-0000000000d1";

fn uid(suffix: &str) -> String {
    format!("00000000-0000-4000-8000-0000000000{suffix}")
}

fn private_dir(path: &Path) -> PathBuf {
    std::fs::DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(path)
        .unwrap();
    std::fs::canonicalize(path).unwrap()
}

/// Replaces the random record id and wall-clock time so the rest compares byte for byte.
fn normalize(text: &str, id: &str) -> String {
    let text = text.replace(id, "<id>");
    let start = text.find("\"at\":").unwrap() + 5;
    let end = start + text[start..].find(',').unwrap();
    format!("{}<at>{}", &text[..start], &text[end..])
}

#[test]
fn hub_records_match_the_typescript_writers() {
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let base = std::env::temp_dir().join(format!(
        "orqst-synthetic-hub-records-{}",
        uuid::Uuid::new_v4()
    ));
    let (ts, rs) = (private_dir(&base.join("ts")), private_dir(&base.join("rs")));
    let out = Command::new("pnpm")
        .args(["-s", "exec", "tsx"])
        .arg(manifest.join("tests/golden/hub-records.ts"))
        .arg(&ts)
        .current_dir(&manifest)
        .output()
        .expect("tsx (Node 24 toolchain on PATH)");
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let node: Value = serde_json::from_slice(&out.stdout).unwrap();
    // Same Feature state: copy the closed TypeScript preferences Store.
    let layouts = private_dir(&rs.join("terminal-layouts"));
    let copy = layouts.join("preferences.sqlite");
    std::fs::copy(ts.join("terminal-layouts/preferences.sqlite"), &copy).unwrap();
    std::fs::set_permissions(&copy, std::fs::Permissions::from_mode(0o600)).unwrap();
    let workspace = stable_id(&["workspace", "/synthetic/orqst-project"]);
    let f1 = node["features"][0].as_str().unwrap().to_string();
    let f2 = node["features"][1].as_str().unwrap().to_string();

    // Composer mentions.
    let known: Vec<String> = [A, B, C, D].map(String::from).to_vec();
    let deliver = |terminal: &str, _text: &str| -> Delivery {
        if terminal == B {
            ("queued", "hub_inbox")
        } else {
            ("denied", "inbox_full")
        }
    };
    let inputs: Vec<(Option<&str>, Value, bool)> = vec![
        (
            Some(&f1),
            json!({"from": {"kind": "user"}, "to": [A, B, C, D], "text": "owner ✓"}),
            true,
        ),
        (
            Some(&f1),
            json!({"from": {"kind": "terminal", "terminalId": A}, "to": [B], "text": "peer"}),
            true,
        ),
        (
            Some(&f1),
            json!({"from": {"kind": "terminal", "terminalId": C}, "to": [B], "text": "foreign"}),
            true,
        ),
        (
            None,
            json!({"from": {"kind": "user"}, "to": [D, A], "text": "unassigned"}),
            true,
        ),
        (
            None,
            json!({"from": {"kind": "terminal", "terminalId": D}, "to": [D], "text": "self"}),
            false,
        ),
        (
            Some(&f2),
            json!({"from": {"kind": "user"}, "to": [C], "text": "no hub"}),
            false,
        ),
    ];
    for (index, (feature, input, hub)) in inputs.iter().enumerate() {
        let expected = &node["mentions"][index];
        let reply = record_composer_mention(
            &rs,
            &workspace,
            *feature,
            &known,
            input,
            hub.then_some(&deliver as _),
        )
        .unwrap();
        let id = serde_json::from_str::<Value>(&reply).unwrap()["id"]
            .as_str()
            .unwrap()
            .to_string();
        let node_reply = expected["reply"].as_str().unwrap();
        let node_id = serde_json::from_str::<Value>(node_reply).unwrap()["id"]
            .as_str()
            .unwrap()
            .to_string();
        assert_eq!(
            reply.replace(&id, "<id>"),
            node_reply.replace(&node_id, "<id>"),
            "mention {index}"
        );
        let record =
            std::fs::read_to_string(rs.join(format!("composer-mentions/{id}.json"))).unwrap();
        assert!(
            !record.contains("owner ✓") && !record.contains("peer"),
            "text must never be recorded"
        );
        assert_eq!(
            normalize(&record, &id),
            normalize(expected["record"].as_str().unwrap(), &node_id),
            "record {index}"
        );
    }

    // Hub metadata journal, including the 1 MiB cap marker.
    let epoch = uid("e1");
    let journal = HubJournal::open(&rs, &epoch).unwrap();
    let kinds = [MessageKind::Message, MessageKind::Task, MessageKind::Result];
    for index in 0..7000u64 {
        journal.append(&HubEvidence {
            message_id: format!("00000000-0000-4000-8000-{index:012}"),
            kind: kinds[(index % 3) as usize],
            from: if index % 5 == 0 {
                "owner".into()
            } else {
                A.into()
            },
            to: B.into(),
            feature_id: f1.clone(),
            at: 1_000 + index,
            task_id: (index % 3 != 0).then(|| uid("aa")),
        });
    }
    drop(journal);
    let name = format!("hub-communication/{epoch}.jsonl");
    let written = std::fs::read(rs.join(&name)).unwrap();
    assert_eq!(written, std::fs::read(ts.join(&name)).unwrap());
    assert!(
        String::from_utf8_lossy(&written).ends_with("{\"truncated\":true,\"at\":7999}\n")
            || written.len() <= 1024 * 1024 + 64
    );

    // MCP pair communication journal and its projection.
    let source_dir = rs.clone();
    let ws = workspace.clone();
    let pair = CommunicationJournal::open(
        &rs,
        &uid("e2"),
        &workspace,
        [A.into(), B.into()],
        move || {
            let env = Env::default();
            with_terminal_preferences(&source_dir, |db| Features::open(db, &env)?.list(&ws))
        },
    )
    .unwrap();
    let (s, t) = (uid("51"), uid("52"));
    let bound = pair.bind(&s, &t).unwrap();
    let evidence = |grant: &str, task: &str, kind: &'static str, at: u64| McpTaskEvidence {
        grant_id: uid(grant),
        task_id: uid(task),
        source_instance_id: s.clone(),
        target_instance_id: t.clone(),
        kind,
        at,
    };
    bound.record(&evidence("61", "71", "result", 5));
    bound.record(&evidence("61", "71", "delegation", 10));
    bound.record(&evidence("61", "71", "delegation", 11));
    bound.record(&evidence("61", "72", "result", 12));
    bound.record(&evidence("61", "71", "result", 13));
    bound.record(&evidence("62", "72", "delegation", 14));
    bound.record(&McpTaskEvidence {
        source_instance_id: t.clone(),
        ..evidence("62", "72", "result", 15)
    });
    let projection: Vec<String> = [Some(f1.as_str()), Some(f2.as_str()), None]
        .iter()
        .map(|id| pair.project(*id).unwrap_or_else(|| "undefined".into()))
        .collect();
    let node_projection: Vec<String> = serde_json::from_value(node["projection"].clone()).unwrap();
    assert_eq!(projection, node_projection);
    assert!(projection[0].contains("delegation") && projection[0].contains("result"));
    let name = format!("mcp-communication/{}.jsonl", uid("e2"));
    assert_eq!(
        std::fs::read(rs.join(&name)).unwrap(),
        std::fs::read(ts.join(&name)).unwrap()
    );
    std::fs::remove_dir_all(base).unwrap();
}
