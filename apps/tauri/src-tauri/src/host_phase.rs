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

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum QuitDecision {
    ExitDirect,
    AgentsGate,
    TerminalFlow,
    BlockedLost,
    AlreadyInFlight,
}

/// One ordered decision for every exit entry: agents gate first, then owned terminals.
pub fn quit_decision(
    phase: Phase,
    agents_active: bool,
    agents_gate_presented: bool,
    in_flight: bool,
) -> QuitDecision {
    if phase == Phase::LostUnknown {
        return QuitDecision::BlockedLost;
    }
    if agents_active && agents_gate_presented {
        return QuitDecision::AgentsGate;
    }
    if phase == Phase::NotStarted {
        return QuitDecision::ExitDirect;
    }
    if in_flight {
        return QuitDecision::AlreadyInFlight;
    }
    QuitDecision::TerminalFlow
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum QuitStep {
    Retire,
    ClosePreserved,
    Blocked(&'static str),
}

/// Map the private shutdown reply to the only allowed next step.
pub fn shutdown_step(status: Option<&str>) -> QuitStep {
    match status {
        Some("ready") => QuitStep::Retire,
        Some("exited_retirement_unavailable") => QuitStep::ClosePreserved,
        Some("uncertain") => QuitStep::Blocked("uncertain"),
        Some("busy") => QuitStep::Blocked("busy"),
        Some("denied") => QuitStep::Blocked("denied"),
        _ => QuitStep::Blocked("transport"),
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum EvidenceStep {
    Exit,
    Blocked(&'static str),
}

pub fn retire_step(status: Option<&str>) -> EvidenceStep {
    match status {
        Some("retired") => EvidenceStep::Exit,
        _ => EvidenceStep::Blocked("retirement"),
    }
}

pub fn close_step(status: Option<&str>) -> EvidenceStep {
    match status {
        Some("closed") => EvidenceStep::Exit,
        _ => EvidenceStep::Blocked("transport"),
    }
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
    fn the_agents_gate_runs_before_the_terminal_flow_and_lost_blocks_all() {
        use QuitDecision::*;
        assert_eq!(quit_decision(Phase::Active, true, true, false), AgentsGate);
        assert_eq!(quit_decision(Phase::Active, true, false, false), TerminalFlow);
        assert_eq!(
            quit_decision(Phase::LostUnknown, true, true, false),
            BlockedLost
        );
        assert_eq!(
            quit_decision(Phase::NotStarted, true, false, false),
            ExitDirect
        );
        assert_eq!(
            quit_decision(Phase::ShutdownInFlight, false, false, true),
            AlreadyInFlight
        );
        assert_eq!(
            quit_decision(Phase::NotStarted, false, false, false),
            ExitDirect
        );
    }

    #[test]
    fn every_shutdown_and_evidence_branch_is_explicit() {
        use EvidenceStep as E;
        use QuitStep as Q;
        assert_eq!(shutdown_step(Some("ready")), Q::Retire);
        assert_eq!(
            shutdown_step(Some("exited_retirement_unavailable")),
            Q::ClosePreserved
        );
        assert_eq!(shutdown_step(Some("uncertain")), Q::Blocked("uncertain"));
        assert_eq!(shutdown_step(Some("busy")), Q::Blocked("busy"));
        assert_eq!(shutdown_step(Some("denied")), Q::Blocked("denied"));
        assert_eq!(shutdown_step(Some("made-up")), Q::Blocked("transport"));
        assert_eq!(shutdown_step(None), Q::Blocked("transport"));
        assert_eq!(retire_step(Some("retired")), E::Exit);
        assert_eq!(retire_step(Some("denied")), E::Blocked("retirement"));
        assert_eq!(retire_step(None), E::Blocked("retirement"));
        assert_eq!(close_step(Some("closed")), E::Exit);
        assert_eq!(close_step(Some("denied")), E::Blocked("transport"));
        assert_eq!(close_step(None), E::Blocked("transport"));
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
