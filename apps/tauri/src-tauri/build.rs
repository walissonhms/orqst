fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "terminal_request",
            "terminal_open_prepared",
            "terminal_view",
            "terminal_restore",
            "agents_request",
            "file_request",
            "feature_request",
            "feature_prepare",
            "feature_permissions",
            "studio_request",
        ]),
    ))
    .expect("native permission manifest");
}
