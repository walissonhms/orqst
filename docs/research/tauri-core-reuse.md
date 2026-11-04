# Tauri/Core reuse increment — 2026-11-04

## Baseline and owner direction

ORQST baseline `0617250` was clean on `main`; `pnpm test` passed 568 tests before
production edits. The current code, not the historical observer-only plan, is the
baseline: Node 24, pnpm 10.34.9, strict TypeScript 6.0.3, React 19, Tailwind 4,
Electron 45.2.1, SQLite and node-pty 1.1.0. Existing independent managed-terminal
services and the earlier attributed Anywh byte-framing adaptation were retained.

The owner supplied `ORQST_MASTER_SPEC_TAURI_REUSE_UI.md` (2026-11-04) as the primary
next-stage specification and required reference research before implementation or
complex debugging. Local `AGENTS.md` now records that permanent rule, distinguishes
observer access from authorized managed execution, and permits audited compatible
reuse. Neither local agent instructions nor the supplied working specification are
committed, in accordance with repository policy. The preserved Tucano audit and
initial implementation plan were not rewritten.

## Inspected sources and decisions

All source inspection used separate upstream Git object stores. Upstream install
scripts, tests and executables were not run. The [earlier source ledger](reuse-first-audit.md)
remains valid for the byte-framing adaptation; this is an additional component review.

| Candidate               | Exact source / functions                                                                                                                                                                                                                                                       | Decision and reason                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tauri sidecar ownership | [Anywh `546f189c04415c3c5af5f40e3931a0a90b9aba31`, `client/src-tauri/src/tailnet_sidecar.rs`](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/client/src-tauri/src/tailnet_sidecar.rs), `TailnetSidecars`, `tailnet_sidecar_start`, `kill_all` | **ADAPT** the mutex-held start, retained child handle, continuous receiver drain and identity-checked cleanup into `apps/tauri/src-tauri/src/sidecar.rs`. Replace profile/tailnet logic with the existing fixed Node Core, bounded readiness, environment allowlist and graceful stdin shutdown. No keys, network join, installer or Windows job code copied.               |
| Single native instance  | [Anywh at the same SHA, `client/src-tauri/src/lib.rs`](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/client/src-tauri/src/lib.rs#L87-L95), `run_with` single-instance registration                                                           | **ADAPT** the early single-instance plugin callback that shows/focuses the existing main window. No deep-link forwarding or other plugins incorporated.                                                                                                                                                                                                                     |
| Tauri configuration     | [Anywh at the same SHA, `client/src-tauri/tauri.conf.json`](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/client/src-tauri/tauri.conf.json) and `Cargo.toml`                                                                                 | **DO NOT COPY** broad plugin/configuration grants, null CSP, updater, remote profiles and tailnet service. Use a fixed local Core, no renderer capabilities, retained Bridge security and existing ORQST assets.                                                                                                                                                            |
| CLI/session lifecycle   | [Anywh at the same SHA, `docs/architecture.md`](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/docs/architecture.md), `docs/agent-host.md`, `relay/src/runtimes/README.md`, `CodexSessionDriver`                                              | **KEEP EXISTING ORQST** for this shell increment. Its Bridge/Core and owned terminal hosts already solve the runtime responsibilities. A second agent host or replacement driver would expand behavior and storage without solving the native-shell migration. Reassess provider adapters against exact installed versions in their own increment.                          |
| Agent communication     | [Tucano `0501956d127699300209902e889f3e69a0948766`, `src/core/router.ts`](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/src/core/router.ts), `route`, `parseRoute`, plus `runs.ts` and its `RunnerDeps`/`mentioned` integration              | **DEFER INCORPORATION** until the communication increment. The router selects speakers through a real provider turn and imports shared agent/connector/language contracts; `runs.ts` owns a broader conversation/tool system. It cannot be inserted into an observer-shell bootstrap or substituted for existing authorized Core task delivery. No Tucano code copied here. |
| Terminal experience     | [Overclock panes](https://overclock.sh/features/panes)                                                                                                                                                                                                                         | **VISUAL/FUNCTIONAL REFERENCE** for multiple independent panes, layout/focus/reordering. The official page describes behavior; it does not establish a source license. No code, binary extraction, assets or identity copied. No terminal redesign is claimed by this increment.                                                                                            |

## License and dependency scope

The selected Anywh commit's full tracked tree has root `LICENSE` (Apache-2.0), no
tracked NOTICE/COPYING or nested license grant, and no separate selected-source
copyright header to remove. Tucano's pinned root LICENSE and package declaration
also identify Apache-2.0; that does not license unspecified projects or Overclock.
Both LICENSE hashes were rechecked against the ledger:
`cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30`.

The adapted Rust file declares origin, pin and modifications. Root NOTICE records
both new Rust source paths and the earlier byte-framing adaptation. The Tauri
configuration and ORQST-specific Core entry are independent integration code.
No Anywh Relay dependency or Tucano package is installed.

The narrow native dependency surface is Tauri, its shell/single-instance plugins
(Apache-2.0 OR MIT), and Tokio (MIT), resolved in Cargo.lock. JavaScript closure
inspection during staging copies 14 packages' license texts and their metadata;
the actual Core esbuild inputs and dashboard dependency closure determine this set.
Unknown JavaScript grants or missing notice texts fail staging. The matching Node
distribution's full LICENSE is required and copied with its binary hash.

Native metadata inspection for `aarch64-apple-darwin` found 253 selected Cargo
packages including build dependencies. Some declare MPL-2.0, Unicode-3.0, BSD and
Zlib terms; 15 publish no root license text in the inspected crate directory. This
is recorded as **unresolved redistribution work**, not a blanket incompatible-license
claim or whole-project clearance. The debug package is local development evidence;
complete native notices/source obligations and other target closures must be
reviewed before distributing installers.

## Concrete implementation and rollback

The new native shell launches the bundled Node executable with the existing
`createBridge`/`ObserverCore` implementation and a separate preview data directory.
It loads the unchanged React build at the Core's stable native loopback origin. The
packaged Analytics worker is colocated; the frontend continues using `/api/*` and
`/ws`. No new server app, CLI/session manager, communication bus, database schema,
observer write capability or provider launch is introduced.

The [development guide](../development/tauri.md) records native and packaging evidence,
commands and unimplemented parity. Rollback is to continue running the unchanged
Electron commands; no user database migration, service replacement or source-session
modification must be undone. The preview's separate local state remains private.

## Executed verification

Final checks used Node `24.22.2`, pnpm `10.34.9` and an isolated temporary Rust
`1.99.1` toolchain. No global Node/Rust installation, service or existing Desktop
process was replaced or restarted.

- `pnpm lint`, `pnpm typecheck`, `pnpm build`: passed. The pre-existing Vite
  large-chunk advisory remains. Electron's existing build also completed.
- `pnpm test`: **575 passed**, zero failures/cancellations/skips, including seven
  new actual Node-process checks. Pane 677 contributed the first five cases;
  missing-dashboard and stable-origin restart regressions were added in integration.
- `cargo test --manifest-path apps/tauri/src-tauri/Cargo.toml`: one native protocol
  test passed. `cargo clippy ... -- -D warnings` and `cargo fmt`: passed.
- `pnpm build:tauri --debug --bundles app`: produced a local macOS Apple Silicon
  `.app` (156.89 MiB). `pnpm accept:tauri-core`: passed with copied, self-contained
  resources outside the checkout, synthetic source data and real Chromium.
- Actual native Tauri window: Overview and Settings rendered; a second launch
  retained the same owned Core PID; quit removed both processes. After the stable
  port adjustment, a theme change survived application quit/reopen at
  `127.0.0.1:4319`. The original dark theme was restored and the test app closed.
  This checks native navigation/preferences, not provider or terminal operation.

Initial staging failed on the valid subpath-only `@babel/runtime` package; resolving
its manifest through Node's package search paths fixed notice collection. Initial
lint encountered generated Tauri JavaScript and the unformatted local supplied
specification; generated-output exclusions and formatting the local copy resolved
those failures. Final checks above passed without weakening application assertions
or license checks. An earlier native inspection timeout remains unaccepted evidence.

`validate:local`/`validate:live`, the full Playwright suite, native Electron/PTY
acceptance and real Codex/Claude/OpenCode tasks were **not run** for this increment.
Ingestion logic and managed execution are unchanged. No login, provider inference,
existing-session control or actual multiagent mention/return is certified.
