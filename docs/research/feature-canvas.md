# Feature canvas reference research — 2026-11-05

Probable cause: native Feature chrome was explicitly stacked behind all siblings.
The opaque retained dashboard therefore covered the tabs, dock and canvas.
The source now raises chrome above the dashboard and visible terminals above chrome; native validation remains pending.

The supplied reference resembles Anywh's Sala workspace. Image resemblance does not
prove its origin or establish a license. Source was independently inspected at
Anywh commit `546f189c04415c3c5af5f40e3931a0a90b9aba31`, including the architecture,
Agent Host and runtime documentation from the earlier
[workspace research](studio-terminal-workspace.md).

| Source                                                                                                                                                                           | Contract and dependencies                                                                                                      | Decision                                                                                                                                                                                                |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [SalaCanvas.tsx](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/client/src/components/sala/SalaCanvas.tsx), `SalaCanvas`, `Drag`, `linkTone`    | React, RoomAgent/RoomCanvas, camera controller, SalaCard/Toolbar/Confirm, relay worktree deletion/restore, mutable room layout | Keep ORQST ownership/lifecycle. Implement the owner's summary presentation with existing React/lucide and native view actions. No Relay execution/deletion contracts, assets or source copied.          |
| [useRoomCanvas.ts](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/client/src/hooks/sala/useRoomCanvas.ts), `useRoomCanvas`, `flush`, `schedule` | Profile/room REST, saved camera/areas, retries and agent-position pruning                                                      | Do not use. Current ORQST Feature layout uses private Core SQLite and native presentation generations. Canvas camera is ephemeral, avoiding another persistence authority or retry of uncertain writes. |
| [LICENSE](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/LICENSE) and pinned Git tree                                                           | Apache-2.0; inspected files have no separate license header; no tracked NOTICE found                                           | License compatible, but no new upstream code/assets/dependencies incorporated. Existing attribution remains unchanged.                                                                                  |
| [Tucano router.ts](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/src/core/router.ts)                                                           | Previously inspected Engine/speaker routing, Apache-2.0                                                                        | Keep existing permissioned communication. Routing text cannot prove terminal delivery or grant execution. No reuse in this visual increment.                                                            |

The detached research checkout is separate from the app. ORQST React 19.3,
TypeScript 6.0, Node 24/pnpm 10, Tauri 2.12.5/runtime-wry 2.12.3 and Wry 0.57.1
were checked in the current workspace and Cargo lock/registry sources.

## Native presentation prerequisite

For the 2026-11-05 lifecycle projection, also inspected Anywh
[`hostSessionDriver.ts`](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/runtimes/hostSessionDriver.ts),
`HostSessionDriver`, its explicit host agent/session binding and CLI end-of-turn
events. That session/relay contract is distinct from ORQST's owned native PTY and
durable lifecycle receipts. Keep the existing ORQST receipt/broker design; do not
copy the driver or infer a session binding. License/NOTICE evidence is above.

`features::install_workspace` explicitly sent the Feature chrome NSView behind
every sibling. The retained opaque main dashboard then covered its DOM. Renderer
captures and AX existence did not prove visible native chrome. Source now keeps the
new view hidden until an accepted layout, raises chrome above main, then raises only
the visible terminal children above chrome. `terminal::raise_surface` changes sibling
ordering only, preserving final focus/document/generation checks and input revocation.

Pinned primary implementation references: Tauri
[`WebviewBuilder`/`set_bounds`](https://github.com/tauri-apps/tauri/blob/993038c49185307dfc895ab7657d77ca0d5ed7c7/crates/tauri/src/webview/mod.rs),
and Wry [`InnerWebView::set_bounds`/`window_position`](https://github.com/tauri-apps/wry/blob/2446feadae623d6f2ac8d2136e3ccef3d7197e0e/src/wkwebview/mod.rs).
The exact installed source was read: child bounds are parent-view coordinates;
main-view inner size changes to parent-window inner size after the first child.
Chrome bounds are therefore set from the same current parent viewport, without
hardcoded titlebar compensation. Native NSView ordering follows the existing
ORQST AppKit integration and introduces no dependency. Native visual acceptance
remains separate from this source diagnosis.
