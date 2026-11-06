# V6 terminal chrome reuse review — 2026-11-04

## Studio first-snapshot and geometry barrier — 2026-11-05

Source investigation of owner-tested `467c400` and renderer correction `d46e2dd`:
`main.rs` installs `feature-workspace` even when there is no selected terminal
Core. `features::feature_request` returns `unavailable` at `metadata_context(None)`
in that state. The first read is therefore not a readiness signal. During owned
creation, enrollment/metadata contention can also return `busy`, and generation
changes invalidate in-flight reads. `tauri-terminal-host.ts` awaits
`features.initialize()` before sending ready and reading requests; an ordinary
post-ready snapshot is not blocked by `initialized=false`. The renderer previously
started refresh only after a successful snapshot; its owner-supplied retry fixes
that liveness defect. A synthetic test reproduces unavailable-before-initialize,
busy-during-enrollment, and a valid snapshot after presentation completes.

The old native path independently let `context()`/`open()` clear arrangement and
publish default 155/81 grid rectangles. Rust accepted those before any snapshot,
so the PTY covered the waiting Studio. The native Studio producer now withholds
all PTY rectangles/focus until an arrange v2 for its current context. Generation
changes publish hidden geometry immediately; Rust additionally suppresses legacy
Studio bounds and hides retained panes at native view-generation transitions.
Processes, membership, saved shown preferences, admission and input fences stay
owned by the existing services. The whole frame is still validated before use.

This is a source-backed mechanism and synthetic regression, not a reconstruction
of the exact old invocation: the retained diagnostics lack snapshot status traces,
and app_observe/app_diag are unavailable in this tool session. No app/provider was
opened for this investigation. Native owner acceptance remains required.

Re-inspected pinned Anywh `TerminalPanel.tsx` (`TerminalPanel`, conditional mount
and retained tabs), `TabGroupLayout.tsx`, architecture/Agent Host/runtime docs and
LICENSE at `546f189c04415c3c5af5f40e3931a0a90b9aba31` (permanent links below).
It uses React panel mounting, relay/WS detach and tmux retention, not retained
Tauri sibling NSViews or ORQST's native presentation generations. Dependencies
include React, relayClient, SessionPanel and PaneTabStrip. Apache-2.0, no root
NOTICE; no code/assets/dependencies incorporated. Decision: keep and narrowly fix
ORQST's existing generation-fenced layout; copying the panel would not enforce
native hiding. Tucano communication and Overclock visual references introduce no
applicable native geometry implementation or new reuse in this fix.

## Versioned Studio geometry — 2026-11-05

Re-inspected Anywh [TerminalPanel](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/client/src/components/terminal/TerminalPanel.tsx)
and its existing ResizeObserver/FitAddon adaptation below. Its React terminal panels
and relay-close semantics do not implement ORQST's retained sibling native Webview
ownership. Keep ORQST's native layout, focus and lifecycle code; extend its
generation-validated geometry with bounded renderer layout and AppKit sibling
ordering. No new upstream code or dependencies are copied. The pinned Apache-2.0
license and NOTICE findings remain as documented below.

## Incremental minimization correction — 2026-11-05

Native inspection of package `a414585` reproduced a hidden newly enrolled pane
missing from the dock. `enroll_selected_inner` appended the document but omitted
the corresponding native label/provider entries used by `emit_dock`. Enrollment
now validates bounded display metadata and appends all three collections together;
the private Node producer includes the provider label for both initial and appended
panes. Existing document/receipt/owner/generation gates remain authoritative.

The pane menu also reused the header's `hide-pane` element ID, while the client
bound only the first element. The menu has its own unique ID and invokes the same
existing layout-only hide action. Hide remains independent of Stop and termination.

Re-inspected pinned Anywh `TerminalPanel`/`handleCloseTerminal` at
`546f189c04415c3c5af5f40e3931a0a90b9aba31` using the source linked below: sibling
views remain mounted, but close invokes the Relay terminal API. Keep ORQST's
retained native Webviews and existing Core layout implementation; no upstream code,
assets or dependencies copied. License/NOTICE and communication decisions below
remain unchanged. This fix neither enables MCP nor implements mention routing in
ordinary independent terminal panels. Native corrected-package acceptance remains
separate from synthetic source tests.

Baseline: ORQST `9d7abfc3aa2f7ff52656b482df586c55dfbdca4f`.
The owner-approved five Markdown files, HTML and intake paste were read along
with current repository rules, README, ROADMAP, design system and V6 checklist.
The HTML is an interaction/density reference; its data is not a runtime source.

## Keep and reuse existing ORQST

`apps/desktop/src/terminal-document.ts` `terminalDocument`,
`managed-terminal-client.ts` (xterm/FitAddon, `send`, `revoke`, `changeLayout`),
`terminal-layout.ts` `parseTerminalViewAction`/`terminalGridBounds`,
`terminal-panels.ts` `TerminalPanels`, `terminal-runtime.ts`,
`terminal-native-broker.ts` and `tauri-terminal-host.ts` already own the required
renderer, isolation, grants and retained-document semantics. Reorganize their
trusted chrome; do not recreate sessions or grant authority through a menu.
Existing private SQLite layout ownership remains unchanged.

No new dependency is required. The repository declares Node >=24 <25,
pnpm 10.34.9, TypeScript ~6.0.3, React ^19.3.1 and existing xterm/FitAddon/node-pty.
The protocol/shared/database/Core dependency direction and isolated native
transport remain unchanged; no observer API or process manager is introduced.

## Anywh

Pinned commit: `546f189c04415c3c5af5f40e3931a0a90b9aba31`, inspected in the
separate owner-specified object store `/private/tmp/orqst-audit-anywh-665`.

- [TerminalView.tsx](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/client/src/components/terminal/TerminalView.tsx)
  `TerminalView`: one xterm/socket lifecycle per mount, FitAddon, container
  ResizeObserver, cleanup and debounced relay resize. Dependencies include React,
  xterm/WebGL/WebLinks, profile/connection resolution and tmux-backed WebSocket
  transport. **Decision: retain ORQST's existing attributed ResizeObserver/FitAddon
  adaptation and bounded signed native resize; do not copy the broad component.**
  Link/clipboard behavior and reconnect would cross ORQST's stricter native grants.
- [TerminalPanel.tsx](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/client/src/components/terminal/TerminalPanel.tsx)
  `TerminalPanel`/`handleCloseTerminal`: keeps sibling terminal tabs mounted but
  conditionally unmounts a session panel and uses `closeTerminal` through relay
  connection/profile APIs. Depends on React, PaneTabStrip, SessionPanel and tmux
  reconnect behavior. **Decision: keep ORQST retained native sibling documents.**
  Menu/layout operations cannot depend on upstream tmux reattachment or teardown.
- [architecture.md](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/docs/architecture.md),
  [agent-host.md](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/docs/agent-host.md),
  [runtimes/README.md](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/runtimes/README.md)
  were re-inspected. **Decision: no replacement host/runtime.** Lifecycle evidence
  stays in the existing Core and broker; UI mounting is not process identity.

The exact root [LICENSE](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/LICENSE)
was inspected: Apache-2.0. No tracked NOTICE exists at this revision. The selected
terminal files have implementation comments, no separate license grant. Existing
ORQST root NOTICE/source attribution for the ResizeObserver adaptation is retained;
no additional upstream source or assets are incorporated by this increment.

## Tucano

Pinned commit: `0501956d127699300209902e889f3e69a0948766`, inspected in
`/private/tmp/orqst-audit-tucano-665`.

[router.ts](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/src/core/router.ts)
`route`, `parseRoute`, `routerPrompt` and `describeAgent` select at most two channel
speakers through an Engine model turn. They depend on shared language/types and
engine Usage; choosing speakers grants no tool authority. **Decision: do not use
for chrome/layout or Feature selection.** A pane menu has no basis to invoke model
routing, infer delegation or replace existing signed communication/grants. Existing
ORQST attributed mentions implementation is preserved without modification.

The exact [LICENSE](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/LICENSE)
is Apache-2.0, with no tracked NOTICE at the pinned revision. `router.ts` has no
separate license header. No new Tucano code or dependencies are copied.

## Overclock / approved reference

Overclock remains the owner-specified UX reference for compact panes, navigation
and visual communication. No exact source repository/license was supplied or
established for reusable implementation; **decision: do not copy code/assets**.
The supplied V6 HTML, rather than guessed product behavior, determines density.
Its four simulated agents, localStorage persistence, fake model fields and flow
animations remain outside application runtime. No Overclock API dependency is
introduced into ORQST.

## Studio host visibility and chrome follow-up — 2026-11-05

Re-inspected the existing ORQST `TauriFeatureService.present`, `TauriTerminalLayout`,
`features::publish`, `terminal::apply_layout_current` and `terminalDocument`.
A Feature metadata reply did not independently hide old native surfaces: hiding
only happened when the next full layout envelope passed viewport/revision checks.
A refused geometry frame could therefore retain a previous Feature's presentation.
The fix adds a hide-only membership barrier from the already validated private
snapshot, preserves global documents/processes and rejects later same-generation
frames containing a different member set. Native generation changes clear only
that presentation constraint; existing epoch/revocation/input fences still apply.

The same pinned Anywh `TerminalPanel` / `useTerminalTabs` source reviewed above
keeps React views and tab/process metadata separate, but supplies no retained
native child-Webview membership boundary. Its Apache-2.0 source/NOTICE findings
are unchanged; no implementation/dependency is copied. ORQST's original native
hide/revoke and existing trusted HTML generator are reused. Actual AppKit behavior
and the exact refusal that occurred in the owner's screenshot remain native
acceptance; the rejected-frame case is covered synthetically.

The Tauri Studio host marks initial and enrolled terminal documents with
`main[data-chrome="studio"]`, activating the frontend owner's existing CSS.
The process authorization section remains outside the hidden pane header. Legacy
and Electron documents do not opt in. No process is stopped or replaced.
