//! Narrow native export transport. Filesystem policy stays in ORQST's existing Node savers.
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
static FILE_EPOCH: AtomicU64 = AtomicU64::new(1);
use std::time::Duration;
use tauri::{Manager, WebviewWindow};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogResult};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use tokio::sync::oneshot;

#[derive(Default)]
pub struct Files(Mutex<Option<Running>>);
struct Running {
    child: CommandChild,
    origin: String,
    document: u64,
    admission_epoch: u64,
    sequence: u64,
    pending: HashMap<String, (u64, oneshot::Sender<Value>)>,
}
fn document_matches(label: &str, source: &str, origin: &str) -> bool {
    let Ok(url) = tauri::Url::parse(source) else {
        return false;
    };
    label == "main"
        && url.origin().ascii_serialization() == origin
        && url.query().is_none()
        && url.username().is_empty()
        && url.password().is_none()
}
fn current(window: &WebviewWindow, origin: &str) -> bool {
    window
        .url()
        .is_ok_and(|url| document_matches(window.label(), url.as_str(), origin))
}
fn send(app: &tauri::AppHandle, value: Value) -> bool {
    let state = app.state::<Files>();
    let mut guard = state.0.lock().unwrap();
    let Some(r) = guard.as_mut() else {
        return false;
    };
    let line = format!("{value}\n");
    line.len() <= 128 * 1024 && r.child.write(line.as_bytes()).is_ok()
}
pub fn invalidate(app: &tauri::AppHandle) {
    let state = app.state::<Files>();
    let mut guard = state.0.lock().unwrap();
    if let Some(r) = guard.as_mut() {
        r.document += 1;
        r.pending.clear();
        let document = r.document;
        let _ = r
            .child
            .write(format!("{}\n", json!({"kind":"revoke", "document":document})).as_bytes());
    }
}
#[tauri::command]
pub async fn file_request(window: WebviewWindow, request: Value) -> Value {
    let failed = || json!({"status":"failed"});
    let app = window.app_handle().clone();
    let (id, document, receiver) = {
        let state = app.state::<Files>();
        let mut guard = state.0.lock().unwrap();
        let Some(r) = guard.as_mut() else {
            return failed();
        };
        if !current(&window, &r.origin) || r.document == 0 {
            return failed();
        }
        let context = request["kind"] == "analytics" && request["input"]["action"] == "context";
        if !context
            && (!window.is_visible().unwrap_or(false) || !window.is_focused().unwrap_or(false))
        {
            return failed();
        }
        if r.pending.len() >= 8 {
            return json!({"status":"busy"});
        }
        let action = if context {
            crate::renderer_admission::Action::Context
        } else {
            crate::renderer_admission::Action::File
        };
        if !crate::renderer_admission::admit(
            window.label(),
            &r.admission_epoch.to_string(),
            r.document,
            action,
            crate::local_diagnostics::RefusalSource::Files,
        ) {
            return failed();
        }
        r.sequence += 1;
        let id = r.sequence.to_string();
        let document = r.document;
        let line = format!(
            "{}\n",
            json!({"kind":"request", "id":id, "document":document, "request":request, "source":window.url().map(|u|u.to_string()).unwrap_or_default()})
        );
        if line.len() > 128 * 1024 {
            return failed();
        }
        let (sender, receiver) = oneshot::channel();
        if r.child.write(line.as_bytes()).is_err() {
            return failed();
        }
        r.pending.insert(id.clone(), (document, sender));
        (id, document, receiver)
    };
    let result = tokio::time::timeout(Duration::from_secs(180), receiver).await;
    let valid = {
        let state = app.state::<Files>();
        let mut guard = state.0.lock().unwrap();
        let Some(r) = guard.as_mut() else {
            return failed();
        };
        r.pending.remove(&id);
        r.document == document && current(&window, &r.origin)
    };
    if !valid {
        return failed();
    }
    match result {
        Ok(Ok(value)) => json!({"status":value["status"]}),
        _ => {
            stop(&app);
            failed()
        } // Fence uncertain writes; never retry automatically.
    }
}
fn active(app: &tauri::AppHandle, request: &str, document: u64) -> bool {
    let state = app.state::<Files>();
    let guard = state.0.lock().unwrap();
    guard.as_ref().is_some_and(|r| {
        r.document == document
            && r.pending.contains_key(request)
            && app
                .get_webview_window("main")
                .is_some_and(|w| current(&w, &r.origin) && w.is_visible().unwrap_or(false))
    })
}
async fn dialog(app: &tauri::AppHandle, value: Value) {
    let (Some(id), Some(request)) = (value["id"].as_u64(), value["requestId"].as_str()) else {
        return;
    };
    let document = {
        let state = app.state::<Files>();
        let guard = state.0.lock().unwrap();
        guard
            .as_ref()
            .and_then(|r| r.pending.get(request).map(|(doc, _)| *doc))
    };
    let Some(document) = document else { return };
    let mut answer = Value::Null;
    if active(app, request, document) {
        if let Some(window) = app.get_webview_window("main") {
            let field = |key: &str| value[key].as_str().filter(|s| s.len() <= 16384);
            match value["kind"].as_str() {
                Some("choose") => {
                    if let (Some(title), Some(name), Some(extension)) =
                        (field("title"), field("name"), field("extension"))
                    {
                        if matches!(extension, "md" | "csv") && !name.contains(['/', '\\']) {
                            let picker = app
                                .dialog()
                                .file()
                                .set_parent(&window)
                                .set_title(title)
                                .set_file_name(name)
                                .add_filter(extension, &[extension]);
                            // Blocking dialog methods must run outside the UI thread.
                            let selected = tauri::async_runtime::spawn_blocking(move || {
                                picker.blocking_save_file()
                            })
                            .await;
                            if let Ok(Some(path)) = selected {
                                if let Ok(path) = path.into_path() {
                                    answer = json!(path.to_string_lossy());
                                }
                            }
                        }
                    }
                }
                Some("confirm") => {
                    if let (Some(title), Some(message), Some(detail), Some(cancel), Some(approve)) = (
                        field("title"),
                        field("message"),
                        field("detail"),
                        field("cancel"),
                        field("approve"),
                    ) {
                        let expected = approve.to_owned();
                        let review = app
                            .dialog()
                            .message(format!("{message}\n\n{detail}"))
                            .title(title)
                            .parent(&window)
                            .buttons(MessageDialogButtons::YesNoCancelCustom(
                                cancel.into(),
                                approve.into(),
                                cancel.into(),
                            ));
                        let result = tauri::async_runtime::spawn_blocking(move || {
                            review.blocking_show_with_result()
                        })
                        .await;
                        answer = json!(
                            matches!(result, Ok(MessageDialogResult::Custom(ref text)) if text == &expected)
                        );
                    }
                }
                Some("open") => {
                    if let Some(path) = field("path") {
                        if std::path::Path::new(path).is_absolute()
                            && std::path::Path::new(path)
                                .extension()
                                .is_some_and(|e| e == "md")
                        {
                            // Only a verified saved Markdown path from the private Node pipe, never renderer input.
                            #[allow(deprecated)]
                            let opened = app.shell().open(path, None).is_ok();
                            answer = json!(opened);
                        }
                    }
                }
                _ => {}
            }
        }
    }
    if !active(app, request, document) {
        answer = Value::Null;
    }
    send(app, json!({"kind":"dialog", "id":id, "value":answer}));
}
pub async fn start(
    app: &tauri::AppHandle,
    origin: &str,
) -> Result<String, Box<dyn std::error::Error>> {
    let resources = app.path().resource_dir()?;
    let script = resources.join("core/tauri-files-host.cjs");
    let client = std::fs::read_to_string(resources.join("files/client.js"))?;
    let (mut rx, child) = app
        .shell()
        .sidecar("orqst-node")?
        .args([script.as_os_str(), std::ffi::OsStr::new(origin)])
        .env_clear()
        .envs(std::env::vars_os().filter(|(key, _)| {
            matches!(
                key.to_str(),
                Some(
                    "HOME"
                        | "USERPROFILE"
                        | "SYSTEMROOT"
                        | "WINDIR"
                        | "TMPDIR"
                        | "TMP"
                        | "TEMP"
                        | "LANG"
                )
            )
        }))
        .spawn()?;
    let ready = tokio::time::timeout(Duration::from_secs(10), async {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) if bytes.len() <= 1024 => {
                    return serde_json::from_slice::<Value>(&bytes)
                        .is_ok_and(|v| v == json!({"kind":"ready"}))
                }
                CommandEvent::Stderr(_) => {}
                _ => return false,
            }
        }
        false
    })
    .await;
    if !matches!(ready, Ok(true)) {
        let _ = child.kill();
        return Err("Native file host refused".into());
    }
    *app.state::<Files>().0.lock().unwrap() = Some(Running {
        child,
        origin: origin.into(),
        document: 0,
        admission_epoch: FILE_EPOCH.fetch_add(1, Ordering::Relaxed),
        sequence: 0,
        pending: HashMap::new(),
    });
    app.add_capability(
        tauri::ipc::CapabilityBuilder::new("native-file-exports")
            .local(false)
            .remote(format!("{origin}/*"))
            .webview("main")
            .permission("allow-file-request"),
    )?;
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) if bytes.len() <= 128 * 1024 => {
                    let Ok(value) = serde_json::from_slice::<Value>(&bytes) else {
                        break;
                    };
                    if value["kind"] == "reply" {
                        let Some(id) = value["id"].as_str() else {
                            break;
                        };
                        let state = handle.state::<Files>();
                        let mut guard = state.0.lock().unwrap();
                        if let Some(r) = guard.as_mut() {
                            if let Some((_, sender)) = r.pending.remove(id) {
                                let _ = sender.send(value["value"].clone());
                            }
                        }
                    } else if matches!(value["kind"].as_str(), Some("choose" | "confirm" | "open"))
                    {
                        let app = handle.clone();
                        tauri::async_runtime::spawn(async move {
                            dialog(&app, value).await;
                        });
                    } else {
                        break;
                    }
                }
                CommandEvent::Stderr(_) => {}
                _ => break,
            }
        }
        stop(&handle);
    });
    // Never install the adapter into frames or a navigation to another document.
    Ok(format!("if (window.top === window.self && location.origin === {} && !location.search) {{\n{client}\n}}", json!(origin)))
}
pub fn stop(app: &tauri::AppHandle) {
    if let Some(r) = app.state::<Files>().0.lock().unwrap().take() {
        let _ = r.child.kill();
    }
}
#[cfg(test)]
mod tests {
    use super::document_matches;
    #[test]
    fn file_commands_require_the_exact_owned_main_document() {
        let origin = "http://127.0.0.1:4319";
        assert!(document_matches(
            "main",
            "http://127.0.0.1:4319/#session=a",
            origin
        ));
        assert!(document_matches(
            "main",
            "http://127.0.0.1:4319/models",
            origin
        ));
        assert!(document_matches(
            "main",
            "http://127.0.0.1:4319/overview/sessions/synthetic",
            origin
        ));
        for (label, source) in [
            ("main", "http://127.0.0.1:4320/"),
            ("terminal-0", "http://127.0.0.1:4319/"),
            ("main", "http://localhost:4319/"),
            ("main", "http://user@127.0.0.1:4319/"),
            ("main", "http://127.0.0.1:4319/?x=1"),
            ("managed-agents", "orqst-agents://local/index.html"),
        ] {
            assert!(!document_matches(label, source, origin));
        }
    }
}
