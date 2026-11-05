// Synthetic dimensions only: these cannot establish visual AppKit acceptance.
#[path = "../../apps/tauri/src-tauri/src/terminal_consent_layout.rs"]
mod layout;

#[test]
fn small_medium_and_large_viewports_keep_measured_buttons_inside_margin() {
    for width in [390.0, 720.0, 1440.0] {
        for height in [390.0, 720.0, 1440.0] {
            for chrome_height in [140.0, 220.0] {
                let chrome_width = 120.0;
                let (w, h) = layout::fit(
                    (width, height),
                    (760.0, 360.0 + chrome_height),
                    (640.0, 360.0),
                ).unwrap();
                assert!(w + chrome_width <= width - 32.0);
                assert!(h + chrome_height <= height - 32.0);
                assert!(w <= 640.0 && h <= 360.0);
                // A second layout with identical measured chrome converges without growth.
                assert_eq!(
                    layout::fit((width, height), (w + chrome_width, h + chrome_height), (w, h)),
                    Some((w, h)),
                );
            }
        }
    }
}

#[test]
fn impossible_controls_or_untrusted_geometry_fail_closed() {
    assert_eq!(layout::fit((390.0, 200.0), (760.0, 580.0), (640.0, 360.0)), None);
    assert_eq!(layout::fit((180.0, 720.0), (760.0, 580.0), (640.0, 360.0)), None);
    for bad in [0.0, -1.0, f64::INFINITY, f64::NEG_INFINITY, f64::NAN] {
        assert_eq!(layout::fit((bad, 720.0), (760.0, 580.0), (640.0, 360.0)), None);
        assert_eq!(layout::fit((720.0, bad), (760.0, 580.0), (640.0, 360.0)), None);
        assert_eq!(layout::fit((720.0, 720.0), (bad, 580.0), (640.0, 360.0)), None);
        assert_eq!(layout::fit((720.0, 720.0), (760.0, bad), (640.0, 360.0)), None);
        assert_eq!(layout::fit((720.0, 720.0), (760.0, 580.0), (bad, 360.0)), None);
        assert_eq!(layout::fit((720.0, 720.0), (760.0, 580.0), (640.0, bad)), None);
    }
}

#[test]
fn reflowed_chrome_is_measured_again_and_never_expands_the_accessory() {
    let initial = layout::fit((390.0, 390.0), (760.0, 540.0), (640.0, 360.0)).unwrap();
    // A narrower text region can increase localized native heading/chrome height.
    let reflowed = layout::fit(
        (390.0, 390.0),
        (initial.0 + 120.0, initial.1 + 220.0),
        initial,
    ).unwrap();
    assert!(reflowed.0 <= initial.0 && reflowed.1 < initial.1);
    assert!(reflowed.1 + 220.0 <= 358.0);
    // If a further layout puts controls alone over budget, do not open a sheet.
    assert_eq!(layout::fit((390.0, 390.0), (358.0, reflowed.1 + 400.0), reflowed), None);
}

#[test]
fn complete_long_plaintext_review_is_preserved_without_truncation() {
    for detail in ["PATH=/synthetic:".repeat(1000), "<script>synthetic</script>\n".repeat(1000)] {
        let review = layout::review_text(
            "Synthetic authorization", "Permissões — synthetic", &detail,
        );
        assert_eq!(
            review,
            ["Synthetic authorization", "Permissões — synthetic", &detail].join("\n\n"),
        );
        assert!(review.ends_with(&detail));
    }
}
