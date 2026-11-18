//! Private transport to the Node pilot. The Feature command owns native consent.
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::Manager;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use tokio::sync::{oneshot, Notify};

#[derive(Default)]
pub struct StructuredAgents(Mutex<Option<Running>>);

struct Running {
    child: CommandChild,
    sequence: u64,
    pending: HashMap<u64, oneshot::Sender<Value>>,
    exited: Arc<Notify>,
}

pub fn enabled() -> bool {
    cfg!(all(target_os = "macos", target_arch = "aarch64"))
        && std::env::var("ORQST_STRUCTURED_AGENTS").as_deref() == Ok("1")
}

pub fn start(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    if !enabled() {
        return Ok(());
    }
    let script = app.path().resource_dir()?.join("core/tauri-structured-agents-host.cjs");
    let preferences = app.path().app_data_dir()?.join("managed-agents");
    let (mut rx, child) = app.shell().sidecar("orqst-node")?
        .args([script.as_os_str(), preferences.as_os_str()])
        .env_clear()
        .envs(std::env::vars_os().filter(|(key, _)| {
            matches!(
                key.to_str(),
                Some(
                    "HOME"
                        | "PATH"
                        | "LANG"
                        | "TMPDIR"
                        | "CODEX_HOME"
                        | "XDG_CONFIG_HOME"
                        | "XDG_DATA_HOME"
                        | "XDG_STATE_HOME"
                        | "XDG_CACHE_HOME"
                        | "ORQST_STRUCTURED_AGENTS"
                )
            )
        }))
        .spawn()?;
    let exited = Arc::new(Notify::new());
    *app.state::<StructuredAgents>().0.lock().unwrap() = Some(Running {
        child,
        sequence: 0,
        pending: HashMap::new(),
        exited: exited.clone(),
    });
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) if bytes.len() <= 512 * 1024 => {
                    if let Ok(reply) = serde_json::from_slice::<Value>(&bytes) {
                        let state = handle.state::<StructuredAgents>();
                        if let Some(running) = state.0.lock().unwrap().as_mut() {
                            if let Some(id) = reply["id"].as_u64() {
                                if let Some(pending) = running.pending.remove(&id) {
                                    let _ = pending.send(reply["value"].clone());
                                }
                            }
                        };
                    }
                }
                CommandEvent::Terminated(_) => break,
                _ => {}
            }
        }
        handle.state::<StructuredAgents>().0.lock().unwrap().take();
        exited.notify_one();
    });
    Ok(())
}

pub async fn call(app: &tauri::AppHandle, mut message: Value) -> Value {
    // OpenCode has separate budgets for process readiness and its startup HTTP phases.
    let seconds = if message["operation"] == "apply"
        && message["request"]["action"] == "start"
        && message["request"]["provider"] == "opencode"
    {
        75
    } else {
        65
    };
    let state = app.state::<StructuredAgents>();
    let (id, rx) = {
        let mut guard = state.0.lock().unwrap();
        let Some(running) = guard.as_mut() else {
            return json!({"status":"unavailable", "reason":"host_unavailable"});
        };
        if running.pending.len() >= 8 || running.sequence >= 9_007_199_254_740_991 {
            return json!({"status":"busy"});
        }
        running.sequence += 1;
        let id = running.sequence;
        message["id"] = id.into();
        let bytes = format!("{message}\n");
        if bytes.len() > 48 * 1024 || running.child.write(bytes.as_bytes()).is_err() {
            return json!({"status":"unavailable", "reason":"host_transport_failed"});
        }
        let (tx, rx) = oneshot::channel();
        running.pending.insert(id, tx);
        (id, rx)
    };
    match tokio::time::timeout(Duration::from_secs(seconds), rx).await {
        Ok(Ok(value)) => value,
        Ok(Err(_)) => json!({"status":"unavailable", "reason":"host_transport_failed"}),
        Err(_) => {
            if let Some(running) = state.0.lock().unwrap().as_mut() {
                running.pending.remove(&id);
            }
            json!({"status":"unavailable", "reason":"host_timeout"})
        }
    }
}

/// Emit only static codes for explicit native actions. Snapshot polling stays out of stderr.
pub fn diagnose_refusal(action: &str, provider: &Value, stage: &str, result: &Value) {
    if result["status"] != "unavailable"
        || std::env::var("ORQST_TAURI_FOCUS_DIAGNOSTICS").as_deref() != Ok("1")
    {
        return;
    }
    let reason = match result["reason"].as_str() {
        Some(reason @ (
            "executable_not_found" | "executable_unreviewed" | "executable_inspection_failed"
            | "workspace_context_unavailable" | "host_unavailable" | "host_transport_failed"
            | "host_timeout" | "session_start_failed" | "operation_failed"
            | "provider_startup_timeout" | "provider_connection_failed" | "provider_session_rejected"
        )) => reason,
        _ => "unknown",
    };
    let provider = match (action, provider.as_str()) {
        ("start", None | Some("codex")) => "codex",
        ("start", Some("opencode")) => "opencode",
        _ => "unspecified",
    };
    eprintln!("ORQST_STRUCTURED_AGENTS action={action} provider={provider} stage={stage} reason={reason}");
}

pub fn stop(app: &tauri::AppHandle) {
    let running = app.state::<StructuredAgents>().0.lock().unwrap().take();
    if let Some(mut running) = running {
        let _ = running.child.write(b"shutdown\n");
        if tauri::async_runtime::block_on(async {
            tokio::time::timeout(Duration::from_secs(6), running.exited.notified()).await
        }).is_err() {
            let _ = running.child.kill();
        }
    }
}
