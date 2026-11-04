# Tauri native acceptance isolation review — 2026-11-04

Baseline: ORQST `9346271` on main. The change is limited to the opt-in developer
coexistence runner; Electron, the native application and its authority are unchanged.
The checked-in toolchain remains Node 24, pnpm 10, TypeScript 6 and Tauri 2 with the
existing React/Node Core/SQLite boundary. No dependency or native build is added.

## Source-backed decisions

- **Reuse existing ORQST fixture.**
  [`accept-tauri-coexistence.ts` at `9346271`](https://github.com/walissonhms/orqst/blob/9346271/scripts/accept-tauri-coexistence.ts)
  already provides fixed synthetic C executables, empty observer sources, private
  manifests, an environment allowlist and bounded lifetime. Keep these controls.
  A second launch of the same identity can exit successfully through single-instance
  forwarding without starting the new fixture's Core. Add a process-metadata
  preflight for the same executable or bundle identity, before allocation and again
  immediately before spawn. Never focus, terminate or adopt a resident application.
- **Keep the existing native lifecycle adaptation.** Anywh
  [`client/src-tauri/src/lib.rs` at `546f189c04415c3c5af5f40e3931a0a90b9aba31`](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/client/src-tauri/src/lib.rs),
  `run_with` and its `tauri_plugin_single_instance::init` callback show/focus the
  retained main window. This is appropriate for normal use, but a developer fixture
  must not silently reuse another application's run. ORQST's existing
  `main.rs`/`desktop::focus` contract remains intact; no upstream code is copied.
- **Do not add an automation capability to fix an inspection error.** The same
  Anywh `lib.rs` enables `tauri_plugin_wdio`/`tauri_plugin_wdio_webdriver` only under
  `feature = "e2e"`; its
  [`Cargo.toml`](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/client/src-tauri/Cargo.toml)
  and [dedicated config](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/client/src-tauri/tauri.e2e.conf.json)
  require a separate binary and `wdio:default` capability. They cannot diagnose the
  current production bundle's `cgWindowNotFound` by themselves, and are not proof of
  native consent. With limited space, retain the isolated fixture and report the
  inspection boundary instead of rebuilding Rust or weakening permissions.

The separate pinned Anywh checkout's architecture, Agent Host and runtime README
were consulted, alongside the actual native code above. Its
[LICENSE](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/LICENSE)
is Apache-2.0, SHA-256
`cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30`;
no NOTICE/COPYING file is tracked. No fragment, asset, plugin or dependency is
incorporated in this change. Existing ORQST attribution is preserved. Tucano routing
and Overclock visual scope are unchanged; no communication mechanism is added.

## Security and limits

The preflight invokes fixed macOS `ps`/`plutil` executables without a shell. It reads
process command paths and bundle identifiers only, does not read process environments
or user journals, and fails closed on unreadable candidate metadata. An unrelated
identity remains running and is never changed. Checks are best effort: an external
launch after the final preflight can still race; zero process exit is never native
acceptance. The runner records the canonical artifact path and executable hashes,
not an invented source revision for an existing bundle. The operator must verify
that a bundle includes the intended source revision before accepting that revision.

No API, WebSocket, cookie, renderer capability, observer source-access or native
consent change is made. Native binary hashes identify the tested artifact but do
not attest its build provenance. Private run logs, PIDs and failed-attempt evidence
belong outside Git; the runner retains its fixture metadata and exit result.
See [the workflow](../development/tauri-native-coexistence.md).

## WindowServer probe recheck — 2026-11-04

Revalidated the same pinned Anywh revision,
[`546f189c04415c3c5af5f40e3931a0a90b9aba31`](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31):
`client/src-tauri/src/lib.rs` (236 lines) still only shows and focuses the retained
window in its `tauri_plugin_single_instance` callback (lines 88–93) and never changes
the macOS activation policy; `LICENSE` is still Apache-2.0. **Decision: keep the
existing ORQST lifecycle adaptation, copy nothing.** Anywh offers no WindowServer
diagnostic, so the probe is original ORQST code over Apple's
`CGWindowListCopyWindowInfo`; no third-party license or NOTICE obligation is added.

The probe reads only window metadata for one explicitly owned PID. It is not an
automation capability, does not capture pixels or titles, and cannot replace human
consent. Tucano and Overclock remain out of scope for this increment because it adds
no communication or visual behaviour.

## Own-sheet focus investigation — 2026-11-04

Rechecked Anywh at the same pinned commit, including `docs/architecture.md`,
`docs/agent-host.md`, `relay/src/runtimes/README.md` and the actual
[`lib.rs::run_with`](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/client/src-tauri/src/lib.rs)
(single-instance navigation) and
[`SessionDeleteMenu.tsx::confirmDelete`](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/client/src/components/shell/SessionDeleteMenu.tsx)
(native dialog through `@tauri-apps/plugin-dialog`). **Keep ORQST's existing
signed broker and exact native document guards.** Anywh's delete confirmation has
no signed execution challenge, child-WKWebView binding or equivalent post-sheet
authority generation. Copying its renderer confirmation would remove required
ORQST guarantees. Its Apache-2.0 LICENSE hash above and absence of tracked
NOTICE/COPYING were revalidated; no new third-party code or dependency is copied.

The installed lockfile/source was also checked: Tauri 2.12.5 menu `Submenu::with_id`
and `Submenu::append`, Muda 0.20.0's macOS menu composition, Tao 0.37.2's
`window_delegate.rs::window_did_resign_key`, dialog 2.8.4's
`desktop.rs::show_message_dialog`, and rfd 0.17.2's macOS `Alert`, `ModalFuture`
and `FocusManager::drop`. These are existing dependencies, not newly incorporated
fragments. Tao emits `Focused(false)` on `windowDidResignKey:`; rfd attaches an
NSAlert sheet to the supplied parent. ORQST previously treated that event as a
complete review revocation, before the result could be accepted.

An isolated native run recorded an explicit `Custom("Authorize once")`, the
parent losing key status to its own attached sheet while NSApp remained active,
and generation 3 becoming 4. Focus and the exact WKWebView first responder were
already true at 0/100/250/500/1000 ms after completion. This demonstrates a
self-sheet revocation defect in that artifact, rather than a delayed focus sample.
It does not reconstruct the cause of the older uninstrumented acceptance attempt.
No delayed focus recheck is introduced.

The native correction identifies the exact parent → attachedSheet → sheetParent
and keyWindow relationship while NSApp is active and the original review generation
is current. Keyboard leases are suspended without extending any deadline or
issuing authority. Native NotificationCenter observers invalidate generation on
application deactivation and another key window, including while the parent is
already unfocused behind its sheet. Returning cannot revive that generation.
The existing exact WKWebView responder, source URL, native selection, signed nonce,
operation, expiration, MCP/retirement exclusion and consumed-proof checks remain.
Observers are installed on the UI thread once per native app process, with one
process-lifetime observer; unavailable installation/metadata fails closed.

The Managed agents top-level action is wrapped in a native submenu, preserving its
existing action/window ID and handler. The app/Quit, Terminal, preparation and tray
menus remain composed through the existing `app.menu()` rather than replacement.
This changes native navigation only; it starts no provider or delegation.

Security review: no observer API/WS, cookie, CSP, renderer capability, credentials,
quarantine or process-adoption change. The private native pipe adds only a
lease-suspension notification. Developer focus diagnostics are opt-in, bounded
metadata on private runner stderr; they never focus a view or decide consent.
See the [native workflow and evidence boundaries](../development/tauri-native-coexistence.md).

### Native Cmd-Q bypass

The correlated preparation fixture also exited with code 0 on Cmd-Q without either
host confirmation. This is a failed quit check. The installed Tauri 2.12.5
`menu/menu.rs::Menu::default` creates its macOS application submenu with a final
predefined Quit. Muda 0.20.0 `platform_impl/macos/mod.rs` maps that item directly to
`terminate:`; Tao 0.37.2 `application_will_terminate` calls `AppState::exit`.
The Wry 2.12.3 `RequestExit` path, in contrast, emits the preventable
`RunEvent::ExitRequested` used by ORQST's existing two-host confirmations.

Keep the default menu and replace only that freshly constructed Quit item with
`native-app-quit`/Cmd-Q, calling the existing `app.exit(0)` path. The default menu
shape is checked before replacement and an unexpected shape refuses startup.
The tray, close/background flow and existing confirmation policy are unchanged.
This does not establish Dock Quit, logout, shutdown, force quit or crash acceptance.

### Parent-bound exit dialog source

The registry packages' `.cargo_vcs_info.json` pins provide permanent references:
[Tauri Menu::default](https://github.com/tauri-apps/tauri/blob/993038c49185307dfc895ab7657d77ca0d5ed7c7/crates/tauri/src/menu/menu.rs),
[dialog parent/show_message_dialog](https://github.com/tauri-apps/plugins-workspace/blob/128190689dbe59b59d344e01bf07b00862aa3791/plugins/dialog/src/desktop.rs),
[rfd MessageDialog::show_async/dialog_result](https://github.com/PolyMeilex/rfd/blob/cca0cfa5fc38c2752c9c98f9f5168904a515fd55/src/backend/macos/message_dialog.rs),
and [Muda menu composition](https://github.com/tauri-apps/muda/blob/87a3560b386243b50812cf0fa2836f3d07062a57/src/platform_impl/macos/mod.rs).
Tauri/dialog/Muda retain their MIT/Apache-2.0 source headers; rfd's existing MIT
license/redistribution notice is retained by resource packaging. No dependency or
third-party source fragment was added. Tao's package VCS record declares a dirty
source tree, so its registry source/version is evidence without asserting an exact
clean upstream tree.

**Decision: adapt ORQST's existing two gates through the installed dialog parent
API.** rfd uses `utils::async_pop_dialog` without a parent and `ModalFuture`/NSAlert
with one; `dialog_result` maps only explicit button returns to Custom and all
unknown returns to Cancel. No separate quit policy, retry, OS-global popup or
process adoption is introduced. A correlated parentless failure and parent-bound
comparative result are recorded separately in the native workflow; source inspection
alone does not establish the cause of the parentless unsolicited affirmative.

A subsequent correlated parent-bound run recorded app deactivation before a custom
affirmative without a corresponding UI choice in the automation trace. Parent binding
alone therefore does not close the observed defect. The native notification observer
now also fences each Quit review by its own token and exact parent/sheet presentation;
revocation survives return. The origin of the unsolicited NSAlert result remains
unproven, and the latest fence must receive native revalidation before Quit acceptance.
