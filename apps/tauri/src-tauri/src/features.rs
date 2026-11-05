//! Metadata-only facade over the existing selected Terminal Core. No execution transport is exposed.
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::webview::{NewWindowResponse, WebviewBuilder};
use tauri::{Manager, Webview, WebviewUrl, Window, WindowEvent};

const CHROME_URL: &str = "orqst-features://local/index.html";
#[derive(Default)]
pub struct Features(Mutex<State>);
#[derive(Default)]
struct State {
    origin: String,
    main_document: u64,
    chrome_document: u64,
    sequence: u64,
    installing: bool,
    chrome_capability: bool,
    snapshot_generation: u64,
    view_revision: u64,
    workspace_id: Option<String>,
    feature_revisions: HashMap<String, u64>,
    preparation_scope: Option<(Value, String, u64)>,
    last_arrangement: Option<Instant>,
}
fn exact(value: &Value, keys: &[&str]) -> bool {
    value
        .as_object()
        .is_some_and(|v| v.len() == keys.len() && keys.iter().all(|k| v.contains_key(*k)))
}
fn safe(value: &Value) -> Option<u64> {
    value.as_u64().filter(|n| *n <= 9_007_199_254_740_991)
}
pub(crate) fn uuid(value: &Value) -> bool {
    value.as_str().is_some_and(|s| {
        s.len() == 36
            && s.bytes().enumerate().all(|(i, b)| {
                if [8, 13, 18, 23].contains(&i) {
                    b == b'-'
                } else {
                    b.is_ascii_hexdigit()
                }
            })
            && (s == "00000000-0000-0000-0000-000000000000"
                || s == "ffffffff-ffff-ffff-ffff-ffffffffffff"
                || ((b'1'..=b'8').contains(&s.as_bytes()[14])
                    && matches!(s.as_bytes()[19], b'8' | b'9' | b'a' | b'b' | b'A' | b'B')))
    })
}
fn text(value: &Value, maximum: usize, nonempty: bool) -> bool {
    value
        .as_str()
        .is_some_and(|s| s.encode_utf16().count() <= maximum && (!nonempty || !s.trim().is_empty()))
}
fn name(value: &Value) -> bool {
    text(value, 48, true)
        && value.as_str().is_some_and(|s| {
            !s.chars().any(|c| {
                // Match the protocol's Unicode Cc/Cf rejection without a new native dependency.
                c.is_control()
                    || matches!(c,
                    '\u{ad}' | '\u{600}'..='\u{605}' | '\u{61c}' | '\u{6dd}' | '\u{70f}'
                    | '\u{890}'..='\u{891}' | '\u{8e2}' | '\u{180e}' | '\u{200b}'..='\u{200f}'
                    | '\u{202a}'..='\u{202e}' | '\u{2060}'..='\u{2064}' | '\u{2066}'..='\u{206f}'
                    | '\u{feff}' | '\u{fff9}'..='\u{fffb}' | '\u{110bd}' | '\u{110cd}'
                    | '\u{13430}'..='\u{1343f}' | '\u{1bca0}'..='\u{1bca3}'
                    | '\u{1d173}'..='\u{1d17a}' | '\u{e0001}' | '\u{e0020}'..='\u{e007f}')
            })
        })
}
fn status(value: &Value) -> bool {
    matches!(
        value.as_str(),
        Some("planned" | "active" | "blocked" | "completed" | "archived")
    )
}
fn id_list(value: &Value) -> bool {
    value.as_array().is_some_and(|a| {
        a.len() <= 8
            && a.iter().all(uuid)
            && a.iter().map(Value::to_string).collect::<HashSet<_>>().len() == a.len()
    })
}
pub(crate) fn valid_request(value: &Value) -> bool {
    if value["contractVersion"] != 1 || safe(&value["generation"]).is_none() {
        return false;
    }
    match value["action"].as_str() {
        Some("snapshot" | "canvas") => exact(value, &["contractVersion", "generation", "action"]),
        Some("arrange") => valid_arrangement_request(value),
        Some("create") => {
            exact(value, &["contractVersion", "generation", "action", "input"])
                && value["input"].as_object().is_some_and(|o| {
                    o.keys()
                        .all(|k| ["name", "description", "status"].contains(&k.as_str()))
                })
                && name(&value["input"]["name"])
                && (value["input"].get("description").is_none()
                    || text(&value["input"]["description"], 2048, false))
                && (value["input"].get("status").is_none() || status(&value["input"]["status"]))
        }
        Some("update") => {
            exact(
                value,
                &[
                    "contractVersion",
                    "generation",
                    "action",
                    "featureId",
                    "input",
                ],
            ) && uuid(&value["featureId"])
                && value["input"].as_object().is_some_and(|o| {
                    o.len() >= 2
                        && o.keys().all(|k| {
                            [
                                "expectedRevision",
                                "name",
                                "description",
                                "status",
                                "orchestratorTerminalId",
                            ]
                            .contains(&k.as_str())
                        })
                })
                && safe(&value["input"]["expectedRevision"]).is_some_and(|n| n > 0)
                && (value["input"].get("name").is_none() || name(&value["input"]["name"]))
                && (value["input"].get("description").is_none()
                    || text(&value["input"]["description"], 2048, false))
                && (value["input"].get("status").is_none() || status(&value["input"]["status"]))
                && (value["input"].get("orchestratorTerminalId").is_none()
                    || value["input"]["orchestratorTerminalId"].is_null()
                    || uuid(&value["input"]["orchestratorTerminalId"]))
        }
        Some("assign") => {
            exact(
                value,
                &[
                    "contractVersion",
                    "generation",
                    "action",
                    "featureId",
                    "slot",
                    "expectedRevision",
                ],
            ) && uuid(&value["featureId"])
                && safe(&value["slot"]).is_some_and(|n| n < 8)
                && safe(&value["expectedRevision"]).is_some_and(|n| n > 0)
        }
        Some("select") => {
            exact(
                value,
                &[
                    "contractVersion",
                    "generation",
                    "action",
                    "featureId",
                    "expectedRevision",
                ],
            ) && (value["featureId"].is_null() || uuid(&value["featureId"]))
                && safe(&value["expectedRevision"]).is_some()
        }
        Some("organize") => {
            exact(
                value,
                &["contractVersion", "generation", "action", "command"],
            ) && matches!(
                value["command"].as_str(),
                Some("restore" | "show-all" | "columns-1" | "columns-2" | "columns-3")
            )
        }
        Some("pane" | "renamePane" | "movePane") => {
            let keys = match value["action"].as_str() {
                Some("pane") => vec![
                    "contractVersion",
                    "generation",
                    "action",
                    "slot",
                    "terminalId",
                    "command",
                ],
                Some("renamePane") => vec![
                    "contractVersion",
                    "generation",
                    "action",
                    "slot",
                    "terminalId",
                    "name",
                ],
                _ => vec![
                    "contractVersion",
                    "generation",
                    "action",
                    "slot",
                    "terminalId",
                    "beforeSlot",
                    "beforeTerminalId",
                ],
            };
            exact(value, &keys)
                && safe(&value["slot"]).is_some_and(|n| n < 8)
                && uuid(&value["terminalId"])
                && match value["action"].as_str() {
                    Some("pane") => matches!(
                        value["command"].as_str(),
                        Some(
                            "focus"
                                | "hide"
                                | "maximize"
                                | "restore"
                                | "move-earlier"
                                | "move-later"
                        )
                    ),
                    Some("renamePane") => name(&value["name"]),
                    _ => {
                        safe(&value["beforeSlot"]).is_some_and(|n| n < 8)
                            && uuid(&value["beforeTerminalId"])
                    }
                }
        }
        _ => false,
    }
}

fn valid_arrangement_request(value: &Value) -> bool {
    if !exact(
        value,
        &[
            "contractVersion",
            "generation",
            "action",
            "layoutVersion",
            "mode",
            "viewport",
            "panes",
        ],
    ) || value["layoutVersion"] != 1
        || !matches!(
            value["mode"].as_str(),
            Some("mosaic" | "columns" | "rows" | "focus" | "list" | "free")
        )
        || !exact(&value["viewport"], &["width", "height"])
        || !["width", "height"].iter().all(|key| {
            value["viewport"][*key]
                .as_u64()
                .is_some_and(|n| (1..=32768).contains(&n))
        })
    {
        return false;
    }
    let Some(panes) = value["panes"].as_array().filter(|panes| panes.len() <= 8) else {
        return false;
    };
    let mut slots = HashSet::new();
    let mut ids = HashSet::new();
    let mut count = 0;
    let (width, height) = (
        value["viewport"]["width"].as_f64().unwrap(),
        value["viewport"]["height"].as_f64().unwrap(),
    );
    let mut rects: Vec<(f64, f64, f64, f64)> = Vec::new();
    for pane in panes {
        if !exact(pane, &["slot", "terminalId", "visible", "z", "rect"])
            || !pane["slot"]
                .as_u64()
                .is_some_and(|n| n < 8 && slots.insert(n))
            || !uuid(&pane["terminalId"])
            || !ids.insert(pane["terminalId"].to_string())
            || !pane["z"].as_u64().is_some_and(|n| n <= 255)
            || !pane["visible"].is_boolean()
        {
            return false;
        }
        if pane["visible"] == false {
            if !pane["rect"].is_null() {
                return false;
            }
            continue;
        }
        count += 1;
        if !exact(&pane["rect"], &["x", "y", "width", "height"]) {
            return false;
        }
        let Some(values) = ["x", "y", "width", "height"]
            .iter()
            .map(|key| pane["rect"][*key].as_f64())
            .collect::<Option<Vec<_>>>()
        else {
            return false;
        };
        let (x, y, w, h) = (values[0], values[1], values[2], values[3]);
        if values
            .iter()
            .any(|n| !n.is_finite() || *n < 0.0 || *n > 32768.0)
            || w <= 0.0
            || h <= 0.0
            || x + w > width
            || y + h > height
            || (x + w).round() <= x.round()
            || (y + h).round() <= y.round()
        {
            return false;
        }
        if value["mode"] != "free"
            && rects
                .iter()
                .any(|(px, py, pw, ph)| x < px + pw && *px < x + w && y < py + ph && *py < y + h)
        {
            return false;
        }
        rects.push((x, y, w, h));
    }
    !(value["mode"] == "list" && count != 0 || value["mode"] == "focus" && count > 1)
}
pub(crate) fn valid_envelope(value: &Value) -> bool {
    exact(value, &["kind", "id", "document", "source", "request"])
        && value["kind"] == "feature-request"
        && uuid(&value["id"])
        && safe(&value["document"]).is_some_and(|n| n > 0)
        && text(&value["source"], 4096, true)
        && valid_request(&value["request"])
}
// Private policy transport is separate from the renderer-facing metadata allowlist.
fn valid_policy(value: &Value) -> bool {
    if !exact(value, &["schemaVersion", "rules"]) || value["schemaVersion"] != 1 {
        return false;
    }
    let Some(rules) = value["rules"].as_array() else {
        return false;
    };
    if rules.len() > 56 {
        return false;
    }
    let mut pairs = HashSet::new();
    let mut edges: HashMap<String, Vec<String>> = HashMap::new();
    for rule in rules {
        if !exact(
            rule,
            &["sourceTerminalId", "targetTerminalId", "operations"],
        ) || !uuid(&rule["sourceTerminalId"])
            || !uuid(&rule["targetTerminalId"])
            || rule["sourceTerminalId"] == rule["targetTerminalId"]
        {
            return false;
        }
        let source = rule["sourceTerminalId"].as_str().unwrap();
        let target = rule["targetTerminalId"].as_str().unwrap();
        if !pairs.insert((source, target)) {
            return false;
        }
        let Some(operations) = rule["operations"].as_array() else {
            return false;
        };
        let mut seen = HashSet::new();
        if operations.len() > 3
            || operations.iter().any(|v| {
                !matches!(v.as_str(), Some("delegate" | "execute" | "view"))
                    || !seen.insert(v.to_string())
            })
        {
            return false;
        }
        if operations.iter().any(|v| v == "delegate") {
            edges.entry(source.into()).or_default().push(target.into());
        }
    }
    fn cycle<'a>(
        id: &'a str,
        edges: &'a HashMap<String, Vec<String>>,
        visiting: &mut HashSet<&'a str>,
        done: &mut HashSet<&'a str>,
    ) -> bool {
        if visiting.contains(id) {
            return true;
        }
        if done.contains(id) {
            return false;
        }
        visiting.insert(id);
        if edges
            .get(id)
            .is_some_and(|next| next.iter().any(|n| cycle(n, edges, visiting, done)))
        {
            return true;
        }
        visiting.remove(id);
        done.insert(id);
        false
    }
    let mut visiting = HashSet::new();
    let mut done = HashSet::new();
    !edges
        .keys()
        .any(|id| cycle(id, &edges, &mut visiting, &mut done))
}
pub(crate) fn valid_permission_envelope(value: &Value) -> bool {
    if !exact(
        value,
        &["kind", "id", "document", "source", "actorId", "request"],
    ) || value["kind"] != "feature-permission-request"
        || !uuid(&value["id"])
        || !safe(&value["document"]).is_some_and(|n| n > 0)
        || value["source"] != CHROME_URL
        || !value["actorId"].as_str().is_some_and(|id| {
            id.strip_prefix("native-")
                .is_some_and(|epoch| uuid(&json!(epoch)))
        })
    {
        return false;
    }
    let request = &value["request"];
    if request["contractVersion"] != 1
        || safe(&request["generation"]).is_none()
        || !uuid(&request["featureId"])
    {
        return false;
    }
    match request["action"].as_str() {
        Some("readPermissions") => exact(
            request,
            &["action", "contractVersion", "generation", "featureId"],
        ),
        Some("savePermissions") => {
            exact(
                request,
                &[
                    "action",
                    "contractVersion",
                    "generation",
                    "featureId",
                    "expectedRevision",
                    "expectedFeatureRevision",
                    "expectedViewRevision",
                    "configuration",
                    "reviewPlan",
                    "reviewDigest",
                ],
            ) && safe(&request["expectedRevision"]).is_some()
                && safe(&request["expectedFeatureRevision"]).is_some_and(|n| n > 0)
                && safe(&request["expectedViewRevision"]).is_some()
                && valid_policy(&request["configuration"])
                && request["reviewPlan"]
                    .as_str()
                    .is_some_and(|s| !s.is_empty() && s.len() <= 131072)
                && request["reviewDigest"].as_str().is_some_and(|s| {
                    s.len() == 64
                        && s.bytes()
                            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
                })
        }
        _ => false,
    }
}
fn valid_permission_state(value: &Value) -> bool {
    exact(
        value,
        &[
            "schemaVersion",
            "workspaceId",
            "featureId",
            "revision",
            "configuration",
        ],
    ) && value["schemaVersion"] == 1
        && workspace_id(&value["workspaceId"])
        && uuid(&value["featureId"])
        && safe(&value["revision"]).is_some_and(|revision| {
            if revision == 0 {
                value["configuration"].is_null()
            } else {
                valid_policy(&value["configuration"])
            }
        })
}
pub(crate) fn valid_permission_reply(value: &Value) -> bool {
    let Some(object) = value.as_object() else {
        return false;
    };
    if !object
        .keys()
        .all(|k| ["status", "snapshot", "permissions"].contains(&k.as_str()))
        || !matches!(
            value["status"].as_str(),
            Some(
                "ok" | "denied" | "stale" | "busy" | "unavailable" | "unknown" | "archive_blocked"
            )
        )
        || (value.get("snapshot").is_some() && !valid_snapshot(&value["snapshot"]))
        || (value.get("permissions").is_some() && !valid_permission_state(&value["permissions"]))
    {
        return false;
    }
    if value["status"] == "ok"
        && (value.get("snapshot").is_none() || value.get("permissions").is_none())
    {
        return false;
    }
    if let Some(permissions) = value.get("permissions") {
        let Some(snapshot) = value.get("snapshot") else {
            return false;
        };
        let Some(feature) = snapshot["features"]
            .as_array()
            .unwrap()
            .iter()
            .find(|f| f["featureId"] == permissions["featureId"])
        else {
            return false;
        };
        if permissions["workspaceId"] != snapshot["workspace"]["id"]
            || (!permissions["configuration"].is_null()
                && !policy_members(&permissions["configuration"], feature))
        {
            return false;
        }
    }
    true
}
pub(crate) fn workspace_id(value: &Value) -> bool {
    value.as_str().is_some_and(|s| {
        !s.is_empty()
            && s.len() <= 128
            && s.bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
    })
}
pub(crate) fn valid_snapshot(v: &Value) -> bool {
    if !exact(
        v,
        &[
            "contractVersion",
            "storage",
            "generation",
            "workspace",
            "features",
            "view",
            "activeFeatureId",
            "slots",
            "layoutSaved",
        ],
    ) || v["contractVersion"] != 1
        || v["storage"] != "core"
        || safe(&v["generation"]).is_none()
        || !exact(&v["workspace"], &["id", "name"])
        || !workspace_id(&v["workspace"]["id"])
        || !text(&v["workspace"]["name"], 2048, true)
        || !exact(
            &v["view"],
            &[
                "contractVersion",
                "storage",
                "workspaceId",
                "featureId",
                "revision",
            ],
        )
        || v["view"]["contractVersion"] != 1
        || v["view"]["storage"] != "core"
        || v["view"]["workspaceId"] != v["workspace"]["id"]
        || !(v["view"]["featureId"].is_null() || uuid(&v["view"]["featureId"]))
        || safe(&v["view"]["revision"]).is_none()
        || !v["layoutSaved"].is_boolean()
    {
        return false;
    }
    let (Some(features), Some(slots)) = (v["features"].as_array(), v["slots"].as_array()) else {
        return false;
    };
    if features.len() > 1024 || slots.is_empty() || slots.len() > 8 {
        return false;
    }
    let mut feature_ids = HashSet::new();
    let mut members = HashSet::new();
    let mut slot_ids = HashSet::new();
    for f in features {
        let base_keys = [
            "schemaVersion",
            "workspaceId",
            "featureId",
            "name",
            "description",
            "status",
            "revision",
            "terminalIds",
            "createdAt",
            "updatedAt",
        ];
        let mut keys_with_label = base_keys.to_vec();
        keys_with_label.push("orchestratorTerminalId");
        if !(exact(f, &base_keys) || exact(f, &keys_with_label))
            || (f.get("orchestratorTerminalId").is_some()
                && !(f["orchestratorTerminalId"].is_null()
                    || (uuid(&f["orchestratorTerminalId"])
                        && f["terminalIds"]
                            .as_array()
                            .is_some_and(|ids| ids.contains(&f["orchestratorTerminalId"])))))
            || f["schemaVersion"] != 1
            || f["workspaceId"] != v["workspace"]["id"]
            || !uuid(&f["featureId"])
            || !feature_ids.insert(f["featureId"].to_string())
            || !name(&f["name"])
            || !text(&f["description"], 2048, false)
            || !status(&f["status"])
            || !safe(&f["revision"]).is_some_and(|n| n > 0)
            || safe(&f["createdAt"]).is_none()
            || safe(&f["updatedAt"]).is_none()
            || !id_list(&f["terminalIds"])
        {
            return false;
        }
        for id in f["terminalIds"].as_array().unwrap() {
            if !members.insert(id.to_string()) {
                return false;
            }
        }
    }
    if !(v["activeFeatureId"].is_null()
        || (uuid(&v["activeFeatureId"]) && feature_ids.contains(&v["activeFeatureId"].to_string())))
    {
        return false;
    }
    if !v["view"]["featureId"].is_null()
        && !feature_ids.contains(&v["view"]["featureId"].to_string())
    {
        return false;
    }
    for (i, s) in slots.iter().enumerate() {
        if !s.as_object().is_some_and(|o| {
            o.keys().all(|key| {
                matches!(
                    key.as_str(),
                    "slot"
                        | "terminalId"
                        | "provider"
                        | "selectedModel"
                        | "workspace"
                        | "agentState"
                )
            }) && o.contains_key("slot")
                && o.contains_key("terminalId")
                && o.contains_key("provider")
        }) || (s.get("workspace").is_some() && s["workspace"] != v["workspace"])
            || (s.get("agentState").is_some() && s["agentState"] != "unknown")
            || (s.get("selectedModel").is_some()
                && !(s["selectedModel"].is_null()
                    || s["selectedModel"].as_str().is_some_and(|model| {
                        !model.is_empty()
                            && model.len() <= 160
                            && model.as_bytes()[0].is_ascii_alphanumeric()
                            && model.bytes().all(|byte| {
                                byte.is_ascii_alphanumeric() || b"._:/#@+-".contains(&byte)
                            })
                    })))
            || s["slot"].as_u64() != Some(i as u64)
            || !uuid(&s["terminalId"])
            || !slot_ids.insert(s["terminalId"].to_string())
            || !matches!(
                s["provider"].as_str(),
                Some("codex" | "claude" | "opencode")
            )
        {
            return false;
        }
    }
    true
}
pub(crate) fn valid_reply(value: &Value) -> bool {
    value.as_object().is_some_and(|o| {
        o.keys()
            .all(|key| matches!(key.as_str(), "status" | "snapshot" | "canvas"))
            && o.contains_key("status")
            && matches!(
                value["status"].as_str(),
                Some("ok" | "denied" | "stale" | "busy" | "unavailable" | "archive_blocked")
            )
            && (value.get("snapshot").is_none() || valid_snapshot(&value["snapshot"]))
            && (value.get("canvas").is_none()
                || (value.get("snapshot").is_some()
                    && valid_canvas(&value["canvas"], &value["snapshot"])))
            && (value["status"] != "ok" || value.get("snapshot").is_some())
    })
}
fn valid_canvas(value: &Value, snapshot: &Value) -> bool {
    if !exact(value, &["observedAt", "entries"]) {
        return false;
    }
    let Some(observed) = safe(&value["observedAt"]) else {
        return false;
    };
    let Some(entries) = value["entries"].as_array() else {
        return false;
    };
    let Some(slots) = snapshot["slots"].as_array() else {
        return false;
    };
    if entries.len() > 8 {
        return false;
    }
    let mut seen = HashSet::new();
    entries.iter().all(|entry| {
        let Some(slot) = entry["slot"].as_u64() else {
            return false;
        };
        let Some(member) = slots
            .iter()
            .find(|s| s["slot"] == slot && s["terminalId"] == entry["terminalId"])
        else {
            return false;
        };
        if !seen.insert(slot) {
            return false;
        }
        let has_session = entry.get("session").is_some() || entry.get("activities").is_some();
        if has_session {
            let session = &entry["session"];
            if member["provider"] != "claude"
                || !exact(session, &["provider", "sessionId", "bindingEvidence"])
                || session["provider"] != "claude"
                || !uuid(&session["sessionId"])
                || session["bindingEvidence"] != "claude-argv-receipt-transcript"
                || !entry["activities"].as_array().is_some_and(|activities| {
                    activities.len() <= 3
                        && activities.iter().all(|item| {
                            exact(item, &["at", "kind", "label"])
                                && item["kind"] == "tool"
                                && safe(&item["at"]).is_some_and(|at| at <= observed)
                                && item["label"].as_str().is_some_and(|label| {
                                    !label.is_empty()
                                        && label.len() <= 64
                                        && label.as_bytes()[0].is_ascii_alphabetic()
                                        && label.bytes().all(|byte| {
                                            byte.is_ascii_alphanumeric() || b"_.-".contains(&byte)
                                        })
                                })
                        })
                })
            {
                return false;
            }
        }
        match entry["state"].as_str() {
            Some("unknown") => exact(entry, &["slot", "terminalId", "state"]),
            Some("running") => {
                (exact(entry, &["slot", "terminalId", "state", "startedAt"])
                    || exact(
                        entry,
                        &[
                            "slot",
                            "terminalId",
                            "state",
                            "startedAt",
                            "session",
                            "activities",
                        ],
                    ))
                    && safe(&entry["startedAt"]).is_some_and(|start| start <= observed)
            }
            Some("exited") => {
                (exact(
                    entry,
                    &["slot", "terminalId", "state", "startedAt", "exitedAt"],
                ) || exact(
                    entry,
                    &[
                        "slot",
                        "terminalId",
                        "state",
                        "startedAt",
                        "exitedAt",
                        "session",
                        "activities",
                    ],
                )) && safe(&entry["startedAt"])
                    .zip(safe(&entry["exitedAt"]))
                    .is_some_and(|(start, end)| start <= end && end <= observed)
            }
            _ => false,
        }
    })
}
fn document_matches(label: &str, parent: &str, source: &str, origin: &str) -> bool {
    if label == "feature-workspace" {
        return parent == "main" && source == CHROME_URL;
    }
    let Ok(url) = tauri::Url::parse(source) else {
        return false;
    };
    label == "main"
        && parent == "main"
        && url.origin().ascii_serialization() == origin
        && matches!(url.path(), "/" | "/studio")
        && url.query().is_none()
        && url.fragment().is_none()
        && url.username().is_empty()
        && url.password().is_none()
}
fn document_version(state: &State, main: bool) -> u64 {
    if main {
        state.main_document
    } else {
        state.chrome_document
    }
}
// Snapshot before a potentially blocking UI getter, then reject invalidation during the wait.
fn identity_from(
    state: &Mutex<State>,
    main: bool,
    read_source: impl FnOnce() -> Option<String>,
    matches: impl FnOnce(&str, &str) -> bool,
) -> Option<(String, u64)> {
    let expected = {
        let guard = state.lock().unwrap();
        (guard.origin.clone(), document_version(&guard, main))
    };
    let source = read_source()?;
    let guard = state.lock().unwrap();
    (expected.1 > 0
        && guard.origin == expected.0
        && document_version(&guard, main) == expected.1
        && matches(&source, &guard.origin))
    .then_some((source, expected.1))
}
/// The dock restore is accepted only from the exact chrome child of main.
pub(crate) fn restore_source_allowed(label: &str, parent: &str, source: &str) -> bool {
    label == "feature-workspace" && parent == "main" && source == CHROME_URL
}

/// Exact chrome document identity for the dock route; no process or metadata authority.
pub(crate) fn chrome_identity(view: &Webview) -> Option<(String, u64)> {
    let identity = identity(view)?;
    restore_source_allowed(view.label(), view.window().label(), &identity.0).then_some(identity)
}

// Keep the getter-free document fence through the pipe write. Navigation invalidates this mutex.
fn with_chrome_version(state: &Mutex<State>, document: u64, write: impl FnOnce() -> bool) -> bool {
    let guard = state.lock().unwrap();
    document > 0 && guard.chrome_document == document && write()
}

pub(crate) fn with_chrome_document(
    app: &tauri::AppHandle,
    document: u64,
    write: impl FnOnce() -> bool,
) -> bool {
    with_chrome_version(&app.state::<Features>().0, document, write)
}

fn identity(view: &Webview) -> Option<(String, u64)> {
    let parent = view.window();
    identity_from(
        &view.state::<Features>().0,
        view.label() == "main",
        || view.url().ok().map(|url| url.to_string()),
        |source, origin| document_matches(view.label(), parent.label(), source, origin),
    )
}
pub(crate) fn document_current(app: &tauri::AppHandle, source: &str, document: u64) -> bool {
    ["main", "feature-workspace"].into_iter().any(|label| {
        app.get_webview(label)
            .is_some_and(|view| identity(&view) == Some((source.into(), document)))
    })
}
/// Getter-free final fence under Terminals. Invalidation drops Features before taking Terminals.
pub(crate) fn document_version_current(
    app: &tauri::AppHandle,
    source: &str,
    document: u64,
) -> bool {
    let state = app.state::<Features>();
    let guard = state.0.lock().unwrap();
    let main = source != CHROME_URL;
    document > 0
        && document_version(&guard, main) == document
        && document_matches(
            if main { "main" } else { "feature-workspace" },
            // Both surfaces are child webviews of the single main window.
            "main",
            source,
            &guard.origin,
        )
}
/// Same AppKit first-responder check as the terminal client; renderer focus is never proof.
pub(crate) async fn focused(view: &Webview) -> bool {
    if !view.window().is_visible().unwrap_or(false) || !view.window().is_focused().unwrap_or(false)
    {
        return false;
    }
    #[cfg(target_os = "macos")]
    {
        let (tx, rx) = tokio::sync::oneshot::channel();
        if view
            .with_webview(move |native| {
                let valid = unsafe {
                    use objc2::runtime::AnyObject;
                    use objc2::{msg_send, sel};
                    let webview = native.inner().cast::<AnyObject>();
                    let window: *mut AnyObject = msg_send![webview, window];
                    if window.is_null() {
                        false
                    } else {
                        let responder: *mut AnyObject = msg_send![window, firstResponder];
                        !responder.is_null() && {
                            let is_view: bool =
                                msg_send![responder, respondsToSelector:sel!(isDescendantOf:)];
                            is_view && msg_send![responder,isDescendantOf:webview]
                        }
                    }
                };
                let _ = tx.send(valid);
            })
            .is_err()
        {
            return false;
        }
        matches!(
            tokio::time::timeout(std::time::Duration::from_secs(1), rx).await,
            Ok(Ok(true))
        )
    }
    #[cfg(not(target_os = "macos"))]
    false
}
async fn focus_then_current(
    focus: impl std::future::Future<Output = bool>,
    current: impl FnOnce() -> bool,
) -> bool {
    let focused = focus.await;
    focused && current()
}
struct MetadataCompletion<F: FnOnce(bool)> {
    finish: Option<F>,
    completed: bool,
}
impl<F: FnOnce(bool)> Drop for MetadataCompletion<F> {
    fn drop(&mut self) {
        if let Some(finish) = self.finish.take() {
            finish(!self.completed);
        }
    }
}
async fn with_metadata_completion<T>(
    work: impl std::future::Future<Output = T>,
    finish: impl FnOnce(bool),
) -> T {
    let mut completion = MetadataCompletion {
        finish: Some(finish),
        completed: false,
    };
    let value = work.await;
    completion.completed = true;
    value
}
fn valid_preparation_request(value: &Value) -> bool {
    exact(
        value,
        &[
            "contractVersion",
            "generation",
            "workspaceId",
            "featureId",
            "expectedRevision",
        ],
    ) && value["contractVersion"] == 1
        && safe(&value["generation"]).is_some()
        && safe(&value["expectedRevision"]).is_some()
        && value["workspaceId"].as_str().is_some_and(|id| {
            !id.is_empty()
                && id.len() <= 128
                && id
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-'))
        })
        && (value["featureId"].is_null() || uuid(&value["featureId"]))
}
fn preparation_scope_current(
    state: &State,
    request: &Value,
    epoch: &str,
    presentation: u64,
) -> bool {
    state
        .preparation_scope
        .as_ref()
        .is_some_and(|(scope, known_epoch, known_presentation)| {
            scope == request && known_epoch == epoch && *known_presentation == presentation
        })
}
fn dashboard_document_matches(label: &str, parent: &str, source: &str, origin: &str) -> bool {
    label == "main"
        && parent == "main"
        && tauri::Url::parse(source).is_ok_and(|url| {
            url.origin().ascii_serialization() == origin
                && crate::allowed_dashboard_navigation(&url, Some(origin))
                && url.query().is_none()
                && url.fragment().is_none()
        })
}
/// The existing owned dashboard may be on any approved SPA page. This grants no Studio capability.
fn dashboard_identity(view: &Webview) -> Option<(String, u64)> {
    identity_from(
        &view.state::<Features>().0,
        true,
        || view.url().ok().map(|url| url.to_string()),
        |source, origin| {
            dashboard_document_matches(view.label(), view.window().label(), source, origin)
        },
    )
}
/// View-only chrome → owned main handoff. Never forwarded to the Core metadata pipe.
#[tauri::command]
pub async fn feature_prepare(window: Webview, request: Value) -> Value {
    let denied = || json!({"status":"denied"});
    if window.label() != "feature-workspace" || !valid_preparation_request(&request) {
        return denied();
    }
    let Some(source) = identity(&window) else {
        return denied();
    };
    let app = window.app_handle();
    let Some((epoch, presentation)) = crate::terminal::metadata_context(app) else {
        return json!({"status":"unavailable"});
    };
    let Ok(admission) = crate::terminal::preparation_admission(app) else {
        return json!({"status":"busy"});
    };
    if !crate::terminal_creation::navigation_available(app) {
        return json!({"status":"busy"});
    }
    let Some(main) = app.get_webview("main") else {
        return denied();
    };
    let Some(target) = dashboard_identity(&main) else {
        return denied();
    };
    if !preparation_scope_current(
        &app.state::<Features>().0.lock().unwrap(),
        &request,
        &epoch,
        presentation,
    ) {
        return json!({"status":"stale"});
    }
    if !focus_then_current(focused(&window), || {
        identity(&window) == Some(source)
            && dashboard_identity(&main) == Some(target.clone())
            && crate::terminal::metadata_context(app) == Some((epoch.clone(), presentation))
            && crate::terminal::preparation_admission_current(app, &admission)
            && crate::terminal_creation::navigation_available(app)
            && preparation_scope_current(
                &app.state::<Features>().0.lock().unwrap(),
                &request,
                &epoch,
                presentation,
            )
    })
    .await
    {
        return denied();
    }
    // Changing windows revokes existing input through the existing native focus observer.
    // Only this authenticated target receives IDs; the drawer starts no execution on opening.
    if main.window().unminimize().is_err()
        || main.window().show().is_err()
        || main.window().set_focus().is_err()
    {
        return json!({"status":"unavailable"});
    }
    if dashboard_identity(&main) != Some(target)
        || crate::terminal::metadata_context(app) != Some((epoch.clone(), presentation))
        || !crate::terminal::preparation_admission_current(app, &admission)
        || !crate::terminal_creation::navigation_available(app)
    {
        return denied();
    }
    // Main's DOM dialog cannot cover sibling WKWebViews. End the current view presentation
    // after the final source checks; keep every owned document/process retained.
    crate::terminal::metadata_invalidate(app);
    crate::terminal::suspend_surface(app);
    if main.set_focus().is_err() {
        return json!({"status":"unavailable"});
    }
    if main
        .eval(format!(
            "window.dispatchEvent(new CustomEvent('orqst-show-preparation',{{detail:{request}}}));"
        ))
        .is_err()
    {
        return json!({"status":"unavailable"});
    }
    json!({"status":"ok"})
}
/// Permission writes are accepted only from the exact chrome child of main.
pub(crate) fn permission_source_allowed(label: &str, parent: &str, source: &str) -> bool {
    label == "feature-workspace" && parent == "main" && source == CHROME_URL
}

fn escape_plain(value: &str) -> String {
    value
        .chars()
        .filter(|c| !c.is_control())
        .flat_map(|c| match c {
            '<' => "&lt;".chars().collect::<Vec<_>>(),
            '>' => "&gt;".chars().collect(),
            '&' => "&amp;".chars().collect(),
            other => vec![other],
        })
        .collect()
}

/// Exact ID-keyed review, including operations absent from the allowlist.
pub(crate) fn permission_diff(
    feature: &str,
    current_revision: u64,
    current: &Value,
    proposed: &Value,
    labels: &HashMap<String, String>,
) -> String {
    let operations = ["delegate", "execute", "view"];
    let enabled = |policy: &Value, source: &str, target: &str| -> Vec<&'static str> {
        operations
            .into_iter()
            .filter(|operation| {
                policy["rules"].as_array().is_some_and(|rules| {
                    rules.iter().any(|r| {
                        r["sourceTerminalId"] == source
                            && r["targetTerminalId"] == target
                            && r["operations"]
                                .as_array()
                                .is_some_and(|ops| ops.iter().any(|op| op == *operation))
                    })
                })
            })
            .collect()
    };
    let mut ids: Vec<&String> = labels.keys().collect();
    ids.sort();
    let mut lines = vec![
        format!("Feature: {}", escape_plain(feature)),
        format!("Revision: {} -> {}", current_revision, current_revision + 1),
    ];
    lines.push(format!(
        "Current configuration: {}",
        escape_plain(&current.to_string())
    ));
    lines.push(format!(
        "Proposed configuration: {}",
        escape_plain(&proposed.to_string())
    ));
    if current.is_null() {
        lines.push("NEUTRAL -> ALLOWLIST: only listed operations will be allowed by this policy; all others will be denied.".into());
        if proposed["rules"].as_array().is_some_and(|rules| {
            rules
                .iter()
                .all(|r| r["operations"].as_array().is_some_and(Vec::is_empty))
        }) {
            lines.push("From now on, this policy permits no operations.".into());
        }
    }
    for source in &ids {
        for target in &ids {
            if source == target {
                continue;
            }
            let before = if current.is_null() {
                "neutral".to_string()
            } else {
                let allowed = enabled(current, source, target);
                format!("allow [{}]", allowed.join(", "))
            };
            let allowed = enabled(proposed, source, target);
            let denied: Vec<_> = operations
                .into_iter()
                .filter(|op| !allowed.contains(op))
                .collect();
            let id_label = |id: &str| {
                format!(
                    "{} ({})",
                    escape_plain(id),
                    escape_plain(labels.get(id).map(String::as_str).unwrap_or(id))
                )
            };
            lines.push(format!(
                "{} -> {}: {} => allow [{}]; implicitly denied [{}]",
                id_label(source),
                id_label(target),
                before,
                allowed.join(", "),
                denied.join(", ")
            ));
        }
    }
    lines.join("\n")
}

fn policy_members(value: &Value, feature: &Value) -> bool {
    valid_policy(value)
        && feature["terminalIds"].as_array().is_some_and(|ids| {
            value["rules"].as_array().unwrap().iter().all(|rule| {
                ids.contains(&rule["sourceTerminalId"]) && ids.contains(&rule["targetTerminalId"])
            })
        })
}

fn permission_scope_generation(
    state: &State,
    feature_id: &str,
    epoch: &str,
    presentation: u64,
) -> Option<u64> {
    let (scope, captured_epoch, captured_presentation) = state.preparation_scope.as_ref()?;
    (scope["featureId"] == feature_id
        && captured_epoch == epoch
        && *captured_presentation == presentation)
        .then_some(state.snapshot_generation)
}

pub(crate) fn permission_capture_current(
    app: &tauri::AppHandle,
    feature_id: &str,
    epoch: &str,
    presentation: u64,
    generation: u64,
) -> bool {
    permission_scope_generation(
        &app.state::<Features>().0.lock().unwrap(),
        feature_id,
        epoch,
        presentation,
    ) == Some(generation)
}

fn permission_plan_current(
    plan: &Value,
    snapshot: &Value,
    permissions: &Value,
    document: u64,
    epoch: &str,
    generation: u64,
) -> bool {
    plan["snapshot"] == *snapshot
        && plan["permissions"] == *permissions
        && plan["document"].as_u64() == Some(document)
        && plan["epoch"] == epoch
        && plan["generation"].as_u64() == Some(generation)
        && plan["featureId"] == snapshot["activeFeatureId"]
        && plan["featureId"] == permissions["featureId"]
        && plan["expectedRevision"] == permissions["revision"]
}

fn accept_permission_snapshot(
    app: &tauri::AppHandle,
    value: &Value,
    plan: &Value,
    presentation: u64,
) -> bool {
    let Some(previous_generation) = plan["generation"].as_u64() else {
        return false;
    };
    let Some(feature_id) = plan["featureId"].as_str() else {
        return false;
    };
    let Some(expected_revision) = plan["expectedRevision"].as_u64() else {
        return false;
    };
    let Some(epoch) = plan["epoch"].as_str() else {
        return false;
    };
    let configuration = &plan["configuration"];
    let snapshot = &value["snapshot"];
    let permissions = &value["permissions"];
    if !valid_permission_reply(value)
        || value["status"] != "ok"
        || snapshot["generation"].as_u64() != previous_generation.checked_add(1)
        || snapshot["activeFeatureId"] != feature_id
        || permissions["featureId"] != feature_id
        || permissions["revision"].as_u64() != expected_revision.checked_add(1)
        || permissions["configuration"] != *configuration
    {
        return false;
    }
    let state = app.state::<Features>();
    let mut guard = state.0.lock().unwrap();
    if permission_scope_generation(&guard, feature_id, epoch, presentation)
        != Some(previous_generation)
        || guard.workspace_id.as_deref() != snapshot["workspace"]["id"].as_str()
        || snapshot["view"]["revision"]
            .as_u64()
            .is_none_or(|r| r < guard.view_revision)
    {
        return false;
    }
    for feature in snapshot["features"].as_array().unwrap() {
        let id = feature["featureId"].as_str().unwrap();
        let revision = feature["revision"].as_u64().unwrap();
        if guard
            .feature_revisions
            .get(id)
            .is_some_and(|known| revision < *known)
        {
            return false;
        }
    }
    for feature in snapshot["features"].as_array().unwrap() {
        guard.feature_revisions.insert(
            feature["featureId"].as_str().unwrap().into(),
            feature["revision"].as_u64().unwrap(),
        );
    }
    guard.snapshot_generation = previous_generation + 1;
    guard.view_revision = snapshot["view"]["revision"].as_u64().unwrap();
    guard.preparation_scope = Some((
        json!({"contractVersion":1, "generation":previous_generation + 1,
        "workspaceId":snapshot["workspace"]["id"], "featureId":feature_id,
        "expectedRevision":snapshot["view"]["revision"]}),
        epoch.into(),
        presentation,
    ));
    true
}

async fn permission_metadata_request(
    app: &tauri::AppHandle,
    source: &str,
    document: u64,
    presentation: u64,
    epoch: &str,
    request: Value,
    review: Option<(&Webview, &str)>,
) -> Value {
    let id = {
        let state = app.state::<Features>();
        let mut guard = state.0.lock().unwrap();
        if guard.sequence >= 0xffffffffffff {
            return json!({"status":"unavailable"});
        }
        guard.sequence += 1;
        format!("00000000-6990-4000-8000-{:012x}", guard.sequence)
    };
    let completion_id = id.clone();
    with_metadata_completion(
        async {
            let envelope = json!({"kind":"feature-permission-request", "id":id,
                "document":document,"source":source,"actorId":format!("native-{epoch}"),"request":request});
            if let Some((view, owner)) = review {
                crate::terminal::permission_review_request(app, view.clone(), envelope, presentation, epoch, owner).await
            } else {
                crate::terminal::metadata_request(app, envelope, presentation, epoch).await
            }
        },
        |cancelled| crate::terminal::metadata_finish(app, epoch, &completion_id, cancelled),
    )
    .await
}

#[tauri::command]
pub async fn feature_permissions(window: Webview, request: Value) -> Value {
    let denied = || json!({"status":"denied"});
    let app = window.app_handle();
    let Some((source, document)) = identity(&window) else {
        return denied();
    };
    if !permission_source_allowed(window.label(), window.window().label(), &source)
        || crate::terminal::presentation_blocked(app)
    {
        return denied();
    }
    let Some((epoch, presentation)) = crate::terminal::metadata_context(app) else {
        return json!({"status":"unavailable"});
    };
    if !focus_then_current(focused(&window), || {
        identity(&window) == Some((source.clone(), document))
            && crate::terminal::metadata_context(app) == Some((epoch.clone(), presentation))
            && !crate::terminal::presentation_blocked(app)
    })
    .await
    {
        return denied();
    }
    if !match request["action"].as_str() {
        Some("read") => exact(&request, &["action", "featureId"]),
        Some("propose") => exact(
            &request,
            &["action", "featureId", "expectedRevision", "configuration"],
        ),
        _ => false,
    } || !uuid(&request["featureId"])
    {
        return denied();
    }
    let (feature_id, generation) = {
        let state = app.state::<Features>();
        let guard = state.0.lock().unwrap();
        let Some((scope, _, _)) = &guard.preparation_scope else {
            return denied();
        };
        let Some(feature_id) = scope["featureId"].as_str() else {
            return denied();
        };
        let Some(generation) =
            permission_scope_generation(&guard, feature_id, &epoch, presentation)
        else {
            return denied();
        };
        if request["featureId"] != feature_id {
            return denied();
        }
        (feature_id.to_owned(), generation)
    };
    let read = json!({"action":"readPermissions","contractVersion":1,"generation":generation,"featureId":feature_id});
    let read_reply = permission_metadata_request(
        app,
        &source,
        document,
        presentation,
        &epoch,
        read.clone(),
        None,
    )
    .await;
    if read_reply["status"] != "ok" {
        return read_reply;
    }
    if read_reply["permissions"]["featureId"] != feature_id
        || read_reply["snapshot"]["activeFeatureId"] != feature_id
        || read_reply["snapshot"]["generation"].as_u64() != Some(generation)
    {
        return denied();
    }
    if request["action"] == "read" {
        if !focus_then_current(focused(&window), || {
            identity(&window) == Some((source.clone(), document))
                && crate::terminal::metadata_context(app) == Some((epoch.clone(), presentation))
                && !crate::terminal::presentation_blocked(app)
        })
        .await
        {
            return denied();
        }
        return read_reply;
    }
    let Some(expected) = safe(&request["expectedRevision"]).filter(|n| *n < 9_007_199_254_740_991)
    else {
        return denied();
    };
    let current = read_reply["permissions"].clone();
    if current["revision"].as_u64() != Some(expected) {
        return json!({"status":"stale","permissions":current});
    }
    let snapshot = &read_reply["snapshot"];
    let Some(feature) = snapshot["features"]
        .as_array()
        .and_then(|features| features.iter().find(|f| f["featureId"] == feature_id))
    else {
        return denied();
    };
    if snapshot["activeFeatureId"] != feature_id
        || snapshot["view"]["featureId"] != feature_id
        || snapshot["generation"].as_u64() != Some(generation)
        || current["featureId"] != feature_id
        || feature["status"] == "archived"
        || !policy_members(&request["configuration"], feature)
        || (!current["configuration"].is_null()
            && !policy_members(&current["configuration"], feature))
    {
        return denied();
    }
    let mut labels = HashMap::new();
    for id in feature["terminalIds"].as_array().unwrap() {
        let Some(id) = id.as_str() else {
            return denied();
        };
        let Some(slot) = snapshot["slots"]
            .as_array()
            .unwrap()
            .iter()
            .find(|slot| slot["terminalId"] == id)
        else {
            return denied();
        };
        labels.insert(
            id.to_owned(),
            format!("T-{:03}", slot["slot"].as_u64().unwrap() + 1),
        );
    }
    let feature_name = format!("{} ({})", feature["name"].as_str().unwrap(), feature_id);
    let plan = json!({"featureId":feature_id,"expectedRevision":expected,"expectedFeatureRevision":feature["revision"],"expectedViewRevision":snapshot["view"]["revision"],"generation":generation,
        "document":document,"epoch":epoch,"snapshot":snapshot,"permissions":current,"configuration":request["configuration"]});
    let plan_text = plan.to_string();
    let digest = format!("{:x}", Sha256::digest(plan_text.as_bytes()));
    let detail = format!(
        "{}\n\nReviewed plan SHA-256: {}",
        permission_diff(
            &feature_name,
            expected,
            &current["configuration"],
            &plan["configuration"],
            &labels
        ),
        digest
    );
    let review_id = {
        let state = app.state::<Features>();
        let mut guard = state.0.lock().unwrap();
        if guard.sequence >= 0xffffffffffff {
            return denied();
        }
        guard.sequence += 1;
        format!("00000000-6990-4000-8000-{:012x}", guard.sequence)
    };
    if !crate::terminal::permission_review_begin(app, &epoch, presentation, &review_id) {
        return json!({"status":"busy"});
    }
    with_metadata_completion(async {
        let approved = crate::terminal::confirm_permission_sheet(app, window.clone(), [
            "Feature permissions".into(),
            "Approve this exact policy change? From now on only the checked operations are allowed.".into(),
            detail, "Cancel".into(), "Approve".into(),
        ], crate::terminal::PermissionReviewContext { epoch:epoch.clone(), presentation, document,
            id:review_id.clone(), feature_id:feature_id.clone(), generation }).await;
        if !approved { return json!({"status":"cancelled"}); }
        if !focus_then_current(focused(&window), || identity(&window) == Some((source.clone(), document))
            && crate::terminal::permission_review_current(app, &epoch, presentation, &review_id)
            && !crate::terminal::presentation_blocked(app)).await { return denied(); }
        let current_now = permission_metadata_request(app, &source, document, presentation, &epoch, read, Some((&window, &review_id))).await;
        if current_now["status"] != "ok" { return current_now; }
        if !permission_plan_current(&plan, &current_now["snapshot"], &current_now["permissions"], document, &epoch, generation) {
            return json!({"status":"stale"});
        }
        if !focus_then_current(focused(&window), || identity(&window) == Some((source.clone(), document))
            && crate::terminal::permission_review_current(app, &epoch, presentation, &review_id)
            && !crate::terminal::presentation_blocked(app)).await { return denied(); }
        let save = json!({"action":"savePermissions","contractVersion":1,"generation":generation,
            "featureId":feature_id,"expectedRevision":expected,"expectedFeatureRevision":plan["expectedFeatureRevision"],"expectedViewRevision":plan["expectedViewRevision"],"configuration":plan["configuration"],
            "reviewPlan":plan_text,"reviewDigest":digest});
        let result = permission_metadata_request(app, &source, document, presentation, &epoch, save, Some((&window, &review_id))).await;
        if result["status"] == "unavailable" || result["status"] == "denied" { return json!({"status":"unknown"}); }
        if result["status"] == "ok" {
            if !accept_permission_snapshot(app, &result, &plan, presentation) {
                return json!({"status":"unknown"});
            }
            publish(app, &result["snapshot"], presentation, &epoch);
        }
        result
    }, |cancelled| crate::terminal::permission_review_finish(app, &epoch, &review_id, cancelled)).await
}

#[tauri::command]
pub async fn feature_request(window: Webview, request: Value) -> Value {
    let denied = || json!({"status":"denied"});
    if !valid_request(&request) {
        return denied();
    }
    let Some((source, document)) = identity(&window) else {
        return denied();
    };
    if request["action"] == "arrange" && source != CHROME_URL {
        return denied();
    }
    let app = window.app_handle();
    if crate::terminal::presentation_blocked(app) {
        return denied();
    }
    let Some((epoch, _)) = crate::terminal::metadata_context(app) else {
        return json!({"status":"unavailable"});
    };
    let presentation = if matches!(
        request["action"].as_str(),
        Some("canvas" | "select" | "organize" | "pane" | "renamePane" | "movePane")
    ) {
        crate::terminal::metadata_view_begin(app)
    } else {
        crate::terminal::metadata_generation(app)
    };
    let Some(presentation) = presentation else {
        return json!({"status":"unavailable"});
    };
    let mutable = request["action"] != "snapshot";
    if mutable && !focused(&window).await {
        return denied();
    }
    if identity(&window) != Some((source.clone(), document))
        || crate::terminal::presentation_blocked(app)
        || crate::terminal::metadata_context(app) != Some((epoch.clone(), presentation))
    {
        return denied();
    }
    if request["action"] == "arrange" {
        let state = app.state::<Features>();
        let mut guard = state.0.lock().unwrap();
        let now = Instant::now();
        if guard
            .last_arrangement
            .is_some_and(|last| now.saturating_duration_since(last) < Duration::from_millis(16))
        {
            return json!({"status":"busy"});
        }
        guard.last_arrangement = Some(now);
    }
    let _ = install_workspace(app);
    let id = {
        let state = app.state::<Features>();
        let mut guard = state.0.lock().unwrap();
        if guard.sequence >= 0xffffffffffff {
            return denied();
        }
        guard.sequence += 1;
        format!("00000000-6990-4000-8000-{:012x}", guard.sequence)
    };
    // Keep bilateral review exclusion through final focus/context validation and publication.
    let completion_id = id.clone();
    with_metadata_completion(
        async {
            let value = crate::terminal::metadata_request(
                app,
                json!({
                    "kind": "feature-request", "id": id, "document": document,
                    "source": source, "request": request,
                }),
                presentation,
                &epoch,
            )
            .await;
            if !focus_then_current(async { !mutable || focused(&window).await }, || {
                identity(&window) == Some((source, document))
                    && !crate::terminal::presentation_blocked(app)
                    && crate::terminal::metadata_context(app) == Some((epoch.clone(), presentation))
            })
            .await
            {
                return denied();
            }
            if !valid_reply(&value) {
                return json!({"status":"unavailable"});
            }
            if let Some(snapshot) = value.get("snapshot") {
                let state = app.state::<Features>();
                let mut guard = state.0.lock().unwrap();
                let generation = snapshot["generation"].as_u64().unwrap();
                let revision = snapshot["view"]["revision"].as_u64().unwrap();
                let workspace = snapshot["workspace"]["id"].as_str().unwrap();
                if generation < guard.snapshot_generation
                    || revision < guard.view_revision
                    || guard
                        .workspace_id
                        .as_ref()
                        .is_some_and(|id| id != workspace)
                {
                    return json!({"status":"stale"});
                }
                for feature in snapshot["features"].as_array().unwrap() {
                    let id = feature["featureId"].as_str().unwrap();
                    let revision = feature["revision"].as_u64().unwrap();
                    if guard
                        .feature_revisions
                        .get(id)
                        .is_some_and(|known| revision < *known)
                    {
                        return json!({"status":"stale"});
                    }
                }
                for feature in snapshot["features"].as_array().unwrap() {
                    guard.feature_revisions.insert(
                        feature["featureId"].as_str().unwrap().into(),
                        feature["revision"].as_u64().unwrap(),
                    );
                }
                guard.snapshot_generation = generation;
                guard.view_revision = revision;
                guard.workspace_id = Some(workspace.into());
                guard.preparation_scope = Some((
                    json!({
                        "contractVersion":1, "generation":generation, "workspaceId":workspace,
                        "featureId":snapshot["activeFeatureId"], "expectedRevision":revision,
                    }),
                    epoch.clone(),
                    presentation,
                ));
                drop(guard);
                publish(app, snapshot, presentation, &epoch);
            }
            value
        },
        |cancelled| crate::terminal::metadata_finish(app, &epoch, &completion_id, cancelled),
    )
    .await
}
fn publish(app: &tauri::AppHandle, snapshot: &Value, presentation: u64, epoch: &str) {
    // Snapshot carries metadata only. It never shows/focuses a window or enables input.
    if crate::terminal::presentation_blocked(app)
        || crate::terminal::metadata_context(app) != Some((epoch.into(), presentation))
    {
        return;
    }
    for label in ["main", "feature-workspace"] {
        if let Some(view) = app.get_webview(label) {
            if identity(&view).is_some()
                && !crate::terminal::presentation_blocked(app)
                && crate::terminal::metadata_context(app) == Some((epoch.into(), presentation))
            {
                let _ = view.eval(format!("window.dispatchEvent(new CustomEvent('orqst-native-feature-state',{{detail:{snapshot}}}));"));
            }
        }
    }
    crate::terminal::publish_workspace_projection(app);
}
pub fn invalidate(app: &tauri::AppHandle, label: &str) {
    let state = app.state::<Features>();
    let mut guard = state.0.lock().unwrap();
    let previously_loaded = if label == "main" {
        guard.main_document > 0
    } else {
        guard.chrome_document > 0
    };
    if label == "main" {
        guard.main_document = guard.main_document.saturating_add(1);
    } else if label == "feature-workspace" {
        guard.chrome_document = guard.chrome_document.saturating_add(1);
    } else {
        return;
    }
    guard.preparation_scope = None;
    drop(guard);
    if previously_loaded {
        crate::terminal::metadata_invalidate(app);
    }
}
pub fn configure(
    app: &tauri::AppHandle,
    origin: &str,
) -> Result<String, Box<dyn std::error::Error>> {
    app.state::<Features>().0.lock().unwrap().origin = origin.into();
    app.add_capability(
        tauri::ipc::CapabilityBuilder::new("feature-dashboard-metadata")
            .local(false)
            .remote(format!("{origin}/"))
            .remote(format!("{origin}/studio"))
            .webview("main")
            .permission("allow-feature-request"),
    )?;
    let client = std::fs::read_to_string(app.path().resource_dir()?.join("features/client.js"))?;
    Ok(format!("if(window.top===window.self && location.origin === {} && !location.search) {{\n{client}\n}}",json!(origin)))
}
fn workspace_capability() -> tauri::ipc::CapabilityBuilder {
    tauri::ipc::CapabilityBuilder::new("feature-workspace-metadata")
        .local(true)
        .remote(CHROME_URL.into())
        .webview("feature-workspace")
        .permission("allow-feature-request")
        .permission("allow-feature-prepare")
        .permission("allow-terminal-restore")
        .permission("allow-feature-permissions")
}

pub fn install_workspace(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let Some(workspace) = app.get_window("main") else {
        return Ok(());
    };
    {
        let state = app.state::<Features>();
        let mut guard = state.0.lock().unwrap();
        if app.get_webview("feature-workspace").is_some() || guard.installing {
            return Ok(());
        }
        guard.installing = true;
    }
    let result = (|| -> Result<(), Box<dyn std::error::Error>> {
        if !app.state::<Features>().0.lock().unwrap().chrome_capability {
            app.add_capability(workspace_capability())?;
            app.state::<Features>().0.lock().unwrap().chrome_capability = true;
        }
        let size = workspace
            .inner_size()?
            .to_logical::<f64>(workspace.scale_factor()?);
        let view = workspace.add_child(
            WebviewBuilder::new(
                "feature-workspace",
                WebviewUrl::External(CHROME_URL.parse()?),
            )
            .incognito(true)
            .focused(false)
            .disable_drag_drop_handler()
            .on_navigation(|url| url.as_str() == CHROME_URL)
            .on_new_window(|_, _| NewWindowResponse::Deny)
            .on_download(|_, _| false)
            .on_page_load(|view, payload| {
                if payload.event() == tauri::webview::PageLoadEvent::Started {
                    invalidate(view.app_handle(), view.label());
                }
            }),
            tauri::LogicalPosition::new(0.0, 0.0),
            size,
        )?;
        // Installing the view is not a request to cover the dashboard/preparation drawer.
        view.hide()?;
        // inner_size changes to the parent-window viewport after the first child is installed.
        view.set_bounds(tauri::Rect {
            position: tauri::LogicalPosition::new(0.0, 0.0).into(),
            size: workspace
                .inner_size()?
                .to_logical::<f64>(workspace.scale_factor()?)
                .into(),
        })?;
        Ok(())
    })();
    app.state::<Features>().0.lock().unwrap().installing = false;
    if result.is_err() {
        if let Some(view) = app.get_webview("feature-workspace") {
            let _ = view.close();
        }
    }
    result
}
pub fn on_window_event(window: &Window, event: &WindowEvent) {
    if window.label() != "main" {
        return;
    }
    match event {
        WindowEvent::Focused(true) => {
            let _ = install_workspace(window.app_handle());
        }
        WindowEvent::Resized(_) | WindowEvent::ScaleFactorChanged { .. } => {
            if let (Some(view), Ok(size), Ok(scale)) = (
                window.app_handle().get_webview("feature-workspace"),
                window.inner_size(),
                window.scale_factor(),
            ) {
                let _ = view.set_bounds(tauri::Rect {
                    position: tauri::LogicalPosition::new(0.0, 0.0).into(),
                    size: size.to_logical::<f64>(scale).into(),
                });
            }
        }
        WindowEvent::CloseRequested { .. } | WindowEvent::Destroyed => {
            invalidate(window.app_handle(), "feature-workspace")
        }
        _ => {}
    }
}
pub fn resource(app: &tauri::AppHandle, uri: &tauri::http::Uri) -> Option<(Vec<u8>, &'static str)> {
    if uri.scheme_str() != Some("orqst-features")
        || uri.host() != Some("local")
        || uri.query().is_some()
    {
        return None;
    }
    let (file,mime) = match uri.path() {
        "/logo.svg" => return Some((std::fs::read(app.path().resource_dir().ok()?.join("dashboard/brand/orqst-logo-dark.svg")).ok()?, "image/svg+xml")),
        "/index.html" => return Some((b"<!doctype html><html><head><meta charset=\"UTF-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>ORQST</title><link rel=\"stylesheet\" href=\"workspace.css\"></head><body style=\"margin:0\"><div id=\"root\"></div><script src=\"workspace.js\"></script></body></html>".to_vec(),"text/html; charset=utf-8")),
        "/workspace.js" => ("workspace.js","application/javascript; charset=utf-8"),
        "/workspace.css" => ("workspace.css","text/css; charset=utf-8"),
        _ => return None,
    };
    Some((
        std::fs::read(app.path().resource_dir().ok()?.join("features").join(file)).ok()?,
        mime,
    ))
}
#[cfg(test)]
mod tests {
    #[test]
    fn pane_view_requests_are_closed_uuid_bound_data_without_process_operations() {
        use serde_json::json;
        let id = "e10636eb-3a12-4094-9123-49a4cdad27b8";
        let base = json!({"contractVersion":1,"generation":7,"action":"pane","slot":2,"terminalId":id,"command":"focus"});
        assert!(super::valid_request(&base));
        for command in ["hide", "maximize", "restore", "move-earlier", "move-later"] {
            let mut value = base.clone();
            value["command"] = json!(command);
            assert!(super::valid_request(&value));
        }
        for command in ["start", "stop", "kill", "delegate", "write"] {
            let mut value = base.clone();
            value["command"] = json!(command);
            assert!(!super::valid_request(&value));
        }
        for key in ["pid", "profileId", "proof", "path", "input", "focused"] {
            let mut value = base.clone();
            value[key] = json!(true);
            assert!(!super::valid_request(&value));
        }
        let mut rename = json!({"contractVersion":1,"generation":7,"action":"renamePane","slot":2,"terminalId":id,"name":"Backend"});
        assert!(super::valid_request(&rename));
        rename["name"] = json!("\u{202e}");
        assert!(!super::valid_request(&rename));
        let mut moved = json!({"contractVersion":1,"generation":7,"action":"movePane","slot":2,"terminalId":id,"beforeSlot":0,"beforeTerminalId":id});
        assert!(super::valid_request(&moved));
        moved["beforeSlot"] = json!(8);
        assert!(!super::valid_request(&moved));
    }
    #[test]
    fn preparation_target_is_only_the_owned_exact_dashboard_document() {
        let origin = "http://127.0.0.1:4319";
        for path in ["/", "/studio", "/overview", "/settings"] {
            assert!(super::dashboard_document_matches(
                "main",
                "main",
                &format!("{origin}{path}"),
                origin
            ));
        }
        for (label, parent, source) in [
            ("feature-workspace", "main", "http://127.0.0.1:4319/studio"),
            ("main", "terminal-workspace", "http://127.0.0.1:4319/studio"),
            ("main", "main", "http://127.0.0.1:4320/studio"),
            ("main", "main", "http://user@127.0.0.1:4319/studio"),
            ("main", "main", "http://127.0.0.1:4319/studio?x=1"),
            ("main", "main", "http://127.0.0.1:4319/studio#x"),
            ("main", "main", "http://127.0.0.1:4319/unknown"),
            ("main", "main", "orqst-unavailable://local/index.html"),
            ("main", "main", "orqst-features://local/index.html"),
        ] {
            assert!(!super::dashboard_document_matches(
                label, parent, source, origin
            ));
        }
    }
    #[test]
    fn passive_preparation_is_strict_and_bound_to_accepted_scope_and_native_epoch() {
        let request = serde_json::json!({"contractVersion":1,"generation":7,
            "workspaceId":"synthetic-workspace","featureId":null,"expectedRevision":3});
        assert!(super::valid_preparation_request(&request));
        assert!(!super::valid_request(&request));
        for key in [
            "path",
            "executable",
            "pid",
            "proof",
            "source",
            "document",
            "epoch",
            "action",
        ] {
            let mut forged = request.clone();
            forged[key] = serde_json::json!("SYNTHETIC");
            assert!(!super::valid_preparation_request(&forged));
        }
        let mut state = super::State::default();
        assert!(!super::preparation_scope_current(
            &state,
            &request,
            "synthetic-epoch",
            8
        ));
        state.preparation_scope = Some((request.clone(), "synthetic-epoch".into(), 8));
        assert!(super::preparation_scope_current(
            &state,
            &request,
            "synthetic-epoch",
            8
        ));
        assert!(!super::preparation_scope_current(
            &state,
            &request,
            "another-epoch",
            8
        ));
        assert!(!super::preparation_scope_current(
            &state,
            &request,
            "synthetic-epoch",
            9
        ));
        for key in ["generation", "expectedRevision", "workspaceId", "featureId"] {
            let mut stale = request.clone();
            stale[key] = serde_json::json!("different");
            assert!(!super::preparation_scope_current(
                &state,
                &stale,
                "synthetic-epoch",
                8
            ));
        }
    }

    use super::*;
    #[test]
    fn dock_document_barrier_rejects_navigation_after_capture_before_write() {
        let state = std::sync::Arc::new(Mutex::new(State {
            chrome_document: 3,
            ..State::default()
        }));
        let captured = identity_from(
            &state,
            false,
            || Some(CHROME_URL.into()),
            |source, _| source == CHROME_URL,
        )
        .unwrap();
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
        let resume = std::sync::Arc::new(std::sync::Barrier::new(2));
        let writes = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let worker = {
            let (state, barrier, resume, writes) = (
                state.clone(),
                barrier.clone(),
                resume.clone(),
                writes.clone(),
            );
            std::thread::spawn(move || {
                barrier.wait();
                resume.wait();
                with_chrome_version(&state, captured.1, || {
                    writes.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                    true
                })
            })
        };
        barrier.wait();
        state.lock().unwrap().chrome_document += 1;
        resume.wait();
        assert!(!worker.join().unwrap());
        assert_eq!(writes.load(std::sync::atomic::Ordering::SeqCst), 0);
    }

    #[test]
    fn permission_command_runtime_acl_is_only_the_exact_chrome() {
        let mut context = crate::app_context();
        let authority = context.runtime_authority_mut();
        let local = tauri::ipc::Origin::Local;
        assert!(authority
            .resolve_access("feature_permissions", "main", "feature-workspace", &local)
            .is_none());
        authority.add_capability(workspace_capability()).unwrap();
        assert!(authority
            .resolve_access("feature_permissions", "main", "feature-workspace", &local)
            .is_some());
        for label in ["main", "terminal-0", "terminal-7", "managed-agents"] {
            assert!(
                authority
                    .resolve_access("feature_permissions", "main", label, &local)
                    .is_none(),
                "{label}"
            );
        }
        let correct = tauri::ipc::Origin::Remote {
            url: CHROME_URL.parse().unwrap(),
        };
        assert!(authority
            .resolve_access("feature_permissions", "main", "feature-workspace", &correct)
            .is_some());
        for wrong in [
            "orqst-features://local/other.html",
            "orqst-features://other/index.html",
            "https://example.invalid/index.html",
        ] {
            let origin = tauri::ipc::Origin::Remote {
                url: wrong.parse().unwrap(),
            };
            assert!(
                authority
                    .resolve_access("feature_permissions", "main", "feature-workspace", &origin)
                    .is_none(),
                "{wrong}"
            );
        }
        for wrong in [
            "orqst-features://local/index.html?x=1",
            "orqst-features://local/index.html#x",
            "orqst-features://local/other.html",
        ] {
            assert!(!permission_source_allowed(
                "feature-workspace",
                "main",
                wrong
            ));
        }
        assert!(!permission_source_allowed("terminal-0", "main", CHROME_URL));
        assert!(!permission_source_allowed(
            "feature-workspace",
            "other",
            CHROME_URL
        ));
    }

    #[test]
    fn dock_restore_runtime_acl_and_exact_source_gate_are_chrome_only() {
        // Resolve the real build.rs app manifest and static capabilities without starting an app.
        let mut context = crate::app_context();
        let authority = context.runtime_authority_mut();
        // Registered custom protocols are classified Local by Tauri::is_local_url.
        let correct = tauri::ipc::Origin::Local;
        assert!(authority
            .resolve_access("terminal_restore", "main", "feature-workspace", &correct)
            .is_none());
        authority.add_capability(workspace_capability()).unwrap();
        assert!(authority
            .resolve_access("terminal_restore", "main", "feature-workspace", &correct)
            .is_some());
        for label in ["main", "terminal-0", "terminal-7", "managed-agents"] {
            assert!(
                authority
                    .resolve_access("terminal_restore", "main", label, &correct)
                    .is_none(),
                "{label}"
            );
        }
        for wrong in [
            "orqst-features://local/index.html?x=1",
            "orqst-features://local/index.html#other",
            "orqst-features://local/other.html",
            "orqst-features://other/index.html",
            "https://example.invalid/index.html",
        ] {
            // Local ACL resolution has no URL field. The real handler's exact source gate
            // supplies this restriction; claiming the ACL alone denies these URLs is false.
            let admitted = authority
                .resolve_access("terminal_restore", "main", "feature-workspace", &correct)
                .is_some()
                && restore_source_allowed("feature-workspace", "main", wrong);
            assert!(!admitted, "{wrong}");
        }
        let remote = tauri::ipc::Origin::Remote {
            url: CHROME_URL.parse().unwrap(),
        };
        assert!(authority
            .resolve_access("terminal_restore", "main", "feature-workspace", &remote)
            .is_some());
        for wrong in [
            "orqst-features://local/other.html",
            "orqst-features://other/index.html",
            "https://example.invalid/index.html",
        ] {
            let origin = tauri::ipc::Origin::Remote {
                url: wrong.parse().unwrap(),
            };
            assert!(
                authority
                    .resolve_access("terminal_restore", "main", "feature-workspace", &origin)
                    .is_none(),
                "{wrong}"
            );
        }
    }

    #[test]
    fn reviewed_plan_rejects_document_epoch_feature_snapshot_and_revision_changes() {
        let snapshot = json!({"activeFeatureId":"a", "generation":7, "members":["x"]});
        let permissions = json!({"featureId":"a", "revision":3});
        let plan = json!({"snapshot":snapshot,"permissions":permissions,"document":2,"epoch":"epoch", "generation":7,"featureId":"a","expectedRevision":3});
        assert!(permission_plan_current(
            &plan,
            &snapshot,
            &permissions,
            2,
            "epoch",
            7
        ));
        assert!(!permission_plan_current(
            &plan,
            &snapshot,
            &permissions,
            3,
            "epoch",
            7
        ));
        assert!(!permission_plan_current(
            &plan,
            &snapshot,
            &permissions,
            2,
            "other",
            7
        ));
        assert!(!permission_plan_current(
            &plan,
            &snapshot,
            &permissions,
            2,
            "epoch",
            8
        ));
        let mut changed = snapshot.clone();
        changed["activeFeatureId"] = json!("b");
        assert!(!permission_plan_current(
            &plan,
            &changed,
            &permissions,
            2,
            "epoch",
            7
        ));
        let mut changed = snapshot.clone();
        changed["members"] = json!([]);
        assert!(!permission_plan_current(
            &plan,
            &changed,
            &permissions,
            2,
            "epoch",
            7
        ));
        let mut changed = permissions.clone();
        changed["revision"] = json!(4);
        assert!(!permission_plan_current(
            &plan, &snapshot, &changed, 2, "epoch", 7
        ));
    }

    #[test]
    fn permission_scope_uses_captured_feature_epoch_and_generation() {
        let mut state = State {
            snapshot_generation: 13,
            ..State::default()
        };
        state.preparation_scope = Some((json!({"featureId":"feature-a"}), "epoch-a".into(), 9));
        assert_eq!(
            permission_scope_generation(&state, "feature-a", "epoch-a", 9),
            Some(13)
        );
        assert_eq!(
            permission_scope_generation(&state, "feature-b", "epoch-a", 9),
            None
        );
        assert_eq!(
            permission_scope_generation(&state, "feature-a", "epoch-b", 9),
            None
        );
        assert_eq!(
            permission_scope_generation(&state, "feature-a", "epoch-a", 10),
            None
        );
    }

    #[test]
    fn permission_reply_requires_valid_scoped_permission_state() {
        let f = "e10636eb-3a12-4094-9123-49a4cdad27b8";
        let t = "a10636eb-3a12-4094-9123-49a4cdad27b8";
        let snapshot = json!({"contractVersion":1,"storage":"core","generation":2,
            "workspace":{"id":"workspace","name":"Workspace"},
            "features":[{"schemaVersion":1,"workspaceId":"workspace","featureId":f,"name":"Feature", "description":"", "status":"active", "revision":1,"terminalIds":[t],"createdAt":1,"updatedAt":1}],
            "view":{"contractVersion":1,"storage":"core","workspaceId":"workspace","featureId":f,"revision":1},
            "activeFeatureId":f,"slots":[{"slot":0,"terminalId":t,"provider":"codex"}],"layoutSaved":true});
        let mut displayed = snapshot.clone();
        displayed["features"][0]["orchestratorTerminalId"] = json!(t);
        assert!(valid_snapshot(&displayed));
        displayed["features"][0]["orchestratorTerminalId"] = json!(f);
        assert!(!valid_snapshot(&displayed));
        displayed["features"][0]["orchestratorTerminalId"] = Value::Null;
        assert!(valid_snapshot(&displayed));
        displayed["slots"][0]["selectedModel"] = json!("gpt-synthetic");
        assert!(valid_snapshot(&displayed));
        displayed["slots"][0]["selectedModel"] = json!("bad model");
        assert!(!valid_snapshot(&displayed));
        let mut owned = snapshot.clone();
        owned["slots"][0]["workspace"] = snapshot["workspace"].clone();
        owned["slots"][0]["agentState"] = json!("unknown");
        assert!(valid_snapshot(&owned));
        owned["slots"][0]["agentState"] = json!("completed");
        assert!(!valid_snapshot(&owned));
        owned["slots"][0]["agentState"] = json!("unknown");
        owned["slots"][0]["workspace"]["id"] = json!("different");
        assert!(!valid_snapshot(&owned));
        let mut canvas = json!({"observedAt": 200, "entries":[{"slot":0,"terminalId":t,"state":"exited","startedAt":100,"exitedAt":180}]});
        assert!(valid_canvas(&canvas, &snapshot));
        canvas["entries"][0]["terminalId"] = json!(f);
        assert!(!valid_canvas(&canvas, &snapshot));
        let mut scoped = snapshot.clone();
        scoped["slots"][0]["provider"] = json!("claude");
        let mut activity = json!({"observedAt":200,"entries":[{"slot":0,"terminalId":t,"state":"running","startedAt":100,"session":{"provider":"claude","sessionId":f,"bindingEvidence":"claude-argv-receipt-transcript"},"activities":[{"at":150,"kind":"tool","label":"Read"}]}]});
        assert!(valid_canvas(&activity, &scoped));
        assert!(!valid_canvas(&activity, &snapshot));
        activity["entries"][0]["activities"][0]["label"] = json!("raw secret input");
        assert!(!valid_canvas(&activity, &scoped));
        canvas["entries"][0]["terminalId"] = json!(t);
        canvas["entries"][0]
            .as_object_mut()
            .unwrap()
            .remove("exitedAt");
        assert!(!valid_canvas(&canvas, &snapshot));
        let mut reply = json!({"status":"ok","snapshot":snapshot,"permissions":{"schemaVersion":1,"workspaceId":"workspace","featureId":f,"revision":0,"configuration":null}});
        assert!(valid_permission_reply(&reply));
        reply["permissions"]["revision"] = json!(1);
        assert!(!valid_permission_reply(&reply));
        reply["permissions"]["revision"] = json!(0);
        reply["permissions"]["untrusted"] = json!(true);
        assert!(!valid_permission_reply(&reply));
        reply["permissions"]
            .as_object_mut()
            .unwrap()
            .remove("untrusted");
        reply["permissions"]["workspaceId"] = json!("other");
        assert!(!valid_permission_reply(&reply));
    }

    #[test]
    fn permission_transport_is_separate_and_strict() {
        let id = "e10636eb-3a12-4094-9123-49a4cdad27b8";
        let request = json!({"kind":"feature-permission-request","id":id,"document":2,
            "source":CHROME_URL,"actorId":format!("native-{id}"),"request":{"action":"readPermissions","contractVersion":1,"generation":7,"featureId":id}});
        assert!(super::valid_permission_envelope(&request));
        let mut forged = request.clone();
        forged["kind"] = json!("feature-request");
        assert!(!super::valid_envelope(&forged));
        forged = request.clone();
        forged["request"]["actorId"] = json!("fake");
        assert!(!super::valid_permission_envelope(&forged));
        forged = request.clone();
        forged["source"] = json!("https://example.invalid");
        assert!(!super::valid_permission_envelope(&forged));
        assert!(!super::valid_permission_reply(
            &json!({"status":"ok","permissions":{"revision":0}})
        ));
        assert!(super::valid_permission_reply(&json!({"status":"denied"})));
        assert!(!super::valid_permission_reply(
            &json!({"status":"denied","unexpected":true})
        ));
    }

    #[test]
    fn policy_validation_rejects_foreign_duplicate_and_cyclic_rules() {
        let a = "e10636eb-3a12-4094-9123-49a4cdad27b8";
        let b = "a10636eb-3a12-4094-9123-49a4cdad27b8";
        let c = "b10636eb-3a12-4094-9123-49a4cdad27b8";
        let feature = json!({"terminalIds":[a,b]});
        let rule = |source, target| json!({"sourceTerminalId":source,"targetTerminalId":target,"operations":["delegate"]});
        let policy = |rules| json!({"schemaVersion":1,"rules":rules});
        assert!(policy_members(&policy(vec![rule(a, b)]), &feature));
        assert!(!policy_members(&policy(vec![rule(a, c)]), &feature));
        assert!(!policy_members(
            &policy(vec![rule(a, b), rule(a, b)]),
            &feature
        ));
        assert!(!policy_members(
            &policy(vec![rule(a, b), rule(b, a)]),
            &feature
        ));
    }

    #[test]
    fn permission_diff_reports_ids_removals_and_neutral_empty_allowlist() {
        let labels = HashMap::from([
            ("a".to_owned(), "T-001".to_owned()),
            ("b".to_owned(), "T-002".to_owned()),
        ]);
        let empty = json!({"schemaVersion":1,"rules":[]});
        let neutral = super::permission_diff("Feature <x>", 0, &Value::Null, &empty, &labels);
        assert!(neutral.contains("Feature: Feature &lt;x&gt;"));
        assert!(neutral.contains("Current configuration: null"));
        assert!(neutral.contains("Proposed configuration: {\"rules\":[],\"schemaVersion\":1}"));
        assert!(neutral.contains("NEUTRAL -> ALLOWLIST"));
        assert!(neutral.contains("permits no operations"));
        assert!(neutral.contains("a (T-001) -> b (T-002): neutral => allow []; implicitly denied [delegate, execute, view]"));
        let current = json!({"schemaVersion":1,"rules":[{"sourceTerminalId":"a","targetTerminalId":"b","operations":["view"]}]});
        let diff = super::permission_diff("Feature", 1, &current, &empty, &labels);
        assert!(diff.contains("a (T-001) -> b (T-002): allow [view] => allow []; implicitly denied [delegate, execute, view]"));
    }

    #[test]
    fn dock_restore_capability_and_source_are_chrome_only() {
        let source = include_str!("features.rs");
        assert!(source.contains(".webview(\"feature-workspace\")"));
        assert!(source.contains(".permission(\"allow-terminal-restore\")"));
        assert!(restore_source_allowed(
            "feature-workspace",
            "main",
            CHROME_URL
        ));
        assert!(!restore_source_allowed("main", "main", CHROME_URL));
        assert!(!restore_source_allowed("terminal-0", "main", CHROME_URL));
        assert!(!restore_source_allowed(
            "feature-workspace",
            "main",
            "orqst-features://local/index.html?x=1"
        ));
    }

    #[test]
    fn metadata_document_identity_is_exact_and_parent_bound() {
        assert!(document_matches(
            "main",
            "main",
            "http://127.0.0.1:4319/studio",
            "http://127.0.0.1:4319"
        ));
        assert!(document_matches(
            "feature-workspace",
            "main",
            CHROME_URL,
            "http://127.0.0.1:4319"
        ));
        for (label, parent, url) in [
            ("main", "other", "http://127.0.0.1:4319/studio"),
            ("main", "main", "http://127.0.0.1:4319/studio?x=1"),
            ("main", "main", "http://localhost:4319/studio"),
            ("terminal-0", "terminal-workspace", CHROME_URL),
            ("feature-workspace", "terminal-workspace", CHROME_URL),
            (
                "feature-workspace",
                "terminal-workspace",
                "orqst-features://local/index.html?x=1",
            ),
        ] {
            assert!(!document_matches(
                label,
                parent,
                url,
                "http://127.0.0.1:4319"
            ));
        }
    }
    #[test]
    fn metadata_actions_never_accept_execution_or_renderer_identity() {
        let valid = json!({"contractVersion":1,"generation":0,"action":"snapshot"});
        assert!(valid_request(&valid));
        for key in ["source", "document", "path", "pid", "proof", "slot"] {
            let mut forged = valid.clone();
            forged[key] = json!(1);
            assert!(!valid_request(&forged));
        }
        for action in [
            "start",
            "stop",
            "write",
            "retire",
            "authorizeMcp",
            "clone",
            "remove",
        ] {
            let mut forged = valid.clone();
            forged["action"] = json!(action);
            assert!(!valid_request(&forged));
        }
        assert!(!valid_reply(&json!({"status":"ok"})));
    }
    #[test]
    fn native_strings_and_uuids_match_protocol_bounds() {
        assert!(uuid(&json!("e10636eb-3a12-4094-9123-49a4cdad27b8")));
        assert!(!uuid(&json!("e10636eb-3a12-0094-0123-49a4cdad27b8")));
        assert!(!name(&json!("hidden\u{200b}name")));
        assert!(!name(&json!("\u{e0001}")));
        assert!(name(&json!("🦉".repeat(24))));
        assert!(!name(&json!("🦉".repeat(25))));
    }
    #[test]
    fn invalidation_during_final_focus_wait_cannot_authorize_cache_publish_or_return() {
        use std::future::Future;
        use std::sync::Arc;
        use std::task::{Context, Poll, Waker};
        for invalidation in 0..5 {
            let expected = (CHROME_URL.to_owned(), 1_u64, 2_u64, false);
            let state = Arc::new(Mutex::new(expected.clone()));
            let (sender, receiver) = tokio::sync::oneshot::channel();
            let mut pending = Box::pin(focus_then_current(
                async { receiver.await.unwrap_or(false) },
                || *state.lock().unwrap() == expected,
            ));
            let mut context = Context::from_waker(Waker::noop());
            assert_eq!(pending.as_mut().poll(&mut context), Poll::Pending);
            {
                let mut state = state.lock().unwrap();
                match invalidation {
                    1 => state.0 = "orqst-features://local/other.html".into(),
                    2 => state.1 += 1,   // navigation/close changes document
                    3 => state.2 += 1,   // native presentation changes independently
                    4 => state.3 = true, // either Quit gate became pending
                    _ => {}
                }
            }
            sender.send(true).unwrap();
            assert_eq!(
                pending.as_mut().poll(&mut context),
                Poll::Ready(invalidation == 0)
            );
        }
    }
    #[test]
    fn permission_completion_releases_on_real_timeout_and_early_drop() {
        use std::cell::Cell;
        use std::future::Future;
        use std::task::{Context, Poll, Waker};
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_time()
            .build()
            .unwrap();
        let held = Cell::new(true);
        runtime.block_on(async {
            let result = with_metadata_completion(
                tokio::time::timeout(
                    std::time::Duration::from_millis(1),
                    std::future::pending::<()>(),
                ),
                |_| held.set(false),
            )
            .await;
            assert!(result.is_err());
        });
        assert!(!held.get());
        held.set(true);
        let mut pending = Box::pin(with_metadata_completion(
            std::future::pending::<()>(),
            |cancelled| {
                assert!(cancelled);
                held.set(false);
            },
        ));
        assert_eq!(
            pending
                .as_mut()
                .poll(&mut Context::from_waker(Waker::noop())),
            Poll::Pending
        );
        drop(pending);
        assert!(!held.get());
    }

    #[test]
    fn command_drop_releases_once_during_metadata_or_final_focus_without_continuation() {
        use std::cell::{Cell, RefCell};
        use std::future::Future;
        use std::task::{Context, Poll, Waker};
        for cancel_during_focus in [false, true] {
            let held = Cell::new(true);
            let finishes = RefCell::new(Vec::new());
            let published = Cell::new(false);
            let (metadata_sender, metadata) = tokio::sync::oneshot::channel::<()>();
            let (focus_sender, focus) = tokio::sync::oneshot::channel::<()>();
            let mut command = Box::pin(with_metadata_completion(
                async {
                    metadata.await.unwrap();
                    focus.await.unwrap();
                    published.set(true);
                },
                |cancelled| {
                    held.set(false);
                    finishes.borrow_mut().push(cancelled);
                },
            ));
            let mut context = Context::from_waker(Waker::noop());
            assert_eq!(command.as_mut().poll(&mut context), Poll::Pending);
            if cancel_during_focus {
                metadata_sender.send(()).unwrap();
                assert_eq!(command.as_mut().poll(&mut context), Poll::Pending);
            }
            // The command still excludes native reviews after the metadata reply.
            assert!(held.get());
            assert!(finishes.borrow().is_empty());
            drop(command);
            assert!(!held.get());
            assert_eq!(*finishes.borrow(), vec![true]);
            assert!(!published.get());
            assert!(focus_sender.send(()).is_err());
        }
    }
    #[test]
    fn command_completion_keeps_exclusion_through_final_focus_for_every_reply_outcome() {
        use std::cell::{Cell, RefCell};
        use std::future::Future;
        use std::task::{Context, Poll, Waker};
        for outcome in ["ok", "denied", "stale", "unavailable", "timeout", "error"] {
            let held = Cell::new(true);
            let finishes = RefCell::new(Vec::new());
            let (metadata_sender, metadata) = tokio::sync::oneshot::channel();
            let (focus_sender, focus) = tokio::sync::oneshot::channel();
            let mut command = Box::pin(with_metadata_completion(
                async {
                    let reply = metadata.await.unwrap();
                    assert!(held.get());
                    focus.await.unwrap();
                    reply
                },
                |cancelled| {
                    held.set(false);
                    finishes.borrow_mut().push(cancelled);
                },
            ));
            let mut context = Context::from_waker(Waker::noop());
            assert_eq!(command.as_mut().poll(&mut context), Poll::Pending);
            metadata_sender.send(outcome).unwrap();
            assert_eq!(command.as_mut().poll(&mut context), Poll::Pending);
            assert!(held.get());
            assert!(finishes.borrow().is_empty());
            focus_sender.send(()).unwrap();
            assert_eq!(command.as_mut().poll(&mut context), Poll::Ready(outcome));
            assert!(!held.get());
            assert_eq!(*finishes.borrow(), vec![false]);
            drop(command);
            assert_eq!(finishes.borrow().len(), 1);
        }
    }
}

/// Validates the entire trusted host layout before the native shell mutates visibility or geometry.
pub(crate) fn workspace_visible(state: &Value) -> bool {
    state["suspended"] == false
        && (state["workspaceChrome"] == true
            || state["visible"].as_array().is_some_and(|v| !v.is_empty()))
}

pub(crate) fn valid_layout(
    v: &Value,
    count: usize,
    width: u32,
    height: u32,
    last_revision: u64,
    generation: u64,
) -> bool {
    let custom = v["kind"] == "layout-v2";
    if !(if custom {
        exact(
            v,
            &[
                "kind",
                "mode",
                "generation",
                "revision",
                "viewport",
                "insets",
                "state",
                "focus",
                "bounds",
            ],
        ) && matches!(
            v["mode"].as_str(),
            Some("mosaic" | "columns" | "rows" | "focus" | "list" | "free")
        )
    } else {
        exact(
            v,
            &[
                "kind",
                "generation",
                "revision",
                "viewport",
                "insets",
                "state",
                "focus",
                "bounds",
            ],
        ) && v["kind"] == "layout"
    }) || safe(&v["generation"]) != Some(generation)
        || !safe(&v["revision"]).is_some_and(|n| n > last_revision)
        || !exact(&v["viewport"], &["width", "height"])
        || v["viewport"]["width"].as_u64() != Some(width as u64)
        || v["viewport"]["height"].as_u64() != Some(height as u64)
        || !exact(&v["insets"], &["left", "top", "bottom"])
    {
        return false;
    }
    let s = &v["state"];
    if !exact(
        s,
        &[
            "axis",
            "percent",
            "columns",
            "order",
            "shown",
            "active",
            "maximized",
            "names",
            "visible",
            "count",
            "persisted",
            "suspended",
            "workspaceChrome",
            "canvas",
        ],
    ) || !matches!(s["axis"].as_str(), Some("columns" | "rows"))
        || !s["percent"]
            .as_u64()
            .is_some_and(|n| (25..=75).contains(&n))
        || !s["columns"].as_u64().is_some_and(|n| n <= 3)
        || s["count"].as_u64() != Some(count as u64)
        || !s["persisted"].is_boolean()
        || !s["suspended"].is_boolean()
        || !s["workspaceChrome"].is_boolean()
        || !s["canvas"].is_boolean()
    {
        return false;
    }
    let slots = |a: &Value| -> Option<Vec<u64>> {
        let list = a.as_array()?;
        let values: Vec<u64> = list.iter().map(Value::as_u64).collect::<Option<_>>()?;
        (values.len() <= count
            && values.iter().all(|n| *n < count as u64)
            && values.iter().copied().collect::<HashSet<_>>().len() == values.len())
        .then_some(values)
    };
    let (Some(order), Some(shown), Some(visible)) =
        (slots(&s["order"]), slots(&s["shown"]), slots(&s["visible"]))
    else {
        return false;
    };
    if !shown.iter().all(|n| order.contains(n))
        || !visible.iter().all(|n| shown.contains(n))
        || (s["suspended"] == true && !visible.is_empty())
        || (s["canvas"] == true && !visible.is_empty())
        || (order.is_empty() && s["active"].as_i64() != Some(-1))
        || (!order.is_empty() && !s["active"].as_u64().is_some_and(|n| order.contains(&n)))
        || !(s["maximized"].is_null()
            || s["maximized"].as_u64().is_some_and(|n| shown.contains(&n)))
        || !s["names"]
            .as_array()
            .is_some_and(|a| a.len() == count && a.iter().all(|v| v == "" || name(v)))
        || !(v["focus"].is_null() || v["focus"].as_u64().is_some_and(|n| visible.contains(&n)))
    {
        return false;
    }
    if custom
        && (s["workspaceChrome"] != true
            || s["suspended"] != false
            || s["canvas"] != false
            || !v["focus"].is_null()
            || (v["mode"] == "list" && !visible.is_empty())
            || (v["mode"] == "focus" && visible.len() > 1))
    {
        return false;
    }
    let chrome = s["workspaceChrome"] == true;
    let left = if chrome {
        if width <= 720 {
            46
        } else {
            155
        }
    } else {
        0
    };
    let top = if chrome { 81 } else { 0 };
    let bottom = if chrome { 34 } else { 0 };
    if width <= left
        || height <= top + bottom
        || v["insets"] != json!({"left":left,"top":top,"bottom":bottom})
    {
        return false;
    }
    let Some(bounds) = v["bounds"].as_array().filter(|b| b.len() == count) else {
        return false;
    };
    let mut rectangles = Vec::new();
    let mut z_order = HashSet::new();
    for (slot, b) in bounds.iter().enumerate() {
        if !(if custom {
            exact(b, &["slot", "rect", "z"]) && b["z"].as_u64().is_some_and(|n| n <= 255)
        } else {
            exact(b, &["slot", "rect"])
        }) || b["slot"].as_u64() != Some(slot as u64)
            || b["rect"].is_null() == visible.contains(&(slot as u64))
        {
            return false;
        }
        if b["rect"].is_null() {
            continue;
        }
        if custom && !z_order.insert(b["z"].as_u64().unwrap()) {
            return false;
        }
        let r = &b["rect"];
        if !exact(r, &["x", "y", "width", "height"]) {
            return false;
        }
        let Some(values) = ["x", "y", "width", "height"]
            .iter()
            .map(|k| r[*k].as_u64())
            .collect::<Option<Vec<_>>>()
        else {
            return false;
        };
        if values.iter().any(|n| *n > 32768) {
            return false;
        }
        let (x, y, w, h) = (values[0], values[1], values[2], values[3]);
        if x < left as u64
            || y < top as u64
            || w == 0
            || h == 0
            || x + w > width as u64
            || y + h > (height - bottom) as u64
        {
            return false;
        }
        for &(px, py, pw, ph) in &rectangles {
            if x < px + pw
                && px < x + w
                && y < py + ph
                && py < y + h
                && (!custom || v["mode"] != "free")
            {
                return false;
            }
        }
        rectangles.push((x, y, w, h));
    }
    true
}

#[cfg(test)]
mod layout_tests {
    use super::*;
    #[test]
    fn versioned_arrangement_bounds_scope_and_overlap_are_strict() {
        let a = "e10636eb-3a12-4094-9123-49a4cdad27b8";
        let b = "a10636eb-3a12-4094-9123-49a4cdad27b8";
        let mut request = json!({"contractVersion":1,"generation":3,"action":"arrange","layoutVersion":1,"mode":"free","viewport":{"width":1285,"height":785},"panes":[
            {"slot":0,"terminalId":a,"visible":true,"z":0,"rect":{"x":0.5,"y":10,"width":300,"height":200}},
            {"slot":1,"terminalId":b,"visible":true,"z":1,"rect":{"x":100,"y":20,"width":300,"height":200}}
        ]});
        assert!(valid_request(&request));
        request["mode"] = json!("columns");
        assert!(!valid_request(&request));
        request["mode"] = json!("free");
        request["panes"][1]["z"] = json!(0);
        assert!(valid_request(&request)); // Equal z uses the submitted stable pane order.
        request["panes"][1]["terminalId"] = json!(a);
        assert!(!valid_request(&request));
        request["panes"][1]["terminalId"] = json!(b);
        request["panes"][1]["z"] = json!(1);
        request["panes"][1]["rect"]["x"] = json!(1280);
        assert!(!valid_request(&request));
        request["panes"][1]["rect"] = Value::Null;
        assert!(!valid_request(&request));
    }

    #[test]
    fn native_v2_accepts_free_overlap_only_and_rejects_duplicate_z_or_stale_generation() {
        let mut value = layout();
        value["kind"] = json!("layout-v2");
        value["mode"] = json!("free");
        value["bounds"][0]["z"] = json!(0);
        value["bounds"][1]["z"] = json!(1);
        value["bounds"][1]["rect"]["x"] = json!(400);
        assert!(valid_layout(&value, 2, 1440, 900, 2, 2));
        assert!(!valid_layout(&value, 2, 1440, 900, 2, 3));
        value["mode"] = json!("rows");
        assert!(!valid_layout(&value, 2, 1440, 900, 2, 2));
        value["mode"] = json!("free");
        value["bounds"][1]["z"] = json!(0);
        assert!(!valid_layout(&value, 2, 1440, 900, 2, 2));
    }
    fn layout() -> Value {
        json!({
            "kind":"layout","generation":2,"revision":3,
            "viewport":{"width":1440,"height":900},"insets":{"left":155,"top":81,"bottom":34},
            "state":{"axis":"columns","percent":50,"columns":2,"order":[0,1],"shown":[0,1],"active":0,"maximized":null,"names":["", ""],"visible":[0,1],"count":2,"persisted":true,"suspended":false,"workspaceChrome":true,"canvas":false},
            "focus":null,"bounds":[{"slot":0,"rect":{"x":155,"y":81,"width":642,"height":785}},{"slot":1,"rect":{"x":797,"y":81,"width":643,"height":785}}]
        })
    }
    #[test]
    fn canvas_keeps_members_and_hidden_preferences_but_accepts_no_pty_bounds_or_focus() {
        let mut value = layout();
        value["state"]["canvas"] = json!(true);
        assert!(!valid_layout(&value, 2, 1440, 900, 2, 2));
        value["state"]["visible"] = json!([]);
        value["bounds"][0]["rect"] = Value::Null;
        value["bounds"][1]["rect"] = Value::Null;
        assert!(valid_layout(&value, 2, 1440, 900, 2, 2));
        assert!(workspace_visible(&value["state"]));
        assert_eq!(value["state"]["order"], json!([0, 1]));
        assert_eq!(value["state"]["shown"], json!([0, 1]));
        value["focus"] = json!(0);
        assert!(!valid_layout(&value, 2, 1440, 900, 2, 2));
    }
    #[test]
    fn layout_rejects_stale_generation_viewport_and_whole_invalid_geometry() {
        let value = layout();
        assert!(valid_layout(&value, 2, 1440, 900, 2, 2));
        assert!(!valid_layout(&value, 2, 1440, 900, 3, 2));
        assert!(!valid_layout(&value, 2, 1440, 900, 2, 3));
        assert!(!valid_layout(&value, 2, 1200, 900, 2, 2));
        for (field, forged) in [
            ("x", json!(0)),
            ("width", json!(u64::MAX)),
            ("height", json!(900)),
        ] {
            let mut invalid = value.clone();
            invalid["bounds"][0]["rect"][field] = forged;
            assert!(!valid_layout(&invalid, 2, 1440, 900, 2, 2));
        }
        let mut overlap = value.clone();
        overlap["bounds"][1]["rect"]["x"] = json!(796);
        assert!(!valid_layout(&overlap, 2, 1440, 900, 2, 2));
        let mut foreign = value.clone();
        foreign["bounds"][1]["slot"] = json!(7);
        assert!(!valid_layout(&foreign, 2, 1440, 900, 2, 2));
    }
    #[test]
    fn empty_feature_is_valid_visible_chrome_without_pane_input_focus() {
        let mut value = layout();
        for field in ["order", "shown", "visible"] {
            value["state"][field] = json!([]);
        }
        value["state"]["active"] = json!(-1);
        for slot in 0..2 {
            value["bounds"][slot]["rect"] = Value::Null;
        }
        assert!(valid_layout(&value, 2, 1440, 900, 2, 2));
        assert!(workspace_visible(&value["state"]));
        value["focus"] = json!(0);
        assert!(!valid_layout(&value, 2, 1440, 900, 2, 2));
        value["focus"] = Value::Null;
        value["state"]["suspended"] = json!(true);
        assert!(valid_layout(&value, 2, 1440, 900, 2, 2));
        assert!(!workspace_visible(&value["state"]));
    }
}
