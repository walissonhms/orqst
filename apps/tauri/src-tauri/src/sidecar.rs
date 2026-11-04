// Adapted from Anywh (Apache-2.0), commit 546f189c04415c3c5af5f40e3931a0a90b9aba31:
// client/src-tauri/src/tailnet_sidecar.rs, tailnet_sidecar_start / kill_all.
// ORQST modifications: one fixed local Node Core, bounded readiness, no renderer
// commands/network credentials, redacted diagnostics and graceful stdin shutdown.
// See root NOTICE and docs/research/tauri-core-reuse.md.

#[path = "sidecar_availability.rs"]
mod availability;
use availability::Availability;
use std::sync::Arc;
use std::time::Duration;
use tauri::Manager;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use tokio::sync::{Mutex, Notify};

#[derive(Default)]
pub struct DesktopCore(Mutex<State>);

#[derive(Default)]
struct State {
    availability: Availability,
    running: Option<Running>,
}

struct Running {
    child: CommandChild,
    exited: Arc<Notify>,
}

fn ready_origin(line: &[u8]) -> Option<String> {
    let text = std::str::from_utf8(line)
        .ok()?
        .trim_end_matches(['\r', '\n']);
    let port = text.strip_prefix("ORQST_CORE_READY ")?;
    if port.is_empty() || !port.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    let port: u16 = port.parse().ok()?;
    (port >= 1024).then(|| format!("http://127.0.0.1:{port}"))
}

pub async fn start(app: &tauri::AppHandle) -> Result<String, Box<dyn std::error::Error>> {
    let state = app.state::<DesktopCore>();
    // Hold the lock across start/readiness: two attachments cannot spawn duplicates.
    let mut state = state.0.lock().await;
    if !state.availability.begin() {
        return Err("ORQST Desktop Core startup was already attempted".into());
    }
    let resources = app.path().resource_dir()?;
    let data = app.path().app_data_dir()?.join("core");
    let script = resources.join("core/desktop-sidecar.mjs");
    let dashboard = resources.join("dashboard");
    // Keep the webview origin stable across restarts so its local preferences survive.
    let port = std::env::var("ORQST_TAURI_PORT").unwrap_or_else(|_| "4319".into());
    let command = app
        .shell()
        .sidecar("orqst-node")?
        .args([script.as_os_str(), dashboard.as_os_str()])
        .env_clear()
        .envs(std::env::vars_os().filter(|(key, _)| {
            matches!(
                key.to_str(),
                Some(
                    "HOME"
                        | "USERPROFILE"
                        | "SYSTEMROOT"
                        | "WINDIR"
                        | "TMP"
                        | "TEMP"
                        | "TMPDIR"
                        | "PATH"
                        | "CODEX_HOME"
                        | "ORQST_CODEX_SESSIONS"
                        | "ORQST_RETENTION_DAYS"
                        | "ORQST_POLL_MS"
                )
            )
        }))
        // Ignore process-wide ORQST_DATA_DIR: a running service may own that store.
        .env("ORQST_DATA_DIR", &data)
        .env("ORQST_PORT", port)
        .env("ORQST_DEV", "0")
        .env("ORQST_NATIVE_MONITOR", "1");
    let (mut rx, child) = command.spawn()?;
    let pid = child.pid();
    let exited = Arc::new(Notify::new());
    // Retain ownership even if readiness times out or the pipe is uncertain.
    state.running = Some(Running {
        child,
        exited: exited.clone(),
    });
    let mut terminated = false;
    let readiness = tokio::time::timeout(Duration::from_secs(30), async {
        let mut bytes = 0usize;
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    bytes = bytes.saturating_add(line.len());
                    if bytes > 1024 {
                        return None;
                    }
                    return ready_origin(&line);
                }
                CommandEvent::Error(_) => return None,
                CommandEvent::Terminated(_) => {
                    terminated = true;
                    return None;
                }
                // Do not print potentially sensitive Node diagnostics or paths.
                CommandEvent::Stderr(_) => {}
                _ => {}
            }
        }
        None
    })
    .await;
    let origin = readiness.ok().flatten();
    if terminated {
        // Only a confirmed exit releases this handle; uncertainty never does.
        state.running.take();
        exited.notify_one();
    }
    if origin.is_none() {
        state.availability.disconnect();
    }
    drop(state);
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        // Drain both streams even after failed readiness or a hidden window.
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    if observer_disconnected(&line) {
                        disconnected(&app, pid).await;
                    } else if app
                        .state::<DesktopCore>()
                        .0
                        .lock()
                        .await
                        .availability
                        .accept_frames()
                    {
                        crate::desktop::receive(&app, &line);
                    }
                }
                CommandEvent::Error(_) => disconnected(&app, pid).await,
                CommandEvent::Terminated(_) => {
                    disconnected(&app, pid).await;
                    exited.notify_one();
                    let state = app.state::<DesktopCore>();
                    let mut state = state.0.lock().await;
                    if state
                        .running
                        .as_ref()
                        .is_some_and(|entry| entry.child.pid() == pid)
                    {
                        state.running.take();
                    }
                    return;
                }
                // Never expose stderr, paths or configuration in the document.
                _ => {}
            }
        }
        // EOF is lost observation, not proof that the owned process exited.
        disconnected(&app, pid).await;
    });
    origin.ok_or_else(|| "ORQST Desktop Core did not become ready".into())
}

fn observer_disconnected(line: &[u8]) -> bool {
    if line.len() > 1024 {
        return false;
    }
    let Some(frame) = std::str::from_utf8(line)
        .ok()
        .and_then(|line| {
            line.trim_end_matches(['\r', '\n'])
                .strip_prefix("ORQST_DESKTOP_STATE ")
        })
        .and_then(|text| serde_json::from_str::<serde_json::Value>(text).ok())
    else {
        return false;
    };
    frame.as_object().is_some_and(|frame| {
        frame.len() == 1
            && frame.get("connected").and_then(serde_json::Value::as_bool) == Some(false)
    })
}

async fn disconnected(app: &tauri::AppHandle, pid: u32) {
    let changed = {
        let state = app.state::<DesktopCore>();
        let mut state = state.0.lock().await;
        state
            .running
            .as_ref()
            .is_some_and(|entry| entry.child.pid() == pid)
            && state.availability.disconnect()
    };
    if changed {
        crate::desktop::disconnected(app);
        crate::unavailable::show(app);
    }
}

pub fn should_present_unavailable(app: &tauri::AppHandle) -> bool {
    let state = app.state::<DesktopCore>();
    tauri::async_runtime::block_on(async { state.0.lock().await.availability.should_present() })
}

pub fn stop(app: &tauri::AppHandle) {
    let state = app.state::<DesktopCore>();
    let running = tauri::async_runtime::block_on(async {
        let mut state = state.0.lock().await;
        state.availability.stop();
        state.running.take()
    });
    if let Some(mut entry) = running {
        // Closing stdin is a second parent-loss signal. Only our child is addressed.
        let _ = entry.child.write(b"shutdown\n");
        // Keep the pipe and handle alive while SQLite and transports drain.
        let stopped = tauri::async_runtime::block_on(async {
            tokio::time::timeout(Duration::from_secs(5), entry.exited.notified()).await
        });
        if stopped.is_err() {
            let _ = entry.child.kill();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{observer_disconnected, ready_origin};

    #[test]
    fn disconnected_frames_are_fixed_and_never_raw_errors() {
        assert!(observer_disconnected(
            b"ORQST_DESKTOP_STATE {\"connected\":false}\n"
        ));
        for frame in [
            b"ORQST_DESKTOP_STATE {\"connected\":true}".as_slice(),
            b"ORQST_DESKTOP_STATE {\"connected\":false,\"path\":\"private\"}",
            b"raw stderr",
            b"ORQST_CORE_READY 4319",
        ] {
            assert!(!observer_disconnected(frame));
        }
    }

    #[test]
    fn readiness_accepts_only_a_loopback_port() {
        assert_eq!(
            ready_origin(b"ORQST_CORE_READY 4317\n"),
            Some("http://127.0.0.1:4317".into())
        );
        for value in [
            b"ORQST_CORE_READY 0".as_slice(),
            b"ORQST_CORE_READY 65536".as_slice(),
            b"ORQST_CORE_READY http://evil.test".as_slice(),
            b"ORQST_CORE_READY 4317/path".as_slice(),
            b"ORQST_CORE_READY 4317\nanything".as_slice(),
            b"ORQST_CORE_READY +4317".as_slice(),
        ] {
            assert_eq!(ready_origin(value), None);
        }
    }
}
