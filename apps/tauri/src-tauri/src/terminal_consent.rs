//! Native authorization sheet. Adapts ORQST offline_recovery_details plain-text controls.
//! No renderer authority, nested modal loop, signing, runtime mutation or application lock.
use objc2::encode::{Encode, Encoding};
use objc2::rc::Retained;
use objc2::runtime::{AnyClass, AnyObject, ClassBuilder, NSObject, Sel};
use objc2::{msg_send, sel, ClassType};
use std::ffi::c_void;
use std::sync::OnceLock;
use tokio::sync::oneshot;
#[path = "terminal_consent_layout.rs"]
mod layout;
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

#[repr(C)]
#[derive(Clone, Copy)]
struct Point {
    x: f64,
    y: f64,
}
// SAFETY: repr(C), two CGFloat=f64 fields on 64-bit macOS.
unsafe impl Encode for Point {
    const ENCODING: Encoding = Encoding::Struct("CGPoint", &[f64::ENCODING, f64::ENCODING]);
}
#[repr(C)]
#[derive(Clone, Copy)]
struct Rect {
    origin: Point,
    size: Size,
}
// SAFETY: repr(C), CGPoint followed by CGSize, matching NSRect on 64-bit macOS.
unsafe impl Encode for Rect {
    const ENCODING: Encoding = Encoding::Struct("CGRect", &[Point::ENCODING, Size::ENCODING]);
}
struct Completion {
    sender: oneshot::Sender<bool>,
    // AppKit may respond after the async receiver has gone away. Keep both targets alive.
    _alert: Retained<AnyObject>,
    _delegate: Retained<AnyObject>,
}
static DELEGATE: OnceLock<&'static AnyClass> = OnceLock::new();
extern "C-unwind" fn ended(
    _: &AnyObject,
    _: Sel,
    _: *mut AnyObject,
    response: isize,
    context: *mut c_void,
) {
    if !context.is_null() {
        // SAFETY: beginSheetModalForWindow transfers one Box to its one-shot delegate on
        // the main thread. No timeout/cancellation path frees the callback context.
        let completion = unsafe { Box::from_raw(context.cast::<Completion>()) };
        let _ = completion.sender.send(response == 1001);
    }
}
fn delegate_class() -> Option<&'static AnyClass> {
    if let Some(class) = DELEGATE.get() {
        return Some(class);
    }
    let mut builder = ClassBuilder::new(c"OrqstTerminalConsentDelegate", NSObject::class())?;
    // SAFETY: NSAlert's delegate ABI is (alert, NSInteger, void*).
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
    window: &tauri::Window,
    labels: &[String; 5],
    sender: oneshot::Sender<bool>,
    current: impl FnOnce() -> bool,
) -> Option<()> {
    let [title, message, detail, cancel, approve] = labels;
    let parent = window.ns_window().ok()?.cast::<AnyObject>();
    let screen: *mut AnyObject = msg_send![parent, screen];
    let attached: *mut AnyObject = msg_send![parent, attachedSheet];
    if screen.is_null() || !attached.is_null() {
        return None;
    }
    let screen: Rect = msg_send![screen, visibleFrame];
    let parent_frame: Rect = msg_send![parent, frame];
    let available = (
        screen.size.width.min(parent_frame.size.width),
        screen.size.height.min(parent_frame.size.height),
    );
    let alert = object(c"NSAlert")?;
    let detail = layout::review_text(title, message, detail);
    let scroll = object(c"NSScrollView")?;
    let view = object(c"NSTextView")?;
    let size = Size {
        width: 640.0,
        height: 360.0,
    };
    let _: () = msg_send![&*scroll, setFrameSize: size];
    let _: () = msg_send![&*scroll, setHasVerticalScroller: true];
    let _: () = msg_send![&*scroll, setHasHorizontalScroller: false];
    let size: Size = msg_send![&*scroll, contentSize];
    let _: () = msg_send![&*view, setFrameSize: size];
    let _: () = msg_send![&*view, setMinSize: size];
    let _: () = msg_send![&*view, setMaxSize: Size { width: size.width, height: f64::MAX }];
    let _: () = msg_send![&*view, setVerticallyResizable: true];
    let _: () = msg_send![&*view, setHorizontallyResizable: false];
    let _: () = msg_send![&*view, setAutoresizingMask: 2usize]; // NSViewWidthSizable
    let container: *mut AnyObject = msg_send![&*view, textContainer];
    if container.is_null() {
        return None;
    }
    let _: () = msg_send![container, setContainerSize: Size { width: size.width, height: f64::MAX }];
    let _: () = msg_send![container, setWidthTracksTextView: true];
    let _: () = msg_send![&*view, setRichText: false];
    let _: () = msg_send![&*view, setImportsGraphics: false];
    let _: () = msg_send![&*view, setAutomaticLinkDetectionEnabled: false];
    let _: () = msg_send![&*view, setEditable: false];
    let _: () = msg_send![&*view, setSelectable: true];
    let content = string(&detail)?;
    let _: () = msg_send![&*view, setString: &*content];
    let _: () = msg_send![&*view, sizeToFit];
    let _: () = msg_send![&*scroll, setDocumentView: &*view];
    let _: () = msg_send![&*alert, setAccessoryView: &*scroll];

    // All original title/message/detail remain in the scroll view. Only a compact title
    // is repeated in NSAlert's non-scrolling chrome; pathological titles cannot grow it.
    let heading = string(if title.chars().count() <= 80 { title } else { "" })?;
    let _: () = msg_send![&*alert, setMessageText: &*heading];
    let cancel = string(cancel)?;
    let approve = string(approve)?;
    let cancel_button: *mut AnyObject = msg_send![&*alert, addButtonWithTitle: &*cancel];
    let approve_button: *mut AnyObject = msg_send![&*alert, addButtonWithTitle: &*approve];
    if cancel_button.is_null() || approve_button.is_null() {
        return None;
    }
    let escape = string("\u{1b}")?;
    let empty = string("")?;
    let _: () = msg_send![cancel_button, setKeyEquivalent: &*escape];
    let _: () = msg_send![approve_button, setKeyEquivalent: &*empty];
    let native_window: *mut AnyObject = msg_send![&*alert, window];
    let cell: *mut AnyObject = msg_send![cancel_button, cell];
    let _: () = msg_send![native_window, setDefaultButtonCell: cell];
    // Measure real AppKit chrome/buttons rather than guessing font/localization heights.
    // Shrink only the accessory. If native chrome itself cannot fit, refuse approval.
    let mut fitted = false;
    for _ in 0..4 {
        let _: () = msg_send![&*alert, layout];
        let frame: Rect = msg_send![native_window, frame];
        let accessory: Rect = msg_send![&*scroll, frame];
        let Some((width, height)) = layout::fit(
            available,
            (frame.size.width, frame.size.height),
            (accessory.size.width, accessory.size.height),
        ) else {
            return None;
        };
        if width == accessory.size.width && height == accessory.size.height {
            fitted = true;
            break;
        }
        let _: () = msg_send![&*scroll, setFrameSize: Size { width, height }];
        let clip: Size = msg_send![&*scroll, contentSize];
        let _: () = msg_send![&*view, setMinSize: clip];
        let _: () = msg_send![&*view, setFrameSize: clip];
        let _: () = msg_send![container, setContainerSize: Size { width: clip.width, height: f64::MAX }];
        let _: () = msg_send![&*view, sizeToFit];
    }
    if !fitted || !current() {
        return None;
    }
    let delegate: *mut AnyObject = msg_send![delegate_class()?, new];
    let delegate = Retained::from_raw(delegate)?;
    let completion = Box::new(Completion {
        sender,
        _alert: alert.clone(),
        _delegate: delegate.clone(),
    });
    let context = Box::into_raw(completion).cast::<c_void>();
    let _: () = msg_send![&*alert, beginSheetModalForWindow: parent, modalDelegate: &*delegate, didEndSelector: sel!(alertDidEnd:returnCode:contextInfo:), contextInfo: context];
    Some(())
}

pub async fn confirm(
    app: &tauri::AppHandle,
    window: tauri::Window,
    labels: [String; 5],
    current: impl FnOnce() -> bool + Send + 'static,
) -> bool {
    let (sender, receiver) = oneshot::channel();
    if app
        .run_on_main_thread(move || {
            // SAFETY: every AppKit object/getter and callback target lives on this thread.
            // On failure the sender drops, yielding false; no automatic approval or retry.
            let _ = unsafe { show(&window, &labels, sender, current) };
        })
        .is_err()
    {
        return false;
    }
    receiver.await.unwrap_or(false)
}
