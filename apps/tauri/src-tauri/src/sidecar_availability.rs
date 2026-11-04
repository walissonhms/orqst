//! Observer availability only; this state never grants process ownership or recovery.
#[derive(Default)]
pub struct Availability {
    attempted: bool,
    unavailable: bool,
    stopping: bool,
}

impl Availability {
    pub fn begin(&mut self) -> bool {
        if self.attempted || self.stopping {
            return false;
        }
        self.attempted = true;
        true
    }

    pub fn disconnect(&mut self) -> bool {
        let changed = !self.unavailable && !self.stopping;
        self.unavailable = true;
        changed
    }

    pub fn accept_frames(&self) -> bool {
        self.attempted && !self.unavailable && !self.stopping
    }

    pub fn should_present(&self) -> bool {
        self.unavailable && !self.stopping
    }

    pub fn stop(&mut self) {
        self.stopping = true;
    }
}

#[cfg(test)]
mod tests {
    use super::Availability;

    #[test]
    fn an_attempt_can_never_be_repeated_even_after_failure() {
        let mut state = Availability::default();
        assert!(!state.accept_frames());
        assert!(!state.should_present());
        assert!(state.begin());
        assert!(state.accept_frames());
        assert!(!state.begin());
        assert!(state.disconnect());
        assert!(!state.accept_frames());
        assert!(state.should_present());
        assert!(!state.begin());
        assert!(!state.disconnect());
    }

    #[test]
    fn quit_suppresses_late_unavailable_presentation() {
        let mut state = Availability::default();
        assert!(state.begin());
        state.stop();
        assert!(!state.disconnect());
        assert!(!state.should_present());
        assert!(!state.accept_frames());
        assert!(!state.begin());
        let mut stopped_before_start = Availability::default();
        stopped_before_start.stop();
        assert!(!stopped_before_start.begin());
    }
}
