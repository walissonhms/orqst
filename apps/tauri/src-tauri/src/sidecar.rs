// Adapted from Anywh (Apache-2.0), commit 546f189c04415c3c5af5f40e3931a0a90b9aba31:
// client/src-tauri/src/tailnet_sidecar.rs, tailnet_sidecar_start / kill_all.
// ORQST modifications: one fixed local Node Core, bounded readiness, no renderer
// commands/network credentials, redacted diagnostics and graceful stdin shutdown.
// See root NOTICE and docs/research/tauri-core-reuse.md.

use std::sync::Arc;
use std::time::Duration;
use tauri::Manager;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use tokio::sync::{Mutex, Notify};

#[derive(Default)]
pub struct DesktopCore(Mutex<Option<Running>>);

struct Running {
    child: CommandChild,
    origin: String,
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
    let mut running = state.0.lock().await;
    if let Some(existing) = running.as_ref() {
        return Ok(existing.origin.clone());
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
                CommandEvent::Error(_) | CommandEvent::Terminated(_) => return None,
                // Do not print potentially sensitive Node diagnostics or paths.
                CommandEvent::Stderr(_) => {}
                _ => {}
            }
        }
        None
    })
    .await;
    let origin = match readiness {
        Ok(Some(origin)) => origin,
        _ => {
            let _ = child.kill();
            return Err("ORQST Desktop Core did not become ready".into());
        }
    };
    let pid = child.pid();
    let exited = Arc::new(Notify::new());
    *running = Some(Running {
        child,
        origin: origin.clone(),
        exited: exited.clone(),
    });
    drop(running);
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        // Drain both streams after readiness, including on a closed/hidden window.
        // A crash clears this exact child only; it never automatically restarts it.
        while let Some(event) = rx.recv().await {
            if let CommandEvent::Stdout(ref line) = event {
                crate::desktop::receive(&app, line);
            }
            if let CommandEvent::Terminated(_) = event {
                crate::desktop::disconnected(&app);
                exited.notify_one();
                let state = app.state::<DesktopCore>();
                let mut running = state.0.lock().await;
                if running
                    .as_ref()
                    .is_some_and(|entry| entry.child.pid() == pid)
                {
                    running.take();
                }
                break;
            }
        }
    });
    Ok(origin)
}

pub fn stop(app: &tauri::AppHandle) {
    let state = app.state::<DesktopCore>();
    let running = tauri::async_runtime::block_on(async { state.0.lock().await.take() });
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
    use super::ready_origin;

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
