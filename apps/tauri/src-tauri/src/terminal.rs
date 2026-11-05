//! Native-only client of ORQST's existing TerminalNativeBroker/Node host.
//! The observer webview has no capability for these commands or this private pipe.
use crate::local_diagnostics::{Attempt, Effects, Outcome, Stage};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::menu::{Menu, MenuItem, Submenu};
use tauri::webview::NewWindowResponse;
use tauri::webview::WebviewBuilder;
use tauri::{Manager, Webview, WebviewUrl, Window, WindowEvent};
#[cfg(not(target_os = "macos"))]
use tauri_plugin_dialog::MessageDialogResult;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use tokio::sync::oneshot;
use tokio::sync::Notify;
#[cfg(target_os = "macos")]
#[path = "terminal_focus.rs"]
mod native_focus;

#[cfg(target_os = "macos")]
#[path = "terminal_consent.rs"]
mod native_consent;

#[path = "terminal_admission.rs"]
mod terminal_admission;
use terminal_admission::{
    owns_enrollment, preparation_matches, take_host, AdmissionIdentity, PreparationSnapshot,
};

#[derive(Default)]
pub struct Terminals(Mutex<Option<Running>>);
struct Running {
    child: CommandChild,
    epoch: String,
    admission_owner: String,
    initial_files: Vec<String>,
    capacity: usize,
    enrollment_pending: bool,
    enrollment_request: Option<String>,
    enrollment_fenced: bool,
    documents: Vec<String>,
    labels: Vec<String>,
    providers: Vec<String>,
    layout: Value,
    generations: Vec<u64>,
    loaded: Vec<bool>,
    revoked: Vec<bool>,
    pending_open: Vec<Option<OpeningIntent>>,
    // Optional diagnostic correlation only; never consulted by an authority/lifecycle gate.
    opening_diagnostics: Vec<Option<Attempt>>,
    pending: HashMap<String, oneshot::Sender<Value>>,
    quit_pending: crate::quit_orchestration::PendingReplies,
    metadata_pending: HashMap<String, MetadataPending>,
    metadata_mutating: Option<String>,
    permission_review: Option<(String, usize)>,
    layout_generation: u64,
    layout_revision: u64,
    last_focus_notice: Option<Instant>,
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

struct OpeningIntent {
    profile: String,
    document: u64,
    presentation: u64,
    expires: Instant,
}
impl OpeningIntent {
    fn current(&self, document: u64, presentation: u64, now: Instant) -> bool {
        self.document == document && self.presentation == presentation && now < self.expires
    }
}

fn invalidate_opening(document: &mut u64, pending: &mut Option<OpeningIntent>) {
    *document = document.wrapping_add(1);
    *pending = None;
}
fn take_opening(
    pending: &mut Option<OpeningIntent>,
    expected: (u64, u64, Instant),
    current: (u64, u64),
    now: Instant,
) -> Option<String> {
    let valid = current == (expected.0, expected.1)
        && now < expected.2
        && pending
            .as_ref()
            .is_some_and(|intent| intent.current(current.0, current.1, now));
    let taken = pending.take(); // Invalid intents are consumed too, never rearmed on focus.
    if valid {
        taken.map(|intent| intent.profile)
    } else {
        None
    }
}

struct MetadataPending {
    document: u64,
    generation: u64,
    source: String,
    permission: bool,
    sender: oneshot::Sender<Value>,
    owner: Arc<()>,
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
pub(crate) fn metadata_finish(app: &tauri::AppHandle, epoch: &str, id: &str, cancelled: bool) {
    let state = app.state::<Terminals>();
    let mut guard = state.0.lock().unwrap();
    if let Some(r) = guard.as_mut().filter(|r| r.epoch == epoch) {
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
        && if pending.permission {
            crate::features::valid_permission_reply(&value["value"])
        } else {
            crate::features::valid_reply(&value["value"])
        }
}

// The document check can synchronously wait for UI. Only immutable ownership crosses that wait.
fn take_metadata_reply(
    state: &Mutex<Option<Running>>,
    epoch: &str,
    id: &str,
    matches: impl Fn(&MetadataPending, u64) -> bool,
    document_current: impl FnOnce(&str, u64) -> bool,
    version_current: impl FnOnce(&str, u64) -> bool,
) -> Option<MetadataPending> {
    let (source, document, generation, owner) = {
        let guard = state.lock().unwrap();
        let r = guard.as_ref().filter(|r| r.epoch == epoch)?;
        let pending = r.metadata_pending.get(id)?;
        if !matches(pending, r.layout_generation) {
            return None;
        }
        (
            pending.source.clone(),
            pending.document,
            pending.generation,
            pending.owner.clone(),
        )
    };
    if !document_current(&source, document) {
        return None;
    }
    let mut guard = state.lock().unwrap();
    let r = guard.as_mut().filter(|r| r.epoch == epoch)?;
    let pending = r.metadata_pending.get(id)?;
    if r.layout_generation != generation
        || pending.source != source
        || pending.document != document
        || !Arc::ptr_eq(&pending.owner, &owner)
        || !matches(pending, r.layout_generation)
        || !version_current(&source, document)
    {
        return None;
    }
    r.metadata_pending.remove(id)
}

pub(crate) fn metadata_context(app: &tauri::AppHandle) -> Option<(String, u64)> {
    app.state::<Terminals>()
        .0
        .lock()
        .unwrap()
        .as_ref()
        .map(|r| (r.epoch.clone(), r.layout_generation))
}

fn publish_layout_generation(r: &mut Running) {
    let _ = r.child.write(
        format!(
            "{}\n",
            json!({"kind":"layout-generation", "generation":r.layout_generation})
        )
        .as_bytes(),
    );
}

fn advance_layout(r: &mut Running) {
    r.layout_generation = r.layout_generation.saturating_add(1);
    publish_layout_generation(r);
}

fn invalidate_presentation_state(generation: &mut u64, suspended: &mut bool) {
    *generation = (*generation).saturating_add(1);
    *suspended = true;
}

fn invalidate_layout(r: &mut Running) {
    r.metadata_pending.clear();
    r.metadata_mutating = None;
    r.permission_review = None;
    invalidate_presentation_state(&mut r.layout_generation, &mut r.presentation_suspended);
    publish_layout_generation(r);
    let _ = r.child.write(b"{\"kind\":\"layout-suspend\"}\n");
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
        invalidate_layout(r);
    }
}

/// Internal allowlisted metadata transport, never an execution command or generic sender.
pub(crate) async fn metadata_request(
    app: &tauri::AppHandle,
    envelope: Value,
    generation: u64,
    epoch: &str,
) -> Value {
    metadata_request_inner(app, envelope, generation, epoch, None).await
}
#[cfg(target_os = "macos")]
pub(crate) async fn permission_review_request(
    app: &tauri::AppHandle,
    view: Webview,
    envelope: Value,
    generation: u64,
    epoch: &str,
    owner: &str,
) -> Value {
    use std::future::Future;
    use std::task::{Context, Poll, Waker};
    let (sender, receiver) = oneshot::channel();
    let app = app.clone();
    let epoch = epoch.to_owned();
    let owner = owner.to_owned();
    let runtime = tokio::runtime::Handle::current();
    if view
        .with_webview(move |native| {
            if sender.is_closed() {
                return;
            }
            // SAFETY: Tauri guarantees a live WKWebView on this AppKit thread.
            let focused = unsafe { native_focus::chrome_first_responder(native.inner().cast()) };
            if !focused
                || !permission_review_current(&app, &epoch, generation, &owner)
                || !envelope["request"]["featureId"]
                    .as_str()
                    .zip(envelope["request"]["generation"].as_u64())
                    .is_some_and(|(feature, logical)| {
                        crate::features::permission_capture_current(
                            &app, feature, &epoch, generation, logical,
                        )
                    })
            {
                let _ = sender.send(None);
                return;
            }
            let _entered = runtime.enter();
            let mut future = Box::pin(async move {
                metadata_request_inner(&app, envelope, generation, &epoch, Some(&owner)).await
            });
            // Dispatch occurs synchronously before the first await, while AppKit cannot process
            // a focus change. Retain the future until its correlated reply or cancellation.
            let mut cx = Context::from_waker(Waker::noop());
            match future.as_mut().poll(&mut cx) {
                Poll::Ready(value) => {
                    let _ = sender.send(Some((Some(value), future)));
                }
                Poll::Pending => {
                    let _ = sender.send(Some((None, future)));
                }
            }
        })
        .is_err()
    {
        return json!({"status":"unavailable"});
    }
    match receiver.await {
        Ok(Some((Some(value), _))) => value,
        Ok(Some((None, future))) => future.await,
        _ => json!({"status":"denied"}),
    }
}
#[cfg(not(target_os = "macos"))]
pub(crate) async fn permission_review_request(
    _app: &tauri::AppHandle,
    _view: Webview,
    _envelope: Value,
    _generation: u64,
    _epoch: &str,
    _owner: &str,
) -> Value {
    json!({"status":"denied"})
}

async fn metadata_request_inner(
    app: &tauri::AppHandle,
    envelope: Value,
    generation: u64,
    epoch: &str,
    review_owner: Option<&str>,
) -> Value {
    let unavailable = || json!({"status":"unavailable"});
    let permission = crate::features::valid_permission_envelope(&envelope);
    if !(permission || crate::features::valid_envelope(&envelope))
        || (review_owner.is_some() && !permission)
        || (permission && envelope["actorId"] != format!("native-{epoch}"))
        || presentation_blocked(app)
    {
        return json!({"status":"denied"});
    }
    let id = envelope["id"].as_str().unwrap().to_owned();
    let document = envelope["document"].as_u64().unwrap();
    let document_is_current = if review_owner.is_some() {
        crate::features::document_version_current(
            app,
            envelope["source"].as_str().unwrap(),
            document,
        )
    } else {
        crate::features::document_current(app, envelope["source"].as_str().unwrap(), document)
    };
    if !document_is_current {
        return json!({"status":"denied"});
    }
    let mutable = envelope["request"]["action"] != "snapshot";
    let owner = Arc::new(());
    let receiver = {
        let state = app.state::<Terminals>();
        let mut guard = state.0.lock().unwrap();
        let Some(r) = guard.as_mut() else {
            return unavailable();
        };
        if r.epoch != epoch
            || r.layout_generation != generation
            || r.confirming_quit
            || r.exit_authorized
            || !crate::features::document_version_current(
                app,
                envelope["source"].as_str().unwrap(),
                document,
            )
        {
            return unavailable();
        }
        let owns_review = review_owner.is_some_and(|owner| {
            r.metadata_mutating.as_deref() == Some(owner)
                && r.permission_review
                    .as_ref()
                    .is_some_and(|(id, _)| id == owner)
        });
        if (review_owner.is_some() && !owns_review)
            || r.metadata_pending.len() >= 8
            || r.metadata_pending.contains_key(&id)
            || (mutable
                && !owns_review
                && (!review_available(
                    r.retiring,
                    r.mcp_request.is_some(),
                    &r.reviewing,
                    r.metadata_mutating.is_some() || r.enrollment_pending,
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
                permission,
                sender,
                owner: owner.clone(),
            },
        );
        if mutable && !owns_review {
            r.metadata_mutating = Some(id.clone());
        }
        if r.child.write(bytes.as_bytes()).is_err() {
            r.metadata_pending.remove(&id);
            if r.metadata_mutating.as_deref() == Some(&id) || owns_review {
                advance_layout(r);
            }
            return unavailable();
        }
        if matches!(
            envelope["request"]["action"].as_str(),
            Some("canvas" | "select" | "organize")
        ) || (envelope["request"]["action"] == "pane"
            && envelope["request"]["command"] == "focus")
        {
            r.presentation_suspended = false;
        }
        receiver
    };
    let result = tokio::time::timeout(Duration::from_secs(15), receiver).await;
    let valid_reply = |value: &Value| {
        if permission {
            crate::features::valid_permission_reply(value)
        } else {
            crate::features::valid_reply(value)
        }
    };
    let received = matches!(&result, Ok(Ok(value)) if valid_reply(value));
    let valid = {
        let state = app.state::<Terminals>();
        let mut guard = state.0.lock().unwrap();
        let Some(r) = guard.as_mut() else {
            return unavailable();
        };
        if r.epoch != epoch {
            return unavailable();
        }
        if let Some(pending) = r.metadata_pending.get(&id) {
            if !Arc::ptr_eq(&pending.owner, &owner) {
                return unavailable();
            }
            r.metadata_pending.remove(&id);
        }
        let valid = r.layout_generation == generation
            && crate::features::document_version_current(
                app,
                envelope["source"].as_str().unwrap(),
                document,
            );
        let owner = r.metadata_mutating.as_ref() == Some(&id)
            || review_owner.is_some_and(|owner| r.metadata_mutating.as_deref() == Some(owner));
        if valid && !received && owner {
            advance_layout(r);
        }
        valid
    };
    if !valid || presentation_blocked(app) {
        return unavailable();
    }
    match result {
        Ok(Ok(value)) if valid_reply(&value) => value,
        _ => unavailable(),
    }
}

pub(crate) fn permission_review_begin(
    app: &tauri::AppHandle,
    epoch: &str,
    generation: u64,
    id: &str,
) -> bool {
    let state = app.state::<Terminals>();
    let mut guard = state.0.lock().unwrap();
    let Some(r) = guard.as_mut() else {
        return false;
    };
    if r.epoch != epoch
        || r.layout_generation != generation
        || r.confirming_quit
        || r.exit_authorized
        || r.native_dialog.is_some()
        || !review_available(
            r.retiring,
            r.mcp_request.is_some(),
            &r.reviewing,
            r.metadata_mutating.is_some() || r.enrollment_pending,
        )
    {
        return false;
    }
    r.metadata_mutating = Some(id.into());
    r.permission_review = Some((id.into(), 0));
    true
}
pub(crate) fn permission_review_current(
    app: &tauri::AppHandle,
    epoch: &str,
    generation: u64,
    id: &str,
) -> bool {
    let state = app.state::<Terminals>();
    let guard = state.0.lock().unwrap();
    guard.as_ref().is_some_and(|r| {
        r.epoch == epoch
            && r.layout_generation == generation
            && !r.confirming_quit
            && !r.exit_authorized
            && r.metadata_mutating.as_deref() == Some(id)
            && r.permission_review
                .as_ref()
                .is_some_and(|(owner, _)| owner == id)
    })
}
pub(crate) fn permission_review_finish(
    app: &tauri::AppHandle,
    epoch: &str,
    id: &str,
    cancelled: bool,
) {
    let state = app.state::<Terminals>();
    let mut guard = state.0.lock().unwrap();
    if let Some(r) = guard.as_mut().filter(|r| r.epoch == epoch) {
        if r.permission_review
            .as_ref()
            .is_some_and(|(owner, _)| owner == id)
        {
            r.permission_review = None;
        }
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
mod presentation_phase_tests {
    use crate::host_phase::Phase;

    #[test]
    fn a_shutdown_or_lost_host_blocks_presentation() {
        assert!(!super::phase_blocks_presentation(Phase::NotStarted));
        assert!(!super::phase_blocks_presentation(Phase::Active));
        assert!(super::phase_blocks_presentation(Phase::ShutdownInFlight));
        assert!(super::phase_blocks_presentation(Phase::LostUnknown));
        assert!(!super::phase_blocks_presentation(
            Phase::ExitEvidenceConfirmed
        ));
    }
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
                permission: false,
                sender,
                owner: std::sync::Arc::new(()),
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
            permission: false,
            sender,
            owner: std::sync::Arc::new(()),
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

/// Narrow document revocation for a terminated renderer. No process effect.
pub fn revoke_document(app: &tauri::AppHandle, label: &str) {
    let Some(slot) = label
        .strip_prefix("terminal-")
        .and_then(|value| value.parse::<usize>().ok())
    else {
        return;
    };
    revoke(app, slot, true);
}

fn revoke(app: &tauri::AppHandle, slot: usize, close: bool) {
    {
        let state = app.state::<Terminals>();
        let mut guard = state.0.lock().unwrap();
        if let Some(running) = guard.as_mut() {
            if let Some(generation) = running.generations.get_mut(slot) {
                invalidate_opening(generation, &mut running.pending_open[slot]);
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
    dispatch_terminal_request(window, request, None).await
}
fn opening_outcome(status: Option<&str>, opening: Option<&str>) -> Outcome {
    match (status, opening) {
        (Some("ok"), Some("ready")) => Outcome::Ready,
        (Some("ok"), Some("incomplete")) => Outcome::Uncertain,
        (Some("cancelled"), _) => Outcome::Cancelled,
        (Some("denied" | "busy" | "focus_required"), _) => Outcome::Refused,
        _ => Outcome::Unconfirmed,
    }
}

async fn dispatch_terminal_request(
    window: Webview,
    request: Value,
    expected: Option<(u64, u64, Instant)>,
) -> Value {
    // Retain the originating preparation attempt for the first dispatch per member.
    // Taking this optional tag cannot consume an intent, grant, pending reply or reservation.
    let diagnostic = if request["action"] == "open" {
        let diagnostic = slot(&window).and_then(|slot| {
            let state = window.state::<Terminals>();
            let mut guard = state.0.lock().unwrap();
            guard
                .as_mut()
                .and_then(|r| r.opening_diagnostics.get_mut(slot))
                .and_then(Option::take)
        });
        Some(diagnostic.unwrap_or_default())
    } else {
        None
    };
    if let Some(diagnostic) = &diagnostic {
        diagnostic.record(Stage::CliOpening, Outcome::Requested, Effects::Unconfirmed);
    }
    let value = dispatch_terminal_request_inner(window, request, expected).await;
    if let Some(diagnostic) = &diagnostic {
        let outcome = opening_outcome(value["status"].as_str(), value["opening"].as_str());
        diagnostic.record(Stage::CliOpening, outcome, Effects::Possible);
    }
    value
}

async fn dispatch_terminal_request_inner(
    window: Webview,
    request: Value,
    expected: Option<(u64, u64, Instant)>,
) -> Value {
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
            || expected.is_some_and(|(document, presentation, expires)| {
                running.generations[slot] != document
                    || running.layout_generation != presentation
                    || Instant::now() >= expires
            })
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
        if request["action"] == "open" {
            running.pending_open[slot] = None;
        }
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
    let open = request["action"] == "open";
    let focused_after = !open || focused(&window).await;
    let current_document = self::slot(&window) == Some(slot)
        && app
            .state::<Terminals>()
            .0
            .lock()
            .unwrap()
            .as_ref()
            .is_some_and(|r| r.loaded[slot] && !r.revoked[slot]);
    let current_generation = app
        .state::<Terminals>()
        .0
        .lock()
        .unwrap()
        .as_ref()
        .is_some_and(|r| r.generations[slot] == generation);
    if !valid
        || !focused_after
        || !current_generation
        || presentation_blocked(&app)
        || !current_document
    {
        if open && current_document {
            if let Ok(Ok(ref value)) = result {
                return incomplete_open(value);
            }
        }
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

fn incomplete_open(value: &Value) -> Value {
    if value["status"] == "ok" && crate::features::uuid(&value["instanceId"]) {
        json!({"status":"ok", "instanceId":value["instanceId"], "opening":"incomplete"})
    } else {
        json!({"status":"denied"})
    }
}

/// A single native-held intent from create-selected. No renderer path, profile or proof.
#[tauri::command]
pub async fn terminal_open_prepared(window: Webview) -> Value {
    let idle = || json!({"attempted":false});
    let Some(slot) = slot(&window) else {
        return idle();
    };
    let app = window.app_handle().clone();
    let epoch = {
        let state = app.state::<Terminals>();
        let mut guard = state.0.lock().unwrap();
        let Some(r) = guard.as_mut() else {
            return idle();
        };
        let Some(intent) = r.pending_open[slot].as_ref() else {
            return idle();
        };
        if !intent.current(r.generations[slot], r.layout_generation, Instant::now()) {
            r.pending_open[slot] = None;
            return idle();
        }
        (r.generations[slot], r.layout_generation, intent.expires)
    };
    if presentation_blocked(&app) || !focused(&window).await || self::slot(&window) != Some(slot) {
        return idle();
    }
    let profile = {
        let state = app.state::<Terminals>();
        let mut guard = state.0.lock().unwrap();
        let Some(r) = guard.as_mut() else {
            return idle();
        };
        if r.busy[slot]
            || r.revoked[slot]
            || !r.loaded[slot]
            || r.metadata_mutating.is_some()
            || r.enrollment_pending
            || r.confirming_quit
            || r.exit_authorized
            || r.retiring
            || r.mcp_request.is_some()
        {
            return idle();
        }
        let current = (r.generations[slot], r.layout_generation);
        take_opening(&mut r.pending_open[slot], epoch, current, Instant::now())
    };
    let Some(profile) = profile else {
        return idle();
    };
    let value = dispatch_terminal_request(
        window,
        json!({"version":1,"action":"open","profileId":profile}),
        Some(epoch),
    )
    .await;
    json!({"attempted":true,"value":value})
}

/// A dock restore only re-shows an existing hidden slot; it grants no process authority.
pub(crate) fn restore_allowed(
    slot: u64,
    count: usize,
    visible: &[u64],
    generation: u64,
    current: u64,
) -> bool {
    generation == current && (slot as usize) < count && !visible.contains(&slot)
}

struct RestoreContext {
    count: usize,
    visible: Vec<u64>,
    generation: u64,
    suspended: bool,
    fenced: bool,
    document_current: bool,
}

#[cfg(test)]
mod restore_tests {
    use super::*;
    use std::sync::Barrier;

    #[test]
    fn restore_barrier_rejects_invalidation_before_the_locked_write() {
        for invalidation in [
            "generation",
            "document",
            "suspended",
            "fenced",
            "visible",
            "none",
        ] {
            let state = Arc::new(Mutex::new((
                7_u64,
                3_u64,
                false,
                false,
                vec![0],
                Vec::<Value>::new(),
            )));
            let captured = {
                let guard = state.lock().unwrap();
                (guard.0, guard.1)
            };
            let barrier = Arc::new(Barrier::new(2));
            let resume = Arc::new(Barrier::new(2));
            let worker = {
                let state = state.clone();
                let barrier = barrier.clone();
                let resume = resume.clone();
                std::thread::spawn(move || {
                    // The document getter has completed; hold the gesture before the pipe mutex.
                    barrier.wait();
                    resume.wait();
                    commit_restore(
                        &state,
                        1,
                        captured.0,
                        |r| {
                            Some(RestoreContext {
                                count: 2,
                                visible: r.4.clone(),
                                generation: r.0,
                                suspended: r.2,
                                fenced: r.3,
                                document_current: captured.1 == r.1,
                            })
                        },
                        |r, packet| {
                            r.5.push(packet);
                            true
                        },
                    )
                })
            };
            barrier.wait();
            {
                let mut guard = state.lock().unwrap();
                match invalidation {
                    "generation" => guard.0 += 1,
                    "document" => guard.1 += 1,
                    "suspended" => guard.2 = true,
                    "fenced" => guard.3 = true,
                    "visible" => guard.4.push(1),
                    _ => {}
                }
            }
            resume.wait();
            assert_eq!(
                worker.join().unwrap(),
                invalidation == "none",
                "{invalidation}"
            );
            let guard = state.lock().unwrap();
            if invalidation == "none" {
                assert_eq!(
                    guard.5,
                    vec![json!({"kind":"layout-action","slot":1,"action":"reopen","generation":7})]
                );
            } else {
                assert!(
                    guard.5.is_empty(),
                    "No reopen reaches Node or persistence: {invalidation}"
                );
            }
        }
    }
}

// The UI getter runs before this critical section. Validation and write share one mutex.
fn commit_restore<T>(
    state: &Mutex<T>,
    slot: u64,
    generation: u64,
    current: impl FnOnce(&T) -> Option<RestoreContext>,
    write: impl FnOnce(&mut T, Value) -> bool,
) -> bool {
    let mut guard = state.lock().unwrap();
    let Some(context) = current(&guard) else {
        return false;
    };
    if context.suspended
        || context.fenced
        || !context.document_current
        || !restore_allowed(
            slot,
            context.count,
            &context.visible,
            generation,
            context.generation,
        )
    {
        return false;
    }
    write(
        &mut guard,
        json!({"kind":"layout-action","slot":slot,"action":"reopen","generation":generation}),
    )
}

#[tauri::command]
pub async fn terminal_restore(window: Webview, slot: u64, generation: u64) -> Value {
    let app = window.app_handle();
    // Capture the stable exact document before taking the pipe's mutex: url() can block.
    let Some((source, document)) = crate::features::chrome_identity(&window) else {
        return json!(false);
    };
    if presentation_blocked(app) {
        return json!(false);
    }
    let terminal = app.state::<Terminals>();
    json!(commit_restore(
        &terminal.0,
        slot,
        generation,
        |running| running.as_ref().map(|r| RestoreContext {
            count: r.documents.len(),
            visible: r.layout["visible"]
                .as_array()
                .map(|items| items.iter().filter_map(Value::as_u64).collect())
                .unwrap_or_default(),
            generation: r.layout_generation,
            suspended: r.presentation_suspended,
            fenced: r.confirming_quit
                || r.exit_authorized
                || crate::renderer::unavailable()
                || crate::agents::exit_pending(app)
                || phase_blocks_presentation(crate::host_phase::phase()),
            document_current: crate::features::document_version_current(app, &source, document),
        }),
        |running, value| crate::features::with_chrome_document(app, document, || {
            running
                .as_mut()
                .is_some_and(|r| r.child.write(format!("{value}\n").as_bytes()).is_ok())
        }),
    ))
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
        .is_some_and(|r| r.retiring || r.metadata_mutating.is_some() || r.enrollment_pending);
    let generation = metadata_generation(app);
    if retiring || presentation_blocked(app) || !focused(&window).await {
        return json!(false);
    }
    if action == "note-focus" {
        if generation.is_none()
            || metadata_generation(app) != generation
            || self::slot(&window) != Some(slot)
            || presentation_blocked(app)
        {
            return json!(false);
        }
        let visible = app
            .state::<Terminals>()
            .0
            .lock()
            .unwrap()
            .as_mut()
            .is_some_and(|r| {
                let now = Instant::now();
                if r.last_focus_notice.is_some_and(|last| {
                    now.saturating_duration_since(last) < Duration::from_millis(16)
                }) {
                    return false;
                }
                r.last_focus_notice = Some(now);
                !r.retiring
                    && r.metadata_mutating.is_none()
                    && !r.enrollment_pending
                    && Some(r.layout_generation) == generation
                    && r.layout["visible"].as_array().is_some_and(|slots| {
                        slots
                            .iter()
                            .any(|value| value.as_u64() == Some(slot as u64))
                    })
            });
        return json!(
            visible
                && send(
                    app,
                    json!({"kind":"layout-focus","slot":slot,"generation":generation})
                )
        );
    }
    // Revoke immediately, before the asynchronous Node layout update arrives.
    metadata_view_begin(app);
    if action == "dashboard" {
        metadata_invalidate(app);
        if let Some(main) = app.get_window("main") {
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
fn current_review(app: &tauri::AppHandle, focus: native_focus::Focus) -> bool {
    app.state::<Terminals>()
        .0
        .lock()
        .unwrap()
        .as_ref()
        .is_some_and(|r| {
            r.permission_review
                .as_ref()
                .is_some_and(|(_, sheet)| focus.owns_permission_sheet(*sheet))
                || r.native_dialog
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
    let state = app.state::<Terminals>();
    let mut guard = state.0.lock().unwrap();
    if let Some(r) = guard.as_mut().filter(|r| r.permission_review.is_some()) {
        invalidate_layout(r);
    }
    drop(guard);
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

/// Hide the owned terminal surface only. Processes, identities and scrollback stay.
pub fn suspend_surface(app: &tauri::AppHandle) {
    revoke_all(app);
    if let Some(chrome) = app.get_webview("feature-workspace") {
        let _ = chrome.hide();
    }
    let count = app
        .state::<Terminals>()
        .0
        .lock()
        .unwrap()
        .as_ref()
        .map_or(0, |r| r.documents.len());
    for slot in 0..count {
        if let Some(view) = app.get_webview(&format!("terminal-{slot}")) {
            let _ = view.hide();
        }
    }
    send(app, json!({"kind":"layout-suspend"}));
}

/// Register before writing so even an immediate private host reply has a waiter.
pub(crate) fn quit_send(
    app: &tauri::AppHandle,
    id: &str,
    kind: &str,
) -> Option<oneshot::Receiver<Value>> {
    let terminal = app.state::<Terminals>();
    let mut guard = terminal.0.lock().unwrap();
    let running = guard.as_mut()?;
    let receiver = running
        .quit_pending
        .register(id.to_owned(), kind, &running.epoch)?;
    let bytes = format!("{}\n", json!({"kind": kind, "id": id}));
    if running.child.write(bytes.as_bytes()).is_err() {
        running.quit_pending.cancel(id);
        return None;
    }
    Some(receiver)
}

pub(crate) fn quit_cancel(app: &tauri::AppHandle, id: &str) {
    if let Some(running) = app.state::<Terminals>().0.lock().unwrap().as_mut() {
        running.quit_pending.cancel(id);
    }
}

pub(crate) fn quit_event(app: &tauri::AppHandle, name: &str, detail: Value) {
    for label in ["main", "feature-workspace"] {
        if let Some(view) = app.get_webview(label) {
            let _ = view.eval(format!(
                "window.dispatchEvent(new CustomEvent('{name}',{{detail:{detail}}}));"
            ));
        }
    }
}

pub(crate) fn app_active(window: &tauri::Window) -> bool {
    native_focus::app_active(window)
}

pub(crate) fn sheet_owned(window: &tauri::Window) -> bool {
    native_focus::sheet_owned(window)
}

pub(crate) struct PermissionReviewContext {
    pub epoch: String,
    pub presentation: u64,
    pub document: u64,
    pub id: String,
    pub feature_id: String,
    pub generation: u64,
}

#[cfg(target_os = "macos")]
pub(crate) async fn confirm_permission_sheet(
    app: &tauri::AppHandle,
    view: Webview,
    labels: [String; 5],
    context: PermissionReviewContext,
) -> bool {
    let PermissionReviewContext {
        epoch,
        presentation: generation,
        document,
        id,
        feature_id,
        generation: logical_generation,
    } = context;
    let current_app = app.clone();
    let sheet_app = app.clone();
    let current_epoch = epoch.clone();
    let current_id = id.clone();
    native_consent::confirm_webview(
        view,
        labels,
        move || {
            native_focus::install(&current_app)
                && crate::features::document_version_current(
                    &current_app,
                    "orqst-features://local/index.html",
                    document,
                )
                && permission_review_current(&current_app, &current_epoch, generation, &current_id)
                && crate::features::permission_capture_current(
                    &current_app,
                    &feature_id,
                    &current_epoch,
                    generation,
                    logical_generation,
                )
                && !presentation_blocked(&current_app)
        },
        move |sheet| {
            let state = sheet_app.state::<Terminals>();
            let mut guard = state.0.lock().unwrap();
            let Some(r) = guard.as_mut() else {
                return false;
            };
            if r.epoch != epoch
                || r.layout_generation != generation
                || r.metadata_mutating.as_deref() != Some(&id)
            {
                return false;
            }
            let Some((owner, slot)) = r.permission_review.as_mut() else {
                return false;
            };
            if *owner != id || *slot != 0 {
                return false;
            }
            *slot = sheet;
            true
        },
    )
    .await
}
#[cfg(not(target_os = "macos"))]
pub(crate) async fn confirm_permission_sheet(
    _app: &tauri::AppHandle,
    _view: Webview,
    _labels: [String; 5],
    _context: PermissionReviewContext,
) -> bool {
    false
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

/// Minimal dock state only: hidden slot, label and provider. No ids, proofs or epochs.
pub(crate) fn publish_workspace_projection(app: &tauri::AppHandle) {
    let value = app
        .state::<Terminals>()
        .0
        .lock()
        .unwrap()
        .as_ref()
        .map(|r| (r.layout.clone(), r.layout_generation));
    if let Some((state, generation)) = value {
        emit_dock(app, &state, true, generation);
    }
}
fn emit_dock(app: &tauri::AppHandle, state: &Value, show: bool, generation: u64) {
    let (labels, providers) = {
        let terminal = app.state::<Terminals>();
        let guard = terminal.0.lock().unwrap();
        guard
            .as_ref()
            .map(|r| (r.labels.clone(), r.providers.clone()))
            .unwrap_or_default()
    };
    let detail = workspace_detail(state, show, &labels, &providers, generation);
    for label in ["main", "feature-workspace"] {
        if let Some(view) = app.get_webview(label) {
            let _ = view.eval(format!(
                "window.dispatchEvent(new CustomEvent('orqst-terminal-dock',{{detail:{detail}}}));"
            ));
        }
    }
}

/// Closed presentation projection of current Feature members only; no runtime authority.
fn workspace_detail(
    state: &Value,
    show: bool,
    labels: &[String],
    providers: &[String],
    generation: u64,
) -> Value {
    let members = if show {
        state["order"].as_array().cloned().unwrap_or_default()
    } else {
        Vec::new()
    };
    let shown = state["shown"].as_array().cloned().unwrap_or_default();
    let visible = state["visible"].as_array().cloned().unwrap_or_default();
    let panes: Vec<Value> = members.iter().filter_map(|entry| {
        let slot = entry.as_u64()? as usize;
        let fallback = labels.get(slot)?;
        let label = state["names"][slot].as_str().filter(|s| !s.is_empty()).unwrap_or(fallback);
        Some(json!({"slot":slot,"label":label,"provider":providers.get(slot).cloned().unwrap_or_default(),
            "minimized":!shown.contains(entry),"visible":visible.contains(entry),"active":state["active"] == *entry,
            "maximized":state["maximized"] == *entry}))
    }).collect();
    let hidden: Vec<Value> = panes
        .iter()
        .filter(|pane| pane["minimized"] == true)
        .map(|pane| json!({"slot":pane["slot"],"label":pane["label"],"provider":pane["provider"]}))
        .collect();
    json!({"panes":panes,"hidden":hidden,"count":members.len(),"generation":generation,"canvas":state["canvas"] == true})
}

fn apply_layout(app: &tauri::AppHandle, value: &Value) {
    let handle = app.clone();
    let value = value.clone();
    let _ = app.run_on_main_thread(move || {
        crate::renderer::present(|| apply_layout_current(&handle, &value));
    });
}

/// Compose only retained owned surfaces; ordering does not focus or grant input.
fn raise_surface(view: &Webview) {
    #[cfg(target_os = "macos")]
    let _ = view.with_webview(|native| unsafe {
        use objc2::msg_send;
        use objc2::runtime::AnyObject;
        // Tauri keeps this NSView alive for this AppKit-thread callback.
        let view = native.inner().cast::<AnyObject>();
        let parent: *mut AnyObject = msg_send![view, superview];
        if !parent.is_null() {
            let _: () = msg_send![parent, addSubview: view, positioned: 1_isize, relativeTo: std::ptr::null_mut::<AnyObject>()];
        }
    });
    #[cfg(not(target_os = "macos"))]
    let _ = view;
}
/// Called only after full native layout validation; back-to-front for AppKit.
fn ordered_bounds(value: &Value) -> Vec<&Value> {
    let mut bounds: Vec<&Value> = value["bounds"].as_array().unwrap().iter().collect();
    if value["kind"] == "layout-v2" {
        bounds.sort_by_key(|bound| bound["z"].as_u64().unwrap());
    }
    bounds
}
#[cfg(test)]
mod arrangement_order_tests {
    use super::*;
    #[test]
    fn v2_surfaces_are_raised_back_to_front_without_reordering_legacy_layout() {
        let mut value = json!({"kind":"layout-v2","bounds":[{"slot":0,"z":2},{"slot":1,"z":0},{"slot":2,"z":1}]});
        assert_eq!(
            ordered_bounds(&value)
                .iter()
                .map(|v| v["slot"].as_u64().unwrap())
                .collect::<Vec<_>>(),
            vec![1, 2, 0]
        );
        value["kind"] = json!("layout");
        assert_eq!(
            ordered_bounds(&value)
                .iter()
                .map(|v| v["slot"].as_u64().unwrap())
                .collect::<Vec<_>>(),
            vec![0, 1, 2]
        );
    }
}
fn apply_layout_current(app: &tauri::AppHandle, value: &Value) {
    if presentation_blocked(app) {
        return;
    }
    let Some(window) = app.get_window("main") else {
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
    } else {
        crate::agents::hide_surface(app);
    }
    emit_dock(app, state, show, value["generation"].as_u64().unwrap_or(0));
    if let Some(chrome) = app.get_webview("feature-workspace") {
        if show {
            let _ = chrome.set_bounds(tauri::Rect {
                position: tauri::LogicalPosition::new(0.0, 0.0).into(),
                size: tauri::LogicalSize::new(logical.width as f64, logical.height as f64).into(),
            });
            // Dashboard remains mounted. Chrome must be above its opaque Webview.
            // Visible terminals are raised afterwards, outside the summary canvas transform.
            raise_surface(&chrome);
            let _ = chrome.show();
        } else {
            let _ = chrome.hide();
        }
    }
    for bound in ordered_bounds(value) {
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
            raise_surface(&view);
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
        if r.native_dialog.is_some() || r.metadata_mutating.is_some() || r.enrollment_pending {
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
    let labels: [String; 5] = std::array::from_fn(|i| fields[i].to_owned());
    let app = app.clone();
    // Keep the host reader free to process revocation, EOF and concurrent refusal.
    tauri::async_runtime::spawn(async move {
        #[cfg(target_os = "macos")]
        let approved = {
            let native = app.clone();
            let view = window.clone();
            let dialog_id = id.clone();
            let request = request.clone();
            native_consent::confirm(&app, window.window(), labels, move || {
                // Main-thread native getters precede and remain outside the application mutex.
                let document = self::slot(&view);
                let focus = native_focus::sample(&view.window());
                let state = native.state::<Terminals>();
                let guard = state.0.lock().unwrap();
                document == Some(slot)
                    && focus.is_some_and(|focus| focus.owns_key(false))
                    && guard.as_ref().is_some_and(|r| {
                        r.native_dialog
                            .as_ref()
                            .is_some_and(|(id, owner, version)| {
                                id == &dialog_id && *owner == slot && Some(*version) == generation
                            })
                            && r.generations.get(slot).copied() == generation
                            && r.revoked.get(slot) == Some(&false)
                            && r.loaded.get(slot) == Some(&true)
                            && request.as_ref().is_none_or(|id| {
                                r.mcp_request.as_ref() == Some(&(id.clone(), slot))
                            })
                    })
            })
            .await
        };
        #[cfg(not(target_os = "macos"))]
        let approved = {
            let [title, message, detail, cancel, approve] = labels;
            let expected = approve.clone();
            let (sender, receiver) = oneshot::channel();
            app.dialog().message(format!("{message}\n\n{detail}"))
                .title(title).parent(&window.window())
                .buttons(MessageDialogButtons::YesNoCancelCustom(cancel.clone(), approve, cancel))
                .show_with_result(move |result| {
                    let _ = sender.send(matches!(result, MessageDialogResult::Custom(ref text) if text == &expected));
                });
            receiver.await.unwrap_or(false)
        };
        let focused = focused(&window).await;
        let current = app
            .state::<Terminals>()
            .0
            .lock()
            .unwrap()
            .as_mut()
            .and_then(|r| {
                if r.native_dialog
                    .as_ref()
                    .is_some_and(|(dialog_id, _, _)| dialog_id == &id)
                {
                    r.native_dialog = None;
                }
                if r.revoked.get(slot).copied().unwrap_or(true)
                    || request
                        .as_ref()
                        .is_some_and(|id| r.mcp_request.as_ref() != Some(&(id.clone(), slot)))
                {
                    None
                } else {
                    r.generations.get(slot).copied()
                }
            });
        if focus_diagnostics() {
            eprintln!(
                "ORQST_TERMINAL_CONSENT {}",
                json!({"approved": approved, "focused": focused, "generation": generation, "current": current})
            );
            #[cfg(target_os = "macos")]
            tauri::async_runtime::spawn(trace_dialog_focus(window.clone()));
        }
        let accepted = approved
            && generation.is_some()
            && generation == current
            && self::slot(&window) == Some(slot)
            && focused
            && !presentation_blocked(&app);
        send(
            &app,
            json!({"kind": "confirm", "id": id, "accepted": accepted}),
        );
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
            r.metadata_mutating.is_some() || r.enrollment_pending,
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
            r.metadata_mutating.is_some() || r.enrollment_pending,
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
        if let Some(chrome) = app.get_webview("feature-workspace") {
            let _ = chrome.hide();
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

/// Native evidence for passive preparation only, never launch or admission authority.
#[derive(Clone, PartialEq)]
pub(crate) struct PreparationAdmission {
    owner: String,
    epoch: String,
    initial_files: Vec<String>,
    presentation: u64,
    revision: u64,
    count: usize,
}
impl PreparationAdmission {
    pub(crate) fn context(&self) -> Value {
        json!({"owner":self.owner, "epoch":self.epoch, "initialFiles":self.initial_files})
    }
    fn snapshot(&self) -> PreparationSnapshot<'_> {
        PreparationSnapshot {
            identity: AdmissionIdentity {
                owner: &self.owner,
                epoch: &self.epoch,
                initial_files: &self.initial_files,
            },
            presentation: self.presentation,
            revision: self.revision,
            count: self.count,
        }
    }
}
fn preparation_available(r: &Running) -> bool {
    !r.enrollment_fenced
        && !r.enrollment_pending
        && r.documents.len() < r.capacity
        && !r.retiring
        && r.metadata_mutating.is_none()
        && r.native_dialog.is_none()
        && r.mcp_request.is_none()
        && !r.reviewing.iter().any(|busy| *busy)
        && !r.confirming_quit
        && !r.exit_authorized
}
fn admission_snapshot(r: &Running) -> PreparationAdmission {
    PreparationAdmission {
        owner: r.admission_owner.clone(),
        epoch: r.epoch.clone(),
        initial_files: r.initial_files.clone(),
        presentation: r.layout_generation,
        revision: r.layout_revision,
        count: r.documents.len(),
    }
}
pub(crate) fn preparation_admission(
    app: &tauri::AppHandle,
) -> Result<Option<PreparationAdmission>, Box<dyn std::error::Error>> {
    if presentation_blocked(app) {
        return Err("Native preparation unavailable".into());
    }
    let state = app.state::<Terminals>();
    let guard = state.0.lock().unwrap();
    match guard.as_ref() {
        Some(r) if preparation_available(r) => Ok(Some(admission_snapshot(r))),
        Some(_) => Err("Native enrollment unavailable".into()),
        None => Ok(None),
    }
}
pub(crate) fn preparation_admission_current(
    app: &tauri::AppHandle,
    expected: &Option<PreparationAdmission>,
) -> bool {
    preparation_admission(app).is_ok_and(|current| current == *expected)
}
/// Capacity is fixed by the original native host ready; renderer cannot increase it.
pub fn enrollment_available(app: &tauri::AppHandle) -> bool {
    !presentation_blocked(app)
        && app
            .state::<Terminals>()
            .0
            .lock()
            .unwrap()
            .as_ref()
            .is_some_and(preparation_available)
}

fn create_terminal_view(
    app: &tauri::AppHandle,
    slot: usize,
) -> Result<(), Box<dyn std::error::Error>> {
    let workspace = app.get_window("main").ok_or("Missing main window")?;
    let label = format!("terminal-{slot}");
    let handle = app.clone();
    let expected = url(slot);
    let builder = WebviewBuilder::new(&label, WebviewUrl::External(expected.parse()?))
        .incognito(true)
        .focused(false)
        .disable_drag_drop_handler()
        .on_navigation(move |url| url.as_str() == expected)
        .on_new_window(|_, _| NewWindowResponse::Deny)
        .on_download(|_, _| false)
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
    Ok(())
}

fn valid_pane_metadata(pane: &Value) -> bool {
    [("title", 48), ("provider", 32)]
        .iter()
        .all(|(key, limit)| {
            pane[*key].as_str().is_some_and(|text| {
                !text.is_empty() && text.len() <= *limit && !text.chars().any(char::is_control)
            })
        })
}

fn append_pane(
    documents: &mut Vec<String>,
    labels: &mut Vec<String>,
    providers: &mut Vec<String>,
    pane: &Value,
) -> Result<(), &'static str> {
    if documents.len() != labels.len()
        || documents.len() != providers.len()
        || !valid_pane_metadata(pane)
    {
        return Err("Native pane metadata unavailable");
    }
    let html = pane["html"]
        .as_str()
        .ok_or("Native pane document unavailable")?;
    documents.push(html.into());
    labels.push(pane["title"].as_str().unwrap().into());
    providers.push(pane["provider"].as_str().unwrap().into());
    Ok(())
}

fn valid_enrollment(value: &Value, id: &str, epoch: &str, slot: usize, capacity: usize) -> bool {
    let receipt = &value["receipt"];
    let member = &receipt["member"];
    value["status"] == "ready"
        && valid_pane_metadata(&value["pane"])
        && receipt["version"] == 1
        && receipt["status"] == "ready"
        && receipt["reason"] == "admitted"
        && receipt["epoch"] == epoch
        && receipt["opId"] == id
        && slot < capacity
        && member["slot"].as_u64() == Some(slot as u64)
        && member["status"] == "ready"
        && crate::features::uuid(&member["terminalId"])
        && member["admissionRevision"]
            .as_u64()
            .is_some_and(|n| n > 0 && receipt["revision"].as_u64() == Some(n))
        && matches!(
            value["pane"]["profileId"].as_str(),
            Some("codex-terminal-v1" | "claude-terminal-v1" | "opencode-terminal-v1")
        )
        && value["pane"]["html"]
            .as_str()
            .is_some_and(|html| !html.is_empty() && html.len() <= 256 * 1024)
}

fn enrollment_creation_allowed(
    cancelled: bool,
    receiver_closed: bool,
    now: Instant,
    deadline: Instant,
    context_current: bool,
    blocked: bool,
) -> bool {
    !cancelled && !receiver_closed && now < deadline && context_current && !blocked
}

fn running_identity(r: &Running) -> AdmissionIdentity<'_> {
    AdmissionIdentity {
        owner: &r.admission_owner,
        epoch: &r.epoch,
        initial_files: &r.initial_files,
    }
}
fn enrollment_owner(r: &Running, expected: &PreparationAdmission, id: &str) -> bool {
    owns_enrollment(
        running_identity(r),
        expected.snapshot().identity,
        r.enrollment_request.as_deref(),
        id,
    )
}

/// Consume only this attempt; a newer Core/view must not be suspended by an old failure.
fn fence_enrollment_presentation(
    app: &tauri::AppHandle,
    expected: &PreparationAdmission,
    generation: u64,
    id: &str,
    slot: usize,
) {
    let state = app.state::<Terminals>();
    let mut guard = state.0.lock().unwrap();
    let Some(r) = guard.as_mut().filter(|r| enrollment_owner(r, expected, id)) else {
        return;
    };
    r.pending.remove(id);
    if let Some(intent) = r.pending_open.get_mut(slot) {
        *intent = None;
    }
    r.enrollment_fenced = true;
    if r.layout_generation == generation {
        invalidate_layout(r);
    }
}

/// Private native provisioning result only. No renderer command accepts a manifest path.
pub(crate) async fn enroll_selected(
    app: &tauri::AppHandle,
    manifest: &str,
    previous_layout: Value,
    expected: &PreparationAdmission,
    diagnostic: &Attempt,
) -> Result<(), Box<dyn std::error::Error>> {
    diagnostic.record(Stage::Enrollment, Outcome::Requested, Effects::Unconfirmed);
    let result = enroll_selected_inner(app, manifest, previous_layout, expected, diagnostic).await;
    diagnostic.record(
        Stage::Enrollment,
        if result.is_ok() {
            Outcome::Succeeded
        } else {
            Outcome::Uncertain
        },
        Effects::Possible,
    );
    result
}

async fn enroll_selected_inner(
    app: &tauri::AppHandle,
    manifest: &str,
    previous_layout: Value,
    expected: &PreparationAdmission,
    diagnostic: &Attempt,
) -> Result<(), Box<dyn std::error::Error>> {
    if !enrollment_available(app) {
        return Err("Native enrollment unavailable".into());
    }
    let (id, epoch, generation, slot, receiver) = {
        let state = app.state::<Terminals>();
        let mut guard = state.0.lock().unwrap();
        let r = guard.as_mut().ok_or("Original Core unavailable")?;
        if !preparation_matches(
            admission_snapshot(r).snapshot(),
            expected.snapshot(),
            preparation_available(r),
        ) {
            return Err("Native enrollment busy".into());
        }
        r.sequence += 1;
        let id = format!("00000000-0000-4000-8000-{:012x}", r.sequence);
        let (sender, receiver) = oneshot::channel();
        r.pending.insert(id.clone(), sender);
        r.enrollment_pending = true;
        r.enrollment_request = Some(id.clone());
        // Once a mutation may have reached Core, uncertainty never unlocks enrollment.
        r.enrollment_fenced = true;
        let message = json!({"kind":"enroll", "id":id, "epoch":r.epoch,
            "generation":r.layout_generation, "manifestFile":manifest, "previousLayout":previous_layout});
        if r.child.write(format!("{message}\n").as_bytes()).is_err() {
            r.pending.remove(&id);
            r.enrollment_pending = false;
            return Err("Enrollment transport uncertain".into());
        }
        (
            id,
            r.epoch.clone(),
            r.layout_generation,
            r.documents.len(),
            receiver,
        )
    };
    // The Core's isolated deadline is 12s. This transport never closes old terminals on timeout.
    let result = tokio::time::timeout(Duration::from_secs(14), receiver).await;
    let value = {
        let state = app.state::<Terminals>();
        let mut guard = state.0.lock().unwrap();
        let r = guard.as_mut().ok_or("Original Core unavailable")?;
        if !enrollment_owner(r, expected, &id) {
            return Err("Enrollment owner changed".into());
        }
        r.pending.remove(&id); // Late ACK has no consumer and cannot materialize a document.
        r.enrollment_pending = false;
        let value = result
            .ok()
            .and_then(Result::ok)
            .ok_or("Enrollment result uncertain")?;
        if value["kind"] == "enrollment-reply"
            && value["id"] == id
            && value["status"] == "rejected"
            && r.layout_generation == generation
            && r.documents.len() == slot
            && !r.confirming_quit
            && !r.exit_authorized
        {
            r.enrollment_fenced = false;
            r.enrollment_request = None;
            return Err("Enrollment rejected; prepared metadata preserved".into());
        }
        if !enrollment_owner(r, expected, &id)
            || r.epoch != epoch
            || r.layout_generation != generation
            || r.confirming_quit
            || r.exit_authorized
            || !valid_enrollment(&value, &id, &epoch, slot, r.capacity)
            || r.documents.len() != slot
        {
            return Err("Enrollment result incomplete or uncertain".into());
        }
        // Append only. Existing documents, generations, busy state and opening intents are retained.
        append_pane(
            &mut r.documents,
            &mut r.labels,
            &mut r.providers,
            &value["pane"],
        )?;
        r.generations.push(0);
        r.loaded.push(false);
        r.revoked.push(false);
        r.pending_open.push(None);
        r.opening_diagnostics.push(Some(diagnostic.clone()));
        r.busy.push(false);
        r.reviewing.push(false);
        value
    };
    let (sender, receiver) = oneshot::channel();
    let handle = app.clone();
    let creation_owner = expected.clone();
    let creation_id = id.clone();
    let creation_cancelled = Arc::new(AtomicBool::new(false));
    let callback_cancelled = creation_cancelled.clone();
    diagnostic.record(Stage::Presentation, Outcome::Requested, Effects::Possible);
    let creation_deadline = Instant::now() + Duration::from_secs(5);
    let scheduled = app.run_on_main_thread(move || {
        let context_current = handle
            .state::<Terminals>()
            .0
            .lock()
            .unwrap()
            .as_ref()
            .is_some_and(|r| {
                enrollment_owner(r, &creation_owner, &creation_id)
                    && r.layout_generation == generation
            });
        let current = enrollment_creation_allowed(
            callback_cancelled.load(Ordering::Acquire),
            sender.is_closed(),
            Instant::now(),
            creation_deadline,
            context_current,
            presentation_blocked(&handle),
        );
        // Atomically claim before the effect: a timeout/cancellation winning this token is final.
        let claimed = current
            && callback_cancelled
                .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
                .is_ok();
        let created = claimed
            && Instant::now() < creation_deadline
            && !sender.is_closed()
            && create_terminal_view(&handle, slot).is_ok();
        let _ = sender.send(created);
    });
    if scheduled.is_err() {
        creation_cancelled.store(true, Ordering::Release);
        fence_enrollment_presentation(app, expected, generation, &id, slot);
        return Err("Native document creation unavailable".into());
    }
    let created =
        tokio::time::timeout_at(tokio::time::Instant::from_std(creation_deadline), receiver).await;
    // A queued UI callback observes cancellation/closed receiver even after this wait ends.
    creation_cancelled.store(true, Ordering::Release);
    if !created.is_ok_and(|r| matches!(r, Ok(true))) {
        fence_enrollment_presentation(app, expected, generation, &id, slot);
        return Err("Native document creation incomplete".into());
    }
    {
        let state = app.state::<Terminals>();
        let mut guard = state.0.lock().unwrap();
        let r = guard.as_mut().ok_or("Original Core unavailable")?;
        if !enrollment_owner(r, expected, &id)
            || r.epoch != epoch
            || r.layout_generation != generation
            || r.confirming_quit
            || r.exit_authorized
        {
            drop(guard);
            fence_enrollment_presentation(app, expected, generation, &id, slot);
            return Err("Enrollment presentation expired".into());
        }
        r.pending_open[slot] = Some(OpeningIntent {
            profile: value["pane"]["profileId"].as_str().unwrap().into(),
            document: r.generations[slot],
            presentation: generation,
            expires: Instant::now() + Duration::from_secs(60),
        });
        r.presentation_suspended = false;
    }
    let receiver = {
        let state = app.state::<Terminals>();
        let mut guard = state.0.lock().unwrap();
        let r = guard.as_mut().ok_or("Original Core unavailable")?;
        if !enrollment_owner(r, expected, &id) || r.layout_generation != generation {
            return Err("Enrollment owner changed".into());
        }
        let (sender, receiver) = oneshot::channel();
        r.pending.insert(id.clone(), sender);
        let message = json!({"kind":"enrollment-present", "id":id, "generation":generation});
        if r.child.write(format!("{message}\n").as_bytes()).is_err() {
            r.pending.remove(&id);
            return Err("Enrollment presentation uncertain".into());
        }
        receiver
    };
    let presented = tokio::time::timeout(Duration::from_secs(10), receiver).await;
    let state = app.state::<Terminals>();
    let mut guard = state.0.lock().unwrap();
    let r = guard.as_mut().ok_or("Original Core unavailable")?;
    if !enrollment_owner(r, expected, &id) {
        return Err("Enrollment owner changed".into());
    }
    r.pending.remove(&id);
    if !matches!(presented, Ok(Ok(ref value)) if value["kind"] == "enrollment-presented" && value["ready"] == true)
        || r.epoch != epoch
        || r.layout_generation != generation
        || r.confirming_quit
        || r.exit_authorized
    {
        drop(guard);
        fence_enrollment_presentation(app, expected, generation, &id, slot);
        return Err("Enrollment presentation incomplete".into());
    }
    r.enrollment_fenced = false;
    r.enrollment_request = None;
    diagnostic.record(Stage::Presentation, Outcome::Ready, Effects::Possible);
    Ok(())
}

pub fn is_running(app: &tauri::AppHandle) -> bool {
    app.state::<Terminals>().0.lock().unwrap().is_some()
}

/// Paths originate only from startup configuration or the native provisioning review.
pub async fn start_selected(
    app: &tauri::AppHandle,
    paths: Vec<String>,
) -> Result<(), Box<dyn std::error::Error>> {
    start_selected_with_open(app, paths, false, &Attempt::begin()).await
}

pub async fn start_selected_with_open(
    app: &tauri::AppHandle,
    paths: Vec<String>,
    operational_open: bool,
    diagnostic: &Attempt,
) -> Result<(), Box<dyn std::error::Error>> {
    diagnostic.record(Stage::HostSpawn, Outcome::Requested, Effects::Unconfirmed);
    let result = start_selected_inner(app, paths, operational_open, diagnostic).await;
    if let Err(error) = &result {
        crate::terminal_creation::record_failure(diagnostic, error.as_ref(), Stage::CoreStartup);
    } else {
        diagnostic.record(Stage::Opening, Outcome::Ready, Effects::Possible);
    }
    result
}

async fn start_selected_inner(
    app: &tauri::AppHandle,
    paths: Vec<String>,
    operational_open: bool,
    diagnostic: &Attempt,
) -> Result<(), Box<dyn std::error::Error>> {
    if is_running(app) {
        return Err("Existing Core requires explicit native enrollment".into());
    }
    if paths.is_empty() || paths.len() > 8 || paths.iter().any(|p| p.len() > 2048) {
        return Err("Invalid explicit managed terminal selection".into());
    }
    // Includes startup-environment selections: uncertain Core setup must never unlock
    // native preparation or reuse a terminal window in this application lifetime.
    crate::terminal_creation::fence_selection(app);
    static STARTUP_SEQUENCE: AtomicU64 = AtomicU64::new(1);
    let startup_id = format!(
        "startup-{}",
        STARTUP_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    );
    // Every fallible preflight operation is inside the same reversible reservation.
    let prepared = crate::host_start::prepare::<_, _, _, _, Box<dyn std::error::Error>>(
        &crate::quit_orchestration::QUIT.host,
        || Ok(serde_json::to_string(&paths)?),
        || Ok(app.path().resource_dir()?),
        || Ok(app.path().app_data_dir()?.join("managed-agents")),
        |files, resources, admission| {
            let script = resources.join("core/tauri-terminal-host.cjs");
            Ok(app
                .shell()
                .sidecar("orqst-node")?
                .args([
                    script.as_os_str(),
                    std::ffi::OsStr::new(&files),
                    admission.as_os_str(),
                    std::ffi::OsStr::new(if operational_open { "true" } else { "false" }),
                    std::ffi::OsStr::new(&startup_id),
                ])
                .env_clear()
                .envs(std::env::vars_os().filter(|(key, _)| {
                    matches!(
                        key.to_str(),
                        Some("HOME" | "USERPROFILE" | "PATH" | "TMPDIR" | "LANG")
                    )
                })))
        },
    )?;
    let (mut rx, child) = prepared.spawn(|command| command.spawn())?;
    diagnostic.record(Stage::HostSpawn, Outcome::Started, Effects::Possible);
    let ready = tokio::time::timeout(Duration::from_secs(15), async {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) if bytes.len() <= 512 * 1024 => {
                    return serde_json::from_slice::<Value>(&bytes).map_err(|_| "startup_protocol")
                }
                CommandEvent::Stderr(_) => {}
                CommandEvent::Terminated(_) => return Err("startup_eof"),
                _ => return Err("startup_protocol"),
            }
        }
        Err("startup_eof")
    })
    .await;
    let ready = match ready {
        Ok(Ok(v))
            if v["kind"] == "ready"
                && v["id"] == startup_id
                && crate::features::uuid(&v["admissionOwner"])
                && crate::features::uuid(&v["epoch"])
                && v["initialFiles"] == json!(paths)
                && v["panes"]
                    .as_array()
                    .is_some_and(|p| p.len() == paths.len()) =>
        {
            v
        }
        outcome => {
            let error = match outcome {
                Err(_) => crate::terminal_creation::startup_error("startup_timeout"),
                Ok(Err(code)) => crate::terminal_creation::startup_error(code),
                Ok(Ok(value)) => crate::terminal_creation::startup_failure(&value, &startup_id)
                    .unwrap_or_else(|| crate::terminal_creation::startup_error("startup_protocol")),
            };
            let _ = child.kill();
            crate::host_phase::lost();
            return Err(error);
        }
    };
    diagnostic.record(Stage::CoreStartup, Outcome::Ready, Effects::Possible);
    let panes = ready["panes"]
        .as_array()
        .ok_or("Missing terminal documents")?;
    let documents: Vec<String> = panes
        .iter()
        .map(|p| p["html"].as_str().unwrap_or("").to_owned())
        .collect();
    let count = documents.len();
    let selected_profiles: Vec<Option<String>> = panes
        .iter()
        .map(|pane| {
            operational_open
                .then_some(&pane["profileId"])
                .and_then(|profile| {
                    profile
                        .as_str()
                        .filter(|id| {
                            matches!(
                                *id,
                                "codex-terminal-v1" | "claude-terminal-v1" | "opencode-terminal-v1"
                            )
                        })
                        .map(str::to_owned)
                })
        })
        .collect();
    let exited = Arc::new(Notify::new());
    *app.state::<Terminals>().0.lock().unwrap() = Some(Running {
        child,
        admission_owner: ready["admissionOwner"].as_str().unwrap().into(),
        initial_files: paths.clone(),
        epoch: ready["epoch"]
            .as_str()
            .filter(|_| crate::features::uuid(&ready["epoch"]))
            .ok_or("Missing Core epoch")?
            .into(),
        capacity: ready["capacity"]
            .as_u64()
            .filter(|n| *n >= count as u64 && *n <= 8)
            .ok_or("Missing native Core capacity")? as usize,
        enrollment_pending: false,
        enrollment_request: None,
        enrollment_fenced: false,
        documents,
        labels: panes
            .iter()
            .map(|pane| pane["title"].as_str().unwrap_or("").to_owned())
            .collect(),
        providers: panes
            .iter()
            .map(|pane| pane["provider"].as_str().unwrap_or("").to_owned())
            .collect(),
        layout: ready["layout"].clone(),
        generations: vec![0; count],
        loaded: vec![false; count],
        revoked: vec![false; count],
        pending_open: (0..count).map(|_| None).collect(),
        opening_diagnostics: (0..count).map(|_| Some(diagnostic.clone())).collect(),
        pending: HashMap::new(),
        quit_pending: crate::quit_orchestration::PendingReplies::default(),
        metadata_pending: HashMap::new(),
        metadata_mutating: None,
        permission_review: None,
        layout_generation: 0,
        layout_revision: 0,
        last_focus_notice: None,
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
    // Single-window product: terminals are child webviews of the existing main window.
    let workspace = app.get_window("main").ok_or("Missing main window")?;
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
    crate::host_phase::started();
    for (slot, pane) in panes.iter().enumerate() {
        let label = format!("terminal-{slot}");
        submenu.append(&MenuItem::with_id(
            app,
            &label,
            pane["title"].as_str().unwrap_or("ORQST"),
            true,
            None::<&str>,
        )?)?;
        create_terminal_view(app, slot)?;
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
                        && native.is_some_and(|n| n.owns_sheet(current_review(&handle, n)))
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
        WindowEvent::CloseRequested { .. } => {
            metadata_invalidate(&handle);
            revoke_all(&handle);
            send(&handle, json!({"kind":"layout-suspend"}));
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
                .is_some_and(|r| {
                    r.retiring || r.metadata_mutating.is_some() || r.enrollment_pending
                })
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
    let opening_app = app.clone();
    let reply_epoch = ready["epoch"].as_str().map(str::to_owned);
    let host_epoch = ready["epoch"].as_str().unwrap().to_owned();
    let host_owner = ready["admissionOwner"].as_str().unwrap().to_owned();
    let host_initial_files = paths.clone();
    let app = app.clone();
    let diagnostic = diagnostic.clone();
    tauri::async_runtime::spawn(async move {
        let mut stream_outcome = Outcome::Eof;
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) if bytes.len() <= 512 * 1024 => {
                    let Ok(value) = serde_json::from_slice::<Value>(&bytes) else {
                        stream_outcome = Outcome::ProtocolRejected;
                        break;
                    };
                    if value["kind"] == "feature-reply" {
                        if presentation_blocked(&app) {
                            continue;
                        }
                        let Some(id) = value["id"].as_str() else {
                            continue;
                        };
                        let Some(reply_epoch) = reply_epoch.as_deref() else {
                            continue;
                        };
                        let state = app.state::<Terminals>();
                        if let Some(pending) = take_metadata_reply(
                            &state.0,
                            reply_epoch,
                            id,
                            |pending, generation| {
                                metadata_reply_matches(&value, id, pending, generation)
                            },
                            |source, document| {
                                crate::features::document_current(&app, source, document)
                            },
                            |source, document| {
                                crate::features::document_version_current(&app, source, document)
                            },
                        ) {
                            let _ = pending.sender.send(value["value"].clone());
                        }
                    } else if crate::quit_orchestration::PendingReplies::is_reply(&value) {
                        if let Some(running) = app.state::<Terminals>().0.lock().unwrap().as_mut() {
                            running.quit_pending.deliver(value);
                        }
                    } else if value["kind"] == "enrollment-reply"
                        || value["kind"] == "enrollment-presented"
                    {
                        if let Some(id) = value["id"].as_str() {
                            if let Some(r) = app
                                .state::<Terminals>()
                                .0
                                .lock()
                                .unwrap()
                                .as_mut()
                                .filter(|r| {
                                    owns_enrollment(
                                        running_identity(r),
                                        AdmissionIdentity {
                                            owner: &host_owner,
                                            epoch: &host_epoch,
                                            initial_files: &host_initial_files,
                                        },
                                        r.enrollment_request.as_deref(),
                                        id,
                                    )
                                })
                            {
                                if let Some(sender) = r.pending.remove(id) {
                                    let _ = sender.send(value.clone());
                                }
                            }
                        }
                    } else if value["kind"] == "reply" {
                        let Some(id) = value["id"].as_str() else {
                            stream_outcome = Outcome::ProtocolRejected;
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
                            stream_outcome = Outcome::ProtocolRejected;
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
                    } else if value["kind"] == "layout" || value["kind"] == "layout-v2" {
                        apply_layout(&app, &value);
                    } else {
                        stream_outcome = Outcome::ProtocolRejected;
                        break;
                    }
                }
                CommandEvent::Stderr(_) => {}
                CommandEvent::Terminated(_) => {
                    exited.notify_one();
                    break;
                }
                CommandEvent::Error(_) => {
                    stream_outcome = Outcome::TransportFailed;
                    break;
                }
                _ => {
                    stream_outcome = Outcome::ProtocolRejected;
                    break;
                }
            }
        }
        diagnostic.record(Stage::HostStream, stream_outcome, Effects::Possible);
        let running = {
            let state = app.state::<Terminals>();
            let mut guard = state.0.lock().unwrap();
            take_host(
                &mut *guard,
                AdmissionIdentity {
                    owner: &host_owner,
                    epoch: &host_epoch,
                    initial_files: &host_initial_files,
                },
                running_identity,
            )
        };
        stop_running(running);
        // Losing the handle after a start is unknown, never proof of a clean exit.
        crate::host_phase::lost();
    });
    if operational_open {
        metadata_view_begin(&opening_app);
        if let Some(r) = opening_app.state::<Terminals>().0.lock().unwrap().as_mut() {
            r.presentation_suspended = false;
            let expires = Instant::now() + Duration::from_secs(60);
            for (slot, profile) in selected_profiles.into_iter().enumerate() {
                r.pending_open[slot] = profile.map(|profile| OpeningIntent {
                    profile,
                    document: r.generations[slot],
                    presentation: r.layout_generation,
                    expires,
                });
            }
        }
        send(&opening_app, json!({"kind":"layout-open", "slot":0}));
    }
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
    stop_running(running);
}

fn stop_running(running: Option<Running>) {
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

/// Shared presentation fence for renderer loss and metadata-only replies during either Quit gate.
pub(crate) fn presentation_blocked(app: &tauri::AppHandle) -> bool {
    if crate::renderer::unavailable() {
        return true;
    }
    let terminal = app
        .state::<Terminals>()
        .0
        .lock()
        .unwrap()
        .as_ref()
        .is_some_and(|r| r.confirming_quit || r.exit_authorized);
    terminal
        || crate::agents::exit_pending(app)
        || phase_blocks_presentation(crate::host_phase::phase())
}

/// A shutdown fence or a lost host blocks presentation; only revocation and reads remain.
pub(crate) fn phase_blocks_presentation(phase: crate::host_phase::Phase) -> bool {
    matches!(
        phase,
        crate::host_phase::Phase::ShutdownInFlight | crate::host_phase::Phase::LostUnknown
    )
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
        if r.metadata_mutating.is_some() || r.enrollment_pending {
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
                crate::desktop::request_quit(&app);
            } else {
                reset_exit(&app);
                crate::agents::reset_exit(&app);
            }
        });
    true
}

#[cfg(test)]
mod opening_tests {
    use super::{incomplete_open, invalidate_opening, take_opening, OpeningIntent};
    use serde_json::json;
    use std::time::{Duration, Instant};
    fn intent(now: Instant) -> Option<OpeningIntent> {
        Some(OpeningIntent {
            profile: "codex-terminal-v1".into(),
            document: 3,
            presentation: 9,
            expires: now + Duration::from_secs(60),
        })
    }
    #[test]
    fn deliberate_transition_opens_the_bound_document_once_without_reminting() {
        let now = Instant::now();
        let mut pending = intent(now);
        let epoch = (3, 9, now + Duration::from_secs(60));
        assert_eq!(
            take_opening(&mut pending, epoch, (3, 9), now),
            Some("codex-terminal-v1".into())
        );
        assert!(take_opening(&mut pending, epoch, (3, 9), now).is_none());
    }
    #[test]
    fn blur_deactivation_dashboard_quit_and_reload_consume_pending_intent_before_first_focus() {
        let now = Instant::now();
        for _event in ["blur", "deactivation", "dashboard", "quit", "reload"] {
            let mut pending = intent(now);
            let mut document = 3;
            invalidate_opening(&mut document, &mut pending);
            assert!(take_opening(
                &mut pending,
                (3, 9, now + Duration::from_secs(60)),
                (document, 9),
                now
            )
            .is_none());
            assert!(pending.is_none());
        }
    }
    #[test]
    fn async_focus_cannot_rebind_document_presentation_or_extend_expiry() {
        let now = Instant::now();
        let expires = now + Duration::from_secs(60);
        for (document, presentation, at) in [(4, 9, now), (3, 10, now), (3, 9, expires)] {
            let mut pending = intent(now);
            assert!(
                take_opening(&mut pending, (3, 9, expires), (document, presentation), at).is_none()
            );
            assert!(pending.is_none());
        }
    }
    #[test]
    fn late_open_reply_only_retains_public_attempt_identity() {
        let id = "00000000-0000-4000-8000-000000000001";
        assert_eq!(
            incomplete_open(
                &json!({"status":"ok","instanceId":id,"opening":"ready","lease":"forbidden"})
            ),
            json!({"status":"ok","instanceId":id,"opening":"incomplete"})
        );
        assert_eq!(
            incomplete_open(&json!({"status":"ok","instanceId":"forged"})),
            json!({"status":"denied"})
        );
    }
}

#[cfg(test)]
mod enrollment_tests {
    use super::{
        append_pane, enrollment_creation_allowed, invalidate_presentation_state, valid_enrollment,
        workspace_detail, OpeningIntent,
    };
    use serde_json::json;
    use std::time::{Duration, Instant};
    #[test]
    fn only_exact_ready_receipts_can_append_native_documents() {
        let id = "00000000-0000-4000-8000-000000000010";
        let epoch = "00000000-0000-4000-8000-000000000011";
        let ready = json!({"status":"ready","receipt":{"version":1,"status":"ready",
            "reason":"admitted","epoch":epoch,"opId":id,"revision":1,"member":{
            "slot":2,"status":"ready","terminalId":"00000000-0000-4000-8000-000000000012",
            "admissionRevision":1}},"pane":{"profileId":"claude-terminal-v1","html":"SYNTHETIC",
            "title":"3 · SYNTHETIC Claude", "provider":"SYNTHETIC Claude"}});
        assert!(valid_enrollment(&ready, id, epoch, 2, 8));
        for status in ["rejected", "uncertain"] {
            let mut value = ready.clone();
            value["status"] = json!(status);
            assert!(!valid_enrollment(&value, id, epoch, 2, 8));
            value["status"] = json!("ready");
            value["receipt"]["status"] = json!(status);
            assert!(!valid_enrollment(&value, id, epoch, 2, 8));
        }
        assert!(!valid_enrollment(&ready, epoch, epoch, 2, 8));
        assert!(!valid_enrollment(&ready, id, id, 2, 8));
        assert!(!valid_enrollment(&ready, id, epoch, 3, 8));
        assert!(!valid_enrollment(&ready, id, epoch, 2, 2));
        let mut value = ready;
        value["receipt"]["member"]["admissionRevision"] = json!(2);
        assert!(!valid_enrollment(&value, id, epoch, 2, 8));
    }

    #[test]
    fn appended_panes_remain_addressable_in_the_hidden_pane_dock() {
        let mut documents = Vec::new();
        let mut labels = Vec::new();
        let mut providers = Vec::new();
        for (slot, provider) in ["Codex", "Claude", "OpenCode"].iter().enumerate() {
            append_pane(
                &mut documents,
                &mut labels,
                &mut providers,
                &json!({"html":"SYNTHETIC", "title":format!("{} · {provider}", slot + 1),
                    "provider":provider}),
            )
            .unwrap();
            assert_eq!(documents.len(), labels.len());
            assert_eq!(documents.len(), providers.len());
        }
        assert_eq!(
            workspace_detail(
                &json!({"order":[0,1,2],"shown":[0,1],"visible":[0,1],"names":["","","Backend"],"active":0,"maximized":null}),
                true,
                &labels,
                &providers,
                7
            )["hidden"],
            json!([{"slot":2,"label":"Backend","provider":"OpenCode"}])
        );
        assert_eq!(
            workspace_detail(
                &json!({"order":[0,1,2],"shown":[0,1,2],"visible":[0],"names":["","",""],"active":0,"maximized":0}),
                true,
                &labels,
                &providers,
                8
            )["hidden"],
            json!([])
        );
        let scoped = workspace_detail(
            &json!({"order":[2,0],"shown":[0],"visible":[0],"names":["","","Backend"],"active":0,"maximized":null}),
            true,
            &labels,
            &providers,
            9,
        );
        assert_eq!(scoped["panes"].as_array().unwrap().len(), 2);
        assert_eq!(scoped["panes"][0]["slot"], 2);
        assert_eq!(scoped["panes"][0]["label"], "Backend");
        assert_eq!(scoped["panes"][0]["minimized"], true);
        assert_eq!(scoped["panes"][1]["slot"], 0);
        assert!(scoped["panes"]
            .as_array()
            .unwrap()
            .iter()
            .all(|pane| pane.get("terminalId").is_none()));
        assert_eq!(
            workspace_detail(&json!({"order":[0,1,2]}), false, &labels, &providers, 10)["panes"],
            json!([])
        );
    }

    #[test]
    fn invalid_pane_metadata_cannot_partially_append_a_document() {
        for pane in [
            json!({"html":"SYNTHETIC","title":"3 · SYNTHETIC"}),
            json!({"html":"SYNTHETIC","title":"","provider":"SYNTHETIC"}),
            json!({"html":"SYNTHETIC","title":"SYNTHETIC\n","provider":"SYNTHETIC"}),
            json!({"html":"SYNTHETIC","title":"SYNTHETIC","provider":"x".repeat(33)}),
            json!({"title":"SYNTHETIC","provider":"SYNTHETIC"}),
        ] {
            let mut documents = vec!["original".into()];
            let mut labels = vec!["original".into()];
            let mut providers = vec!["original".into()];
            assert!(append_pane(&mut documents, &mut labels, &mut providers, &pane).is_err());
            assert_eq!(documents, vec!["original"]);
            assert_eq!(labels, vec!["original"]);
            assert_eq!(providers, vec!["original"]);
        }
    }
    #[test]
    fn expired_or_cancelled_ui_creation_cannot_materialize_a_webview_after_its_wait() {
        let now = Instant::now();
        let deadline = now + Duration::from_secs(5);
        assert!(enrollment_creation_allowed(
            false, false, now, deadline, true, false
        ));
        for at in [deadline, deadline + Duration::from_millis(1)] {
            assert!(!enrollment_creation_allowed(
                false, false, at, deadline, true, false
            ));
        }
        assert!(!enrollment_creation_allowed(
            true, false, now, deadline, true, false
        ));
        assert!(!enrollment_creation_allowed(
            false, true, now, deadline, true, false
        ));
        assert!(!enrollment_creation_allowed(
            false, false, now, deadline, false, false
        ));
        assert!(!enrollment_creation_allowed(
            false, false, now, deadline, true, true
        ));
    }

    #[test]
    fn timed_out_presentation_rejects_late_layout_and_consumed_opening_epoch() {
        let now = Instant::now();
        let intent = OpeningIntent {
            profile: "SYNTHETIC".into(),
            document: 0,
            presentation: 2,
            expires: now + Duration::from_secs(60),
        };
        let late = json!({
            "kind":"layout","generation":2,"revision":3,
            "viewport":{"width":1440,"height":900},"insets":{"left":155,"top":81,"bottom":34},
            "state":{"axis":"columns","percent":50,"columns":2,"order":[0,1],"shown":[0,1],"active":0,"maximized":null,"names":["", ""],"visible":[0,1],"count":2,"persisted":true,"suspended":false,"workspaceChrome":true,"canvas":false},
            "focus":1,"bounds":[{"slot":0,"rect":{"x":155,"y":81,"width":642,"height":785}},{"slot":1,"rect":{"x":797,"y":81,"width":643,"height":785}}]
        });
        let mut generation = 2;
        let mut suspended = false;
        assert!(crate::features::valid_layout(
            &late, 2, 1440, 900, 2, generation
        ));
        assert!(intent.current(0, generation, now));
        invalidate_presentation_state(&mut generation, &mut suspended);
        assert!(suspended);
        assert_eq!(generation, 3);
        assert!(!crate::features::valid_layout(
            &late, 2, 1440, 900, 2, generation
        ));
        assert!(!intent.current(0, generation, now));
    }
}
