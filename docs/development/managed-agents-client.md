# Structured managed agents in Desktop

The checkout Desktop now composes the existing signed Codex structured runtime and
pane communication into its **Managed agents** button and native Managed Terminal
menu. This supersedes earlier statements that the structured runtime has no client
surface. The browser dashboard and observer Bridge remain read-only; no control
REST/WebSocket endpoint or observation-cookie authority was added.

## Preparation and use

Use Node 24 and pnpm 10. Provision two **new private directories outside the
project**, following [existing CLI integration](local-cli-integration.md):

```bash
pnpm terminal:setup --authentication reuse-existing \
  --acknowledge-shared-native-config \
  --executable /absolute/canonical/codex --executable-version EXACT_VERSION \
  --project /absolute/canonical/project --state /absolute/new-state-a
pnpm terminal:setup --authentication reuse-existing \
  --acknowledge-shared-native-config \
  --executable /absolute/canonical/codex --executable-version EXACT_VERSION \
  --project /absolute/canonical/project --state /absolute/new-state-b
pnpm build
pnpm desktop
```

Setup never executes the provider or reads credentials. Select the admitted native
binary/version from your own offline compatibility evidence, not an inferred model
catalog. No automatic login, provider detection command or inference runs on opening
the client or view.

1. Open **Managed agents** in Desktop. Enter the exact model identifier for each
   terminal. Installed/native login does not establish model entitlement.
2. Click **Start new Codex**. The first click asks for both private `terminal.json`
   manifests; their native selection order assigns A then B. The confirmation shows
   the complete selected executable, hashes, paths, model, identity and policy.
   Review these paths before signing. Each terminal requires its own confirmation.
3. Observe actual startup phase, lifecycle, immutable instance/pane identities,
   workspace-scoped `T-NNN` identity, new native thread and confirmed model. Failed
   startup or lost ownership cannot be retried/adopted. An unsigned preparation can
   be reviewed again; expired challenges are not signed.
4. Once both panes report ready, enter instructions for A and the exact B task.
   Review the full generated root prompt, fixed target, task, correlation and
   deadline in the separate native confirmation. A receives one scoped
   `orqst_delegate_task` operation; B receives no delegation grant. There is no
   planner, recursive delegation or PTY input injection.
   Complete native review is capped at 4096 characters, so use short instructions
   and tasks; oversized plans/manifests are refused rather than truncated.
5. The view stays responsive while the root runs. B's verified result appears in
   B; the correlated root result appears in A only after native tool return evidence
   and root completion. Queue admission, acceptance, delivery and completion stay
   separate. Missing receipt/ownership becomes unknown, never a successful result.
6. **Stop owned process** requires separate native confirmation and sends SIGTERM
   only through the current owned handle. It does not prove process exit or
   descendant cleanup. No stored PID is used for signaling.
7. After **every admitted process** has a confirmed native exit and the journal
   owners remain valid, **Review safe retirement of this reservation** becomes
   available. A reserved start that dispatched no process also qualifies, without
   fabricating an exit. Native review binds the exact process IDs/exits and task/message
   states to a one-use signature. The review shows every process/exit, the root,
   message count/states and the SHA-256 of the archived message metadata.
   Retirement archives admission metadata first, then fences the old runtime
   before freeing process capacity. An archive I/O failure leaves ownership intact
   for a new native review. A failed marker finalization can be reviewed again
   using the preserved archive after fencing; it never retries provider work. Unknown task outcomes
   stay unknown; no task is retried, canceled or marked complete by retirement.
   Start then selects a new pair with fresh manifests/journals. Old journals are
   still rejected and must be preserved.

These are structured task terminals with inert text/evidence, not interactive PTY
emulators. The existing separate-login xterm path remains available independently
through `--terminal-config`; reuse manifests cannot enter that legacy path.

## Boundaries and limits

- The selected native HOME/CODEX_HOME remain shared. The CLI alone checks native
  account availability with `refreshToken:false`; ORQST discards identity/plan data.
  Native startup may refresh credentials or launch configured MCP servers. ORQST
  does not promise shared config/auth/cache immutability or hard containment.
- Read-only/on-request are native startup defaults. Prompt prohibitions on tools
  are advisory, not a filesystem/network sandbox. No provider approval UI is
  exposed. Same-user trust and configured MCP access remain material risks.
- Two active instances, at most sixteen root submissions per view, one exact
  delegation per root and a 120-second task deadline. Root/native and worker byte
  budgets remain in Core. No enforced token, spend, CPU or descendant budget exists;
  native confirmation explicitly discloses advisory cost limits.
- Only selected new private slot databases are created. Existing
  `terminal.sqlite`/`desktop-communication.sqlite` cause rejection before Store is
  opened. No observer database or existing journal is migrated. Queue/audit store
  metadata only; prompts and results have bounded, exact-scope memory storage.
- A private `managed-agents/active-pair.json` admission marker in Desktop user data
  is flushed before launch. Another client lifetime cannot bypass unresolved work
  by selecting fresh manifests. It has no TTL or PID takeover. Explicit signed
  retirement requires native-confirmed exits for all dispatched processes (or
  proof that none was dispatched) and valid
  terminal/communication journal ownership, independently of task outcome. The
  private `retired-<owner>-<attempt>.json` archive retains original admission identity,
  process exit evidence and task/message states, without prompt/result content.
  Archives record preparation, not proof of completed marker removal; failed or
  partial archive attempts are retained. File and directory sync precede fencing
  and marker removal. An archive failure leaves the live owner intact; after
  fencing, only the same marker/unchanged archive can finalize retirement. A
  changed owner or invalid archive cannot authorize replacement.
- The sticky lifetime indicator separates admitted/running, reserved, uncertain and
  retired states from task completion. Native menu/tray state continues to refresh
  while the view is hidden; the tray can reopen it. Closing offers stay/hide with
  an explicit continue-running notice. Quit defaults to cancel; confirmed quit
  acknowledges disconnect without stop. Cancel preserves handlers and the runtime.
  Reopening the same live view restores a minimized window and requests native
  window/content focus; it does not launch another process. Focus requests are not
  evidence that the operating system granted focus.
  Reload, navigation, renderer loss and application quit disconnect without an
  implicit signal, preserve uncertainty and cannot adopt/retry work. Provider hosts
  retain the existing 30-minute lifetime, then TERM and KILL after 5 seconds;
  this is no guarantee of exit or descendant cleanup.
- **Recovery limitation:** ownership loss, connection loss, crash and markers from
  previous client lifetimes cannot use live retirement. The client does not have
  enough trustworthy owner/instance evidence to release them safely. Elapsed time,
  an absent PID or acknowledging uncertainty is insufficient. This may block new
  pairs until owner-led evidence reconciliation exists. Do not delete the marker,
  reset journals or select fresh manifests to bypass capacity. The limitation is
  also shown in the view and quit notice. Existing evidence is left unchanged;
  this increment does not decide whether to discard/reconcile uncertain history.
- The dedicated document has a separate memory-only session, sandboxed preload,
  no Node integration, no network, no navigation/download/window permissions, and
  strict bounded IPC. Only native file selection supplies manifests. Renderer
  fields cannot select paths, proofs, epochs, target IDs, grants or approvals.
  Native focus/document identity are checked before and after confirmation; the
  native signer never exposes a signing API. Output uses `textContent`, escaping
  terminal/format controls; captured content never executes as HTML.

## Validation and real blockers

Synthetic integration tests cover separate signatures, canceled preparations,
distinct identities/threads, the complete A-to-B-to-A return, result correlation,
acceptance without invented delivery, exact public schemas, source loss and refusal
to reopen existing journals. The explicit Electron smoke opens the shipped view and
checks isolation/lifetime indicators, empty controls, native focus refusal through
real preload/IPC and minimized-window restore without selecting manifests or
launching a provider. It uses the existing native menu opener, which grants no
process authority. Native OS focus could not be obtained for automated active
mutations; those requests were refused rather than bypassing the gate. Active
hide/quit dialogs and retirement in Electron remain unvalidated; Core synthetic
cases cover ownership, archive failures, no-dispatch retirement and uncertain
outcomes. Fixtures do not prove installed CLI login, model access, native modal acceptance or
real delegation. No provider execution is part of tests, build or normal startup.

The lifetime/retirement correction on 2026-11-03 passed lint, typecheck, build,
441 synthetic Node cases and the disposable Electron 45.2.1/arm64 smoke described
above. Independent critical QA reran the twelve focal ownership/retirement cases
and approved the code after archive-failure and no-dispatch recovery corrections.
These results do not establish active native-modal/focus acceptance or real-provider
execution. No installed database migration or resident service restart was used.

The historical real startup failure and real two-agent acceptance remain unresolved.
This delivery wires the usable client path; it does not claim the two-real-agent
milestone has been accepted. `history_changed` in the shared source guard remains
**inconclusive**, as fixed in dffa1e6; no passing preservation claim is inferred from
this UI, from fixtures or from absence of visible errors. See
[real acceptance and preservation evidence](codex-two-agent-acceptance.md).

## Follow-up focus and native-host validation — 2026-11-03

Focus refusal now has a specific localized explanation in the dedicated view and
in the dashboard opener. A refused opener no longer silently does nothing. The
native sender/session/main-frame/generation checks and checks before/after modal
review are unchanged; no focus result, gesture, signing or ownership gate is mocked
in the shipped client. A renderer cannot request native refocusing through IPC.
Older running version-1 preloads that return no opener result remain supported.

The real Electron 45.2.1 process in this environment reported both native window
and content unfocused despite explicit test activation requests. A separately
identified disposable Electron copy behaved the same. These attempts started no
provider and do not establish a production focus defect or a fix for active modal
flows. Human native focus and active start/delegate/hide/quit/retire acceptance
remain open. Do not treat a rendered screenshot or Chromium click as native focus.

The explicit command below exercises the actual Desktop Core composition, pinned
Node host, native child JSONL transport, two distinct processes/threads, signed
A-to-B-to-A, correlated results, SIGTERM with native-confirmed exits and signed
retirement. It compiles a fixed synthetic C executable and provisions private
HOME/config/manifests/journals/admission under a disposable root. It neither opens
credentials/external sessions nor executes an installed provider. The fixture
has an independent 90-second watchdog and starts no descendants. It is separate
from automatic tests, normal startup and the real-provider milestone:

```bash
pnpm build:desktop
pnpm accept:managed-agents --authorize-synthetic-agents
```

A passing result is **native-process synthetic integration**, not Electron active
interaction, native dialog acceptance, provider compatibility/authentication,
model access, source preservation, crash recovery or descendant containment. Use
`pnpm test:desktop` separately for the shipped view's disposable Electron smoke.
All new profiles/stores remain separate; no resident Desktop restart, database
migration, historical reservation or quarantine change is part of either command.

For this follow-up, lint, typecheck, full build, all 441 Node tests, the focal
Chromium opener case (both locales and legacy preload) and the disposable Electron
smoke passed. Electron checked real preload/IPC focus refusals and native
minimize/reopen restoration; active authorization remained unvalidated. The native
synthetic two-process command above also passed. `validate:local`, real providers,
human dialogs and the full Chromium suite were not run; ingestion is unchanged.

Critical review approved the focus/identity, opener compatibility, restore and
synthetic integration boundaries. A focus-only refusal now preserves the last
observed lifecycle label; mutation buttons stay disabled until a fresh snapshot
restores them. A synthetic Chromium regression covers this client state transition,
without claiming native focus or modal acceptance.
