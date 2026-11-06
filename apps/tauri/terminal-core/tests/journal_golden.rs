//! The Rust journal produces the same rows as the TypeScript journal (synthetic fixture).
use orqst_terminal_core::journal::{Exit, Journal};
use orqst_terminal_core::store::Store;
use rusqlite::Connection;
use std::path::Path;
use std::process::Command;
use std::sync::atomic::{AtomicI64, Ordering};

static CLOCK: AtomicI64 = AtomicI64::new(1_000);
fn now() -> i64 {
    CLOCK.fetch_add(7, Ordering::SeqCst) + 7
}

fn dump(file: &Path) -> serde_json::Value {
    let db = Connection::open(file).unwrap();
    let mut rows = Vec::new();
    let mut s = db.prepare("SELECT * FROM terminal_attempts ORDER BY instance_id").unwrap();
    let mut q = s.query([]).unwrap();
    while let Some(r) = q.next().unwrap() {
        rows.push(serde_json::json!({
            "instance_id": r.get::<_, String>(0).unwrap(), "epoch": r.get::<_, String>(1).unwrap(),
            "project_id": r.get::<_, String>(2).unwrap(), "state": r.get::<_, String>(3).unwrap(),
            "updated_at": r.get::<_, i64>(4).unwrap(), "metadata": r.get::<_, String>(5).unwrap()}));
    }
    let mut schema = Vec::new();
    let mut s = db.prepare("SELECT name, sql FROM sqlite_master WHERE name LIKE 'terminal_%' ORDER BY name").unwrap();
    let mut q = s.query([]).unwrap();
    while let Some(r) = q.next().unwrap() {
        schema.push(serde_json::json!({"name": r.get::<_, String>(0).unwrap(), "sql": r.get::<_, String>(1).unwrap()}));
    }
    let version: i64 = db.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
    let owners: i64 = db.query_row("SELECT COUNT(*) FROM terminal_owner", [], |r| r.get(0)).unwrap();
    serde_json::json!({"schema": schema, "rows": rows, "owners": owners, "version": version})
}

#[test]
fn journal_rows_equal_the_typescript_journal() {
    let base = std::env::temp_dir().join(format!("orqst-synthetic-journal-{}", uuid::Uuid::new_v4()));
    let (ts, rs) = (base.join("ts"), base.join("rs"));
    std::fs::create_dir_all(&ts).unwrap();
    let script = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/golden/journal.ts");
    let out = Command::new("pnpm").args(["-s", "exec", "tsx"]).arg(&script).arg(&ts)
        .current_dir(env!("CARGO_MANIFEST_DIR")).output().expect("tsx (Node 24 toolchain on PATH)");
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    let expected = dump(&ts.join("terminal.sqlite"));

    let epoch = "00000000-0000-4000-8000-0000000000e1";
    let (a, b) = ("00000000-0000-4000-8000-0000000000a1", "00000000-0000-4000-8000-0000000000b1");
    let store = Store::open(&rs.join("terminal.sqlite")).unwrap();
    let mut j = Journal::open(store, epoch, false, now).unwrap();
    j.prepare(a, "desktop-managed", "p1", &"a".repeat(64)).unwrap();
    j.prepare(b, "desktop-managed", "p2", &"b".repeat(64)).unwrap();
    j.transition(a, "starting", None).unwrap();
    j.transition(a, "running", None).unwrap();
    j.transition(a, "exited", Some(Exit { exit_code: Some(3), signal: Some(0.into()) })).unwrap();
    j.transition(b, "starting", None).unwrap();
    j.release().unwrap();
    drop(j);
    assert_eq!(dump(&rs.join("terminal.sqlite")), expected);
    std::fs::remove_dir_all(base).unwrap();
}
