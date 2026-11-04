//! Plain-text scrollable AppKit details, using the existing objc2 dependency only.
//! All native objects/getters are confined to the UI thread; no signing or application lock.
use super::guard::{clock, ClockSample};
use objc2::encode::{Encode, Encoding};
use objc2::rc::Retained;
use objc2::runtime::{AnyClass, AnyObject, ClassBuilder, NSObject, Sel};
use objc2::{msg_send, sel, ClassType};
use std::cell::Cell;
use std::ffi::c_void;
use std::rc::Rc;
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
pub struct SheetReply {
    pub response: isize,
    pub clicked: ClockSample,
}
struct Completion {
    reply: Cell<Option<(isize, ClockSample)>>,
    // Retain all callback targets even if the nested loop returns before completion.
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
    // SAFETY: AppKit invokes this delegate on its UI thread for this modal sheet only.
    unsafe {
        // Retain targets through stopModal, including a callback after the caller returned.
        let completion = (!context.is_null()).then(|| Rc::from_raw(context.cast::<Completion>()));
        if let Some(completion) = &completion {
            completion
                .reply
                .set(clock().map(|clicked| (response, clicked)));
        }
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
    let reply = run_sheet(&alert, &delegate, parent)?;
    Some(reply.response == 1001) // Back, never approval.
}
unsafe fn run_sheet(
    alert: &Retained<AnyObject>,
    delegate: &Retained<AnyObject>,
    parent: *mut AnyObject,
) -> Option<SheetReply> {
    let completion = Rc::new(Completion {
        reply: Cell::new(None),
        _alert: alert.clone(),
        _delegate: delegate.clone(),
    });
    // AppKit consumes this reference in ended. If completion is uncertain, retain it rather
    // than freeing a context/delegate that a later native callback may still address.
    let context = Rc::into_raw(completion.clone()).cast::<c_void>();
    let _: () = msg_send![&**alert, beginSheetModalForWindow: parent, modalDelegate: &**delegate, didEndSelector: sel!(alertDidEnd:returnCode:contextInfo:), contextInfo: context];
    let response: isize = msg_send![&**alert, runModal];
    let (observed, clicked) = completion.reply.get()?;
    if response != observed {
        return None;
    }
    Some(SheetReply { response, clicked })
}

pub fn summary(
    app: &tauri::AppHandle,
    window: &tauri::WebviewWindow,
    labels: [String; 5],
    generation: u64,
    deadline: Instant,
) -> Option<SheetReply> {
    let [title, message, cancel, second, third] = labels;
    let native = app.clone();
    let window = window.clone();
    let (sender, receiver) = std::sync::mpsc::sync_channel(1);
    app.run_on_main_thread(move || {
        let result = (|| {
            if !super::current(&native, &window, generation, deadline)
                || !window.is_focused().unwrap_or(false)
            {
                return None;
            }
            // SAFETY: all objects and the completion context remain on AppKit's UI thread.
            unsafe {
                let alert = object(c"NSAlert")?;
                let delegate: *mut AnyObject = msg_send![delegate_class()?, new];
                let delegate = Retained::from_raw(delegate)?;
                let title = string(&title)?;
                let message = string(&message)?;
                let _: () = msg_send![&*alert, setMessageText: &*title];
                let _: () = msg_send![&*alert, setInformativeText: &*message];
                let cancel = string(&cancel)?;
                let button: *mut AnyObject = msg_send![&*alert, addButtonWithTitle: &*cancel];
                if button.is_null() {
                    return None;
                }
                for label in [second, third] {
                    let label = string(&label)?;
                    let _: *mut AnyObject = msg_send![&*alert, addButtonWithTitle: &*label];
                }
                let escape = string("\u{1b}")?;
                let _: () = msg_send![button, setKeyEquivalent: &*escape];
                let alert_window: *mut AnyObject = msg_send![&*alert, window];
                let cell: *mut AnyObject = msg_send![button, cell];
                let _: () = msg_send![alert_window, setDefaultButtonCell: cell];
                run_sheet(
                    &alert,
                    &delegate,
                    window.ns_window().ok()?.cast::<AnyObject>(),
                )
            }
        })();
        if result.is_none() {
            super::uncertain(&native);
        }
        let _ = sender.send(result);
    })
    .ok()?;
    receiver.recv().ok()?
}

pub fn details(
    app: &tauri::AppHandle,
    window: &tauri::WebviewWindow,
    detail: &str,
    labels: [String; 3],
    generation: u64,
    deadline: Instant,
) -> bool {
    if detail.len() > 64 * 1024 {
        return false;
    }
    let [title, cancel, back] = labels;
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
            let result = unsafe { show(&window, &detail, &title, &cancel, &back) };
            if result.is_none() {
                super::uncertain(&native);
            }
            let available = result.unwrap_or(false);
            let _ =
                sender.send(available && super::current(&native, &window, generation, deadline));
        })
        .is_err()
    {
        return false;
    }
    // This is a pre-consent read bounded only by the original session deadline.
    // Wait for this sheet's completion even after expiry: never put a second modal above
    // an uncertain first sheet or claim that it/helper exited merely because a timer fired.
    receiver.recv().unwrap_or(false)
}
