# V6 Feature UI reuse review — 2026-11-04

Baseline: `d79745f8b6273759994bb66211d429355bd65218`. The supplied paste and all
five original Markdown documents plus HTML in `docs/design/v6/source` were read.
The HTML is the owner-approved layout; its sample projects, agents, models and
process state are not production data. Historical local plan/audit documents were
read from the primary workspace where they are preserved outside the tracked tree.

The isolated branch subsequently merged the published native base
`241cb03e170507a37dbb949cdc5c4df094e6a33d`. Before the Feature hooks,
`terminal.rs` matched frozen blob `aa2b23dca1af2caff3f04617af16c66fa7dee860`
and SHA-256 `221b02c3fd843804ec203706e15ab451287544f6449c02764ac92e128691a519`.
The hooks preserve `presentation_blocked`, owned-sheet focus and both Quit gates.
No changes were made to the integrated `terminal_focus.rs`, `agents.rs`,
`desktop.rs` or `native-broker.ts`.

## Pinned source inspection

| Candidate and permanent source                                                                                                                                                                                                                              | Exact symbols / dependencies                                                                                                                            | Decision and contract differences                                                                                                                                                                                     |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Anywh tabs](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/client/src/hooks/tabs/useTabs.ts)                                                                                                                              | `Tab`, `TabGroup`, `TabsState`, `normalize`, `MAX_GROUPS`; React, profile hooks, browser storage                                                        | Keep ORQST's retained native documents and SQLite. Upstream's independent pool/order is relevant, but its browser keys and three-group cap are incompatible with the existing private Feature/slot contract.          |
| [Anywh group layout](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/client/src/components/shell/TabGroupLayout.tsx)                                                                                                        | `resolveTabDrop`, `groupCssVars`, `TabGroupLayout`; React, dnd-kit, profile, i18n, skeleton helpers                                                     | Keep `TauriTerminalLayout`, `terminalGridPage`/`terminalGridBounds` and real native PTY resize. A second React layout owner would conflict with the retained child webviews.                                          |
| [Anywh session storage](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/session/sessionStore.ts)                                                                                                                  | `SessionEntry`, `SessionCwdState`, `ModelChoice`; filesystem JSON, provider continuation                                                                | Do not import. ORQST already owns stable UUIDs, private SQLite, journals and explicit authority; JSON/session restoration would duplicate them.                                                                       |
| [Anywh Agent Host](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/docs/agent-host.md) and [runtime contract](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/runtimes/README.md) | Long-lived host, replay/incarnation, driver boundaries; documents checked against the source candidates above and existing attributed ORQST adaptations | Keep the existing `connectManagedTerminalCore`, private IPC, `ManagedTerminalPair`, `TerminalNativeBroker` and xterm fit/sidecar adaptations. This increment adds no host/runtime/session manager or provider driver. |
| [Tucano schema](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/src/core/db.ts)                                                                                                                                             | `MIGRATIONS`, `conversations`, `members`, globally unique agent `handle`; `node:sqlite`                                                                 | Keep ORQST `Store.features()` and Feature-local assignments/handles. A channel/agent schema with a globally unique handle is not a persisted Feature model.                                                           |
| [Tucano routing](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/src/core/router.ts)                                                                                                                                        | `routerPrompt`, `parseRoute`, `route`; engine stream, connector metadata, model-selected speakers                                                       | Do not import routing/adoption. Speaker choice is not permission. Existing attributed mention parsing and signed Core routes remain unchanged; cross-Feature traffic stays denied.                                    |

Both exact Git object stores supplied by the owner were inspected. Root LICENSE
at both pins is Apache-2.0; `git ls-tree -r` found no NOTICE file. No additional
upstream source, dependency or asset is incorporated, so existing root NOTICE and
attribution for Anywh sidecar/fit and Tucano mention adaptations remain intact.
No new third-party dependency is added. The existing build reviews the actual
bundled React/i18next/xterm/license closure. Overclock remains a visual reference;
no exact licensed source revision is available for copying code/assets.

## Existing implementations reused concretely

- Store Feature CRUD, assignments, complete membership validation and per-Feature
  layout namespace; the same `withTerminalPreferences` SQLite writer and guards.
- `connectManagedTerminalCore` and inherited RPC, adding only typed metadata calls.
- `TauriTerminalLayout`, shared native geometry/paging, input revocation and actual
  retained `terminalDocument`/xterm/scrollback; no JSX terminal simulation.
- Tauri files/Studio pattern: private Node pipe, exact owned native document,
  narrow capabilities, source/activation/document fencing and bounded requests.
- Tauri `terminal::focused`, `revoke_all`, `presentation_blocked` and existing
  native geometry: adapt only the metadata correlation/presentation boundary.
  Capability resolution was checked in the installed Tauri 2.12.5/Wry 0.57.1
  sources: the registered local custom scheme uses a local, single-label
  capability; dashboard frame URLs have exact remote URL patterns. Actual
  Webview URL/parent/document checks remain mandatory in the command.
- Existing signed native consent/lifecycle/retirement and Feature-local grants.
  Metadata never enrolls/adopts a session or reapplies a persisted permission.
