//! Native transport for ORQST's existing structured agent composition.
//! Reuses the terminal bridge's fixed sidecar, document fencing and Cancel-default review.
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::menu::{Menu, MenuItem};
use tauri::webview::NewWindowResponse;
use tauri::{Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogResult};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use tokio::sync::{oneshot, Notify};

const LABEL: &str = "managed-agents";
const URL: &str = "orqst-agents://local/index.html";
#[derive(Default)]
pub struct Agents(Mutex<Option<Running>>);
struct Running {
    child: CommandChild,
    document: String,
    generation: u64,
    loaded: bool,
    revoked: bool,
    busy: bool,
    sequence: u64,
    pending: HashMap<String, oneshot::Sender<Value>>,
    exited: Arc<Notify>,
    quit_notice: String,
    cancel: String,
    quit: String,
    confirming_quit: bool,
    exit_authorized: bool,
}

fn document_matches(label: &str, source: &str) -> bool {
    label == LABEL && source == URL
}
fn current(window: &WebviewWindow) -> bool {
    window
        .url()
        .is_ok_and(|url| document_matches(window.label(), url.as_str()))
}
fn focused(window: &WebviewWindow) -> bool {
    window.is_visible().unwrap_or(false) && window.is_focused().unwrap_or(false)
}
fn send(app: &tauri::AppHandle, message: Value) -> bool {
    let state = app.state::<Agents>();
    let mut guard = state.0.lock().unwrap();
    let Some(running) = guard.as_mut() else {
        return false;
    };
    let bytes = format!("{message}\n");
    bytes.len() <= 128 * 1024 && running.child.write(bytes.as_bytes()).is_ok()
}
fn revoke(app: &tauri::AppHandle, close: bool) {
    {
        let state = app.state::<Agents>();
        let mut guard = state.0.lock().unwrap();
        if let Some(running) = guard.as_mut() {
            running.generation += 1;
            running.revoked |= close;
        }
    }
    send(app, json!({"kind": "revoke"}));
}

#[tauri::command]
pub async fn agents_request(window: WebviewWindow, request: Value) -> Value {
    let denied = || json!({"status": "denied"});
    if !current(&window) {
        return denied();
    }
    let app = window.app_handle().clone();
    let mutation = request["action"] != "snapshot";
    let (id, generation, receiver) = {
        let state = app.state::<Agents>();
        let mut guard = state.0.lock().unwrap();
        let Some(r) = guard.as_mut() else {
            return denied();
        };
        if !r.loaded || r.revoked {
            return denied();
        }
        if (mutation && r.busy) || r.pending.len() >= 8 {
            return json!({"status": "busy"});
        }
        let focus = focused(&window);
        if mutation && !focus {
            return json!({"status": "focus_required"});
        }
        r.sequence += 1;
        let id = format!("00000000-0000-4000-8000-{:012x}", r.sequence);
        let bytes = format!(
            "{}\n",
            json!({"kind": "request", "id": id, "request": request, "focused": focus})
        );
        if bytes.len() > 128 * 1024 {
            return denied();
        }
        let (sender, receiver) = oneshot::channel();
        r.pending.insert(id.clone(), sender);
        r.busy |= mutation;
        if r.child.write(bytes.as_bytes()).is_err() {
            r.pending.remove(&id);
            if mutation {
                r.busy = false;
            }
            r.revoked = true;
            return denied();
        }
        (id, r.generation, receiver)
    };
    // Preparation + bounded review + host operation + fresh snapshot; never retry on timeout.
    let result = tokio::time::timeout(Duration::from_secs(230), receiver).await;
    let valid = {
        let state = app.state::<Agents>();
        let mut guard = state.0.lock().unwrap();
        let Some(r) = guard.as_mut() else {
            return denied();
        };
        r.pending.remove(&id);
        if mutation {
            r.busy = false;
        }
        r.generation == generation && r.loaded && !r.revoked
    };
    if !valid || !current(&window) {
        return denied();
    }
    match result {
        Ok(Ok(value)) => value,
        _ => {
            revoke(&app, true);
            denied()
        }
    }
}

fn confirm(app: &tauri::AppHandle, value: &Value) {
    let (Some(id), Some(request)) = (value["id"].as_str(), value["requestId"].as_str()) else {
        return;
    };
    let Some(window) = app.get_webview_window(LABEL) else {
        return;
    };
    let fields: Option<Vec<&str>> = ["title", "message", "detail", "cancel", "approve"]
        .iter()
        .map(|key| value[*key].as_str())
        .collect();
    let Some(fields) = fields else { return };
    let generation = {
        let state = app.state::<Agents>();
        let guard = state.0.lock().unwrap();
        guard
            .as_ref()
            .filter(|r| r.loaded && !r.revoked && r.pending.contains_key(request))
            .map(|r| r.generation)
    };
    if generation.is_none()
        || !current(&window)
        || !focused(&window)
        || fields.iter().any(|s| s.len() > 16384)
    {
        send(app, json!({"kind": "confirm", "id": id, "accepted": false}));
        return;
    }
    let id = id.to_owned();
    let request = request.to_owned();
    let approve = fields[4].to_owned();
    let expected = approve.clone();
    let app = app.clone();
    app.dialog().message(format!("{}\n\n{}", fields[1], fields[2]))
        .title(fields[0]).parent(&window)
        .buttons(MessageDialogButtons::YesNoCancelCustom(fields[3].into(), approve, fields[3].into()))
        .show_with_result(move |result| {
            let active = {
                let state = app.state::<Agents>();
                let guard = state.0.lock().unwrap();
                guard.as_ref().is_some_and(|r| Some(r.generation) == generation && !r.revoked && r.pending.contains_key(&request))
            };
            let accepted = matches!(result, MessageDialogResult::Custom(ref text) if text == &expected)
                && active && current(&window) && focused(&window);
            send(&app, json!({"kind": "confirm", "id": id, "accepted": accepted}));
        });
}

pub async fn start(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let Ok(files) = std::env::var("ORQST_TAURI_AGENTS") else {
        return Ok(());
    };
    let paths: Vec<String> = serde_json::from_str(&files)?;
    if paths.len() != 2 || paths.iter().any(|p| p.is_empty() || p.len() > 2048) {
        return Err("Invalid explicit managed agents selection".into());
    }
    let script = app
        .path()
        .resource_dir()?
        .join("core/tauri-agents-host.cjs");
    let admission = app.path().app_data_dir()?.join("structured-agents");
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
        Ok(Some(v)) if v["kind"] == "ready" && v["html"].is_string() => v,
        _ => {
            let _ = child.kill();
            return Err("Managed agents startup refused".into());
        }
    };
    let exited = Arc::new(Notify::new());
    *app.state::<Agents>().0.lock().unwrap() = Some(Running {
        child,
        document: ready["html"].as_str().unwrap_or("").into(),
        generation: 0,
        loaded: false,
        revoked: false,
        busy: false,
        sequence: 0,
        pending: HashMap::new(),
        exited: exited.clone(),
        quit_notice: ready["quitNotice"].as_str().unwrap_or("").into(),
        cancel: ready["cancel"].as_str().unwrap_or("").into(),
        quit: ready["quit"].as_str().unwrap_or("").into(),
        confirming_quit: false,
        exit_authorized: false,
    });
    let handle = app.clone();
    let window = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::External(URL.parse()?))
        .title(ready["title"].as_str().unwrap_or("ORQST"))
        .inner_size(1200.0, 900.0)
        .min_inner_size(800.0, 600.0)
        .visible(false)
        .on_navigation(|url| url.as_str() == URL)
        .on_new_window(|_, _| NewWindowResponse::Deny)
        .on_page_load(move |window, payload| {
            if payload.event() == tauri::webview::PageLoadEvent::Started {
                let state = window.state::<Agents>();
                let mut guard = state.0.lock().unwrap();
                let reload = guard.as_ref().is_some_and(|r| r.loaded);
                if let Some(r) = guard.as_mut() {
                    r.loaded = true;
                }
                drop(guard);
                if reload {
                    revoke(&handle, true);
                }
            }
        })
        .build()?;
    let handle = app.clone();
    let target = window.clone();
    window.on_window_event(move |event| match event {
        WindowEvent::Focused(false) => revoke(&handle, false),
        WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            revoke(&handle, false);
            let _ = target.hide();
        }
        WindowEvent::Destroyed => revoke(&handle, true),
        _ => {}
    });
    // Preserve the prepared terminal menu when both independent surfaces are enabled.
    let menu = match app.menu() {
        Some(menu) => menu,
        None => Menu::default(app)?,
    };
    menu.append(&MenuItem::with_id(
        app,
        LABEL,
        ready["title"].as_str().unwrap_or("ORQST"),
        true,
        None::<&str>,
    )?)?;
    app.set_menu(menu)?;
    app.on_menu_event(|app, event| {
        if event.id().as_ref() == LABEL {
            if let Some(window) = app.get_webview_window(LABEL) {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
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
                        let state = app.state::<Agents>();
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
    if uri.scheme_str() != Some("orqst-agents")
        || uri.host() != Some("local")
        || uri.query().is_some()
    {
        return None;
    }
    match uri.path() {
        "/index.html" => {
            let state = app.state::<Agents>();
            let guard = state.0.lock().unwrap();
            Some((
                guard.as_ref()?.document.as_bytes().to_vec(),
                "text/html; charset=utf-8",
            ))
        }
        "/client.js" | "/style.css" => {
            let file = app
                .path()
                .resource_dir()
                .ok()?
                .join("agents")
                .join(uri.path().trim_start_matches('/'));
            Some((
                std::fs::read(file).ok()?,
                if uri.path() == "/client.js" {
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
    let running = app.state::<Agents>().0.lock().unwrap().take();
    if let Some(mut r) = running {
        let _ = r.child.write(b"shutdown\n");
        tauri::async_runtime::spawn(async move {
            if tokio::time::timeout(Duration::from_secs(6), r.exited.notified())
                .await
                .is_err()
            {
                let _ = r.child.kill();
            }
        });
    }
}
pub fn stop_and_wait(app: &tauri::AppHandle) {
    let running = app.state::<Agents>().0.lock().unwrap().take();
    if let Some(mut r) = running {
        let _ = r.child.write(b"shutdown\n");
        if tauri::async_runtime::block_on(async {
            tokio::time::timeout(Duration::from_secs(6), r.exited.notified()).await
        })
        .is_err()
        {
            let _ = r.child.kill();
        }
    }
}
pub fn reset_exit(app: &tauri::AppHandle) {
    if let Some(r) = app.state::<Agents>().0.lock().unwrap().as_mut() {
        r.exit_authorized = false;
        r.confirming_quit = false;
    }
}

pub fn confirm_exit(app: &tauri::AppHandle) -> bool {
    let fields = {
        let state = app.state::<Agents>();
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
                if let Some(r) = app.state::<Agents>().0.lock().unwrap().as_mut() {
                    r.exit_authorized = true;
                }
                app.exit(0);
            } else {
                reset_exit(&app);
                crate::terminal::reset_exit(&app);
            }
        });
    true
}

#[cfg(test)]
mod tests {
    use super::document_matches;
    #[test]
    fn commands_bind_only_the_structured_native_document() {
        assert!(document_matches(
            "managed-agents",
            "orqst-agents://local/index.html"
        ));
        for (label, source) in [
            ("main", "orqst-agents://local/index.html"),
            ("terminal-0", "orqst-agents://local/index.html"),
            ("managed-agents", "http://127.0.0.1:4319/"),
            ("managed-agents", "orqst-agents://local/index.html?task=1"),
            ("managed-agents", "orqst-agents://local/index.html#reload"),
            ("managed-agents", "orqst-terminal://local/0/index.html"),
        ] {
            assert!(!document_matches(label, source));
        }
    }
}
