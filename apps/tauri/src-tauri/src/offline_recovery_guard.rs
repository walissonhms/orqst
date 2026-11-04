//! Pure presentation state; no UI getters, runtime, filesystem or clock overrides.
#[derive(Default)]
pub struct Presentation {
    pub generation: u64,
    pub reviewing: bool,
    pub shown: bool,
}

impl Presentation {
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
        self.reviewing && self.shown && self.generation == generation && current && detailed
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
    fn navigation_close_and_deactivation_invalidation_deny_stale_request() {
        let mut guard = Presentation::default();
        let request = guard.generation;
        guard.invalidate();
        guard.begin_sheet();
        guard.observe(guard.generation, true, true);
        assert!(!guard.accepted(request, true, true));
    }
}
