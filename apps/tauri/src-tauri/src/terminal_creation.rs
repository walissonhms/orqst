//! Native menu and Studio preparation reuse the same passive Node provisioning/selection flow.
//! No arbitrary program, CLI invocation or observer API is exposed.
use crate::local_diagnostics::{Attempt, Effects, Outcome, Stage};
use serde_json::{json, Value};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::menu::{Menu, MenuItem, Submenu};
use tauri::{Manager, Webview, WebviewWindow, Window, WindowEvent};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogResult};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

#[derive(Clone, Copy)]
enum ReviewChoice {
    Approve,
    Details,
    Back,
    Cancel,
}

// Details are read-only and can never approve. Returning always requires the summary again.
fn confirm_review(current: impl Fn() -> bool, mut show: impl FnMut(bool) -> ReviewChoice) -> bool {
    while current() {
        match show(false) {
            ReviewChoice::Approve => return current(),
            ReviewChoice::Details if current() => {
                if !matches!(show(true), ReviewChoice::Back) {
                    return false;
                }
            }
            _ => return false,
        }
    }
    false
}

#[derive(Default)]
pub struct Preparation(Mutex<State>);

#[derive(Default)]
struct State {
    generation: u64,
    origin: String,
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
        if let Some(generation) = begin(app, &request, None) {
            let app = app.clone();
            tauri::async_runtime::spawn_blocking(move || {
                let _ = execute(&app, &window, request, source.as_str(), generation, true);
            });
        }
    });
    Ok(())
}

fn exact(value: &Value, keys: &[&str]) -> bool {
    value
        .as_object()
        .is_some_and(|v| v.len() == keys.len() && keys.iter().all(|k| v.contains_key(*k)))
}
fn valid_request(value: &Value) -> bool {
    let generation = value["generation"]
        .as_u64()
        .is_some_and(|n| n <= 9_007_199_254_740_991);
    match value["action"].as_str() {
        Some("snapshot") => exact(value, &["action"]),
        Some("catalog") => exact(value, &["action", "workspaceId", "featureId"]) && scope(value),
        Some("create-mcp-pair") => {
            exact(
                value,
                &[
                    "action",
                    "generation",
                    "workspaceId",
                    "featureId",
                    "catalogId",
                    "sourceProvider",
                    "codexModelId",
                    "openCodeModelId",
                ],
            ) && generation
                && scope(value)
                && digest(&value["catalogId"])
                && digest(&value["codexModelId"])
                && digest(&value["openCodeModelId"])
                && matches!(value["sourceProvider"].as_str(), Some("codex" | "opencode"))
        }
        Some("create-selected") => {
            exact(
                value,
                &[
                    "action",
                    "generation",
                    "workspaceId",
                    "featureId",
                    "catalogId",
                    "provider",
                    "modelId",
                    "count",
                ],
            ) && generation
                && scope(value)
                && digest(&value["catalogId"])
                && digest(&value["modelId"])
                && matches!(
                    value["provider"].as_str(),
                    Some("codex" | "claude" | "opencode")
                )
                && value["count"]
                    .as_u64()
                    .is_some_and(|n| (1..=8).contains(&n))
        }
        Some("review") => exact(value, &["action", "generation"]) && generation,
        Some("create") => {
            exact(value, &["action", "generation", "provider", "count"])
                && generation
                && matches!(value["provider"].as_str(), Some("codex" | "claude"))
                && value["count"]
                    .as_u64()
                    .is_some_and(|n| (1..=8).contains(&n))
        }
        _ => false,
    }
}
fn scope(value: &Value) -> bool {
    crate::features::workspace_id(&value["workspaceId"])
        && (value["featureId"].is_null() || crate::features::uuid(&value["featureId"]))
}
fn digest(value: &Value) -> bool {
    value.as_str().is_some_and(|s| {
        s.len() == 64
            && s.bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    })
}
fn valid_catalog(value: &Value, request: &Value) -> bool {
    exact(
        value,
        &[
            "contractVersion",
            "workspaceId",
            "featureId",
            "catalogId",
            "providers",
        ],
    ) && value["contractVersion"] == 1
        && scope(value)
        && value["workspaceId"] == request["workspaceId"]
        && value["featureId"] == request["featureId"]
        && digest(&value["catalogId"])
        && value["providers"].as_array().is_some_and(|providers| {
            providers.len() == 3
                && ["codex", "claude", "opencode"]
                    .iter()
                    .all(|id| providers.iter().filter(|p| p["provider"] == *id).count() == 1)
                && providers.iter().all(|p| {
                    exact(p, &["provider", "status", "reason", "models"])
                        && matches!(p["status"].as_str(), Some("available" | "unavailable"))
                        && matches!(
                            p["reason"].as_str(),
                            Some(
                                "ready"
                                    | "executable_not_found"
                                    | "ambiguous_executable"
                                    | "catalog_limited"
                            )
                        )
                        && p["models"].as_array().is_some_and(|models| {
                            models.len() <= 128
                                && models.iter().all(|m| {
                                    exact(
                                        m,
                                        &["id", "label", "source", "isDefault", "availability"],
                                    ) && digest(&m["id"])
                                        && m["label"].as_str().is_some_and(|s| {
                                            !s.is_empty() && s.encode_utf16().count() <= 160
                                        })
                                        && matches!(
                                            m["source"].as_str(),
                                            Some(
                                                "cli-default"
                                                    | "native-config"
                                                    | "cli-cache"
                                                    | "official-alias"
                                                    | "native-state"
                                            )
                                        )
                                        && m["isDefault"].is_boolean()
                                        && m["availability"] == "unverified"
                                })
                        })
                })
        })
}
fn document_matches(label: &str, parent: &str, source: &str, origin: &str) -> bool {
    let Ok(url) = tauri::Url::parse(source) else {
        return false;
    };
    label == "main"
        && parent == "main"
        && url.origin().ascii_serialization() == origin
        && matches!(url.path(), "/" | "/studio")
        && url.username().is_empty()
        && url.password().is_none()
        && url.query().is_none()
        && url.fragment().is_none()
}
// The URL getter may wait for the UI thread. Never retain Preparation across it.
fn identity_from(
    state: &Mutex<State>,
    read_source: impl FnOnce() -> Option<String>,
    matches: impl FnOnce(&str, &str) -> bool,
) -> Option<(String, u64)> {
    let expected = {
        let guard = state.lock().unwrap();
        (guard.origin.clone(), guard.generation)
    };
    let source = read_source()?;
    let guard = state.lock().unwrap();
    (guard.origin == expected.0
        && guard.generation == expected.1
        && matches(&source, &guard.origin))
    .then_some((source, expected.1))
}
fn identity(view: &Webview) -> Option<(String, u64)> {
    let parent = view.window();
    identity_from(
        &view.state::<Preparation>().0,
        || view.url().ok().map(|url| url.to_string()),
        |source, origin| document_matches(view.label(), parent.label(), source, origin),
    )
}
/// Passive navigation cannot overlap the native preparation helper or its review.
pub(crate) fn navigation_available(app: &tauri::AppHandle) -> bool {
    !app.state::<Preparation>().0.lock().unwrap().busy
}
fn snapshot(app: &tauri::AppHandle) -> Value {
    let running = crate::terminal::is_running(app);
    let blocked = crate::terminal::presentation_blocked(app);
    let state = app.state::<Preparation>();
    let guard = state.0.lock().unwrap();
    let available = !blocked
        && !guard.busy
        && if running {
            crate::terminal::enrollment_available(app)
        } else {
            !guard.opened
        };
    json!({"generation":guard.generation, "limit":8, "count":guard.prepared.len(), "liveEnrollment":running,
        "busy":guard.busy || blocked, "canCreate":available && !guard.committed,
        "canReview":available && !running && !guard.prepared.is_empty(), "selectionLocked":if running { !available } else { guard.opened }})
}
/// The same atomic latches protect native menu and Studio, including uncertain writes/admission.
fn begin(app: &tauri::AppHandle, request: &Value, expected: Option<u64>) -> Option<u64> {
    if crate::terminal::presentation_blocked(app) {
        return None;
    }
    let running = crate::terminal::is_running(app);
    let incremental = running
        && matches!(
            request["action"].as_str(),
            Some("catalog" | "create-selected")
        );
    if running
        && (!incremental
            || !crate::terminal::enrollment_available(app)
            || (request["action"] == "create-selected" && request["count"] != 1))
    {
        return None;
    }
    let state = app.state::<Preparation>();
    let mut guard = state.0.lock().unwrap();
    if expected.is_some_and(|generation| generation != guard.generation)
        || if incremental {
            if guard.busy || guard.committed {
                true
            } else {
                guard.busy = true;
                false
            }
        } else {
            !guard.begin(
                matches!(
                    request["action"].as_str(),
                    Some("create" | "create-selected" | "create-mcp-pair")
                ),
                running,
            )
        }
    {
        return None;
    }
    Some(guard.generation)
}
/// Only fixed identifiers cross back to the renderer/dialog. No raw host or Core error is shown.
#[derive(Clone, Debug)]
struct PreparationFailure(Value);
impl std::fmt::Display for PreparationFailure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Terminal preparation failed")
    }
}
impl std::error::Error for PreparationFailure {}

fn preparation_failure(value: &Value, committed: bool) -> Option<PreparationFailure> {
    if !exact(value, &["stage", "code", "effects"])
        || !matches!(
            value["stage"].as_str(),
            Some(
                "bootstrap"
                    | "request"
                    | "catalog"
                    | "selection"
                    | "plan"
                    | "review"
                    | "revalidation"
                    | "commit"
                    | "provision"
                    | "inspection"
                    | "feature_assignment"
                    | "opening"
                    | "admission_preflight"
                    | "core_admission"
                    | "core_startup"
            )
        )
        || !matches!(
            value["code"].as_str(),
            Some(
                "failed"
                    | "catalog_changed"
                    | "selection_unavailable"
                    | "capacity_exceeded"
                    | "review_too_large"
                    | "selection_blocked"
                    | "capacity_reserved"
                    | "admission_invalid"
                    | "startup_failed"
                    | "startup_timeout"
                    | "startup_eof"
                    | "startup_protocol"
            )
        )
        || !matches!(value["effects"].as_str(), Some("not_started" | "possible"))
        || (value["effects"] == "not_started"
            && value["code"]
                .as_str()
                .is_some_and(|code| code.starts_with("startup_")))
        || (value["effects"] == "not_started"
            && matches!(
                value["stage"].as_str(),
                Some(
                    "bootstrap"
                        | "provision"
                        | "inspection"
                        | "feature_assignment"
                        | "opening"
                        | "core_admission"
                        | "core_startup"
                )
            ))
    {
        return None;
    }
    let mut safe = value.clone();
    // Native evidence wins over helper claims after a possible write/open boundary.
    if committed {
        safe["effects"] = json!("possible");
    }
    Some(PreparationFailure(safe))
}

fn unknown_failure(stage: &str) -> PreparationFailure {
    PreparationFailure(json!({"stage":stage,"code":"failed","effects":"possible"}))
}

/// Strict private-host failure: no raw errors, paths, ownership or stderr cross to Studio.
pub(crate) fn startup_failure(value: &Value, id: &str) -> Option<Box<dyn std::error::Error>> {
    if !exact(value, &["kind", "id", "failure"])
        || value["kind"] != "failure"
        || value["id"] != id
        || !matches!(
            value["failure"]["stage"].as_str(),
            Some("core_admission" | "core_startup")
        )
        || value["failure"]["effects"] != "possible"
        || !matches!(
            value["failure"]["code"].as_str(),
            Some(
                "capacity_reserved"
                    | "admission_invalid"
                    | "startup_failed"
                    | "startup_timeout"
                    | "startup_eof"
                    | "startup_protocol"
            )
        )
    {
        return None;
    }
    preparation_failure(&value["failure"], true)
        .map(|failure| Box::new(failure) as Box<dyn std::error::Error>)
}
pub(crate) fn startup_error(code: &str) -> Box<dyn std::error::Error> {
    Box::new(PreparationFailure(
        json!({"stage":"core_startup", "code":code, "effects":"possible"}),
    ))
}

/// Project only the existing typed failure; never classify or persist an error string.
pub(crate) fn record_failure(
    diagnostic: &Attempt,
    error: &(dyn std::error::Error + 'static),
    fallback: Stage,
) {
    if let Some(failure) = error.downcast_ref::<PreparationFailure>() {
        diagnostic.record(
            Stage::parse(failure.0["stage"].as_str().unwrap_or("")),
            Outcome::parse(failure.0["code"].as_str().unwrap_or("")),
            Effects::parse(failure.0["effects"].as_str().unwrap_or("")),
        );
    } else {
        diagnostic.record(fallback, Outcome::Uncertain, Effects::Possible);
    }
}

fn execute(
    app: &tauri::AppHandle,
    window: &WebviewWindow,
    request: Value,
    source: &str,
    generation: u64,
    native_notice: bool,
) -> Value {
    let diagnostic = Attempt::begin();
    let mut stage = "bootstrap";
    let result = run(
        app,
        window,
        request,
        source,
        generation,
        &mut stage,
        &diagnostic,
    );
    let failure = result.as_ref().err().map(|error| {
        error
            .downcast_ref::<PreparationFailure>()
            .cloned()
            .unwrap_or_else(|| unknown_failure(stage))
    });
    let succeeded = result.is_ok();
    if let Some(failure) = &failure {
        record_failure(&diagnostic, failure, Stage::parse(stage));
    } else {
        diagnostic.record(Stage::Attempt, Outcome::Succeeded, Effects::Unconfirmed);
    }
    // Completion never waits for dismissal of an informational error sheet. Sticky
    // committed/opened and Core ownership remain untouched.
    stop(app);
    app.state::<Preparation>().0.lock().unwrap().busy = false;
    if native_notice
        && !succeeded
        && window.is_visible().unwrap_or(false)
        && window.is_focused().unwrap_or(false)
        && app.state::<Preparation>().0.lock().unwrap().generation == generation
    {
        app.dialog()
            .message(
                failure
                    .as_ref()
                    .map(|failure| {
                        // Short localised outcome and reason. The stage stays in the in-window
                        // notice, so one failure never raises a multi-paragraph native sheet.
                        format!(
                            "{}\n\n{}",
                            translate(if failure.0["effects"] == "not_started" {
                                "tauriPreparation.failure_not_started"
                            } else {
                                "tauriPreparation.failure_possible"
                            }),
                            translate(&format!(
                                "tauriPreparation.code_{}",
                                failure.0["code"].as_str().unwrap()
                            )),
                        )
                    })
                    .unwrap_or_else(|| translate("tauriPreparation.denied")),
            )
            .parent(window)
            .show(|_| {});
    }
    match result {
        Ok(value) => value,
        Err(_) => json!({"status":"denied", "failure":failure.unwrap().0}),
    }
}
#[tauri::command]
pub async fn studio_request(window: Webview, request: Value) -> Value {
    let denied = || json!({"status":"denied"});
    if !valid_request(&request) {
        return denied();
    }
    let Some((source, generation)) = identity(&window) else {
        return denied();
    };
    let app = window.app_handle().clone();
    if request["action"] == "snapshot" {
        return json!({"status":"ok", "snapshot":snapshot(&app)});
    }
    // Reuse the actual AppKit Webview first-responder check; JS activation is not authority.
    if request["action"] != "catalog" && !crate::features::focused(&window).await {
        return json!({"status":"focus_required"});
    }
    if identity(&window) != Some((source.clone(), generation))
        || (request["action"] != "catalog" && request["generation"].as_u64() != Some(generation))
    {
        return denied();
    }
    let Some(parent) = app.get_webview_window("main") else {
        return denied();
    };
    let native_request = if request["action"] == "review" {
        let files = app
            .state::<Preparation>()
            .0
            .lock()
            .unwrap()
            .prepared
            .clone();
        if files.is_empty() {
            return denied();
        }
        json!({"action":"review", "files":files})
    } else if matches!(
        request["action"].as_str(),
        Some("catalog" | "create-selected" | "create-mcp-pair")
    ) {
        let mut native = request.clone();
        native.as_object_mut().unwrap().remove("generation");
        native
    } else {
        json!({"action":"create", "provider":request["provider"], "count":request["count"]})
    };
    if begin(&app, &native_request, Some(generation)).is_none() {
        let current = snapshot(&app);
        return json!({"status":if current["busy"] == true { "busy" } else { "denied" }, "snapshot":current});
    }
    // Once admitted, the native task owns completion even if the JS invocation disappears.
    let native_app = app.clone();
    let native_source = source.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        execute(
            &native_app,
            &parent,
            native_request,
            &native_source,
            generation,
            false,
        )
    })
    .await;
    if identity(&window) != Some((source, generation)) {
        return denied();
    }
    match result {
        Ok(value) if value["status"] == "catalog" => value,
        Ok(value) if value["status"] == "denied" => {
            json!({"status":"denied", "failure":value["failure"], "snapshot":snapshot(&app)})
        }
        Ok(_) => json!({"status":"ok", "snapshot":snapshot(&app)}),
        _ => json!({"status":"unavailable", "snapshot":snapshot(&app)}),
    }
}
pub fn configure(
    app: &tauri::AppHandle,
    origin: &str,
) -> Result<String, Box<dyn std::error::Error>> {
    #[cfg(target_os = "macos")]
    if !crate::terminal::install_quit_observer(app) {
        return Err("Preparation focus observer unavailable".into());
    }
    app.state::<Preparation>().0.lock().unwrap().origin = origin.into();
    app.add_capability(
        tauri::ipc::CapabilityBuilder::new("studio-native-preparation")
            .local(false)
            .remote(format!("{origin}/"))
            .remote(format!("{origin}/studio"))
            .webview("main")
            .permission("allow-studio-request"),
    )?;
    let client = std::fs::read_to_string(app.path().resource_dir()?.join("features/studio.js"))?;
    Ok(format!(
        "if(location.origin === {}) {{\n{client}\n}}",
        json!(origin)
    ))
}
/// Called on the AppKit thread by the existing process-lifetime observer.
#[cfg(target_os = "macos")]
pub(crate) fn native_key_changed(app: &tauri::AppHandle) {
    if !app.state::<Preparation>().0.lock().unwrap().busy {
        return;
    }
    let owned = app
        .get_window("main")
        .and_then(|window| crate::terminal::quit_window_focus(&window))
        .is_some_and(|focus| focus.0);
    if !owned {
        invalidate(app);
    }
}

fn run(
    app: &tauri::AppHandle,
    window: &WebviewWindow,
    request: Value,
    source: &str,
    generation: u64,
    stage: &mut &str,
    diagnostic: &Attempt,
) -> Result<Value, Box<dyn std::error::Error>> {
    let deadline = Instant::now() + Duration::from_secs(300);
    let admission = crate::terminal::preparation_admission(app)?;
    // Native modal dialogs temporarily receive focus. Bind to the original visible
    // document and expiry, not the dialog's focus transition. CLI starts retain the
    // separate existing exact-document/focus/one-shot signed authorization.
    let current = || {
        Instant::now() < deadline
            && window.is_visible().unwrap_or(false)
            && window.url().is_ok_and(|url| url.as_str() == source)
            && app.state::<Preparation>().0.lock().unwrap().generation == generation
            && (!crate::terminal::is_running(app)
                || (matches!(
                    request["action"].as_str(),
                    Some("catalog" | "create-selected")
                ) && crate::terminal::enrollment_available(app)))
            && !crate::terminal::presentation_blocked(app)
            && crate::terminal::preparation_admission_current(app, &admission)
    };
    if !window.is_focused().unwrap_or(false) || !current() {
        return Err("Preparation document unavailable".into());
    }
    let script = app
        .path()
        .resource_dir()?
        .join("core/tauri-terminal-preparation-host.cjs");
    let parent = app.path().app_data_dir()?;
    // Both paths come from the owned bootstrap, never from a renderer-provided cwd.
    let trusted = json!({"observerDatabase":parent.join("core/orqst.db"), "preferencesDirectory":preferences_directory(&parent)?}).to_string();
    let admission_context = admission
        .as_ref()
        .map(|value| value.context())
        .unwrap_or(Value::Null)
        .to_string();
    let unsupported_opencode = [
        "OPENCODE_CONFIG",
        "OPENCODE_CONFIG_CONTENT",
        "OPENCODE_TEST_HOME",
    ]
    .iter()
    .any(|key| std::env::var_os(key).is_some());
    if (request["provider"] == "opencode" || request["action"] == "create-mcp-pair")
        && unsupported_opencode
    {
        return Err("Unsupported native OpenCode configuration selector".into());
    }
    diagnostic.record(Stage::HelperSpawn, Outcome::Requested, Effects::Unconfirmed);
    let (mut rx, child) = app
        .shell()
        .sidecar("orqst-node")?
        .args([
            script.as_os_str(),
            std::ffi::OsStr::new(&request.to_string()),
            parent.as_os_str(),
            std::ffi::OsStr::new(&trusted),
            std::ffi::OsStr::new(&admission_context),
        ])
        .env_clear()
        .envs(std::env::vars_os().filter(|(key, _)| {
            matches!(
                key.to_str(),
                Some(
                    "HOME"
                        | "PATH"
                        | "TMPDIR"
                        | "LANG"
                        | "CODEX_HOME"
                        | "CLAUDE_CONFIG_DIR"
                        | "XDG_CONFIG_HOME"
                        | "XDG_DATA_HOME"
                        | "XDG_STATE_HOME"
                        | "XDG_CACHE_HOME"
                        | "OPENCODE_CONFIG_DIR"
                        | "OPENCODE_DB"
                )
            )
        }))
        .spawn()?;
    diagnostic.record(Stage::HelperSpawn, Outcome::Started, Effects::Unconfirmed);
    app.state::<Preparation>().0.lock().unwrap().child = Some(child);
    *stage = "request";
    let mut complete = None;
    let mut sequence = 0;
    let mut received = 0usize;
    loop {
        let event = tauri::async_runtime::block_on(async {
            tokio::time::timeout(Duration::from_secs(310), rx.recv()).await
        })
        .inspect_err(|_| {
            diagnostic.record(Stage::HelperStream, Outcome::Timeout, Effects::Unconfirmed);
        })?;
        match event {
            Some(CommandEvent::Stdout(bytes)) if bytes.len() <= 128 * 1024 => {
                received += bytes.len();
                if received > 512 * 1024 || complete.is_some() || !current() {
                    return Err("Preparation pipe refused".into());
                }
                let value: Value = serde_json::from_slice(&bytes).inspect_err(|_| {
                    diagnostic.record(
                        Stage::HelperStream,
                        Outcome::ProtocolRejected,
                        Effects::Unconfirmed,
                    );
                })?;
                if value["kind"] == "failure" {
                    if !exact(&value, &["kind", "failure"]) {
                        return Err("Invalid preparation failure".into());
                    }
                    let state = app.state::<Preparation>();
                    let guard = state.0.lock().unwrap();
                    return Err(preparation_failure(
                        &value["failure"],
                        guard.committed || guard.opened,
                    )
                    .ok_or("Invalid preparation failure")?
                    .into());
                }
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
                        diagnostic.record(Stage::Review, Outcome::Requested, Effects::Unconfirmed);
                        *stage = "review";
                        let approve = field(&value, "approve", 1024)?;
                        let cancel = field(&value, "cancel", 1024)?;
                        let title = field(&value, "title", 1024)?;
                        let message = field(&value, "message", 4096)?;
                        let detail = field(&value, "detail", 16384)?;
                        let summary = value
                            .get("summary")
                            .map(|_| field(&value, "summary", 4096))
                            .transpose()?;
                        let accepted = if let Some(summary) = summary {
                            let details = field(&value, "details", 1024)?;
                            let back = field(&value, "back", 1024)?;
                            confirm_review(current, |full| {
                                let (body, buttons) = if full {
                                    (
                                        detail.to_owned(),
                                        MessageDialogButtons::OkCancelCustom(
                                            back.into(),
                                            cancel.into(),
                                        ),
                                    )
                                } else {
                                    (
                                        format!("{summary}\n\n{message}"),
                                        MessageDialogButtons::YesNoCancelCustom(
                                            cancel.into(),
                                            approve.into(),
                                            details.into(),
                                        ),
                                    )
                                };
                                let result = app
                                    .dialog()
                                    .message(body)
                                    .parent(window)
                                    .title(title)
                                    .buttons(buttons)
                                    .blocking_show_with_result();
                                match result {
                                    MessageDialogResult::Custom(text) if full && text == back => {
                                        ReviewChoice::Back
                                    }
                                    MessageDialogResult::Custom(text)
                                        if !full && text == details =>
                                    {
                                        ReviewChoice::Details
                                    }
                                    MessageDialogResult::Custom(text)
                                        if !full && text == approve =>
                                    {
                                        ReviewChoice::Approve
                                    }
                                    _ => ReviewChoice::Cancel,
                                }
                            })
                        } else {
                            let body = if detail.is_empty() {
                                message.to_owned()
                            } else {
                                format!("{message}\n\n{detail}")
                            };
                            let result = app
                                .dialog()
                                .message(body)
                                .parent(window)
                                .title(title)
                                .buttons(MessageDialogButtons::YesNoCancelCustom(
                                    cancel.into(),
                                    approve.into(),
                                    cancel.into(),
                                ))
                                .blocking_show_with_result();
                            matches!(result, MessageDialogResult::Custom(ref text) if text == approve)
                        };
                        diagnostic.record(
                            Stage::Review,
                            if accepted {
                                Outcome::Approved
                            } else {
                                Outcome::Declined
                            },
                            Effects::Unconfirmed,
                        );
                        json!(accepted)
                    }
                    Some("commit")
                        if matches!(
                            request["action"].as_str(),
                            Some("create" | "create-selected" | "create-mcp-pair")
                        ) =>
                    {
                        let valid = current();
                        let state = app.state::<Preparation>();
                        let mut guard = state.0.lock().unwrap();
                        let allowed = valid && guard.commit();
                        if allowed {
                            *stage = "provision";
                        }
                        diagnostic.record(
                            Stage::Commit,
                            if allowed {
                                Outcome::Allowed
                            } else {
                                Outcome::Refused
                            },
                            if allowed {
                                Effects::Possible
                            } else {
                                Effects::Unconfirmed
                            },
                        );
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
            Some(CommandEvent::Terminated(exit)) if exit.code == Some(0) => {
                diagnostic.record(
                    Stage::HelperComplete,
                    Outcome::Succeeded,
                    Effects::Unconfirmed,
                );
                break;
            }
            _ => {
                diagnostic.record(
                    Stage::HelperStream,
                    Outcome::Uncertain,
                    Effects::Unconfirmed,
                );
                return Err("Preparation host unavailable".into());
            }
        }
    }
    *stage = if request["action"] == "catalog" {
        "catalog"
    } else {
        "inspection"
    };
    let mut result = complete.ok_or("Incomplete preparation")?;
    if request["action"] == "catalog" {
        if result["status"] != "catalog" || !valid_catalog(&result["catalog"], &request) {
            return Err("Invalid scoped catalog".into());
        }
        if unsupported_opencode {
            // Do not forward config content/test-home or silently ignore their
            // presence. Other providers remain independently usable.
            for provider in result["catalog"]["providers"].as_array_mut().unwrap() {
                if provider["provider"] == "opencode" {
                    provider["status"] = json!("unavailable");
                    provider["reason"] = json!("catalog_limited");
                    provider["models"] = json!([]);
                }
            }
        }
        return Ok(json!({"status":"catalog", "catalog":result["catalog"]}));
    }
    let files = result["files"]
        .as_array()
        .ok_or("Invalid preparation result")?;
    if result["status"] == "cancelled" && files.is_empty() {
        diagnostic.record(
            Stage::HelperComplete,
            Outcome::Cancelled,
            Effects::Unconfirmed,
        );
        return Ok(json!({"status":"ok"}));
    }
    if files.is_empty()
        || files.len() > 8
        || (request["action"] == "create-mcp-pair" && files.len() != 2)
    {
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
    if result["status"] == "open" && !current() {
        return Err("Preparation context changed; no runtime dispatched".into());
    }
    if result["status"] == "open" && current() {
        *stage = "opening";
        diagnostic.record(Stage::Opening, Outcome::Requested, Effects::Possible);
        // Latch before entering Core. Never retry uncertain admission, even on failure.
        app.state::<Preparation>().0.lock().unwrap().opened = true;
        let live_enrollment = admission.is_some();
        let opened = if live_enrollment {
            if request["action"] != "create-selected" || files.len() != 1 {
                return Err("Native enrollment requires one selected member".into());
            }
            tauri::async_runtime::block_on(crate::terminal::enroll_selected(
                app,
                &files[0],
                result["previousLayout"].clone(),
                admission.as_ref().unwrap(),
                diagnostic,
            ))
        } else {
            tauri::async_runtime::block_on(crate::terminal::start_selected_with_open(
                app,
                files,
                matches!(
                    request["action"].as_str(),
                    Some("create-selected" | "create-mcp-pair")
                ),
                diagnostic,
            ))
        };
        if let Err(error) = opened {
            // Only a confirmed pre-effect refusal may release the creation latch.
            // Files/Feature metadata remain as evidence; no original operation is retried.
            if live_enrollment && crate::terminal::preparation_admission_current(app, &admission) {
                let state = app.state::<Preparation>();
                let mut guard = state.0.lock().unwrap();
                guard.committed = false;
                guard.opened = false;
            }
            // The existing Core, PTYs and documents survive rejected/uncertain additions.
            return Err(error);
        }
        let state = app.state::<Preparation>();
        let mut guard = state.0.lock().unwrap();
        guard.prepared.clear();
        guard.committed = false;
        guard.opened = false;
    } else if result["status"] != "prepared" {
        return Err("Invalid preparation status".into());
    }
    Ok(json!({"status":"ok"}))
}

fn field<'a>(value: &'a Value, key: &str, limit: usize) -> Result<&'a str, &'static str> {
    value[key]
        .as_str()
        .filter(|text| text.len() <= limit)
        .ok_or("Invalid native preparation field")
}

fn preferences_directory(
    parent: &std::path::Path,
) -> Result<std::path::PathBuf, Box<dyn std::error::Error>> {
    let path = parent.join("managed-agents");
    let mut builder = std::fs::DirBuilder::new();
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    match builder.create(&path) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(error) => return Err(error.into()),
    }
    let metadata = std::fs::symlink_metadata(&path)?;
    if !metadata.is_dir()
        || metadata.file_type().is_symlink()
        || std::fs::canonicalize(&path)? != path
    {
        return Err("Unsafe native preferences directory".into());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::{MetadataExt, PermissionsExt};
        if metadata.permissions().mode() & 0o077 != 0
            || metadata.uid() != std::fs::metadata(parent)?.uid()
        {
            return Err("Unsafe native preferences ownership".into());
        }
    }
    Ok(path)
}

/// Any selection entering Core, including startup configuration, is single-use.
/// Signed retirement does not prove that old native webview callbacks were removed.
pub fn fence_selection(app: &tauri::AppHandle) {
    let state = app.state::<Preparation>();
    let mut guard = state.0.lock().unwrap();
    guard.opened = true;
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
    use super::{create_action, document_matches, invalidates_preparation, valid_request, State};
    use serde_json::json;
    use tauri::WindowEvent;

    #[test]
    fn failure_contract_is_bounded_and_native_commit_evidence_cannot_be_downgraded() {
        let before =
            json!({"stage":"revalidation","code":"catalog_changed","effects":"not_started"});
        assert_eq!(
            super::preparation_failure(&before, false).unwrap().0,
            before
        );
        assert_eq!(
            super::preparation_failure(&before, true).unwrap().0["effects"],
            "possible"
        );
        for stage in [
            "bootstrap",
            "provision",
            "inspection",
            "feature_assignment",
            "opening",
        ] {
            let invalid = json!({"stage":stage,"code":"failed","effects":"not_started"});
            assert!(super::preparation_failure(&invalid, false).is_none());
        }
        for key in [
            "stderr", "message", "path", "config", "proof", "token", "retry",
        ] {
            let mut extra = before.clone();
            extra[key] = json!("SYNTHETIC");
            assert!(super::preparation_failure(&extra, false).is_none());
        }
        for stage in ["bootstrap", "request", "review", "provision", "opening"] {
            let failure = super::unknown_failure(stage);
            assert_eq!(failure.0["effects"], "possible");
            assert_eq!(failure.0["code"], "failed");
        }
    }

    #[test]
    fn startup_reason_is_correlated_and_never_downgrades_unknown_effects() {
        let id = "startup-1";
        let value = json!({"kind":"failure", "id":id, "failure":{"stage":"core_admission", "code":"capacity_reserved", "effects":"possible"}});
        assert!(super::startup_failure(&value, id).is_some());
        assert!(super::startup_failure(&value, "startup-2").is_none());
        let mut invalid = value.clone();
        invalid["failure"]["effects"] = json!("not_started");
        assert!(super::startup_failure(&invalid, id).is_none());
        invalid = value.clone();
        invalid["failure"]["message"] = json!("SYNTHETIC PRIVATE");
        assert!(super::startup_failure(&invalid, id).is_none());
        assert!(super::preparation_failure(&json!({"stage":"admission_preflight","code":"startup_timeout","effects":"not_started"}), false).is_none());
        let preflight = json!({"stage":"admission_preflight","code":"capacity_reserved","effects":"not_started"});
        assert_eq!(
            super::preparation_failure(&preflight, true).unwrap().0["effects"],
            "possible"
        );
    }

    #[test]
    fn studio_requests_are_strict_bounded_and_cannot_supply_native_authority() {
        assert!(valid_request(&json!({"action":"snapshot"})));
        assert!(valid_request(&json!({"action":"review","generation":3})));
        for provider in ["codex", "claude"] {
            for count in 1..=8 {
                assert!(valid_request(
                    &json!({"action":"create","generation":3,"provider":provider,"count":count})
                ));
            }
        }
        for request in [
            json!({"action":"createMixed"}),
            json!({"action":"start"}),
            json!({"action":"review","generation":3,"files":["/SYNTHETIC"]}),
            json!({"action":"create","generation":3,"provider":"opencode","count":2}),
            json!({"action":"create","generation":3,"provider":"codex","count":9}),
            json!({"action":"create","generation":3,"provider":"codex","count":0}),
            json!({"action":"create","generation":-1,"provider":"codex","count":1}),
            json!({"action":"review","generation":9_007_199_254_740_992u64}),
        ] {
            assert!(!valid_request(&request));
        }
        for field in ["path", "pid", "proof", "source", "method", "mcp"] {
            let mut request =
                json!({"action":"create","generation":3,"provider":"codex","count":1});
            request[field] = json!("SYNTHETIC");
            assert!(!valid_request(&request));
        }
    }
    #[test]
    fn studio_authenticates_actual_webview_parent_and_exact_dashboard_document() {
        let origin = "http://127.0.0.1:4319";
        for path in ["/", "/studio"] {
            assert!(document_matches(
                "main",
                "main",
                &format!("{origin}{path}"),
                origin
            ));
        }
        for url in [
            "http://127.0.0.1:4320/studio",
            "http://localhost:4319/studio",
            "https://127.0.0.1:4319/studio",
            "http://127.0.0.1:4319/studio?path=x",
            "http://127.0.0.1:4319/studio#x",
            "http://user@127.0.0.1:4319/studio",
            "http://127.0.0.1:4319/settings",
            "orqst-terminal://local/index.html",
        ] {
            assert!(!document_matches("main", "main", url, origin));
        }
        for (label, parent) in [
            ("iframe", "main"),
            ("main", "terminal-workspace"),
            ("terminal-0", "main"),
        ] {
            assert!(!document_matches(
                label,
                parent,
                &format!("{origin}/studio"),
                origin
            ));
        }
    }

    #[test]
    fn another_native_surface_fences_preparation_without_treating_a_modal_as_blur() {
        assert!(!invalidates_preparation(
            "main",
            &WindowEvent::Focused(false)
        ));
        assert!(!invalidates_preparation(
            "main",
            &WindowEvent::Focused(true)
        ));
        for label in ["terminal-workspace", "managed-agents"] {
            assert!(invalidates_preparation(label, &WindowEvent::Focused(true)));
            assert!(!invalidates_preparation(
                label,
                &WindowEvent::Focused(false)
            ));
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

#[cfg(test)]
mod catalog_tests {
    use super::{valid_catalog, valid_request};
    use serde_json::json;
    #[test]
    fn mcp_pair_requests_are_bilateral_and_cannot_supply_task_or_launch_authority() {
        let pair = json!({"action":"create-mcp-pair","generation":3,"workspaceId":"synthetic-workspace","featureId":null,"catalogId":"a".repeat(64),"sourceProvider":"codex","codexModelId":"b".repeat(64),"openCodeModelId":"c".repeat(64)});
        assert!(valid_request(&pair));
        let mut reverse = pair.clone();
        reverse["sourceProvider"] = json!("opencode");
        assert!(valid_request(&reverse));
        reverse["sourceProvider"] = json!("claude");
        assert!(!valid_request(&reverse));
        for key in ["codexModelId", "openCodeModelId", "generation", "featureId"] {
            let mut missing = pair.clone();
            missing.as_object_mut().unwrap().remove(key);
            assert!(!valid_request(&missing));
        }
        for key in ["count", "mcp", "proof", "task", "path", "sourceInstanceId"] {
            let mut extra = pair.clone();
            extra[key] = json!("SYNTHETIC");
            assert!(!valid_request(&extra));
        }
    }
    #[test]
    fn selected_requests_bind_scope_and_opaque_models_without_native_paths() {
        let mut selected = json!({"action":"create-selected","generation":3,"workspaceId":"synthetic-workspace","featureId":null,"catalogId":"a".repeat(64),"provider":"opencode","modelId":"b".repeat(64),"count":1});
        assert!(valid_request(&selected));
        selected["project"] = json!("/SYNTHETIC/forged");
        assert!(!valid_request(&selected));
        assert!(valid_request(
            &json!({"action":"catalog","workspaceId":"synthetic-workspace","featureId":null})
        ));
    }
    #[test]
    fn catalogs_accept_all_reviewed_sources_but_never_entitlement_or_cross_scope() {
        let request =
            json!({"action":"catalog","workspaceId":"synthetic-workspace","featureId":null});
        let providers: Vec<_>=["codex","claude","opencode"].iter().map(|provider|json!({"provider":provider,"status":"available","reason":"ready","models":[{"id":"b".repeat(64),"label":"SYNTHETIC model","source":"official-alias","isDefault":false,"availability":"unverified"}]})).collect();
        let mut catalog = json!({"contractVersion":1,"workspaceId":"synthetic-workspace","featureId":null,"catalogId":"a".repeat(64),"providers":providers});
        assert!(valid_catalog(&catalog, &request));
        for source in [
            "cli-default",
            "native-config",
            "cli-cache",
            "official-alias",
            "native-state",
        ] {
            catalog["providers"][0]["models"][0]["source"] = json!(source);
            assert!(valid_catalog(&catalog, &request));
        }
        catalog["providers"][0]["models"][0]["availability"] = json!("entitled");
        assert!(!valid_catalog(&catalog, &request));
        catalog["providers"][0]["models"][0]["availability"] = json!("unverified");
        catalog["workspaceId"] = json!("another-workspace");
        assert!(!valid_catalog(&catalog, &request));
    }
}

#[cfg(test)]
mod review_tests {
    use super::{confirm_review, ReviewChoice};
    use std::cell::Cell;

    #[test]
    fn complete_details_return_to_summary_before_approval() {
        let mut steps = vec![
            (false, ReviewChoice::Details),
            (true, ReviewChoice::Back),
            (false, ReviewChoice::Approve),
        ]
        .into_iter();
        assert!(confirm_review(
            || true,
            |full| {
                let (expected, choice) = steps.next().unwrap();
                assert_eq!(full, expected);
                choice
            }
        ));
        assert!(steps.next().is_none());
    }

    #[test]
    fn details_cannot_approve_and_cancellation_refuses() {
        for choice in [ReviewChoice::Approve, ReviewChoice::Cancel] {
            let mut first = true;
            assert!(!confirm_review(
                || true,
                |_| {
                    if std::mem::take(&mut first) {
                        ReviewChoice::Details
                    } else {
                        choice
                    }
                }
            ));
        }
        assert!(!confirm_review(|| true, |_| ReviewChoice::Cancel));
    }

    #[test]
    fn expired_or_stale_review_never_approves() {
        let live = Cell::new(true);
        assert!(!confirm_review(
            || live.get(),
            |_| {
                live.set(false);
                ReviewChoice::Approve
            }
        ));
        live.set(true);
        assert!(!confirm_review(
            || live.get(),
            |full| {
                if full {
                    live.set(false);
                    ReviewChoice::Back
                } else {
                    ReviewChoice::Details
                }
            }
        ));
        assert!(!confirm_review(
            || false,
            |_| panic!("stale review displayed")
        ));
    }
}
