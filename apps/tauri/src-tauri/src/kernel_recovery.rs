//! Native-only admission recovery. The child carries no independent authority.
use serde_json::{json, Value};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_shell::{process::CommandEvent, ShellExt};

#[derive(Default)]
pub struct KernelRecovery(Mutex<bool>);

pub fn start(app: &tauri::AppHandle) {
    let state = app.state::<KernelRecovery>();
    let mut busy = state.0.lock().unwrap();
    if *busy {
        return;
    }
    *busy = true;
    drop(busy);
    let app = app.clone();
    std::thread::spawn(move || {
        if run(&app).is_err() {
            if let Some(window) = app.get_webview_window("main") {
                let t = crate::desktop::translate;
                app.dialog()
                    .message(t("tauriDesktop.kernelRecoveryUnavailable"))
                    .title(t("tauriDesktop.kernelRecoveryTitle"))
                    .parent(&window)
                    .blocking_show();
            }
        }
        *app.state::<KernelRecovery>().0.lock().unwrap() = false;
    });
}

fn run(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let window = app
        .get_webview_window("main")
        .ok_or("Main window unavailable")?;
    let parent = app.path().app_data_dir()?.canonicalize()?;
    let directory = parent.join("managed-agents").canonicalize()?;
    let script = app
        .path()
        .resource_dir()?
        .join("core/tauri-kernel-release-host.cjs");
    let (mut rx, mut child) = app
        .shell()
        .sidecar("orqst-node")?
        .args([script.as_os_str(), parent.as_os_str()])
        .env_clear()
        .spawn()?;
    let deadline = Instant::now() + Duration::from_secs(300);
    let mut scope: Option<(Value, Value, Value)> = None;
    let mut approved: Option<(Value, Instant)> = None;
    let mut rechecked = false;
    let mut authorized = false;
    let mut complete = false;
    while Instant::now() < deadline {
        let event = tauri::async_runtime::block_on(tokio::time::timeout(
            deadline.saturating_duration_since(Instant::now()),
            rx.recv(),
        ))?;
        let Some(CommandEvent::Stdout(line)) = event else {
            break;
        };
        if line.len() > 256 * 1024 {
            break;
        }
        let frame: Value = serde_json::from_slice(&line)?;
        if frame["kind"] == "complete" {
            complete = true;
            if frame["ok"] == true {
                let t = crate::desktop::translate;
                app.dialog()
                    .message(t("tauriDesktop.kernelRecoveryDone"))
                    .title(t("tauriDesktop.kernelRecoveryTitle"))
                    .parent(&window)
                    .blocking_show();
            }
            if frame["ok"] == false && frame["reason"] != "cancelled" {
                let t = crate::desktop::translate;
                let message = match frame["reason"].as_str() {
                    Some("missing_identity") => t("tauriDesktop.kernelRecoveryMissing"),
                    Some("in_progress") => t("tauriDesktop.kernelRecoveryBusy"),
                    Some("live_processes") => {
                        let mut message = t("tauriDesktop.kernelRecoveryLive");
                        if let Some(processes) =
                            frame["processes"].as_array().filter(|p| p.len() <= 128)
                        {
                            for process in processes {
                                if let (Some(pid), Some(sec), Some(usec), Some(sid)) = (
                                    process["pid"].as_u64(),
                                    process["startSec"].as_u64(),
                                    process["startUsec"].as_u64(),
                                    process["sid"].as_u64(),
                                ) {
                                    message.push_str(&format!(
                                        "\nPID {pid}, start {sec}.{usec:06}, SID {sid}"
                                    ));
                                }
                            }
                        }
                        message
                    }
                    _ => t("tauriDesktop.kernelRecoveryUnavailable"),
                };
                app.dialog()
                    .message(message)
                    .title(t("tauriDesktop.kernelRecoveryTitle"))
                    .parent(&window)
                    .blocking_show();
            }
            break;
        }
        if frame["kind"] != "request" || !crate::features::uuid(&frame["id"]) {
            break;
        }
        let mut answer = Value::Null;
        match frame["operation"].as_str() {
            Some("executor") => {
                answer =
                    crate::terminal_kernel_identity::read_process(std::process::id())?.as_json();
            }
            Some("exists") => {
                if let Some(identity) =
                    crate::terminal_kernel_identity::KernelIdentity::from_json(&frame["identity"])
                {
                    if let Ok(exists) =
                        crate::terminal_kernel_scan::mutation_owner_exists(&identity)
                    {
                        answer = json!(exists);
                    }
                }
            }
            Some("scan") => {
                let identities = frame["identities"].as_array().ok_or("Invalid identities")?;
                let identities = identities
                    .iter()
                    .map(crate::terminal_kernel_identity::KernelIdentity::from_json)
                    .collect::<Option<Vec<_>>>()
                    .ok_or("Invalid identity")?;
                let sessions = frame["sessions"]
                    .as_array()
                    .ok_or("Invalid sessions")?
                    .iter()
                    .map(|v| v.as_u64().and_then(|n| u32::try_from(n).ok()))
                    .collect::<Option<Vec<_>>>()
                    .ok_or("Invalid session")?;
                if let Ok(proof) =
                    crate::terminal_kernel_scan::verify_sessions(&identities, &sessions)
                {
                    answer = json!({"processCount":proof.process_count,"intervalMs":proof.interval_ms,"scans":2});
                    if let Some((old_identities, old_sessions, _)) = &scope {
                        rechecked = approved.is_some()
                            && *old_identities == frame["identities"]
                            && *old_sessions == frame["sessions"];
                    } else {
                        scope = Some((
                            frame["identities"].clone(),
                            frame["sessions"].clone(),
                            answer.clone(),
                        ));
                    }
                } else {
                    let mut live = Vec::new();
                    for identity in &identities {
                        if crate::terminal_kernel_scan::recorded_identity_exists(identity).ok()
                            == Some(true)
                        {
                            if let Ok(current) =
                                crate::terminal_kernel_identity::read_process(identity.pid)
                            {
                                live.push(json!({"pid":current.pid,"startSec":current.start_sec,"startUsec":current.start_usec,"sid":current.sid}));
                            }
                        }
                    }
                    if let Ok(inventory) = crate::terminal_kernel_scan::scan() {
                        for process in inventory.iter().filter(|p| sessions.contains(&p.sid)) {
                            if !live.iter().any(|item| item["pid"] == process.pid) {
                                live.push(json!({"pid":process.pid,"startSec":process.start_sec,"startUsec":process.start_usec,"sid":process.sid}));
                            }
                        }
                    }
                    if !live.is_empty() && live.len() <= 128 {
                        answer = json!({"reason":"live_processes","processes":live});
                    }
                }
            }
            Some("review") => {
                let intent = &frame["intent"];
                if approved.is_none()
                    && scope.as_ref().is_some_and(|(_, sessions, proof)| {
                        intent["domain"] == "orqst.kernel-reservation-release"
                            && intent["version"] == 1
                            && intent["sessions"] == *sessions
                            && intent["scans"] == *proof
                            && intent["limitation"] == "descendants_not_validated"
                            && crate::features::uuid(&intent["operationId"])
                    })
                {
                    let t = crate::desktop::translate;
                    let labels = [
                        t("tauriDesktop.kernelRecoveryTitle"),
                        t("tauriDesktop.kernelRecoveryProof"),
                        format!(
                            "{} {}",
                            t("tauriDesktop.kernelRecoveryCaution"),
                            intent["previousLock"]
                        ),
                        t("tauriDesktop.kernelRecoveryCancel"),
                        t("tauriDesktop.kernelRecoveryRelease"),
                    ];
                    let app_copy = app.clone();
                    let window_copy = window.clone();
                    let native_window = app
                        .get_window("main")
                        .ok_or("Main native window unavailable")?;
                    let accepted =
                        tauri::async_runtime::block_on(crate::terminal::native_consent::confirm(
                            app,
                            native_window,
                            labels,
                            move || {
                                app_copy.get_webview_window("main").is_some_and(|w| {
                                    w.label() == window_copy.label()
                                        && w.is_focused().unwrap_or(false)
                                })
                            },
                        ));
                    if accepted {
                        approved = Some((intent.clone(), Instant::now()));
                    }
                    answer = json!(accepted);
                }
            }
            Some("revalidate") => {
                authorized = rechecked
                    && !authorized
                    && window.is_focused().unwrap_or(false)
                    && approved.as_ref().is_some_and(|(intent, time)| {
                        *intent == frame["intent"] && time.elapsed() < Duration::from_secs(30)
                    });
                answer = json!(authorized);
            }
            Some("rename") => {
                if let Some((intent, time)) = approved.take() {
                    let lock = &frame["lock"];
                    if rechecked
                        && authorized
                        && window.is_focused().unwrap_or(false)
                        && time.elapsed() < Duration::from_secs(30)
                        && lock["id"] == intent["operationId"]
                        && lock["marker"] == intent["marker"]
                        && lock["destination"] == intent["destination"]
                        && lock.get("previousRecovery").unwrap_or(&Value::Null)
                            == &intent["previousRecovery"]
                    {
                        let marker = &lock["marker"];
                        let expected = crate::terminal_kernel_rename::MarkerIdentity {
                            dev: marker["dev"].as_str().ok_or("Invalid device")?.parse()?,
                            inode: marker["inode"].as_str().ok_or("Invalid inode")?.parse()?,
                            sha256: marker["sha256"]
                                .as_str()
                                .ok_or("Invalid digest")?
                                .to_owned(),
                        };
                        answer = json!(crate::terminal_kernel_rename::rename_marker(
                            &directory,
                            lock["destination"].as_str().ok_or("Invalid destination")?,
                            &expected
                        )
                        .is_ok());
                    }
                }
            }
            _ => break,
        }
        child.write(
            format!(
                "{}\n",
                json!({"kind":"reply","id":frame["id"],"value":answer})
            )
            .as_bytes(),
        )?;
    }
    if !complete {
        let t = crate::desktop::translate;
        app.dialog()
            .message(t("tauriDesktop.kernelRecoveryUnavailable"))
            .title(t("tauriDesktop.kernelRecoveryTitle"))
            .parent(&window)
            .blocking_show();
    }
    Ok(())
}
