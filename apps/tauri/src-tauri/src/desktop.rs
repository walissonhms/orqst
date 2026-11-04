//! Native-only observer alerts and explicit window lifetime. No renderer capability.
use serde_json::Value;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{TrayIcon, TrayIconBuilder};
use tauri::{Manager, WindowEvent};
use tauri_plugin_notification::NotificationExt;

const MAX_ATTEMPTS: usize = 20;
const FRESHNESS: Duration = Duration::from_secs(10);

#[derive(Default)]
pub struct Desktop(Mutex<State>);

#[derive(Default)]
struct State {
    keep_running: bool,
    enabled: bool,
    failed: bool,
    stopped: bool,
    frame_queued: bool,
    generation: u64,
    attempts: usize,
    pending: usize,
    last_frame: Option<Instant>,
    ui: Option<Ui>,
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
                    if fields.len() != 2 {
                        return None;
                    }
                    let category = match fields.get("category")?.as_str()? {
                        "completed" => "completed",
                        "failed" => "failed",
                        "intervention" => "intervention",
                        _ => return None,
                    };
                    Some(Alert {
                        category,
                        silent: fields.get("silent")?.as_bool()?,
                    })
                })
                .collect::<Option<Vec<_>>>()?;
            Some(Some(Frame { pending, alerts }))
        }
    }
}

impl State {
    fn disconnect(&mut self) {
        self.last_frame = None;
        self.generation = self.generation.wrapping_add(1);
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
            return Vec::new();
        }
        let remaining = MAX_ATTEMPTS.saturating_sub(self.attempts);
        let alerts: Vec<_> = frame.alerts.into_iter().take(remaining).collect();
        self.attempts += alerts.len();
        alerts
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
    let alerts = app
        .state::<Desktop>()
        .0
        .lock()
        .unwrap()
        .accept(frame, Instant::now());
    for alert in alerts {
        // Fixed category text only. No session ID, content, path or secret enters the OS.
        let mut notification = app
            .notification()
            .builder()
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
            app.state::<Desktop>().0.lock().unwrap().failed = true;
            break;
        }
    }
    refresh(app);
}

pub fn disconnected(app: &tauri::AppHandle) {
    app.state::<Desktop>().0.lock().unwrap().disconnect();
    // Never block the owned-child drain on a menu update during Exit cleanup.
    let native = app.clone();
    let _ = app.run_on_main_thread(move || refresh(&native));
}

pub fn install(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
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
            "native-quit" => app.exit(0), // The existing signed-host consent gates still run.
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
                drop(state);
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
    app.notification().on_action(move |_| focus(&clicked))?;
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
            // Preserve the document when the user cancels managed-host exit consent.
            app.exit(0);
        }
    }
}

pub fn stop(app: &tauri::AppHandle) {
    let ui = {
        let state = app.state::<Desktop>();
        let mut state = state.0.lock().unwrap();
        state.stopped = true;
        state.enabled = false;
        state.last_frame = None;
        state.ui.take()
    };
    if let Some(ui) = ui {
        app.remove_tray_by_id(ui.tray.id());
    }
    // macOS/Windows cannot withdraw delivered notifications. Future callbacks are inert.
    let _ = app.notification().remove_all_active();
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
            }],
        })
    }
    #[test]
    fn pipe_accepts_only_bounded_fixed_metadata() {
        assert_eq!(parse_frame(br#"ORQST_DESKTOP_STATE {"connected":true,"pending":2,"alerts":[{"category":"failed","silent":true}]}"#), Some(Some(Frame { pending: 2, alerts: vec![Alert { category: "failed", silent: true }] })));
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
}
