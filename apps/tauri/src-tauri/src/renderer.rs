//! macOS web-content termination: fail closed, no reload and no process effect.
use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use tauri::Manager;

static TERMINATED: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
static PRESENTATION: PresentationLatch = PresentationLatch(AtomicBool::new(false));

/// No reset path: renderer termination blocks child presentation until app restart.
#[derive(Default)]
struct PresentationLatch(AtomicBool);
impl PresentationLatch {
    fn terminate(&self) {
        self.0.store(true, Ordering::SeqCst);
    }
    fn unavailable(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }
    fn present(&self, effect: impl FnOnce()) {
        if !self.unavailable() {
            effect();
        }
    }
}

pub(crate) fn unavailable() -> bool {
    PRESENTATION.unavailable()
}

/// Called on the UI thread, where the termination callback and visibility effects serialize.
pub(crate) fn present(effect: impl FnOnce()) {
    PRESENTATION.present(effect);
}

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
    // Fence queued layouts and future raises before hiding even the terminated child.
    PRESENTATION.terminate();
    crate::terminal::metadata_invalidate(app);
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
    // No remaining child may cover the unavailable document or keep input.
    crate::terminal::suspend_surface(app);
    crate::agents::hide_surface(app);
    if let Some(chrome) = app.get_webview("feature-workspace") {
        let _ = chrome.hide();
    }
    crate::files::invalidate(app);
    crate::terminal_creation::invalidate(app);
    crate::unavailable::show_renderer_unavailable(app);
}

#[cfg(test)]
mod tests {
    #[test]
    fn queued_layout_and_later_raises_cannot_cover_unavailable_until_restart() {
        let presentation = super::PresentationLatch::default();
        let children_visible = std::cell::Cell::new(true);
        let effects = std::cell::Cell::new(0);
        let queued_layout = || {
            presentation.present(|| {
                children_visible.set(true);
                effects.set(effects.get() + 1);
            })
        };
        // The production main-thread admission wraps a layout queued before termination.
        presentation.terminate();
        children_visible.set(false);
        queued_layout();
        presentation.present(|| children_visible.set(true)); // A later raise is also denied.
        presentation.terminate(); // Duplicate callbacks cannot clear the latch.
        queued_layout();
        assert!(presentation.unavailable());
        assert!(!children_visible.get());
        assert_eq!(effects.get(), 0);
    }

    #[test]
    fn one_latch_per_label_never_repeats_or_loops() {
        assert!(super::first_termination("main"));
        assert!(!super::first_termination("main"));
        assert!(super::first_termination("terminal-0"));
        assert!(!super::first_termination("terminal-0"));
    }
}
