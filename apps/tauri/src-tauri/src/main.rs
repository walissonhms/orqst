#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod agents;
mod desktop;
mod features;
mod files;
mod local_diagnostics;
mod offline_recovery;
mod sidecar;
mod terminal;
mod terminal_creation;
mod unavailable;
mod webview_policy;

use tauri::webview::{NewWindowResponse, PermissionResponse};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

fn allowed_dashboard_navigation(url: &tauri::Url, origin: Option<&str>) -> bool {
    unavailable::allowed_navigation(url, origin)
        && (url.as_str() == unavailable::URL || webview_policy::dashboard_path_allowed(url.path()))
}

fn main() {
    tauri::Builder::default()
        .on_permission_request(|_, _| PermissionResponse::Deny)
        // Adapted from Anywh lib.rs at the same pinned commit as sidecar.rs.
        // A second native launch focuses the first window before starting a Core.
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("offline-recovery") {
                let _ = window.show();
                let _ = window.set_focus();
            } else {
                desktop::focus(app);
            }
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
        .invoke_handler(tauri::generate_handler![terminal::terminal_request, terminal::terminal_open_prepared, terminal::terminal_view, agents::agents_request, files::file_request, features::feature_request, terminal_creation::studio_request])
        .manage(terminal_creation::Preparation::default())
        .manage(offline_recovery::Recovery::default())
        .on_window_event(|window,event| { offline_recovery::on_window_event(window,event); terminal_creation::on_window_event(window,event); features::on_window_event(window,event); })
        .register_uri_scheme_protocol("orqst-recovery", |_, request| offline_recovery::response(&request))
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
        .register_uri_scheme_protocol("orqst-unavailable", |_, request| {
            unavailable::response(&request)
        })
        .setup(|app| {
            if let Ok(parent) = app.path().app_data_dir() {
                local_diagnostics::install(parent);
            }
            // Fixed native entry is selected before observer/Core, file hosts or managed providers.
            if offline_recovery::requested() {
                return offline_recovery::install(app.handle());
            }
            let diagnostic = local_diagnostics::Attempt::begin();
            diagnostic.record(local_diagnostics::Stage::NativeSetup, local_diagnostics::Outcome::Started, local_diagnostics::Effects::Unconfirmed);
            desktop::install(app.handle())?;
            let origin = tauri::async_runtime::block_on(sidecar::start(app.handle(), diagnostic.clone())).ok();
            diagnostic.record(local_diagnostics::Stage::ObserverStartup, if origin.is_some() { local_diagnostics::Outcome::Ready } else { local_diagnostics::Outcome::Failed }, local_diagnostics::Effects::Unconfirmed);
            desktop::configure(app.handle(), origin.as_deref());
            let allowed_origin = origin.clone();
            let feature_client = origin.as_deref().map(|origin| features::configure(app.handle(), origin)).transpose()?.unwrap_or_default();
            let studio_client = origin.as_deref().map(|origin| terminal_creation::configure(app.handle(), origin)).transpose()?.unwrap_or_default();
            let file_client = match origin.as_deref().map(|origin| tauri::async_runtime::block_on(files::start(app.handle(), origin))) {
                None => String::new(),
                Some(Ok(client)) => client,
                Some(Err(_)) => {
                    files::stop(app.handle());
                    eprintln!("ORQST native export startup refused.");
                    String::new()
                }
            };
            let export_handle = app.handle().clone();
            let dashboard_url = origin.as_deref().unwrap_or(unavailable::URL).parse()?;
            let dashboard = WebviewWindowBuilder::new(app, "main", WebviewUrl::External(dashboard_url))
                .title("ORQST")
                .user_agent("ORQSTTauri/0.1 ORQSTDesktop/0.1")
                .initialization_script(file_client)
                .initialization_script(feature_client)
                .initialization_script(studio_client)
                .inner_size(1280.0, 860.0)
                .min_inner_size(720.0, 480.0)
                .on_navigation(move |url| {
                    // The owned dashboard has only narrow native export commands.
                    allowed_dashboard_navigation(url, allowed_origin.as_deref())
                })
                .on_new_window(|_, _| NewWindowResponse::Deny)
                .on_download(|_, _| false)
                .on_page_load(|window, payload| {
                    if payload.event() == tauri::webview::PageLoadEvent::Started {
                        terminal_creation::invalidate(window.app_handle());
                        files::invalidate(window.app_handle());
                        features::invalidate(window.app_handle(), "main");
                    }
                })
                .build()?;
            let native = app.handle().clone();
            dashboard.on_window_event(move |event| desktop::main_window_event(&native, event));
            dashboard.on_window_event(move |event| {
                if matches!(event, tauri::WindowEvent::CloseRequested { .. } | tauri::WindowEvent::Destroyed) {
                    files::invalidate(&export_handle);
                    features::invalidate(&export_handle, "main");
                }
                if matches!(event, tauri::WindowEvent::Destroyed) {
                    files::stop(&export_handle);
                }
            });
            // An observer startup failure exposes no preparation or additional hosts.
            // Existing owned-host state is never stopped by this unavailable view.
            if origin.is_none() {
                diagnostic.record(local_diagnostics::Stage::NativeSetup, local_diagnostics::Outcome::Ready, local_diagnostics::Effects::Unconfirmed);
                return Ok(());
            }
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
            diagnostic.record(local_diagnostics::Stage::NativeSetup, local_diagnostics::Outcome::Ready, local_diagnostics::Effects::Unconfirmed);
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("ORQST could not initialize the native Desktop")
        .run(|app, event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = event { desktop::focus(app); }
            if let tauri::RunEvent::ExitRequested { ref api, .. } = event {
                terminal_creation::invalidate(app);
                if terminal::confirm_exit(app) || agents::confirm_exit(app) { api.prevent_exit(); }
            }
            if let tauri::RunEvent::Exit = event {
                local_diagnostics::Attempt::begin().record(local_diagnostics::Stage::NativeExit, local_diagnostics::Outcome::Requested, local_diagnostics::Effects::Unconfirmed);
                desktop::stop(app);
                agents::stop_and_wait(app);
                terminal_creation::stop(app);
                terminal::stop_and_wait(app);
                files::stop(app);
                sidecar::stop(app);
            }
        });
}

#[cfg(test)]
mod webview_policy_tests {
    use super::*;

    #[test]
    fn dashboard_navigation_keeps_bootstrap_spa_sessions_and_hashes() {
        let origin = Some("http://127.0.0.1:4319");
        for document in [
            "http://127.0.0.1:4319/",
            "http://127.0.0.1:4319/#models",
            "http://127.0.0.1:4319/studio",
            "http://127.0.0.1:4319/overview/sessions/synthetic#event",
            "http://127.0.0.1:4319/overview/sessions/a%20b",
            unavailable::URL,
        ] {
            assert!(
                allowed_dashboard_navigation(&document.parse().unwrap(), origin),
                "{document}"
            );
        }
    }

    #[test]
    fn dashboard_navigation_rejects_non_documents_and_origin_expansion() {
        let origin = Some("http://127.0.0.1:4319");
        for document in [
            "http://127.0.0.1:4319/api/bootstrap",
            "http://127.0.0.1:4319/api/snapshot",
            "http://127.0.0.1:4319/ws",
            "http://127.0.0.1:4319/assets/app.js",
            "http://127.0.0.1:4319/settings/",
            "http://127.0.0.1:4319/%73ettings",
            "http://127.0.0.1:4319/overview/sessions/%2F",
            "http://127.0.0.1:4319/studio?x=1",
            "http://user:pass@127.0.0.1:4319/studio",
            "http://127.0.0.1:4320/studio",
            "http://localhost:4319/studio",
            "https://127.0.0.1:4319/studio",
            "https://example.test/studio",
            "file:///studio",
            "data:text/html,synthetic",
            "orqst-unavailable://other/index.html",
            "orqst-unavailable://local/index.html?x=1",
            "orqst-unavailable://local/index.html#retry",
            "orqst-unavailable://user@local/index.html",
            "orqst-unavailable://local:4319/index.html",
        ] {
            assert!(
                !allowed_dashboard_navigation(&document.parse().unwrap(), origin),
                "{document}"
            );
        }
    }

    #[test]
    fn unavailable_startup_has_only_the_exact_static_document() {
        assert!(allowed_dashboard_navigation(
            &unavailable::URL.parse().unwrap(),
            None
        ));
        for document in [
            "http://127.0.0.1:4319/",
            "http://127.0.0.1:4319/studio",
            "orqst-unavailable://local/",
            "orqst-unavailable://local/index.html?",
            "orqst-unavailable://local/index.html#",
        ] {
            assert!(
                !allowed_dashboard_navigation(&document.parse().unwrap(), None),
                "{document}"
            );
        }
    }
}
