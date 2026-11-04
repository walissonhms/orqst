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
`relay/src/host/terminalSession.ts:spawnTerminal` uses node-pty, child_process and
tmux `new-session -A`; this cannot replace metadata-only restoration or authorize
ORQST ownership. `relay/src/session/sessionStore.ts:SessionStore.load` persists CLI
continuity/permission state and sanitizes/migrates it. `relay/src/session/room.ts`
`RoomMembership` models principal/worker reports/queued messages and distinguishes
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
