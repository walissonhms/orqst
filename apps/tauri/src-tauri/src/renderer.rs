//! macOS web-content termination: fail closed, no reload and no process effect.
use std::collections::HashSet;
use std::sync::{Mutex, OnceLock};
use tauri::Manager;

static TERMINATED: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();

/// One latch per label. A duplicate or obsolete callback never acts twice and never loops.
pub(crate) fn first_termination(label: &str) -> bool {
    TERMINATED
        .get_or_init(|| Mutex::new(HashSet::new()))
        .lock()
        .unwrap()
        .insert(label.to_string())
}

/// Revoke the terminated document's authority only. Never stop, signal, retry or adopt.
pub(crate) fn on_terminate(webview: &tauri::Webview) {
    let app = webview.app_handle();
    let label = webview.label().to_string();
    if app.get_webview(&label).is_none() || !first_termination(&label) {
        return;
    }
    match label.as_str() {
        "main" => {}
        "managed-agents" => crate::agents::revoke_document(app),
        "feature-workspace" => crate::features::invalidate(app, &label),
        other if other.starts_with("terminal-") => crate::terminal::revoke_document(app, other),
        _ => {}
    }
    if label != "main" {
        // A dead child must not cover the unavailable document or keep input.
        if let Some(view) = app.get_webview(&label) {
            let _ = view.hide();
        }
    }
    crate::files::invalidate(app);
    crate::terminal_creation::invalidate(app);
    crate::unavailable::show_renderer_unavailable(app);
}

#[cfg(test)]
mod tests {
    #[test]
    fn one_latch_per_label_never_repeats_or_loops() {
        assert!(super::first_termination("main"));
        assert!(!super::first_termination("main"));
        assert!(super::first_termination("terminal-0"));
        assert!(!super::first_termination("terminal-0"));
    }
}
