# Feature terminal preparation navigation — 2026-11-05

Baseline: `e0711ea` (human-verified milestones), following `7226686` (reviewed
consent delivery freeze). This is source-only navigation work, not a replacement
package or a claim about the running app. The owner reported and Root 676 observed
the disabled button on `orqst-features://local/index.html`; this worker did not
inspect the running app or provider state.

## Cause and existing implementation reused

`mountFeatureWorkspace()` mounts `FeatureWorkspace nativeWorkspace` without
`onPrepare`; the shared component previously disabled **+ Terminal** whenever that
callback was absent. `StudioWorkspace.openPreparation()` supplies the callback in
Studio and owns the existing `TauriStudioPreparation` drawer. No named
`showPreparationDrawer` hook existed at the baseline.

Keep that drawer, CLI/model picker and `studio_request` contract. The optional
`DesktopFeatures.showPreparationDrawer` now carries only the accepted workspace
and Feature IDs, metadata generation and view revision to `feature_prepare`.
That separate command never enters the Core metadata envelope. It authenticates
the actual chrome Webview/parent/URL/document, matches the last accepted scope
and native epoch/presentation, checks existing preparation/enrollment exclusions
and fresh AppKit focus, then shows the authenticated existing `main` window.
The target identity is rechecked after showing/focusing it, before delivering the
view-only event. Reload invalidates the cached navigation scope.

`App` preserves its draft navigation guard, selects Studio, and asks
`StudioWorkspace.openPreparation()` to open its existing dialog. Mounting it may
request the existing passive snapshot/catalog only. **Open** still requires the
existing selected model/catalog binding, native review, signed effects, current
scope and separate input/start grants. Navigation success means the event was
dispatched, not that any preparation, enrollment or CLI operation succeeded.
The chrome receives no `orqstTauriStudio`, execution method, path, executable,
PID, proof, source/document token or arbitrary target/window identifier.

## Section 13 reference revalidation

Sources were fetched read-only into `/private/tmp/orqst-research-766`, outside the
application/worktree. No upstream code, asset or dependency was incorporated.
Existing LICENSE/NOTICE attribution is unchanged.

| Candidate and pinned source                                                                                                                                                                                                                                                                                                                                                                                                   | Exact inspection and dependencies                                                                                      | Decision and contract difference                                                                                                                                                            |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Anywh native entry](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/client/src-tauri/src/lib.rs), [platform detection](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/client/src/lib/platform/tauri.ts), [desktop capabilities](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/client/src-tauri/capabilities/desktop.json) | `run`, single-instance main-window show/focus, `inTauri`, wildcard desktop window permissions; Tauri/plugins and React | Keep ORQST's authenticated native document/focus helpers and narrow dynamic capabilities. Environment detection or wildcard window controls cannot authenticate this chrome → main request. |
| [Anywh architecture](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/docs/architecture.md), [Agent Host](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/docs/agent-host.md), [runtime contract](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/runtimes/README.md)                                                | Relay/session/runtime separation, host replay and turn-scoped authority; Node service/driver contracts                 | Keep ORQST Core/PTY/admission/grants. This defect is a missing view entry point, not a lifecycle/recovery or host problem.                                                                  |
| [Tucano router](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/src/core/router.ts), [gateway](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/src/core/gateway.ts)                                                                                                                                                                                           | `routerSystem`, `routerPrompt`, `parseRoute`, `route`, `Gateway`; engine/connector metadata, Node HTTP and MCP SDK     | Do not import. Speaker selection grants no permission; the turn-secret local MCP gateway is not a native UI navigation contract. Existing signed communication remains unchanged.           |
| [Overclock](https://overclock.sh/en)                                                                                                                                                                                                                                                                                                                                                                                          | Public pane/workspace navigation presentation; no exact licensed application source revision identified                | Visual reference only; copy no source or assets. Preserve ORQST identity and the approved V6 layout.                                                                                        |

Anywh and Tucano root LICENSE were fetched again at those exact pins and declare
Apache-2.0 ([Anywh license](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/LICENSE),
[Tucano license](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/LICENSE)).
The prior pinned audits record no NOTICE in their recursive trees; this change
retains that historical evidence without rewriting it. Since nothing upstream is
incorporated, no new license/dependency closure or notice is introduced.

## Sidebar refusal diagnosis and boundary

`FeatureWorkspace.request()` stores a refusal in `notice`; the validated
`orqst-feature-state` event updates snapshot data but does not clear that notice.
Therefore a later accepted snapshot can coexist with an older refusal. A mutation
can also be legitimately denied by focus, scope or CAS while CLIs keep working.
The user-visible message alone cannot distinguish those cases. This is separate
from the absent preparation callback, so this increment leaves notice handling
unchanged: it neither clears real refusals nor retries metadata writes. A future
fix needs operation-correlated evidence, rather than unconditional clearing on
any snapshot or assumptions based on provider liveness.

## Verification boundaries

Focused synthetic contracts, VM injection and EN/PT headless React fixtures cover
strict IDs, rejection of authority fields, activation, shared in-flight exclusion,
status preservation, exact chrome injection and the existing drawer handoff. The
headless fixture substitutes native IPC and App routing; it does not validate
native command dispatch, WebKit/AppKit, real CLI/model availability or enrollment.
Native pure regression cases are included for target identity and scope/epoch/CAS.
Cargo/native compilation and these Rust tests are intentionally not run under the
owner's current prohibition. No application build, resource staging, packaging,
Core/PTY/provider execution or interaction with the open Preview package occurred.
