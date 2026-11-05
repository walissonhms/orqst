# Tauri Studio preparation reuse review — 2026-11-04

## Multi-webview preparation lookup correction — 2026-11-05

Reproduced the empty model selector in Preview `4ce9dbe` with retained Feature
chrome present. Preparation returned `denied` before helper startup: it used
`Manager::get_webview_window("main")`, which only returns windows whose webviews
all have the window's label. Adding `feature-workspace` makes that lookup return
`None`. The fixed path resolves the owned `main` Webview and separately uses its
owning Window for native dialogs, visibility and focus. Exact document/origin,
generation, admission, expiry and signed launch checks remain in place.

Dependency source inspected: Tauri **2.12.5**, locked by `Cargo.lock`, at package
VCS commit `993038c49185307dfc895ab7657d77ca0d5ed7c7`:
[`Manager::get_webview_window`](https://github.com/tauri-apps/tauri/blob/993038c49185307dfc895ab7657d77ca0d5ed7c7/crates/tauri/src/lib.rs#L603-L613)
and [`Window::is_webview_window`](https://github.com/tauri-apps/tauri/blob/993038c49185307dfc895ab7657d77ca0d5ed7c7/crates/tauri/src/window/mod.rs#L1257-L1259). Tauri's package
declares `Apache-2.0 OR MIT`. This changes ORQST API use; no dependency source is
copied and no dependency is added.

Re-inspected Anywh at `546f189c04415c3c5af5f40e3931a0a90b9aba31`: architecture,
Agent Host, runtime contract, root Apache-2.0 LICENSE and
[`client/src-tauri/src/lib.rs`](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/client/src-tauri/src/lib.rs#L183).
Its main-window lookup also assumes `WebviewWindow`; it does not supply ORQST's
retained sibling-Webview preparation boundary. Decision: keep the existing ORQST
preparation, Core and PTY implementation and adapt only the native handle type.
No upstream code or assets incorporated. Communication and provider drivers are
unchanged, so the historical Tucano audit remains applicable and untouched.

The native reproduction establishes the preparation refusal, not a provider
startup failure. Actual corrected-package verification is separate from the
existing synthetic protocol/identity tests and does not imply CLI/provider or
full application acceptance.

Baseline: `ad191d386f2293361a2bb44603f4b1691251b494`. This closes the
Electron-only preparation composition in Studio without replacing the native wizard,
Core, runtime, adapter, signed broker or retained terminal view. Shell/layout work
is coordinated separately; this component can mount inside its preparation drawer.

## Pinned upstream inspection

The owner-supplied Git object store `/private/tmp/orqst-audit-anywh-665` was read at
`546f189c04415c3c5af5f40e3931a0a90b9aba31`, including architecture, Agent Host and
runtime contract documentation, plus the actual implementations below.

| Candidate / permanent source                                                                                                                                                                                                                                             | Exact symbols and dependencies                                                                                                                                                     | Decision and contract/security differences                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Anywh native setup](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/client/src-tauri/src/relay_setup.rs)                                                                                                                                | `RelaySetup`, `relay_setup_probe`, `relay_setup_start`, `relay_setup_status`, `relay_setup_cancel`, `write_script`; Tauri, Tokio, serde, embedded Bash/Homebrew/systemd installers | Keep ORQST `terminal_creation::{run,State::begin,State::commit}`, `prepareTauriTerminals` and `prepareTerminalCreation`. Upstream starts an installer, persists/adopts its PID and permits it to outlive the app. That does not match passive, fixed-helper preparation, separate admission/start grants, or preserved uncertain outcomes. No installer, PID recovery or polling is imported. |
| [Anywh platform check](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/client/src/lib/platform/tauri.ts) and [native setup](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/client/src-tauri/src/lib.rs) | `inTauri`, `run`/builder command registration; `@tauri-apps/api`, Tauri plugins                                                                                                    | Keep a typed, narrow injected ORQST facade. Presence of `__TAURI_INTERNALS__` or a Desktop user agent is not authorization or evidence of the Electron mixed preset. Actual native Webview/parent/origin/document/focus checks remain mandatory.                                                                                                                                              |
| [Anywh native capabilities](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/client/src-tauri/capabilities/desktop.json)                                                                                                                  | Desktop window permissions, updater/process/deep-link plugins                                                                                                                      | Keep ORQST dynamically scoped capability for exact loopback origin, root/Studio URLs and actual `main` Webview. Do not import wildcard window permissions or shell/dialog/filesystem access into the observer renderer.                                                                                                                                                                       |
| [Anywh driver composition](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/runtimes/createSessionDriver.ts)                                                                                                                    | `createSessionDriver`, `ClaudeSessionDriver`, `CodexSessionDriver`, `HostSessionDriver`; runtime/session contracts                                                                 | Keep existing ORQST Core/PTY/provider integrations. Driver creation is execution, while this increment is preparation only. No session manager, host, transport or driver is copied.                                                                                                                                                                                                          |

The exact [LICENSE](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/LICENSE)
is Apache-2.0. The recursive tree has no NOTICE file; inspected source headers add
no component-specific notice requirement. `client/package.json` confirms its
Tauri/React dependencies. No new upstream code, assets or dependencies are copied;
existing ORQST NOTICE/Anywh attribution remains intact. Resource staging checks the
actual bundled dependency license closure (17 notices). Tucano communication is not
touched; no routing, mention, MCP task or permission implementation is changed.
Overclock remains a visual reference with no newly identified licensed source to copy.

## Concrete existing code reuse

- `apps/tauri/src-tauri/src/terminal_creation.rs`: one shared `begin`/`execute`/`run`
  path for menu and Studio; same commit-before-write and open-before-admission
  latches, generation, expiry, fixed Node helper and bounded correlated pipe.
- `apps/desktop/src/tauri-terminal-preparation{,-host}.ts`: unchanged strict
  Codex/Claude 1–8 provisioning, native path pickers, configuration/shared-effect
  acknowledgment and separate complete-manifest opening review. ORQST MCP remains off.
- `apps/desktop/src/terminal-creation.ts::prepareTerminalCreation` and
  `TerminalSelection`: unchanged hashes, empty-project, containment, file ownership,
  complete page review and post-review drift checks. No selected path comes from JS.
- `features::focused`: existing actual AppKit Webview first-responder check, shared
  without changing its behavior. Source and generation are rechecked after the await.
- `terminal_focus::{install,sample,Focus::owns_key}` through the existing native
  observer/`quit_window_focus`: main's exact own-sheet exception, deactivation and
  another-key-window revocation. Returning cannot revive a revoked preparation.
- `terminal::{is_running,presentation_blocked,start_selected,fence_selection}`:
  unchanged selected-host/MCP/retirement/Quit boundaries and one-attempt opening.
  Studio never exposes those Core methods directly.
- Existing Studio classes and i18next EN/PT; Electron `DesktopStudio` remains
  action-only and retains its independently supported mixed preset.

Security contract: [narrow native command](../api/tauri-studio.md). Executable test
results and native acceptance limits are recorded in the development guide; renderer
facade evidence does not establish real WebKit, providers, input or final Quit.
