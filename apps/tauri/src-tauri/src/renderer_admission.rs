//! Bounded admission for renderer-triggered native preparation and opening.
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

// Per trusted webview label and action, allow twelve requests in sixty seconds.
// A fixed window is intentionally generous for human interaction and bounded at its edges.
const WINDOW: Duration = Duration::from_secs(60);
const LIMIT: u32 = 12;
#[derive(Clone, Copy, Debug, Hash, PartialEq, Eq)]
pub enum Action {
    Catalog,
    Create,
    Selection,
    Open,
    Start,
    Navigate,
}
struct Window {
    start: Instant,
    accepted: u32,
}
#[derive(Default)]
struct Limiter(HashMap<(String, Action), Window>);
impl Limiter {
    fn admit(&mut self, label: &str, action: Action, now: Instant) -> bool {
        let window = self.0.entry((label.to_owned(), action)).or_insert(Window {
            start: now,
            accepted: 0,
        });
        if now.saturating_duration_since(window.start) >= WINDOW {
            window.start = now;
            window.accepted = 0;
        }
        if window.accepted >= LIMIT {
            return false;
        }
        window.accepted += 1;
        true
    }
}
static LIMITER: OnceLock<Mutex<Limiter>> = OnceLock::new();

/// Only call after authenticating a fixed native-owned document label.
pub fn admit(label: &str, action: Action, source: crate::local_diagnostics::RefusalSource) -> bool {
    let accepted = LIMITER
        .get_or_init(|| Mutex::new(Limiter::default()))
        .lock()
        .map(|mut limiter| limiter.admit(label, action, Instant::now()))
        .unwrap_or(false);
    if !accepted {
        crate::local_diagnostics::rate_limited(source);
    }
    accepted
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn flood_is_bounded_per_document_and_action_and_window_renews() {
        let now = Instant::now();
        let mut limiter = Limiter::default();
        assert_eq!(
            (0..1000)
                .filter(|_| limiter.admit("main", Action::Catalog, now))
                .count(),
            LIMIT as usize
        );
        assert!(limiter.admit("main", Action::Open, now));
        assert!(limiter.admit("terminal-1", Action::Catalog, now));
        assert!(!limiter.admit(
            "main",
            Action::Catalog,
            now + WINDOW - Duration::from_millis(1)
        ));
        assert!(limiter.admit("main", Action::Catalog, now + WINDOW));
    }
    #[test]
    fn spaced_human_requests_are_admitted() {
        let now = Instant::now();
        let mut limiter = Limiter::default();
        for i in 0..30 {
            assert!(limiter.admit("main", Action::Create, now + Duration::from_secs(i * 10)));
        }
    }
}
