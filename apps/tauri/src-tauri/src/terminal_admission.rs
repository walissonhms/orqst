//! Pure identity gates used by the native append consumer after asynchronous boundaries.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct AdmissionIdentity<'a> {
    pub owner: &'a str,
    pub epoch: &'a str,
    pub initial_files: &'a [String],
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct PreparationSnapshot<'a> {
    pub identity: AdmissionIdentity<'a>,
    pub presentation: u64,
    pub revision: u64,
    pub count: usize,
}

pub(crate) fn same_admission(
    current: AdmissionIdentity<'_>,
    expected: AdmissionIdentity<'_>,
) -> bool {
    !expected.owner.is_empty()
        && !expected.epoch.is_empty()
        && !expected.initial_files.is_empty()
        && expected.initial_files.iter().all(|file| !file.is_empty())
        && current == expected
}

/// Called with the native state mutex held; the returned host is stopped outside it.
pub(crate) fn take_host<T>(
    current: &mut Option<T>,
    expected: AdmissionIdentity<'_>,
    identity: for<'a> fn(&'a T) -> AdmissionIdentity<'a>,
) -> Option<T> {
    if current
        .as_ref()
        .is_some_and(|host| same_admission(identity(host), expected))
    {
        current.take()
    } else {
        None
    }
}

pub(crate) fn preparation_matches(
    current: PreparationSnapshot<'_>,
    expected: PreparationSnapshot<'_>,
    available: bool,
) -> bool {
    available && same_admission(current.identity, expected.identity) && current == expected
}

// Receipt success may advance layout/document revisions. After dispatch only the
// original owner/epoch/files and the exact outstanding operation can consume a reply.
pub(crate) fn owns_enrollment(
    current: AdmissionIdentity<'_>,
    expected: AdmissionIdentity<'_>,
    request: Option<&str>,
    id: &str,
) -> bool {
    same_admission(current, expected) && request == Some(id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn changed_core_or_presentation_before_dispatch_refuses() {
        let files = vec!["/synthetic/initial.json".to_owned()];
        let other_files = vec!["/synthetic/replacement.json".to_owned()];
        let identity = AdmissionIdentity {
            owner: "owner-a",
            epoch: "epoch-a",
            initial_files: &files,
        };
        let expected = PreparationSnapshot {
            identity,
            presentation: 3,
            revision: 4,
            count: 1,
        };
        assert!(preparation_matches(expected, expected, true));
        assert!(!preparation_matches(expected, expected, false));
        for current in [
            PreparationSnapshot {
                identity: AdmissionIdentity {
                    owner: "owner-b",
                    ..identity
                },
                ..expected
            },
            PreparationSnapshot {
                identity: AdmissionIdentity {
                    epoch: "epoch-b",
                    ..identity
                },
                ..expected
            },
            PreparationSnapshot {
                identity: AdmissionIdentity {
                    initial_files: &other_files,
                    ..identity
                },
                ..expected
            },
            PreparationSnapshot {
                presentation: 5,
                ..expected
            },
            PreparationSnapshot {
                revision: 5,
                ..expected
            },
            PreparationSnapshot {
                count: 2,
                ..expected
            },
        ] {
            assert!(!preparation_matches(current, expected, true));
        }
    }

    #[test]
    fn stale_ready_rejected_timeout_and_ui_completion_never_own_a_new_request() {
        let files = vec!["/synthetic/initial.json".to_owned()];
        let other_files = vec!["/synthetic/other.json".to_owned()];
        let expected = AdmissionIdentity {
            owner: "owner-a",
            epoch: "epoch-a",
            initial_files: &files,
        };
        for _outcome in ["ready", "rejected", "timeout", "ui-created", "presented"] {
            for changed in [
                AdmissionIdentity {
                    owner: "owner-b",
                    ..expected
                },
                AdmissionIdentity {
                    epoch: "epoch-b",
                    ..expected
                },
                AdmissionIdentity {
                    initial_files: &other_files,
                    ..expected
                },
            ] {
                assert!(!owns_enrollment(
                    changed,
                    expected,
                    Some("operation-a"),
                    "operation-a"
                ));
            }
            assert!(!owns_enrollment(
                expected,
                expected,
                Some("operation-b"),
                "operation-a"
            ));
            assert!(!owns_enrollment(expected, expected, None, "operation-a"));
        }
        assert!(owns_enrollment(
            expected,
            expected,
            Some("operation-a"),
            "operation-a"
        ));
        let before = PreparationSnapshot {
            identity: expected,
            presentation: 3,
            revision: 4,
            count: 1,
        };
        let applied = PreparationSnapshot {
            revision: 5,
            count: 2,
            ..before
        };
        assert!(!preparation_matches(applied, before, true));
        assert!(owns_enrollment(
            applied.identity,
            before.identity,
            Some("operation-a"),
            "operation-a"
        ));
        // The authoritative ready receipt and presentation generation are checked separately.
    }
    #[test]
    fn late_eof_never_takes_replacement_but_current_cleanup_runs_once() {
        use std::cell::Cell;
        use std::rc::Rc;
        struct Host {
            owner: String,
            epoch: String,
            files: Vec<String>,
            stopped: Rc<Cell<usize>>,
        }
        impl Drop for Host {
            fn drop(&mut self) {
                self.stopped.set(self.stopped.get() + 1);
            }
        }
        fn identity(host: &Host) -> AdmissionIdentity<'_> {
            AdmissionIdentity {
                owner: &host.owner,
                epoch: &host.epoch,
                initial_files: &host.files,
            }
        }
        let files = vec!["/synthetic/initial.json".to_owned()];
        let old = AdmissionIdentity {
            owner: "old-owner",
            epoch: "old-epoch",
            initial_files: &files,
        };
        let next = AdmissionIdentity {
            owner: "next-owner",
            epoch: "next-epoch",
            initial_files: &files,
        };
        let stopped = Rc::new(Cell::new(0));
        let host = || Host {
            owner: next.owner.into(),
            epoch: next.epoch.into(),
            files: files.clone(),
            stopped: stopped.clone(),
        };
        let mut current = Some(host());
        assert!(take_host(&mut current, old, identity).is_none());
        assert!(current.is_some());
        assert_eq!(stopped.get(), 0);
        let taken = take_host(&mut current, next, identity);
        assert!(current.is_none());
        assert_eq!(stopped.get(), 0); // Ownership moved; stopping is a separate outside-lock effect.
        drop(taken);
        assert_eq!(stopped.get(), 1);
        assert!(take_host(&mut current, next, identity).is_none());
        current = Some(host());
        assert!(take_host(&mut current, old, identity).is_none());
        assert!(current.is_some());
        let missing = AdmissionIdentity {
            owner: "",
            epoch: "",
            initial_files: &[],
        };
        assert!(!same_admission(missing, missing));
        assert!(take_host(&mut current, missing, identity).is_none());
        // Intentional public Stop still takes the current host without a reader filter.
        drop(current.take());
        assert!(current.is_none());
        assert_eq!(stopped.get(), 2);
    }
}
