//! Lane L6. Rust port of the offline recovery of owned terminal reservations:
//! `packages/core/src/terminal/offline-recovery.ts`, `offline-recovery-files.ts`,
//! `offline-historical-binding.ts`, `offline-physical-binding.ts`,
//! `packages/database/src/offline-terminal-journal.ts` and the native helper
//! `apps/desktop/src/tauri-offline-recovery-host.ts` (with `tauri-offline-recovery.ts`,
//! `offline-recovery-wire.ts`, `offline-recovery-anchor.ts`, `offline-recovery-arguments.ts`).
//! Every file name and format is byte compatible with the TypeScript writers; see
//! `docs/design/rust-terminal-core.md`. Not wired into the app.
pub mod anchor;
pub mod binding;
pub mod engine;
pub mod error;
pub mod fsio;
pub mod host;
pub mod image;
pub mod intent;
pub mod js;
pub mod schema;
pub mod snapshot;
pub mod wire;

pub use engine::{
    native_kernel_boot_uuid, CaptureOutcome, Dependencies, FinalizeOutcome,
    NativeAdministrativeRecovery, OfflineReservationRecovery, ReleaseOutcome,
};
pub use error::{RecoveryError, Result};
pub use intent::{AdminIntent, Challenge};
pub use snapshot::{
    assert_held_recovery_snapshot, snapshot_offline_reservation, HistoricalEvidence,
};
