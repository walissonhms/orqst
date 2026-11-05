//! AppKit focus metadata and process-lifetime revocation observers. No focus mutation.
use objc2::runtime::{AnyClass, AnyObject, ClassBuilder, NSObject, Sel};
use objc2::{msg_send, sel, ClassType};
use std::sync::OnceLock;
use tauri::Manager;

static APP: OnceLock<tauri::AppHandle> = OnceLock::new();
static OBSERVING: OnceLock<()> = OnceLock::new();

#[derive(Debug, Copy, Clone, Default)]
pub(super) struct Focus {
    pub active: bool,
    pub has_sheet: bool,
    pub key_is_parent: bool,
    pub key_is_sheet: bool,
}

impl Focus {
    pub fn owns_sheet(self, current_review: bool) -> bool {
        current_review && self.active && self.has_sheet && self.key_is_sheet
    }

    pub(super) fn owns_key(self, current_review: bool) -> bool {
        self.active && (self.key_is_parent || self.owns_sheet(current_review))
    }
}

// Call only on the AppKit UI thread. Native pointer identity never leaves this call.
pub(super) fn sample(window: &tauri::Window) -> Option<Focus> {
    let pointer = window.ns_window().ok()?;
    // SAFETY: the owned NSWindow is live; all objects are synchronously borrowed on the UI thread.
    unsafe {
        let parent = pointer.cast::<AnyObject>();
        let native_app: *mut AnyObject =
            msg_send![AnyClass::get(c"NSApplication")?, sharedApplication];
        if parent.is_null() || native_app.is_null() {
            return None;
        }
        let active: bool = msg_send![native_app, isActive];
        let key: *mut AnyObject = msg_send![native_app, keyWindow];
        let sheet: *mut AnyObject = msg_send![parent, attachedSheet];
        let sheet_parent: *mut AnyObject = if sheet.is_null() {
            std::ptr::null_mut()
        } else {
            msg_send![sheet, sheetParent]
        };
        Some(Focus {
            active,
            has_sheet: !sheet.is_null() && sheet_parent == parent,
            key_is_parent: key == parent,
            key_is_sheet: !sheet.is_null() && key == sheet && sheet_parent == parent,
        })
    }
}

extern "C-unwind" fn deactivated(_: &AnyObject, _: Sel, _: *mut AnyObject) {
    if let Some(app) = APP.get() {
        crate::desktop::quit_deactivated(app);
        crate::terminal_creation::invalidate(app);
        crate::offline_recovery::invalidate(app);
        super::native_focus_lost(app, "application-deactivated");
    }
}

extern "C-unwind" fn key_changed(_: &AnyObject, _: Sel, _: *mut AnyObject) {
    let Some(app) = APP.get() else { return };
    crate::desktop::quit_key_changed(app);
    crate::terminal_creation::native_key_changed(app);
    crate::offline_recovery::native_key_changed(app);
    let Some(window) = app.get_window("main") else {
        return;
    };
    if !sample(&window).is_some_and(|focus| focus.owns_key(super::current_review(app))) {
        super::native_focus_lost(app, "another-key-window");
    }
}

// Install on the UI thread before any sheet exception is permitted. One observer is
// deliberately retained until process exit, matching the single native app lifetime.
// A sheet has no Tauri WindowEvent delegate: NSApp deactivation and another key window
// must still revoke the pending review even while the parent is already unfocused.
pub(super) fn install(app: &tauri::AppHandle) -> bool {
    if OBSERVING.get().is_some() {
        return true;
    }
    let _ = APP.set(app.clone());
    let Some(mut builder) = ClassBuilder::new(c"OrqstTerminalFocusObserver", NSObject::class())
    else {
        return false;
    };
    // SAFETY: selectors and Objective-C method ABIs match NotificationCenter callbacks.
    unsafe {
        builder.add_method(
            sel!(deactivated:),
            deactivated as extern "C-unwind" fn(_, _, _),
        );
        builder.add_method(
            sel!(keyChanged:),
            key_changed as extern "C-unwind" fn(_, _, _),
        );
        let class = builder.register();
        let observer: *mut AnyObject = msg_send![class, new];
        let Some(center_class) = AnyClass::get(c"NSNotificationCenter") else {
            return false;
        };
        let Some(string_class) = AnyClass::get(c"NSString") else {
            return false;
        };
        let center: *mut AnyObject = msg_send![center_class, defaultCenter];
        if observer.is_null() || center.is_null() {
            return false;
        }
        for (name, selector) in [
            (
                c"NSApplicationDidResignActiveNotification",
                sel!(deactivated:),
            ),
            (c"NSWindowDidBecomeKeyNotification", sel!(keyChanged:)),
        ] {
            let name: *mut AnyObject = msg_send![string_class, stringWithUTF8String: name.as_ptr()];
            let _: () = msg_send![center, addObserver: observer, selector: selector, name: name, object: std::ptr::null::<AnyObject>()];
        }
    }
    let _ = OBSERVING.set(());
    true
}

pub(super) fn ready() -> bool {
    OBSERVING.get().is_some()
}

#[cfg(test)]
mod tests {
    use super::Focus;

    #[test]
    fn sheet_exception_requires_the_exact_active_parent_relationship_and_current_review() {
        let sheet = Focus {
            active: true,
            has_sheet: true,
            key_is_parent: false,
            key_is_sheet: true,
        };
        assert!(sheet.owns_sheet(true));
        assert!(!sheet.owns_sheet(false)); // Revoked generation cannot return to its old sheet.
        assert!(!Focus {
            active: false,
            ..sheet
        }
        .owns_sheet(true));
        assert!(!Focus {
            has_sheet: false,
            ..sheet
        }
        .owns_sheet(true));
        assert!(!Focus {
            key_is_sheet: false,
            ..sheet
        }
        .owns_sheet(true));
        assert!(!Focus {
            key_is_parent: true,
            ..Focus::default()
        }
        .owns_sheet(true));
        assert!(Focus {
            active: true,
            key_is_parent: true,
            ..Focus::default()
        }
        .owns_key(false));
        assert!(!Focus {
            active: false,
            key_is_parent: true,
            ..Focus::default()
        }
        .owns_key(true));
    }
}
