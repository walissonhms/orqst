# Tauri managed-terminal reuse — 2026-11-04

Baseline: clean ORQST `368bbc1`, Node 24.22.2, pnpm 10.34.9, existing Tauri 2.12.5,
SQLite, Electron 45.2.1, node-pty 1.1.0 and xterm 6.0.0. Implementation was isolated in
`feat/tauri-managed-terminals-679`; other worktrees were preserved. The master
specification and repository rules were read before edits, including the original
implementation plan and preserved Tucano audit. This increment ports the prepared
PTY workflow, not the entire master specification.

## Source inspection and decisions

Anywh was inspected from a separate research checkout pinned to
[`546f189c04415c3c5af5f40e3931a0a90b9aba31`](https://github.com/anywh-sh/anywh/tree/546f189c04415c3c5af5f40e3931a0a90b9aba31).
No upstream executable or installation script was run.

| Candidate          | Exact pinned source                                                                                                                                                                                                                                                                                                                                                                                        | Decision and contract differences                                                                                                                                                                                                                                                                                                                             |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Embedded terminal  | [`relay/src/host/terminalSession.ts`](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/host/terminalSession.ts), `spawnTerminal`, `killTerminal`, `tmuxSocketName`, `tmuxSessionName`                                                                                                                                                                             | **Keep existing ORQST.** Anywh depends on node-pty plus an external tmux, uses `new-session -A` for attachment and maps IDs from network queries into tmux names. ORQST already has manifest-hash validation, signed one-shot admission, private journals and no resume/adoption. Copying tmux attachment would change both ownership and recovery authority. |
| Sidecar lifecycle  | [`client/src-tauri/src/tailnet_sidecar.rs`](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/client/src-tauri/src/tailnet_sidecar.rs), `TailnetSidecars`, `tailnet_sidecar_start`, `kill_all`                                                                                                                                                                               | **Keep the earlier attributed ORQST adaptation.** Reuse the installed shell plugin's retained child/stream drain for the second fixed Node entry. No tailnet identity, arbitrary spawn command or remote service model is incorporated. Existing attribution remains in NOTICE and `sidecar.rs`.                                                              |
| Agent host/drivers | [`docs/architecture.md`](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/docs/architecture.md), [`docs/agent-host.md`](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/docs/agent-host.md), [`relay/src/runtimes/README.md`](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/runtimes/README.md) | **Keep existing ORQST.** The independent persistent room-agent/socket/resume service is not needed to connect the already-owned ORQST PTY host to a native shell. Documentation informed scope; implementation decisions about terminal attachment come from the actual code above. No Anywh driver capability or real-provider equivalence is inferred.      |

The pinned Anywh root LICENSE is Apache-2.0. The selected tree contains no separate
NOTICE or selected-file license header requiring additional preservation. No new
Anywh text is copied by this increment; earlier incorporated code and attribution
are unchanged. Tucano communication and Overclock layout remain outside this
terminal transport change; their earlier review is not represented as new acceptance.
No third-party visual identity, asset or source was copied.

## Concrete reuse

`apps/desktop/src/managed-terminal-core.ts`, `terminal-document.ts`, `terminal-client.ts`
and `managed-terminal-client.ts`, plus Core `terminal/host.ts`, `pty-host.ts`,
`native-broker.ts`, `managed-files.ts`, `managed-pair.ts`, RPC and authority are reused
without replacing their Electron paths. The new native client loads the existing
document/xterm with a narrow Tauri invoke adapter. The new private Node service holds
the existing broker; Rust owns document identity, focus, dialogs and bounded pipe
routing. Core remains the owner of journals, admission, signatures and PTYs.

Only Tauri-specific integration and executable tests are new. No duplicate session
manager, CLI adapter, provider task protocol, database schema or observer execution
API is introduced. Electron source behavior is unchanged; its build and existing
Node regression tests pass. No native Electron UI acceptance is claimed here.

New direct dependencies: `@tauri-apps/api` 2.12.4 and `tauri-plugin-dialog` 2.8.4
(Apache-2.0 OR MIT), `serde_json` (MIT OR Apache-2.0). Their installed registry source
licenses were inspected. Dialog's native backend `rfd` 0.17.2 is MIT; its macOS
`backend/macos/message_dialog.rs`, `Alert::new` and `dialog_result` were inspected to
bind default/first and third buttons to Cancel, with approval only by the middle
custom label. The plugin's `show_with_result` avoids interpreting default OK as consent.
Its transitive filesystem plugin receives no renderer permissions.

The resource builder stages the existing macOS arm64 PTY payload and collects licenses
from actual terminal bundle inputs as well as the existing dashboard/Core closure.
The reviewed `Apache-2.0 OR MIT` JS expression was added to the license gate; unknown
grants still fail staging. Full native transitive notice/distribution review remains
unresolved as recorded by the earlier shell increment; no installer release is claimed.

## Verification and security review

`pnpm lint`, `pnpm typecheck`, `pnpm test` (579 passed), `pnpm build`, two Rust tests,
Clippy with warnings denied, `pnpm build:tauri --debug --bundles app`,
`pnpm accept:tauri-core`, and `pnpm accept:tauri-terminals --authorize-synthetic` passed.
Native builds used the existing isolated Rust toolchain and reduced debug symbols
after an initial ENOSPC failure; only this worktree's generated target was removed.
Initial packaging acceptance correctly rejected a noncanonical temp path, then a
fixture without synthetic login metadata. The final harness uses canonical private
state and waits for confirmed input before typing; no application guard was weakened.

The terminal acceptance copies shipped resources outside the checkout, executes the
real node-pty fixture and exercises the Tauri xterm bundle in Chromium. Native consent,
identity and focus are simulated there. Native inspection separately reached the menu,
terminal/xterm and exact-action Start dialog, but focus changed during approval and
input was revoked. A completed native execution cycle remains **unaccepted**.

Security review: no observer API, cookie, WebSocket or source-access change. Dedicated
local capability, strict native identity, no renderer slot/proof/path, default cancel,
quoted bounded paste, blur/hide/reload fencing, bounded pipe/output, no retry/adoption,
unchanged manifest/admission/hash checks and separate preview state are retained.
See [security model](../architecture/security-model.md) and [remaining work](../development/tauri.md).
Real provider tasks, full browser suite, source ingestion acceptances and other-platform
or signed packaging were not run. Native retirement/reselection, split layout and MCP
authorization are explicitly incomplete; no state is deleted to conceal those limits.
