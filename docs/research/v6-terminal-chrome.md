# V6 terminal chrome reuse review — 2026-11-04

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
