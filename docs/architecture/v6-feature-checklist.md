# V6 feature delivery checklist — 2026-11-04

## Combined policy and notification source — 2026-11-04

- [x] Integrate the documentation-only Codex review, webview hardening and
      notification route in order, retaining the origin hook in its own commit.
- [x] Review native origin/URI/SPA/download/permission boundaries and fresh
      source-backed notification selection through the existing draft guard;
      pass 20 distinct combined pure Node tests, lint/types/format/rustfmt/diff.
- [x] Complete serial native compilation from published freeze `b54b7fe`: the same
      59 Rust tests pass in each configuration, Clippy and filtered dashboard/
      resources/native build/bundle pass, 114 resources and Node/signatures match;
      preserve all five prior Preview apps and Coexistence 698. New app not started.
- [ ] Accept actual OS/WebKit/provider/communication/Quit behavior and resolve
      persistence/grant/unsupported-callback parity limits before removing Electron.

See the [integration and build gates](../development/tauri-policy-notifications-integration.md).

## Webview policy hardening — 2026-11-04

- [x] Compare locked Tauri/Wry permission/download defaults with Electron source;
      implement supported callback denial and matching dashboard document routes.
- [x] Preserve exact custom documents/CSP, focus/capabilities and native file flows;
      pass four standalone pure Rust path/encoding tests.
- [ ] Run coordinated native compilation/URL tests and accept effective permission,
      download, clipboard, SPA/unavailable and file/export behavior per platform.
      Saved browser decisions and unsupported callbacks remain explicit limits.
- [ ] Resolve/accept the default Tauri data store versus Electron non-persistent
      sessions, persisted grants bypassing callbacks, and missing macOS geo/
      browser-notification/clipboard-read callbacks before claiming full parity.

See [source evidence](../research/tauri-webview-policy.md) and
[validation scope](../development/tauri-webview-policy.md). Electron retirement remains open.

## Tauri notification routing source — 2026-11-04

Source-backed private identities now route native notification taps through a
fresh authenticated snapshot and the existing dashboard draft guard. Numeric OS
IDs map only in RAM; stale/revoked/invalid targets fail closed. See the
[implementation, source review and native limits](../development/tauri-notification-route.md).
Pure checks do not accept native click delivery, packaging or Electron retirement.

## Core availability and explicit MCP pair integration — 2026-11-04

Integrated deliveries `90509ca` (Core unavailable) and `8c458de` (explicit
Codex/OpenCode pair), preserving additive EN/PT namespaces and existing tests.
The static unavailable document has no script, IPC, network or retry controls;
observer loss latches without releasing uncertain owned handles or stopping
managed hosts. Normal Open keeps MCP disabled. The unchecked pair option reviews
both catalog models, exact source/worker identities and every native page in the
same workspace; operational Open and the one-use task grant remain separate.
No new runtime, process adoption, permission expansion or Feature Delegate.

See [Core availability](../development/tauri-core-unavailable.md),
[pair workflow/security](../development/tauri-mcp-product-pair.md) and
[combined validation and package boundary](../development/tauri-mcp-unavailable-integration.md).
Real providers, effective models, native WebKit/MCP/Quit and Electron retirement
remain pending. The new local package is built only from published frozen source;
its generated manifest records actual Rust/build/signature/resource checks.

Authority: the [approved V6 package](../design/v6/README.md). This extends the
[migration tracker](master-spec-tracker.md), preserving earlier evidence.
Unchecked acceptance items remain incomplete even when a subset is implemented.
Update this file in every V6 delivery with implementation and verification.

## Current native package and Electron retirement — 2026-11-04

- [x] Package combined source `9e562fa` after the completed build: 40 Rust tests
      in each mode (same 40), Clippy, dashboard/resources/native build/bundle,
      112 configured resources, Node integrity and final deep/strict signature.
- [x] Complete the read-only retirement inventory and publish the
      [parity/responsibility matrix, dependency paths and ordered gates](../development/electron-retirement.md).
      Preserve four older apps; new package was not started. Earlier 52 focused
      Node/lint/type/format/rustfmt checks were not rerun by the build.
- [ ] Accept actual Codex/OpenCode opening and effective provider/model/variant;
      historical Codex cause remains unknown. Older apps do not auto-update.
- [ ] Deliver real task/result communication: normal preparation is `mcp:false`,
      interactive MCP requires two opted-in members plus a task grant, enrollment
      rejects MCP and Feature Delegate is disabled. Two CLIs are not acceptance.
- [ ] Complete native Quit/security and shell parity, then selectively remove
      Electron runtime/dependencies/scripts and port tests/CI without deleting
      shared hosts/xterm/savers/styles/icons under `apps/desktop`.

Full V6 requirements remain open as listed below. This package/inventory does not
accept provider operation, managed recovery, arbitrary teams or final native UI.
The earlier capability inventory is a pre-implementation snapshot, not current status.

## Combined preparation source integration — 2026-11-04

- [x] Integrate Codex diagnostic source `dc92dd9` with OpenCode source `2db2ed0`
      (already integrated as `7253c90`), retaining both documentation histories.
- [x] Preserve strict helper → Rust → Studio failures, native commit/open latches,
      focus/grants and unknown `possible` outcomes without automatic retry.
- [x] Adapt the OpenCode executable-drift regression to typed revalidation failure;
      changed bytes/removal must leave zero commit calls and no terminal files.
- [x] Pass 52 distinct focused tests (combined 50 plus two pure OpenCode profile
      cases), without repeating the shared selected-preparation file.
- [x] Compile/package the combined native source in the subsequent coordinated build;
      see the current package record above. The source integration itself ran rustfmt only.
- [ ] Accept selected providers/native workflow in that exact package; older apps remain unchanged.

See [combined checks and boundaries](../development/terminal-preparation-diagnostics.md#combined-source-integration--2026-11-04).

## OpenCode catalogue correction — 2026-11-04

- [x] Distinguish canonical installation copies from different reviewed native
      implementations; retain exact binary review and existing PATH precedence.
- [x] Cover equivalent OpenCode copies, default/configured model environment, unsafe files
      and review drift through synthetic preparation/profile tests without a provider.
- [x] Retain full OpenCode TUI with per-process V2 model defaults, MCP composition
      and provider/model/variant grammar checks; native precedence is preserved.
- [ ] Enforce exact effective model/variant automatically; native configuration
      supplies a default and may defer to agents/preferences or fall back.
- [ ] Validate this correction in native WebKit and a separately authorized provider
      run; the owner's current Preview and uncertain preparation state are preserved.
- [ ] Implement an explicitly reviewed dynamic OpenCode catalogue; configured IDs
      and default selection still provide no entitlement evidence.

See [the pinned source review and reuse decisions](../research/opencode-executable-equivalence.md).

## Capability inventory before V6 implementation

| Capability                              | Current status and implementation                                                             | Remaining work                                                                                       |
| --------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Tauri 2 / React / Node 24 Core / SQLite | Implemented preview; `apps/tauri`, `packages/core`, `packages/database`                       | Complete native/provider parity before removing Electron                                             |
| Interactive terminal panes              | Partial; retained 1–8 PTY documents, `tauri-terminal-layout.ts`, `terminal-document.ts`       | Feature ownership, live membership, arbitrary supported mixed selections, verified models            |
| Stable terminal identity                | Partial; manifest UUID and optional structured `terminalId`                                   | Feature membership and stable workspace display IDs across creation/restart                          |
| Durable layout                          | Partial; `terminal-layouts.ts`, private Core RPC, preserved JSON import                       | Per-Feature docked/floating layout and active context                                                |
| Features                                | Missing on integrated main                                                                    | Additive persisted entity, CRUD, configuration duplication, active-process archive/removal policy    |
| Handles, roles and permissions          | Partial; existing two-member communication metadata and native review                         | Feature scope, SQLite configuration, repeated aliases across Features, cross-scope grants            |
| Structured communication / PTY MCP      | Partial; durable queue, explicit grants and synthetic returns                                 | N-member composition, Feature binding, real CLI return and recovery acceptance                       |
| V6 visual Studio                        | Approved reference preserved/inspected; runtime still has earlier preparation/terminal chrome | Compact hierarchy/sidebar/breadcrumb, dense docked/floating surface, menus, individual configuration |
| Context switching                       | Hide preserves retained documents/processes within a selection                                | Workspace/Feature switching with independent layout and no process recreation                        |
| Metrics and communication motion        | Existing observed metrics; no V6 Feature filter                                               | Scope by Feature; animate actual Core events; unknown usage stays unavailable                        |
| Native acceptance                       | Blocked; diagnostics improved                                                                 | Explain `cgWindowNotFound`, verify focus after consent, actual WebKit/input/dialog/lifecycle flow    |
| Real provider communication             | Blocked by preserved quarantine and outstanding native reviews                                | Explicit capacity decision and verified Codex↔OpenCode task/result                                   |

## Integrated foundation and chrome — 2026-11-04

Sources `3a3d250` / `dd2cbfd` (Core) and `ba848ba` (chrome) are integrated as
`452d4b0` / `e352d26` / `c2f7bfc`. The inventory above records the pre-V6 baseline;
the following list records this increment, separately from end-to-end acceptance.

- [x] Persist Feature UUID/name/description/status/revision, exclusive terminal
      assignments and bounded validated metadata audit using the existing Store.
- [x] Persist team proposals and layouts under Feature scope; preserve unassigned
      legacy data and never restore grants or processes from configuration.
- [x] Enforce Feature-local aliases and guards at grant/admission/dispatch/result
      boundaries. Qualified and cross-Feature traffic is currently denied.
- [x] Exercise six reviewed terminal configurations through real private Core IPC
      with no agent launch or execution reservation.
- [x] Deliver compact 31px chrome, pane menu, retained xterm, lifecycle, localized
      controls, visible refusals and minimize/maximize/restore.

See [Core contracts and limits](../development/v6-feature-core.md) and
[chrome behavior and limits](../development/v6-terminal-chrome.md).
The native facade, Feature UI, runtime enrollment/switching, authorized cross-Feature
traffic and Floating layout remain incomplete. The native structured composition
still has two Codex members; metadata for eight members does not prove N-member
execution. The actual UI/sidebar remains a next integration step.

The integrated run passed 710 Node tests, lint, typecheck, build, Tauri resource
staging, EN/PT Chromium renderer acceptance and eight synthetic packaged PTYs.
The latter includes layout, resize, signed operations, revocation and retirement
with simulated native focus/dialogs. It establishes no real provider/native UI
acceptance. Electron pair/team runners were adapted to menu navigation but were
not run during concurrent native focus investigation.

## Required end-to-end acceptance

- [ ] Create a Workspace and Feature through the actual UI without external JSON.
- [ ] Persist Feature ID, name, description, status and validated optional worktree.
- [ ] Create, rename and duplicate configuration without duplicating sessions/history.
- [ ] Support Autenticação (3 terminals), Dashboard (2) and Banco de dados (1) as
      test data only, with independent saved layouts.
- [ ] Switch Workspace/Feature repeatedly; prove unchanged owned process identities
      and no duplicate CLI starts while work and messages continue in Core.
- [ ] Resolve `@backend` independently in two Features; deny accidental cross-scope
      access and audit explicitly authorized exact destinations.
- [ ] Create mixed supported CLIs with per-terminal verified model selection;
      reject unavailable models without substitution.
- [ ] Match the docked/floating UI; drag, resize, minimize, maximize, restore and
      distinguish visual close from process termination.
- [ ] Archive/remove with active work using explicit choices; preserve other
      Features and all native CLI history.
- [ ] Delegate through the existing queue/MCP; prove provider acceptance, task
      execution and correlated return separately with real CLIs.
- [ ] Validate crash/reconnect/unknown outcome without replaying uncertain effects.
- [ ] Confirm keyboard operation, reduced motion, both locales and laptop geometry.
- [ ] Update README, ROADMAP, CHANGELOG, API/data/security/design docs, tests and
      this checklist for each increment.
- [ ] Complete platform/native acceptance before retiring Electron.

## Evidence for this intake

All five Markdown files and the HTML were read. Hashes were recorded and the
prototype rendered at 1440×900 for visual inspection; its four panes are simulated.
No V6 runtime or real-provider acceptance is claimed by this intake. Existing
Node/Core/PTY/SQLite and pinned Anywh/Tucano code were inspected; decisions are in
the [reuse review](../research/v6-feature-foundation.md).

## Native consent increment — 2026-11-04

- [x] Demonstrate own-sheet generation revocation with an explicit native affirmative
      result; preserve the exact WKWebView/source/selection proof in the correction.
- [x] Test cancellation, real revocation with return, expiration and input suspension
      without renewal against the existing signed broker.
- [x] Observe native synthetic start, attach, input/PONG, real PTY resize, hide/restore,
      retained output and signed stop in the isolated coexistence fixture.
- [x] Observe both native Quit cancellations, first-gate re-presentation and denial
      of a late affirmative after another owned key window, in the isolated final fixture.
- [ ] Observe real NSApp deactivation and final both-affirmative shutdown on that
      final artifact; its runner deadline expired before the human deactivation step.
- [ ] Revalidate the integrated V6 artifact and real providers; native fixture evidence
      on the prior baseline does not accept Workspace/Feature workflows.

See [the exact native evidence boundaries](../development/tauri-native-coexistence.md).

Integration over V6 `d79745f` retained both sets of changes. A native focus sample
is additionally bound to its captured attempt and parent before updating Quit
presentation. Integrated checks passed: 717 Node tests, 29 focused broker/service
tests, 18 Rust tests, lint/typecheck/build, Clippy and native executable compilation.
No new native UI, packaged or real-provider acceptance is claimed. The unchecked
items above remain open; Feature UI hooks are the next isolated integration.

## Integrated Feature UI and native facade — 2026-11-04

Sources through `7a939df` are integrated through `d7816c2`, superseding the earlier
"next integration" status above. Code delivery and complete acceptance are separate.

- [x] Connect actual React Feature metadata CRUD, reviewed-slot assignment and
      selection to Core SQLite, CAS and per-Feature retained docked layout.
- [x] Authenticate the actual native Webview; derive source/document/UUID and native
      epoch without renderer-controlled execution fields.
- [x] Validate complete layouts before changing visibility/geometry; preserve
      empty-Feature chrome and dashboard/navigation/close/Quit presentation fences.
- [x] Revalidate context after the final focus await and retain UUID-owned metadata
      exclusion through success/error/timeout/cancellation, without a mutex across await.
- [x] Implement the editor-version fix and separate signed cleanup/deadline correction.
- [ ] Complete EN/PT and screenshot acceptance on those corrections. The earlier EN
      run preserved IDs/documents/scrollback and six Starts over 15 switches 3/2/1,
      then failed while reopening the editor. PT was not executed.
- [ ] Resolve the review/authorization gate for further runs: all six prior receipts
      end at `started`; no exit receipt exists and `active-pair.json` remains. Cleanup
      is uncertain even though the last process snapshot found no matching processes.
- [ ] Finish native WebKit/provider acceptance and the broader V6 items above.

Preserve the original fixture, journals and reservations. No adoption, signalling,
reconciliation, deletion or restart is authorized by this code integration. EN/PT,
new fixtures/Starts and the broad suite remain paused pending specific review.
See [workflow, exact evidence and limits](../development/v6-feature-ui.md).

Integrated checks passed: 53 session-free Node tests, 28 Rust tests, lint,
typecheck, regular/native executable builds, Clippy and resource staging with 17
notices. The broad suite and EN/PT were not rerun. A first Rust check lacked staged
Feature resources; it passed after staging, without changing the check.

## Authorized EN follow-up and editor labels — 2026-11-04

- [x] Run the authorized fresh EN attempt on `dbdf60e`; record its failure on exact
      Status lookup after 15 successful 3/2/1 switches, without retrying or starting PT.
- [x] Confirm that new attempt's six exit receipts, signed retirement, absent active
      reservation and original host exit. Preserve its failure evidence separately.
- [x] Reproduce the label defect without sessions and give the editor button,
      description and Status explicit localized accessible names.
- [x] Pass the actual component's renderer-only EN/PT regression: exact labels and
      three save/rename/reopen cycles per locale. This uses metadata in memory only.
- [ ] Rerun the corrected six-PTY EN under fresh authorization; full PT remains
      conditional on EN success and confirmed cleanup.
- [ ] Resolve the earlier uncertain fixture's missing receipts through its separate
      owner review. Its data/reservation remains preserved; no state is fabricated.

Native WebKit/provider acceptance and the broader V6 gaps remain unchanged.

Label correction checks passed: renderer-only EN/PT, lint, typecheck, regular build
and 17-notice resource staging. The broad suite/native checks were not rerun for
this UI-only change.

## Complete packaged EN/PT acceptance — 2026-11-04

- [x] Pass EN and PT serially on `592ce02`: six synthetic PTYs, 15 switches 3/2/1
      per locale, stable IDs/documents/scrollback and exactly six Starts.
- [x] Exercise editor/status/archive refusal, per-Feature SQLite layout, input
      revocation and explicit fresh input/PONG on every original process.
- [x] Verify wide/compact geometry and restoration of the original visible page,
      with all Feature members retained and without changing runtime paging rules.
- [x] Complete signed stops/retirement and original-host exit before deleting each
      successful fixture. The earlier uncertain fixture is preserved separately.
- [x] Generate and open a locally signed native Preview app for owner inspection.
- [x] Implement the Tauri Studio preparation facade/component over the existing
      native 1–8 Codex/Claude wizard; distinguish capabilities and remove the
      older-Electron/relaunch composition in source. Native execution acceptance
      remains unchecked; the owner's open Preview app is unchanged.
- [ ] Accept the complete native WebKit flow, final Quit and real-provider behavior.

These results supersede the earlier EN/PT pause for this workflow. They do not
resolve the older missing receipts, native acceptance, Floating or N-member/
cross-Feature communication. See the latest [workflow evidence](../development/v6-feature-ui.md).

Final checks passed 54 session-free Node tests, TypeScript, focused ESLint and
formatting. Native packaging reused the existing compiled executable and passed
strict local ad hoc signature verification; this does not accept native execution.

## Full-window Studio correction — 2026-11-04

- [x] Reproduce the nested dashboard/Feature chrome in the owner's open Preview.
- [x] Replace it in source with one full-window Studio shell and one Feature sidebar.
- [x] Move preparation into a dismissible drawer; keep the workspace mounted and
      preserve Overview navigation and keyboard focus restoration.
- [x] Pass three focused Chromium tests, including exact viewport bounds without
      external scrolling at 1440/720/390/320 pixels and EN/PT drawer/navigation.
- [ ] Package and accept this correction in native WebKit. The owner's running
      Preview is preserved and still contains its earlier resources.
- [ ] Complete the separate native Studio preparation bridge and provider acceptance.

## Tauri Studio preparation source — 2026-11-04

- [x] Reuse native menu provisioning/review/opening with strict main-Webview,
      source/document/generation/focus and exact provider/count contracts.
- [x] Keep Electron independent; provide EN/PT component for the Studio drawer,
      with no mixed Tauri preset or automatic Start/login/task/MCP effects.
- [x] Add pure contract/negative/bootstrap and renderer EN/PT checks, preserving
      selection, uncertain writes/admission, own-sheet and existing Quit gates.
- [ ] Accept actual native WebKit preparation/dialogs/providers and final Quit.

See [delivery checks and limits](../development/tauri-studio-preparation.md).
The earlier uncertain fixture remains preserved, without adoption or cleanup.

## Integrated Studio package and native observation — 2026-11-04

- [x] Integrate the Tauri facade/component into the full-window drawer; omit the
      provisional legacy Studio composition and all unsupported mixed-preset UI.
- [x] Pass integrated TypeScript/lint, 26 session-free Node tests, renderer EN/PT
      and three focused App/drawer browser tests, including compact geometry.
- [x] Package the checked native binary and current resources; verify 109 resource
      files and the local signature without modifying the earlier Preview.
- [x] Open the new native Preview and observe the full-window shell, successful
      preparation snapshot, enabled provider/count/prepare controls and drawer close.
- [ ] Complete actual native picker/provisioning/opening, CLI Start/output/input,
      Settings reload → SPA Studio and final Quit acceptance.
- [ ] Accept real providers and communication; preserve all earlier quarantines.

## CLI/model preparation Core integration — 2026-11-04

- [x] Resolve the selected workspace by ID using the native-owned observer database
      read-only, with no observer Store migration or renderer-provided project path.
- [x] Reuse reviewed executable discovery and provisioning without a normal file
      picker; selected models affect Codex/Claude/OpenCode launch profile argv.
- [x] Revalidate model-source digest/expiry and workspace/Feature binding at real
      backend validation boundaries; synthetic drift tests reach zero backend starts.
- [x] Preserve model provenance: fresh visible Codex cache entries, configured IDs,
      versioned Claude aliases and CLI default; availability/entitlement unverified.
- [x] Integrate five Core commits and pass eight focused session-free tests and
      TypeScript on main. The source front also passed 57 focused checks and lint.
- [x] Integrate the native quick-launch UI and real xterm source flow; 54 focused
      tests and TypeScript pass on main. Real xterm with a synthetic facade passes
      EN/PT output, keyboard and partial-attempt continuation.
- [ ] Compile and accept the integrated native quick-launch flow on this machine.
- [ ] Admit another CLI/model into the same running Core without replacing original
      Pair/PTY/documents, relaunching the app or starting a second Core.
- [ ] Accept dynamic OpenCode catalogue, actual native/provider execution and cleanup.

Cargo, resource staging and broad build/test loads remain paused at approximately
3.1GiB free. No native/provider acceptance is inferred from these source checks.

## CLI/model/Open first increment — 2026-11-04

- [x] Normal source path uses current workspace/Feature IDs and the Core catalog;
      Codex, Claude Code and OpenCode model choice sends opaque IDs, never paths.
- [x] Finder is available only through the explicit Advanced manual wizard.
- [x] Operational native Open reuses one broker and three distinct signed grants;
      partial launch retains its attempt identity and never retries Start.
- [x] Pure and renderer-only EN/PT cases cover the shared shell, catalog errors,
      model choice, keyboard/focus, overflow and partial continuation.
- [x] Run the integrated Rust tests (39), Clippy and custom-protocol build serially
      after coordinated disk cleanup; no provider acceptance is implied.
- [ ] Complete native WebKit/dialog/provider/model/packaging acceptance.
- [ ] Add a second independently selected CLI/model to the same live Core/Pair,
      retaining old processes/documents and uncertain admission evidence. Current
      selection remains one-shot per app launch; no second runtime is created.

See [workflow, evidence and pending live enrollment](../development/terminal-product-open.md).

## Private Core enrollment source increment — 2026-11-04

- [x] Append one independent prepared CLI/model slot to the existing Pair using
      durable epoch/opId/CAS reservations and receipts, without rebuilding old slots.
- [x] Cover pure continuity, capacity, idempotency, partial-effect preservation,
      source/context binding and isolated mocked-client timeout/late ACK.
- [x] Integrate the Core commit and pass 77 session-free enrollment/Pair/supervisor/
      broker regressions and TypeScript on main, without creating a Core or PTY.
- [x] Integrate native service/Webview/layout/Feature append in source; see the
      native increment below for its checks.
- [ ] Accept the integrated append with native WebKit and real CLIs.

See the [private contract and remaining limits](../api/terminal-enrollment.md).
This source increment does not mark native/runtime/provider acceptance complete.

## Native incremental enrollment source — 2026-11-04

- [x] Append only confirmed admitted members to the same service and native
      retained workspace, with stable UUID/slot and no old document reload.
- [x] Preserve Feature CAS and previous membership layout under the expanded key.
- [x] Fence late admission ACK, old presentation and incomplete native creation;
      preserve old terminals and uncertain evidence without automatic retry/adoption.
- [x] Pass focused session-free continuity/layout/CAS and EN/PT xterm-facade checks.
- [x] Integrate all three native/desktop commits on main; 46 focused cases,
      TypeScript, Studio and actual-xterm synthetic-facade EN/PT checks pass.
- [x] Compile/test Rust (39 cases), Clippy with warnings denied, custom-protocol
      build, dashboard/resources and local app bundle with strict deep signature
      verification. Recheck 111 packaged resources and preserve earlier binaries.
- [ ] Accept actual native terminal opening, providers/models, cleanup and
      communication. The native Codex opening refusal remains unresolved;
      OpenCode discovery/model-default fixes are in source and still require
      packaged acceptance. No end-to-end acceptance is claimed.

See [exact checks and remaining limits](../development/terminal-native-enrollment.md).

The native source follow-up also cancels expired queued UI creation and advances
the existing presentation fence on creation/presentation failure. Pure Rust source
cases cover callback cancellation and late layout refusal; only rustfmt parsing
and diff validation initially ran for this follow-up. The subsequent integrated
39-case Rust run executed these regressions successfully.

## Bounded preparation failures and normal picker — 2026-11-04

- [x] Preserve typed stage/code/effects from passive helper through native IPC;
      validate exact allowlists and keep post-commit/unknown outcomes uncertain.
- [x] Keep CLI → model → Open primary, remove the duplicate visible title, move
      technical detail into Advanced, and preserve relevant EN/PT warnings.
- [x] Cover synthetic review drift with zero commit calls and no terminal files;
      focused selection/IPC 12/12, passive preparation 23/23 and static EN/PT 1/1.
- [ ] Compile/package and accept native opening of the actual selected Codex model.

Historical cause and mutable global catalog drift remain distinct: drift is a
regression scenario, not a historical diagnosis. No Preview/runtime/provider
operation was performed. See [implementation limits](../development/terminal-preparation-diagnostics.md).
