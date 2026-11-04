# Tauri native coexistence review — 2026-11-04

Baseline: ORQST `332aca9`, clean main; implementation is isolated in
`fix/tauri-native-coexistence`. Repository rules, master specification, README,
implementation plan and preserved Tucano audit were consulted. The actual project
uses Node 24.22.2, pnpm 10.34.9, TypeScript 6.0.3, Tauri 2.12.5, dialog 2.8.4,
Rust 1.99.1, SQLite and the existing React/Node services. No dependency changed.

Anywh was inspected from the separate checkout at
[`546f189c04415c3c5af5f40e3931a0a90b9aba31`](https://github.com/anywh-sh/anywh/tree/546f189c04415c3c5af5f40e3931a0a90b9aba31).
The required architecture, Agent Host and runtime README documents were consulted;
the decisions below come from actual code. No upstream executable or installer ran.

| Candidate                 | Source and dependencies                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Decision and contract differences                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Native focus/lifecycle    | [`client/src-tauri/src/lib.rs`](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/client/src-tauri/src/lib.rs), single-instance callback; [`tailnet_sidecar.rs`](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/client/src-tauri/src/tailnet_sidecar.rs), `TailnetSidecars`, `tailnet_sidecar_start`; Tauri shell/Tokio                                                                                                                                              | **Keep existing ORQST adaptation.** Retained child ownership and fixed native entry are already implemented. Showing/focusing a window is visual navigation, not an execution grant. No remote tailnet or arbitrary renderer spawn.                                                                                                                                                            |
| Layout commands           | [`client/src/hooks/useLayoutCommands.ts`](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/client/src/hooks/useLayoutCommands.ts), `handleToggleTerminalPanel`, `handleOpenTerminalAt`; React, session dock and tab hooks                                                                                                                                                                                                                                                                            | **Keep existing ORQST.** The existing `TauriTerminalLayout` already separates visual metadata from owned process authority. Add regression coverage without importing upstream session/profile clients or replacing retained webviews.                                                                                                                                                         |
| Native end-to-end harness | [`client/src-tauri/src/lib.rs`](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/client/src-tauri/src/lib.rs), `cfg(feature = "e2e")`; [`Cargo.toml`](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/client/src-tauri/Cargo.toml), optional `tauri-plugin-wdio`/`tauri-plugin-wdio-webdriver`; [`tauri.e2e.conf.json`](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/client/src-tauri/tauri.e2e.conf.json), extra test capability | **Do not incorporate in this fix.** Inspecting the fallback after the native inspection failure confirms it needs a distinct instrumented binary and automation capability. It is not available in the current production bundle and would not itself establish human AppKit consent. Deliver an explicit isolated fixture using unchanged native permissions; keep native acceptance pending. |
| Existing ORQST services   | [`332aca9`](https://github.com/walissonhms/orqst/tree/332aca9), `terminal_creation.rs::install/run`, `terminal.rs::focused/apply_layout`, `agents.rs::confirm/confirm_exit`, `prepareTauriTerminals`, `TauriTerminalLayout`                                                                                                                                                                                                                                                                                                         | **Reuse directly, narrowly correct preparation.** Capture source/generation before dispatch, recheck initial focus and invalidate on another native ORQST surface. Existing signed reviews, private pipes, one-shot latches and journals remain authoritative.                                                                                                                                 |

The exact Anywh [LICENSE](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/LICENSE)
was rechecked: Apache-2.0, SHA-256
`cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30`.
The tracked tree has no NOTICE/COPYING file and selected sources have no additional
license grant/header. No new upstream fragment or dependency is incorporated;
existing attribution/NOTICE are preserved. The optional automation dependency
closure is not imported or claimed cleared for redistribution.

Tucano communication routing and Overclock visual/source scope are unchanged;
the existing attributed mention parser and preserved historical audits remain in
place. No model text becomes a permission or inferred delivery state.

Security review: no API, WebSocket, cookie, protocol URL, capability or CSP change.
The observer remains read-only. Native preparation is more strictly fenced; native
modal focus is not equated with user delegation authority. The developer fixture
uses fixed synthetic binaries, fresh canonical manifests, an empty source root and
an environment allowlist. Private fixture evidence is retained on uncertain exit;
no retirement, adoption, retry, unknown-reservation cleanup or provider run occurs.

Verification and retained failures are in the
[native coexistence guide](../development/tauri-native-coexistence.md). Rollback is
reverting this commit and rebuilding, with private journals and quarantine preserved.
