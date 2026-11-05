# Experimental pane communication v1

This is an opt-in Core library, not a public REST, WebSocket or MCP endpoint.
The explicit [Desktop client](../development/managed-agents-client.md) now composes
it behind a dedicated native document and bounded IPC; no communication grant is
given to the observer renderer. ObserverCore never constructs it. The structured
Codex transport exists; real-provider acceptance remains pending. There is no PTY
injection or planner.
The first real two-agent delegation milestone remains **incomplete**.

## Capability inventory and boundaries

| Capability                                                       | Current evidence                                                     |
| ---------------------------------------------------------------- | -------------------------------------------------------------------- |
| External Codex observation                                       | Existing read-only implementation, preserved                         |
| Terminal process ownership                                       | Separate experimental terminal supervisor/journal; not pane identity |
| Stable pane IDs and workspace display IDs                        | Implemented library; synthetic SQLite tests                          |
| Authorization, durable FIFO, deduplication and recovery          | Implemented library; synthetic tests                                 |
| Separate queue admission, provider acceptance, task start/result | Implemented contract and injected synthetic transport tests          |
| Automatic result notification to the initiating Core client      | Post-commit subscription and durable inbox; synthetic tests          |
| Codex, Claude Code or OpenCode task submission                   | No enabled communication transport                                   |
| Real agent A receives agent B's answer inside its CLI            | Not validated; requires native structured provider/MCP transport     |
| Inspector, notifications UI, scoped MCP and planner              | Planned; no exposed endpoint                                         |

The service is `packages/core/src/communication/service.ts`; strict schemas and
private journal interfaces are in `packages/protocol/src/pane-communication.ts`.
The existing Store can explicitly open a `communicationJournal(epoch, { recover })`.
Only this opt-in operation creates its versioned SQLite tables. There is no new
package, listener, service, credential, provider dependency or automatic migration
in observer startup. No observed session source is opened or modified by this library.

## Identity and ownership

A pane has an immutable UUID `paneId`, explicit `workspaceId`, workspace-scoped
`T-NNN` display ID, name, provider, optional reported CLI version/model, owner and
creation reason. Names may be ambiguous; exact IDs take precedence and name-only
resolution fails when ambiguous. Rename preserves IDs. Closed records remain and
display IDs are never recycled. Capacity exhaustion rejects new records.

A managed pane additionally requires an explicit immutable binding containing
`instanceId`, `projectId` and `terminalEpoch`. These identify one enrolled terminal
start. **projectId is not workspaceId**; terminal instance identity is not a native
session ID, observed session ID, PID, task, turn or attachment. This library cannot
prove that a binding describes a real process: a future trusted composition must
verify native enrollment/ownership before registering or re-enrolling an adapter.
It must not derive bindings from logs, provider prose, a name or a guessed PID.
Provider-native session references and durable terminal allocation are not yet wired.

External panes must have no managed binding, control capability or adapter. They
cannot send or receive delegated work. Hiding or detaching UI does not call
`setPaneState`; that operation records only independently confirmed runtime state.
There is no process stop, signal, launch, model selection or automatic close API.

## Private authorization and content

`registerPane`, `enrollAdapter`, `authorize`, `reauthorize`, `revoke`, rename and
runtime state methods are **trusted composition functions**, never tools available
to an agent. Only the frozen client returned by `authorize` should reach a future
authenticated transport. It binds actor, source pane, workspace, allowed target IDs
and expiry using private closures; requests cannot change them. Read access is
limited to that actor/source/target scope, including result metadata and audit.
Possession of the client is authority within that scope. No serializable token,
renderer claim, observation cookie or captured text creates a client.

Clients can send a strict envelope, inspect status, read their durable result
inbox, replay their scoped audit, cancel never-dispatched queued work and subscribe
to post-commit updates. Invalid client operations append metadata-only denial
records, without persisting attempted prompts, secrets or exception text. Grants
last at most 15 minutes, can be revoked and are never persisted or restored.

Payload/result references contain only an opaque local ID, SHA-256 and exact byte
count (1–16 KiB). IDs reject paths, traversal and URL schemes; no file/URL resolver
is supplied. A **trusted resolver must authorize the exact actor, workspace,
source/target and request/result purpose** passed by the Core, then return local
bytes. The Core validates size/hash at admission and immediately before dispatch,
and validates result identity before committing completion. It copies validated
bytes before passing them to the adapter. Content is never persisted in queue/audit
records or sent to Cloud. The host owns resolver storage, retention and access;
there is no arbitrary-file content API or content storage implementation here.

## Delivery, task and correlation

`paneSendSchema` v1 requires message/task/correlation UUIDs, source/target UUIDs,
workspace, optional parent task UUID, `task.request`, payload identity,
`queue-if-busy`, idempotency key and absolute deadline. The Core adds actor/grant
references, depth, timestamps and independent state fields.

- Admission returns `queued` + `pending` only after an independent SQLite commit.
- A dispatcher transaction claims one FIFO message as `dispatching` with a fresh
  attempt UUID before calling a structured adapter. There is no PTY write method.
- An adapter `accepted` event advances delivery only. `delivered` requires its own
  explicit receipt; completion never manufactures it.
- `started` evidence changes the task to `running`. `waiting_approval` is separate.
  Completion/failure requires a prior start; completion also requires a validated
  result reference. An exception, exit, idle prompt or elapsed time is no completion.
- Every provider event must match message, task, correlation, target pane, attempt,
  instance and terminal epoch. Closed/unavailable target or terminal task state
  rejects late evidence. Evidence IDs are opaque provider-record references, not
  provider prose. Their trust depends on the separately validated adapter.
- Result updates notify scoped Core subscribers after commit, and the inbox remains
  queryable after reconnect/restart. This proves neither delivery into the source
  CLI nor an acknowledgement by that CLI. A source-provider response channel is
  still required for the real milestone.

No arbitrary agent can submit provider evidence. Only the callback passed to the
injected adapter can do so. Adapters must independently verify readiness and
provider-native events; mocks do not establish provider support. The Core requires
source `canSend` to originate a task and target `canSend` for structured submission, plus target queue/ack/completion capabilities for admission.
Source `canCancel` permits cancellation of its own never-dispatched queue only; it
is not provider cancellation support. Provider acceptance/receipt callbacks require
target `canAcknowledge`; task callbacks require `canReportTaskCompletion`, checked
again when evidence arrives. Busy panes queue locally;
provider-native queueing and cancellation are not enabled. Missing adapter/readiness
leaves work queued without creating an attempt. Capability declarations are supplied
by trusted enrollment, not inferred from CLI installation or a PTY prompt.

## Limits and recovery

FIFO is per target; no priority override or redirect exists. At most one uncertain
or active task per target and four globally can dispatch. A message with unknown
outcome continues consuming capacity, preventing unsafe follow-on work. Queue
admission is limited to 32 pending items per target and 30 admissions per actor per
minute. Deadlines cannot exceed the grant or 15 minutes. Expired queued work fails
before submission. A ten-second dispatch-call timeout records uncertainty, without
interrupting the provider; there is no provider execution-time enforcement or token/spend
budget implementation. Those are required before enabling real agents.

Parent delegation must match workspace/correlation and the parent's target/source
chain. Repeated panes, self-delegation, missing/finished parents and depth over three
are rejected. This is a bounded explicit chain, not an autonomous task planner.
Shared-repository worktree allocation and safe integration remain host policy, not
provided by message routing.

Idempotency scope is workspace + target + logical operation key. Exact duplicate
admission returns the original message/status. Changed task, content, authority or
logical envelope conflicts; UUID reuse cannot overwrite an existing message/task.
There is one dispatch attempt and **no automatic retry** or exactly-once execution
claim. A submit that resolves without accepted evidence, a timeout or a transport exception
becomes `delivery_unknown` / `outcome_unknown` unless an authoritative outcome was
already committed. Acceptance remains acceptance if
known; uncertainty never erases confirmed evidence.

Confirmed closure before dispatch yields `target_closed` + failed task. Closure
following dispatch preserves acceptance/receipt where known and marks task outcome
unknown. No other target/model is selected. Only undispatched work may be cancelled;
the task becomes cancelled with `cancelled_before_dispatch`, and delivery remains
queued to avoid inventing a transport cancellation event.

The optional journal uses the existing controlled writer, WAL/foreign keys,
`FULL` synchronous commits and versioned tables. Epoch recovery is an explicit
trusted-host action, never inferred from inactivity. It fences previous writers,
marks open panes unavailable, preserves queued records and classifies in-flight
attempts conservatively. Grants/adapters are memory-only; queued work needs explicit
fresh authorization for each message plus independent exact-binding re-enrollment
and confirmed readiness. Unknown attempts cannot be reauthorized/retried. There is
no ownership adoption, PID signaling, process survival, resume or reconciliation
implementation. **There is no capacity reclamation API.** Four unresolved outcomes
exhaust the global dispatch limit even after their panes close or new panes are
registered. Restart preserves that block; it cannot establish that work stopped.
The library deliberately fails closed until a separately reviewed, evidence-backed
reconciliation design can release capacity without inventing task outcomes. Do not
reset, delete or replace a journal to bypass uncertainty. This is an explicit gate
before enabling real-provider dispatch in normal runtime. An old binding must never be attached to a new process.

There are hard history caps: 128 panes, 1,024 messages and 16,384 append-only audit
events. Reaching a cap fails closed; records are not silently evicted. No retention,
compaction, secure-deletion UI or automatic reset exists. A reviewed lifecycle and
retention design is required before normal-runtime composition. SQLite metadata
uses existing owner-only Store directory/database permissions. It is local sensitive
metadata, not an encrypted vault or a boundary against same-user malware.

## Reproduction and next milestone

Run `pnpm exec tsx --test tests/pane-communication.test.ts` using the project's Node
24 / pnpm 10 toolchain. All contents, identities and adapters in these tests are
explicitly synthetic; only disposable SQLite files are written. Full repository
checks remain `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`.

Next: join persistent pane identity to the separately validated terminal admission,
per-terminal managed storage/concurrency and native authorization; implement one
pinned structured provider transport and narrow authenticated MCP/response facade;
prove two real identified panes delegate a bounded task and return correlated result
evidence automatically. Then expose the Communication Inspector over those facts.
Native PTY success alone does not satisfy that milestone. Claude Code and OpenCode
remain unvalidated communication contracts; no provider is silently substituted.

## Native pair creation does not establish task delivery — 2026-11-03

The [native wizard](../development/cli-team-recovery.md) prepares optional MCP
configuration with separate per-provider acknowledgments. It does not enqueue a task,
register native processing, grant model access or establish busy-pane deferred
delivery. Both signed starts and a separate task grant remain mandatory. Real
A-to-B-to-A processing/result acceptance, pane-addressed UI delivery and N-member
composition remain incomplete. Preserve current source/target/idempotency/status
semantics; an uncertain result must not be replayed as if acceptance never occurred.

## Explicit mentions and directed permissions — 2026-11-04

New routed panes have `routing: {handle, role, allowedTargetPaneIds}`. Handles use
2–32 lowercase ASCII letters/digits/underscore/hyphen, start with a letter/digit
and are unique within the workspace, including closed records. `paneId`, display
ID and owned runtime binding are unchanged by edits. Roles (`worker`, `reviewer`,
`orchestrator`) are descriptive and never create execution authority.

`configureRouting` is trusted Core composition only. It atomically validates targets,
workspace/managed ownership, handle uniqueness, duplicate/self edges and direct or
transitive cycles, then saves metadata plus `pane_routing_changed` audit. Explicit
matrix permission is checked at grant creation, admission and dispatch. Removing an
edge blocks undispatched work without changing known delivery/task outcomes or scoped
read access. The original message can still be cancelled before dispatch; there is
no automatic redirect, expiry extension or replay.

`resolveMention` accepts explicitly submitted composer text only. It adapts the pinned
Tucano parser, ignores fenced/inline code and ordinary email addresses, normalizes
case and requires exactly one distinct known managed handle in that workspace.
Unknown/oversized handles fail rather than falling back to a name, ID or model router.
The original task bytes, including the mention, remain the exact authorized payload.
Captured CLI output never invokes this resolver or grants a subsequent delegation.

The native request union adds `{action:"routing",version:1,slot,update}` and a
`sourceSlot` (0 or 1, default 0) on `delegate`. Routing requests expose no proof,
path, actor, workspace or grant. The main process prepares a signed one-use review
binding exact before/after identity and routes; Core refuses stale revisions and
invalidates previously prepared root tasks after an edit. Active or uncertain root
work blocks edits. A separate existing native confirmation binds each exact source,
target, task and deadline before inference. Roles do not select an implicit source.

Existing journal records parse missing `routing` as null. Those legacy/native
compositions continue requiring their original exact per-task native grants; null
is not anonymous execution permission. New Desktop routed panes always enroll with
an empty matrix. This additive metadata contract creates no table migration, REST,
WebSocket, generic MCP or observer capability. This path is enabled only through the
explicit Electron managed client. The earlier capability table describes the original
library milestone; the current implementation and remaining acceptance boundary are
recorded in [the component review](../research/mention-communication.md).

## Stable terminal metadata link — 2026-11-04

Communication pane v1 accepts optional `terminalId: UUID`, supplied by the trusted
structured adapter from the reviewed terminal manifest via `terminalIdentity`.
Legacy rows without it retain their original meaning. This immutable metadata link
is distinct from `paneId` and the live `binding`: messages/grants still require
current pane IDs, actor/workspace scope and source-backed instance/epoch ownership.
No endpoint resolves a terminal UUID into a live target or adapter automatically.

Registration rejects a stable terminal link on an external pane and rejects a second
non-closed pane with that terminal UUID, including an unavailable pane. A new
explicitly authorized instance after confirmed exit may keep the UUID with fresh
pane/instance IDs; old bindings/routes do not transfer. See
[identity evidence and remaining unification work](../development/terminal-identity-link.md).

## Feature policy enforcement

Trusted composition may pass a fourth `FeaturePermissionReader` argument to
`PaneCommunication(journal, resolver, now, reader)`. Feature-scoped communication
requires this reader and exact assigned stable terminal IDs. Legacy unscoped panes
retain their existing contract and never match a scoped pane.

A known Feature without a policy row is neutral; a saved policy strictly intersects
reviewed routing, exact native task grants, ownership and capabilities. Both delegate
and execute are checked at authorization/admission/dispatch. Grants pin the exact
policy revision; any policy edit requires fresh authority, even when rules reallow.
View restricts status, inbox, audit events and notifications, including immediately
before microtask delivery. Admission receipts contain submitted metadata; an idempotent
resend cannot retrieve a hidden completed result. Provider evidence after dispatch
continues to be persisted after revocation, without inventing cancellation.
`delegationRevision(sourcePaneId,targetPaneId)` is a trusted root-plan policy/route
check, not an agent tool or a native grant. See [details and pending integration](../development/v6-feature-permissions.md).
