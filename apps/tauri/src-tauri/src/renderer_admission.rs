//! Bounded admission for renderer-triggered native preparation and opening.
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

// Per native document identity and action, allow twelve requests in sixty seconds.
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
    Input,
    Read,
    Resize,
    Control,
    Stop,
    Metadata,
    Permissions,
    File,
    Context,
    View,
}
struct Window {
    start: Instant,
    accepted: u32,
}
#[derive(Default)]
struct Limiter(HashMap<(String, String, u64, Action), Window>);
impl Limiter {
    fn admit(
        &mut self,
        label: &str,
        epoch: &str,
        generation: u64,
        action: Action,
        now: Instant,
    ) -> bool {
        self.0
            .retain(|_, window| now.saturating_duration_since(window.start) < WINDOW);
        let key = (label.to_owned(), epoch.to_owned(), generation, action);
        if !self.0.contains_key(&key) && self.0.keys().filter(|key| key.0 == label).count() >= 1024
        {
            if let Some(oldest) = self
                .0
                .iter()
                .filter(|(key, _)| key.0 == label)
                .min_by_key(|(_, window)| window.start)
                .map(|(key, _)| key.clone())
            {
                self.0.remove(&oldest);
            }
        }
        let window = self.0.entry(key).or_insert(Window {
            start: now,
            accepted: 0,
        });
        if now.saturating_duration_since(window.start) >= WINDOW {
            window.start = now;
            window.accepted = 0;
        }
        let limit = match action {
            Action::Input | Action::Read | Action::Resize => 6000,
            Action::Control
            | Action::Metadata
            | Action::Permissions
            | Action::Context
            | Action::View => 120,
            _ => LIMIT,
        };
        if window.accepted >= limit {
            return false;
        }
        window.accepted += 1;
        true
    }
}
static LIMITER: OnceLock<Mutex<Limiter>> = OnceLock::new();

/// Only call after validating the native document identity and applicable focus guards.
pub fn admit(
    label: &str,
    epoch: &str,
    generation: u64,
    action: Action,
    source: crate::local_diagnostics::RefusalSource,
) -> bool {
    let accepted = LIMITER
        .get_or_init(|| Mutex::new(Limiter::default()))
        .lock()
        .map(|mut limiter| limiter.admit(label, epoch, generation, action, Instant::now()))
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
                .filter(|_| limiter.admit("main", "", 1, Action::Catalog, now))
                .count(),
            LIMIT as usize
        );
        assert_eq!(
            (0..1000)
                .filter(|_| limiter.admit("main", "", 2, Action::Catalog, now))
                .count(),
            LIMIT as usize
        );
        assert!(limiter.admit("main", "new-host", 1, Action::Catalog, now));
        assert!(limiter.admit("main", "", 1, Action::Open, now));
        assert!(limiter.admit("terminal-1", "", 1, Action::Catalog, now));
        assert!(!limiter.admit(
            "main",
            "",
            1,
            Action::Catalog,
            now + WINDOW - Duration::from_millis(1)
        ));
        assert!(limiter.admit("main", "", 1, Action::Catalog, now + WINDOW));
    }
    #[test]
    fn high_frequency_routes_are_bounded_and_stop_has_independent_quota() {
        let now = Instant::now();
        let mut limiter = Limiter::default();
        for action in [Action::Input, Action::Read, Action::Resize] {
            assert_eq!(
                (0..7000)
                    .filter(|_| limiter.admit("terminal-0", "host", 1, action, now))
                    .count(),
                6000
            );
        }
        for _ in 0..120 {
            assert!(limiter.admit("terminal-0", "host", 1, Action::Control, now));
        }
        assert!(!limiter.admit("terminal-0", "host", 1, Action::Control, now));
        assert!(limiter.admit("terminal-0", "host", 1, Action::Stop, now));
    }
    #[test]
    fn spaced_human_requests_are_admitted() {
        let now = Instant::now();
        let mut limiter = Limiter::default();
        for i in 0..30 {
            assert!(limiter.admit(
                "main",
                "",
                1,
                Action::Create,
                now + Duration::from_secs(i * 10)
            ));
        }
    }
}
