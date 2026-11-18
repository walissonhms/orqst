//! SYNTHETIC unit tests for lane L6 pure helpers (no filesystem outside temp, no sysctl).
use orqst_terminal_core::recovery::host::helper_arguments;
use orqst_terminal_core::recovery::image::committed_terminal_image;
use orqst_terminal_core::recovery::wire::escape_format;

fn database(page: usize) -> Vec<u8> {
    let mut base = vec![0u8; page * 2];
    base[..16].copy_from_slice(b"SQLite format 3\0");
    base[16..18].copy_from_slice(&(page as u16).to_be_bytes());
    base
}

fn wal_header(page: usize) -> Vec<u8> {
    let mut wal = vec![0u8; 32];
    wal[..4].copy_from_slice(&0x377f0683u32.to_be_bytes());
    wal[4..8].copy_from_slice(&3007000u32.to_be_bytes());
    wal[8..12].copy_from_slice(&(page as u32).to_be_bytes());
    let (mut a, mut b) = (0u32, 0u32);
    for chunk in wal[..24].chunks(8) {
        a = a
            .wrapping_add(u32::from_be_bytes(chunk[..4].try_into().unwrap()))
            .wrapping_add(b);
        b = b
            .wrapping_add(u32::from_be_bytes(chunk[4..].try_into().unwrap()))
            .wrapping_add(a);
    }
    wal[24..28].copy_from_slice(&a.to_be_bytes());
    wal[28..32].copy_from_slice(&b.to_be_bytes());
    wal
}

#[test]
fn image_switches_only_the_derived_copy_to_rollback_mode() {
    let base = database(512);
    let image = committed_terminal_image(&base, None).unwrap();
    assert_eq!((image[18], image[19]), (1, 1));
    assert_eq!(image[20..], base[20..]);
    // A header-only WAL is valid.
    assert!(committed_terminal_image(&base, Some(&wal_header(512))).is_ok());
}

#[test]
fn image_refuses_invalid_or_uncommitted_evidence() {
    let base = database(512);
    assert_eq!(
        committed_terminal_image(&base[..99], None)
            .unwrap_err()
            .classify(),
        "Invalid offline database"
    );
    let mut header = wal_header(512);
    header[24] ^= 1;
    assert_eq!(
        committed_terminal_image(&base, Some(&header))
            .unwrap_err()
            .classify(),
        "Offline WAL header checksum"
    );
    let mut torn = wal_header(512);
    torn.extend(vec![0u8; 512 + 24]);
    assert_eq!(
        committed_terminal_image(&base, Some(&torn))
            .unwrap_err()
            .classify(),
        "Offline WAL frame binding"
    );
    assert_eq!(
        committed_terminal_image(&base, Some(&[0u8; 8]))
            .unwrap_err()
            .classify(),
        "Invalid offline WAL"
    );
}

#[test]
fn helper_argv_is_the_fixed_native_vector() {
    assert_eq!(
        helper_arguments(&["/p".into()]).unwrap(),
        ("/p".into(), None)
    );
    assert_eq!(
        helper_arguments(&[
            "/p".into(),
            "--offline-recovery-binding-evidence".into(),
            "/e".into()
        ])
        .unwrap(),
        ("/p".into(), Some("/e".into()))
    );
    assert!(helper_arguments(&["relative".into()]).is_err());
    assert!(helper_arguments(&["/p".into(), "--other".into(), "/e".into()]).is_err());
    assert!(helper_arguments(&["/p".into(), "/q".into()]).is_err());
}

#[test]
fn review_detail_escapes_format_controls_visibly() {
    assert_eq!(
        escape_format("a\u{202e}b\u{200b}c"),
        "a\\u{202e}b\\u{200b}c"
    );
    assert_eq!(escape_format("plain é"), "plain é");
}

#[test]
fn antigravity_version_4_manifest_and_enrollment_schema_preserve_order_and_refuse_mcp() {
    use orqst_terminal_core::pair::member_schema_order;
    use orqst_terminal_core::profiles::mcp::REVIEWED_ANTIGRAVITY;
    use orqst_terminal_core::recovery::schema::{interactive_config, member};
    use serde_json::json;

    let manifest = json!({
        "interactive": {"sharedNativeSessions": true},
        "authentication": {
            "sharedNativeConfiguration": true,
            "home": "/synthetic/home",
            "mode": "reuse-existing"
        },
        "state": "/synthetic/state",
        "project": "/synthetic/project",
        "node": {"sha256": "a".repeat(64), "path": "/synthetic/node"},
        "executableVersion": REVIEWED_ANTIGRAVITY.version,
        "executable": {"sha256": REVIEWED_ANTIGRAVITY.sha256, "path": "/synthetic/agy"},
        "trust": "native-same-user",
        "provider": "antigravity",
        "version": 4
    });
    let ordered = interactive_config(&manifest).unwrap();
    let keys: Vec<_> = ordered.as_object().unwrap().keys().cloned().collect();
    assert_eq!(
        keys,
        vec![
            "version",
            "provider",
            "trust",
            "executable",
            "executableVersion",
            "node",
            "project",
            "state",
            "authentication",
            "interactive",
        ]
    );

    let mut with_mcp = manifest.clone();
    with_mcp["interactive"]["mcp"] = json!(true);
    assert!(interactive_config(&with_mcp).is_err());

    let candidate = json!({
        "slot": 0,
        "terminalId": "00000000-0000-4000-8000-000000000001",
        "alias": "P-00000000-0000-4000-8000-000000000001",
        "provider": "antigravity",
        "requestedModel": "gemini-2.5-pro",
        "workspaceId": "b".repeat(64),
        "featureId": null,
        "admissionRevision": 1,
        "bindingDigest": "c".repeat(64),
        "status": "ready"
    });
    assert!(member(&candidate).is_ok());
    assert!(member_schema_order(candidate.as_object().unwrap()).is_ok());
}
