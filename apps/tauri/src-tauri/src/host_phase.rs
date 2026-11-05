//! Native owned-host lifecycle. Survives losing the host handle; absence is not evidence.
use std::sync::Mutex;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Phase {
    NotStarted,
    Starting,
    Exiting,
    ExitConsumed,
    Active,
    ShutdownInFlight,
    ExitEvidenceConfirmed,
    LostUnknown,
}

/// One admission boundary shared by start and Quit; terminal exit phases never reopen it.
pub struct HostPhase(Mutex<Phase>);

impl HostPhase {
    pub const fn new() -> Self {
        Self(Mutex::new(Phase::NotStarted))
    }

    pub fn phase(&self) -> Phase {
        *self.0.lock().unwrap()
    }

    pub fn reserve_start(&self) -> Result<(), &'static str> {
        let mut phase = self.0.lock().unwrap();
        if *phase != Phase::NotStarted {
            return Err("Native terminal host admission is closed");
        }
        *phase = Phase::Starting;
        Ok(())
    }

    pub fn release_start(&self) {
        let mut phase = self.0.lock().unwrap();
        if *phase == Phase::Starting {
            *phase = Phase::NotStarted;
        }
    }

    pub fn started(&self) {
        let mut phase = self.0.lock().unwrap();
        if *phase == Phase::Starting {
            *phase = Phase::Active;
        }
    }

    pub fn lost(&self) {
        let mut phase = self.0.lock().unwrap();
        if matches!(
            *phase,
            Phase::Starting | Phase::Active | Phase::ShutdownInFlight
        ) {
            *phase = Phase::LostUnknown;
        }
    }

    pub fn shutdown_started(&self) {
        let mut phase = self.0.lock().unwrap();
        if *phase == Phase::Active {
            *phase = Phase::ShutdownInFlight;
        }
    }

    pub fn rollback_busy(&self) -> bool {
        let mut phase = self.0.lock().unwrap();
        if *phase != Phase::ShutdownInFlight {
            return false;
        }
        *phase = Phase::Active;
        true
    }

    pub fn exit_evidence(&self) {
        let mut phase = self.0.lock().unwrap();
        if *phase == Phase::ShutdownInFlight {
            *phase = Phase::ExitEvidenceConfirmed;
        }
    }

    pub fn consume_exit_evidence(&self) -> bool {
        let mut phase = self.0.lock().unwrap();
        if *phase != Phase::ExitEvidenceConfirmed {
            return false;
        }
        *phase = Phase::ExitConsumed;
        true
    }

    pub fn owned(&self) -> bool {
        !matches!(
            self.phase(),
            Phase::NotStarted | Phase::Exiting | Phase::ExitConsumed
        )
    }

    /// Reserve direct exit under the same lock as start admission, before calling the OS.
    pub fn decide_quit(&self, agents: bool, gate: bool, in_flight: bool) -> QuitDecision {
        let mut phase = self.0.lock().unwrap();
        let decision = quit_decision(*phase, agents, gate, in_flight);
        if decision == QuitDecision::ExitDirect && *phase == Phase::NotStarted {
            *phase = Phase::Exiting;
        }
        decision
    }
}

pub fn phase() -> Phase {
    crate::quit_orchestration::QUIT.host.phase()
}
pub fn reserve_start() -> Result<(), &'static str> {
    crate::quit_orchestration::QUIT.host.reserve_start()
}
pub fn release_start() {
    crate::quit_orchestration::QUIT.host.release_start();
}
pub fn started() {
    crate::quit_orchestration::QUIT.host.started();
}
pub fn lost() {
    crate::quit_orchestration::QUIT.host.lost();
}

pub fn pre_gate_block(phase: Phase) -> Option<&'static str> {
    match phase {
        Phase::LostUnknown => Some("host_lost"),
        Phase::Starting => Some("starting"),
        _ => None,
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum QuitDecision {
    ExitDirect,
    AgentsGate,
    TerminalFlow,
    BlockedLost,
    BlockedStarting,
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
    if phase == Phase::Starting {
        return QuitDecision::BlockedStarting;
    }
    if agents_active && agents_gate_presented {
        return QuitDecision::AgentsGate;
    }
    if matches!(
        phase,
        Phase::NotStarted | Phase::Exiting | Phase::ExitConsumed
    ) {
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
        Some("refused_prefence") => QuitStep::Blocked("refused_prefence"),
        Some("fenced") => QuitStep::Blocked("fenced"),
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

    fn active() -> HostPhase {
        let host = HostPhase::new();
        host.reserve_start().unwrap();
        host.started();
        host
    }

    #[test]
    fn absence_is_not_evidence_of_a_lost_host() {
        let host = active();
        assert!(host.owned());
        host.lost();
        assert_eq!(host.phase(), Phase::LostUnknown);
        assert!(host.owned());
        // A later start never clears the lost state.
        host.started();
        assert_eq!(host.phase(), Phase::LostUnknown);
    }

    #[test]
    fn exit_evidence_is_consumed_once() {
        let host = active();
        host.shutdown_started();
        assert_eq!(host.phase(), Phase::ShutdownInFlight);
        host.exit_evidence();
        assert!(host.consume_exit_evidence());
        assert!(!host.consume_exit_evidence());
        assert_eq!(host.phase(), Phase::ExitConsumed);
        assert!(!host.owned());
        host.lost();
        assert_eq!(host.phase(), Phase::ExitConsumed);
        assert!(host.reserve_start().is_err());
        host.started();
        assert_eq!(host.phase(), Phase::ExitConsumed);
        assert_eq!(
            host.decide_quit(false, false, false),
            QuitDecision::ExitDirect
        );
    }

    #[test]
    fn the_agents_gate_runs_before_the_terminal_flow_and_lost_blocks_all() {
        use QuitDecision::*;
        assert_eq!(quit_decision(Phase::Active, true, true, false), AgentsGate);
        assert_eq!(
            quit_decision(Phase::Active, true, false, false),
            TerminalFlow
        );
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
        assert_eq!(
            quit_decision(Phase::Starting, false, false, false),
            BlockedStarting
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
        assert_eq!(
            shutdown_step(Some("refused_prefence")),
            Q::Blocked("refused_prefence")
        );
        assert_eq!(shutdown_step(Some("fenced")), Q::Blocked("fenced"));
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
    fn only_an_explicit_pre_fence_reply_rolls_back() {
        let host = active();
        host.shutdown_started();
        assert!(host.rollback_busy());
        assert_eq!(host.phase(), Phase::Active);
        assert!(!host.rollback_busy());
        // Unknown or lost keeps the fence and cannot roll back.
        host.lost();
        assert!(!host.rollback_busy());
        assert_eq!(host.phase(), Phase::LostUnknown);
    }

    #[test]
    fn evidence_requires_the_reviewed_shutdown() {
        let host = active();
        host.exit_evidence();
        assert!(!host.consume_exit_evidence());
        host.shutdown_started();
        host.lost();
        host.exit_evidence();
        assert_eq!(host.phase(), Phase::LostUnknown);
        assert!(!host.consume_exit_evidence());
    }
    #[test]
    fn start_and_direct_quit_are_ordered_by_the_same_lock() {
        let start_first = HostPhase::new();
        start_first.reserve_start().unwrap();
        assert_eq!(
            start_first.decide_quit(false, false, false),
            QuitDecision::BlockedStarting
        );
        assert_eq!(pre_gate_block(start_first.phase()), Some("starting"));
        assert!(start_first.reserve_start().is_err());
        start_first.release_start();
        assert_eq!(start_first.phase(), Phase::NotStarted);

        let quit_first = HostPhase::new();
        assert_eq!(
            quit_first.decide_quit(false, false, false),
            QuitDecision::ExitDirect
        );
        assert_eq!(quit_first.phase(), Phase::Exiting);
        assert!(quit_first.reserve_start().is_err());
        quit_first.release_start();
        quit_first.started();
        quit_first.lost();
        assert_eq!(quit_first.phase(), Phase::Exiting);
        assert!(!quit_first.owned());
    }

    #[test]
    fn starting_and_lost_are_rejected_before_and_after_the_agents_gate() {
        assert_eq!(pre_gate_block(Phase::Starting), Some("starting"));
        assert_eq!(pre_gate_block(Phase::LostUnknown), Some("host_lost"));
        assert_eq!(pre_gate_block(Phase::Active), None);
        assert_eq!(
            quit_decision(Phase::Starting, true, true, false),
            QuitDecision::BlockedStarting
        );
    }
}
