# Electron retirement — ORQST

## Non-removal preparation — 2026-11-05

This increment starts at `5db368b` and prepares test/build consumers only. No
Electron adapter, dependency, command, CI step or native resource is removed.
`apps/desktop` remains a required shared workspace. Native acceptance, Quit,
WebKit policy, providers, UI and Rust are outside this increment.

### Mixed-test separation

The same 70 executed cases remain: 48 now run in Electron-neutral files and 22
remain in the seven original adapter files. A TypeScript AST comparison against
`5db368b` found the same 57 test declarations (loops expand to 70 cases), with
identical test bodies/assertions. Only imports and fixture placement changed.

| Original test file                      | Neutral destination and preserved assertions                                                                                                                                                                                                                                                     | Cases moved / retained               |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------ |
| `tests/desktop-artifacts.test.ts`       | `tests/artifact-writers.test.ts`: extraction identity/JSON/byte bounds, original/draft bytes, overwrite/cancel, symlink/hardlink/mode/size checks, target/parent replacement, O_EXCL, saved verification, grant revocation/replay and sanitized open failure                                     | 11 / 1 sender case                   |
| `tests/managed-terminal-qa.test.ts`     | `tests/managed-terminal-core-qa.test.ts`: profile admission, SQLite exclusive ownership, duplicate/overlapping manifests and pair admission/retirement including capacity rejection                                                                                                              | 5 / 3 IPC cases                      |
| `tests/terminal-native-broker.test.ts`  | `tests/terminal-broker.test.ts`: signed broker/grants, cancellation, busy/replay, input sequencing, blur/detach/suspension, uncertain shutdown, immutable Open consent/deadlines and focus loss. The unchanged synthetic supervisor fixture is shared through `tests/helpers/terminal-broker.ts` | 30 / 3 sender/dialog/lifecycle cases |
| `tests/terminal-runtime.test.ts`        | `tests/terminal-client-policy.test.ts`: client activation, request/reply validation, no queue, bounded output and exact document/network/CSP policy                                                                                                                                              | 2 / 4 runtime cases                  |
| `tests/terminal-panels-runtime.test.ts` | No extraction: the complete case exercises Electron parent/frame sender, focus and lifecycle routing                                                                                                                                                                                             | 0 / 1                                |
| `tests/terminal-panels.test.ts`         | No extraction: owned handles, layout persistence and failure assertions are coupled to `TerminalPanels` and mocked Electron `WebContentsView`                                                                                                                                                    | 0 / 8                                |
| `tests/terminal-router.test.ts`         | No extraction: both cases exercise the Electron IPC/frame router, busy state, blur, navigation and disposal                                                                                                                                                                                      | 0 / 2                                |

No panel/router case was weakened or deleted to make it neutral. The neutral
TypeScript roots plus the new build helper compile with Electron resolution
denied: zero Electron resolution attempts and zero diagnostics. The remaining
adapter tests still require Electron types. Existing monitor/SQLite/sidecar suites
are retained; this preparation does not change monitor behavior or claim new
monitor acceptance.

### Shared build consumers

`scripts/helpers/shared-test-resources.ts` reuses the entries and Node 24/CJS,
Chromium 156/IIFE settings from `scripts/build-desktop.mjs`. The existing
`accept-terminal-open-renderer.ts` in-memory esbuild fixture is the local pattern.
An esbuild resolver rejects Electron instead of externalizing it. Renderers are
built in memory; hosts and the pinned MIT `node-pty` 1.1.0 backend are staged only
under each runner's disposable temporary directory. The PTY LICENSE is retained;
only its copied spawn helper is chmodded. No Cargo, Tauri package builder, bundled
Node replacement or `dist/` write is required.

| Consumer retained                                            | New source build                                                                                              | Existing behavior retained                                                                                      |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `accept:terminal-reuse` / `scripts/accept-terminal-reuse.ts` | Temporary `managed-terminal-core.cjs`, `managed-terminal-host.cjs`, `orqst-mcp-relay.cjs` and `terminal-pty/` | Existing opt-in, two synthetic PTYs, signed lifecycle and sentinel/receipt assertions; no provider substitution |
| `accept:managed-agents` / `scripts/accept-managed-agents.ts` | Temporary `codex-structured-host.cjs` and in-memory `managed-agents-client.ts`                                | Existing synthetic executable, structured hosts, task/ownership/retirement and Chromium assertions              |
| `scripts/accept-terminal-ui.ts`                              | In-memory `managed-terminal-client.ts` and bundled `managed-terminal.css`                                     | Same synthetic facade, real xterm document, locales, layout and screenshots                                     |
| `tests/browser/managed-agents-open.spec.ts`                  | In-memory `managed-agents-client.ts` for the isolated document case                                           | Same focus-refusal/lifecycle/recovery assertions; the dashboard opener case is unchanged                        |

These four consumers no longer require `build:desktop` or pre-existing
`apps/desktop/dist`. This does not decouple the root build or CI yet. A temporary
build-only comparison produced byte-identical four Node bundles, two renderer
scripts and terminal CSS against the existing desktop build settings; five PTY
files and copied helper mode were checked. No host was executed by that check.

Reuse review rechecked the separate pinned Anywh tree: architecture, Agent Host
and runtime docs plus
[`HostClient` in `hostClient.ts`](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/agentHost/hostClient.ts)
use reconnecting Unix-socket/process contracts. Tucano's
[`router.ts`](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/src/core/router.ts)
uses engine/shared agent, connector and language contracts. Neither replaces an
ORQST fixture bundler or its signed private-host boundary. **Keep existing ORQST**
entries and tests; no upstream code/dependency/assets are incorporated. Both exact
trees have Apache-2.0 LICENSE and no tracked NOTICE/COPYING; existing ORQST
LICENSE/NOTICE are unchanged. Overclock remains a visual reference with no
verified source reuse grant; this increment has no visual changes.

### Exact remaining removal set and gates

This is a removal plan, not permission to delete before parity. Recheck all
imports/types/bundle inputs at the removal commit; retain every shared path in
[Dependency and path closure](#dependency-and-path-closure).

| Future removal/change                                                                                                                                                                                                                                                                      | Required parity before execution                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/desktop/src/main.ts`, `preload.ts`, `artifact-sender.ts`                                                                                                                                                                                                                             | Final-package observer/analytics, file save/overwrite/default editor, clipboard, notification routing/identity, tray, close/background/Dock/single-instance, Core/renderer failure, webview security and receipt-backed Quit accepted                                                                                                                                    |
| `apps/desktop/src/managed-agents.ts`, `managed-agents-preload.ts`                                                                                                                                                                                                                          | Structured native opening/transport, focus/consent/revocation, task routing, independent ownership/failure and both native Quit gates accepted; shared `managed-agents-{host,core,wire,client,document}.ts` stay                                                                                                                                                         |
| `apps/desktop/src/managed-terminal.ts`, `terminal-preload.ts`, `terminal-panels.ts`, `terminal-runtime.ts`, `terminal-sender.ts`, `terminal-confirmation.ts`, `terminal-lifecycle.ts`, `terminal-lab.ts`                                                                                   | Native exact source/document/focus, signed Open/start/output/input, paste, blur/reload, resize/hide/restore, N-pane layout, independent failure, stop/terminate and owned-exit receipts accepted; retained adapter QA must have equivalent Tauri coverage                                                                                                                |
| The 22 retained cases in the seven original adapter test files                                                                                                                                                                                                                             | Port each adapter-specific assertion to equivalent native/adapter coverage first; retain all 48 neutral cases and the shared broker fixture                                                                                                                                                                                                                              |
| Electron source/preload/package assertions in `tests/desktop-qa.test.ts`                                                                                                                                                                                                                   | Equivalent native security/package tests accepted, then replace only those assertions. Its pure policy cases stay. `desktop-artifacts-qa.test.ts`, `desktop-export-qa.test.ts` and `mention-routing.test.ts` already use shared neutral imports at this base and stay                                                                                                    |
| `scripts/smoke-desktop.ts`; `scripts/accept-desktop-stdio.ts`; `scripts/accept-managed-terminal.ts`; `scripts/accept-terminal-{native,pair,cycles,gestures,creation,selection,team}.ts`                                                                                                    | Same smoke, private stdio, PTY/native consent, pair, lifecycle cycles, gestures, creation, selection and team scenarios covered and accepted on the final supported Tauri package, including uncertainty/receipt paths                                                                                                                                                   |
| Root scripts `desktop`, `dev:desktop`, `build:desktop`, `test:desktop`, `accept:managed-terminal`, `accept:terminal-native`, `accept:terminal-pair`, `accept:terminal-cycles`, `accept:terminal-gestures`, `accept:terminal-creation`, `accept:terminal-selection`, `accept:terminal-team` | Their exact launchers above retired only after equivalent native scenarios pass. Keep `accept:terminal-pty`, `accept:terminal-reuse`, `accept:managed-agents`, setup/discovery, Playwright and Tauri commands                                                                                                                                                            |
| `scripts/build-desktop.mjs`; root `build` tail `&& pnpm build:desktop`; desktop package `main: dist/main.cjs`                                                                                                                                                                              | Shared resource/type closure rechecked; all shared outputs have neutral consumers; Node/browser builds and final Tauri staging/package verified without Electron. Do not make root build unconditionally run Cargo                                                                                                                                                       |
| `apps/desktop/package.json` `devDependencies.electron` (`45.2.1`) and pnpm orphaned lock closure                                                                                                                                                                                           | All preceding adapter/QA/build consumers closed and final native parity accepted. Remove via pnpm only; retain the workspace and protocol/xterm/i18next/zod/shared dependencies; never remove transitives by name                                                                                                                                                        |
| `.github/workflows/ci.yml` transitive Electron install/build/type/test dependency                                                                                                                                                                                                          | There is no standalone Electron-only CI step to delete at this base. Keep frozen install, lint, typecheck, test, build, Chromium installation and browser tests; after the preceding changes prove this lane resolves/builds/runs without Electron. Add a separately scoped supported-target native lane with packaging/license/signature prerequisites and no providers |

All items above remain open. The native matrix and ordered checklist below retain
their broader P0/P1 acceptance gates, including WebKit persistent/saved grants,
renderer failure, real provider/model/MCP and running-provider Quit. Nothing in
this preparation accepts these behaviors.

### Preparation checks and checklist

Node `24.22.2`, pnpm `10.34.9`; offline frozen install used `--ignore-scripts` and
left the lock unchanged. Baseline lint/typecheck and the seven-file suite passed
(70/70). After extraction and runner changes lint/typecheck passed; the combined
11-file suite passed 70/70, including a separately verified neutral subset of
48/48 (a subset, not 118 distinct tests). AST preservation and denied-Electron
type closure passed. The changed isolated Chromium document test passed 1/1 using
a temporary config with no web server. Its unchanged dashboard opener case was
not run: it requires the built dashboard/server, outside this preparation.
The fixture-only bundle comparison above passed without running hosts.

Intermediate typechecks identified unused moved imports and an inferred union
in the helper's entry map; those were corrected without changing assertions.
The first temporary byte comparator rejected Buffer versus Uint8Array types;
normalizing the comparator to Buffer then verified the actual bytes unchanged.
These intermediate failures are not hidden by the final passing results.

The complete `pnpm test` remains unrun pending coordinator release. Root/native
builds, Cargo, full browser suite, the explicit synthetic PTY/agent/UI acceptance
runners, providers and native app were not run. No native/package acceptance is
claimed. All `dist/` paths, the running consent-scroll app and its resources,
Rust, Quit, MCP implementation and UI source are untouched. Disk checks showed
42 GiB before and 41 GiB after the small disposable build comparison (rounded
filesystem values); its generated resources were removed.

- [x] **2026-11-05 — prepared:** Preserve all 70 mixed-suite cases; move 48 unchanged shared cases into Electron-neutral files and keep 22 adapter cases.
- [x] **2026-11-05 — prepared:** Repoint the four approved Node/Chromium consumers to disposable source builds without Electron or desktop dist inputs.
- [x] **2026-11-05 — verified:** Focused tests, neutral type closure, unchanged bundle bytes, lint and typecheck pass; no native parity is inferred.
- [ ] **2026-11-05 — open:** Complete the exact adapter/QA/build/dependency/CI removal set only after its corresponding parity gates above.
- [ ] **2026-11-05 — open:** Release and run the full suite through the coordinator, then perform the separately authorized native/package/provider acceptance needed for final retirement.

## Current native milestones — 2026-11-05

The [current native record](native-consent-scroll-delivery.md#human-verified-milestones--2026-11-05)
adds human-verified administrative recovery finalization, retirement of the old
owned undispatched selection and normal old-app Quit, plus real Codex
initialization/xterm rendering in the normally opened consent-scroll package.
Its implementation remains `7226686`; the later docs-only HEAD changes no package.
No process/provider exit is inferred from recovery, and old-app Quit does not
accept Quit while a provider is running.

- [x] Complete signed capture/release/finalize, byte-identical marker archive and
      removal of the old recovery controls, as verified by Root.
- [x] Retire the previous selection natively with two prepared attempts; verify
      archive present/active marker absent before human old-app Quit.
- [x] Observe real Codex startup/rendering and use of the new native authorization
      source in the exact normally opened consent-scroll package.
- [ ] Accept complete authorization geometry across target viewports.
- [x] Accept later manual native keyboard activation, human message sending and
      actual Codex CLI replies in Tauri; the displayed model is self-description.
- [x] Accept user/Root-confirmed OpenCode native initialization, manual keyboard
      authorization, human message sending and a real CLI reply. Codex and OpenCode
      are now verified individually; displayed provider/model labels remain TUI claims.
- [ ] Resolve automatic composed Open/input parity, Feature sidebar refusal and
      disabled Feature **+ Terminal** (dashboard opening works), earlier OpenCode
      plugin failure and Codex warning; causes remain unverified.
- [ ] Verify effective backend models, coexistence/retained IDs, real mixed MCP
      communication, running-provider Quit/Stop/owned exit, retirement after dispatch
      and remaining native parity. Manual input does not accept automatic Open or
      keyboard revocation; slot B alone does not prove coexistence.
- [ ] Retire Electron only after the ordered parity/removal gates below are met.

These milestones narrow earlier pending statements for this package and these
specific workflows only; historical package results and other uncertain evidence
remain scoped to their original deliveries. Keep the currently open app/Core/provider intact.

## Shared document URL boundary — 2026-11-04

The existing pure `apps/desktop/src/terminal-policy.ts` now owns
`terminalDocumentURL`. `terminal-sender.ts` imports and re-exports that same binding
for existing Electron consumers. The reserved URL and sender guard are unchanged;
the guard function is byte-identical to baseline `b54b7feda15a797e3612c96e9c0fd5896c3732dc`.
No new helper, package or dependency is needed.

The baseline had two active type-resolution paths, both under `apps/desktop/src/`:

- `tauri-terminal-host.ts` → `terminal-document.ts` → `terminal-policy.ts` →
  `terminal-sender.ts` → Electron types.
- `tauri-agents-host.ts` → `managed-agents-document.ts` → `terminal-policy.ts` →
  `terminal-sender.ts` → Electron types.

Read-only TypeScript 6 module resolution traversed the 17 TypeScript entrypoints
in `scripts/build-tauri-resources.mjs` plus `apps/dashboard/src/main.tsx`, following
imports, exports, type references and literal dynamic imports/requires through
local/workspace source. Its closure decreased from 180 to 179 source files; the
sender was the only reached Electron-typed file and is now outside that closure.
The three CSS imports use the existing Vite ambient declaration. A compiler-host
check with Electron module resolution explicitly denied and that declaration
included reproduced baseline TS2307 in the sender, then passed with zero Electron
resolution attempts after the change. This is source/type evidence, not a bundle
or runtime acceptance claim.

Reuse review retained the existing ORQST policy/guard. At the inspected Anywh pin,
[`platform/tauri.ts::inTauri`](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/client/src/lib/platform/tauri.ts)
only detects a browser global; it has no document/session/generation/focus contract.
Tucano's [`main/index.ts::core:connect`](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/src/main/index.ts)
and [`preload/index.ts`](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/src/preload/index.ts)
depend on Electron MessagePort/IPC, not a reusable pure reserved-document helper.
Decision: **keep existing ORQST**, without importing either bridge or its authority
model. Both exact trees retain Apache-2.0 root LICENSE and no tracked NOTICE/COPYING;
no upstream code, assets or dependencies are incorporated.

Node 24.22.2/pnpm 10.34.9 checks: `pnpm typecheck`, `pnpm lint`, `git diff --check`
and 10 existing pure Node cases passed. The focused cases are all of
`terminal-document.test.ts` and `desktop-policy.test.ts`, only `dedicated sender
denies` / `terminal network policy` in the mixed broker/runtime files, and only
`native communication document` in `mention-routing.test.ts`. No Core, provider,
PTY, native app, session or acceptance fixture was started. Full tests/build,
Cargo/resources/package and native/provider acceptance were not run.

Integration on published main `5aba121c1502b7cc738ddc77caeed6e574a4975e`
retained candidate `82ead4cfccb4e498ecf01b556da84106b1a0c5f2` code byte for byte.
The three documentation conflicts were resolved additively, preserving delivery
723's package evidence. On this integrated source, the same 10 selected pure
cases (7 + 2 + 1), full workspace typecheck and ESLint/Prettier passed again;
diff checks passed. Temporary inspection scripts were adapted only for main's
path and published baseline: the 18 entries still traverse 180 files before and
179 after, with one denied Electron resolution/TS2307 before and zero attempts
or diagnostics after. The sender guard is byte-identical to published main.
These are this integration's source/pure results. The earlier 20 Node cases,
59 Rust tests per configuration and package 723 remain separate historical
checks; none were rerun or added to these totals. No build, resource staging,
package, install, runtime, provider, Core/PTY, auth database or native acceptance
was run. Existing Preview app trees were not modified; they do not contain this
source-only increment. The delivery tag is
`delivery/2026-11-04-shared-electron-types-integration`.

Electron adapters, their typed tests, the dependency/lock closure and build/test
scripts remain. The whole workspace still requires Electron types. All removal,
parity, distribution and runtime acceptance gates below remain open.

## Policy and notification integration — 2026-11-04

The [combined source report](tauri-policy-notifications-integration.md) records
the ordered Codex documentation, webview policy and notification deliveries,
the separate native-origin hook, 20 combined pure Node tests and explicit build
and acceptance gates. The Codex historical cause remains unknown. The owner's
existing `dist/native-preview-mcp-unavailable/ORQST Preview.app` is preserved;
the only newly authorized package destination is `dist/native-preview-policy-notifications/`.
That destination now contains the local app and generated manifest from published
freeze `b54b7fe`: the same 59 Rust tests passed in each mode, with Clippy, filtered
dashboard/resources/native build/bundle and final integrity/signature checks green.
All six earlier app trees are unchanged. This package has not been started;
actual OS/WebKit/provider behavior and Electron removal remain unaccepted.

## Webview policy hardening — 2026-11-04

The [pinned Tauri 2.12.5/Wry 0.57.1 review](../research/tauri-webview-policy.md)
confirmed a media-permission default difference, platform download defaults and
broader dashboard document paths. Source now uses supported permission/download
denial callbacks and existing SPA route semantics. Exact unavailable/custom
documents, CSP, capabilities/focus and native save/open/export remain intact.
[Pure checks and native/platform gaps](tauri-webview-policy.md) keep the matrix's
security acceptance and Electron removal gates open.

Open gaps: default Tauri data-store persistence differs from Electron's
non-persistent sessions; saved grants can bypass callbacks; macOS geolocation,
browser notifications and clipboard-read have no Wry backend callback. Deny
callbacks alone are not integral parity or native acceptance of these cases.

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

The [shared document URL split](#shared-document-url-boundary--2026-11-04) removes
the concrete `terminal-policy.ts` → Electron-typed `terminal-sender.ts` edge for
both Tauri documents. Electron sender guards and their legacy URL export remain
until their adapter is retired. Tree shaking alone is not type-resolution evidence.

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

- [x] Split the shared pure document URL from the Electron sender module; preserve
      the legacy export and exact sender/URL authority checks.
- [ ] Remove only Electron adapters
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
