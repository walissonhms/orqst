# Tauri observer Core unavailable — 2026-11-04

## Scope and source cause

Based on published `28a03a2dd977dcb4324cef1785cc312a0433cc07`.
This increment changes the native observer shell, not the terminal/agent Core,
Bridge, provider integrations or Studio. It does not update an already packaged
or running Preview.

At that baseline, `apps/tauri/src-tauri/src/main.rs::main` propagated
`sidecar::start` errors through `setup` into the native builder's `expect`, before
creating the dashboard window. `sidecar.rs::start` killed its child on failed
readiness; its post-readiness `CommandEvent::Terminated` branch disconnected the
tray and removed the matching handle without presenting an unavailable document.
`CommandEvent::Error` and receiver EOF had no equivalent document transition.
These observations come from source, not a reproduced native failure.

Electron's `apps/desktop/src/main.ts::start` defines `showOffline` and `connect`
inside `createWindow`: navigation failure, HTTP errors and renderer loss select a
local document, then a five-second timer loads the existing external Bridge
origin. That reconnect does not start a Core. Tauri owns a separate observer
sidecar, so neither that timer nor the Electron offline text's retry promise is
appropriate evidence of safe managed recovery.

## Implemented behavior

- A failed observer startup creates the main native window at the fixed in-memory
  `orqst-unavailable://local/index.html` document. Native app/tray Close and Quit
  still use the existing flow. Startup failure does not proceed into optional
  preparation, terminal or structured-agent startup.
- After readiness, a matching child's termination, pipe error, EOF or exact
  existing `ORQST_DESKTOP_STATE {"connected":false}` frame latches observer
  unavailability. Presentation is scheduled on the native main thread. Later
  connected frames cannot make the tray claim that observation recovered.
- Failed readiness, pipe error and EOF retain the owned child handle and continue
  draining any remaining pipe events. They are not proof of process exit. Only a
  confirmed termination removes that exact child's handle. The existing explicit
  Quit shutdown/drain/timeout policy remains; the failure path sends no signal.
- One startup attempt is permitted per native shell lifetime. There is no retry,
  reconnect, automatic replacement, process adoption, reconciliation or new host.
  Existing independent terminal/agent hosts, documents and owned state are not
  stopped by this view. Their liveness is not inferred from observer availability.
- Four additive `tauriCoreUnavailable` keys exist in both existing dashboard
  catalogs. Native selection matches `desktop.rs`: a `LANG` value starting with
  `pt` selects Portuguese, otherwise English. Missing localized strings fall back
  to English. This does not establish the effective macOS locale or reuse the
  dashboard's persisted language selection.

The readable document identifies observation as unavailable and managed host
state as separate/unknown. It directs users to review existing terminal windows
before native Quit and states that app restart is not a safe owned-session retry.
No recovery button is offered because there is no reviewed safe recovery contract
for this state. Startup readiness retains the existing 30-second bound.

## Reference research and reuse decision

The existing separate Anywh checkout was inspected at
`546f189c04415c3c5af5f40e3931a0a90b9aba31`; no upstream code was executed.
The architecture, Agent Host and runtime contract documents were read with the
actual sidecar/client functions below. Existing ORQST attribution in root NOTICE
and `sidecar.rs` remains. This increment incorporates no additional upstream code
or assets.

| Candidate                      | Pinned source and actual functions                                                                                                                                                                                                                                                                                                                                                 | Contract, dependencies and decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sidecar errors and termination | [Anywh `tailnet_sidecar.rs`](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/client/src-tauri/src/tailnet_sidecar.rs): `TailnetSidecars`, `tailnet_sidecar_start`, `log_sidecar`, `kill_all`                                                                                                                                                       | Revalidate and retain the existing ORQST adaptation: mutex across start/readiness, continuous drain and identity-checked confirmed-exit cleanup. Upstream removes a terminated profile entry to permit another cold start and logs stderr/raw errors. Keep ORQST's fixed entry, environment allowlist, bounded readiness and redacted diagnostics; do not copy retry or raw diagnostic disclosure. Direct dependencies are Tauri, shell plugin and Tokio; upstream profile/signing APIs additionally use serde/serde_json. |
| Client recovery                | [Anywh `tailnetSidecar.ts`](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/client/src/lib/profiles/tailnetSidecar.ts): `acquireTailnetSidecar`, `releaseTailnetSidecar`; [useRelayClient.ts](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/client/src/hooks/relay/useRelayClient.ts): sidecar acquisition catch | Do not use. Its profile reference counts, failed-promise release, cold-start joins and authenticated tailnet/Relay reconnection are not ORQST observer availability or signed managed ownership. It depends on the Tauri invoke client, profile/broker modules and React hook lifecycle. The startup catch logs an error and returns before constructing a RelayClient; it is not a native unavailable screen to copy.                                                                                                     |
| Agent Host                     | [Anywh architecture](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/docs/architecture.md), [Agent Host](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/docs/agent-host.md), [runtime contract](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/runtimes/README.md)     | Keep the existing ORQST services. No session manager, socket replay, restore, hibernation, orphan sweep or second Agent Host enters this shell correction. These contracts would broaden ownership and execution; documents alone are not acceptance evidence.                                                                                                                                                                                                                                                             |
| ORQST native API compatibility | Resolved Tauri `2.12.5` source: `WebviewWindowBuilder::on_navigation`, `on_page_load`, `WebviewWindow::navigate`; `tauri-plugin-shell 2.6.0::process::CommandEvent`                                                                                                                                                                                                                | Keep existing dependencies and hooks. The custom response and navigation use already resolved APIs, with no new plugin, renderer command or capability. Source inspection is not Rust compilation or native WebKit acceptance.                                                                                                                                                                                                                                                                                             |

The exact Anywh root [LICENSE](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/LICENSE)
is Apache-2.0, SHA-256
`cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30`.
`git ls-tree -r --name-only HEAD` shows no tracked NOTICE/COPYING or nested license
file; selected Rust/client files have no separate license header. Local resolved
Tauri `2.12.5` and shell `2.6.0` manifests declare `Apache-2.0 OR MIT`; Tokio
`1.54.1` declares MIT. No dependency/lock/resource change is made. Existing native
redistribution-notice work remains open; these observations are not a new complete
distribution-license clearance.

## Security review

The new scheme serves only one exact GET URI from compiled text. Other methods,
authorities, credentials, ports, paths and queries return an empty 404. There is
no filesystem lookup, source/error interpolation, URL parameter reflection or
remote fetch. Catalog strings are HTML escaped. The document contains no script,
links, frames, form, command or retry action. Its response is `no-store`,
`nosniff`, and has a CSP denying scripts, connections, images, frames, objects,
base URLs and forms; only the fixed inline styling is permitted.

Main navigation adds only that exact static URL to the previous observer-origin
policy. Existing origin equality, username/password/query rejection and popup
denial remain. The existing page-load invalidation still revokes the old
main-document authority. Existing initialization-script bodies remain guarded by
the observer origin; the unavailable document gets no new native capability.
No tauri.conf.json grant, custom terminal/Feature/agent protocol, HTTP API,
WebSocket, cookie, Host/Origin validation or Bridge CSP is changed. Raw stderr,
resource paths, config, signed proofs and credentials never enter this document.
The existing native host consent and Exit cleanup remain in place.

## Checks and remaining acceptance

Executed in the isolated worktree with Node `24.22.2`, pnpm `10.34.9` and the
existing Rust `1.99.1` toolchain. Dependencies were reused through disposable
symlinks to existing node_modules; no install or binary/resource copy occurred.

- `rustc --edition 2021 --test apps/tauri/src-tauri/src/sidecar_availability.rs
-o /private/tmp/orqst-core-unavailable-716-pure-tests`, then that binary:
  **2 passed**. These execute the production latch state, covering second-attempt
  refusal, failure permanence, frame suppression and Quit presentation suppression.
- `pnpm exec tsx --test tests/locales.test.ts`: **1 passed**, existing full-catalog
  EN/PT key parity.
- `pnpm typecheck`: passed after linking each app's existing workspace dependencies.
  The first attempt failed because the isolated worktree lacked those app-level
  node_modules links; no source/type rule was weakened.
- `pnpm exec eslint .`, targeted Prettier and `rustfmt --check` for all four changed
  Rust files: passed. `git diff --check`: passed.

The three native unavailable-document tests (navigation, response containment/CSP,
and EN/PT static escaped output), the new disconnected-frame test and existing
readiness tests are authored/preserved but **not executed** here: they require
compiling the Tauri crate. No Cargo/Clippy, app build/resource staging, full Node
suite, `validate:local`, native app, observer Core, provider CLI, PTY, server,
probe or WebKit acceptance was run. No auth database, quarantine or uncertain
state was inspected or changed. Disk was checked before/after lightweight work;
no heavy build was undertaken. The final check found 26.3755 GiB free.

This change responds to explicit owned-pipe failure evidence. It does not add an
HTTP health poll, hung-Core watchdog, generic WebKit load-error/renderer-crash
callback, dashboard recovery, managed session recovery or safe restart proof.
A still-open but silent pipe and unrelated setup failures remain outside this
increment. The underlying Tauri builder/native initialization can still fail for
reasons unrelated to observer startup. Runtime navigation/reload, effective CSP,
focus, native locale, Close/hide and both host Quit gates require later exact-app
acceptance; no screenshot or provider evidence is claimed.

## Integration checklist fragments

For the Electron retirement / V6 trackers, root can integrate these scoped entries
without marking the broader parity gate complete:

- [x] Source: observer startup failure and explicit runtime disconnection show a
      local EN/PT unavailable document without retry, respawn or host-state claims.
- [x] Source: failed readiness/pipe uncertainty retain the owned handle; only exact
      confirmed exit removes it. Existing native Quit and terminal hosts are retained.
- [ ] Compile the combined Tauri crate and execute its document/protocol tests.
- [ ] With separate owner authorization, accept startup port conflict, failed
      readiness and post-readiness loss in the exact new WebKit package, with a
      live independent managed host preserved and no duplicate process start.
- [ ] Accept navigation/reload/focus/Close/hide/native Quit and effective no-command
      capability/CSP behavior. Keep generic renderer errors and advanced recovery open.
