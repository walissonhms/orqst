#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod agents;
mod desktop;
mod files;
mod features;
mod sidecar;
mod terminal;
mod terminal_creation;

use tauri::webview::NewWindowResponse;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

fn main() {
    tauri::Builder::default()
        // Adapted from Anywh lib.rs at the same pinned commit as sidecar.rs.
        // A second native launch focuses the first window before starting a Core.
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            desktop::focus(app);
        }))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .manage(desktop::Desktop::default())
        .manage(sidecar::DesktopCore::default())
        .manage(terminal::Terminals::default())
        .manage(agents::Agents::default())
        .manage(files::Files::default())
        .manage(features::Features::default())
        .invoke_handler(tauri::generate_handler![terminal::terminal_request, terminal::terminal_view, agents::agents_request, files::file_request, features::feature_request])
        .manage(terminal_creation::Preparation::default())
        .on_window_event(|window,event| { terminal_creation::on_window_event(window,event); features::on_window_event(window,event); })
        .register_uri_scheme_protocol("orqst-terminal", |context, request| {
            let resource = (request.method() == tauri::http::Method::GET)
                .then(|| terminal::resource(context.app_handle(), request.uri())).flatten();
            let (status, body, content_type) = match resource {
                Some((body, content_type)) => (200, body, content_type),
                None => (404, Vec::new(), "text/plain"),
            };
            tauri::http::Response::builder().status(status)
                .header("Content-Type", content_type)
                .header("Cache-Control", "no-store")
                .header("X-Content-Type-Options", "nosniff")
                .header("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src ipc: http://ipc.localhost; img-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
                .body(body).expect("static terminal response")
        })
        .register_uri_scheme_protocol("orqst-features", |context, request| {
            let resource = (request.method() == tauri::http::Method::GET)
                .then(|| features::resource(context.app_handle(), request.uri())).flatten();
            let (status,body,mime) = resource.map(|(b,m)|(200,b,m)).unwrap_or((404,Vec::new(),"text/plain"));
            tauri::http::Response::builder().status(status).header("Content-Type",mime)
                .header("Cache-Control","no-store").header("X-Content-Type-Options","nosniff")
                .header("Content-Security-Policy","default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src ipc: http://ipc.localhost; img-src 'self' data:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
                .body(body).expect("static Feature response")
        })
        .register_uri_scheme_protocol("orqst-agents", |context, request| {
            let resource = (request.method() == tauri::http::Method::GET)
                .then(|| agents::resource(context.app_handle(), request.uri())).flatten();
            let (status, body, content_type) = match resource {
                Some((body, content_type)) => (200, body, content_type),
                None => (404, Vec::new(), "text/plain"),
            };
            tauri::http::Response::builder().status(status)
                .header("Content-Type", content_type)
                .header("Cache-Control", "no-store")
                .header("X-Content-Type-Options", "nosniff")
                .header("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self'; connect-src ipc: http://ipc.localhost; img-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
                .body(body).expect("static terminal response")
        })
        .setup(|app| {
            desktop::install(app.handle())?;
            let origin = tauri::async_runtime::block_on(sidecar::start(app.handle()))?;
            let allowed_origin = origin.clone();
            let feature_client = features::configure(app.handle(), &origin)?;
            let file_client = match tauri::async_runtime::block_on(files::start(app.handle(), &origin)) {
                Ok(client) => client,
                Err(_) => {
                    files::stop(app.handle());
                    eprintln!("ORQST native export startup refused.");
                    String::new()
                }
            };
            let export_handle = app.handle().clone();
            let dashboard = WebviewWindowBuilder::new(app, "main", WebviewUrl::External(origin.parse()?))
                .title("ORQST")
                .user_agent("ORQSTTauri/0.1 ORQSTDesktop/0.1")
                .initialization_script(file_client)
                .initialization_script(feature_client)
                .inner_size(1280.0, 860.0)
                .min_inner_size(720.0, 480.0)
                .on_navigation(move |url| {
                    // The owned dashboard has only narrow native export commands.
                    url.origin().ascii_serialization() == allowed_origin
                        && url.username().is_empty()
                        && url.password().is_none()
                        && url.query().is_none()
                })
                .on_new_window(|_, _| NewWindowResponse::Deny)
                .on_page_load(|window, payload| {
                    if payload.event() == tauri::webview::PageLoadEvent::Started {
                        terminal_creation::invalidate(window.app_handle());
                        files::invalidate(window.app_handle());
                        features::invalidate(window.app_handle(), "main");
                    }
                })
                .build()?;
            let main = app.get_webview_window("main").expect("created dashboard");
            let native = app.handle().clone();
            main.on_window_event(move |event| desktop::main_window_event(&native, event));
            dashboard.on_window_event(move |event| {
                if matches!(event, tauri::WindowEvent::CloseRequested { .. } | tauri::WindowEvent::Destroyed) {
                    files::invalidate(&export_handle);
                    features::invalidate(&export_handle, "main");
                }
                if matches!(event, tauri::WindowEvent::Destroyed) {
                    files::stop(&export_handle);
                }
            });
            // Explicit opt-in only. A terminal failure does not replace or stop observation.
            if tauri::async_runtime::block_on(terminal::start(app.handle())).is_err() {
                terminal::stop(app.handle());
                eprintln!("ORQST managed terminal startup refused.");
            }
            features::install_workspace(app.handle())?;
            if tauri::async_runtime::block_on(agents::start(app.handle())).is_err() {
                agents::stop(app.handle());
                eprintln!("ORQST managed agents startup refused.");
            }
            terminal_creation::install(app.handle())?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("ORQST could not initialize the native Desktop")
        .run(|app, event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = event { desktop::focus(app); }
            if let tauri::RunEvent::ExitRequested { ref api, .. } = event {
                if terminal::confirm_exit(app) || agents::confirm_exit(app) { api.prevent_exit(); }
            }
            if let tauri::RunEvent::Exit = event {
                desktop::stop(app);
                agents::stop_and_wait(app);
                terminal_creation::stop(app);
                terminal::stop_and_wait(app);
                files::stop(app);
                sidecar::stop(app);
            }
        });
}
