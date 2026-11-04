#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod sidecar;

use tauri::webview::NewWindowResponse;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

fn main() {
    tauri::Builder::default()
        // Adapted from Anywh lib.rs at the same pinned commit as sidecar.rs.
        // A second native launch focuses the first window before starting a Core.
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_shell::init())
        .manage(sidecar::DesktopCore::default())
        .setup(|app| {
            let origin = tauri::async_runtime::block_on(sidecar::start(app.handle()))?;
            let allowed_origin = origin.clone();
            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(origin.parse()?))
                .title("ORQST")
                .inner_size(1280.0, 860.0)
                .min_inner_size(720.0, 480.0)
                .on_navigation(move |url| {
                    // The remote dashboard has no Tauri capabilities or shell API.
                    url.origin().ascii_serialization() == allowed_origin
                        && url.username().is_empty()
                        && url.password().is_none()
                        && url.query().is_none()
                })
                .on_new_window(|_, _| NewWindowResponse::Deny)
                .build()?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("ORQST could not initialize the native Desktop")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                sidecar::stop(app);
            }
        });
}
