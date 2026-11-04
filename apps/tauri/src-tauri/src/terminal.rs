//! Native-only client of ORQST's existing TerminalNativeBroker/Node host.
//! The observer webview has no capability for these commands or this private pipe.
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Arc;
use std::sync::Mutex;
use std::time::Duration;
use tauri::menu::{Menu, MenuItem, Submenu};
use tauri::webview::NewWindowResponse;
use tauri::{Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};
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

fn slot(window: &WebviewWindow) -> Option<usize> {
    document_slot(window.label(), window.url().ok()?.as_str())
}

fn document_slot(label: &str, source: &str) -> Option<usize> {
    let slot: usize = label.strip_prefix("terminal-")?.parse().ok()?;
    (slot < 8 && label == format!("terminal-{slot}") && source == url(slot)).then_some(slot)
}

fn focused(window: &WebviewWindow) -> bool {
    window.is_visible().unwrap_or(false) && window.is_focused().unwrap_or(false)
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
pub async fn terminal_request(window: WebviewWindow, request: Value) -> Value {
    let denied = || json!({"status": "denied"});
    let Some(slot) = slot(&window) else {
        return denied();
    };
    let app = window.app_handle().clone();
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
        let focus = focused(&window);
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
pub fn terminal_view(window: WebviewWindow, action: Value) -> bool {
    let Some(slot) = slot(&window) else {
        return false;
    };
    if !focused(&window) {
        return false;
    }
    let app = window.app_handle();
    revoke(app, slot, false);
    match action.as_str() {
        Some("hide" | "dashboard") => {
            if action == "dashboard" {
                if let Some(main) = app.get_webview_window("main") {
                    let _ = main.show();
                    let _ = main.set_focus();
                }
            }
            window.hide().is_ok()
        }
        Some("maximize") => window.maximize().is_ok(),
        Some("restore") => window.unmaximize().is_ok(),
        _ => {
            let Some(target) = action.get("tab").and_then(Value::as_u64) else {
                return false;
            };
            if let Some(target) = app.get_webview_window(&format!("terminal-{target}")) {
                let _ = target.show();
                target.set_focus().is_ok()
            } else {
                false
            }
        }
    }
}

fn confirm(app: &tauri::AppHandle, value: &Value) {
    let Some(slot) = value["slot"].as_u64().map(|v| v as usize) else {
        return;
    };
    let Some(id) = value["id"].as_str().map(str::to_owned) else {
        return;
    };
    let Some(window) = app.get_webview_window(&format!("terminal-{slot}")) else {
        return;
    };
    let valid = self::slot(&window) == Some(slot) && focused(&window);
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
        .title(fields[0]).parent(&window)
        .buttons(MessageDialogButtons::YesNoCancelCustom(fields[3].into(), approve, fields[3].into()))
        .show_with_result(move |result| {
            let current = app.state::<Terminals>().0.lock().unwrap().as_ref().map(|r| r.generations[slot]);
            let accepted = matches!(result, MessageDialogResult::Custom(ref text) if text == &expected)
                && generation == current && self::slot(&window) == Some(slot) && focused(&window);
            send(&app, json!({"kind": "confirm", "id": id, "accepted": accepted}));
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
    let menu = Menu::default(app)?;
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
        let window =
            WebviewWindowBuilder::new(app, &label, WebviewUrl::External(expected.parse()?))
                .title(pane["title"].as_str().unwrap_or("ORQST"))
                .inner_size(1000.0, 760.0)
                .visible(false)
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
                })
                .build()?;
        let handle = app.clone();
        let target = window.clone();
        window.on_window_event(move |event| match event {
            WindowEvent::Focused(false) => revoke(&handle, slot, false),
            WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                revoke(&handle, slot, false);
                let _ = target.hide();
            }
            WindowEvent::Destroyed => revoke(&handle, slot, true),
            _ => {}
        });
    }
    menu.append(&submenu)?;
    app.set_menu(menu)?;
    app.on_menu_event(|app, event| {
        if let Some(window) = app.get_webview_window(event.id().as_ref()) {
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
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
                        confirm(&app, &value);
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
            } else if let Some(r) = app.state::<Terminals>().0.lock().unwrap().as_mut() {
                r.confirming_quit = false;
            }
        });
    true
}
