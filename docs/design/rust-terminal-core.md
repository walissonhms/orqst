# Rust terminal Core — design

Status: draft 2026-11-06, pane-768. Owner decision (2026-11-06): port the managed terminal
runtime (supervisor, journal, recovery, PTY, profiles, CLI policy, lifecycle, MCP hub) to
Rust behind `ORQST_RUST_TERMINALS=1`; the Node path stays the default until the owner
accepts the Rust path. Reference research: pane-825 report
(`orqst-reference-753/rust-terminal-pilot-research.md`, Anywh `0866169`, Tucano `c321b30`):
neither reference owns a PTY in Rust; nothing is reused from them for the PTY.

## Strategy: replace from the inside, keep every contract

Today: Tauri (`terminal.rs`) → Node host (`tauri-terminal-host.cjs`) → Node Core
(`managed-terminal-core.cjs`, `packages/core/src/terminal/host.ts`) → Node PTY leaf
(`managed-terminal-host.cjs`, `pty-host.ts`) → CLI.

- **Stage A — Rust Core binary.** `orqst-terminal-core` replaces `managed-terminal-core.cjs`
  and the PTY leaf. It speaks the same private Node IPC (`serialization: 'json'`, one JSON
  value per line on `NODE_CHANNEL_FD`) and implements `terminalPairRPCSchema` /
  `terminalRPCSchema` / `terminalPairReadySchema` (`rpc.ts`) unchanged. The host, the
  webviews and `terminal.rs` do not change. Under the flag, `managed-terminal-core.ts`
  spawns the Rust binary instead of forking Node.
- **Stage B — host into Tauri.** Broker, CLI policy, layout and Features move from
  `tauri-terminal-host.ts` into the Tauri process; then no Node process remains in the
  terminal path.

## Crate

`apps/tauri/terminal-core` (lib + bin `orqst-terminal-core`), Apache-2.0. Modules:

| Module         | Ports                                                                    | Lane |
| -------------- | ------------------------------------------------------------------------ | ---- |
| `ipc`          | Node IPC framing, startup args, `ready` / `startup-failure`              | L1   |
| `authority`    | `authority.ts` challenge bytes, ed25519 verify, digests                  | L1   |
| `supervisor`   | `supervisor.ts` state machine, leases, rates, limits                     | L1   |
| `output`       | `output.ts` 1 MiB ring, cursor/gap                                       | L1   |
| `pty`          | `pty-host.ts` + node-pty: openpty, setsid/TIOCSCTTY, exact signals       | L1   |
| `journal`      | `terminal-journal.ts` (rusqlite, same schema), lifecycle receipts        | L1   |
| `profiles`     | interactive/codex/opencode profiles, adapters, model selection, CLI path | L2   |
| `admission`    | desktop admission marker, exit-pending, enrollment files, retirement     | L3   |
| `features`     | Feature/permission/team/layout tables in the main Store (no migrations)  | L4   |
| `hub`          | MCP hub, endpoints, hub journal, communication projection, mentions      | L4   |

## Invariants (must hold byte for byte)

- Journal schema and `PRAGMA` settings of `terminal-journal.ts`; receipts
  (`lifecycle-receipt.ts`), `active-pair.json`, enrollment/exit-pending/retired files and
  offline-recovery inputs keep their exact formats and names. No new file in
  `config.state` or `managed-agents/` (held recovery compares directory listings).
- Signals are exactly SIGTERM/SIGKILL to the owned pid; exit carries numeric code and
  signal; transport loss is uncertainty, never exit. 30-minute owned deadline.
- No PID adoption; kernel identity stays `kern.bootsessionuuid` plus lease files.
- The environment profile is unchanged (no injected `SHELL`), so `cliAuthorizationScope`
  and the native CLI review stay valid. The cwd is verified; no fallback to `$HOME`.
- The Rust Core never migrates the main Store; it refuses an unknown schema version.

## Verification

- Rust unit tests per module; golden tests compare Rust profile/digest output with the
  TypeScript functions on synthetic fixtures.
- The existing TypeScript RPC tests run against the Rust binary where they exercise the
  private protocol.
- Native acceptance on the owner's Mac with the flag on, then the owner compares paths.
