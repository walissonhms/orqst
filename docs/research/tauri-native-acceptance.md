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
