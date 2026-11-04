# Native CLI pair creation and safe early-failure recovery

## Codex/OpenCode pair update — 2026-11-03

Studio now prepares the reviewed Codex/OpenCode pair directly through the existing
native builder and review flow. Homogeneous presets and advanced selection remain
available. See [Studio preparation](studio-preparation.md). Selection/Core inspection
permit exactly two mixed manifests, one Codex and one OpenCode in the same project.
Each keeps its own environment, state, native grants and lifecycle. OpenCode still
blocks capacity retirement; no old reservation can be discarded for this pair.
See [client steps and remaining real-acceptance gates](codex-opencode-pair.md).

## Bounded N-member update — 2026-11-03

The fixed pair described below is now the default preset over a configured
1–8-member same-provider/project selection. New manifests persist UUID metadata;
full reviews page instead of truncating. Native tabs, isolated per-slot lifecycle
and all-member signed retirement are generalized together. This supersedes only
the fixed-count gaps in the historical table below; labels/models/roles, SQLite
team membership, partial retry/reconfiguration, reconnect and real delegation
remain incomplete. See [the exact workflow and limits](terminal-teams.md).

## Implemented first slice — 2026-11-03

In a newly loaded Desktop build, choose **Managed Terminal → Create and review
terminal pair A/B…**. Ordinary pair preparation no longer needs a shell command or
a manually authored manifest. The native menu is the only entry; browser clients
and the observer preload receive no creation or execution authority.

1. Declare the reviewed installed CLI selection: Codex 0.162.1, Claude Code
   2.1.178 or OpenCode 2.2.5. Choose its canonical native executable and an installed
   Node 24 executable through native file choosers. Shims, aliases and symlink paths
   are refused. No version, login, model or capability command is executed.
2. Choose an existing **empty disposable project**. This initial slice deliberately
   excludes a populated working repository. Each choice is explicit; no shell
   profiles, credentials or native configuration contents are inspected.
3. Choose whether to prepare optional ORQST MCP. Codex retains native MCP definitions;
   Claude strict selection excludes them for these processes; OpenCode merges them.
   The provider-specific warning is a separate Cancel-default choice. Configuration
   does not prove native protocol compatibility, deferred delivery or delegation.
4. Review the complete two-manifest JSON and check the initially unchecked shared
   identity/session-write acknowledgment. All confirmation dialogs are native,
   parented and Cancel by default. Preparation has a five-minute bound; the final
   creation consent expires after 60 seconds. Blur/navigation/destruction invalidates
   it. Binary hashes, directory identities, empty project and focus are rechecked.
5. **Create files only** writes a fresh UUID pair under this Desktop's existing
   user-data directory. It creates private manifests/skeletons, no Core, journal,
   admission directory/claim or provider process. Both complete slots publish
   together by a same-parent rename. Earlier failure leaves `.pending` files pointing
   at the absent final root; they fail normal manifest validation. Files are `0600`,
   directories `0700`. This is atomic visibility, not a power-loss durability claim.
6. A new, complete native selection review follows automatically. Keeping it stores
   only memory. Cancellation keeps completed files; the advanced native selector
   remains available. Complete reviews use compact JSON if formatting alone would
   exceed 4096 characters, and refuse any still-oversized details without truncation.
7. Separately choose **Open interactive terminal A/B**. Existing validation, Core,
   journals and the original shared admission domain apply. Each CLI still needs
   its separate focused signed start. MCP needs both starts and a separate task grant.
   OpenCode defaults to `nativeStartupAuthorized:false`. Its separate native
   startup-effects review can keep that block or explicitly acknowledge shared
   database migrations and native startup activity before the final full review.
   Creation and consent alone start nothing.

Creation preserves the current process's native HOME and applicable CODEX_HOME,
CLAUDE_CONFIG_DIR or OpenCode HOME/XDG/config/DB selectors. Only directory metadata
is checked; the OpenCode DB selector checks its parent, never the database. Unsupported
OpenCode selectors fail closed. Other inherited environment variables/tokens are
not copied into manifests. Existing login remains **unknown**. The provider alone
may resolve/refresh credentials after a separately authorized start; preservation
of the selector is not a claim of authentication or byte-immutable native state.

All three creation choices require the passively reviewed binary hashes. The Codex
candidate pin is `74c6a6d263f40d65f99c27a815275f5b4ed0bcc2baecc396b4cf3255498bdfc0`;
Claude/OpenCode reuse existing reviewed pins. Codex's version label is the selected
reviewed contract, not a fresh `--version` result. A hash identifies bytes; it does
not prove installed-version protocol compatibility, login, model entitlement or
readiness. Node's path/hash is recorded; the private Core validates Node 24 when
explicitly opened. Common trusted project/home directories do not require `0700`;
only newly private state does. Canonical checks and `O_NOFOLLOW` remain in the shared
file helper. The trusted same-user model does not promise immutable OS binding
against a malicious same-user replacement race.

## Signed retirement and fresh selection — 2026-11-03

After both owned processes exit (or no dispatch occurred), the existing native
**Retire pair** review can retire that pair. Core verifies its one-use signed proof,
owned exit evidence, journals and admission ownership, then archives and fences the
old runtime before releasing capacity. Desktop unlocks creation/selection only after
the correlated success reply, router/action/IPC cleanup, destruction of all old views,
protocol-handler removal and confirmed Core process exit. A new pair uses new manifests,
identities, partitions and journals in the same Desktop process; old journals are never
reopened or reset. Initialization/creation latches reset only after this complete proof.

Running processes, `ownership_lost`, closed journals, unknown reservations, transport
loss and partial cleanup remain blocked. A later exit receipt cannot restore lost
ownership. No TTL, PID adoption or unknown-process signal is added. OpenCode retirement
still fails closed because descendant exit is unvalidated. Hidden/detached views do
not imply retirement. Pre-Core failure recovery below remains a separate narrow path.

`pnpm accept:terminal-cycles --authorize-synthetic-pty` exercises two consecutive
create/start/owned-stop/signed-retire cycles in one Electron process, then destroys
one attachment and verifies capacity remains reserved even after the synthetic
process ends itself. It uses a compiled synthetic executable, temporary profiles and
intercepted native dialogs/focus, not real login/provider or human-modal acceptance.

## OpenCode-specific client consent — 2026-11-03

The native creation flow presents the complete blocked manifest plus a separate,
Cancel-default startup-effects choice: keep blocked, or check the acknowledgment
and authorize those effects for a new manifest. Authorization adds all three existing
startup/database/activity fields to the subsequent complete final review. Cancel,
unchecked authorization, blur or navigation creates no files. Generic existing-login
consent never substitutes for this decision. The scope includes shared writable SQLite,
permissions/WAL, possible pending migrations, native credential refresh and configured
hooks/plugins/MCP/network/provider activity; the pending work and rollback safety remain
unknown. A later focused signed start and separate task/MCP grants are still required.

Only synthetic dialog/provisioning tests exercised this new choice. No real OpenCode
startup, database inspection/migration, credential read or inference was performed.
The owner has not granted these native effects in the running application.

## Early failure, capacity and retry

An opening failure can now permit **fresh review without restarting Desktop** only
when native code proves it never entered admission/Core and finished cleaning all
partial views/router handlers. Each attempt uses a fresh volatile Electron partition;
failed-view cleanup unregisters all of its protocol handlers before returning proof.
A typed main-process failure releases the selection
latch and discards the old selection. Completed creation can then be offered again;
old files remain. A successful blocked view is not an opening failure.

The proof is intentionally narrower than "no process observed": admission inspection
itself may create a directory. Entering that path, attempting a Core connection,
creating a journal, losing transport, any cleanup error or any uncertain effect
retains the latch, even if no provider is known to have started. A partial creation
attempt also stays disabled for this run; it is not automatically removed/retried.
There is no per-slot retry after Core startup in this increment. Partitions have no
`persist:` prefix and `storagePath` is null; native Session objects can remain in
memory until app exit. Normal Chromium profile artifacts may still exist. No
automatic profile, session-storage or reservation cleanup is introduced.

`capacity_reserved` now explains that private capacity is reserved or unverifiable,
that opening started no process, and that evidence-backed reconciliation of the
prior lifetime is needed. It reveals no marker contents or sensitive paths.
Creating another pair/restarting does not release capacity. Do not delete markers,
rebaseline, adopt sessions or signal unknown processes. This client has no recovery
shortcut. Focus refusal has explicit foreground/unlocked-console feedback and grants
no operation. Existing hide, detach, stop, kill and signed retirement remain distinct.

## Team recovery direction and current gaps

The owner's complementary team/recovery requirements are incorporated as the
following incremental implementation map. The private source specification is not
stored here. This delivery is the first bounded slice, not its definition of done.

| Requirement                                                     | Current implementation / next concrete work                                                                                                                                                                                                         |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| In-client A/B creation                                          | Native workflow above; fixed pair, same provider, empty project                                                                                                                                                                                     |
| Independent launch attempts and partial success                 | Existing immutable instance/attempt records and finally cleanup retained; per-slot reconfiguration/retry after Core is missing                                                                                                                      |
| Safe next recovery slice                                        | Investigate a new attempt **in the same slot** only with proved pre-spawn `start_failed`; verify backend/claim/journal evidence first. Preserve A while B is reviewed. `ownership_lost`, lost transport or unknown side effects remain nonretryable |
| 1..N members, team name, roles, labels, models, policy/defaults | Not implemented by this wizard. Generalize admission, Core/schema and UI together; A/B becomes a preset. Do not merely increase a renderer count                                                                                                    |
| Durable team configuration and identity                         | Private manifests persist; full SQLite team/membership model and additive migration acceptance remain missing. Do not recycle existing pane registry IDs                                                                                            |
| Discovery/auth/models                                           | Existing passive PATH discovery and exact pins; login/models unknown. Capability negotiation or probes need provider-specific safe contracts and explicit authorization                                                                             |
| Crash/reconnect/native-session continuity                       | Existing receipts/reservations preserve uncertainty; no live PTY resurrection, automatic reconnect/adoption or session resume                                                                                                                       |
| Pane-addressed task/delivery queue                              | Existing opt-in communication library and MCP transport have synthetic evidence; busy delivery, native acceptance and end-to-end real processing/return remain unvalidated                                                                          |
| Mixed providers                                                 | Live selection still refuses them. Review each adapter's model, permission, auth and delivery semantics before composition; no parity inferred                                                                                                      |

Keep structured sessions and interactive PTY processes separate. The structured
communication registry, TUI Core identities, native sessions, task status and message
delivery are different evidence domains. A live PTY is not task acceptance; MCP
catalog/configuration is not successful processing; missing confirmation stays
unknown/uncertain. Queue admission or an idempotency key is not exactly-once work.
See [capability evidence](../adapters/capability-model.md), [lifecycle contracts](../api/lifecycle-contracts.md),
[pane communication](../api/pane-communication.md), and ADR-033 in
[decisions](../architecture/decisions.md).

The pair-creation increment itself imports no third-party source. The subsequent
[reuse-first audit](../research/reuse-first-audit.md) verifies pinned Anywh/Tucano
licenses and adapts only Anywh byte framing in the private structured Codex channel.
It adds no runtime dependency or driver, delivery or recovery guarantee. Overclock
remains a functional reference without an established source grant; the historical
pinned Tucano evidence record is preserved.

## Verification and real acceptance gate

Explicit disposable integration:

```bash
pnpm accept:terminal-creation --authorize-synthetic-creation
pnpm accept:terminal-selection --authorize-synthetic-review
```

The creation integration substitutes only fixture hashes in a temporary bundle,
uses disposable identity/project/profile directories and intercepts native
focus/dialogs. It exercises cancel, missing acknowledgment, blur/navigation, all
three creation shapes and blocked opening with a byte-preserved unknown reservation.
The selector integration injects a pre-Core second-view failure and proves cleanup,
fresh review and successful blocked reopening without touching the original marker.
Unit tests cover drift, canonical paths, strict pins, permissions, late invalidation,
destination collision, inert partial state and refusal to release uncertain latches.
These are synthetic transport/UI checks, not human-dialog or native-provider proof.

Real acceptance still needs separately scoped authorization: unlocked native
gestures, an available/reconciled admission domain, exact provider startup/shared
state effects, authentication/model availability, owned new sessions and actual
A→B processing plus result return. OpenCode additionally lacks an established
inference-free startup boundary and accepted native DB/descendant effects. No
provider/inference, credentials, native DB, quarantines or unknown reservations
were accessed to bypass those gates. Do not restart a loaded Desktop with drafts
or managed work just to expose the rebuilt menu; see [build freshness](desktop.md#checking-which-build-is-active-without-losing-work).

## Current-change evidence and open instability

Node 24.22.2/pnpm 10.34.9 validation passed lint, typecheck, all 505 Node tests
and full build. Explicit synthetic creation, selection/reopening and the disposable
Desktop smoke passed. Selection additionally verifies fresh session identity,
removed old protocol handlers and null persistent storage paths. Creation checks
concurrent duplicate gestures produce only one pair. Architecture review was read-only;
critical QA approved the pins, no-effect retry and partition cleanup boundaries.

The same-window PTY acceptance first failed waiting for `exited` after a Stop click:
both snapshots remained `running`; at post-mortem both showed `data-pending=false`,
with accepted/revoked status text and running lifecycle. `data-gap` contains a static
localized message and does not itself prove a gap. An unchanged repeat passed.
A later diagnostic run failed a different existing assertion after layout revocation:
a direct write returned `busy` where the test required `denied`. Both were non-OK;
this does not prove the lease was accepted. Both journal snapshots were `running`
with no recorded exit, lifecycle receipts were incomplete, initial fixture markers
were visible and the gap message was not displayed. Confirmation count was seven.
The strict assertion remains failed and unchanged. The PTY acceptance is therefore
**not consistently passing** in this change.
These remain unresolved intermittent failures in that acceptance; the earlier
missing `SYNTHETIC:OWNED_TUI` after attach also passed on retry without a proved
cause. Neither is dismissed as environmental noise or claimed fixed. Assertions,
request handling and timeouts remain unchanged. The failure-only diagnostics now
collect bounded native visibility/focus/confirmation count, state/pending/displayed
gap/lifecycle, a read-only owned-fixture journal snapshot and validated lifecycle
receipts when available. Private input leases are not exposed or renewed for
diagnostics; their absence from the report is unknown, not a negative lease result.
No captured user/provider payload is collected.

Full Chromium, real-source ingestion validation, human native dialogs and real
provider/login/MCP acceptance were not run. Ingestion is unchanged. The existing
localhost Bridge returned current built HTML and exact JS/CSS bytes without a
restart; that does not update a loaded Electron main/preload. The existing Vite
chunk-size advisory remains.

## Reuse-first follow-up

The owner's direct reuse-first instruction authorizes compatible open-source reuse
after exact-commit license, attribution, dependency and compatibility review,
superseding the earlier general no-copy restriction for audited incorporation.
Repository instruction files and historical audits remain unchanged.

The integrated [audit and source ledger](../research/reuse-first-audit.md) and
[ADR-035](../architecture/decisions.md#adr-035--audited-source-reuse-with-preserved-observer-and-managed-boundaries)
record the actual Anywh `BufferLineSplitter` adaptation, its modifications and
root NOTICE attribution. The wizard retains its existing schemas, validators,
profile/environment builders, brokers, admission and native selection flow. The
framing change preserves structured-channel limits and strict UTF-8 decoding; it
does not resolve the attach/Stop flakes or approve full PTY, real-provider or
A-to-B processing acceptance. No service restart or provider inference is required.

## Baseline comparison before publication

The `busy`/`denied` observation was compared with `fe004d6` in a detached checkout,
using the same existing dependency installation/lockfile, Node 24.22.2, pnpm 10.34.9,
Electron 45.2.1, synthetic source, authorization flag and native pair acceptance.
No upstream installation or provider probe was added. An initial baseline build
missed workspace module links; after completing those links the baseline built.
The original baseline pair assertions/behavior were left unchanged.

Three bounded baseline UI runs produced: one pass, one timeout waiting for
`SYNTHETIC:PONG`, and one Electron startup failure. None reproduced the exact
`busy`/`denied` UI assertion. These runs demonstrate prior instability, not proof
that the exact UI timing is absent from the baseline or caused by this change.

The broker, IPC router and renderer client files have identical SHA-256 bytes in
base and current code. A new deterministic synthetic characterization was run
against both production versions (only the test was overlaid in the baseline):
a held asynchronous snapshot, followed by lease revocation, makes a concurrent
write return `busy`; after the snapshot completes, the same write returns
`denied`. Both leave zero written bytes, no queued work and no additional native
confirmation. Both broker/runtime groups passed 24/24 cases. The initial new
characterization had an incorrect absolute confirmation-count assumption, which
was corrected to assert no extra confirmation; its failed and passing logs remain.

This establishes that busy-before-lease admission is an existing permitted contract,
not a new reply behavior introduced by pair creation. It does not establish which
in-flight call overlapped the intermittent UI request, nor explain the attach,
PONG, Stop or startup observations. No production behavior, PTY assertion or timeout
was changed to obtain a pass. The overall PTY milestone remains **not approved**.
A matching current UI run again missed the initial fixture marker. Its post-mortem
showed the native window unfocused, a `focus_required` status, slot A running with
armed/started receipt phases and no slot-B attempt. The document-level focus Boolean
was true, demonstrating why it cannot replace the native focus gate. This records
that run's refusal; it does not explain the earlier Stop or busy timing.

Raw comparison logs, build logs, exact test overlay and source hashes are retained
locally outside Git; the detached baseline remains available for critical review.

A subsequent full 506-case unit run (including the new characterization) recorded
505 passes, zero failed assertions and one cancelled case: the existing synthetic
`codex-native-initialize` test exceeded its unchanged 55-second timeout. That run
is not reported as green. Its complete log is retained alongside the comparison.
The earlier 505-case full run and the 24-case base/current characterization passed;
these are separate coverage claims.

The unchanged full-unit repeat subsequently passed all 506 cases, including that
initialization test. Both logs are retained; the timeout is not erased or claimed
fixed by the repeat. This final unit result does not approve the separate PTY
acceptance or real-provider milestone.

## Action gestures and background polling

The interactive renderer previously disabled every action button for each background
read, snapshot or resize. A request beginning between press and release could disable
an initially enabled Attach or Stop button before Chromium dispatched its click.
That loses the gesture without a request, confirmation, attachment or signal. A
running process with missing initial output therefore does not alone prove lost PTY
bytes; it can also have no successful attachment.

Polling now defers new background requests while an action-button pointer or
Space/Enter gesture finishes. Release defers resumption to the next task so the same
gesture's click can run first. Cancellation, blur, leaving the document and hiding it
also resume polling; no pointer capture changes drag activation. Background requests
keep action buttons enabled. One active click can wait for the current background
reply before dispatch, with controls disabled for that active action; another click
cannot accumulate work. Blur, hiding, navigation or identity change discard that
waiting gesture. The actual dispatch still requires unexpired renderer activation
and current native focus; waiting neither renews consent nor retries a request.
Direct concurrent preload/IPC/Core requests still return busy according to the
original contract, with no native request queue. Native focus,
activation, one-in-flight admission, confirmation, lease and gap guards are unchanged.
This fixes a demonstrated mechanism, not every possible historical failure or loss
of native focus. A busy reply remains unsuccessful, including busy-before-denied
after lease revocation.

After `pnpm build:desktop`, explicitly run these disposable regressions:

```bash
pnpm accept:terminal-gestures --authorize-synthetic-pty attach-pointer
pnpm accept:terminal-gestures --authorize-synthetic-pty stop-pointer
pnpm accept:terminal-gestures --authorize-synthetic-pty attach-space
pnpm accept:terminal-gestures --authorize-synthetic-pty stop-space
pnpm accept:terminal-gestures --authorize-synthetic-pty attach-inflight-pointer
pnpm accept:terminal-gestures --authorize-synthetic-pty stop-inflight-pointer
pnpm accept:terminal-gestures --authorize-synthetic-pty attach-inflight-space
pnpm accept:terminal-gestures --authorize-synthetic-pty stop-inflight-space
```

The harness uses the production renderer, preload, runtime, broker, Core and PTY
backend with the compiled synthetic fixture. It controls only the polling clock,
holds selected background replies, and explicitly substitutes native focus/dialogs
inside its temporary Desktop. It waits for the native menu to become enabled before
opening the view; document creation alone is not initialization readiness. It checks
one click and one confirmation per gesture, no background request during the gesture,
the initial fixture marker, confirmed owned exit and durable lifecycle receipt.
Negative native-focus predicates deny start/attach/stop without extra confirmation;
cancel/blur/leave resume polling without an action. The same controlled press/release
against the previous renderer produces zero clicks and zero new confirmations for
both actions and both input methods. Raw local comparison logs stay outside Git.
The in-flight variants hold a read before press, verify that only the active gesture
waits and that no privileged request precedes the read reply, then require one action
and one confirmation. A waiting gesture is discarded on blur; activation expiry
also denies dispatch without a native request or new confirmation. Direct concurrent
requests retain their busy reply and never acquire a retry or offline queue.

These checks distinguish scheduling from native focus. A locked console fails the
unchanged pair preflight before fixtures start. A synthetic positive focus predicate
only validates the transport path; it never accepts actual macOS focus. The original
`pnpm accept:terminal-pair --authorize-synthetic-pty` retains all assertions and
deadlines and requires an unlocked native environment. Even a passing synthetic
pair does not validate human native dialogs, installed provider authentication,
model availability, real A-to-B processing/return, durable reconnect or the full
Desktop milestone. Do not restart an existing Desktop with drafts or owned work
merely to load the rebuilt renderer.

The native harness also waits for an enabled terminal menu before opening a view,
then observes parent focus before invoking the opener, leaving the native child
focus last. Menu readiness, parent activation and exact-child focus share the
original five-second focus budget. Previously it called `BrowserWindow.focus()` after the child opener; a failed
post-Stop run had the parent/dashboard focused and both terminal views unfocused,
despite both owned SIGTERM exits being confirmed in their journals and receipts.
The acceptance now explicitly focuses the dashboard, proves that a focused parent
alone leaves both terminal predicates false, then requires the existing opener to
recover the exact child. No focus predicate, original assertion or deadline is
weakened, and no failed action is retried. Actual OS focus loss can still refuse a
gesture and remains distinct from transport or process exit.
