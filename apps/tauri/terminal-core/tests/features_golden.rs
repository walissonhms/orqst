//! SYNTHETIC golden test: the Rust Feature/team/layout port answers every pair RPC request of
//! tests/golden/features-ops.json exactly like the TypeScript Core (tests/golden/features.ts)
//! and leaves byte-identical rows in the private preferences Store. Temp dirs only.
use std::os::unix::fs::DirBuilderExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::Arc;

use orqst_terminal_core::features::features::Env;
use orqst_terminal_core::features::model::{stable_id, CF_RANGES};
use orqst_terminal_core::features::{dispatch, FeatureContext};
use rusqlite::Connection;
use serde_json::Value;
use sha2::{Digest, Sha256};

fn manifest() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn private_dir(path: &Path) -> PathBuf {
    std::fs::DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(path)
        .unwrap();
    std::fs::canonicalize(path).unwrap()
}

/// Every row of the metadata tables plus their DDL (machine/session tables excluded).
pub fn dump(file: &Path) -> Value {
    let db = Connection::open(file).unwrap();
    let mut out = serde_json::Map::new();
    let names: Vec<(String, String)> = db
        .prepare(
            "SELECT name, sql FROM sqlite_master WHERE (name LIKE 'feature%' OR name LIKE 'terminal_team%' OR name LIKE 'terminal_layout%') AND sql IS NOT NULL ORDER BY name",
        )
        .unwrap()
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .unwrap()
        .map(Result::unwrap)
        .collect();
    for (name, sql) in &names {
        out.insert(format!("ddl:{name}"), Value::String(sql.clone()));
        if !sql.starts_with("CREATE TABLE") {
            continue;
        }
        let mut statement = db
            .prepare(&format!("SELECT * FROM {name} ORDER BY rowid"))
            .unwrap();
        let columns = statement.column_count();
        let rows: Vec<Value> = statement
            .query_map([], |row| {
                Ok(Value::Array(
                    (0..columns)
                        .map(|i| match row.get_ref(i).unwrap() {
                            rusqlite::types::ValueRef::Null => Value::Null,
                            rusqlite::types::ValueRef::Integer(n) => n.into(),
                            rusqlite::types::ValueRef::Text(t) => String::from_utf8_lossy(t).into(),
                            other => format!("{other:?}").into(),
                        })
                        .collect(),
                ))
            })
            .unwrap()
            .map(Result::unwrap)
            .collect();
        out.insert(name.clone(), Value::Array(rows));
    }
    let version: i64 = db
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .unwrap();
    out.insert("user_version".into(), version.into());
    Value::Object(out)
}

fn resolve(value: &Value, ids: &[String]) -> Value {
    match value {
        Value::String(s) if s.starts_with("$F") => Value::String(
            s[2..]
                .parse::<usize>()
                .ok()
                .and_then(|n| ids.get(n - 1).cloned())
                .unwrap_or_else(|| "00000000-0000-4000-8000-00000000dead".into()),
        ),
        Value::Array(items) => Value::Array(items.iter().map(|v| resolve(v, ids)).collect()),
        Value::Object(map) => Value::Object(
            map.iter()
                .map(|(k, v)| (k.clone(), resolve(v, ids)))
                .collect(),
        ),
        other => other.clone(),
    }
}

#[test]
fn feature_rpc_matches_the_typescript_core() {
    let base =
        std::env::temp_dir().join(format!("orqst-synthetic-features-{}", uuid::Uuid::new_v4()));
    let (ts, rs) = (private_dir(&base.join("ts")), private_dir(&base.join("rs")));
    let ops_file = manifest().join("tests/golden/features-ops.json");
    let out = Command::new("pnpm")
        .args(["-s", "exec", "tsx"])
        .arg(manifest().join("tests/golden/features.ts"))
        .arg(&ops_file)
        .arg(&ts)
        .current_dir(manifest())
        .output()
        .expect("tsx (Node 24 toolchain on PATH)");
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let node: Value = serde_json::from_slice(&out.stdout).unwrap();
    let fixture: Value =
        serde_json::from_str(&std::fs::read_to_string(&ops_file).unwrap()).unwrap();

    // Unicode Cf table equals Node's ICU view.
    let cf: Vec<(u32, u32)> = serde_json::from_value(node["cf"].clone()).unwrap();
    assert_eq!(cf, CF_RANGES.to_vec());

    let project = fixture["project"].as_str().unwrap();
    let workspace = stable_id(&["workspace", project]);
    let team_workspace: String = Sha256::digest(project.as_bytes())
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    assert_eq!(node["workspaceId"], workspace.as_str());
    assert_eq!(node["teamWorkspace"], team_workspace.as_str());
    let terminal_ids: Vec<String> = serde_json::from_value(fixture["terminalIds"].clone()).unwrap();
    let node_ids: Vec<String> = serde_json::from_value(node["featureIds"].clone()).unwrap();

    let clock = Arc::new(AtomicU64::new(1_000));
    let next = Arc::new(AtomicUsize::new(0));
    let ids_for_env = node_ids.clone();
    let mut ctx = FeatureContext::new(rs.clone(), workspace, team_workspace, terminal_ids);
    let tick = clock.clone();
    ctx.env = Env {
        now: Box::new(move || tick.fetch_add(7, Ordering::SeqCst) + 7),
        new_id: Box::new(move || ids_for_env[next.fetch_add(1, Ordering::SeqCst)].clone()),
    };
    let mut created: Vec<String> = Vec::new();
    for (index, op) in fixture["ops"].as_array().unwrap().iter().enumerate() {
        let request = resolve(op, &created);
        let got = match dispatch(&ctx, &request) {
            Ok(Some(text)) => format!("ok:{text}"),
            Ok(None) => "ok:undefined".into(),
            Err(_) => "error".into(),
        };
        if request["kind"] == "featureCreate" && got.starts_with("ok:") {
            let value: Value = serde_json::from_str(&got[3..]).unwrap();
            created.push(value["featureId"].as_str().unwrap().into());
        }
        assert_eq!(
            got,
            node["results"][index].as_str().unwrap(),
            "op {index}: {op}"
        );
    }
    assert_eq!(created, node_ids);
    let file = |root: &Path| root.join("terminal-layouts/preferences.sqlite");
    let expected = dump(&file(&ts));
    // The comparison is not vacuous: 3 Features, 2 permission revisions, teams and layouts.
    assert_eq!(expected["features"].as_array().unwrap().len(), 3);
    assert_eq!(
        expected["feature_permission_events"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    assert_eq!(expected["terminal_teams"].as_array().unwrap().len(), 2);
    assert_eq!(expected["terminal_layouts"].as_array().unwrap().len(), 2);
    assert!(
        expected["feature_configuration_events"]
            .as_array()
            .unwrap()
            .len()
            >= 8
    );
    assert_eq!(dump(&file(&rs)), expected);
    std::fs::remove_dir_all(base).unwrap();
}

#[test]
fn default_feature_and_layout_move_match_the_typescript_core() {
    use orqst_terminal_core::features::model::{default_feature_id, TerminalLayoutRecord};

    let base = std::env::temp_dir().join(format!(
        "orqst-synthetic-default-feature-{}",
        uuid::Uuid::new_v4()
    ));
    let (ts, rs) = (private_dir(&base.join("ts")), private_dir(&base.join("rs")));
    let out = Command::new("pnpm")
        .args(["-s", "exec", "tsx"])
        .arg(manifest().join("tests/golden/default-feature.ts"))
        .arg(&ts)
        .current_dir(manifest())
        .output()
        .expect("tsx (Node 24 toolchain on PATH)");
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let node: Value = serde_json::from_slice(&out.stdout).unwrap();

    let workspace_id = "synthetic-ws-default";
    let default_id = default_feature_id(workspace_id).unwrap();
    assert_eq!(node["defaultId"].as_str().unwrap(), default_id.as_str());

    let t1 = "00000000-0000-4000-8000-0000000000a1".to_string();
    let t2 = "00000000-0000-4000-8000-0000000000b1".to_string();
    let t3 = "00000000-0000-4000-8000-0000000000c1".to_string();
    let clock = Arc::new(AtomicU64::new(5_000));
    let tick = clock.clone();
    let mut db = FeatureContext::new(
        rs.clone(),
        workspace_id.into(),
        "0".repeat(64),
        vec![t1.clone(), t2.clone(), t3.clone()],
    );
    db.env = Env {
        now: Box::new(move || tick.fetch_add(11, Ordering::SeqCst) + 11),
        new_id: Box::new(|| uuid::Uuid::new_v4().to_string()),
    };
    let (first_feature, first_view, _) = db
        .assign_to_open_or_default(None, std::slice::from_ref(&t1), Some("Geral"))
        .unwrap();
    assert_eq!(first_feature.feature_id, default_id);
    assert_eq!(first_view.feature_id.as_deref(), Some(default_id.as_str()));
    let record: TerminalLayoutRecord = serde_json::from_value(serde_json::json!({
        "version": 1,
        "order": [t1],
        "shown": [t1],
        "active": t1,
        "maximized": t1,
        "axis": "columns",
        "columns": 1,
        "percent": 50,
        "names": [],
    }))
    .unwrap();
    db.save_layout(&default_id, &record).unwrap();
    let moved = db
        .assign_terminal(&default_id, &t2, first_feature.revision)
        .unwrap();
    assert_eq!(moved.terminal_ids, vec![t1.clone(), t2.clone()]);
    let (reused_feature, reused_view, _) = db
        .assign_to_open_or_default(None, std::slice::from_ref(&t3), Some("General"))
        .unwrap();
    assert_eq!(reused_feature.name, "Geral");
    assert_eq!(reused_feature.terminal_ids, vec![t1, t2, t3]);
    assert_eq!(reused_view.feature_id.as_deref(), Some(default_id.as_str()));
    assert_eq!(
        serde_json::to_value(db.read_layout(&default_id).unwrap()).unwrap(),
        node["layout"]
    );

    let file = |root: &Path| root.join("terminal-layouts/preferences.sqlite");
    assert_eq!(dump(&file(&rs)), dump(&file(&ts)));
    std::fs::remove_dir_all(base).unwrap();
}
