//! Native owned-host lifecycle. Survives losing the host handle; absence is not evidence.
use std::sync::Mutex;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Phase {
    NotStarted,
    Active,
    ShutdownInFlight,
    ExitEvidenceConfirmed,
    LostUnknown,
}

static PHASE: Mutex<Phase> = Mutex::new(Phase::NotStarted);

pub fn phase() -> Phase {
    *PHASE.lock().unwrap()
}

/// Only the first successful start becomes active; a lost host stays lost.
pub fn started() {
    let mut phase = PHASE.lock().unwrap();
    if *phase == Phase::NotStarted {
        *phase = Phase::Active;
    }
}

/// A host that disappears after starting without exit evidence is unknown, never absent.
pub fn lost() {
    let mut phase = PHASE.lock().unwrap();
    if matches!(*phase, Phase::Active | Phase::ShutdownInFlight) {
        *phase = Phase::LostUnknown;
    }
}

pub fn shutdown_started() {
    let mut phase = PHASE.lock().unwrap();
    if *phase == Phase::Active {
        *phase = Phase::ShutdownInFlight;
    }
}

/// The reviewed retirement evidence enables exactly one exit, never a second.
pub fn exit_evidence() {
    let mut phase = PHASE.lock().unwrap();
    if *phase == Phase::ShutdownInFlight {
        *phase = Phase::ExitEvidenceConfirmed;
    }
}

pub fn consume_exit_evidence() -> bool {
    let mut phase = PHASE.lock().unwrap();
    if *phase == Phase::ExitEvidenceConfirmed {
        *phase = Phase::NotStarted;
        return true;
    }
    false
}

pub fn owned() -> bool {
    phase() != Phase::NotStarted
}

pub fn lost_unknown() -> bool {
    phase() == Phase::LostUnknown
}

#[cfg(test)]
mod tests {
    use super::*;

    fn reset() {
        *PHASE.lock().unwrap() = Phase::NotStarted;
    }

    #[test]
    fn absence_is_not_evidence_of_a_lost_host() {
        reset();
        started();
        assert!(owned());
        lost();
        assert!(lost_unknown());
        assert!(owned());
        // A later start never clears the lost state.
        started();
        assert!(lost_unknown());
    }

    #[test]
    fn exit_evidence_is_consumed_once() {
        reset();
        started();
        shutdown_started();
        assert_eq!(phase(), Phase::ShutdownInFlight);
        exit_evidence();
        assert!(consume_exit_evidence());
        assert!(!consume_exit_evidence());
    }

    #[test]
    fn evidence_requires_the_reviewed_shutdown() {
        reset();
        started();
        exit_evidence();
        assert!(!consume_exit_evidence());
        shutdown_started();
        lost();
        exit_evidence();
        assert!(lost_unknown());
        assert!(!consume_exit_evidence());
    }
}
