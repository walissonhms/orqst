# Team configuration component review — 2026-11-04

Baseline `89bd625`, isolated branch `feat/team-config-sqlite-696`. Inspected the
repository instructions, README, master specification/tracker, preserved audits,
layout/identity documentation and actual Store/PTY/communication/native code before
editing. Node 24.22.2, pnpm 10.34.9, TypeScript 6 and the existing Tauri 2/Electron
preview boundaries remain. No dependency or upstream source fragment is added.

Anywh was inspected first at `546f189c04415c3c5af5f40e3931a0a90b9aba31`:
[architecture](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/docs/architecture.md),
[Agent Host](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/docs/agent-host.md),
[runtime contract](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/runtimes/README.md).
[`relay/src/host/terminalSession.ts:spawnTerminal`](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/host/terminalSession.ts) uses node-pty, child_process and
tmux `new-session -A`; this cannot replace metadata-only restoration or authorize
ORQST ownership. [`relay/src/session/sessionStore.ts:SessionStore.load`](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/session/sessionStore.ts) persists CLI
continuity/permission state and sanitizes/migrates it. [`relay/src/session/room.ts:RoomMembership`](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/session/room.ts) models principal/worker reports/queued messages and distinguishes
live state from stored membership. **Keep ORQST** Store, UUIDs, per-attempt native
signatures and durable queue; do not import its resume/room manager or filesystem
migration/recovery. `RoomContextStore.readOwned` may remove malformed files, unlike
ORQST's preservation requirement. Its closure includes filesystem/PDF/index/session
contracts; no part is copied.

Tucano was inspected at `0501956d127699300209902e889f3e69a0948766`:
[`src/core/db.ts:MIGRATIONS`, agent read/upsert](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/src/core/db.ts)
separates agent ID/handle/role from conversation membership and stores grants in
agent rows. [`src/core/runs.ts:Runner.send/enqueue/execute/chain`](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/src/core/runs.ts)
depends on application DB, engines, context and model-output chaining. **Keep ORQST**
existing attributed mention parser, schemas, Store, FIFO queue and actor/task grants;
stored permissions must remain proposals, not restored runtime authority.

Root LICENSE files at both exact pins were re-read: Apache-2.0. Tracked trees have
no additional NOTICE. No upstream source/dependency is newly incorporated; existing
LICENSE/NOTICE attribution remains intact. The dependency closure of rejected whole
managers is not cleared for wholesale incorporation. ORQST's existing code is reused
rather than introducing a second session/communication manager.

Overclock remains a visual reference only: no exact source SHA or compatible grant
was established, and no source, assets or branding is copied. V6 user-supplied HTML
is a simulated visual reference, not process/task evidence.

## V6 scope adjustment

The complete owner paste, five Markdown documents and HTML from the V6 ZIP were
read, then the updated main AGENTS.md was read at `9d7abfc`. V6 supersedes the older
workspace-only team scope. Anywh's room membership/session persistence and Tucano's
conversation membership do not provide ORQST's signed Feature identity, SQLite
queue grants or preservation contract. Keep the existing Store and communication
service with an additive optional Feature field and namespaced metadata keys.
Qualified mention tokens are retained for rejection as a whole; they cannot route
their prefix to a local handle. No new upstream fragment or dependency is copied.

The original legacy editor experiment is preserved at `f9d31aa` on
`preserve/team-config-editor-696`. The delivered `feat/features-core-696` branch
contains Core, protocol, database, tests and its own documentation only. Desktop,
Rust, scripts and central V6/release documents belong to the orchestrator/other
workers. The runtime still denies cross-Feature traffic; no cross-Feature native
provider acceptance or unified V6 session manager is claimed.
