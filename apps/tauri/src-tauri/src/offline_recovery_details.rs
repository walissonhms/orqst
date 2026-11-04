//! Plain-text scrollable AppKit details, using the existing objc2 dependency only.
//! All native objects/getters are confined to the UI thread; no signing or application lock.
use objc2::encode::{Encode, Encoding};
use objc2::rc::Retained;
use objc2::runtime::{AnyClass, AnyObject, ClassBuilder, NSObject, Sel};
use objc2::{msg_send, sel, ClassType};
use std::ffi::c_void;
use std::sync::OnceLock;
use std::time::Instant;

// NSSize is CGSize on 64-bit macOS. This ABI matches the locked AppKit bindings.
#[repr(C)]
#[derive(Clone, Copy)]
struct Size {
    width: f64,
    height: f64,
}
// SAFETY: repr(C), two CGFloat=f64 fields on the supported 64-bit macOS target.
unsafe impl Encode for Size {
    const ENCODING: Encoding = Encoding::Struct("CGSize", &[f64::ENCODING, f64::ENCODING]);
}
static DELEGATE: OnceLock<&'static AnyClass> = OnceLock::new();

extern "C-unwind" fn ended(
    _: &AnyObject,
    _: Sel,
    _: *mut AnyObject,
    response: isize,
    _: *mut c_void,
) {
    // SAFETY: AppKit invokes this delegate on its UI thread for this modal sheet only.
    unsafe {
        if let Some(class) = AnyClass::get(c"NSApplication") {
            let app: *mut AnyObject = msg_send![class, sharedApplication];
            let _: () = msg_send![app, stopModalWithCode: response];
        }
    }
}
fn delegate_class() -> Option<&'static AnyClass> {
    if let Some(class) = DELEGATE.get() {
        return Some(class);
    }
    let mut builder = ClassBuilder::new(c"OrqstRecoveryDetailsDelegate", NSObject::class())?;
    // SAFETY: the documented deprecated NSAlert delegate ABI is (alert, NSInteger, void*).
    unsafe {
        builder.add_method(
            sel!(alertDidEnd:returnCode:contextInfo:),
            ended as extern "C-unwind" fn(_, _, _, _, _),
        );
    }
    let class = builder.register();
    let _ = DELEGATE.set(class);
    Some(class)
}
unsafe fn string(value: &str) -> Option<Retained<AnyObject>> {
    let allocated: *mut AnyObject = msg_send![AnyClass::get(c"NSString")?, alloc];
    let value: *mut AnyObject = msg_send![allocated, initWithBytes: value.as_ptr().cast::<c_void>(), length: value.len(), encoding: 4usize];
    Retained::from_raw(value)
}
unsafe fn object(class: &'static std::ffi::CStr) -> Option<Retained<AnyObject>> {
    let value: *mut AnyObject = msg_send![AnyClass::get(class)?, new];
    Retained::from_raw(value)
}
unsafe fn show(
    window: &tauri::WebviewWindow,
    detail: &str,
    title: &str,
    cancel: &str,
    back: &str,
) -> Option<bool> {
    let parent = window.ns_window().ok()?.cast::<AnyObject>();
    let alert = object(c"NSAlert")?;
    let scroll = object(c"NSScrollView")?;
    let view = object(c"NSTextView")?;
    let delegate: *mut AnyObject = msg_send![delegate_class()?, new];
    let delegate = Retained::from_raw(delegate)?;
    let size = Size {
        width: 640.0,
        height: 360.0,
    };
    let _: () = msg_send![&*scroll, setFrameSize: size];
    let _: () = msg_send![&*scroll, setHasVerticalScroller: true];
    let _: () = msg_send![&*scroll, setHasHorizontalScroller: false];
    let _: () = msg_send![&*view, setFrameSize: size];
    let _: () = msg_send![&*view, setMinSize: size];
    let _: () = msg_send![&*view, setMaxSize: Size { width: 640.0, height: f64::MAX }];
    let _: () = msg_send![&*view, setVerticallyResizable: true];
    let _: () = msg_send![&*view, setHorizontallyResizable: false];
    let _: () = msg_send![&*view, setAutoresizingMask: 2usize]; // NSViewWidthSizable
    let container: *mut AnyObject = msg_send![&*view, textContainer];
    if container.is_null() {
        return None;
    }
    let _: () = msg_send![container, setContainerSize: Size { width: 640.0, height: f64::MAX }];
    let _: () = msg_send![container, setWidthTracksTextView: true];
    let _: () = msg_send![&*view, setRichText: false];
    let _: () = msg_send![&*view, setImportsGraphics: false];
    let _: () = msg_send![&*view, setAutomaticLinkDetectionEnabled: false];
    let _: () = msg_send![&*view, setEditable: false];
    let _: () = msg_send![&*view, setSelectable: true];
    let content = string(detail)?;
    let _: () = msg_send![&*view, setString: &*content];
    let _: () = msg_send![&*view, sizeToFit];
    let _: () = msg_send![&*scroll, setDocumentView: &*view];
    let _: () = msg_send![&*alert, setAccessoryView: &*scroll];
    let title = string(title)?;
    let _: () = msg_send![&*alert, setMessageText: &*title];
    let cancel = string(cancel)?;
    let cancel_button: *mut AnyObject = msg_send![&*alert, addButtonWithTitle: &*cancel];
    let back = string(back)?;
    let _: *mut AnyObject = msg_send![&*alert, addButtonWithTitle: &*back];
    if cancel_button.is_null() {
        return None;
    }
    let escape = string("\u{1b}")?;
    let _: () = msg_send![cancel_button, setKeyEquivalent: &*escape];
    let alert_window: *mut AnyObject = msg_send![&*alert, window];
    let cell: *mut AnyObject = msg_send![cancel_button, cell];
    let _: () = msg_send![alert_window, setDefaultButtonCell: cell];
    // Use the documented selector delegate rather than introducing a block ABI/dependency.
    // NSAlert's completion stops its nested modal loop, matching the existing dialog backend.
    let _: () = msg_send![&*alert, beginSheetModalForWindow: parent, modalDelegate: &*delegate, didEndSelector: sel!(alertDidEnd:returnCode:contextInfo:), contextInfo: std::ptr::null_mut::<c_void>()];
    let response: isize = msg_send![&*alert, runModal];
    Some(response == 1001) // NSAlertSecondButtonReturn: Back; never approval.
}

pub fn details(
    app: &tauri::AppHandle,
    window: &tauri::WebviewWindow,
    detail: &str,
    title: String,
    cancel: String,
    back: String,
    generation: u64,
    deadline: Instant,
) -> bool {
    if detail.len() > 64 * 1024 {
        return false;
    }
    let detail = detail.to_owned();
    let window = window.clone();
    let native = app.clone();
    let (sender, receiver) = std::sync::mpsc::sync_channel(1);
    if app
        .run_on_main_thread(move || {
            if !super::current(&native, &window, generation, deadline)
                || !window.is_focused().unwrap_or(false)
            {
                let _ = sender.send(false);
                return;
            }
            // SAFETY: owned Tauri window and retained AppKit objects remain on the UI thread
            // through the modal loop. Text is inserted with setString, never interpreted as HTML.
            let available =
                unsafe { show(&window, &detail, &title, &cancel, &back) }.unwrap_or(false);
            let _ =
                sender.send(available && super::current(&native, &window, generation, deadline));
        })
        .is_err()
    {
        return false;
    }
    // The caller and helper independently enforce the original 30-second deadline.
    // Wait for this sheet's completion even after expiry: never put a second modal above
    // an uncertain first sheet or claim that it/helper exited merely because a timer fired.
    receiver.recv().unwrap_or(false)
}
