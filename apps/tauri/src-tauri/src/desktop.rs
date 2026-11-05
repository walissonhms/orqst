//! Native-only observer alerts and explicit window lifetime. No renderer capability.
use serde_json::Value;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{TrayIcon, TrayIconBuilder};
use tauri::{Manager, WindowEvent};
use tauri_plugin_notification::NotificationExt;

static QUIT_IN_FLIGHT: AtomicBool = AtomicBool::new(false);

const MAX_ATTEMPTS: usize = 20;
const FRESHNESS: Duration = Duration::from_secs(10);

#[derive(Default)]
pub struct Desktop(Mutex<State>);

#[derive(Default)]
struct State {
    keep_running: bool,
    quit_sequence: u64,
    quit_review: Option<QuitPresentation>,
    enabled: bool,
    failed: bool,
    stopped: bool,
    frame_queued: bool,
    generation: u64,
    attempts: usize,
    pending: usize,
    last_frame: Option<Instant>,
    origin: Option<String>,
    notification_id: i32,
    routes: HashMap<i32, String>,
    ui: Option<Ui>,
}

struct QuitPresentation {
    review: QuitReview,
    // Retain the exact Tauri window handle; a later window reusing its label is not adopted.
    parent: tauri::Window,
}

// Presentation evidence for one existing Quit gate, never a grant or a quit policy.
#[derive(Debug)]
struct QuitReview {
    token: u64,
    parent: String,
    shown: bool,
    revoked: bool,
}
impl QuitReview {
    fn observe(&mut self, token: u64, parent: &str, owns_key: bool, owns_sheet: bool) {
        if self.token != token || self.parent != parent {
            return;
        }
        self.revoked |= !owns_key;
        self.shown |= !self.revoked && owns_sheet;
    }
    fn accepted(&self, token: u64, parent: &str) -> bool {
        self.token == token && self.parent == parent && self.shown && !self.revoked
    }
}

#[derive(Clone)]
struct Ui {
    tray: TrayIcon,
    connection: MenuItem<tauri::Wry>,
    pending: MenuItem<tauri::Wry>,
    status: MenuItem<tauri::Wry>,
}

#[derive(Debug, PartialEq)]
struct Alert {
    category: &'static str,
    silent: bool,
    session_id: Option<String>,
}

fn session_id_valid(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 200
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b":_-".contains(&byte))
}

#[derive(Debug, PartialEq)]
struct Frame {
    pending: usize,
    alerts: Vec<Alert>,
}

// A fixed owned-child pipe, never raw events or a renderer-supplied payload.
fn parse_frame(line: &[u8]) -> Option<Option<Frame>> {
    if line.len() > 1024 {
        return None;
    }
    let text = std::str::from_utf8(line)
        .ok()?
        .trim_end_matches(['\r', '\n']);
    let value: Value = serde_json::from_str(text.strip_prefix("ORQST_DESKTOP_STATE ")?).ok()?;
    let object = value.as_object()?;
    match object.get("connected")?.as_bool()? {
        false => (object.len() == 1).then_some(None),
        true => {
            if object.len() != 3 {
                return None;
            }
            let pending = usize::try_from(object.get("pending")?.as_u64()?).ok()?;
            let alerts = object.get("alerts")?.as_array()?;
            if pending > 200 || alerts.len() > 3 {
                return None;
            }
            let alerts = alerts
                .iter()
                .map(|value| {
                    let fields = value.as_object()?;
                    if fields.len() != 2 && fields.len() != 3 {
                        return None;
                    }
                    let session_id = match fields.get("sessionId") {
                        Some(value) => {
                            let id = value.as_str()?;
                            if !session_id_valid(id) {
                                return None;
                            }
                            Some(id.to_owned())
                        }
                        None if fields.len() == 2 => None,
                        None => return None,
                    };
                    let category = match fields.get("category")?.as_str()? {
                        "completed" => "completed",
                        "failed" => "failed",
                        "intervention" => "intervention",
                        _ => return None,
                    };
                    Some(Alert {
                        category,
                        silent: fields.get("silent")?.as_bool()?,
                        session_id,
                    })
                })
                .collect::<Option<Vec<_>>>()?;
            Some(Some(Frame { pending, alerts }))
        }
    }
}

impl State {
    fn revoke_routes(&mut self) {
        self.generation = self.generation.wrapping_add(1);
        self.routes.clear();
    }

    fn disconnect(&mut self) {
        self.last_frame = None;
        self.revoke_routes();
    }

    fn queue_frame(&mut self) -> bool {
        if self.stopped || self.frame_queued {
            // A blocked UI must not accumulate a native alert queue.
            self.disconnect();
            return false;
        }
        self.frame_queued = true;
        true
    }

    fn connected(&self, now: Instant) -> bool {
        !self.stopped
            && self
                .last_frame
                .is_some_and(|last| now.duration_since(last) <= FRESHNESS)
    }

    fn accept(&mut self, frame: Option<Frame>, now: Instant) -> Vec<Alert> {
        if self.stopped {
            return Vec::new();
        }
        let was_connected = self.connected(now);
        let Some(frame) = frame else {
            self.disconnect();
            return Vec::new();
        };
        self.pending = frame.pending;
        self.last_frame = Some(now);
        // First attach, stale pipe and reconnect establish a baseline. Off consumes alerts.
        if !was_connected || !self.enabled || self.failed {
            self.revoke_routes();
            return Vec::new();
        }
        let remaining = MAX_ATTEMPTS.saturating_sub(self.attempts);
        let alerts: Vec<_> = frame.alerts.into_iter().take(remaining).collect();
        self.attempts += alerts.len();
        alerts
    }

    fn register_notification(&mut self, alert: &Alert) -> Option<i32> {
        self.notification_id = self.notification_id.checked_add(1)?;
        let id = self.notification_id;
        if let Some(session) = &alert.session_id {
            self.routes.insert(id, session.clone());
        }
        Some(id)
    }

    fn take_route(&mut self, id: i32, now: Instant) -> Option<(String, u64)> {
        let session = self.routes.remove(&id)?;
        (self.enabled && !self.failed && self.connected(now) && self.origin.is_some())
            .then_some((session, self.generation))
    }
}

// Called only with the owned Core's ready origin, never a renderer-provided URL.
pub fn configure(app: &tauri::AppHandle, origin: Option<&str>) {
    cancel_navigation(app);
    let desktop = app.state::<Desktop>();
    let mut state = desktop.0.lock().unwrap();
    state.disconnect();
    state.origin = origin.map(str::to_owned);
}

fn route_url_valid(url: &tauri::Url, origin: &str) -> bool {
    url.origin().ascii_serialization() == origin
        && url.username().is_empty()
        && url.password().is_none()
        && url.query().is_none()
}

fn notification_action(
    app: &tauri::AppHandle,
    action: &tauri_plugin_notification::ActionPerformed,
) {
    let Some(id) = action_notification_id(action) else {
        return;
    };
    let received = Instant::now();
    let route = app
        .state::<Desktop>()
        .0
        .lock()
        .unwrap()
        .take_route(id, received);
    let Some((session, generation)) = route else {
        return;
    };
    let app = app.clone();
    let _ = app.clone().run_on_main_thread(move || {
        let desktop = app.state::<Desktop>();
        let state = desktop.0.lock().unwrap();
        if received.elapsed() > FRESHNESS
            || state.generation != generation
            || !state.enabled
            || state.failed
            || !state.connected(Instant::now())
        {
            return;
        }
        let Some(origin) = &state.origin else { return };
        let Some(window) = app.get_webview_window("main") else {
            return;
        };
        if !window.url().is_ok_and(|url| route_url_valid(&url, origin)) {
            return;
        }
        let payload = serde_json::json!({"sessionId": session});
        // A view request only: the dashboard refreshes membership and keeps its draft guard.
        let _ = window.eval(format!(
            "window.dispatchEvent(new CustomEvent('orqst-native-session',{{detail:{payload}}}));"
        ));
        drop(state);
        focus(&app);
    });
}

fn action_notification_id(action: &tauri_plugin_notification::ActionPerformed) -> Option<i32> {
    (action.action_id() == "tap")
        .then(|| action.notification().map(|notification| notification.id()))
        .flatten()
}

fn cancel_navigation(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let origin = app.state::<Desktop>().0.lock().unwrap().origin.clone();
    if origin.is_some_and(|origin| window.url().is_ok_and(|url| route_url_valid(&url, &origin))) {
        let _ = window
            .eval("window.dispatchEvent(new CustomEvent('orqst-native-session',{detail:null}));");
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

pub fn focus(app: &tauri::AppHandle) {
    if app.state::<Desktop>().0.lock().unwrap().stopped {
        return;
    }
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

// A native Quit review belongs to this app's real window, never a process-global
// CFUserNotification. Explicit Quit may restore the existing dashboard from tray.
pub(crate) fn quit_parent(app: &tauri::AppHandle) -> Option<tauri::Window> {
    app.windows()
        .into_values()
        .find(|window| quit_parent_valid(window) && window.is_focused().unwrap_or(false))
        .or_else(|| app.windows().into_values().find(quit_parent_valid))
        .or_else(|| {
            focus(app);
            app.get_window("main").filter(quit_parent_valid)
        })
}

fn quit_parent_valid(window: &tauri::Window) -> bool {
    if !matches!(
        window.label(),
        "main" | "managed-agents"
    ) || !window.is_visible().unwrap_or(false)
        || window.is_minimized().unwrap_or(true)
    {
        return false;
    }
    #[cfg(target_os = "macos")]
    if !window.ns_window().is_ok_and(|pointer| !pointer.is_null()) {
        return false;
    }
    true
}

pub(crate) fn begin_quit_review(app: &tauri::AppHandle, parent: &tauri::Window) -> Option<u64> {
    #[cfg(target_os = "macos")]
    if !crate::terminal::install_quit_observer(app) {
        return None;
    }
    let desktop = app.state::<Desktop>();
    let mut state = desktop.0.lock().unwrap();
    if state.quit_review.is_some() {
        return None;
    }
    state.quit_sequence = state.quit_sequence.checked_add(1)?;
    let token = state.quit_sequence;
    state.quit_review = Some(QuitPresentation {
        review: QuitReview {
            token,
            parent: parent.label().into(),
            shown: !cfg!(target_os = "macos"),
            revoked: false,
        },
        parent: parent.clone(),
    });
    Some(token)
}

#[cfg(target_os = "macos")]
pub(crate) fn quit_deactivated(app: &tauri::AppHandle) {
    if let Some(review) = app
        .state::<Desktop>()
        .0
        .lock()
        .unwrap()
        .quit_review
        .as_mut()
    {
        review.review.revoked = true;
    }
}

#[cfg(target_os = "macos")]
pub(crate) fn quit_key_changed(app: &tauri::AppHandle) {
    let parent = app
        .state::<Desktop>()
        .0
        .lock()
        .unwrap()
        .quit_review
        .as_ref()
        .map(|review| (review.review.token, review.parent.clone()));
    let Some((token, parent)) = parent else {
        return;
    };
    let focus = crate::terminal::quit_window_focus(&parent);
    if let Some(review) = app
        .state::<Desktop>()
        .0
        .lock()
        .unwrap()
        .quit_review
        .as_mut()
    {
        let review = &mut review.review;
        review.observe(
            token,
            parent.label(),
            focus.is_some_and(|f| f.0),
            focus.is_some_and(|f| f.1),
        );
        if std::env::var("ORQST_TAURI_FOCUS_DIAGNOSTICS").as_deref() == Ok("1") {
            eprintln!(
                "ORQST_QUIT_PRESENTATION token={} shown={} revoked={}",
                review.token, review.shown, review.revoked
            );
        }
    }
}

pub(crate) fn finish_quit_review(app: &tauri::AppHandle, token: u64, parent: &str) -> bool {
    let desktop = app.state::<Desktop>();
    let mut state = desktop.0.lock().unwrap();
    if !state
        .quit_review
        .as_ref()
        .is_some_and(|review| review.review.token == token)
    {
        return false;
    }
    state
        .quit_review
        .take()
        .is_some_and(|review| review.review.accepted(token, parent))
}

// rfd 0.17.2 maps unknown NSAlert responses to Cancel. Only the explicit second
// custom button may authorize; never accept a default/Ok/Yes or a vanished parent.
pub(crate) fn quit_approved(
    result: &tauri_plugin_dialog::MessageDialogResult,
    expected: &str,
    parent_visible: bool,
) -> bool {
    parent_visible
        && !expected.is_empty()
        && matches!(result, tauri_plugin_dialog::MessageDialogResult::Custom(text) if text == expected)
}

fn refresh(app: &tauri::AppHandle) {
    let (ui, connected, pending, status) = {
        let state = app.state::<Desktop>();
        let state = state.0.lock().unwrap();
        if state.stopped {
            return;
        }
        let status = if state.failed {
            "failed"
        } else if state.attempts >= MAX_ATTEMPTS {
            "exhausted"
        } else if state.enabled {
            "enabled"
        } else {
            "disabled"
        };
        (
            state.ui.clone(),
            state.connected(Instant::now()),
            state.pending,
            status,
        )
    };
    if !connected {
        cancel_navigation(app);
    }
    let Some(ui) = ui else { return };
    let connection = translate(if connected {
        "tauriDesktop.connected"
    } else {
        "tauriDesktop.offline"
    });
    let unread = if connected {
        translate("desktopShell.pending").replace("{{count}}", &pending.to_string())
    } else {
        translate("desktopShell.pendingUnknown")
    };
    let _ = ui.connection.set_text(&connection);
    let _ = ui.pending.set_text(unread);
    let _ = ui
        .status
        .set_text(translate(&format!("tauriDesktop.{status}")));
    let _ = ui.tray.set_tooltip(Some(format!("ORQST — {connection}")));
    // Linux does not support tray titles; the menu always carries the qualified count.
    let title = if connected && pending > 0 {
        pending.to_string()
    } else {
        String::new()
    };
    let _ = ui.tray.set_title(Some(title));
}

pub fn receive(app: &tauri::AppHandle, line: &[u8]) {
    let frame = parse_frame(line).flatten();
    let received = Instant::now();
    let generation = {
        let desktop = app.state::<Desktop>();
        let mut state = desktop.0.lock().unwrap();
        if !state.queue_frame() {
            return;
        }
        state.generation
    };
    let native = app.clone();
    let scheduled = app.run_on_main_thread(move || {
        {
            let desktop = native.state::<Desktop>();
            let mut state = desktop.0.lock().unwrap();
            state.frame_queued = false;
            if state.stopped || state.generation != generation {
                drop(state);
                cancel_navigation(&native);
                return;
            }
        }
        if received.elapsed() > FRESHNESS {
            disconnected(&native);
        } else {
            apply_frame(&native, frame);
        }
    });
    if scheduled.is_err() {
        let desktop = app.state::<Desktop>();
        let mut state = desktop.0.lock().unwrap();
        state.frame_queued = false;
        state.disconnect();
    }
}

fn apply_frame(app: &tauri::AppHandle, frame: Option<Frame>) {
    if frame.is_none()
        || !app
            .state::<Desktop>()
            .0
            .lock()
            .unwrap()
            .connected(Instant::now())
    {
        cancel_navigation(app);
    }
    let alerts = app
        .state::<Desktop>()
        .0
        .lock()
        .unwrap()
        .accept(frame, Instant::now());
    for alert in alerts {
        let Some(id) = app
            .state::<Desktop>()
            .0
            .lock()
            .unwrap()
            .register_notification(&alert)
        else {
            break;
        };
        // Fixed category text only. No session ID, content, path or secret enters the OS.
        let mut notification = app
            .notification()
            .builder()
            .id(id)
            .title("ORQST")
            .body(translate(&format!("desktopShell.alert.{}", alert.category)));
        if !alert.silent {
            notification = notification.sound(if cfg!(target_os = "macos") {
                "NSUserNotificationDefaultSoundName"
            } else {
                "default"
            });
        }
        if notification.show().is_err() {
            let desktop = app.state::<Desktop>();
            let mut state = desktop.0.lock().unwrap();
            state.failed = true;
            state.revoke_routes();
            drop(state);
            cancel_navigation(app);
            break;
        }
    }
    refresh(app);
}

pub fn disconnected(app: &tauri::AppHandle) {
    app.state::<Desktop>().0.lock().unwrap().disconnect();
    // Never block the owned-child drain on a menu update during Exit cleanup.
    let native = app.clone();
    let _ = app.run_on_main_thread(move || {
        cancel_navigation(&native);
        refresh(&native);
    });
}

#[cfg(target_os = "macos")]
fn default_quit_index(children: usize, last_is_predefined: bool) -> Option<usize> {
    // Source-verified Tauri 2.12.5 Menu::default macOS app submenu contract.
    (children == 8 && last_is_predefined).then_some(7)
}

pub fn install(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    #[cfg(target_os = "macos")]
    {
        // Tauri 2.12.5's fresh default app submenu ends in Muda's direct
        // NSApp terminate: item. Route Cmd-Q through RequestExit and the existing
        // two-host consent gates instead. Keep all other default/app/tray items.
        let menu = Menu::default(app)?;
        let items = menu.items()?;
        let Some(tauri::menu::MenuItemKind::Submenu(app_menu)) = items.first() else {
            return Err("Native application menu unavailable".into());
        };
        let children = app_menu.items()?;
        let Some(index) = default_quit_index(
            children.len(),
            matches!(
                children.last(),
                Some(tauri::menu::MenuItemKind::Predefined(_))
            ),
        ) else {
            return Err("Native Quit menu shape changed".into());
        };
        app_menu.remove_at(index)?;
        app_menu.append(&MenuItem::with_id(
            app,
            "native-app-quit",
            translate("tauriDesktop.quit"),
            true,
            Some("CmdOrCtrl+Q"),
        )?)?;
        app.set_menu(menu)?;
        app.on_menu_event(|app, event| {
            if event.id().as_ref() == "native-app-quit" {
                if std::env::var("ORQST_TAURI_FOCUS_DIAGNOSTICS").as_deref() == Ok("1") {
                    eprintln!("ORQST_QUIT_MENU request-exit");
                }
                request_quit(app);
            }
        });
    }
    let open = MenuItem::with_id(
        app,
        "native-open",
        translate("desktopShell.open"),
        true,
        None::<&str>,
    )?;
    let connection = MenuItem::new(app, translate("tauriDesktop.offline"), false, None::<&str>)?;
    let pending = MenuItem::new(
        app,
        translate("desktopShell.pendingUnknown"),
        false,
        None::<&str>,
    )?;
    let alerts = CheckMenuItem::with_id(
        app,
        "native-alerts",
        translate("desktopShell.nativeToggle"),
        true,
        false,
        None::<&str>,
    )?;
    let status = MenuItem::new(app, translate("tauriDesktop.disabled"), false, None::<&str>)?;
    let limit = MenuItem::new(app, translate("tauriDesktop.limit"), false, None::<&str>)?;
    let background = CheckMenuItem::with_id(
        app,
        "native-background",
        translate("tauriDesktop.background"),
        true,
        false,
        None::<&str>,
    )?;
    let lifetime = MenuItem::new(app, translate("tauriDesktop.lifetime"), false, None::<&str>)?;
    let quit = MenuItem::with_id(
        app,
        "native-quit",
        translate("tauriDesktop.quit"),
        true,
        None::<&str>,
    )?;
    let separator = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(
        app,
        &[
            &open,
            &connection,
            &pending,
            &separator,
            &alerts,
            &status,
            &limit,
            &background,
            &lifetime,
            &quit,
        ],
    )?;
    // Retain ORQST's colored brand asset. Do not install a template/system glyph.
    let image = tauri::image::Image::from_bytes(include_bytes!(
        "../../../desktop/resources/icons/orqst-menubar-128.png"
    ))?;
    let tray = TrayIconBuilder::with_id("orqst-desktop")
        .icon(image)
        .icon_as_template(false)
        .tooltip("ORQST")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "native-open" => focus(app),
            "native-quit" => request_quit(app),
            "native-background" => {
                let desktop = app.state::<Desktop>();
                let mut state = desktop.0.lock().unwrap();
                state.keep_running = background.is_checked().unwrap_or(false);
            }
            "native-alerts" => {
                let desktop = app.state::<Desktop>();
                let mut state = desktop.0.lock().unwrap();
                state.enabled = alerts.is_checked().unwrap_or(false);
                state.failed = false;
                state.revoke_routes();
                drop(state);
                cancel_navigation(app);
                refresh(app);
            }
            _ => {}
        })
        .build(app)?;
    app.state::<Desktop>().0.lock().unwrap().ui = Some(Ui {
        tray,
        connection,
        pending,
        status,
    });
    let clicked = app.clone();
    app.notification()
        .on_action(move |action| notification_action(&clicked, action))?;
    let watched = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(2)).await;
            if watched.state::<Desktop>().0.lock().unwrap().stopped {
                break;
            }
            refresh(&watched);
        }
    });
    Ok(())
}

pub fn main_window_event(app: &tauri::AppHandle, event: &WindowEvent) {
    if let WindowEvent::CloseRequested { api, .. } = event {
        api.prevent_close();
        crate::terminal_creation::invalidate(app);
        let keep_running = app.state::<Desktop>().0.lock().unwrap().keep_running;
        if keep_running {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.hide();
            }
        } else {
            request_quit(app);
        }
    }
}

/// Every exit point uses this single latched entry. No direct exit with an owned host.
pub fn request_quit(app: &tauri::AppHandle) {
    if crate::host_phase::lost_unknown() {
        crate::terminal::quit_blocked_public(app, "host_lost");
        return;
    }
    if !crate::terminal::owned_host_started(app) {
        app.exit(0);
        return;
    }
    if QUIT_IN_FLIGHT.swap(true, Ordering::SeqCst) {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        crate::terminal::quit_owned(app).await;
    });
}

pub fn quit_finished() {
    QUIT_IN_FLIGHT.store(false, Ordering::SeqCst);
}

pub fn stop(app: &tauri::AppHandle) {
    let ui = {
        let state = app.state::<Desktop>();
        let mut state = state.0.lock().unwrap();
        state.stopped = true;
        state.enabled = false;
        state.last_frame = None;
        state.revoke_routes();
        state.ui.take()
    };
    cancel_navigation(app);
    if let Some(ui) = ui {
        app.remove_tray_by_id(ui.tray.id());
    }
    // macOS/Windows cannot withdraw delivered notifications. Future callbacks are inert.
    let _ = app.notification().remove_all_active();
}

#[cfg(test)]
mod quit_entry_tests {
    #[test]
    fn only_the_single_quit_entry_exits_without_an_owned_host() {
        let source = include_str!("desktop.rs");
        assert_eq!(source.matches(&concat!("app.", "exit(0)")).count(), 1);
        let index = source.find("pub fn request_quit").unwrap();
        assert!(source[index..].contains(&concat!("app.", "exit(0)")));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn frame() -> Option<Frame> {
        Some(Frame {
            pending: 1,
            alerts: vec![Alert {
                category: "completed",
                silent: true,
                session_id: Some("synthetic-session".into()),
            }],
        })
    }
    #[test]
    fn pipe_accepts_only_bounded_fixed_metadata() {
        assert_eq!(parse_frame(br#"ORQST_DESKTOP_STATE {"connected":true,"pending":2,"alerts":[{"category":"failed","silent":true}]}"#), Some(Some(Frame { pending: 2, alerts: vec![Alert { category: "failed", silent: true, session_id: None }] })));
        assert_eq!(
            parse_frame(br#"ORQST_DESKTOP_STATE {"connected":false}"#),
            Some(None)
        );
        for text in [
            r#"{"connected":true,"pending":201,"alerts":[]}"#,
            r#"{"connected":true,"pending":-1,"alerts":[]}"#,
            r#"{"connected":true,"pending":1,"alerts":[{"category":"made-up","silent":true}]}"#,
            r#"{"connected":true,"pending":1,"alerts":[{"category":"completed","silent":"yes"}]}"#,
            r#"{"connected":true,"pending":1,"alerts":[{"category":"completed","silent":true,"body":"private"}]}"#,
            r#"{"connected":true,"pending":1,"alerts":[],"sessionId":"private"}"#,
            r#"{"connected":false,"pending":2}"#,
            r#"{"connected":true,"pending":0}"#,
        ] {
            assert!(parse_frame(format!("ORQST_DESKTOP_STATE {text}").as_bytes()).is_none());
        }
        let too_many = serde_json::json!({
            "connected": true, "pending": 4,
            "alerts": (0..4).map(|_| serde_json::json!({"category": "completed", "silent": true})).collect::<Vec<_>>()
        });
        assert!(parse_frame(format!("ORQST_DESKTOP_STATE {too_many}").as_bytes()).is_none());
        assert!(parse_frame(&[b'x'; 1025]).is_none());
        assert!(parse_frame(b"ORQST_CORE_READY 4319").is_none());
    }
    #[test]
    fn alerts_require_opt_in_fresh_attach_and_remaining_capacity() {
        let mut state = State::default();
        let now = Instant::now();
        assert!(state.accept(frame(), now).is_empty());
        assert!(state.accept(frame(), now).is_empty());
        state.enabled = true;
        assert_eq!(state.accept(frame(), now).len(), 1);
        let stale = now + FRESHNESS + Duration::from_millis(1);
        assert!(state.accept(frame(), stale).is_empty());
        assert!(state.accept(None, stale).is_empty());
        assert!(state.accept(frame(), stale).is_empty());
        for _ in 0..50 {
            state.accept(frame(), stale);
        }
        assert_eq!(state.attempts, MAX_ATTEMPTS);
        state.enabled = false;
        state.enabled = true;
        assert!(state.accept(frame(), stale).is_empty());
        state.stopped = true;
        assert!(!state.connected(stale));
        assert!(state.accept(frame(), stale).is_empty());
    }
    #[test]
    fn blocked_ui_keeps_one_frame_and_rebaselines_discarded_alerts() {
        let now = Instant::now();
        let mut state = State {
            enabled: true,
            ..State::default()
        };
        state.accept(frame(), now);
        assert!(state.queue_frame());
        let queued_generation = state.generation;
        assert!(!state.queue_frame());
        assert_ne!(state.generation, queued_generation);
        assert!(!state.connected(now));
        state.frame_queued = false;
        assert!(state.accept(frame(), now).is_empty());
        assert!(state.queue_frame());
        state.frame_queued = false;
        state.stopped = true;
        assert!(!state.queue_frame());
    }
    #[test]
    fn failures_stop_dispatch_without_fabricating_delivery() {
        let now = Instant::now();
        let mut state = State {
            enabled: true,
            ..State::default()
        };
        state.accept(frame(), now);
        state.failed = true;
        assert!(state.accept(frame(), now).is_empty());
        assert_eq!(state.attempts, 0);
    }

    #[test]
    fn route_identity_is_allowlisted_and_never_a_path_or_prose() {
        for id in ["synthetic-session", "codex:123_abc", &"x".repeat(200)] {
            assert!(session_id_valid(id));
            let line = format!(
                "ORQST_DESKTOP_STATE {}",
                serde_json::json!({
                    "connected":true,"pending":1,"alerts":[{"category":"failed","silent":true,"sessionId":id}]
                })
            );
            assert_eq!(
                parse_frame(line.as_bytes()).unwrap().unwrap().alerts[0]
                    .session_id
                    .as_deref(),
                Some(id)
            );
        }
        for id in [
            "",
            "/private/session",
            "../secret",
            "a b",
            "a\n",
            "a%20b",
            "https://evil.test",
            &"x".repeat(201),
        ] {
            assert!(!session_id_valid(id));
        }
        for value in [
            serde_json::json!(null),
            serde_json::json!(5),
            serde_json::json!("/private/session"),
        ] {
            let line = format!(
                "ORQST_DESKTOP_STATE {}",
                serde_json::json!({
                    "connected":true,"pending":1,"alerts":[{"category":"failed","silent":true,"sessionId":value}]
                })
            );
            assert!(parse_frame(line.as_bytes()).is_none());
        }
    }

    #[test]
    fn callbacks_are_exact_one_use_and_revoked_by_disconnect_off_failure_staleness_or_stop() {
        let now = Instant::now();
        let alert = frame().unwrap().alerts.remove(0);
        let mut state = State {
            enabled: true,
            origin: Some("http://127.0.0.1:4319".into()),
            ..State::default()
        };
        state.accept(frame(), now);
        let first = state.register_notification(&alert).unwrap();
        let second = state.register_notification(&alert).unwrap();
        assert_ne!(first, second);
        assert!(state.take_route(999, now).is_none());
        assert_eq!(
            state.take_route(second, now).unwrap().0,
            "synthetic-session"
        );
        assert!(state.take_route(second, now).is_none());
        state.disconnect();
        assert!(state.take_route(first, now).is_none());
        for denial in ["off", "failed", "stale", "stopped", "origin"] {
            state.enabled = true;
            state.failed = false;
            state.stopped = false;
            state.origin = Some("http://127.0.0.1:4319".into());
            state.last_frame = Some(now);
            let id = state.register_notification(&alert).unwrap();
            match denial {
                "off" => state.enabled = false,
                "failed" => state.failed = true,
                "stopped" => state.stopped = true,
                "origin" => state.origin = None,
                _ => {}
            }
            let clicked = if denial == "stale" {
                now + FRESHNESS + Duration::from_millis(1)
            } else {
                now
            };
            assert!(state.take_route(id, clicked).is_none(), "{denial}");
        }
    }

    #[test]
    fn selection_requires_the_current_owned_dashboard_origin() {
        let origin = "http://127.0.0.1:4319";
        assert!(route_url_valid(
            &format!("{origin}/overview").parse().unwrap(),
            origin
        ));
        for url in [
            "http://127.0.0.1:4320/overview",
            "http://localhost:4319/",
            "http://user@127.0.0.1:4319/",
            "http://127.0.0.1:4319/?x=1",
            "orqst-unavailable://local/index.html",
            "orqst-terminal://local/a/index.html",
        ] {
            assert!(!route_url_valid(&url.parse().unwrap(), origin));
        }
    }

    #[test]
    fn callback_uses_only_a_real_tap_with_a_returned_plugin_identifier() {
        for (action, notification, expected) in [
            ("tap", serde_json::json!({"id":7}), Some(7)),
            ("dismiss", serde_json::json!({"id":7}), None),
            ("other", serde_json::json!({"id":7}), None),
            ("tap", serde_json::json!(null), None),
            (
                "tap",
                serde_json::json!({"extra":{"sessionId":"inferred"}}),
                None,
            ),
        ] {
            let action: tauri_plugin_notification::ActionPerformed = serde_json::from_value(
                serde_json::json!({"actionId": action,"notification":notification}),
            )
            .unwrap();
            assert_eq!(action_notification_id(&action), expected);
        }
    }
}

#[cfg(all(test, target_os = "macos"))]
mod quit_tests {
    #[test]
    fn quit_sheet_evidence_is_parent_and_attempt_bound_and_revocation_is_permanent() {
        let mut review = super::QuitReview {
            token: 7,
            parent: "terminal-workspace".into(),
            shown: false,
            revoked: false,
        };
        assert!(!review.accepted(7, "terminal-workspace"));
        review.observe(7, "terminal-workspace", true, true);
        assert!(review.accepted(7, "terminal-workspace"));
        assert!(!review.accepted(8, "terminal-workspace"));
        assert!(!review.accepted(7, "main"));
        review.observe(7, "terminal-workspace", false, false); // App deactivation, unrelated key window or unavailable metadata.
        review.observe(7, "terminal-workspace", true, true); // Returning cannot restore it.
        assert!(!review.accepted(7, "terminal-workspace"));
    }

    #[test]
    fn a_focus_sample_cannot_cross_quit_attempts_or_parent_windows() {
        let mut review = super::QuitReview {
            token: 8,
            parent: "managed-agents".into(),
            shown: false,
            revoked: false,
        };
        // Native sampling releases the state lock; an old callback cannot mark a
        // replacement review as presented or revoke it using the old window.
        review.observe(7, "managed-agents", true, true);
        review.observe(8, "terminal-workspace", false, false);
        assert!(!review.shown);
        assert!(!review.revoked);
        review.observe(8, "managed-agents", true, true);
        assert!(review.accepted(8, "managed-agents"));
    }

    #[test]
    fn quit_requires_the_explicit_custom_button_and_a_live_visible_parent() {
        use tauri_plugin_dialog::MessageDialogResult;
        let expected = "Acknowledge and disconnect";
        assert!(super::quit_approved(
            &MessageDialogResult::Custom(expected.into()),
            expected,
            true
        ));
        assert!(!super::quit_approved(
            &MessageDialogResult::Custom(expected.into()),
            expected,
            false
        ));
        assert!(!super::quit_approved(
            &MessageDialogResult::Custom(String::new()),
            "",
            true
        ));
        for result in [
            MessageDialogResult::Ok,
            MessageDialogResult::Yes,
            MessageDialogResult::No,
            MessageDialogResult::Cancel,
            MessageDialogResult::Custom("Cancel".into()),
        ] {
            assert!(!super::quit_approved(&result, expected, true));
        }
    }

    #[test]
    fn replacing_the_direct_quit_requires_the_source_verified_default_menu_shape() {
        assert_eq!(super::default_quit_index(8, true), Some(7));
        for length in [0, 1, 7, 9] {
            assert_eq!(super::default_quit_index(length, true), None);
        }
        assert_eq!(super::default_quit_index(8, false), None);
    }
}
