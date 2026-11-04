//! Dedicated native administrative entry. No preparation admission or renderer capability.
#[cfg(target_os = "macos")]
#[path = "offline_recovery_details.rs"]
mod details;
#[path = "offline_recovery_guard.rs"]
mod guard;
use crate::local_diagnostics::{Attempt, Effects, Outcome, Stage};
use guard::Presentation;
use serde_json::{json, Value};
use std::collections::HashSet;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::menu::{Menu, MenuItem, Submenu};
use tauri::{Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogResult};
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
    let valid = request.method() == tauri::http::Method::GET && request.uri().to_string() == URL;
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
    source
        && Instant::now() < deadline
        && !crate::terminal::presentation_blocked(app)
        && app
            .state::<Recovery>()
            .0
            .lock()
            .unwrap()
            .presentation
            .generation
            == generation
}
fn review(
    app: &tauri::AppHandle,
    window: &WebviewWindow,
    action: &str,
    detail: &str,
    generation: u64,
) -> bool {
    let deadline = Instant::now() + Duration::from_secs(30);
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
        let result = app
            .dialog()
            .message(text(action))
            .title(text("title"))
            .parent(window)
            .buttons(MessageDialogButtons::YesNoCancelCustom(
                cancel.clone(),
                if detailed {
                    approve.clone()
                } else {
                    details.clone()
                },
                if detailed {
                    details.clone()
                } else {
                    cancel.clone()
                },
            ))
            .blocking_show_with_result();
        let shown = app.state::<Recovery>().0.lock().unwrap().presentation.shown;
        if !shown || !current(app, window, generation, deadline) {
            break;
        }
        match result {
            MessageDialogResult::Custom(choice) if detailed && choice == approve => {
                let source_current = current(app, window, generation, deadline);
                let state = app.state::<Recovery>();
                let mut state = state.0.lock().unwrap();
                let accepted = state
                    .presentation
                    .accepted(generation, source_current, detailed);
                state.presentation.reviewing = false;
                return accepted;
            }
            MessageDialogResult::Custom(choice) if choice == details => {
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
                    text("title"),
                    cancel,
                    back,
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
    false
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
fn completion_outcome(value: &Value, action: &str) -> bool {
    if value["status"] == "blocked" {
        return value["outcome"] == "unconfirmed";
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
            if state.pending.is_some() { return; }
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
        drop(state);
        if document(&window) && window.is_focused().unwrap_or(false) {
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
                        || !exact(&value, &["kind", "session"])
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
                    let approved = review(
                        app,
                        window,
                        &action,
                        value["detail"].as_str().unwrap(),
                        generation,
                    );
                    let answer = json!({"kind":"answer", "session":session, "id":value["id"],"nonce":value["nonce"],"digest":value["digest"],"approved":approved});
                    if let Some(child) = app.state::<Recovery>().0.lock().unwrap().child.as_mut() {
                        child.write(format!("{answer}\n").as_bytes())?;
                    }
                } else if exact(&value, &["kind", "session", "id", "status", "outcome"])
                    && value["kind"] == "complete"
                    && value["session"] == session
                    && value["id"] == id
                    && completion_outcome(&value, &action)
                {
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
                    if document(window) {
                        app.dialog()
                            .message(text(value["outcome"].as_str().unwrap()))
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
