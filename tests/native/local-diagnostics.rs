#[test]
fn incomplete_open_stays_uncertain_and_success_without_opening_evidence_is_unconfirmed() {
    assert_eq!(opening_outcome(Some("ok"), Some("ready")), Outcome::Ready);
    assert_eq!(
        opening_outcome(Some("ok"), Some("incomplete")),
        Outcome::Uncertain
    );
    for (status, opening) in [
        (Some("ok"), None),
        (None, Some("ready")),
        (Some("unknown"), Some("ready")),
        (
            Some("ok"),
            Some("SYNTHETIC private-path token terminal-content"),
        ),
    ] {
        assert_eq!(opening_outcome(status, opening), Outcome::Unconfirmed);
    }
}

#[test]
fn refusals_are_projected_without_interpreting_text_as_launch_or_effect_evidence() {
    for status in ["denied", "busy", "focus_required"] {
        assert_eq!(
            opening_outcome(Some(status), Some("ready")),
            Outcome::Refused
        );
    }
    assert_eq!(opening_outcome(Some("cancelled"), None), Outcome::Cancelled);
}
