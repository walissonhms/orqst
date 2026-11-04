# V6 feature foundation reuse review — 2026-11-04

Scope: persistent Workspace → Feature → TerminalPane → AgentSession, context and
visual layout. Current ORQST remains the primary implementation source.

## Pinned candidates inspected

Anywh pin: [`546f189c04415c3c5af5f40e3931a0a90b9aba31`](https://github.com/anywh-sh/anywh/tree/546f189c04415c3c5af5f40e3931a0a90b9aba31).
Root LICENSE is Apache-2.0; prior component audits record no NOTICE. Architecture,
Agent Host and runtime documentation were consulted alongside selected source.

| Source and symbols                                                                                   | Dependencies / behavior                                                          | Decision                                                                                                                                           |
| ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `client/src/hooks/tabs/useTabs.ts`: `Tab`, `TabGroup`, `TabsState`                                   | React/profile hooks, browser storage; group order separate from live tab pool    | Keep ORQST retained documents and Core SQLite. Upstream browser keys/three-group cap do not implement persisted Features                           |
| `client/src/components/shell/TabGroupLayout.tsx`: `resolveTabDrop`, `groupCssVars`, `TabGroupLayout` | React, dnd-kit, profile/i18n/skeleton helpers; compact mode preserves membership | Keep existing ORQST grid/reorder/paging and isolated native webviews; avoid a second layout manager                                                |
| `relay/src/session/room.ts`: `RoomMembership`, `QueuedMessage`, `RoomReport`                         | Pure types, room principal is a session ID, pending reports persist              | Keep independent domain IDs and queue/grants. A room keyed by its principal is not a Feature; do not import transcript/automatic reminder policies |
| `relay/src/session/sessionStore.ts`: `SessionEntry`, `SessionCwdState`, `ModelChoice`                | Filesystem JSON, room metadata, provider resumption                              | Keep Core Store/journals and adapter-verified models; JSON would duplicate SQLite and change ownership/recovery                                    |

Tucano pin: [`0501956d127699300209902e889f3e69a0948766`](https://github.com/eduwxyz/tucano/tree/0501956d127699300209902e889f3e69a0948766).
Root LICENSE was rechecked as Apache-2.0; the preserved audit records dependencies.
`src/core/db.ts` has `conversations`, `members`, `agents` and transactional schema;
channel membership is a comparison, not a Workspace/Feature schema to copy.
`src/core/router.ts::{routerPrompt,parseRoute,route}` chooses speakers from channel
agents and grants no authority. Keep ORQST signed routes; scope membership before
resolving handles. Reuse the existing attributed mention parser, not model-selected
speakers as an authority source.

The supplied HTML is the owner's approved visual input. Overclock's pane
experience remains a visual reference: no exact licensed source revision for its
code/assets is established. No Overclock runtime dependency is introduced.

## Existing code to retain

- `packages/database/src/terminal-layouts.ts::openTerminalLayouts`: transactional
  Store extension; current key is selection UUIDs, requiring additive Feature scope.
- Core `terminal/layout-database.ts` and private host RPC: one owned writer, private
  permissions and strict metadata. No public execution route is needed.
- Desktop `terminal-layout-store.ts`, `tauri-terminal-layout.ts`,
  `terminal-document.ts`: preferences, retained views and actual PTY output.
  Context/view state must never replace the process registry.
- Existing communication registry, SQLite queue, reviewed grants and attributed
  Anywh fit/sidecar adaptations recorded in root NOTICE.

No additional upstream source, assets, dependencies or notices are added here.
Keep working adaptations; copying an incompatible persistence/runner to demonstrate
reuse would create a parallel runtime. Recheck exact sources and transitive
licenses for each subsequently incorporated component.
