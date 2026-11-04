//! Fixed local observer failure document. No renderer command, recovery or process action.
use serde_json::Value;
use tauri::Manager;

pub const URL: &str = "orqst-unavailable://local/index.html";
const CSP: &str = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; connect-src 'none'; img-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

pub fn allowed_navigation(url: &tauri::Url, origin: Option<&str>) -> bool {
    url.as_str() == URL
        || (origin.is_some_and(|origin| url.origin().ascii_serialization() == origin)
            && url.username().is_empty()
            && url.password().is_none()
            && url.query().is_none())
}

fn escape(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

fn document(language: &str) -> String {
    // Match the existing native shell's LANG selection, with en-US fallback.
    // This is not the dashboard's persisted locale or a macOS locale probe.
    let portuguese = language.to_lowercase().starts_with("pt");
    let english: Value =
        serde_json::from_str(include_str!("../../../dashboard/src/locales/en-US.json"))
            .expect("validated application locale");
    let localized: Value = serde_json::from_str(if portuguese {
        include_str!("../../../dashboard/src/locales/pt-BR.json")
    } else {
        include_str!("../../../dashboard/src/locales/en-US.json")
    })
    .expect("validated application locale");
    let text = |key: &str| {
        escape(
            localized["tauriCoreUnavailable"][key]
                .as_str()
                .or_else(|| english["tauriCoreUnavailable"][key].as_str())
                .unwrap_or(key),
        )
    };
    format!(
        "<!doctype html><html lang=\"{}\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>ORQST</title><style>html{{color-scheme:dark}}body{{margin:0;background:#080b1e;color:#eee8f8;font:18px/1.6 system-ui,sans-serif}}main{{max-width:44rem;margin:10vh auto;padding:2rem}}h1{{font-size:2rem;line-height:1.2}}p{{color:#d9c9ff}}.brand{{color:#b45cff;font-weight:700}}</style></head><body><main><p class=\"brand\">ORQST</p><h1>{}</h1><p>{}</p><p>{}</p><p>{}</p></main></body></html>",
        if portuguese { "pt-BR" } else { "en-US" },
        text("title"), text("observer"), text("managed"), text("recovery"),
    )
}

pub fn response(request: &tauri::http::Request<Vec<u8>>) -> tauri::http::Response<Vec<u8>> {
    // An exact in-memory resource, never a filesystem path or a wildcard origin.
    let uri = request.uri();
    let valid = request.method() == tauri::http::Method::GET
        && uri.scheme_str() == Some("orqst-unavailable")
        && uri.authority().map(|authority| authority.as_str()) == Some("local")
        && uri.path_and_query().map(|path| path.as_str()) == Some("/index.html");
    let body = if valid {
        document(&std::env::var("LANG").unwrap_or_default()).into_bytes()
    } else {
        Vec::new()
    };
    tauri::http::Response::builder()
        .status(if valid { 200 } else { 404 })
        .header("Content-Type", "text/html; charset=utf-8")
        .header("Cache-Control", "no-store")
        .header("X-Content-Type-Options", "nosniff")
        .header("Content-Security-Policy", CSP)
        .body(body)
        .expect("static unavailable response")
}

pub fn show(app: &tauri::AppHandle) {
    let app = app.clone();
    let _ = app.clone().run_on_main_thread(move || {
        if !crate::sidecar::should_present_unavailable(&app) {
            return;
        }
        if let Some(window) = app.get_webview_window("main") {
            // Navigation revokes the old dashboard's document-bound grants through
            // the existing page-load callback; retained terminal documents stay live.
            let _ = window.navigate(URL.parse().expect("static unavailable URL"));
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_exact_local_document_extends_dashboard_navigation() {
        assert!(allowed_navigation(&URL.parse().unwrap(), None));
        for url in [
            "orqst-unavailable://other/index.html",
            "orqst-unavailable://local/index.html?secret=1",
            "orqst-unavailable://local/index.html#retry",
            "orqst-unavailable://user@local/index.html",
            "orqst-unavailable://local/../private",
            "http://127.0.0.1:4319/",
            "https://example.test/",
        ] {
            assert!(!allowed_navigation(&url.parse().unwrap(), None));
        }
        let origin = Some("http://127.0.0.1:4319");
        assert!(allowed_navigation(
            &"http://127.0.0.1:4319/studio".parse().unwrap(),
            origin
        ));
        for url in [
            "http://localhost:4319/",
            "http://127.0.0.1:4320/",
            "http://127.0.0.1:4319/?x=1",
            "http://user@127.0.0.1:4319/",
        ] {
            assert!(!allowed_navigation(&url.parse().unwrap(), origin));
        }
    }

    #[test]
    fn response_rejects_other_paths_methods_authorities_and_queries() {
        for (method, url) in [
            ("POST", URL),
            ("GET", "orqst-unavailable://local/private"),
            ("GET", "orqst-unavailable://local/index.html?x=1"),
            ("GET", "orqst-unavailable://other/index.html"),
            ("GET", "orqst-unavailable://user@local/index.html"),
            ("GET", "orqst-unavailable://local:123/index.html"),
        ] {
            let request = tauri::http::Request::builder()
                .method(method)
                .uri(url)
                .body(Vec::new())
                .unwrap();
            assert_eq!(response(&request).status(), 404);
        }
        let request = tauri::http::Request::builder()
            .uri(URL)
            .body(Vec::new())
            .unwrap();
        let response = response(&request);
        assert_eq!(response.status(), 200);
        assert_eq!(response.headers()["Content-Security-Policy"], CSP);
        assert_eq!(response.headers()["Cache-Control"], "no-store");
    }

    #[test]
    fn response_keeps_exact_components_instead_of_permissive_uri_equivalence() {
        for url in [
            "orqst-unavailable://LOCAL/index.html",
            "ORQST-UNAVAILABLE://local/index.html",
            "orqst-unavailable://local/INDEX.html",
            "orqst-unavailable://local/./index.html",
            "orqst-unavailable://local/%69ndex.html",
            "orqst-unavailable://local/index.html?",
        ] {
            let request = tauri::http::Request::builder()
                .uri(url)
                .body(Vec::new())
                .unwrap();
            assert_eq!(response(&request).status(), 404, "{url}");
            assert!(response(&request).body().is_empty());
        }
        for method in ["HEAD", "OPTIONS", "get"] {
            let request = tauri::http::Request::builder()
                .method(method)
                .uri(URL)
                .body(Vec::new())
                .unwrap();
            assert_eq!(response(&request).status(), 404, "{method}");
        }
    }

    #[test]
    fn both_catalogs_render_plain_static_text_with_english_fallback() {
        let english = document("en_US.UTF-8");
        let portuguese = document("pt_BR.UTF-8");
        assert!(english.contains("Observer unavailable"));
        assert!(portuguese.contains("Observador indisponível"));
        assert_eq!(document(""), english);
        assert_eq!(document("de_DE.UTF-8"), english);
        for html in [english, portuguese] {
            for forbidden in [
                "<script", "<a ", "<button", "<iframe", "src=", "href=", "http://", "https://",
            ] {
                assert!(!html.contains(forbidden));
            }
            assert!(!html.contains("tauriCoreUnavailable"));
        }
        assert_eq!(escape("<&>\"'"), "&lt;&amp;&gt;&quot;&#39;");
    }
}
