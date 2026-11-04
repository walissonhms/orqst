//! Native-only client of ORQST's existing TerminalNativeBroker/Node host.
//! The observer webview has no capability for these commands or this private pipe.
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Arc;
use std::sync::Mutex;
use std::time::Duration;
use tauri::menu::{Menu, MenuItem, Submenu};
use tauri::webview::NewWindowResponse;
use tauri::webview::WebviewBuilder;
use tauri::{Manager, Webview, WebviewUrl, Window, WindowEvent};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogResult};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use tokio::sync::oneshot;
use tokio::sync::Notify;
#[cfg(target_os = "macos")]
#[path = "terminal_focus.rs"]
mod native_focus;

#[derive(Default)]
pub struct Terminals(Mutex<Option<Running>>);
struct Running {
    child: CommandChild,
    documents: Vec<String>,
    layout: Value,
    generations: Vec<u64>,
    loaded: Vec<bool>,
    revoked: Vec<bool>,
    pending: HashMap<String, oneshot::Sender<Value>>,
    metadata_pending: HashMap<String, MetadataPending>,
    metadata_mutating: Option<String>,
    layout_generation: u64,
    layout_revision: u64,
    presentation_suspended: bool,
    busy: Vec<bool>,
    reviewing: Vec<bool>,
    sequence: u64,
    mcp_request: Option<(String, usize)>,
    mcp_denied: String,
    native_dialog: Option<(String, usize, u64)>,
    exited: Arc<Notify>,
    quit_notice: String,
    cancel: String,
    quit: String,
    confirming_quit: bool,
    exit_authorized: bool,
    retiring: bool,
    retire_denied: String,
    retired_notice: String,
}

struct MetadataPending {
    document: u64,
    generation: u64,
    source: String,
    sender: oneshot::Sender<Value>,
}
fn release_metadata(
    latch: &mut Option<String>,
    pending: &mut HashMap<String, MetadataPending>,
    id: &str,
    cancelled: bool,
) -> bool {
    let owner = latch.as_deref() == Some(id);
    pending.remove(id);
    if owner {
        *latch = None;
    }
    cancelled && owner
}
pub(crate) fn metadata_finish(app: &tauri::AppHandle, id: &str, cancelled: bool) {
    let state = app.state::<Terminals>();
    let mut guard = state.0.lock().unwrap();
    if let Some(r) = guard.as_mut() {
        // Only the cancelled mutation's owner invalidates presentation, never another command.
        if release_metadata(
            &mut r.metadata_mutating,
            &mut r.metadata_pending,
            id,
            cancelled,
        ) {
            advance_layout(r);
        }
    }
}
fn metadata_reply_matches(
    value: &Value,
    id: &str,
    pending: &MetadataPending,
    generation: u64,
) -> bool {
    value.as_object().is_some_and(|o| {
        o.len() == 4
            && ["kind", "id", "document", "value"]
                .iter()
                .all(|k| o.contains_key(*k))
    }) && value["kind"] == "feature-reply"
        && value["id"] == id
        && value["document"].as_u64() == Some(pending.document)
        && pending.generation == generation
        && crate::features::valid_reply(&value["value"])
}

fn advance_layout(r: &mut Running) {
    r.layout_generation = r.layout_generation.saturating_add(1);
    let _ = r.child.write(
        format!(
            "{}\n",
            json!({"kind":"layout-generation", "generation":r.layout_generation})
        )
        .as_bytes(),
    );
}

pub(crate) fn metadata_generation(app: &tauri::AppHandle) -> Option<u64> {
    app.state::<Terminals>()
        .0
        .lock()
        .unwrap()
        .as_ref()
        .map(|r| r.layout_generation)
}

/// Revocation precedes the first async focus check. No saved metadata grants input.
pub(crate) fn metadata_view_begin(app: &tauri::AppHandle) -> Option<u64> {
    revoke_all(app);
    let state = app.state::<Terminals>();
    let mut guard = state.0.lock().unwrap();
    let r = guard.as_mut()?;
    advance_layout(r);
    Some(r.layout_generation)
}

pub(crate) fn metadata_invalidate(app: &tauri::AppHandle) {
    revoke_all(app);
    let state = app.state::<Terminals>();
    let mut guard = state.0.lock().unwrap();
    if let Some(r) = guard.as_mut() {
        r.metadata_pending.clear();
        r.metadata_mutating = None;
        r.presentation_suspended = true;
        advance_layout(r);
        let _ = r.child.write(b"{\"kind\":\"layout-suspend\"}\n");
    }
}

/// Internal allowlisted metadata transport, never an execution command or generic sender.
pub(crate) async fn metadata_request(
    app: &tauri::AppHandle,
    envelope: Value,
    generation: u64,
) -> Value {
    let unavailable = || json!({"status":"unavailable"});
    if !crate::features::valid_envelope(&envelope) || presentation_blocked(app) {
        return json!({"status":"denied"});
    }
    let id = envelope["id"].as_str().unwrap().to_owned();
    let document = envelope["document"].as_u64().unwrap();
    if !crate::features::document_current(app, envelope["source"].as_str().unwrap(), document) {
        return json!({"status":"denied"});
    }
    let mutable = envelope["request"]["action"] != "snapshot";
    let receiver = {
        let state = app.state::<Terminals>();
        let mut guard = state.0.lock().unwrap();
        let Some(r) = guard.as_mut() else {
            return unavailable();
        };
        if r.layout_generation != generation || r.confirming_quit || r.exit_authorized {
            return unavailable();
        }
        if r.metadata_pending.len() >= 8
            || r.metadata_pending.contains_key(&id)
            || (mutable
                && (!review_available(
                    r.retiring,
                    r.mcp_request.is_some(),
                    &r.reviewing,
                    r.metadata_mutating.is_some(),
                ) || r.native_dialog.is_some()))
        {
            return json!({"status":"busy"});
        }
        let bytes = format!("{envelope}\n");
        if bytes.len() > 128 * 1024 {
            return json!({"status":"denied"});
        }
        let (sender, receiver) = oneshot::channel();
        r.metadata_pending.insert(
            id.clone(),
            MetadataPending {
                document,
                generation,
                source: envelope["source"].as_str().unwrap().into(),
                sender,
            },
        );
        if mutable {
            r.metadata_mutating = Some(id.clone());
        }
        if r.child.write(bytes.as_bytes()).is_err() {
            r.metadata_pending.remove(&id);
            if r.metadata_mutating.as_deref() == Some(&id) {
                advance_layout(r);
            }
            return unavailable();
        }
        if matches!(
            envelope["request"]["action"].as_str(),
            Some("select" | "organize")
        ) {
            r.presentation_suspended = false;
        }
        receiver
    };
    let result = tokio::time::timeout(Duration::from_secs(15), receiver).await;
    let received = matches!(&result, Ok(Ok(value)) if crate::features::valid_reply(value));
    let valid = {
        let state = app.state::<Terminals>();
        let mut guard = state.0.lock().unwrap();
        let Some(r) = guard.as_mut() else {
            return unavailable();
        };
        r.metadata_pending.remove(&id);
        let valid = r.layout_generation == generation;
        let owner = r.metadata_mutating.as_ref() == Some(&id);
        if valid && !received && owner {
            advance_layout(r);
        }
        valid
    };
    if !valid || presentation_blocked(app) {
        return unavailable();
    }
    match result {
        Ok(Ok(value)) if crate::features::valid_reply(&value) => value,
        _ => unavailable(),
    }
}

fn review_available(retiring: bool, mcp_pending: bool, busy: &[bool], metadata: bool) -> bool {
    !retiring && !mcp_pending && !metadata && !busy.iter().any(|busy| *busy)
}

fn url(slot: usize) -> String {
    format!("orqst-terminal://local/{slot}/index.html")
}

fn slot(window: &Webview) -> Option<usize> {
    document_slot(window.label(), window.url().ok()?.as_str())
}

fn document_slot(label: &str, source: &str) -> Option<usize> {
    let slot: usize = label.strip_prefix("terminal-")?.parse().ok()?;
    (slot < 8 && label == format!("terminal-{slot}") && source == url(slot)).then_some(slot)
}

// Tauri exposes native window focus, but no per-child-webview focus getter.
// Inspect the owned WKWebView's native first responder on the UI thread. Never
// accept a renderer-supplied active slot or document.hasFocus as execution proof.
async fn focused(view: &Webview) -> bool {
    let Some(slot) = slot(view) else { return false };
    let visible = view
        .state::<Terminals>()
        .0
        .lock()
        .unwrap()
        .as_ref()
        .is_some_and(|r| {
            r.layout["visible"]
                .as_array()
                .is_some_and(|slots| slots.iter().any(|s| s.as_u64() == Some(slot as u64)))
        });
    if !visible
        || !view.window().is_visible().unwrap_or(false)
        || !view.window().is_focused().unwrap_or(false)
    {
        return false;
    }
    #[cfg(target_os = "macos")]
    {
        let (tx, rx) = oneshot::channel();
        if view
            .with_webview(move |native| {
                // SAFETY: Tauri supplies the live WKWebView on the main thread;
                // pointers are borrowed only for these synchronous AppKit messages.
                let valid = unsafe {
                    use objc2::runtime::AnyObject;
                    use objc2::{msg_send, sel};
                    let webview = native.inner().cast::<AnyObject>();
                    let window: *mut AnyObject = msg_send![webview, window];
                    if window.is_null() {
                        false
                    } else {
                        let responder: *mut AnyObject = msg_send![window, firstResponder];
                        if responder.is_null() {
                            false
                        } else {
                            let is_view: bool =
                                msg_send![responder, respondsToSelector: sel!(isDescendantOf:)];
                            is_view && msg_send![responder, isDescendantOf: webview]
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
            tokio::time::timeout(Duration::from_secs(1), rx).await,
            Ok(Ok(true))
        )
    }
    #[cfg(not(target_os = "macos"))]
    false // Other platforms remain fail-closed until native child-focus is implemented.
}

// Developer-only metadata: no renderer control, content, pointer or title logging.
// Sampling never restores focus and never participates in an authorization decision.
#[cfg(target_os = "macos")]
async fn trace_dialog_focus(view: Webview) {
    let started = tokio::time::Instant::now();
    for millis in [0, 100, 250, 500, 1000] {
        tokio::time::sleep_until(started + Duration::from_millis(millis)).await;
        let focus = focused(&view).await;
        let (tx, rx) = oneshot::channel();
        let _ = view.with_webview(move |native| {
            // SAFETY: borrowed native objects are inspected synchronously on the UI thread.
            let sample = unsafe {
                use objc2::runtime::AnyObject;
                use objc2::{msg_send, sel};
                let webview = native.inner().cast::<AnyObject>();
                let window: *mut AnyObject = msg_send![webview, window];
                if window.is_null() { json!({"window": false}) } else {
                    let key: bool = msg_send![window, isKeyWindow];
                    let responder: *mut AnyObject = msg_send![window, firstResponder];
                    if responder.is_null() { json!({"key": key, "responder": false}) } else {
                        let is_view: bool = msg_send![responder, respondsToSelector: sel!(isDescendantOf:)];
                        let within: bool = is_view && msg_send![responder, isDescendantOf: webview];
                        json!({"key": key, "within": within, "class": (*responder).class().name().to_string_lossy()})
                    }
                }
            };
            let _ = tx.send(sample);
        });
        let native = tokio::time::timeout(Duration::from_secs(1), rx)
            .await
            .ok()
            .and_then(Result::ok);
        eprintln!(
            "ORQST_TERMINAL_FOCUS {}",
            json!({"atMs": millis, "elapsedMs": started.elapsed().as_millis(),
            "focused": focus, "visible": view.window().is_visible().ok(),
            "windowFocused": view.window().is_focused().ok(), "native": native})
        );
    }
}

fn focus_diagnostics() -> bool {
    std::env::var("ORQST_TAURI_FOCUS_DIAGNOSTICS").as_deref() == Ok("1")
}

fn send(app: &tauri::AppHandle, message: Value) -> bool {
    let state = app.state::<Terminals>();
    let mut guard = state.0.lock().unwrap();
    let Some(running) = guard.as_mut() else {
        return false;
    };
    let bytes = format!("{message}\n");
    bytes.len() <= 128 * 1024 && running.child.write(bytes.as_bytes()).is_ok()
}

#[cfg(test)]
mod tests {
    use super::{
        document_slot, metadata_reply_matches, release_metadata, review_available, MetadataPending,
    };
    use serde_json::json;

    #[test]
    fn metadata_cleanup_is_owned_and_snapshot_or_old_guard_cannot_release_another_mutation() {
        let entry = || {
            let (sender, _) = tokio::sync::oneshot::channel();
            MetadataPending {
                document: 1,
                generation: 2,
                source: "main".into(),
                sender,
            }
        };
        let mut latch = Some("current".to_owned());
        let mut pending = std::collections::HashMap::from([
            ("old".to_owned(), entry()),
            ("snapshot".to_owned(), entry()),
            ("current".to_owned(), entry()),
        ]);
        for id in ["old", "snapshot"] {
            assert!(!release_metadata(&mut latch, &mut pending, id, true));
            assert!(!pending.contains_key(id));
            assert_eq!(latch.as_deref(), Some("current"));
            assert!(pending.contains_key("current"));
            assert!(!review_available(false, false, &[false], latch.is_some()));
        }
        assert!(!release_metadata(
            &mut latch,
            &mut pending,
            "current",
            false
        ));
        assert!(latch.is_none());
        assert!(pending.is_empty());
        latch = Some("next".into());
        pending.insert("next".into(), entry());
        assert!(!release_metadata(&mut latch, &mut pending, "current", true));
        assert_eq!(latch.as_deref(), Some("next"));
        assert!(pending.contains_key("next"));
        assert!(release_metadata(&mut latch, &mut pending, "next", true));
        assert!(latch.is_none());
        assert!(pending.is_empty());
        assert!(!release_metadata(&mut latch, &mut pending, "next", true));
    }

    #[test]
    fn mcp_and_retirement_reviews_exclude_each_other_and_inflight_panes() {
        assert!(review_available(false, false, &[false, false], false));
        for (retiring, mcp) in [(true, false), (false, true), (true, true)] {
            assert!(!review_available(retiring, mcp, &[false, false], false));
        }
        assert!(!review_available(false, false, &[true, false], false));
        assert!(!review_available(false, false, &[false, true], false));
        assert!(!review_available(false, false, &[false, false], true));
    }
    #[test]
    fn metadata_pending_never_resolves_a_different_namespace_document_or_generation() {
        let id = "e10636eb-3a12-4094-9123-49a4cdad27b8";
        let (sender, mut receiver) = tokio::sync::oneshot::channel();
        let pending = MetadataPending {
            document: 3,
            generation: 4,
            source: "orqst-features://local/index.html".into(),
            sender,
        };
        let reply =
            json!({"kind":"feature-reply", "id":id, "document":3, "value":{"status":"denied"}});
        assert!(metadata_reply_matches(&reply, id, &pending, 4));
        for (key, value) in [
            ("kind", json!("reply")),
            ("document", json!(2)),
            ("id", json!("other")),
            ("extra", json!(true)),
        ] {
            let mut forged = reply.clone();
            forged[key] = value;
            assert!(!metadata_reply_matches(&forged, id, &pending, 4));
        }
        assert!(!metadata_reply_matches(&reply, id, &pending, 5));
        let mut requests = std::collections::HashMap::from([(id, pending)]);
        requests
            .remove(id)
            .unwrap()
            .sender
            .send(reply["value"].clone())
            .unwrap();
        assert_eq!(receiver.try_recv().unwrap(), json!({"status":"denied"}));
        assert!(!requests.contains_key(id)); // A duplicate or late ACK has no resolver.
    }

    #[test]
    fn commands_bind_only_the_exact_native_terminal_document() {
        assert_eq!(
            document_slot("terminal-0", "orqst-terminal://local/0/index.html"),
            Some(0)
        );
        for (label, source) in [
            ("main", "orqst-terminal://local/0/index.html"),
            ("terminal-0", "http://127.0.0.1:4319/"),
            ("terminal-0", "orqst-terminal://local/1/index.html"),
            ("terminal-0", "orqst-terminal://local/0/index.html?slot=1"),
            ("terminal-0", "orqst-terminal://local/0/index.html#reload"),
            ("terminal-00", "orqst-terminal://local/0/index.html"),
            ("terminal-8", "orqst-terminal://local/8/index.html"),
        ] {
            assert_eq!(document_slot(label, source), None);
        }
    }
}

fn revoke(app: &tauri::AppHandle, slot: usize, close: bool) {
    {
        let state = app.state::<Terminals>();
        let mut guard = state.0.lock().unwrap();
        if let Some(running) = guard.as_mut() {
            if let Some(generation) = running.generations.get_mut(slot) {
                *generation += 1;
            }
        }
    }
    send(
        app,
        json!({"kind": if close { "close" } else { "revoke" }, "slot": slot}),
    );
}

#[tauri::command]
pub async fn terminal_request(window: Webview, request: Value) -> Value {
    let denied = || json!({"status": "denied"});
    let Some(slot) = slot(&window) else {
        return denied();
    };
    let app = window.app_handle().clone();
    let passive = matches!(
        request["action"].as_str(),
        Some("read" | "snapshot" | "resize")
    );
    if presentation_blocked(&app) {
        return denied();
    }
    let focus = focused(&window).await;
    if focus {
        send(&app, json!({"kind":"layout-focus", "slot":slot}));
    }
    let (id, generation, receiver) = {
        let state = app.state::<Terminals>();
        let mut guard = state.0.lock().unwrap();
        let Some(running) = guard.as_mut() else {
            return denied();
        };
        if running.confirming_quit
            || running.exit_authorized
            || running.retiring
            || running.mcp_request.is_some()
            || !running.loaded.get(slot).copied().unwrap_or(false)
            || running.revoked[slot]
            || running.busy[slot]
            || (running.metadata_mutating.is_some() && !passive)
        {
            return denied();
        }
        if !matches!(
            request["action"].as_str(),
            Some("read" | "snapshot" | "resize" | "detach")
        ) && !focus
        {
            return json!({"status": "focus_required"});
        }
        running.sequence += 1;
        let id = format!("00000000-0000-4000-8000-{:012x}", running.sequence);
        let bytes = format!(
            "{}\n",
            json!({"kind": "request", "id": id, "slot": slot, "request": request, "focused": focus})
        );
        if bytes.len() > 128 * 1024 {
            return denied();
        }
        let (sender, receiver) = oneshot::channel();
        running.pending.insert(id.clone(), sender);
        running.busy[slot] = true;
        running.reviewing[slot] = !passive;
        if running.child.write(bytes.as_bytes()).is_err() {
            running.pending.remove(&id);
            running.busy[slot] = false;
            running.reviewing[slot] = false;
            return denied();
        }
        (id, running.generations[slot], receiver)
    };
    let result = tokio::time::timeout(Duration::from_secs(35), receiver).await;
    let valid = {
        let state = app.state::<Terminals>();
        let mut guard = state.0.lock().unwrap();
        let Some(running) = guard.as_mut() else {
            return denied();
        };
        running.pending.remove(&id);
        running.busy[slot] = false;
        running.reviewing[slot] = false;
        running.generations[slot] == generation && running.loaded[slot]
    };
    if !valid || presentation_blocked(&app) || self::slot(&window) != Some(slot) {
        return denied();
    }
    match result {
        Ok(Ok(value)) => value,
        _ => {
            // An uncertain transport is permanently fenced; never retry a mutation.
            revoke(&app, slot, true);
            denied()
        }
    }
}

#[tauri::command]
pub async fn terminal_view(window: Webview, action: Value) -> Value {
    let Some(slot) = slot(&window) else {
        return json!(false);
    };
    let app = window.app_handle();
    if action == "layout" {
        return app
            .state::<Terminals>()
            .0
            .lock()
            .unwrap()
            .as_ref()
            .map(|r| r.layout.clone())
            .unwrap_or(Value::Null);
    }
    let retiring = app
        .state::<Terminals>()
        .0
        .lock()
        .unwrap()
        .as_ref()
        .is_some_and(|r| r.retiring || r.metadata_mutating.is_some());
    if retiring || presentation_blocked(app) || !focused(&window).await {
        return json!(false);
    }
    // Revoke immediately, before the asynchronous Node layout update arrives.
    metadata_view_begin(app);
    if action == "dashboard" {
        metadata_invalidate(app);
        if let Some(main) = app.get_webview_window("main") {
            let _ = main.show();
            let _ = main.set_focus();
        }
    }
    json!(send(
        app,
        json!({"kind": "layout-action", "slot": slot, "action": action})
    ))
}

#[cfg(target_os = "macos")]
fn current_review(app: &tauri::AppHandle) -> bool {
    app.state::<Terminals>()
        .0
        .lock()
        .unwrap()
        .as_ref()
        .is_some_and(|r| {
            r.native_dialog
                .as_ref()
                .is_some_and(|(_, slot, generation)| {
                    r.generations.get(*slot) == Some(generation)
                        && r.loaded.get(*slot) == Some(&true)
                        && r.revoked.get(*slot) == Some(&false)
                })
        })
}

#[cfg(target_os = "macos")]
fn native_focus_lost(app: &tauri::AppHandle, reason: &str) {
    if focus_diagnostics() {
        eprintln!("ORQST_TERMINAL_REVOKE {reason}");
    }
    revoke_all(app);
}

#[cfg(target_os = "macos")]
fn suspend_input(app: &tauri::AppHandle) {
    let count = app
        .state::<Terminals>()
        .0
        .lock()
        .unwrap()
        .as_ref()
        .map_or(0, |r| r.documents.len());
    for slot in 0..count {
        send(app, json!({"kind":"suspend-input", "slot":slot}));
    }
}

fn revoke_all(app: &tauri::AppHandle) {
    let count = app
        .state::<Terminals>()
        .0
        .lock()
        .unwrap()
        .as_ref()
        .map(|r| r.documents.len())
        .unwrap_or(0);
    for slot in 0..count {
        revoke(app, slot, false);
    }
}

fn resize(app: &tauri::AppHandle, window: &Window) {
    if let Ok(size) = window.inner_size() {
        let logical = size.to_logical::<u32>(window.scale_factor().unwrap_or(1.0));
        send(
            app,
            json!({"kind":"layout-resize", "width":logical.width.clamp(1, 32768), "height":logical.height.clamp(1, 32768)}),
        );
    }
}

fn apply_layout(app: &tauri::AppHandle, value: &Value) {
    let handle = app.clone();
    let value = value.clone();
    let _ = app.run_on_main_thread(move || apply_layout_current(&handle, &value));
}
fn apply_layout_current(app: &tauri::AppHandle, value: &Value) {
    if presentation_blocked(app) {
        return;
    }
    let Some(window) = app.get_window("terminal-workspace") else {
        return;
    };
    let (Ok(size), Ok(scale)) = (window.inner_size(), window.scale_factor()) else {
        return;
    };
    let logical = size.to_logical::<u32>(scale);
    let state = &value["state"];
    {
        let terminal = app.state::<Terminals>();
        let mut guard = terminal.0.lock().unwrap();
        let Some(r) = guard.as_mut() else {
            return;
        };
        if !crate::features::valid_layout(
            value,
            r.documents.len(),
            logical.width,
            logical.height,
            r.layout_revision,
            r.layout_generation,
        ) || (r.presentation_suspended && state["suspended"] != true)
        {
            return;
        }
        r.layout_revision = value["revision"].as_u64().unwrap();
        r.layout = state.clone();
    }
    // The whole envelope is validated before any state, geometry or visibility change.
    let show = crate::features::workspace_visible(state);
    if !show {
        revoke_all(app);
        let _ = window.hide();
    }
    if let Some(chrome) = app.get_webview("feature-workspace") {
        if show {
            let _ = chrome.show();
        } else {
            let _ = chrome.hide();
        }
    }
    for bound in value["bounds"].as_array().unwrap() {
        let slot = bound["slot"].as_u64().unwrap();
        let Some(view) = app.get_webview(&format!("terminal-{slot}")) else {
            continue;
        };
        if bound["rect"].is_null() || !show {
            revoke(app, slot as usize, false);
            let _ = view.hide();
        } else {
            let rect = &bound["rect"];
            let _ = view.set_bounds(tauri::Rect {
                position: tauri::LogicalPosition::new(
                    rect["x"].as_f64().unwrap(),
                    rect["y"].as_f64().unwrap(),
                )
                .into(),
                size: tauri::LogicalSize::new(
                    rect["width"].as_f64().unwrap(),
                    rect["height"].as_f64().unwrap(),
                )
                .into(),
            });
            let _ = view.show();
        }
        let _ = view.eval(format!(
            "window.dispatchEvent(new CustomEvent('orqst-terminal-layout',{{detail:{state}}}));"
        ));
    }
    if show
        && !presentation_blocked(app)
        && metadata_generation(app) == value["generation"].as_u64()
    {
        if !window.is_visible().unwrap_or(false) {
            let _ = window.show();
        }
        if let Some(slot) = value["focus"].as_u64() {
            let _ = window.unminimize();
            let _ = window.set_focus();
            if let Some(view) = app.get_webview(&format!("terminal-{slot}")) {
                let _ = view.set_focus();
            }
        }
    }
}

async fn confirm(app: &tauri::AppHandle, value: &Value) {
    if presentation_blocked(app) {
        return;
    }
    let Some(slot) = value["slot"].as_u64().map(|v| v as usize) else {
        return;
    };
    let Some(id) = value["id"].as_str().map(str::to_owned) else {
        return;
    };
    let Some(window) = app.get_webview(&format!("terminal-{slot}")) else {
        return;
    };
    let valid = self::slot(&window) == Some(slot) && focused(&window).await;
    let fields: Option<Vec<&str>> = ["title", "message", "detail", "cancel", "approve"]
        .iter()
        .map(|key| value[*key].as_str())
        .collect();
    let Some(fields) = fields else { return };
    if !valid || fields.iter().any(|s| s.len() > 16384) {
        send(app, json!({"kind": "confirm", "id": id, "accepted": false}));
        return;
    }
    let request = value["requestId"].as_str().map(str::to_owned);
    let generation = {
        let state = app.state::<Terminals>();
        let mut guard = state.0.lock().unwrap();
        let Some(r) = guard.as_mut() else { return };
        if r.native_dialog.is_some() || r.metadata_mutating.is_some() {
            drop(guard);
            send(app, json!({"kind":"confirm", "id":id, "accepted":false}));
            return;
        }
        if request
            .as_ref()
            .is_some_and(|id| r.mcp_request.as_ref() != Some(&(id.clone(), slot)))
        {
            return;
        }
        let generation = r.generations.get(slot).copied();
        if let Some(generation) = generation {
            r.native_dialog = Some((id.clone(), slot, generation));
        }
        generation
    };
    let approve = fields[4].to_owned();
    let expected = approve.clone();
    let app = app.clone();
    // macOS: first/default and third/Escape both cancel; only the middle button approves.
    app.dialog().message(format!("{}\n\n{}", fields[1], fields[2]))
        .title(fields[0]).parent(&window.window())
        .buttons(MessageDialogButtons::YesNoCancelCustom(fields[3].into(), approve, fields[3].into()))
        .show_with_result(move |result| {
            tauri::async_runtime::spawn(async move {
                let focused = focused(&window).await;
                let current = app.state::<Terminals>().0.lock().unwrap().as_mut().and_then(|r| {
                    if r.native_dialog.as_ref().is_some_and(|(dialog_id, _, _)| dialog_id == &id) { r.native_dialog = None; }
                    if r.revoked.get(slot).copied().unwrap_or(true)
                        || request.as_ref().is_some_and(|id| r.mcp_request.as_ref() != Some(&(id.clone(), slot))) {
                        None
                    } else { r.generations.get(slot).copied() }
                });
                if focus_diagnostics() {
                    eprintln!("ORQST_TERMINAL_CONSENT {}", json!({"result": format!("{result:?}"), "approved": matches!(result, MessageDialogResult::Custom(ref text) if text == &expected), "focused": focused, "generation": generation, "current": current}));
                    #[cfg(target_os = "macos")]
                    tauri::async_runtime::spawn(trace_dialog_focus(window.clone()));
                }
                let accepted = matches!(result, MessageDialogResult::Custom(ref text) if text == &expected)
                    && generation == current && self::slot(&window) == Some(slot) && focused && !presentation_blocked(&app);
                send(&app, json!({"kind": "confirm", "id": id, "accepted": accepted}));
            });
        });
}

/// Native menu only: no renderer command can select a grant, supply a proof or call MCP tools.
async fn authorize_mcp(app: &tauri::AppHandle) {
    if presentation_blocked(app) {
        return;
    }
    let count = app
        .state::<Terminals>()
        .0
        .lock()
        .unwrap()
        .as_ref()
        .map(|r| r.documents.len())
        .unwrap_or(0);
    let mut selected = None;
    for slot in 0..count {
        if let Some(view) = app.get_webview(&format!("terminal-{slot}")) {
            if focused(&view).await {
                selected = Some(slot);
                break;
            }
        }
    }
    let Some(slot) = selected else { return };
    let (id, generation, receiver) = {
        let state = app.state::<Terminals>();
        let mut guard = state.0.lock().unwrap();
        let Some(r) = guard.as_mut() else { return };
        if !review_available(
            r.retiring,
            r.mcp_request.is_some(),
            &r.busy,
            r.metadata_mutating.is_some(),
        ) || count != 2
            || !r.loaded[slot]
            || r.revoked.iter().any(|revoked| *revoked)
        {
            return;
        }
        r.sequence += 1;
        let id = format!("00000000-0000-4000-8000-{:012x}", r.sequence);
        let (sender, receiver) = oneshot::channel();
        r.pending.insert(id.clone(), sender);
        r.mcp_request = Some((id.clone(), slot));
        let bytes = format!(
            "{}\n",
            json!({"kind":"authorizeMcp", "id":id, "slot":slot, "focused":true})
        );
        if r.child.write(bytes.as_bytes()).is_err() {
            r.pending.remove(&id);
            r.mcp_request = None;
            drop(guard);
            revoke(app, slot, true);
            return;
        }
        (id, r.generations[slot], receiver)
    };
    let result = tokio::time::timeout(Duration::from_secs(35), receiver).await;
    let notice = {
        let state = app.state::<Terminals>();
        let mut guard = state.0.lock().unwrap();
        let Some(r) = guard.as_mut() else { return };
        r.pending.remove(&id);
        r.mcp_request = None;
        match &result {
            _ if generation != r.generations[slot] => None,
            Ok(Ok(value)) if value["status"] == "ok" || value["status"] == "cancelled" => None,
            _ => Some((r.mcp_denied.clone(), r.cancel.clone())),
        }
    };
    if result.is_err() || matches!(result, Ok(Err(_))) {
        // Ambiguous authorization must not be retried; retain admission/quarantine evidence.
        revoke(app, slot, true);
    }
    if let Some((message, cancel)) = notice {
        if let Some(view) = app.get_webview(&format!("terminal-{slot}")) {
            if focused(&view).await {
                app.dialog()
                    .message(message)
                    .parent(&view.window())
                    .buttons(MessageDialogButtons::OkCustom(cancel))
                    .show(|_| {});
            }
        }
    }
}

/// Native menu only: no renderer request can retire a selection or unlock startup.
async fn retire_selection(app: &tauri::AppHandle) {
    if presentation_blocked(app) {
        return;
    }
    let count = app
        .state::<Terminals>()
        .0
        .lock()
        .unwrap()
        .as_ref()
        .map(|r| r.documents.len())
        .unwrap_or(0);
    let mut selected = None;
    for slot in 0..count {
        if let Some(view) = app.get_webview(&format!("terminal-{slot}")) {
            if focused(&view).await {
                selected = Some(slot);
                break;
            }
        }
    }
    let Some(slot) = selected else { return };
    let (id, receiver, denied, retired) = {
        let state = app.state::<Terminals>();
        let mut guard = state.0.lock().unwrap();
        let Some(r) = guard.as_mut() else { return };
        if !review_available(
            r.retiring,
            r.mcp_request.is_some(),
            &r.busy,
            r.metadata_mutating.is_some(),
        ) || !r.pending.is_empty()
            || !r.loaded[slot]
            || r.revoked[slot]
        {
            return;
        }
        r.retiring = true; // Fence every renderer before the first asynchronous Core operation.
        r.sequence += 1;
        let id = format!("00000000-0000-4000-8000-{:012x}", r.sequence);
        let (sender, receiver) = oneshot::channel();
        r.pending.insert(id.clone(), sender);
        (
            id,
            receiver,
            r.retire_denied.clone(),
            r.retired_notice.clone(),
        )
    };
    revoke_all(app);
    let sent = send(
        app,
        json!({"kind":"retire", "id":id, "slot":slot, "focused":true}),
    );
    let result = if sent {
        tokio::time::timeout(Duration::from_secs(60), receiver)
            .await
            .ok()
            .and_then(Result::ok)
    } else {
        None
    };
    let success = result
        .as_ref()
        .is_some_and(|value| value["status"] == "retired" && value["fenced"] == true);
    {
        let state = app.state::<Terminals>();
        let mut guard = state.0.lock().unwrap();
        if let Some(r) = guard.as_mut() {
            r.pending.remove(&id);
            // Only an explicit pre-proof refusal permits another fresh review. Timeout,
            // transport loss and possibly consumed proof stay fenced until application exit.
            if result.as_ref().is_some_and(|v| {
                v["fenced"] == false
                    && matches!(v["status"].as_str(), Some("denied" | "cancelled" | "busy"))
            }) {
                r.retiring = false;
            }
        }
    }
    if success {
        revoke_all(app);
        if let Some(workspace) = app.get_window("terminal-workspace") {
            let _ = workspace.hide();
        }
        // A fresh selection requires a new native application lifetime. Do not reset the
        // preparation latch or reuse old webviews, callbacks, journals or profile manifests.
        stop(app);
    }
    if result
        .as_ref()
        .is_some_and(|value| value["status"] == "cancelled")
    {
        return;
    }
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.show();
        let _ = main.set_focus();
        app.dialog()
            .message(if success { retired } else { denied })
            .parent(&main)
            .show(|_| {});
    }
}

pub async fn start(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let Ok(files) = std::env::var("ORQST_TAURI_TERMINALS") else {
        return Ok(());
    };
    let paths: Vec<String> = serde_json::from_str(&files)?;
    start_selected(app, paths).await
}

pub fn is_running(app: &tauri::AppHandle) -> bool {
    app.state::<Terminals>().0.lock().unwrap().is_some()
}

/// Paths originate only from startup configuration or the native provisioning review.
pub async fn start_selected(
    app: &tauri::AppHandle,
    paths: Vec<String>,
) -> Result<(), Box<dyn std::error::Error>> {
    if is_running(app) {
        return Err("Managed terminals already open".into());
    }
    if paths.is_empty() || paths.len() > 8 || paths.iter().any(|p| p.len() > 2048) {
        return Err("Invalid explicit managed terminal selection".into());
    }
    // Includes startup-environment selections: uncertain Core setup must never unlock
    // native preparation or reuse a terminal window in this application lifetime.
    crate::terminal_creation::fence_selection(app);
    let files = serde_json::to_string(&paths)?;
    let resources = app.path().resource_dir()?;
    let script = resources.join("core/tauri-terminal-host.cjs");
    let admission = app.path().app_data_dir()?.join("managed-agents");
    let (mut rx, child) = app
        .shell()
        .sidecar("orqst-node")?
        .args([
            script.as_os_str(),
            std::ffi::OsStr::new(&files),
            admission.as_os_str(),
        ])
        .env_clear()
        .envs(std::env::vars_os().filter(|(key, _)| {
            matches!(
                key.to_str(),
                Some("HOME" | "USERPROFILE" | "PATH" | "TMPDIR" | "LANG")
            )
        }))
        .spawn()?;
    let ready = tokio::time::timeout(Duration::from_secs(15), async {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) if bytes.len() <= 512 * 1024 => {
                    return serde_json::from_slice::<Value>(&bytes).ok()
                }
                CommandEvent::Stderr(_) => {}
                _ => return None,
            }
        }
        None
    })
    .await;
    let ready = match ready {
        Ok(Some(v))
            if v["kind"] == "ready"
                && v["panes"]
                    .as_array()
                    .is_some_and(|p| p.len() == paths.len()) =>
        {
            v
        }
        _ => {
            let _ = child.kill();
            return Err("Managed terminal startup refused".into());
        }
    };
    let panes = ready["panes"]
        .as_array()
        .ok_or("Missing terminal documents")?;
    let documents: Vec<String> = panes
        .iter()
        .map(|p| p["html"].as_str().unwrap_or("").to_owned())
        .collect();
    let count = documents.len();
    let exited = Arc::new(Notify::new());
    *app.state::<Terminals>().0.lock().unwrap() = Some(Running {
        child,
        documents,
        layout: ready["layout"].clone(),
        generations: vec![0; count],
        loaded: vec![false; count],
        revoked: vec![false; count],
        pending: HashMap::new(),
        metadata_pending: HashMap::new(),
        metadata_mutating: None,
        layout_generation: 0,
        layout_revision: 0,
        presentation_suspended: true,
        busy: vec![false; count],
        reviewing: vec![false; count],
        sequence: 0,
        mcp_request: None,
        mcp_denied: ready["mcpDenied"].as_str().unwrap_or("").into(),
        native_dialog: None,
        exited: exited.clone(),
        quit_notice: ready["quitNotice"].as_str().unwrap_or("").into(),
        cancel: ready["cancel"].as_str().unwrap_or("").into(),
        quit: ready["quit"].as_str().unwrap_or("").into(),
        confirming_quit: false,
        exit_authorized: false,
        retiring: false,
        retire_denied: ready["retireDenied"].as_str().unwrap_or("").into(),
        retired_notice: ready["retired"].as_str().unwrap_or("").into(),
    });
    let workspace = tauri::window::WindowBuilder::new(app, "terminal-workspace")
        .title(ready["title"].as_str().unwrap_or("ORQST"))
        .inner_size(1280.0, 860.0)
        .min_inner_size(480.0, 400.0)
        .visible(false)
        .build()?;
    // Append to the current menu so independently implemented creation actions survive.
    let menu = match app.menu() {
        Some(menu) => menu,
        None => Menu::default(app)?,
    };
    let submenu = Submenu::new(app, ready["title"].as_str().unwrap_or("ORQST"), true)?;
    submenu.append(&MenuItem::with_id(
        app,
        "terminal-retire-selection",
        ready["retire"].as_str().unwrap_or("ORQST"),
        true,
        None::<&str>,
    )?)?;
    for (slot, pane) in panes.iter().enumerate() {
        let label = format!("terminal-{slot}");
        submenu.append(&MenuItem::with_id(
            app,
            &label,
            pane["title"].as_str().unwrap_or("ORQST"),
            true,
            None::<&str>,
        )?)?;
        let handle = app.clone();
        let expected = url(slot);
        let builder = WebviewBuilder::new(&label, WebviewUrl::External(expected.parse()?))
            .focused(false)
            .disable_drag_drop_handler()
            .on_navigation(move |url| url.as_str() == expected)
            .on_new_window(|_, _| NewWindowResponse::Deny)
            .on_page_load(move |window, payload| {
                if payload.event() == tauri::webview::PageLoadEvent::Started {
                    let state = window.state::<Terminals>();
                    let mut guard = state.0.lock().unwrap();
                    let reload = guard.as_ref().is_some_and(|r| r.loaded[slot]);
                    if let Some(r) = guard.as_mut() {
                        r.loaded[slot] = true;
                        r.revoked[slot] |= reload;
                    }
                    drop(guard);
                    if reload {
                        metadata_invalidate(&handle);
                        revoke(&handle, slot, true);
                    }
                }
            });
        let view = workspace.add_child(
            builder,
            tauri::LogicalPosition::new(0.0, 0.0),
            tauri::LogicalSize::new(1280.0, 860.0),
        )?;
        view.hide()?;
    }
    let handle = app.clone();
    let target = workspace.clone();
    workspace.on_window_event(move |event| match event {
        WindowEvent::Focused(focus) => {
            #[cfg(target_os = "macos")]
            {
                if *focus {
                    native_focus::install(&handle);
                }
                let native = native_focus::sample(&target);
                if focus_diagnostics() {
                    eprintln!("ORQST_TERMINAL_WINDOW focused={focus} native={native:?}");
                }
                if !focus {
                    if native_focus::ready()
                        && native.is_some_and(|n| n.owns_sheet(current_review(&handle)))
                    {
                        suspend_input(&handle);
                    } else {
                        native_focus_lost(&handle, "window-blur");
                    }
                }
            }
            #[cfg(not(target_os = "macos"))]
            if !focus {
                revoke_all(&handle);
            }
        }
        WindowEvent::Resized(_) | WindowEvent::ScaleFactorChanged { .. } => {
            resize(&handle, &target)
        }
        WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            metadata_invalidate(&handle);
            revoke_all(&handle);
            send(&handle, json!({"kind":"layout-suspend"}));
            let _ = target.hide();
        }
        WindowEvent::Destroyed => {
            let count = handle
                .state::<Terminals>()
                .0
                .lock()
                .unwrap()
                .as_ref()
                .map(|r| r.documents.len())
                .unwrap_or(0);
            for slot in 0..count {
                revoke(&handle, slot, true);
            }
        }
        _ => {}
    });
    resize(app, &workspace);
    if ready["mcpEnabled"] == true {
        submenu.append(&MenuItem::with_id(
            app,
            "terminal-authorize-mcp",
            ready["mcpAuthorize"].as_str().unwrap_or("ORQST"),
            true,
            None::<&str>,
        )?)?;
    }
    menu.append(&submenu)?;
    app.set_menu(menu)?;
    app.on_menu_event(|app, event| {
        if presentation_blocked(app) {
            return;
        }
        if event.id().as_ref() == "terminal-authorize-mcp" {
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                authorize_mcp(&app).await;
            });
            return;
        }
        if event.id().as_ref() == "terminal-retire-selection" {
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                retire_selection(&app).await;
            });
            return;
        }
        if let Some(slot) = event
            .id()
            .as_ref()
            .strip_prefix("terminal-")
            .and_then(|s| s.parse::<usize>().ok())
        {
            if app
                .state::<Terminals>()
                .0
                .lock()
                .unwrap()
                .as_ref()
                .is_some_and(|r| r.retiring || r.metadata_mutating.is_some())
            {
                return;
            }
            metadata_view_begin(app);
            if let Some(r) = app.state::<Terminals>().0.lock().unwrap().as_mut() {
                r.presentation_suspended = false;
            }
            send(app, json!({"kind":"layout-open", "slot":slot}));
        }
    });
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) if bytes.len() <= 512 * 1024 => {
                    let Ok(value) = serde_json::from_slice::<Value>(&bytes) else {
                        break;
                    };
                    if value["kind"] == "feature-reply" {
                        if presentation_blocked(&app) {
                            continue;
                        }
                        let Some(id) = value["id"].as_str() else {
                            continue;
                        };
                        let state = app.state::<Terminals>();
                        let mut guard = state.0.lock().unwrap();
                        if let Some(r) = guard.as_mut() {
                            let valid = r.metadata_pending.get(id).is_some_and(|p| {
                                metadata_reply_matches(&value, id, p, r.layout_generation)
                                    && crate::features::document_current(
                                        &app, &p.source, p.document,
                                    )
                            });
                            if valid {
                                if let Some(pending) = r.metadata_pending.remove(id) {
                                    let _ = pending.sender.send(value["value"].clone());
                                }
                            }
                        }
                    } else if value["kind"] == "reply" {
                        let Some(id) = value["id"].as_str() else {
                            break;
                        };
                        let state = app.state::<Terminals>();
                        let mut guard = state.0.lock().unwrap();
                        if let Some(r) = guard.as_mut() {
                            if let Some(sender) = r.pending.remove(id) {
                                let _ = sender.send(value["value"].clone());
                            }
                        }
                    } else if value["kind"] == "retirement" {
                        let Some(id) = value["id"].as_str() else {
                            break;
                        };
                        let state = app.state::<Terminals>();
                        let mut guard = state.0.lock().unwrap();
                        if let Some(r) = guard.as_mut() {
                            if let Some(sender) = r.pending.remove(id) {
                                let _ = sender.send(value.clone());
                            }
                        }
                    } else if value["kind"] == "confirm" {
                        confirm(&app, &value).await;
                    } else if value["kind"] == "layout" {
                        apply_layout(&app, &value);
                    } else {
                        break;
                    }
                }
                CommandEvent::Stderr(_) => {}
                CommandEvent::Terminated(_) => {
                    exited.notify_one();
                    break;
                }
                _ => break,
            }
        }
        stop(&app);
    });
    Ok(())
}

pub fn resource(app: &tauri::AppHandle, uri: &tauri::http::Uri) -> Option<(Vec<u8>, &'static str)> {
    if uri.scheme_str() != Some("orqst-terminal")
        || uri.host() != Some("local")
        || uri.query().is_some()
    {
        return None;
    }
    let parts: Vec<&str> = uri.path().trim_start_matches('/').split('/').collect();
    if parts.len() != 2 {
        return None;
    }
    let slot: usize = parts[0].parse().ok()?;
    let state = app.state::<Terminals>();
    let guard = state.0.lock().unwrap();
    let running = guard.as_ref()?;
    let document = running.documents.get(slot)?;
    match parts[1] {
        "index.html" => Some((document.as_bytes().to_vec(), "text/html; charset=utf-8")),
        "client.js" | "style.css" => {
            let file = app
                .path()
                .resource_dir()
                .ok()?
                .join("terminal")
                .join(parts[1]);
            Some((
                std::fs::read(file).ok()?,
                if parts[1] == "client.js" {
                    "text/javascript"
                } else {
                    "text/css"
                },
            ))
        }
        _ => None,
    }
}

pub fn stop(app: &tauri::AppHandle) {
    let running = app.state::<Terminals>().0.lock().unwrap().take();
    if let Some(mut running) = running {
        // EOF fences all brokers and closes only the owned Node Core/PTY transports.
        let _ = running.child.write(b"shutdown\n");
        tauri::async_runtime::spawn(async move {
            if tokio::time::timeout(Duration::from_secs(6), running.exited.notified())
                .await
                .is_err()
            {
                let _ = running.child.kill();
            }
        });
    }
}

pub fn stop_and_wait(app: &tauri::AppHandle) {
    let running = app.state::<Terminals>().0.lock().unwrap().take();
    if let Some(mut running) = running {
        let _ = running.child.write(b"shutdown\n");
        let stopped = tauri::async_runtime::block_on(async {
            tokio::time::timeout(Duration::from_secs(6), running.exited.notified()).await
        });
        if stopped.is_err() {
            let _ = running.child.kill();
        }
    }
}

#[cfg(target_os = "macos")]
pub(crate) fn install_quit_observer(app: &tauri::AppHandle) -> bool {
    native_focus::install(app)
}

#[cfg(target_os = "macos")]
pub(crate) fn quit_window_focus(window: &tauri::Window) -> Option<(bool, bool)> {
    let focus = native_focus::sample(window)?;
    Some((focus.owns_key(true), focus.owns_sheet(true)))
}

/// Shared presentation fence for metadata-only Feature replies during either Quit gate.
pub(crate) fn presentation_blocked(app: &tauri::AppHandle) -> bool {
    let terminal = app
        .state::<Terminals>()
        .0
        .lock()
        .unwrap()
        .as_ref()
        .is_some_and(|r| r.confirming_quit || r.exit_authorized);
    terminal || crate::agents::exit_pending(app)
}

/// Closing the application requires explicit consent to disconnect owned tasks.
pub fn reset_exit(app: &tauri::AppHandle) {
    if let Some(r) = app.state::<Terminals>().0.lock().unwrap().as_mut() {
        r.exit_authorized = false;
        r.confirming_quit = false;
    }
}

pub fn confirm_exit(app: &tauri::AppHandle) -> bool {
    if std::env::var("ORQST_TAURI_FOCUS_DIAGNOSTICS").as_deref() == Ok("1") {
        eprintln!("ORQST_QUIT_GATE terminal");
    }
    let fields = {
        let state = app.state::<Terminals>();
        let mut guard = state.0.lock().unwrap();
        let Some(r) = guard.as_mut() else {
            return false;
        };
        if r.metadata_mutating.is_some() {
            // Admission and the Quit latch share the same lock; no review can race a mutation.
            advance_layout(r);
            drop(guard);
            revoke_all(app);
            return true;
        }
        if r.exit_authorized {
            return false;
        }
        if r.confirming_quit {
            return true;
        }
        r.confirming_quit = true;
        r.metadata_pending.clear();
        advance_layout(r);
        (r.quit_notice.clone(), r.cancel.clone(), r.quit.clone())
    };
    revoke_all(app);
    crate::agents::revoke_for_quit(app);
    let Some(parent) = crate::desktop::quit_parent(app) else {
        reset_exit(app);
        crate::agents::reset_exit(app);
        return true;
    };
    let Some(token) = crate::desktop::begin_quit_review(app, &parent) else {
        reset_exit(app);
        crate::agents::reset_exit(app);
        return true;
    };
    let app = app.clone();
    app.dialog()
        .message(fields.0)
        .parent(&parent)
        .buttons(MessageDialogButtons::YesNoCancelCustom(
            fields.1.clone(),
            fields.2.clone(),
            fields.1,
        ))
        .show_with_result(move |result| {
            if std::env::var("ORQST_TAURI_FOCUS_DIAGNOSTICS").as_deref() == Ok("1") {
                eprintln!("ORQST_QUIT_RESULT terminal {result:?}");
            }
            let presented = crate::desktop::finish_quit_review(&app, token, parent.label());
            if std::env::var("ORQST_TAURI_FOCUS_DIAGNOSTICS").as_deref() == Ok("1") {
                eprintln!("ORQST_QUIT_REVIEW token={token} presented={presented}");
            }
            if crate::desktop::quit_approved(
                &result,
                &fields.2,
                presented
                    && app.get_window(parent.label()).is_some()
                    && parent.is_visible().unwrap_or(false),
            ) {
                if let Some(r) = app.state::<Terminals>().0.lock().unwrap().as_mut() {
                    r.exit_authorized = true;
                }
                app.exit(0);
            } else {
                reset_exit(&app);
                crate::agents::reset_exit(&app);
            }
        });
    true
}
