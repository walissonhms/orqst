# Master specification delivery tracker

**Snapshot:** 2026-11-04, local `main` at `ee08ecb` before this documentation
change. This is the entry point for tracking the owner's Tauri, Node Core and
multi-agent terminal specification. It is not a release approval.

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

| #   | Required outcome                                                    | Status and current evidence                                                                                                                                                                                                                                | Remaining work                                                                                                                               |
| --- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Tauri 2 starts the Node Core without Electron                       | **Partial** — a macOS Apple Silicon debug preview was built and opened; see [Tauri acceptance](../development/tauri.md#acceptance-and-remaining-work).                                                                                                     | Complete packaged, lifecycle, recovery and platform acceptance.                                                                              |
| 2   | Preserve ORQST identity and reusable UI                             | **Partial** — shared dashboard and 1–8-pane Tauri workspace are implemented; [workspace evidence](../development/tauri-terminal-workspace.md).                                                                                                             | Complete native visual, accessibility and full migration acceptance.                                                                         |
| 3   | Create Codex and Claude from UI without mandatory external setup    | **Partial** — Electron has a native preparation flow; Tauri requires prepared manifests. See [Studio preparation](../development/studio-preparation.md) and [Tauri terminals](../development/tauri.md#prepared-managed-terminals--2026-11-04).             | Implement and validate the complete Tauri UI flow with both real CLIs.                                                                       |
| 4   | Add third and fourth agents without fixed A/B logic                 | **Partial** — Tauri retains 1–8 prepared PTY panes; Electron supports homogeneous teams and a reviewed two-member mixed pair.                                                                                                                              | Validate independent real 3/4-agent creation and mixed-provider teams; remove the fixed communication pair limitation.                       |
| 5   | Hide a pane without stopping its session; stop only on request      | **Partial** — retained Tauri workspace implements hide/show and separate stop; [workspace evidence](../development/tauri-terminal-workspace.md).                                                                                                           | Complete real native lifecycle and close/hide confirmation acceptance.                                                                       |
| 6   | Maximize, resize and move panes without losing input/output         | **Partial** — Tauri implements retained grid, resize, names and reorder; synthetic and visual smoke evidence is in [workspace](../development/tauri-terminal-workspace.md).                                                                                | Validate full real PTY input/output, focus, scrollback, accessibility and native consent.                                                    |
| 7   | Rename panes and mention stable unique handles with autocomplete    | **Partial** — Tauri has a retained PTY workspace and a separate, opt-in two-Codex structured client with names, handles and autocomplete. See [structured agents](../development/tauri.md#structured-agent-communication--2026-11-04).                     | Unify terminal identities and mentions in the Tauri multi-agent workflow; validate real delivery.                                            |
| 8   | Assign/change orchestrator and edit communication permissions in UI | **Partial** — roles and directed permissions are available in the separate opt-in two-Codex Tauri structured client.                                                                                                                                       | Integrate roles and permissions with arbitrary supported terminals/teams; validate native authorization and real providers.                  |
| 9   | Real directed mention delivery and verifiable return                | **Blocked** — Tauri structured communication has synthetic tests only; the real Codex attempt lost ownership before readiness. See [reconciliation](../development/codex-two-agent-acceptance.md#reconciling-the-blocked-attempt-before-another-real-run). | Decide quarantine/capacity policy; complete native reviews and real provider acceptance. Mixed-provider PTY MCP consent remains unported.    |
| 10  | Message states represent real events                                | **Partial** — existing managed communication distinguishes acceptance, execution, result and unknown outcomes; see [mention research](../research/mention-communication.md).                                                                               | Demonstrate correct evidence and failure/unknown states end to end with real providers, including mixed pairs.                               |
| 11  | Claude startup failure does not block Codex or a new terminal       | **Partial** — failure boundaries have synthetic coverage; mixed selection and recovery have limitations.                                                                                                                                                   | Prove the requested independent failure/retry scenario with real supported CLIs and Tauri.                                                   |
| 12  | Recovery/reconnect avoids duplicate processes                       | **Partial** — journals fence uncertain ownership; persisted Electron layouts do not reconnect processes. See [recovery](../development/cli-team-recovery.md).                                                                                              | Implement and validate scoped reconnect/recovery with real owned process evidence; do not reset uncertain reservations.                      |
| 13  | Layout, teams and settings persist in SQLite                        | **Partial** — Electron and Tauri workspace preferences use private JSON; managed metadata uses existing journal rows.                                                                                                                                      | Deliver and validate SQLite persistence for layouts, teams and settings, including restart behavior.                                         |
| 14  | Protect local Core and minimize desktop permissions                 | **Partial** — loopback/authentication and constrained Tauri terminal IPC are documented in the [security model](security-model.md) and [Tauri guide](../development/tauri.md).                                                                             | Complete security review and native/packaged acceptance of the final composition.                                                            |
| 15  | Identify reused third-party code and honor licenses                 | **Partial** — source pins, adaptations and notices are recorded in [reuse audit](../research/reuse-first-audit.md), [Tauri reuse](../research/tauri-core-reuse.md), [mentions](../research/mention-communication.md) and root `NOTICE`.                    | Complete the transitive redistribution and platform-specific notice audit before distribution; resolve the instruction conflict noted below. |
| 16  | Document automated tests and manual real-CLI tests                  | **Partial** — synthetic, build and limited native evidence exists.                                                                                                                                                                                         | Complete and document genuine human/native tests with real Codex, Claude and OpenCode, including communication and failures.                 |

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
  quarantine/capacity policy. A real mixed test additionally needs the native
  per-provider startup/effects reviews and the separate task grant. OpenCode native
  database/activity effects and descendant retirement are documented in the
  [mixed pair workflow](../development/codex-opencode-pair.md).
- **Tauri parity:** prepared PTYs now share a retained workspace; creation,
  interactive PTY MCP, retirement/reselection, exports, notifications and
  full native lifecycle are not yet accepted. See [Tauri limits](../development/tauri.md).
- **Current instruction conflict:** the supplied repository rules prohibit copying
  third-party code and describe an observer-only runtime, while the owner's master
  specification calls for compatible code reuse and managed agent execution. Existing
  attribution documents record adaptations already present. Before further changes
  in those areas, resolve the applicable boundary with the owner; do not erase history
  or assume a licensing decision overrides a project instruction.
- **Distribution:** macOS Intel, Windows and Linux, signed/notarized installers,
  PTY dependencies and the complete transitive license/notice review remain open.

## Verification log

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
