# Master specification delivery tracker

The [approved V6 package](../design/v6/README.md) now supersedes earlier UI/functional
requirements where changed. Track Workspace → Feature → TerminalPane → AgentSession
in the [V6 capability matrix and checklist](v6-feature-checklist.md). Existing rows
below preserve their original scope and evidence; they do not establish V6 acceptance.

**Tracking date:** 2026-11-04. Initial baseline: `ee08ecb`; subsequent deliveries and
their evidence are recorded below. This is the entry point for tracking the owner's
Tauri, Node Core and multi-agent terminal specification. It is not a release approval.

The owner-supplied `ORQST_MASTER_SPEC_TAURI_REUSE_UI.md` is currently local and
excluded from Git. Its section 10 has 16 acceptance criteria; the numbered rows below
map to them in order so this tracker remains navigable in a checkout without that
file. The owner should decide separately whether the original specification should
be versioned. Do not silently replace or edit the original.

## How to maintain this tracker

For each delivery, update the relevant row, its evidence link and the dated log in
the same change. Record the actual command and outcome in the relevant detailed
development document; link it here. Keep prior failed or uncertain runs visible.
Review the ten scenarios below as well as the 16 criteria. If a capability crosses
Electron and Tauri, identify the platform and workflow for every claim.

After its applicable checks pass, commit each integrated delivery and push it to the
configured Git remote, including an annotated, unique `delivery/YYYY-MM-DD-<scope>`
tag identifying that delivery. Check the branch, remote and existing tags before
publishing; do not force-push or overwrite a tag. A delivery tag is not a release
or evidence of completion. Do not tag or announce version 1.0 before all release
criteria and owner acceptance are complete. Report any check or push that fails.

Temporary agent worktrees may be used for parallel work. At the end of each delivery,
verify that its work is integrated, committed and pushed and that it contains no
unpreserved changes; then remove its worktree and disposable build artifacts with
Git's worktree removal. Keep active worktrees, private runtime state, quarantines,
user data and evidence that still needs preservation. Record any cleanup blocker.

- **Not started**: no relevant implementation is established.
- **Partial**: some code or coverage exists, but the full criterion is not met.
- **Blocked**: a concrete dependency or decision prevents the next step; describe it.
- **Accepted**: the whole criterion has named, reproducible evidence including any
  required real-provider or human acceptance. Code or a synthetic test alone is
  insufficient when the criterion requires a real workflow.

Do not mark a requirement accepted by inference, or equate an observed provider
process, a test double or a generated configuration with a completed real task.
Links to older records preserve their original dates and scope.

## Acceptance criteria

| #   | Required outcome                                                    | Status and current evidence                                                                                                                                                                                                                                | Remaining work                                                                                                                                                                                                  |
| --- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Tauri 2 starts the Node Core without Electron                       | **Partial** — a macOS Apple Silicon debug preview was built and opened; see [Tauri acceptance](../development/tauri.md#acceptance-and-remaining-work).                                                                                                     | Complete packaged, lifecycle, recovery and platform acceptance.                                                                                                                                                 |
| 2   | Preserve ORQST identity and reusable UI                             | **Partial** — shared dashboard and 1–8-pane Tauri workspace are implemented; [workspace evidence](../development/tauri-terminal-workspace.md).                                                                                                             | Complete native visual, accessibility and full migration acceptance.                                                                                                                                            |
| 3   | Create Codex and Claude from UI without mandatory external setup    | **Partial** — Tauri prepares Codex/Claude through native menus using the existing provisioner and review. See [native preparation](../development/tauri.md#native-terminal-preparation--2026-11-04).                                                       | Validate complete native creation and operation with both real CLIs.                                                                                                                                            |
| 4   | Add third and fourth agents without fixed A/B logic                 | **Partial** — Tauri can prepare 1–8 same-provider Codex/Claude terminals and displays a retained workspace.                                                                                                                                                | Validate independent real 3/4-agent creation and mixed-provider teams; remove fixed communication pair limitation.                                                                                              |
| 5   | Hide a pane without stopping its session; stop only on request      | **Partial** — retained Tauri workspace implements hide/show and separate stop; [workspace evidence](../development/tauri-terminal-workspace.md).                                                                                                           | Complete real native lifecycle and close/hide confirmation acceptance.                                                                                                                                          |
| 6   | Maximize, resize and move panes without losing input/output         | **Partial** — Tauri implements retained grid, resize, names and reorder; synthetic and visual smoke evidence is in [workspace](../development/tauri-terminal-workspace.md).                                                                                | Validate full real PTY input/output, focus, scrollback, accessibility and native consent.                                                                                                                       |
| 7   | Rename panes and mention stable unique handles with autocomplete    | **Partial** — Tauri has a retained PTY workspace and a separate, opt-in two-Codex structured client with names, handles and autocomplete. See [structured agents](../development/tauri.md#structured-agent-communication--2026-11-04).                     | Unify terminal identities and mentions in the Tauri multi-agent workflow; validate real delivery.                                                                                                               |
| 8   | Assign/change orchestrator and edit communication permissions in UI | **Partial** — roles and directed permissions are available in the separate opt-in two-Codex Tauri structured client.                                                                                                                                       | Integrate roles and permissions with arbitrary supported terminals/teams; validate native authorization and real providers.                                                                                     |
| 9   | Real directed mention delivery and verifiable return                | **Blocked** — Tauri structured communication has synthetic tests only; the real Codex attempt lost ownership before readiness. See [reconciliation](../development/codex-two-agent-acceptance.md#reconciling-the-blocked-attempt-before-another-real-run). | Decide quarantine/capacity policy; complete native reviews and real provider acceptance. PTY MCP consent is [implemented](../development/tauri-interactive-mcp.md); native/provider acceptance remains pending. |
| 10  | Message states represent real events                                | **Partial** — existing managed communication distinguishes acceptance, execution, result and unknown outcomes; see [mention research](../research/mention-communication.md).                                                                               | Demonstrate correct evidence and failure/unknown states end to end with real providers, including mixed pairs.                                                                                                  |
| 11  | Claude startup failure does not block Codex or a new terminal       | **Partial** — synthetic tests cover preparation cancellation/drift and preserve existing runtimes.                                                                                                                                                         | Prove independent failure and retry with real CLIs in Tauri.                                                                                                                                                    |
| 12  | Recovery/reconnect avoids duplicate processes                       | **Partial** — journals fence uncertain ownership; persisted Electron layouts do not reconnect processes. See [recovery](../development/cli-team-recovery.md).                                                                                              | Implement and validate scoped reconnect/recovery with real owned process evidence; do not reset uncertain reservations.                                                                                         |
| 13  | Layout, teams and settings persist in SQLite                        | **Partial** — Electron and Tauri layouts use [private SQLite with preserved JSON import](../development/terminal-layout-sqlite.md); execution metadata remains in existing journals.                                                                       | Connect persisted Feature/team proposals to native editing/enrollment and validate restart/settings; restoration grants no ownership.                                                                           |
| 14  | Protect local Core and minimize desktop permissions                 | **Partial** — loopback/authentication and constrained Tauri terminal IPC are documented in the [security model](security-model.md) and [Tauri guide](../development/tauri.md).                                                                             | Complete security review and native/packaged acceptance of the final composition.                                                                                                                               |
| 15  | Identify reused third-party code and honor licenses                 | **Partial** — source pins, adaptations and notices are recorded in [reuse audit](../research/reuse-first-audit.md), [Tauri reuse](../research/tauri-core-reuse.md), [mentions](../research/mention-communication.md) and root `NOTICE`.                    | Complete the transitive redistribution and platform-specific notice audit before distribution.                                                                                                                  |
| 16  | Document automated tests and manual real-CLI tests                  | **Partial** — synthetic, build and limited native evidence exists.                                                                                                                                                                                         | Complete and document genuine human/native tests with real Codex, Claude and OpenCode, including communication and failures.                                                                                    |

## Required scenario checklist

These scenarios are **not accepted** unless linked evidence proves the complete
described workflow. A partial synthetic test does not check the box.

- [ ] Create Codex, Claude and OpenCode; switch focus and maximize Claude while Codex continues.
- [ ] Rename a terminal, mention its handle, and verify real acceptance and result.
- [ ] Assign Codex as orchestrator, delegate to Claude, and verify return and event trail.
- [ ] Fail Claude startup, correct the CLI and retry the affected pane without restarting.
- [ ] Abruptly stop the Core, reconnect and recover sessions without duplicate processes.
- [ ] Hide a running pane, restore it and verify scrollback.
- [ ] Restart the app and verify recoverable sessions, layouts, handles and permissions.
- [ ] Exercise A → B → A loop prevention, TTL/hop limits and cancellation.
- [ ] Verify narrow windows, keyboard navigation and reduced motion with human acceptance.
- [ ] Test and document packaging on macOS, Windows and Linux.

## Cross-cutting blockers and decisions

- **Real provider acceptance:** the prior structured Codex run has an
  `ownership_lost` reservation without an authentic exit receipt. Preserve it and
  follow the [reconciliation record](../development/codex-two-agent-acceptance.md#reconciling-the-blocked-attempt-before-another-real-run).
  Do not remove or silently bypass its capacity. The owner must decide an explicit
  quarantine/capacity policy. The immutable
  [capacity inspector](../development/codex-quarantine-capacity.md) reports retained
  reservations without releasing them. A real mixed test additionally needs the native
  per-provider startup/effects reviews and the separate task grant. OpenCode native
  database/activity effects and descendant retirement are documented in the
  [mixed pair workflow](../development/codex-opencode-pair.md).
- **Tauri parity:** prepared PTYs now share a retained workspace; creation,
  interactive PTY MCP, retirement/reselection, exports, notifications and
  full native lifecycle are not yet accepted. See [Tauri limits](../development/tauri.md).
- **Instruction precedence resolved by V6:** the owner's later explicit V6 direction
  authorizes compatible licensed reuse and managed owned-agent execution. The default
  observer remains read-only and cannot control external sessions. Existing notices,
  source-specific license checks, exact grants and private runtime boundaries remain
  mandatory; this does not authorize arbitrary adoption or quarantine reclamation.
- **Distribution:** macOS Intel, Windows and Linux, signed/notarized installers,
  PTY dependencies and the complete transitive license/notice review remain open.

## Native window and capacity diagnostics — 2026-11-04

Integrated source commits `7d33f46`, `9d2e2c9`, `8a00259` and `2833715` from pane-695.
The developer runner records bounded WindowServer metadata for its owned PID in
`window.json`; it captures no pixels or titles and grants no automation authority.
Absent, offscreen or uninspectable windows fail the run. Exit is subscribed before
the window wait so an early process exit cannot be missed. See
[native coexistence](../development/tauri-native-coexistence.md).

The capacity inspector opens a selected journal immutably and refuses pending WAL
frames. It reads allowlisted metadata and never takes ownership or releases
capacity. The contributor confirmed one preserved `ownership_lost` reservation,
without exit evidence or a lifecycle receipt; it consumes the configured per-project
slot. Options and the outstanding owner decision are in
[quarantine and capacity](../development/codex-quarantine-capacity.md).

The contributor reports an AppKit metadata-probe check; it is not Tauri acceptance.
`cgWindowNotFound` remains unexplained and a post-dialog focus race is only a
hypothesis. No Rust/Tauri build or actual native/provider run was performed for this
increment. SSH publication succeeded in prior integrations, but authentication has
been intermittent; [publishing](../development/repository-publishing.md) records
diagnostics and explicit-refspec precautions. An intermittent success does not
establish that GitHub's server edge is the cause.

## Verification log

V6 Core sources `3a3d250` / `dd2cbfd` and chrome source `ba848ba` are integrated as
`452d4b0` / `e352d26` / `c2f7bfc`. Feature configuration, scoped aliases/grants and
layout/team persistence are implemented over existing SQLite/private IPC; native
Feature enrollment and UI are not. Compact shared chrome/menu preserves real xterm
and signed operations. The [V6 checklist](v6-feature-checklist.md) records the subset.

The combined Node run passed 710 tests (`--test-concurrency=2`); lint, typecheck,
build, resource staging, EN/PT Chromium renderer and packaged eight-PTY acceptance
passed. The first renderer attempt used new HTML with pre-build assets and failed
on header text; rebuilding before rerunning resolved that mismatch. Native focus
and dialogs remain simulated in these checks. Electron pair/team selectors were
adapted but their headful runs were deferred to avoid disturbing the concurrent
native focus investigation. No real provider or ingestion validation ran.

Native pane-698 reports an owned authorization sheet invalidating its pending
generation and Cmd-Q exiting a fixture without confirmation. Both remain under
investigation/correction in its isolated worktree, outside this integration; no
native acceptance or fixed quit behavior is claimed here.

| Date       | Scope and result                                                                                                                                                                                                                                                                                                                    | Boundary                                                                                                                                                      |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-11-04 | Integrated `pnpm lint`, `pnpm typecheck`, `pnpm test` (594 tests), `pnpm build`, synthetic Tauri terminals, Electron team and managed-agent acceptance are recorded in [Tauri](../development/tauri.md), [layout](../development/terminal-workspace-layout.md) and [managed-agent client](../development/managed-agents-client.md). | These historical results are for the corresponding integrated runs, not proof of real provider operation or a release.                                        |
| 2026-11-04 | `pnpm exec tsx --test tests/terminal-mcp.test.ts tests/terminal-mcp-qa.test.ts tests/provider-mcp-config.test.ts tests/managed-terminal-pair.test.ts`: 21 passed.                                                                                                                                                                   | Synthetic fixtures and relay children; installed provider compatibility is unverified.                                                                        |
| 2026-11-04 | `pnpm accept:terminal-team --authorize-synthetic-pty --mixed-codex-opencode`: first run failed at `scripts/accept-terminal-team.ts:419` (`busy` instead of expected `denied`); immediate rerun passed with cross-slot denial and retirement blocked.                                                                                | Intermittent failure remains unexplained. The script uses synthetic CLIs and doubled native focus/dialogs; it did not test real Codex/OpenCode communication. |

For this tracker documentation change, `pnpm lint`, `pnpm typecheck`, `pnpm test`
(594 passed) and `pnpm build` passed on 2026-11-04. The build retained the existing
Vite large-chunk warning. No native provider acceptance was run.

The Tauri retained-workspace increment (`f26241c`, source `55efad8`) has 599
synthetic/unit tests in the contributor’s bounded-concurrency run, eight synthetic
PTYs and a four-pane native visual smoke. The default-concurrency test run had one
initialization timeout; native Start was denied after the permission dialog, so no
native start/input/stop cycle or real provider acceptance is claimed. See the
[complete verification record](../development/tauri-terminal-workspace.md#verification-on-macos-apple-silicon--2026-11-04).

Integration on local `main` reran lint, typecheck, build and the complete Node suite
with `--test-concurrency=2` (599 passed), then staged Tauri resources and passed the
eight-pane synthetic acceptance. The first staging attempts stopped before acceptance:
Rust was absent from `PATH`, then `ORQST_NODE_LICENSE` was unset. Staging succeeded
after using the existing isolated Rust toolchain and the staged Node license for the
matching Node binary. These checks did not run real providers or native consent.

The structured-agent increment (`475ff58`, source `930574f`) adds an opt-in
two-Codex Tauri client with signed communication. It is separate from the PTY
workspace. The contributor reported 600 tests and synthetic acceptance; human native
consent, real providers, mixed-provider communication and N-member teams remain
pending. See the [structured client record](../development/tauri.md#structured-agent-communication--2026-11-04).

On integrated `main`, lint, typecheck and build passed, as did 605 Node tests with
`--test-concurrency=2`, three Rust tests using an external target directory, the
packaged structured-agent synthetic acceptance and the separate eight-PTY synthetic
acceptance. The initial Rust run failed because the new agents resources had not yet
been staged; staging and rerunning succeeded. The two acceptance scripts do not prove
coexistence in one native process, native consent or real provider communication.

## Reference and historical records

- [Master reuse audit](../research/reuse-first-audit.md) — pinned Anywh/Tucano
  sources and Overclock license limits; inspect the relevant reference again before
  implementing or when blocked.
- [Roadmap](../../ROADMAP.md) — dated records, not substitutes for the acceptance
  rows above. The historical `mvp-status.md` in some checkouts is Git-ignored and
  is not a portable current-status source.
- [Product requirements](product-requirements.md) — broader observability/analytics
  inventory; check it separately when changing those features.

## Native Tauri preparation delivery — 2026-11-04

The native menu now prepares 1–8 same-provider Codex/Claude manifests through
existing ORQST provisioning and full selection review. The shipped Node is reused;
no external setup or manual manifest is required. Creation, opening and signed CLI
startup remain separate. Cancelled opening preserves files for a fresh native
review; uncertain writes and Core admission are latched against automatic retry.
See [workflow and validation](../development/tauri.md#native-terminal-preparation--2026-11-04)
and [Anywh component/license review](../research/tauri-terminal-preparation.md).

Criteria 3, 4 and 11 remain **Partial**. Synthetic provisioning and a compiled native
menu are not native provider acceptance. Native creation/start/stop, real Codex and
Claude tasks, models, arbitrary mixed teams, recovery, retirement and platform
distribution remain pending. The independently developed Tauri workspace/layout
is outside this increment. No Electron code path was replaced.

Checks already completed for this delivery: the initial full Node run passed 609
tests, the expanded focused suite passed 18, four Rust tests passed, Clippy with
warnings denied passed, production build/resources and both existing packaged
Tauri acceptances passed, and the final macOS debug `.app` was built. No native
dialog/provider acceptance is claimed. A separate shipped-helper check outside the
checkout passed cancellation, wrong-ID and production provider-pin rejection.

Retained failures: the first focused run had three test-fixture Claude pin/inspector
mismatches, corrected only in the synthetic bundle. An expanded complete Node run
during native compilation reported 610 passed, one Analytics `ECONNRESET` failure
and one Codex initialize timeout (55 seconds). No production guard, assertion or
timeout was weakened. The final repeated-run result is recorded below.

Final repeat after native compilation completed: `pnpm test` passed all 612 tests,
with zero failures, cancellations or skips. `pnpm lint` and `pnpm typecheck` passed.
The final `cargo test` passed four tests and `cargo clippy -- -D warnings` passed;
`pnpm build:tauri --debug --bundles app` produced a macOS Apple Silicon debug
application (159.96 MiB). It was built, not accepted through native dialogs or real
providers. `pnpm build`, resource staging and both packaged Tauri acceptances passed
earlier in this same increment. The existing Vite chunk advisory remains.

Integrated as `e115c27` after the Tauri workspace and structured-agent increments:
lint, typecheck, build and resource staging passed; the complete Node suite passed
623 tests with `--test-concurrency=2`, and five Rust tests passed in an external
target directory. Separate packaged synthetic structured-agent and eight-PTY
acceptances passed. Native menu interaction, combined native coexistence, real CLI
execution and the earlier quarantine decision remain unvalidated.

## Native coexistence follow-up — 2026-11-04

From `332aca9`, preparation now captures its document generation before dispatch,
rechecks initial native focus and fences pending reviews when another ORQST window
gains focus. An explicit isolated native fixture composes PTY and communication
hosts without installed providers or credentials. See the
[workflow, native checklist and retained failures](../development/tauri-native-coexistence.md)
and [pinned Anywh review](../research/tauri-native-coexistence.md).

Criteria 3, 5, 6, 8, 14 and 16 remain **Partial**. The native shell and both synthetic
hosts launched, but UI inspection returned `cgWindowNotFound`; native menus,
consent, focus, keyboard and combined graceful quit are still unaccepted. The
attempt was explicitly terminated and retained as unsuccessful. No real provider
started and no quarantined reservation was inspected or modified.

Final checks: lint, typecheck, build, 628 complete Node tests with
`--test-concurrency=2`, six Rust tests, Clippy with warnings denied, the macOS ARM64
debug bundle, packaged Core acceptance, eight synthetic PTYs and structured-agent
acceptance passed. Initial full-suite (627/628), Clippy and one staging failure
reported `ENOSPC`; only this worktree's generated native intermediates/redundant
staging copies were removed before successful retries. The complete final app is
preserved. Synthetic/browser checks do not close the native checklist above.

Integration as `d724d10` independently passed lint, typecheck, build and 628 Node
tests with `--test-concurrency=2`. A further Rust rerun was intentionally interrupted
when it began rebuilding dependencies on a nearly full disk; the six passing Rust
tests and Clippy above are the contributor's checks, not an integration rerun. Two
finished temporary Cargo target caches were cleaned to recover disk space. No native
UI or provider acceptance was repeated during integration.

The later acceptance-runner correction (`5a182dc`, source `704a5e8`) rejects a
resident application with the same bundle identity or path and records the owned
process and artifact hashes. The `cgWindowNotFound` cause remains unproved and no
native acceptance was claimed. Integrated checks passed lint, typecheck, build and
638 Node tests (`--test-concurrency=2`); the native UI was not rerun. See
[native acceptance research](../research/tauri-native-acceptance.md).

## Native alerts, tray and close policy — 2026-11-04

The Tauri preview now reuses Core's extracted Electron source-gated monitor over
its existing private child pipe. Native tray unread/connection state, per-run
notification opt-in, bounded fixed-text alerts/click restore and explicit
background-close policy are implemented. Quit preserves the existing managed-host
consent gates and owned-Core cleanup. No observer capability or HTTP/WS change is
introduced. This contributes to criteria 1, 5, 12 and 14; none is newly accepted.
See the [delivery and platform checklist](../development/tauri-native-desktop.md)
and [pinned source/dependency review](../research/tauri-native-desktop.md).

Integrated as `36a3d41` on top of the native coexistence correction: lint,
typecheck, build, 629 Node tests (`--test-concurrency=2`), ten Rust tests, resource
staging and packaged synthetic Core acceptance passed. Native visual acceptance
remains unsuccessful as recorded in the delivery guide; no real provider ran.

## Native file exports — 2026-11-04

Integrated as `8eec11b` (source `5b963cd`), the Tauri dashboard can use the existing
bounded Artifact and Analytics savers through a narrow native bridge. On the
integrated branch, lint, typecheck, build, 637 Node tests (`--test-concurrency=2`),
11 Rust tests, resource staging and `pnpm accept:tauri-files` passed. The first lint
failed on security-document formatting after conflict resolution; formatting was
corrected and lint passed. The packaged acceptance simulated native IPC, dialogs and
editor opening. Genuine native WebKit dialogs/editor behavior and distribution
remain unaccepted. See the [file contract and security review](../api/tauri-files.md)
and [component research](../research/tauri-native-files.md).

## Interactive terminal MCP — 2026-11-04

Integrated as `901e0b2` (source `a75e352`), Tauri can review a one-use MCP grant
for two explicitly prepared interactive terminals. Resource staging, 11 Rust tests
and the packaged two-PTY/stdio synthetic acceptance passed on integrated `main`, as
did lint, typecheck, build and 646 Node tests (`--test-concurrency=2`).
Unlike the contributor's isolated increment, this integration compiled Rust. Native
focus/dialog acceptance, installed providers and real task return remain pending;
native preparation still creates MCP-disabled profiles. See the [workflow and
limits](../development/tauri-interactive-mcp.md).

## Terminal retirement and MCP integration — 2026-11-04

Commit `ba22c44` composes the existing signed retirement and interactive MCP consent
with mutual exclusion and evidence-based fencing. The contributor recorded 670
passing Node tests, 12 Rust tests, Clippy and synthetic two/eight-pane acceptances;
see the [integration evidence](../development/tauri-retirement-mcp-integration.md).
Human native UI/reselection, real provider execution and durable reconnect remain
unaccepted. The earlier quarantined reservation remains unchanged.

## SQLite layout increment — 2026-11-04

Both native hosts now persist their existing UUID-based visual layouts through the
existing Store and a private opt-in SQLite metadata extension. Valid legacy JSON is
imported only for an absent selection and remains unchanged. Synthetic tests cover
reopen/reorder, corrupt import, newer-schema refusal, limits and filesystem guards.
The complete Node run passed 675 tests; the two subsequent async-reply regressions
also passed. Lint, typecheck, build, Tauri resource staging and both eight-PTY synthetic
Tauri/Electron integrations passed after correcting the recorded initial failures.
See [delivery checklist and checks](../development/terminal-layout-sqlite.md).
The complete criterion 13 remains partial: team configuration, unified communication,
process recovery, native/provider acceptance and distribution remain open. No existing
quarantine, process, reservation, source session or shared main checkout was changed.

Integrated as `9d4aee6` (source `d717d8a`): lint, typecheck, build, resource staging,
677 Node tests (`--test-concurrency=2`) and the eight-PTY Tauri synthetic acceptance
passed on the main checkout. Rust/native UI and real-provider tests were not run
for this TypeScript/SQLite integration. The contributor's worktree remains active
for the following identity increment and must not be removed yet.

## Stable terminal identity link — 2026-11-04

Structured Codex pane snapshots now retain the same reviewed terminal UUID used by
PTY layout metadata, without replacing current pane/instance/epoch bindings. Legacy
rows are compatible. Duplicate live/unavailable identities and external identity
claims fail closed. See [implementation, checks and remaining catalog/team work](../development/terminal-identity-link.md).
Lint, typecheck, build, resource staging and the complete 678-test Node suite passed,
as did packaged synthetic Tauri structured communication with explicit manifest UUID
assertions. Rust/native/real-provider/platform checks were not run for this increment.
Criteria 4/7/8 remain partial: this link does not unify all editing/permissions or
remove the fixed structured pair, and metadata does not recover processes.

Integrated as `746a345` (source `db3a34a`): 678 Node tests
(`--test-concurrency=2`), lint, typecheck, build, staged Tauri resources and the
synthetic structured-agent acceptance passed in the main checkout. No real-provider
or native WebKit acceptance was performed for this metadata change.

The follow-up wording correction (`529f93a`, source `c515f35`) says layout saving
is not confirmed while awaiting the asynchronous acknowledgment. Both locales now
avoid prematurely asserting a write failure. Integration passed 26 focused locale,
layout and retained-view tests, formatting and build; the preceding 678-test run
was not repeated for this text-only follow-up.

## Integrated diagnostics verification — 2026-11-04

The integrated Node run passed 695 tests with `tsx --test --test-concurrency=2
tests/*.test.ts`; the three diagnostic test files passed 18 focal cases, including
actual disposable Node child exit/spawn failure. `pnpm lint`, `pnpm typecheck` and
`pnpm build` passed; Vite retains its existing large-chunk warning. No ingestion
behavior changed, so `validate:local` was not run. No Rust build, native Tauri
workflow, real provider inference or quarantine reconciliation was run. The V6
source hashes were verified 6/6; inspecting its rendered prototype does not count
as runtime implementation or native acceptance.

The V6 menu integration also preserves header drag-to-tab reorder: outside-click
dismissal waits for click, so a drag does not hide its drop targets at pointerdown.
The updated EN/PT renderer test verifies the actual drag/request after rebuilding.
This is a browser interaction regression check, not native window acceptance.
