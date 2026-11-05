# Studio workspace reuse decision — 2026-11-05

The owner supplied three fresh visual references: an orchestration canvas, compact
multi-pane development workspace and task/agent inspector. They reinforce tabs,
retained panes, direct controls and visible delegation. They are visual references,
not sources of simulated runtime data or code reuse grants. Preserve ORQST branding.
All five preserved V6 specifications and their HTML were inspected against the
existing React 19, TypeScript 6, Node 24/pnpm 10, xterm and Tauri 2 implementation.

## Inspected sources and decisions

Anywh is pinned to `546f189c04415c3c5af5f40e3931a0a90b9aba31`:

- [useTerminalTabs.ts](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/client/src/hooks/tabs/useTerminalTabs.ts),
  `loadPersisted`/`useTerminalTabs`, separates tab metadata and active selection.
  Its React/localStorage state is not the authority for processes.
- [TerminalPanel.tsx](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/client/src/components/terminal/TerminalPanel.tsx),
  `TerminalPanel`/`handleCloseTerminal`, retains sibling tabs but also uses Relay
  close/reattach, profile resolution, SessionPanel, PaneTabStrip and tmux contracts.
- [architecture.md](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/docs/architecture.md),
  [agent-host.md](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/docs/agent-host.md)
  and [runtimes/README.md](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/runtimes/README.md)
  distinguish host, transport, drivers and per-turn resources.

Decision: keep ORQST `TauriTerminalLayout`, `TauriFeatureService`, Core SQLite
layout store, native Webviews and existing signed resize/input/lifecycle. Its
retained-document and exact native grant contracts cannot be replaced by React
mounting or a tmux reconnect. Expose the existing view actions in a narrow React
tab bar; no upstream code/dependencies copied. Anywh root LICENSE was fetched at
this exact revision and re-read: Apache-2.0. The previous component audit established
no tracked NOTICE; selected files carry no separate grant. Existing ORQST NOTICE
and its prior ResizeObserver adaptation are unchanged.

Tucano is pinned to `0501956d127699300209902e889f3e69a0948766`:
[router.ts](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/src/core/router.ts)
`route`/`parseRoute`/`describeAgent` selects up to two speakers through its Engine,
language, agent and usage contracts. Root LICENSE was fetched/re-read: Apache-2.0;
prior audit found no tracked NOTICE. Decision: keep ORQST's existing permissioned
communication services. Speaker selection cannot authorize new destinations or
prove delivery to an interactive CLI. No router, source, assets or dependencies copied.

Overclock remains UX-only. No exact public source revision or compatible source
license was established. Decision: do not copy its implementation/assets. The new
tab interactions operate solely through ORQST's native metadata channel.

## Concrete defects corrected

The previous dock was an implicit grid row outside the three reserved rows; the
permissions section also participated in that grid. Dock state was derived from
`visible`, incorrectly classifying maximized siblings, off-page terminals and
other Features as minimized. Native labels also ignored saved display names.
Finally, `organize` opened a hidden active pane before applying a layout action.
The corrected projection uses the validated `order`, `shown`, `visible` and `names`
state, and workspace actions never need to reopen a hidden source as a prerequisite.

See [behavior and acceptance limits](../development/studio-terminal-workspace.md).
