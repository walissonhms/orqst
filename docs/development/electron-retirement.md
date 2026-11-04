# Electron retirement — ORQST

## Core availability and explicit MCP pair integration — 2026-11-04

Integrated deliveries `90509ca` (Core unavailable) and `8c458de` (explicit
Codex/OpenCode pair), preserving additive EN/PT namespaces and existing tests.
The static unavailable document has no script, IPC, network or retry controls;
observer loss latches without releasing uncertain owned handles or stopping
managed hosts. Normal Open keeps MCP disabled. The unchecked pair option reviews
both catalog models, exact source/worker identities and every native page in the
same workspace; operational Open and the one-use task grant remain separate.
No new runtime, process adoption, permission expansion or Feature Delegate.

See [Core availability](tauri-core-unavailable.md),
[pair workflow/security](tauri-mcp-product-pair.md) and
[combined validation and package boundary](tauri-mcp-unavailable-integration.md).
Real providers, effective models, native WebKit/MCP/Quit and Electron retirement
remain pending. The new local package is built only from published frozen source;
its generated manifest records actual Rust/build/signature/resource checks.

## Current delivery — 2026-11-04

Source: `9e562faab49096f8e1239956387dc792623fa2ec`, published as
[`delivery/2026-11-04-preparation-diagnostics-opencode-integration`](https://github.com/walissonhms/orqst/tree/delivery/2026-11-04-preparation-diagnostics-opencode-integration).
The coordinated build and read-only migration inventory are complete. Electron
retirement, native/provider acceptance and real communication remain pending.
After Codex/OpenCode function correctly, the owner's next priority is completing
the migration and removing the Electron runtime, dependency and obsolete scripts.

Local artifact: [ORQST Preview.app](../../dist/native-preview-terminal-fixes/ORQST%20Preview.app),
with [build-manifest.json](../../dist/native-preview-terminal-fixes/build-manifest.json)
alongside it. These generated local paths are absent from a source-only checkout;
neither package, manifest nor logs belong in Git. Bundle identity is
`dev.orqst.desktop.preview`. The final executable SHA-256 is
`31785e65059c07d4f997802d2a24af9530b9f822021c9536f629019a6034e0f2`.
Older apps do not update themselves when source/resources change. For later human
acceptance, the human must quit the previous version through its native flow
before opening the exact new package: single-instance forwarding can focus the
old app and exit successfully without starting the new one. This documentation
delivery does not launch either app.

| Evidence scope           | Recorded result                                                                                                                                       | Acceptance boundary                                                                               |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Source integration       | 52 distinct focused Node cases; lint, typecheck, formatting and rustfmt passed in the preceding integration                                           | Build delivery did not rerun these checks; no broad Node-suite claim                              |
| Coordinated native build | 40 Rust tests in default mode and the same 40 with custom-protocol; all-targets custom-protocol Clippy with `-D warnings` passed                      | Two configurations, not 80 unique tests                                                           |
| Package                  | Dashboard Vite build, 17 dependency notices, resource staging, native custom-protocol build and debug app bundle passed                               | Local macOS Apple Silicon package; ad hoc signature, no notarization or cross-platform acceptance |
| Final integrity          | 112 configured resources matched; Node bytes and original Developer ID signature retained; outer app ad hoc signature passed deep/strict verification | Package was not started; integrity does not establish native behavior                             |
| Preservation             | Four earlier app trees/executables unchanged; 26.7937 GiB free at build completion                                                                    | Source, user apps, targets and preserved fixtures remain; no uncertain-state reconciliation       |
| Still unaccepted         | Codex/OpenCode opening, effective provider/model/variant, actual communication and final native Quit                                                  | Historical Codex refusal after configuration confirmation remains unexplained                     |

The manifest retains two corrected verification/signing steps. The first verifier
included an old staging-root `.DS_Store` outside the configured resource map;
only the generated verifier was corrected. Initial deep signing changed the
bundled Node bytes/signature. Only Node inside the new package was restored from
the exact input; signing the outer app without deep signing then preserved Node,
and final `codesign --verify --deep --strict` passed. Staging is additive, not
claimed clean. Existing Vite chunk/color warnings and intentionally skipped
bundler signing are recorded; separate final signing passed. These corrections
do not invalidate the final result or establish runtime acceptance.

## Parity and responsibility matrix

These are implementation responsibilities, not invented personal assignments:
this checkout has no tracked CODEOWNERS file. Root coordinates the dependent
slices. Paths below are relative to `apps/tauri/src-tauri/src/` (Rust),
`apps/desktop/src/` (shared Node/UI) or explicitly qualified otherwise.
“Implemented” means a source path exists; all remaining native checks require
the exact packaged app. The [V6 checklist](../architecture/v6-feature-checklist.md)
continues to govern the full Workspace → Feature → TerminalPane → AgentSession scope.

| Surface / owner                                                 | Existing Tauri/Core path and Electron comparison                                                                                                                                                                                                                                                                            | Remaining parity / acceptance                                                                                                                                                                                                       |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Main window, IPC, unavailable UI / native shell + dashboard     | `main.rs`, `sidecar.rs`, `features.rs`, `terminal_creation.rs`; Electron `main.ts`, `preload.ts`, `policy.ts`                                                                                                                                                                                                               | Native clients exist. Static observer-unavailable startup/runtime UX is integrated without retry; accept renderer/Core-failure presentation; prove SPA/reload/port conflict/crash without automatic replacement Core                |
| Navigation, downloads, permissions / native security            | `main.rs` origin checks/popup denial and custom-protocol CSP; `apps/tauri/src-tauri/tauri.conf.json`; Electron session permission/device/download/request denial in `main.ts`                                                                                                                                               | Verify effective Tauri/Wry behavior and equivalent explicit policy. IPC capability denial alone does not prove webview/OS permission or download denial; review final boundary                                                      |
| Native files/default editor / files + Core                      | `files.rs`, `tauri-files-service.ts`, `artifacts.ts`, `analytics.ts`, `artifact-files.ts`; Electron dialogs/IPC in `main.ts`                                                                                                                                                                                                | Existing secure writers are shared. Accept save/cancel/overwrite, symlink/destination changes, analytics context invalidation, reload/Quit/timeouts and opening the saved Markdown in the default editor                            |
| Clipboard, terminal keyboard / terminal UI + native shell       | Shared React clipboard and `managed-terminal-client.ts`; Core `terminal/native-broker.ts`, `terminal/supervisor.ts`                                                                                                                                                                                                         | No native clipboard plugin is installed. Accept actual WebKit copy/paste/keys, exact-text paste review and retained OSC blocking                                                                                                    |
| Owned PTY, enrollment and layout / terminal Core + native shell | `terminal.rs`, `tauri-terminal-host.ts`, `tauri-terminal-service.ts`, `tauri-terminal-layout.ts`; `packages/core/src/terminal/{managed-pair,host,enrollment-files}.ts`                                                                                                                                                      | Source appends to the same Pair with stable IDs, receipts/CAS and retained documents. Accept real ANSI/TUI/input/resize/focus/hide/restore/stop and failure isolation without replacing prior processes or scrollback               |
| CLI/model opening / preparation + provider integration          | `tauri-terminal-preparation.ts`, `terminal-creation.ts`, `terminal-discovery.ts`; Core `terminal/model-selection.ts`, `terminal/opencode-profile.ts`; `terminal_creation.rs`                                                                                                                                                | New bounded diagnostics and equivalent-copy OpenCode selection are packaged. Full TUI inline V2 configuration sets an initial default; native preferences/fallback may win. Requested model is not effective-model evidence         |
| Communication / communication Core + native UI                  | Normal preparation writes `mcp:false`; explicit fresh Codex/OpenCode pair preparation now reviews both models and bilateral opt-in; `tauri-terminal-service.ts::authorizeMcp` requires two panes; Core `terminal/enrollment-files.ts` rejects MCP append; `apps/dashboard/src/FeatureWorkspace.tsx` keeps Delegate disabled | Existing experimental interactive MCP needs two opted-in members and a separate task grant. The structured two-Codex client is another composition. Opening two CLIs proves neither real communication nor Feature/N-member routing |
| Notifications, tray, lifecycle / native shell + monitor         | `desktop.rs`, `sidecar.rs`, `packages/core/src/desktop-monitor.ts`; Electron `main.ts` routes notification clicks to validated sessions                                                                                                                                                                                     | Source-backed selection and draft guard added; [source/limits](tauri-notification-route.md). Accept actual OS click/banner/sound/permission/identity and tray/lifetime                                                              |
| Close/hide/Quit / native shell + both owned hosts               | `desktop.rs`, `main.rs`, `terminal.rs::confirm_exit`, `agents.rs::confirm_exit`, `sidecar.rs::stop`                                                                                                                                                                                                                         | Cmd-Q/menu routes exist. Accept two gates, cancellation/re-presentation, true deactivation/late-affirmative denial and final owned-host/Core exit. Electron's external Bridge lifetime differs from Tauri's owned sidecar           |
| Recovery / Core + native UX                                     | Existing journals/ownership fences; sidecar and terminal/agents private pipes; persisted SQLite Features/layouts                                                                                                                                                                                                            | Show unavailable/unknown honestly. Restored metadata grants no process ownership; no universal managed reconnect is implemented. Advanced V6 recovery remains open                                                                  |
| Build/test/distribution / tooling + native QA                   | `scripts/build-tauri-resources.mjs`, `scripts/build-desktop.mjs`, `package.json`, `pnpm-lock.yaml`, `.github/workflows/ci.yml`                                                                                                                                                                                              | Root build still ends with Electron build; CI Ubuntu lane has no Tauri/native acceptance. Close imports/types/resources/tests before dependency removal; verify final supported-target package independently                        |

The Tauri structured client currently opens through native menu/opt-in wiring in
`agents.rs`. The dashboard `orqstManagedAgents.open` affordance is Electron-only;
the dedicated document's `orqstManagedAgentsClient` is a different API. Any required
UI port must reuse the existing native boundary without giving the observer
execution authority. The saved-Markdown default-editor action is the existing
file-opening scope; there is no generic renderer shell/path opener to migrate.

The observer remains read-only toward external sessions. Managed authority applies
only to explicitly owned instances. Keep exact native source/document/focus,
epoch/generation, signed launch/output/input grants and uncertainty fences. Keep
quarantines, missing exit receipts and uncertain effects without retry, adoption,
signalling, deletion or reconciliation through this migration.

## Dependency and path closure

Current manifests/locks declare Node `>=24 <25`, pnpm `10.34.9`, TypeScript
`~6.0.3`, React `19.3.1`, Vite `8.3.5`, Electron `45.2.1`, Tauri JS/CLI `2.12.4`
and resolved Rust Tauri `2.12.5`. Keep Node 24, `node:sqlite`, `node-pty` `1.1.0`,
`@xterm/xterm` `6.0.0` and `@xterm/addon-fit` `0.11.0`.

`apps/desktop` contains required Tauri dependencies. Preserve these groups or
repoint every consumer before relocating them; deleting the directory is unsafe.

| Group                               | Paths / consumers to preserve                                                                                                                                                                                                 |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Native Node hosts                   | `tauri-*.ts`, `managed-terminal-core.ts`, `managed-agents-{host,core,wire}.ts`; resource builder bundles these with Core native/terminal/PTY/MCP hosts                                                                        |
| Shared terminal/structured renderer | `managed-terminal-client.ts`, `terminal-client.ts`, `terminal-document.ts`, `terminal-policy.ts`, `managed-agents-{client,document}.ts`; `apps/tauri/src/{terminal,agents}-client.ts` consume them                            |
| Layout/preparation/files            | `terminal-layout*.ts`, `feature-layout.ts`, `terminal-{catalog,creation,discovery,selection}.ts`, `artifacts.ts`, `artifact-files.ts`, `analytics.ts`, `policy.ts`; retain savers and private SQLite metadata                 |
| Assets/licenses                     | `managed-terminal.css`, `managed-agents.css`, `apps/desktop/resources/icons/`, xterm, root LICENSE/NOTICE and staged Node/dependency notices                                                                                  |
| Independent observer/Core           | `apps/bridge/src/desktop-sidecar.ts`, `packages/core/src/managed-codex/desktop*.ts`, Core monitor, database/adapters/protocol, `scripts/{build,dev,service,install-runtime}.mjs`; “desktop” in a name does not imply Electron |

One concrete type dependency must be split before removal:
`terminal-document.ts` → `terminal-policy.ts` → `terminal-sender.ts` imports the
pure `terminalDocumentURL` from an Electron-typed module. Move that constant to
an appropriate existing pure module and update consumers without cycles; retain
Electron sender guards until their adapter is retired. Tree shaking is not proof
that TypeScript can resolve without Electron.

The only direct Electron dependency is in `apps/desktop/package.json`. Its lock
closure includes `@electron-internal/extract-zip`, `@electron/get` and downloader
helpers such as `sumchecker`, `debug`, `semver` and optional `undici`.
Node types and several helpers are shared elsewhere. Remove Electron using pnpm
and let pnpm remove only orphaned lock entries; never hand-edit the lock or delete
transitives by name. Keeping the desktop workspace as shared helpers without
Electron is the smallest option; wholesale relocation is a separate change.

## Ordered execution and acceptance checklist

These are future implementation/acceptance slices; this delivery changes docs only.
Each slice needs a focused commit, applicable tests and explicit native/provider
results. Build checks and synthetic fixtures never close real acceptance boxes.

### P0 — correct artifact and functional Codex/OpenCode

- [x] Bind the combined source to the new package, manifest, resource/Node/signature
      checks and preservation evidence above; complete the read-only retirement inventory.
- [ ] Human quits the prior version natively, then verifies the exact new path and
      bundle identity. Preserve other apps and all unresolved attempts/fixtures.
- [ ] Make one separately authorized Codex attempt with stage/code/effects evidence;
      investigate only the demonstrated failure. `possible`/timeout/unknown preserves
      the attempt; catalogue drift is not the established historical cause.
- [ ] Accept one reviewed OpenCode catalogue option for equivalent native bytes,
      original full TUI `--standalone`, and actual provider/model/variant. Never
      silently substitute native fallback for the requested model or reinstall to
      bypass review. Validate Codex's effective provider/model separately.
- [ ] Accept signed Start/output/input, native focus/dialog/blur/reload behavior,
      resize/hide/restore/stop, independent failure and append with existing
      PID/instance/epoch/document/history retained and no duplicate Starts.

### P0 — real communication using existing Core

- [ ] Accept the smallest existing experimental mixed pair: two fresh opted-in
      manifests in the same workspace, independent signed Starts and exact separate
      task grant. Existing setup scripts are references, not an executed acceptance.
- [ ] In a cohesive product increment, connect explicit MCP consent to native
      preparation using existing factories/config composition, `InteractiveMcpSession`,
      `McpTaskBroker` and relay. Changing `mcp:false` alone is insufficient: two-member
      selection, ownership, deadlines and native review must agree.
- [ ] Prove real `delegate_task` → `wait_task` → `submit_result` and correlated
      requester return with matching task IDs. Distinguish admission, provider
      acceptance, execution, verified result and unknown; stdout is not a receipt.
- [ ] Deny invalid targets/roles, expired/revoked grants, busy/closed/disconnected
      instances and duplicate delivery. Preserve Feature-local permissions; an
      orchestrator role grants nothing. Unknown outcomes receive no automatic resend.
- [ ] Keep Feature/N-member expansion explicit: MCP append currently fails closed,
      Delegate is disabled, and single-task in-memory MCP does not equal the durable
      structured `PaneCommunication` SQLite queue. Reuse the existing queue/grants
      when extending that contract; create no parallel runtime/session manager.

### P0 security/Quit, P1 shell parity — native shell and QA

- [ ] Accept menu/Cmd-Q/tray exit through both gates: first Cancel, first Yes/second
      Cancel, first-gate re-presentation, true deactivation/late Yes denied, then both
      Yes with original owned-host/Core exit evidence. No process snapshot replaces receipts.
- [ ] Accept window close, keep-running per run, Dock reopen, second instance and
      distinct hide/detach/stop/terminate semantics on the final artifact.
- [ ] Close unavailable/Core-failure UX and webview navigation/download/permission
      hardening using the actual Tauri/Wry APIs; preserve loopback, cookie, Host/Origin,
      CSP and minimal capabilities. Record security review for boundary changes.
- [ ] Accept Files/default editor/Clipboard, notification click-to-session, OS
      notification identity/permissions, tray/lifetime, keyboard/accessibility,
      reduced motion, EN/PT and laptop geometry. Keep recovery limits visible.

### P1 — remove Electron runtime/dependencies/scripts after parity gates

- [ ] Split the pure constant/type boundary; remove only Electron adapters
      `main.ts`, preloads, `managed-terminal.ts`, `managed-agents.ts`,
      `terminal-panels.ts`, `terminal-runtime.ts`, sender/lifecycle/confirmation
      wrappers and `terminal-lab.ts` once equivalent Tauri coverage is retained.
- [ ] Port Electron-only panel/router/runtime QA and split mixed broker, artifact,
      export, monitor and desktop QA tests. Preserve shared writer/symlink/grant/
      replay/ownership/monitor/SQLite/sidecar tests and browser coverage.
- [ ] Repoint Chromium/Node runners consuming `dist/desktop`; retire Electron
      smoke/native/pair/team/cycles/gestures/creation/selection/stdio launchers only
      after their native scenarios have replacements. Keep Playwright, xterm and PTY.
- [ ] Decouple `scripts/build-desktop.mjs` shared outputs; remove root build's
      Electron tail and obsolete `desktop`, `dev:desktop`, `build:desktop`,
      `test:desktop`/Electron acceptance commands. Preserve Node/browser build,
      dev/start/service and existing Tauri commands; do not make normal build an
      unconditional platform-heavy native build.
- [ ] Remove Electron with pnpm; regenerate lock; prove no active Electron
      imports/requires/type resolution or executable bundle inputs remain. Retain
      historical documentation and shared dependencies.
- [ ] Run lint/typecheck/tests/build and appropriate browser checks for that actual
      removal; then serial Rust tests, Clippy, native build/package and resource/
      Node/license/signature verification on the supported target, with disk checks.
- [ ] Update CI's Node/browser lane to work without Electron and add native checks
      for explicitly supported targets/prerequisites. CI must not invoke providers.
- [ ] Revalidate final Tauri observer/analytics/files/terminals/communication/Quit;
      reaccept providers if their path changes. Update both trackers and API/security/
      development docs with implemented versus machine-accepted results.

### P1 — distribution closure

- [ ] Validate installation outside the checkout, exact sidecar Node, PTY helper,
      packaged worker/resources, lifecycle and target-specific licenses/signing.
      Complete native transitive notices and required release/notarization work.
- [ ] Keep macOS Intel/Windows/Linux managed support unaccepted until implemented
      and tested; current darwin-arm64 guards are not portability. Updater, generic
      external deep links and app autostart are not existing Electron parity claims.
- [ ] Publish downloads only after a verifiable installable release asset and its
      supported-platform acceptance. Site publication belongs to its separate repo;
      a local build or delivery tag does not authorize release/1.0 claims.

## Reuse decisions and verification scope

Retain the existing Core/PTY/SQLite/authority and narrow attributed adaptations.
The [Tauri reuse audit](../research/tauri-core-reuse.md) pins Anywh
`546f189c04415c3c5af5f40e3931a0a90b9aba31`: `TailnetSidecars`/start/cleanup in
[`tailnet_sidecar.rs`](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/client/src-tauri/src/tailnet_sidecar.rs)
and early single-instance registration are already adapted. Keep the fixed owned
Node entry, bounded pipes/readiness and allowlisted environment. Do not import
remote tailnet, broad capabilities or a second Agent Host. Anywh's tmux/reattach
contracts conflict with ORQST's non-adoption/signed ownership. Its inspected pin
has Codex/Claude drivers, no OpenCode runtime.

The [mention audit](../research/mention-communication.md) pins Tucano
`0501956d127699300209902e889f3e69a0948766`:
[`context.ts::mentioned`](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/src/core/context.ts)
and `shared/types.ts::CODE_SPANS` are already narrowly adapted. Keep exact Core UUID/
Feature authorization; do not import reply-text chaining as task authority. Both
pinned root licenses are Apache-2.0, with no tracked NOTICE in the recorded review;
existing ORQST NOTICE retains modifications/attribution. Dependency/OS notices
remain separate obligations. No new upstream code or assets enter this delivery.
See the [MCP reuse review](../research/tauri-interactive-mcp.md) for Node HTTP/token
and transport differences, and the [OpenCode review](../research/opencode-executable-equivalence.md)
for actual V2/default precedence. Overclock remains a visual reference without a
verified reusable source/license; preserve ORQST identity.

This consolidation runs only targeted Markdown formatting, diff and local-link
checks. It does not rerun Node tests/lint/typecheck, Rust/Cargo, builds, resource
staging, installation, acceptance or runtime/provider operations. The matrix is a
source inventory and the package results above are the completed build delivery's
reported evidence, not new machine acceptance by this documentation change.
