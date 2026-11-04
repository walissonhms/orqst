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
    busy: Vec<bool>,
    sequence: u64,
    exited: Arc<Notify>,
    quit_notice: String,
    cancel: String,
    quit: String,
    confirming_quit: bool,
    exit_authorized: bool,
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
    use super::document_slot;

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
        if !running.loaded.get(slot).copied().unwrap_or(false)
            || running.revoked[slot]
            || running.busy[slot]
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
        if running.child.write(bytes.as_bytes()).is_err() {
            running.pending.remove(&id);
            running.busy[slot] = false;
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
        running.generations[slot] == generation && running.loaded[slot]
    };
    if !valid || self::slot(&window) != Some(slot) {
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
    if !focused(&window).await {
        return json!(false);
    }
    // Revoke immediately, before the asynchronous Node layout update arrives.
    revoke_all(app);
    if action == "dashboard" {
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
    let Some(window) = app.get_window("terminal-workspace") else {
        return;
    };
    let state = &value["state"];
    {
        let terminal = app.state::<Terminals>();
        if let Some(r) = terminal.0.lock().unwrap().as_mut() {
            r.layout = state.clone();
        };
    }
    let Some(bounds) = value["bounds"].as_array() else {
        return;
    };
    let visible = state["visible"].as_array().is_some_and(|s| !s.is_empty());
    if !visible {
        revoke_all(app);
        let _ = window.hide();
    }
    for bound in bounds {
        let Some(slot) = bound["slot"].as_u64() else {
            continue;
        };
        let Some(view) = app.get_webview(&format!("terminal-{slot}")) else {
            continue;
        };
        if bound["rect"].is_null() {
            revoke(app, slot as usize, false);
            let _ = view.hide();
        } else {
            let rect = &bound["rect"];
            let coordinates: Option<Vec<f64>> = ["x", "y", "width", "height"]
                .iter()
                .map(|k| {
                    rect[*k]
                        .as_f64()
                        .filter(|v| v.is_finite() && *v >= 0.0 && *v <= 32768.0)
                })
                .collect();
            let Some(c) = coordinates else { continue };
            let _ = view.set_bounds(tauri::Rect {
                position: tauri::LogicalPosition::new(c[0], c[1]).into(),
                size: tauri::LogicalSize::new(c[2], c[3]).into(),
            });
            let _ = view.show();
        }
        // Only trusted, JSON-serialized layout metadata is evaluated, never CLI output.
        let _ = view.eval(format!(
            "window.dispatchEvent(new CustomEvent('orqst-terminal-layout',{{detail:{state}}}));"
        ));
    }
    if visible {
        let _ = window.show();
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
    let generation = app
        .state::<Terminals>()
        .0
        .lock()
        .unwrap()
        .as_ref()
        .map(|r| r.generations[slot]);
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
                let current = app.state::<Terminals>().0.lock().unwrap().as_ref().map(|r| r.generations[slot]);
                let accepted = matches!(result, MessageDialogResult::Custom(ref text) if text == &expected)
                    && generation == current && self::slot(&window) == Some(slot) && focused;
                send(&app, json!({"kind": "confirm", "id": id, "accepted": accepted}));
            });
        });
}

pub async fn start(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let Ok(files) = std::env::var("ORQST_TAURI_TERMINALS") else {
        return Ok(());
    };
    let paths: Vec<String> = serde_json::from_str(&files)?;
    if paths.is_empty() || paths.len() > 8 || paths.iter().any(|p| p.len() > 2048) {
        return Err("Invalid explicit managed terminal selection".into());
    }
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
        busy: vec![false; count],
        sequence: 0,
        exited: exited.clone(),
        quit_notice: ready["quitNotice"].as_str().unwrap_or("").into(),
        cancel: ready["cancel"].as_str().unwrap_or("").into(),
        quit: ready["quit"].as_str().unwrap_or("").into(),
        confirming_quit: false,
        exit_authorized: false,
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
        WindowEvent::Focused(false) => revoke_all(&handle),
        WindowEvent::Resized(_) | WindowEvent::ScaleFactorChanged { .. } => {
            resize(&handle, &target)
        }
        WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
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
    menu.append(&submenu)?;
    app.set_menu(menu)?;
    app.on_menu_event(|app, event| {
        if let Some(slot) = event
            .id()
            .as_ref()
            .strip_prefix("terminal-")
            .and_then(|s| s.parse::<usize>().ok())
        {
            revoke_all(app);
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
                    if value["kind"] == "reply" {
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

/// Closing the application requires explicit consent to disconnect owned tasks.
pub fn reset_exit(app: &tauri::AppHandle) {
    if let Some(r) = app.state::<Terminals>().0.lock().unwrap().as_mut() {
        r.exit_authorized = false;
        r.confirming_quit = false;
    }
}

pub fn confirm_exit(app: &tauri::AppHandle) -> bool {
    let fields = {
        let state = app.state::<Terminals>();
        let mut guard = state.0.lock().unwrap();
        let Some(r) = guard.as_mut() else {
            return false;
        };
        if r.exit_authorized {
            return false;
        }
        if r.confirming_quit {
            return true;
        }
        r.confirming_quit = true;
        (r.quit_notice.clone(), r.cancel.clone(), r.quit.clone())
    };
    let app = app.clone();
    app.dialog()
        .message(fields.0)
        .buttons(MessageDialogButtons::YesNoCancelCustom(
            fields.1.clone(),
            fields.2.clone(),
            fields.1,
        ))
        .show_with_result(move |result| {
            if matches!(result, MessageDialogResult::Custom(ref s) if s == &fields.2) {
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
