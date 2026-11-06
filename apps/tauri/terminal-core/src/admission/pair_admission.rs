//! `pair::Admission` over the desktop admission port. The pair owns a boxed handle; the
//! one-shot release step returned by `prepare_release` keeps its own clone of the handle.
use super::error::Result;
use super::marker::{DesktopAdmission, EnrollmentReservation};
use crate::pair::Admission;
use serde_json::Value;
use std::sync::{Arc, Mutex, MutexGuard};

/// Shared handle to one Core's `DesktopAdmission` (`desktopAgentsAdmission` closure state).
#[derive(Clone)]
pub struct SharedDesktopAdmission(Arc<Mutex<DesktopAdmission>>);

fn text<T>(result: Result<T>) -> std::result::Result<T, String> {
    result.map_err(|error| error.to_string())
}

impl SharedDesktopAdmission {
    pub fn new(admission: DesktopAdmission) -> Self {
        Self(Arc::new(Mutex::new(admission)))
    }

    fn lock(&self) -> std::result::Result<MutexGuard<'_, DesktopAdmission>, String> {
        // A panic inside an admission step leaves its effect uncertain: refuse, never reuse.
        self.0
            .lock()
            .map_err(|_| "Desktop admission unavailable".to_string())
    }

    /// `admission.owner`.
    pub fn owner(&self) -> std::result::Result<String, String> {
        Ok(self.lock()?.owner().to_owned())
    }

    /// `reserveEnrollment({ input, manifestFile, member })` for later enrollment wiring; pass the
    /// reservation to `finish_enrollment` with the receipt.
    pub fn reserve_enrollment(
        &self,
        input: &Value,
        manifest_file: &str,
        member: &Value,
    ) -> std::result::Result<EnrollmentReservation, String> {
        text(
            self.lock()?
                .reserve_enrollment(input, manifest_file, member),
        )
    }

    pub fn finish_enrollment(
        &self,
        reservation: &EnrollmentReservation,
        receipt: &Value,
    ) -> std::result::Result<(), String> {
        text(self.lock()?.finish_enrollment(reservation, receipt))
    }

    /// `preservePendingExit()`: handoff to `pending-pair-<owner>.json` after a durable exit marker.
    pub fn preserve_pending_exit(&self) -> std::result::Result<(), String> {
        text(self.lock()?.preserve_pending_exit())
    }

    /// Run `f` with the admission locked (exit-pending preservation passes `assert_owner`).
    pub fn with<T>(
        &self,
        f: impl FnOnce(&mut DesktopAdmission) -> T,
    ) -> std::result::Result<T, String> {
        Ok(f(&mut *self.lock()?))
    }
}

impl Admission for SharedDesktopAdmission {
    fn preflight(&mut self) -> std::result::Result<(), String> {
        text(self.lock()?.preflight())
    }

    fn claim(&mut self) -> std::result::Result<(), String> {
        text(self.lock()?.claim())
    }

    fn assert_owner(&self) -> std::result::Result<(), String> {
        text(self.lock()?.assert_owner())
    }

    /// Writes the exclusive `retired-<owner>-<uuid>.json` archive now; the returned step (called
    /// after the pair is fenced) verifies the archive bytes and removes `active-pair.json`.
    fn prepare_release(
        &mut self,
        evidence: &Value,
    ) -> std::result::Result<Box<dyn FnMut() -> std::result::Result<(), String>>, String> {
        let preparation = text(self.lock()?.prepare_release(evidence))?;
        let handle = self.clone();
        Ok(Box::new(move || {
            text(handle.lock()?.finish_release(&preparation))
        }))
    }

    fn reserve_enrollment(
        &mut self,
        input: &Value,
        manifest_file: &str,
        member: &Value,
    ) -> std::result::Result<Box<dyn FnMut(&Value) -> std::result::Result<(), String>>, String>
    {
        let reservation = SharedDesktopAdmission::reserve_enrollment(self, input, manifest_file, member)?;
        let handle = self.clone();
        Ok(Box::new(move |receipt| handle.finish_enrollment(&reservation, receipt)))
    }
}
