# Bounded same-workspace terminal teams

A newly loaded Desktop can create and review **1–8 interactive terminals** in one
window. The default maximum remains **2**. Set a smaller or larger explicit maximum
when launching a new Desktop, for example:

```bash
ORQST_TERMINAL_LIMIT=8 pnpm desktop
```

Only integers 1 through 8 are accepted; malformed/out-of-range values refuse startup.
This is the maximum selection size of this interactive Desktop runtime, not a global
machine quota, CPU/RSS limit or a guarantee of useful provider concurrency. Do not
restart a Desktop with live work or drafts just to apply this setting. Existing
loaded code and the separate structured Managed agents surface retain their limits.

## Native workflow

The existing A/B menu remains a two-member preset. With a configured limit above
two, **Managed Terminal → Create terminal team…** offers each size 1 through the
limit. The same pinned installed CLI is chosen for all members, with one existing
empty disposable project and independent private state per member. At limit one
the native creation entry prepares one member. Advanced selection also enforces
the configured limit, same provider, same canonical project, distinct nonoverlapping
states, distinct Claude session UUIDs and distinct terminal UUIDs.

Preparation still creates files only. It executes no discovery/login/model/provider
command and reads no credentials. Login, entitlement and model remain unknown;
no model selector or guaranteed logged-in state is added. Existing native identity
selectors and the canonical reviewed tool PATH are retained. OpenCode startup and
shared native database/activity effects remain separately blocked/acknowledged.

Every complete configuration must be visible in native review. Larger teams use
one bounded page per manifest when the combined review exceeds 4096 characters.
Every page needs confirmation; cancellation, drift, blur or expiry aborts the whole
review. No page is truncated and a single oversized page is refused. Provisioning
publishes all members together by the existing same-parent rename. Pending files
and uncertain writes are preserved; no automatic cleanup/reclaim is added.

Opening allocates one isolated native document, broker, supervisor and journal per
slot over its separate state. Each separately authorized start creates its own PTY
host. Every start, attachment, input grant and stop
retains its existing exact-owner signed/native authorization. Tabs A through H
navigate all members in the same window. At most two documents are visible together; this is a UI limit, and all N owned
processes may continue running;
split/restore shows the invoking member and its next sibling, wrapping at the end.
The ratio slider remains 25–75%. Tabs/maximize/hide/show dashboard never signal a
process. Switching views revokes keyboard leases; a separate input grant is needed.

## Identity, capacity and lifecycle

New manifests persist `identity.terminalId` (UUID). The Core returns that ID and
metadata alias `P-<UUID>`; neither authorizes control nor addresses communication.
The alias is derived from the persisted UUID, so it survives reordered review or
Core restart of otherwise unused manifests. Legacy manifests retain a deterministic
identity derived from their canonical state path; moving that state changes this
legacy identity. Legacy T-number labels remain selection-local and may repeat.
These are separate from the communication registry's `displayId`, native session ID,
Core epoch and each new owned-process attempt UUID. No counter-based nonreused
workspace alias registry, persisted team membership/labels or reconnect is claimed.

The selected terminal count is validated before journals/Core allocation. The
private RPC accepts only bounded numeric slot indices; renderer process requests
cannot select slots. The native binding chooses its own supervisor. The Core ready
reply is checked against the reviewed persisted identities. Each supervisor/journal
admission domain retains two active instances total and one per project internally;
the Desktop gives each slot its **own domain**, so N same-project agents are allowed.
These are not machine-wide or workspace-wide quotas. The common numeric policy is
in protocol; a durable preflight refuses predictable journal/owner/reservation
conflicts before consuming a start proof or recording `starting`. Revalidation at
dispatch still handles races conservatively; it is not an immutable OS binding.

The legacy filename `managed-agents/active-pair.json` remains the single sticky
reservation shared with structured Managed agents in that Desktop profile, for
compatibility with existing uncertain reservations. Renaming it would bypass old
ownership evidence. It records the entire manifest selection. Signed retirement
archives every attempted slot, checks every journal/owned exit, fences all supervisors,
then releases that marker. One running, lost or uncertain slot blocks the whole
team; late exits do not repair lost ownership. View/handler/Core cleanup must also
complete before fresh selection is offered. There is no per-slot recycling or
retry/reconfiguration after uncertain launch, PID adoption or automatic recovery.
OpenCode descendant exit remains unvalidated and retirement remains blocked.

## Preserved boundaries and remaining work

MCP is still the reviewed **exactly two opted-in members** contract, in one workspace.
N-member MCP, real delegation, busy delivery, mixed providers, per-member models,
roles/names, runtime add/remove, durable SQLite team membership, reconnection and
native provider acceptance remain incomplete. A functional eight-slot synthetic
transport does not validate eight real authenticated CLIs or their concurrency.
The runtime reuses the existing audited brokers, signed supervisor, journals,
canonical file/profile/environment helpers and PTY hosts. No third-party subsystem,
new dependency, public HTTP/WebSocket route, credential store or provider is added.

## Explicit verification

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm exec tsx scripts/accept-terminal-team.ts --authorize-synthetic-pty
pnpm exec tsx scripts/accept-terminal-team.ts --authorize-synthetic-pty --slots=2
```

The new explicit script uses eight compiled synthetic CLIs, temporary identities,
profile and loopback Bridge, the production Electron/Core/PTY path, and positive
native focus/dialog **test doubles**. It checks one window, eight persisted identities,
independent running processes, cross-slot refusal, tab/split navigation, partial
retirement refusal and all-exit signed archival/cleanup. It does not run providers,
read credentials, alter user services or establish genuine human native consent.
Unit coverage includes 1/3/6/8-member provisioning, limit/identity errors, complete
paged review, 3/6/8 same-project supervisors, preflight refusal without proof
consumption and uncertain/partial retirement. See the dated validation record below
for checks actually executed in this increment; commands alone are not evidence.

## Validation record — 2026-11-03

The isolated Node 24.22.2 / pnpm 10.34.9 worktree passed lint, typecheck, all 547
unit tests and full build. The build retains the existing dashboard chunk-size
advisory. Earlier focused runs exposed an obsolete total-review-size assertion and
then a test-only macOS path-length error; bounded per-page refusal remains tested,
and the complete final unit run passed.

The initial eight-member Electron attempts failed before views were available:
expected nine documents, observed zero. A disposable diagnostic bundle exposed the
specific startup refusal: the native IPC router still capped documents at two.
The router now receives the same validated selection size, and a 2/8-document
routing regression covers capacity refusal and independent native frames. The
production bundle was rebuilt after diagnosis; the unchanged nine-document
assertion then passed with eight owned synthetic CLIs in one window, distinct
persisted UUIDs, cross-slot refusal, tabs/two-visible split, partial retirement
refusal and all-exit signed archival/complete cleanup. Earlier failed logs are
retained locally and are not EPIPE evidence.

Native focus/dialogs were positive test doubles. Real providers, authentication,
models, human native dialogs, ingestion validation and full browser regression
were not run for this change. No loaded user Desktop was restarted.

After rebasing onto the EPIPE bootstrap guard, the final unit run passed all 563
cases; lint, typecheck and full build also passed. The final eight-member Electron
script exited zero after waiting for the re-enabled creation menu, confirming the
whole retirement/UI/Core cleanup before normal test-app quit. An earlier harness
quit request raced that cleanup and was refused; only its confirmed disposable
Electron was stopped after all eight owned exits. The harness now waits for the
existing readiness signal instead of bypassing the quit gate.

The unchanged native-focus `accept-terminal-pair` was attempted and refused at its
locked-macOS preflight before any fixture/provider started. It is not reported as
passed. The separate two-slot invocation of the new harness uses the same explicit
focus/dialog doubles as its eight-slot path; it cannot replace native acceptance.

The two-slot invocation with native focus/dialog doubles also exited zero with one
window, distinct identities, cross-slot refusal, partial-retirement refusal and
complete retirement/normal quit. This preserves the bounded A/B transport path;
the original native-focus pair acceptance remains blocked as described above.

A later full repeat launched alongside lint/typecheck/build recorded 562/563:
the existing synthetic `codex-native-initialize` case observed a SIGPIPE exit
where its unchanged assertion requires SIGTERM. That failed log is retained; this
is not attributed to the original Electron EPIPE report. No assertion, timeout,
provider path or diagnostic-output guard was changed to obtain another result.
The subsequent unchanged isolated full-unit repeat passed all 563 cases with zero
failures/cancellations. This repeat does not erase the failed observation or prove
its cause. The new mixed-provider refusal tests also passed with both synthetic
provider shapes; this is a negative contract check, not provider parity.
