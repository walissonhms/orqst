//! Pure presentation state; no UI getters, runtime, filesystem or clock overrides.
#[derive(Default)]
pub struct Presentation {
    pub generation: u64,
    pub reviewing: bool,
    pub shown: bool,
    pub uncertain: bool,
}

impl Presentation {
    pub fn can_request(&self, pending: bool) -> bool {
        !self.uncertain && !pending
    }
    pub fn latch_uncertain(&mut self) {
        self.uncertain = true;
        self.invalidate();
    }
    pub fn invalidate(&mut self) {
        self.generation = self.generation.wrapping_add(1);
        self.shown = false;
    }
    pub fn observe(&mut self, generation: u64, owns_key: bool, owns_sheet: bool) {
        if !self.reviewing || generation != self.generation {
            return;
        }
        if !owns_key {
            self.invalidate();
            return;
        }
        self.shown |= owns_sheet;
    }
    pub fn begin_sheet(&mut self) {
        self.reviewing = true;
        self.shown = false;
    }
    pub fn accepted(&self, generation: u64, current: bool, detailed: bool) -> bool {
        !self.uncertain
            && self.reviewing
            && self.shown
            && self.generation == generation
            && current
            && detailed
    }
}

#[cfg(test)]
mod tests {
    use super::Presentation;
    #[test]
    fn approval_requires_details_owned_sheet_source_and_exact_generation() {
        let mut guard = Presentation::default();
        guard.begin_sheet();
        assert!(!guard.accepted(0, true, true));
        guard.observe(0, true, true);
        assert!(guard.accepted(0, true, true));
        assert!(!guard.accepted(0, true, false));
        assert!(!guard.accepted(0, false, true));
        assert!(!guard.accepted(1, true, true));
    }
    #[test]
    fn focus_loss_stays_revoked_after_return_and_old_observer_cannot_adopt() {
        let mut guard = Presentation::default();
        guard.begin_sheet();
        guard.observe(0, true, true);
        guard.observe(0, false, false);
        guard.observe(0, true, true);
        assert!(!guard.accepted(0, true, true));
        assert!(!guard.shown);
    }
    #[test]
    fn every_sheet_requires_its_own_observed_presentation() {
        let mut guard = Presentation::default();
        guard.begin_sheet();
        guard.observe(0, true, true);
        guard.begin_sheet();
        assert!(!guard.accepted(0, true, true));
        guard.observe(0, true, false);
        assert!(!guard.accepted(0, true, true));
    }
    #[test]
    fn early_modal_return_completion_and_late_callback_never_release_uncertain_latch() {
        let mut guard = Presentation::default();
        guard.begin_sheet();
        guard.latch_uncertain(); // runModal returned before the delegate supplied a response.
        guard.reviewing = false; // review(None), denied ACK and complete are not native completion.
        assert!(!guard.can_request(false));
        let generation = guard.generation;
        guard.observe(generation.wrapping_sub(1), true, true); // old callback/observer
        guard.begin_sheet();
        guard.observe(generation, true, true);
        assert!(!guard.accepted(generation, true, true));
        assert!(!guard.can_request(false));
        assert!(guard.uncertain);
    }
    #[test]
    fn navigation_close_and_deactivation_invalidation_deny_stale_request() {
        let mut guard = Presentation::default();
        let request = guard.generation;
        guard.invalidate();
        guard.begin_sheet();
        guard.observe(guard.generation, true, true);
        assert!(!guard.accepted(request, true, true));
    }
}

/// Both clocks are native-only. Continuous ticks include system sleep on macOS.
#[derive(Clone, Copy)]
pub struct ClockSample {
    pub instant: std::time::Instant,
    pub ticks: u64,
    pub numer: u32,
    pub denom: u32,
}
#[cfg(target_os = "macos")]
pub fn clock() -> Option<ClockSample> {
    #[repr(C)]
    struct Timebase {
        numer: u32,
        denom: u32,
    }
    extern "C" {
        fn mach_timebase_info(info: *mut Timebase) -> i32;
        fn mach_continuous_time() -> u64;
    }
    // Capture both deadlines immediately in the delegate, before timebase lookup can wait.
    let ticks = unsafe { mach_continuous_time() };
    let instant = std::time::Instant::now();
    let mut base = Timebase { numer: 0, denom: 0 };
    // SAFETY: the SDK's repr(C) uint32 pair, valid output pointer and no-argument u64 ABI.
    if unsafe { mach_timebase_info(&mut base) } != 0 || base.numer == 0 || base.denom == 0 {
        return None;
    }

    Some(ClockSample {
        instant,
        ticks,
        numer: base.numer,
        denom: base.denom,
    })
}
#[cfg(not(target_os = "macos"))]
pub fn clock() -> Option<ClockSample> {
    None
}

/// One click grants one signature and bounded checks, never a renewal.
pub struct Consent {
    binding: String,
    clicked: ClockSample,
    challenge: Option<String>,
}
impl Consent {
    pub fn new(binding: String, clicked: ClockSample) -> Self {
        Self {
            binding,
            clicked,
            challenge: None,
        }
    }
    pub fn allows(&self, binding: &str, challenge: &str, check: bool) -> bool {
        self.binding == binding
            && match (&self.challenge, check) {
                (None, false) => true,
                (Some(previous), true) => previous == challenge,
                _ => false,
            }
    }
    pub fn authorize(
        &mut self,
        binding: &str,
        challenge: &str,
        check: bool,
        now: ClockSample,
    ) -> Option<u64> {
        if self.binding != binding
            || self.clicked.numer == 0
            || self.clicked.denom == 0
            || now.numer != self.clicked.numer
            || now.denom != self.clicked.denom
        {
            return None;
        }
        let instant_elapsed = now.instant.checked_duration_since(self.clicked.instant)?;
        let delta = now.ticks.checked_sub(self.clicked.ticks)?;
        let elapsed = u128::from(delta).checked_mul(u128::from(self.clicked.numer))?;
        let budget = 30_000_000_000u128.checked_mul(u128::from(self.clicked.denom))?;
        let remaining = budget.checked_sub(elapsed)?;
        let millis =
            remaining.checked_div(u128::from(self.clicked.denom).checked_mul(1_000_000)?)?;
        let instant_remaining = std::time::Duration::from_secs(30).checked_sub(instant_elapsed)?;
        let millis = millis.min(instant_remaining.as_millis()).min(30_000) as u64;
        if millis == 0 {
            return None;
        }
        match (&self.challenge, check) {
            (None, false) => self.challenge = Some(challenge.to_owned()),
            (Some(previous), true) if previous == challenge => (),
            _ => return None,
        }
        Some(millis)
    }
}

#[cfg(test)]
mod consent_tests {
    use super::{ClockSample, Consent};
    use std::time::{Duration, Instant};
    fn at(origin: Instant, uptime_ms: u64, continuous_ns: u64) -> ClockSample {
        ClockSample {
            instant: origin + Duration::from_millis(uptime_ms),
            ticks: continuous_ns,
            numer: 1,
            denom: 1,
        }
    }
    #[test]
    fn reading_sixty_seconds_then_new_click_allows_one_fresh_signature() {
        let origin = Instant::now();
        let clicked = at(origin, 60_000, 60_000_000_000);
        let mut consent = Consent::new("intent".into(), clicked);
        assert_eq!(
            consent.authorize("intent", "fresh", false, at(origin, 60_100, 60_100_000_000)),
            Some(29_900)
        );
        assert_eq!(
            consent.authorize("intent", "fresh", false, at(origin, 60_200, 60_200_000_000)),
            None
        );
        assert_eq!(
            consent.authorize("intent", "fresh", true, at(origin, 61_000, 61_000_000_000)),
            Some(29_000)
        );
    }
    #[test]
    fn callback_timestamp_survives_delayed_worker_return() {
        let origin = Instant::now();
        let mut consent = Consent::new("intent".into(), at(origin, 0, 0));
        assert_eq!(
            consent.authorize("intent", "fresh", false, at(origin, 31_000, 31_000_000_000)),
            None
        );
    }
    #[test]
    fn sleep_before_fresh_challenge_cannot_restart_the_approval_window() {
        let origin = Instant::now();
        let mut consent = Consent::new("intent".into(), at(origin, 0, 0));
        assert_eq!(
            consent.authorize("intent", "fresh", false, at(origin, 1, 60_000_000_000)),
            None
        );
    }
    #[test]
    fn sleep_between_signature_ack_and_final_check_expires_continuously() {
        let origin = Instant::now();
        let mut consent = Consent::new("intent".into(), at(origin, 0, 0));
        assert_eq!(
            consent.authorize("intent", "fresh", false, at(origin, 1, 1_000_000)),
            Some(29_999)
        );
        assert_eq!(
            consent.authorize("intent", "fresh", true, at(origin, 2, 60_000_000_000)),
            None
        );
    }
    #[test]
    fn remaining_is_floor_of_remaining_never_ceil_from_elapsed() {
        let origin = Instant::now();
        let mut consent = Consent::new("intent".into(), at(origin, 0, 0));
        assert_eq!(
            consent.authorize("intent", "fresh", false, at(origin, 0, 29_999_999_999)),
            None
        );
        assert_eq!(
            consent.authorize("intent", "fresh", false, at(origin, 0, 30_000_000_000)),
            None
        );
    }
    #[test]
    fn backwards_ticks_invalid_ratios_and_large_scaled_values_deny() {
        let origin = Instant::now();
        for (numer, denom) in [(0, 1), (1, 0), (u32::MAX, 1), (u32::MAX, u32::MAX)] {
            let clicked = ClockSample {
                instant: origin,
                ticks: 1,
                numer,
                denom,
            };
            let mut consent = Consent::new("intent".into(), clicked);
            assert_eq!(
                consent.authorize(
                    "intent",
                    "fresh",
                    false,
                    ClockSample {
                        ticks: u64::MAX,
                        ..clicked
                    }
                ),
                None
            );
        }
        let clicked = at(origin, 0, 5);
        assert_eq!(
            Consent::new("intent".into(), clicked).authorize(
                "intent",
                "fresh",
                false,
                at(origin, 0, 4)
            ),
            None
        );
    }
    #[test]
    fn altered_intent_challenge_or_check_before_sign_cannot_authorize() {
        let origin = Instant::now();
        let now = at(origin, 0, 0);
        let mut consent = Consent::new("intent".into(), now);
        assert_eq!(consent.authorize("other", "fresh", false, now), None);
        assert_eq!(consent.authorize("intent", "fresh", true, now), None);
        assert_eq!(
            consent.authorize("intent", "fresh", false, now),
            Some(30_000)
        );
        assert_eq!(consent.authorize("intent", "changed", true, now), None);
    }
    #[test]
    fn neither_clock_can_extend_the_other() {
        let origin = Instant::now();
        let now = at(origin, 0, 0);
        let mut consent = Consent::new("intent".into(), now);
        assert_eq!(
            consent.authorize("intent", "fresh", false, at(origin, 29_000, 1_000_000)),
            Some(1_000)
        );
        assert_eq!(
            consent.authorize("intent", "fresh", true, at(origin, 30_000, 1_000_000)),
            None
        );
    }
}
