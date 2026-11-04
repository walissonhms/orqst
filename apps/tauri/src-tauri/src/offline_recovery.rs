//! Dedicated native administrative entry. No preparation admission or renderer capability.
#[cfg(target_os = "macos")]
#[path = "offline_recovery_details.rs"]
mod details;
#[path = "offline_recovery_guard.rs"]
mod guard;
use crate::local_diagnostics::{Attempt, Effects, Outcome, Stage};
use guard::{clock, ClockSample, Consent, Presentation};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::menu::{Menu, MenuItem, Submenu};
use tauri::{Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

pub const URL: &str = "orqst-recovery://local/index.html";
const ACTIONS: [&str; 7] = [
    "install",
    "capture",
    "continueCapture",
    "release",
    "continueRelease",
    "finalize",
    "abort",
];
const FRAME: usize = 128 * 1024;
const TOTAL: usize = 512 * 1024;

#[derive(Default)]
pub struct Recovery(Mutex<State>);
#[derive(Default)]
struct State {
    presentation: Presentation,
    session: Option<String>,
    sequence: u64,
    pending: Option<(u64, String, u64)>,
    child: Option<CommandChild>,
}

pub fn requested() -> bool {
    std::env::args_os()
        .skip(1)
        .any(|arg| arg == "--offline-recovery")
}
fn text(key: &str) -> String {
    let source = if std::env::var("LANG")
        .unwrap_or_default()
        .to_lowercase()
        .starts_with("pt")
    {
        include_str!("../../../dashboard/src/locales/pt-BR.json")
    } else {
        include_str!("../../../dashboard/src/locales/en-US.json")
    };
    let dictionary: Value = serde_json::from_str(source).expect("validated locale");
    dictionary["offlineRecovery"][key]
        .as_str()
        .unwrap_or(key)
        .to_owned()
}
fn escaped(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}
pub fn response(request: &tauri::http::Request<Vec<u8>>) -> tauri::http::Response<Vec<u8>> {
    let uri = request.uri();
    let valid = request.method() == tauri::http::Method::GET
        && uri.scheme_str() == Some("orqst-recovery")
        && uri.authority().map(|value| value.as_str()) == Some("local")
        && uri.path_and_query().map(|value| value.as_str()) == Some("/index.html");
    let body = if valid {
        format!("<!doctype html><html><meta charset=utf-8><title>ORQST</title><main><h1>{}</h1><p>{}</p><p>{}</p></main></html>", escaped(&text("title")), escaped(&text("intro")), escaped(&text("instructions"))).into_bytes()
    } else {
        Vec::new()
    };
    tauri::http::Response::builder().status(if valid { 200 } else { 404 })
        .header("Content-Type", "text/html; charset=utf-8").header("Cache-Control", "no-store")
        .header("X-Content-Type-Options", "nosniff")
        .header("Content-Security-Policy", "default-src 'none'; script-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
        .body(body).expect("static recovery document")
}
fn document(window: &WebviewWindow) -> bool {
    window.label() == "offline-recovery"
        && window.is_visible().unwrap_or(false)
        && window.url().is_ok_and(|url| url.as_str() == URL)
}
pub fn invalidate(app: &tauri::AppHandle) {
    let state = app.state::<Recovery>();
    let mut state = state.0.lock().unwrap();
    state.presentation.invalidate();
}
#[cfg(target_os = "macos")]
fn uncertain(app: &tauri::AppHandle) {
    let state = app.state::<Recovery>();
    let mut state = state.0.lock().unwrap();
    state.presentation.latch_uncertain();
}
pub fn on_window_event(window: &tauri::Window, event: &WindowEvent) {
    if matches!(event, WindowEvent::Focused(true)) && window.label() != "offline-recovery"
        || matches!(
            event,
            WindowEvent::CloseRequested { .. } | WindowEvent::Destroyed
        ) && window.label() == "offline-recovery"
    {
        invalidate(window.app_handle());
    }
}
#[cfg(target_os = "macos")]
pub(crate) fn native_key_changed(app: &tauri::AppHandle) {
    let (review, generation) = {
        let state = app.state::<Recovery>();
        let state = state.0.lock().unwrap();
        (
            state.presentation.reviewing || state.pending.is_some(),
            state.presentation.generation,
        )
    };
    if !review {
        return;
    }
    // AppKit getters happen on its thread, outside application locks.
    let focus = app
        .get_window("offline-recovery")
        .and_then(|window| crate::terminal::quit_window_focus(&window));
    let state = app.state::<Recovery>();
    let mut state = state.0.lock().unwrap();
    if state.presentation.reviewing {
        state.presentation.observe(
            generation,
            focus.is_some_and(|focus| focus.0),
            focus.is_some_and(|focus| focus.1),
        );
    } else if state.presentation.generation == generation && !focus.is_some_and(|focus| focus.0) {
        state.presentation.invalidate();
    }
}
fn current(
    app: &tauri::AppHandle,
    window: &WebviewWindow,
    generation: u64,
    deadline: Instant,
) -> bool {
    // Never call window/document getters while holding State.
    let source = document(window);
    let context =
        source && Instant::now() < deadline && !crate::terminal::presentation_blocked(app);
    let state = app.state::<Recovery>();
    let state = state.0.lock().unwrap();
    context && !state.presentation.uncertain && state.presentation.generation == generation
}
fn review(
    app: &tauri::AppHandle,
    window: &WebviewWindow,
    action: &str,
    detail: &str,
    generation: u64,
    deadline: Instant,
) -> Option<ClockSample> {
    let mut detailed = false;
    while current(app, window, generation, deadline) {
        {
            let state = app.state::<Recovery>();
            let mut state = state.0.lock().unwrap();
            state.presentation.begin_sheet();
        }
        let approve = text("approve");
        let details = text("details");
        let cancel = text("cancel");
        let back = text("back");
        #[cfg(target_os = "macos")]
        let reply = details::summary(
            app,
            window,
            [
                text("title"),
                text(action),
                cancel.clone(),
                if detailed { approve } else { details.clone() },
                if detailed { details } else { cancel.clone() },
            ],
            generation,
            deadline,
        );
        #[cfg(not(target_os = "macos"))]
        let reply: Option<(isize, ClockSample)> = None;
        #[cfg(target_os = "macos")]
        let reply = reply.map(|reply| (reply.response, reply.clicked));
        let Some((result, clicked)) = reply else {
            break;
        };
        let shown = app.state::<Recovery>().0.lock().unwrap().presentation.shown;
        if !shown || !current(app, window, generation, deadline) {
            break;
        }
        match result {
            1001 if detailed => {
                let source_current = current(app, window, generation, deadline);
                let state = app.state::<Recovery>();
                let mut state = state.0.lock().unwrap();
                let accepted = state
                    .presentation
                    .accepted(generation, source_current, detailed);
                state.presentation.reviewing = false;
                return accepted.then_some(clicked);
            }
            1001 | 1002 if detailed || result == 1001 => {
                app.state::<Recovery>()
                    .0
                    .lock()
                    .unwrap()
                    .presentation
                    .begin_sheet();
                #[cfg(target_os = "macos")]
                let available = details::details(
                    app,
                    window,
                    detail,
                    [text("title"), cancel, back],
                    generation,
                    deadline,
                );
                #[cfg(not(target_os = "macos"))]
                let available = false;
                if !available
                    || !app.state::<Recovery>().0.lock().unwrap().presentation.shown
                    || !current(app, window, generation, deadline)
                {
                    break;
                }
                // Availability is not evidence that a human read or accepted the details.
                detailed = true;
            }
            _ => break,
        }
    }
    app.state::<Recovery>()
        .0
        .lock()
        .unwrap()
        .presentation
        .reviewing = false;
    None
}
fn exact(value: &Value, keys: &[&str]) -> bool {
    value.as_object().is_some_and(|object| {
        object.len() == keys.len() && keys.iter().all(|key| object.contains_key(*key))
    })
}
fn digest(value: &Value) -> bool {
    value.as_str().is_some_and(|value| {
        value.len() == 64
            && value
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    })
}
fn review_frame(value: &Value, session: &str, action: &str) -> bool {
    exact(
        value,
        &[
            "kind", "session", "id", "nonce", "digest", "action", "binding", "detail",
        ],
    ) && value["kind"] == "review"
        && value["session"] == session
        && value["action"] == action
        && crate::features::uuid(&value["id"])
        && crate::features::uuid(&value["nonce"])
        && digest(&value["digest"])
        && value["binding"].as_str().is_some_and(|s| s.len() <= 16384)
        && value["detail"]
            .as_str()
            .is_some_and(|s| !s.is_empty() && s.len() <= 64 * 1024)
}
fn challenge_frame(frame: &Value, action: &str) -> bool {
    if frame["check"].as_bool().is_none() {
        return false;
    }
    let Some(binding) = frame["binding"]
        .as_str()
        .and_then(|s| serde_json::from_str::<Value>(s).ok())
    else {
        return false;
    };
    let Some(challenge) = frame["challenge"]
        .as_str()
        .filter(|s| s.len() <= 16384)
        .and_then(|s| serde_json::from_str::<Value>(s).ok())
    else {
        return false;
    };
    if !exact(&binding, &["intent", "fingerprint"])
        || !digest(&binding["fingerprint"])
        || (if action == "install" {
            challenge["version"] != 1
        } else {
            challenge["intentDigest"] != binding["fingerprint"] || challenge["version"] != 2
        })
        || !crate::features::uuid(&challenge["nonce"])
        || !challenge["expiresAt"]
            .as_f64()
            .is_some_and(|n| n.is_finite() && n > 0.0)
    {
        return false;
    }
    let semantic: &[&str] = if action == "install" {
        &["domain", "version", "id", "directory", "fingerprint"]
    } else {
        &[
            "domain",
            "version",
            "operationId",
            "phase",
            "owner",
            "epoch",
            "beforeBoot",
            "currentBoot",
            "snapshotDigest",
            "currentDigest",
            "directory",
            "bundle",
        ]
    };
    let intent = &binding["intent"];
    let path = |value: &Value| {
        value
            .as_str()
            .is_some_and(|s| s.starts_with('/') && s.len() <= 2048)
    };
    if !path(&intent["directory"]) {
        return false;
    }
    if action == "install" {
        if intent["domain"] != "orqst.administrative-anchor-installation"
            || !crate::features::uuid(&intent["id"])
            || !digest(&intent["fingerprint"])
        {
            return false;
        }
    } else {
        let phase = match action {
            "continueCapture" => "capture",
            "continueRelease" => "release",
            other => other,
        };
        if intent["domain"] != "orqst.administrative-recovery"
            || intent["phase"] != phase
            || !path(&intent["bundle"])
            || !digest(&intent["snapshotDigest"])
            || !digest(&intent["currentDigest"])
            || ["operationId", "owner", "epoch", "beforeBoot", "currentBoot"]
                .iter()
                .any(|key| !crate::features::uuid(&intent[*key]))
        {
            return false;
        }
    }
    let mut keys = semantic.to_vec();
    keys.extend(["nonce", "expiresAt"]);
    if action != "install" {
        keys.push("intentDigest");
    }
    exact(&challenge, &keys)
        && exact(&binding["intent"], semantic)
        && semantic
            .iter()
            .all(|key| challenge[*key] == binding["intent"][*key])
}
fn completion_outcome(value: &Value, action: &str) -> bool {
    let fields = ["kind", "session", "id", "status", "outcome"];
    let mut diagnosed = fields.to_vec();
    diagnosed.push("failure");
    if !exact(value, &fields) && !exact(value, &diagnosed) {
        return false;
    }
    if value["status"] == "blocked" {
        return value["outcome"] == "unconfirmed"
            && (exact(value, &fields)
                || (exact(&value["failure"], &["stage", "code"])
                    && value["failure"]["stage"] == "inspection"
                    && value["failure"]["code"] == "enrollment_binding_changed"));
    }
    if !exact(value, &fields) {
        return false;
    }
    value["status"] == "done"
        && match action {
            "install" => value["outcome"] == "installed",
            "capture" => value["outcome"] == "captured",
            "continueCapture" => value["outcome"] == "capture_continued",
            "release" | "continueRelease" => value["outcome"] == "release_prepared",
            "finalize" => matches!(
                value["outcome"].as_str(),
                Some("finalized" | "finalized_controls_preserved")
            ),
            "abort" => value["outcome"] == "aborted",
            _ => false,
        }
}

pub fn install(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    if std::env::args_os().skip(1).count() != 1 {
        return Err("Invalid native recovery entry".into());
    }
    #[cfg(target_os = "macos")]
    if !crate::terminal::install_quit_observer(app) {
        return Err("Native focus observer unavailable".into());
    }
    let window =
        WebviewWindowBuilder::new(app, "offline-recovery", WebviewUrl::External(URL.parse()?))
            .title(text("title"))
            .on_navigation(|url| url.as_str() == URL)
            .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
            .on_download(|_, _| false)
            .on_page_load(|window, payload| {
                if payload.event() == tauri::webview::PageLoadEvent::Started {
                    invalidate(window.app_handle());
                }
            })
            .build()?;
    let menu = Menu::default(app)?;
    let submenu = Submenu::new(app, text("title"), true)?;
    for action in ACTIONS {
        submenu.append(&MenuItem::with_id(
            app,
            format!("offline-{action}"),
            text(action),
            true,
            None::<&str>,
        )?)?;
    }
    menu.append(&submenu)?;
    app.set_menu(menu)?;
    app.on_menu_event(|app, event| {
        let Some(action) = event.id().as_ref().strip_prefix("offline-").filter(|action| ACTIONS.contains(action)) else { return };
        let Some(window) = app.get_webview_window("offline-recovery") else { return };
        if !document(&window) || !window.is_focused().unwrap_or(false) || crate::terminal::presentation_blocked(app) { return; }
        let (session, sequence, generation) = {
            let state = app.state::<Recovery>(); let mut state = state.0.lock().unwrap();
            let Some(session) = state.session.clone() else { return };
            if !state.presentation.can_request(state.pending.is_some()) { return; }
            state.sequence += 1;
            let sequence = state.sequence; let generation = state.presentation.generation;
            state.pending = Some((sequence, action.into(), generation));
            (session, sequence, generation)
        };
        let native = app.clone(); let action = action.to_owned();
        tauri::async_runtime::spawn_blocking(move || {
            let bundle = if matches!(action.as_str(), "install" | "capture") { Value::Null } else {
                let Ok(parent) = native.path().app_data_dir() else { native.state::<Recovery>().0.lock().unwrap().pending = None; return; };
                native.dialog().file().set_parent(&window).set_title(text("selectBundle")).set_directory(parent.join("administrative-recovery/bundles")).blocking_pick_folder()
                    .and_then(|path| path.into_path().ok()).and_then(|path| path.into_os_string().into_string().ok()).map(Value::String).unwrap_or(Value::Null)
            };
            let available = document(&window) && window.is_focused().unwrap_or(false);
            let request = json!({"kind":"action", "session":session,"id":sequence,"action":action,"bundle":bundle});
            let state = native.state::<Recovery>(); let mut state = state.0.lock().unwrap();
            if !available || state.presentation.generation != generation || (bundle.is_null() && !matches!(action.as_str(), "install" | "capture")) { state.pending = None; return; }
            if let Some(child) = state.child.as_mut() { let _ = child.write(format!("{request}\n").as_bytes()); }
        });
    });
    let native = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _ = run(&native, &window);
        // Drop closes only the owned writer. It is neither exit proof nor permission to clear a lease.
        let state = native.state::<Recovery>();
        let mut state = state.0.lock().unwrap();
        state.session = None;
        state.child = None;
        state.pending = None;
        state.presentation.reviewing = false;
        let uncertain = state.presentation.uncertain;
        drop(state);
        if !uncertain && document(&window) && window.is_focused().unwrap_or(false) {
            native
                .dialog()
                .message(text("sessionEnded"))
                .title(text("title"))
                .parent(&window)
                .blocking_show();
        }
    });
    Ok(())
}
fn run(app: &tauri::AppHandle, window: &WebviewWindow) -> Result<(), Box<dyn std::error::Error>> {
    let diagnostic = Attempt::begin();
    let script = app
        .path()
        .resource_dir()?
        .join("core/tauri-offline-recovery-host.cjs");
    let parent = app.path().app_data_dir()?;
    let (mut rx, child) = app
        .shell()
        .sidecar("orqst-node")?
        .args([script.as_os_str(), parent.as_os_str()])
        .env_clear()
        .envs(std::env::vars_os().filter(|(key, _)| key == "LANG"))
        .spawn()?;
    app.state::<Recovery>().0.lock().unwrap().child = Some(child);
    let deadline = Instant::now() + Duration::from_secs(300);
    let mut bytes = 0usize;
    let mut reviews = HashSet::new();
    let mut consent: Option<(Value, Consent)> = None;
    while Instant::now() < deadline {
        let event = tauri::async_runtime::block_on(async {
            tokio::time::timeout(
                deadline.saturating_duration_since(Instant::now()),
                rx.recv(),
            )
            .await
        })?;
        match event {
            Some(CommandEvent::Stdout(line)) if line.len() <= FRAME => {
                bytes = bytes.saturating_add(line.len());
                if bytes > TOTAL {
                    break;
                }
                let value: Value = serde_json::from_slice(&line)?;
                if value["kind"] == "ready" {
                    let state = app.state::<Recovery>();
                    let mut state = state.0.lock().unwrap();
                    if state.session.is_some()
                        || !exact(&value, &["kind", "version", "session"])
                        || value["version"] != 2
                        || !crate::features::uuid(&value["session"])
                    {
                        break;
                    }
                    state.session = value["session"].as_str().map(str::to_owned);
                    continue;
                }
                let (session, pending) = {
                    let state = app.state::<Recovery>();
                    let state = state.0.lock().unwrap();
                    (state.session.clone(), state.pending.clone())
                };
                let Some(session) = session else { break };
                let Some((id, action, generation)) = pending else {
                    break;
                };
                if review_frame(&value, &session, &action) {
                    if reviews.len() >= 256
                        || !reviews.insert(value["id"].as_str().unwrap().to_owned())
                        || !reviews.insert(value["nonce"].as_str().unwrap().to_owned())
                    {
                        break;
                    }
                    consent = None;
                    let clicked = review(
                        app,
                        window,
                        &action,
                        value["detail"].as_str().unwrap(),
                        generation,
                        deadline,
                    );
                    if let Some(clicked) = clicked {
                        consent = Some((
                            value.clone(),
                            Consent::new(value["binding"].as_str().unwrap().to_owned(), clicked),
                        ));
                    }
                    let approved = clicked.is_some();
                    let answer = json!({"kind":"answer", "session":session, "id":value["id"],"nonce":value["nonce"],"digest":value["digest"],"approved":approved});
                    if let Some(child) = app.state::<Recovery>().0.lock().unwrap().child.as_mut() {
                        child.write(format!("{answer}\n").as_bytes())?;
                    }
                } else if exact(
                    &value,
                    &[
                        "kind",
                        "session",
                        "id",
                        "nonce",
                        "digest",
                        "binding",
                        "challenge",
                        "proofDigest",
                        "check",
                        "requestNonce",
                    ],
                ) && value["kind"] == "authorize"
                {
                    let Some((reviewed, lease)) = consent.as_mut() else {
                        break;
                    };
                    if reviews.len() >= 256
                        || value["session"] != session
                        || value["id"] != reviewed["id"]
                        || value["nonce"] != reviewed["nonce"]
                        || value["digest"] != reviewed["digest"]
                        || value["binding"] != reviewed["binding"]
                        || !digest(&value["proofDigest"])
                        || !crate::features::uuid(&value["requestNonce"])
                        || !reviews.insert(value["requestNonce"].as_str().unwrap().to_owned())
                        || !challenge_frame(&value, &action)
                    {
                        break;
                    }
                    let binding = value["binding"].as_str().unwrap();
                    let challenge = value["challenge"].as_str().unwrap();
                    let check = value["check"].as_bool().unwrap();
                    // Validate source/generation/focus before sampling the original click's remainder.
                    let source = current(app, window, generation, deadline)
                        && window.is_focused().unwrap_or(false);
                    let remaining = if source && lease.allows(binding, challenge, check) {
                        clock().and_then(|now| lease.authorize(binding, challenge, check, now))
                    } else {
                        None
                    };
                    let state = app.state::<Recovery>();
                    let mut state = state.0.lock().unwrap();
                    if state.presentation.uncertain
                        || state.presentation.generation != generation
                        || state.session.as_deref() != Some(session.as_str())
                        || state.pending.as_ref() != Some(&(id, action.clone(), generation))
                    {
                        break;
                    }
                    let answer = json!({"kind":"authorized", "session":session, "id":value["id"], "nonce":value["nonce"], "digest":value["digest"], "requestNonce":value["requestNonce"], "proofDigest":value["proofDigest"], "remainingMs":remaining.unwrap_or(0)});
                    if let Some(child) = state.child.as_mut() {
                        child.write(format!("{answer}\n").as_bytes())?;
                    }
                } else if value["kind"] == "complete"
                    && value["session"] == session
                    && value["id"] == id
                    && completion_outcome(&value, &action)
                {
                    consent = None;
                    app.state::<Recovery>().0.lock().unwrap().pending = None;
                    diagnostic.record(
                        Stage::HelperComplete,
                        if value["status"] == "done" {
                            Outcome::Succeeded
                        } else {
                            Outcome::Refused
                        },
                        Effects::Possible,
                    );
                    let message = if value["failure"]["code"] == "enrollment_binding_changed" {
                        diagnostic.record(
                            Stage::Inspection,
                            Outcome::EnrollmentBindingChanged,
                            Effects::Possible,
                        );
                        text("enrollment_binding_changed")
                    } else {
                        text(value["outcome"].as_str().unwrap())
                    };
                    if current(app, window, generation, deadline) {
                        app.dialog()
                            .message(message)
                            .title(text("title"))
                            .parent(window)
                            .blocking_show();
                    }
                } else {
                    break;
                }
            }
            Some(CommandEvent::Stderr(line)) if line.len() <= FRAME => {
                bytes = bytes.saturating_add(line.len());
                if bytes > TOTAL {
                    break;
                }
            }
            Some(CommandEvent::Terminated(_)) => {
                // An owned child-exit event is observed, but never makes an uncertain phase complete.
                diagnostic.record(Stage::HostStream, Outcome::Eof, Effects::Unconfirmed);
                break;
            }
            _ => break,
        }
    }
    // No respawn, retry, signal, lease cleanup or guessed outcome. EOF is not completion.
    let state = app.state::<Recovery>();
    let mut state = state.0.lock().unwrap();
    state.session = None;
    state.child = None;
    state.pending = None;
    diagnostic.record(Stage::HelperStream, Outcome::Eof, Effects::Unconfirmed);
    Ok(())
}

#[cfg(test)]
mod tests {
    #[test]
    fn static_recovery_document_requires_exact_components_and_get() {
        let request = |method: &str, url: &str| {
            tauri::http::Request::builder()
                .method(method)
                .uri(url)
                .body(Vec::new())
                .unwrap()
        };
        assert_eq!(super::response(&request("GET", super::URL)).status(), 200);
        for url in [
            "orqst-recovery://LOCAL/index.html",
            "ORQST-RECOVERY://local/index.html",
            "orqst-recovery://local/INDEX.html",
            "orqst-recovery://local/./index.html",
            "orqst-recovery://local/%69ndex.html",
            "orqst-recovery://local/index.html?",
            "orqst-recovery://local/index.html?extra=1",
            "orqst-recovery://other/index.html",
        ] {
            let response = super::response(&request("GET", url));
            assert_eq!(response.status(), 404, "{url}");
            assert!(response.body().is_empty());
        }
        for method in ["HEAD", "OPTIONS", "get", "POST"] {
            assert_eq!(super::response(&request(method, super::URL)).status(), 404);
        }
    }
}

#[cfg(test)]
mod approval_wire_tests {
    use super::{challenge_frame, completion_outcome, review_frame};
    use serde_json::{json, Value};
    #[test]
    fn completion_diagnostics_are_exact_allowlisted_and_never_success() {
        let base = json!({"kind":"complete","session":"SYNTHETIC","id":1,
            "status":"blocked","outcome":"unconfirmed"});
        assert!(completion_outcome(&base, "capture"));
        let mut diagnosed = base.clone();
        diagnosed["failure"] = json!({"stage":"inspection","code":"enrollment_binding_changed"});
        assert!(completion_outcome(&diagnosed, "capture"));
        for key in ["stage", "code", "extra"] {
            let mut changed = diagnosed.clone();
            changed["failure"][key] = json!("/SYNTHETIC/private-error");
            assert!(!completion_outcome(&changed, "capture"));
        }
        for failure in [Value::Null, json!({}), json!("SYNTHETIC")] {
            let mut changed = diagnosed.clone();
            changed["failure"] = failure;
            assert!(!completion_outcome(&changed, "capture"));
        }
        diagnosed["status"] = json!("done");
        diagnosed["outcome"] = json!("captured");
        assert!(!completion_outcome(&diagnosed, "capture"));
        diagnosed.as_object_mut().unwrap().remove("failure");
        assert!(completion_outcome(&diagnosed, "capture"));
        diagnosed["extra"] = json!("SYNTHETIC");
        assert!(!completion_outcome(&diagnosed, "capture"));
    }
    fn frame() -> Value {
        let id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
        let intent = json!({"domain":"orqst.administrative-recovery","version":2,
            "operationId":id,"phase":"capture","owner":id,"epoch":id,
            "beforeBoot":id,"currentBoot":id,"snapshotDigest":"a".repeat(64),
            "currentDigest":"b".repeat(64),"directory":"/SYNTHETIC","bundle":"/SYNTHETIC/bundle"});
        let fingerprint = "c".repeat(64);
        let mut challenge = intent.clone();
        challenge["intentDigest"] = json!(fingerprint);
        challenge["nonce"] = json!("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
        challenge["expiresAt"] = json!(30_001);
        json!({"binding": json!({"intent":intent,"fingerprint":fingerprint}).to_string(),
            "challenge":challenge.to_string(),"check":false})
    }
    #[test]
    fn review_envelope_is_exact_session_action_and_bounded_detail() {
        let id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
        let mut request = json!({"kind":"review","session":id,"id":id,"nonce":id,
            "digest":"a".repeat(64),"action":"capture","binding":"SYNTHETIC","detail":"SYNTHETIC"});
        assert!(review_frame(&request, id, "capture"));
        assert!(!review_frame(&request, id, "release"));
        assert!(!review_frame(
            &request,
            "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            "capture"
        ));
        request["detail"] = json!("x".repeat(64 * 1024 + 1));
        assert!(!review_frame(&request, id, "capture"));
    }
    #[test]
    fn every_semantic_field_must_equal_the_reviewed_intent() {
        let original = frame();
        assert!(challenge_frame(&original, "capture"));
        let challenge: Value =
            serde_json::from_str(original["challenge"].as_str().unwrap()).unwrap();
        for key in [
            "domain",
            "version",
            "operationId",
            "phase",
            "owner",
            "epoch",
            "beforeBoot",
            "currentBoot",
            "snapshotDigest",
            "currentDigest",
            "directory",
            "bundle",
            "intentDigest",
        ] {
            let mut changed = challenge.clone();
            changed[key] = json!("SYNTHETIC-drift");
            let mut request = original.clone();
            request["challenge"] = json!(changed.to_string());
            assert!(!challenge_frame(&request, "capture"), "{key}");
        }
        assert!(!challenge_frame(&original, "release"));
    }
    #[test]
    fn strict_shape_and_version_one_are_not_new_recovery_authority() {
        let original = frame();
        for key in ["extra", "nonce", "expiresAt", "intentDigest", "version"] {
            let mut challenge: Value =
                serde_json::from_str(original["challenge"].as_str().unwrap()).unwrap();
            match key {
                "extra" => challenge[key] = json!(true),
                "version" => challenge[key] = json!(1),
                _ => {
                    challenge.as_object_mut().unwrap().remove(key);
                }
            }
            let mut request = original.clone();
            request["challenge"] = json!(challenge.to_string());
            assert!(!challenge_frame(&request, "capture"), "{key}");
        }
    }
    #[test]
    fn native_value_comparison_does_not_depend_on_json_map_order() {
        let original = frame();
        let challenge: Value =
            serde_json::from_str(original["challenge"].as_str().unwrap()).unwrap();
        let mut pairs: Vec<_> = challenge.as_object().unwrap().iter().collect();
        pairs.reverse();
        let reversed = format!(
            "{{{}}}",
            pairs
                .into_iter()
                .map(|(key, value)| format!("{key:?}:{value}"))
                .collect::<Vec<_>>()
                .join(",")
        );
        let mut request = original;
        request["challenge"] = json!(reversed);
        assert!(challenge_frame(&request, "capture"));
    }
    #[test]
    fn installation_keeps_exact_format_one_semantics_without_legacy_deadline_review() {
        let intent = json!({"domain":"orqst.administrative-anchor-installation","version":1,
            "id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","directory":"/SYNTHETIC","fingerprint":"a".repeat(64)});
        let mut challenge = intent.clone();
        challenge["nonce"] = json!("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
        challenge["expiresAt"] = json!(60_000);
        let frame = json!({"binding":json!({"intent":intent,"fingerprint":"b".repeat(64)}).to_string(),"challenge":challenge.to_string(),"check":false});
        assert!(challenge_frame(&frame, "install"));
        assert!(!challenge_frame(&frame, "capture"));
    }
}
