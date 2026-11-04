//! Native-menu-only preparation. Reuses the passive Node provisioning/selection flow.
//! No renderer command, arbitrary program, CLI invocation or observer API is exposed.
use serde_json::{json, Value};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::menu::{Menu, MenuItem, Submenu};
use tauri::{Manager, WebviewWindow, Window, WindowEvent};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogResult};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

#[derive(Default)]
pub struct Preparation(Mutex<State>);

#[derive(Default)]
struct State {
    generation: u64,
    busy: bool,
    committed: bool,
    opened: bool,
    prepared: Vec<String>,
    child: Option<CommandChild>,
}

impl State {
    fn begin(&mut self, creating: bool, running: bool) -> bool {
        if self.busy || self.opened || running || (creating && self.committed) {
            return false;
        }
        self.busy = true;
        true
    }

    fn commit(&mut self) -> bool {
        if !self.busy || self.committed {
            return false;
        }
        self.committed = true;
        true
    }
}

fn translate(key: &str) -> String {
    let portuguese = std::env::var("LANG")
        .unwrap_or_default()
        .to_lowercase()
        .starts_with("pt");
    let source = if portuguese {
        include_str!("../../../dashboard/src/locales/pt-BR.json")
    } else {
        include_str!("../../../dashboard/src/locales/en-US.json")
    };
    let dictionary: Value = serde_json::from_str(source).expect("validated application locale");
    key.split('.')
        .try_fold(&dictionary, |value, part| value.get(part))
        .and_then(Value::as_str)
        .unwrap_or(key)
        .to_owned()
}

fn create_action(id: &str) -> Option<Value> {
    let (provider, count) = id.strip_prefix("prepare-")?.split_once('-')?;
    let count: u8 = count.parse().ok()?;
    (matches!(provider, "codex" | "claude")
        && (1..=8).contains(&count)
        && id == format!("prepare-{provider}-{count}"))
    .then(|| json!({"action": "create", "provider": provider, "count": count}))
}

pub fn install(app: &tauri::AppHandle) -> tauri::Result<()> {
    let menu = match app.menu() {
        Some(menu) => menu,
        None => Menu::default(app)?,
    };
    let submenu = Submenu::new(app, translate("tauriPreparation.menu"), true)?;
    for provider in ["codex", "claude"] {
        let choices = Submenu::new(
            app,
            translate(&format!("managedTerminal.createProvider_{provider}")),
            true,
        )?;
        for count in 1..=8 {
            choices.append(&MenuItem::with_id(
                app,
                format!("prepare-{provider}-{count}"),
                translate("managedTerminal.createCount").replace("{{count}}", &count.to_string()),
                true,
                None::<&str>,
            )?)?;
        }
        submenu.append(&choices)?;
    }
    submenu.append(&MenuItem::with_id(
        app,
        "prepare-open",
        translate("tauriPreparation.openPrepared"),
        true,
        None::<&str>,
    )?)?;
    menu.append(&submenu)?;
    app.set_menu(menu)?;
    app.on_menu_event(|app, event| {
        let id = event.id().as_ref();
        let Some(window) = app.get_webview_window("main") else {
            return;
        };
        if !window.is_visible().unwrap_or(false) || !window.is_focused().unwrap_or(false) {
            return;
        }
        let request = if id == "prepare-open" {
            let state = app.state::<Preparation>();
            let guard = state.0.lock().unwrap();
            (!guard.prepared.is_empty())
                .then(|| json!({"action": "review", "files": guard.prepared}))
        } else {
            create_action(id)
        };
        let Some(request) = request else { return };
        let Ok(source) = window.url() else { return };
        let generation = {
            let state = app.state::<Preparation>();
            let mut guard = state.0.lock().unwrap();
            if !guard.begin(
                request["action"] == "create",
                crate::terminal::is_running(app),
            ) {
                return;
            }
            guard.generation
        };
        let app = app.clone();
        tauri::async_runtime::spawn_blocking(move || {
            if run(&app, &window, request, source.as_str(), generation).is_err() {
                // Backend errors and selected paths are never printed to logs.
                if window.is_visible().unwrap_or(false)
                    && window.is_focused().unwrap_or(false)
                    && app.state::<Preparation>().0.lock().unwrap().generation == generation
                {
                    app.dialog()
                        .message(translate("tauriPreparation.denied"))
                        .parent(&window)
                        .blocking_show();
                }
            }
            stop(&app);
            app.state::<Preparation>().0.lock().unwrap().busy = false;
        });
    });
    Ok(())
}

fn run(
    app: &tauri::AppHandle,
    window: &WebviewWindow,
    request: Value,
    source: &str,
    generation: u64,
) -> Result<(), Box<dyn std::error::Error>> {
    let deadline = Instant::now() + Duration::from_secs(300);
    // Native modal dialogs temporarily receive focus. Bind to the original visible
    // document and expiry, not the dialog's focus transition. CLI starts retain the
    // separate existing exact-document/focus/one-shot signed authorization.
    let current = || {
        Instant::now() < deadline
            && window.is_visible().unwrap_or(false)
            && window.url().is_ok_and(|url| url.as_str() == source)
            && app.state::<Preparation>().0.lock().unwrap().generation == generation
            && !crate::terminal::is_running(app)
    };
    if !window.is_focused().unwrap_or(false) || !current() {
        return Err("Preparation document unavailable".into());
    }
    let script = app
        .path()
        .resource_dir()?
        .join("core/tauri-terminal-preparation-host.cjs");
    let parent = app.path().app_data_dir()?;
    let (mut rx, child) = app
        .shell()
        .sidecar("orqst-node")?
        .args([
            script.as_os_str(),
            std::ffi::OsStr::new(&request.to_string()),
            parent.as_os_str(),
        ])
        .env_clear()
        .envs(std::env::vars_os().filter(|(key, _)| {
            matches!(
                key.to_str(),
                Some("HOME" | "PATH" | "TMPDIR" | "LANG" | "CODEX_HOME" | "CLAUDE_CONFIG_DIR")
            )
        }))
        .spawn()?;
    app.state::<Preparation>().0.lock().unwrap().child = Some(child);
    let mut complete = None;
    let mut sequence = 0;
    let mut received = 0usize;
    loop {
        let event = tauri::async_runtime::block_on(async {
            tokio::time::timeout(Duration::from_secs(310), rx.recv()).await
        })?;
        match event {
            Some(CommandEvent::Stdout(bytes)) if bytes.len() <= 128 * 1024 => {
                received += bytes.len();
                if received > 512 * 1024 || complete.is_some() || !current() {
                    return Err("Preparation pipe refused".into());
                }
                let value: Value = serde_json::from_slice(&bytes)?;
                if value["kind"] == "complete" {
                    complete = Some(value);
                    continue;
                }
                let id = value["id"].as_u64().ok_or("Invalid dialog sequence")?;
                sequence += 1;
                if id != sequence {
                    return Err("Invalid dialog sequence".into());
                }
                let answer = match value["kind"].as_str() {
                    Some("pick") => {
                        let picker = app
                            .dialog()
                            .file()
                            .set_parent(window)
                            .set_title(field(&value, "title", 1024)?);
                        let selected = if value["directory"] == true {
                            picker.blocking_pick_folder()
                        } else {
                            picker.blocking_pick_file()
                        };
                        selected
                            .and_then(|path| path.into_path().ok())
                            .and_then(|path| path.into_os_string().into_string().ok())
                            .map(Value::String)
                            .unwrap_or(Value::Null)
                    }
                    Some("confirm") => {
                        let approve = field(&value, "approve", 1024)?;
                        let cancel = field(&value, "cancel", 1024)?;
                        let result = app
                            .dialog()
                            .message(format!(
                                "{}\n\n{}",
                                field(&value, "message", 4096)?,
                                field(&value, "detail", 16384)?,
                            ))
                            .parent(window)
                            .title(field(&value, "title", 1024)?)
                            .buttons(MessageDialogButtons::YesNoCancelCustom(
                                cancel.into(),
                                approve.into(),
                                cancel.into(),
                            ))
                            .blocking_show_with_result();
                        json!(
                            matches!(result, MessageDialogResult::Custom(ref text) if text == approve)
                        )
                    }
                    Some("commit") if request["action"] == "create" => {
                        let valid = current();
                        let state = app.state::<Preparation>();
                        let mut guard = state.0.lock().unwrap();
                        let allowed = valid && guard.commit();
                        json!(allowed)
                    }
                    _ => return Err("Unknown preparation request".into()),
                };
                let answer = if current() { answer } else { Value::Null };
                let bytes = format!("{}\n", json!({"id": id, "value": answer}));
                let state = app.state::<Preparation>();
                let mut guard = state.0.lock().unwrap();
                guard
                    .child
                    .as_mut()
                    .ok_or("Preparation child unavailable")?
                    .write(bytes.as_bytes())?;
            }
            Some(CommandEvent::Stderr(_)) => {}
            Some(CommandEvent::Terminated(exit)) if exit.code == Some(0) => break,
            _ => return Err("Preparation host unavailable".into()),
        }
    }
    let result = complete.ok_or("Incomplete preparation")?;
    let files = result["files"]
        .as_array()
        .ok_or("Invalid preparation result")?;
    if result["status"] == "cancelled" && files.is_empty() {
        return Ok(());
    }
    if files.is_empty() || files.len() > 8 {
        return Err("Invalid preparation count".into());
    }
    let files: Vec<String> = files
        .iter()
        .map(|value| {
            value
                .as_str()
                .filter(|path| path.len() <= 2048 && std::path::Path::new(path).is_absolute())
                .map(str::to_owned)
                .ok_or("Invalid preparation file")
        })
        .collect::<Result<_, _>>()?;
    app.state::<Preparation>().0.lock().unwrap().prepared = files.clone();
    if result["status"] == "open" && current() {
        // Latch before entering Core. Never retry uncertain admission, even on failure.
        app.state::<Preparation>().0.lock().unwrap().opened = true;
        if let Err(error) =
            tauri::async_runtime::block_on(crate::terminal::start_selected(app, files))
        {
            crate::terminal::stop(app);
            return Err(error);
        }
    } else if result["status"] != "prepared" {
        return Err("Invalid preparation status".into());
    }
    Ok(())
}

fn field<'a>(value: &'a Value, key: &str, limit: usize) -> Result<&'a str, &'static str> {
    value[key]
        .as_str()
        .filter(|text| text.len() <= limit)
        .ok_or("Invalid native preparation field")
}

pub fn stop(app: &tauri::AppHandle) {
    if let Some(child) = app.state::<Preparation>().0.lock().unwrap().child.take() {
        // This helper never owns a provider, PTY, journal or reservation.
        let _ = child.kill();
    }
}

pub fn invalidate(app: &tauri::AppHandle) {
    let state = app.state::<Preparation>();
    let mut guard = state.0.lock().unwrap();
    guard.generation = guard.generation.wrapping_add(1);
}

fn invalidates_preparation(label: &str, event: &WindowEvent) -> bool {
    match event {
        WindowEvent::Focused(true) => label != "main",
        WindowEvent::CloseRequested { .. } | WindowEvent::Destroyed => label == "main",
        _ => false,
    }
}

pub fn on_window_event(window: &Window, event: &WindowEvent) {
    // Native picker/sheet focus is not a Tauri window transition. A different
    // ORQST surface taking focus must fence the old preparation even after return.
    if invalidates_preparation(window.label(), event) {
        invalidate(window.app_handle());
    }
}

#[cfg(test)]
mod tests {
    use super::{create_action, invalidates_preparation, State};
    use tauri::WindowEvent;

    #[test]
    fn another_native_surface_fences_preparation_without_treating_a_modal_as_blur() {
        assert!(!invalidates_preparation("main", &WindowEvent::Focused(false)));
        assert!(!invalidates_preparation("main", &WindowEvent::Focused(true)));
        for label in ["terminal-workspace", "managed-agents"] {
            assert!(invalidates_preparation(label, &WindowEvent::Focused(true)));
            assert!(!invalidates_preparation(label, &WindowEvent::Focused(false)));
            assert!(!invalidates_preparation(label, &WindowEvent::Destroyed));
        }
        assert!(invalidates_preparation("main", &WindowEvent::Destroyed));
    }

    #[test]
    fn native_latches_keep_cancelled_opening_reviewable_but_never_retry_uncertain_effects() {
        let mut state = State::default();
        assert!(!state.commit());
        assert!(!state.begin(true, true));
        assert!(state.begin(true, false));
        assert!(!state.begin(true, false));
        state.busy = false; // Cancelled before writing: another explicit preparation is safe.
        assert!(state.begin(true, false));
        assert!(state.commit());
        assert!(!state.commit());
        state.busy = false;
        assert!(!state.begin(true, false));
        assert!(state.begin(false, false)); // Completed files may be reviewed again.
        state.opened = true; // Set before entering Core, including a subsequent error.
        state.busy = false;
        assert!(!state.begin(false, false));
        assert!(!state.begin(true, false));
    }

    #[test]
    fn native_creation_actions_are_exact_and_bounded() {
        for provider in ["codex", "claude"] {
            for count in 1..=8 {
                let action = create_action(&format!("prepare-{provider}-{count}")).unwrap();
                assert_eq!(action["provider"], provider);
                assert_eq!(action["count"], count);
            }
        }
        for id in [
            "prepare-codex-0",
            "prepare-codex-9",
            "prepare-codex-01",
            "prepare-claude-+1",
            "prepare-opencode-2",
            "prepare-codex-1-extra",
            "prepare-open",
        ] {
            assert!(create_action(id).is_none());
        }
    }
}
