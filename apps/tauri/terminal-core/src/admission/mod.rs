//! Lane L3. Port of managed-codex/desktop-admission*.ts, terminal/exit-pending.ts,
//! terminal/enrollment-files.ts (serializer/digest), terminal/startup-failure.ts,
//! terminal/owned-shutdown.ts and
//! managed-codex/lifecycle-receipt.ts. Files are byte-compatible with the TypeScript writers and
//! no new file name is ever created in `config.state` or `managed-agents/`.
pub mod enrollment;
pub mod error;
pub mod exit_pending;
pub mod fs;
pub mod json;
pub mod lifecycle_receipt;
pub mod marker;
pub mod owned_shutdown;
pub mod pair_admission;
pub mod startup_failure;

pub use error::{AdmissionError, RefusalCode, Result};
pub use exit_pending::{
    detach_owned_exit_pending, inspect_pending_owned_exits, preserve_owned_exit_pending,
    read_owned_exit_pending, OwnedExitPending, PendingOwnedExitNotice,
};
pub use lifecycle_receipt::{
    arm_lifecycle_receipt, assert_lifecycle_config, create_lifecycle_receipt,
    read_lifecycle_receipt, LifecycleBinding, LifecycleEvent, LifecycleReceiptRead,
    LifecycleRecorder,
};
pub use marker::{inspect_desktop_admission, DesktopAdmission, DesktopAdmissionContext};
pub use owned_shutdown::{
    parse_owned_shutdown_inventory, OwnedShutdownInventory, OwnedShutdownPorts,
    OwnedShutdownResult, OwnedTerminalShutdown,
};
pub use pair_admission::SharedDesktopAdmission;
pub use startup_failure::{
    core_startup_failure_message, terminal_startup_failure, terminal_startup_host_failure,
    TerminalPreparationFailure,
};
