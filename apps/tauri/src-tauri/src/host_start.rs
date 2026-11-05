//! Fallible host preparation owns a reversible reservation only before spawn is called.
use crate::host_phase::HostPhase;

struct Reservation<'a> {
    host: &'a HostPhase,
    before_spawn: bool,
}

impl Drop for Reservation<'_> {
    fn drop(&mut self) {
        if self.before_spawn {
            self.host.release_start();
        }
    }
}

pub struct Prepared<'a, C> {
    reservation: Reservation<'a>,
    command: C,
}

/// The exact production preflight sequence; closures allow each fallible port to be tested.
pub fn prepare<S, R, A, C, E: From<&'static str>>(
    host: &HostPhase,
    serialize: impl FnOnce() -> Result<S, E>,
    resources: impl FnOnce() -> Result<R, E>,
    admission: impl FnOnce() -> Result<A, E>,
    sidecar: impl FnOnce(S, R, A) -> Result<C, E>,
) -> Result<Prepared<'_, C>, E> {
    host.reserve_start()?;
    let reservation = Reservation {
        host,
        before_spawn: true,
    };
    let files = serialize()?;
    let resource = resources()?;
    let data = admission()?;
    let command = sidecar(files, resource, data)?;
    Ok(Prepared {
        reservation,
        command,
    })
}

impl<C> Prepared<'_, C> {
    pub fn spawn<T, E>(mut self, spawn: impl FnOnce(C) -> Result<T, E>) -> Result<T, E> {
        // Even a spawn error can follow successful OS spawn (e.g. SharedChild setup).
        // Never release admission after crossing this boundary, including unwinding.
        self.reservation.before_spawn = false;
        spawn(self.command)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::host_phase::{Phase, QuitDecision};
    use std::cell::RefCell;

    #[test]
    fn every_injected_preflight_failure_releases_only_the_pre_spawn_reservation() {
        for fail_at in 0..4 {
            let host = HostPhase::new();
            let calls = RefCell::new(Vec::new());
            let operation = |stage| {
                assert_eq!(host.phase(), Phase::Starting);
                calls.borrow_mut().push(stage);
                if stage == fail_at {
                    Err("injected")
                } else {
                    Ok(())
                }
            };
            let result = prepare(
                &host,
                || operation(0),
                || operation(1),
                || operation(2),
                |_, _, _| operation(3),
            );
            assert!(result.is_err());
            assert_eq!(*calls.borrow(), (0..=fail_at).collect::<Vec<_>>());
            assert_eq!(host.phase(), Phase::NotStarted);
            assert_eq!(
                host.decide_quit(false, false, false),
                QuitDecision::ExitDirect
            );
        }
    }

    #[test]
    fn dropping_prepared_command_without_spawn_releases_admission() {
        let host = HostPhase::new();
        let prepared = prepare(
            &host,
            || Ok::<_, &str>(()),
            || Ok(()),
            || Ok(()),
            |_, _, _| Ok(()),
        )
        .unwrap();
        assert_eq!(host.phase(), Phase::Starting);
        drop(prepared);
        assert_eq!(host.phase(), Phase::NotStarted);
    }

    #[test]
    fn spawn_error_possible_spawn_and_ready_timeout_never_release_admission() {
        for failed in [false, true] {
            let host = HostPhase::new();
            let prepared = prepare(
                &host,
                || Ok::<_, &str>(()),
                || Ok(()),
                || Ok(()),
                |_, _, _| Ok(()),
            )
            .unwrap();
            let result = prepared.spawn(|_| {
                assert_eq!(host.phase(), Phase::Starting);
                if failed {
                    Err("spawn may have happened")
                } else {
                    Ok(())
                }
            });
            assert_eq!(result.is_err(), failed);
            assert_eq!(host.phase(), Phase::Starting);
            assert!(host.reserve_start().is_err());
            assert_eq!(
                host.decide_quit(false, false, false),
                QuitDecision::BlockedStarting
            );
            // Production startup timeout marks loss; it never proves absence/cleanup.
            host.lost();
            assert_eq!(host.phase(), Phase::LostUnknown);
            assert!(host.reserve_start().is_err());
        }
    }

    #[test]
    fn unwind_releases_before_spawn_but_never_after_possible_spawn() {
        for spawning in [false, true] {
            let host = HostPhase::new();
            let result = std::panic::catch_unwind(|| {
                let prepared = prepare(
                    &host,
                    || Ok::<_, &str>(()),
                    || Ok(()),
                    || Ok(()),
                    |_, _, _| Ok(()),
                )
                .unwrap();
                if spawning {
                    let _: Result<(), &str> = prepared.spawn(|_| panic!("possible spawn"));
                } else {
                    panic!("pre-spawn");
                }
            });
            assert!(result.is_err());
            assert_eq!(
                host.phase(),
                if spawning {
                    Phase::Starting
                } else {
                    Phase::NotStarted
                }
            );
        }
    }
}
