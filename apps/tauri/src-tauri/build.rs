fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "terminal_request",
            "terminal_view",
            "agents_request",
            "file_request",
            "feature_request",
        ]),
    ))
    .expect("native permission manifest");
}
