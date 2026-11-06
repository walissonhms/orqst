//! ORQST managed terminal Core. Rust port of `packages/core/src/terminal` behind
//! `ORQST_RUST_TERMINALS=1` (docs/design/rust-terminal-core.md). Every private contract
//! (Node IPC, RPC schemas, journal, receipts, admission files) stays byte compatible.
pub mod admission;
pub mod authority;
pub mod features;
pub mod hub;
pub mod ipc;
pub mod journal;
pub mod output;
pub mod pair;
pub mod profiles;
pub mod pty;
pub mod rpc;
pub mod store;
pub mod supervisor;
pub mod types;
