//! Pure sizing and content policy for native terminal authorization.
/// Preserve native chrome and bound only the scrolling accessory.
pub fn fit(available: (f64, f64), frame: (f64, f64), accessory: (f64, f64)) -> Option<(f64, f64)> {
    if [
        available.0,
        available.1,
        frame.0,
        frame.1,
        accessory.0,
        accessory.1,
    ]
    .iter()
    .any(|v| !v.is_finite() || *v <= 0.0)
    {
        return None;
    }
    let width = accessory.0 - (frame.0 - (available.0 - 32.0)).max(0.0);
    let height = accessory.1 - (frame.1 - (available.1 - 32.0)).max(0.0);
    (width >= 96.0 && height >= 48.0).then_some((width, height))
}

/// Preserve every review byte; only the outer native chrome is compact.
pub fn review_text(title: &str, message: &str, detail: &str) -> String {
    format!("{title}\n\n{message}\n\n{detail}")
}
