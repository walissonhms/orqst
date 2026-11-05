//! Metadata-only facade over the existing selected Terminal Core. No execution transport is exposed.
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::sync::Mutex;
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
        Some("snapshot") => exact(value, &["contractVersion", "generation", "action"]),
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
                            ["expectedRevision", "name", "description", "status"]
                                .contains(&k.as_str())
                        })
                })
                && safe(&value["input"]["expectedRevision"]).is_some_and(|n| n > 0)
                && (value["input"].get("name").is_none() || name(&value["input"]["name"]))
                && (value["input"].get("description").is_none()
                    || text(&value["input"]["description"], 2048, false))
                && (value["input"].get("status").is_none() || status(&value["input"]["status"]))
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
        _ => false,
    }
}
pub(crate) fn valid_envelope(value: &Value) -> bool {
    exact(value, &["kind", "id", "document", "source", "request"])
        && value["kind"] == "feature-request"
        && uuid(&value["id"])
        && safe(&value["document"]).is_some_and(|n| n > 0)
        && text(&value["source"], 4096, true)
        && valid_request(&value["request"])
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
        if !exact(
            f,
            &[
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
            ],
        ) || f["schemaVersion"] != 1
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
        if !exact(s, &["slot", "terminalId", "provider"])
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
        (o.len() == 1 || (o.len() == 2 && o.contains_key("snapshot")))
            && o.contains_key("status")
            && matches!(
                value["status"].as_str(),
                Some("ok" | "denied" | "stale" | "busy" | "unavailable" | "archive_blocked")
            )
            && (value.get("snapshot").is_none() || valid_snapshot(&value["snapshot"]))
            && (value["status"] != "ok" || value.get("snapshot").is_some())
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
            if main { "main" } else { "main" },
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
#[tauri::command]
pub async fn feature_request(window: Webview, request: Value) -> Value {
    let denied = || json!({"status":"denied"});
    if !valid_request(&request) {
        return denied();
    }
    let Some((source, document)) = identity(&window) else {
        return denied();
    };
    let app = window.app_handle();
    if crate::terminal::presentation_blocked(app) {
        return denied();
    }
    let Some((epoch, _)) = crate::terminal::metadata_context(app) else {
        return json!({"status":"unavailable"});
    };
    let presentation = if matches!(request["action"].as_str(), Some("select" | "organize")) {
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
            app.add_capability(
                tauri::ipc::CapabilityBuilder::new("feature-workspace-metadata")
                    .local(true)
                    .remote(CHROME_URL.into())
                    .webview("feature-workspace")
                    .permission("allow-feature-request")
                    .permission("allow-feature-prepare"),
            )?;
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
        // Chrome is the background. Retained PTY webviews remain above its central surface.
        #[cfg(target_os="macos")]
        view.with_webview(|native| unsafe {
            use objc2::runtime::AnyObject; use objc2::msg_send;
            let view = native.inner().cast::<AnyObject>(); let parent:*mut AnyObject = msg_send![view,superview];
            if !parent.is_null() { let _:() = msg_send![parent, addSubview: view, positioned: -1_isize, relativeTo: std::ptr::null_mut::<AnyObject>()]; }
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
                let _ = view.set_size(size.to_logical::<f64>(scale));
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
    if !exact(
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
    ) || v["kind"] != "layout"
        || safe(&v["generation"]) != Some(generation)
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
    let top = if chrome { 45 } else { 0 };
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
    for (slot, b) in bounds.iter().enumerate() {
        if !exact(b, &["slot", "rect"])
            || b["slot"].as_u64() != Some(slot as u64)
            || b["rect"].is_null() == visible.contains(&(slot as u64))
        {
            return false;
        }
        if b["rect"].is_null() {
            continue;
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
            if x < px + pw && px < x + w && y < py + ph && py < y + h {
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
    fn layout() -> Value {
        json!({
            "kind":"layout","generation":2,"revision":3,
            "viewport":{"width":1440,"height":900},"insets":{"left":155,"top":45,"bottom":34},
            "state":{"axis":"columns","percent":50,"columns":2,"order":[0,1],"shown":[0,1],"active":0,"maximized":null,"names":["", ""],"visible":[0,1],"count":2,"persisted":true,"suspended":false,"workspaceChrome":true},
            "focus":null,"bounds":[{"slot":0,"rect":{"x":155,"y":45,"width":642,"height":821}},{"slot":1,"rect":{"x":797,"y":45,"width":643,"height":821}}]
        })
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
