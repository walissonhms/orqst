# Tauri retained terminal workspace — 2026-11-04

Baseline: `ee08ecb`, isolated branch `feat/tauri-workspace-684`. The main checkout's
README, ROADMAP and untracked master-spec tracker were preserved. This increment
ports the existing Electron visual workspace into the existing Tauri managed
terminal bridge. It does not remove Electron or claim complete migration parity.

## Pinned research and reuse decisions

The separate Anywh object store was re-inspected at
[`546f189c04415c3c5af5f40e3931a0a90b9aba31`](https://github.com/anywh-sh/anywh/tree/546f189c04415c3c5af5f40e3931a0a90b9aba31).
Its `docs/architecture.md`, `docs/agent-host.md`, `relay/src/runtimes/README.md`,
root LICENSE and the implementations below were inspected. The root grant is
Apache-2.0; the selected tracked tree has no NOTICE or additional selected-file
license header. No new upstream source or assets are copied in this increment.

| Candidate                   | Exact source and dependencies                                                                                                                                                                                                                                   | Decision and contract/security differences                                                                                                                                                                                                                                                                                               |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Grouped terminal layout     | [TabGroupLayout.tsx](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/client/src/components/shell/TabGroupLayout.tsx): `TabGroupLayout`, `resolveTabDrop`, `groupCssVars`; React, dnd-kit, app-specific group/profile/i18n hooks | **Keep ORQST.** Upstream renders React panels in a shared document. ORQST already has isolated sibling documents, bounded layout actions and pure grid geometry. Replacing that boundary adds a broad dependency closure without solving an unmet need. Compact paging must preserve the underlying group.                               |
| Terminal fit/resize         | [TerminalView.tsx](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/client/src/components/terminal/TerminalView.tsx#L272-L281): `ResizeObserver`, FitAddon, debounce and cleanup                                                 | **Reuse the existing attributed ORQST adaptation.** The shared renderer already incorporates this narrow lifecycle, recorded in NOTICE. It now fits retained Tauri child webviews and uses the existing native/Core/PTY resize transport, with no upstream WebSocket, tmux or WebGL integration.                                         |
| Terminal ownership/recovery | [terminalSession.ts](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/host/terminalSession.ts): `spawnTerminal`, `killTerminal`, `tmuxSessionName`; node-pty, external tmux, child-process                             | **Keep ORQST.** `new-session -A` attachment and durable tmux ownership differ from ORQST's signed, explicitly selected, non-adopting managed sessions. Layout must never create, recover or duplicate a process.                                                                                                                         |
| Tauri sidecar               | [tailnet_sidecar.rs](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/client/src-tauri/src/tailnet_sidecar.rs): retained child and drain; Tauri shell plugin                                                                     | **Reuse the existing attributed adaptation.** Core lifecycle is unchanged; the new native container adds no second session manager, CLI driver or remote service.                                                                                                                                                                        |
| Agent communication         | [Tucano router.ts](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/src/core/router.ts): `route`, `parseRoute`; engine/types/language dependencies, Apache-2.0                                                                   | **Keep existing ORQST routing.** No communication behavior is changed by this layout increment; names remain display metadata and never imply a handle, task destination, role or authorization. The preserved historical audit is unchanged.                                                                                            |
| Pane experience             | [Overclock Panes](https://overclock.sh/features/panes), inspected 2026-11-04                                                                                                                                                                                    | **UX reference only.** Published independent panes, two-column grid and explicit reordering informed the functional target. No exact source repository, SHA or compatible code/asset license was established. No source, identity, asset, status heuristic or cost behavior is copied, and marketing claims are not acceptance evidence. |

## Concrete ORQST reuse and native contract

The implementation reuses `terminal-document.ts`, `managed-terminal-client.ts`,
`terminal-client.ts`, `terminal-layout.ts` (`parseTerminalViewAction`,
`terminalGridPage`, `terminalGridBounds`), `terminal-layout-store.ts`,
`TauriTerminalService`, `TerminalNativeBroker`, managed Core/PTY hosts and existing
signed consent. `TauriTerminalLayout` is a platform layout adapter; it owns only
visual preferences and pixel bounds. No process model or provider code is duplicated.

Rust creates one `terminal-workspace` native window with one retained child webview
per selected slot. The observer remains a separate capability-free webview. Tauri's
installed `2.12.5` source was checked at crate VCS revision
[`993038c49185307dfc895ab7657d77ca0d5ed7c7`](https://github.com/tauri-apps/tauri/tree/993038c49185307dfc895ab7657d77ca0d5ed7c7):
`crates/tauri/src/window/mod.rs::add_child` and
`crates/tauri/src/webview/mod.rs::{set_bounds,show,hide,set_focus,with_webview}`.
Child webviews require its existing `unstable` Cargo feature. Its runtime webview
event enum exposes drag/drop, not a child focus getter. Parent-window focus alone
cannot authorize a sibling's input.

On macOS, a narrow native check queries the owned WKWebView's NSWindow first
responder on Tauri's UI thread, requiring it to be a descendant of that WKWebView.
No renderer-supplied active slot or JavaScript focus boolean grants authority.
The explicit `objc2` dependency is the already locked `0.6.5`, MIT, VCS revision
[`d7d2fa23ceaa5e6096c923b081040e5d81b3b9df`](https://github.com/madsmtm/objc2/tree/d7d2fa23ceaa5e6096c923b081040e5d81b3b9df);
its registry manifest and [upstream licensing statement](https://github.com/madsmtm/objc2/blob/d7d2fa23ceaa5e6096c923b081040e5d81b3b9df/LICENSE.md)
were inspected. No SDK declarations or upstream implementation were copied. Native
redistribution-notice audit remains a packaging gate, as in the existing preview.
Other platforms fail this check closed until their equivalent is implemented.

## Security review

No observer HTTP API, WebSocket, cookie, source ingestion or authority format is
changed. Capability selection uses exact terminal webview labels plus exact
custom-protocol document identity. The frontend has no shell, arbitrary path,
terminal-slot, process or proof capability. Node validates layout operations and
bounds its private protocol. Only trusted JSON-serialized layout metadata is
pushed into native documents; captured terminal content remains plain xterm text.

Changing layout revokes existing input/consent generations. Hiding, compact paging,
parent blur, close and reload retain or tighten revocation. Native close suspends
the visual workspace so delayed resize cannot reopen it; menu restoration preserves
the same documents and process identities. Native consent stays default-cancel,
with fresh document, generation and first-responder validation on approval.

Preferences reuse private, symlink-resistant, UUID-keyed atomic JSON storage
(0700 directory, 0600 file), not a new database or process recovery store. SQLite
layout/team persistence requested by the full master specification remains open.

## Integration with native creation

This branch does not edit `main.rs`, `build.rs` or `terminal_creation.rs`. The
concurrent native creation increment owns those hooks and `start_selected`.
When combining `terminal.rs`, preserve its `start` → `start_selected` delegation,
selection admission and creation-menu entries. Apply the workspace construction
inside the selected-start body, append its submenu to `app.menu()` instead of
replacing the menu, and retain both menu event callbacks. The main observer startup
and explicit selection semantics remain unchanged here. Native creation is not
claimed as part of this branch's acceptance.

See [workflow, checklist and current verification](../development/tauri-terminal-workspace.md).
