fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&["terminal_request", "terminal_view"]),
    ))
    .expect("native permission manifest");
}
