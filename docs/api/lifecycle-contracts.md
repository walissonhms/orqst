# Lifecycle contracts

## Implemented local observation slice (Phase 1)

`packages/protocol/src/lifecycle.ts` exports strict zod schemas and inferred types;
`ObserverCore` is their concrete runtime consumer. This is a local library contract,
not a transport or lifecycle event stream. All objects use
`contract: "orqst.lifecycle"`, `contractVersion: 1`. Unknown fields are rejected,
including content fields. This does not change `schemaVersion: 1`, v1 REST/WS,
statuses, event IDs, adapter capabilities or SQLite schema 2. Migrations 1/2 are
unchanged. There is no lifecycle endpoint, subscription or command. A later separate
[manual Artifacts slice](artifacts.md) consumes these unchanged references and adds
its own bounded extraction contract and session UI.

### Queries and version selection

```ts
core.observedSessionEvidence(sequence: number, contractVersion: unknown = 1)
core.artifactReference(sequence: number, contractVersion: unknown = 1)
```

Both are synchronous, after Core initialization, and read at most one retained
v1 event using the existing Store and indexed sequence cursor. No source file is
opened, no observation is started and nothing is persisted. The exact requested
sequence must match: retention gaps never select the next surviving event. Neither
query falls back to durable Analytics evidence or session summary text.

The local caller selects the required version explicitly (default 1). Only numeric
literal `1` is supported; strings, null and unknown versions fail before any Store
read. Sequence must be a positive safe integer. Errors are sanitized fixed messages:
`Invalid lifecycle request` or `Invalid retained lifecycle evidence`; errors include
no validation input, captured content or source path. An uninitialized/stopped Core
retains its existing `Core store is not open` error for valid requests.

Results discriminate on `availability`:

- `available` contains `value`, validated against the corresponding result schema.
- `unavailable` contains only `reason`: `event_not_retained` (missing or expired),
  `unsupported_adapter` (anything other than Codex), or `not_artifact_message`
  (artifact query only). There is no implicit null or partial successful value.

These checks are local version selection, not network negotiation. A future
transport must negotiate separately before delivering this contract.

### Identity, provenance and unavailable values

`observedSessionIdentitySchema` carries `sessionRef` with `machineId`, literal
`adapterId: "codex"`, and `nativeSessionId` copied from the retained event, plus its
original `workspaceId` and `observedAgent: { id, basis: "v1_agent_id" }`. The workspace
is the event's recorded scope, not a later manual assignment. Opaque IDs are not
rewritten; nonblank strings of at most 1024 characters without control characters
are required. The session-scoped v1 agent ID is not promoted to a managed worker:
`agentInstanceId` is explicitly `{ availability: "unavailable", reason: "not_recorded" }`.
No task, process, parentage, machine registration or authorization is fabricated.

`retainedObservationEvidenceSchema` carries `kind: "retained_v1_event"`, the original
`eventId`, safe positive `sequence`, UTC ISO `occurredAt` from the event timestamp,
and the exact `source` fields: relative `file`, safe nonnegative byte `offset`,
safe positive `line`, lowercase SHA-256 `hash`, and nonblank `recordType`.
File identifiers are limited to 4096 characters; absolute paths, URLs, backslashes,
control characters and empty/dot/traversal segments are rejected. These stricter
projection checks do not change the v1 ingestion schema. Invalid retained metadata
fails the entire projection with the sanitized error above.

The historical ingestion time was not persisted, so `observedAt` is explicitly
unavailable with reason `not_recorded`; query time is never substituted.
`sourceVerification: "not_rechecked"` means the reference identifies retained evidence,
not proof that a file still exists or matches its hash. There is no source-root grant,
dereference API or content read authority. IDs, paths, hashes and labels remain
sensitive untrusted local metadata; the schemas do not guarantee secret-free strings.

### Historical session and independent states

`observedSessionEvidenceSchema` has `type: "observed_session.evidence"`,
`mode: "observed"`, `identity`, `evidence`, and these independent resource fields:

| Field           | Implemented meaning                                                                                                                                                                                                 |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `session`       | `{ state: "discoverable", basis: "retained_history" }` describes historical discovery only, not present filesystem availability, attachment or process liveness.                                                    |
| `turn.identity` | Available `value` only from the retained v1 `correlation.turnId`; otherwise unavailable with `not_recorded`. Native direct versus adapter-carried correlation cannot be distinguished without rereading the source. |
| `turn.state`    | Available `value` only for the closed Codex mapping below; otherwise unavailable with `no_turn_state_evidence`. It describes this record, never a latest-state reduction.                                           |
| `task`          | Unavailable with `task_evidence_not_recorded`; provider `task_complete` is not ORQST task success.                                                                                                                  |
| `process`       | Unavailable with `process_not_observed`; no PID, exit or liveness claim.                                                                                                                                            |

The Core requires all three columns below to match; intervention additionally
requires tool name `request_user_input` or `functions.request_user_input`:

| Source record type                                              | v1 event type / payload status                     | Turn state         |
| --------------------------------------------------------------- | -------------------------------------------------- | ------------------ |
| `event_msg:task_started`                                        | `agent.started` / `running`                        | `running`          |
| `event_msg:task_complete`                                       | `agent.completed` / `completed`                    | `completed`        |
| `event_msg:error`, `event_msg:task_failed`                      | `agent.failed` / `failed`                          | `failed`           |
| `event_msg:turn_aborted`                                        | `agent.updated` / `interrupted`                    | `interrupted`      |
| `response_item:function_call`, `response_item:custom_tool_call` | `agent.intervention.required` / `waiting_for_user` | `waiting_for_user` |

No inference uses prose, elapsed time, status alone or tool completion. Query order,
duplicates and old timestamps cannot advance a task or rewrite a turn outcome: the
queries project one immutable retained fact and maintain no new state machine.
Generic schemas validate shape; the Core supplies the source-backed mapping. Pending,
unknown, approval and quota transitions are not invented where no evidence exists.

### Artifact references, without extraction

`artifactReferenceSchema` has `type: "artifact.reference"`,
`kind: "message_reference"`, the same `identity`/`evidence`, explicit `turnIdentity`,
message `role`, and `content: { availability: "unavailable", reason: "reference_only" }`.
The reference is identified by the existing event ID and sequence; no artifact ID,
format, filename, title, extraction timestamp or document version is invented.

Only an explicitly requested `agent.message` qualifies, with nonblank retained text
and matching source/role: `response_item:message`/`assistant` or
`response_item:agent_message`/`agent`. User messages, tools, empty text, final result
summaries and arbitrary status events return `not_artifact_message`. A reference is
not an assertion that its message is Markdown or an extracted artifact.

The projection uses an explicit metadata allowlist. It never returns message bodies,
result excerpts, tool arguments/results, cwd, model labels or parentSessionId. It does
not interpret Markdown, render HTML, follow links, open source paths, save files or
create new caches. The existing v1 captured content and retention remain unchanged.

The schemas and Core queries are covered by synthetic contract/runtime tests and
independent QA in separate files; see [testing](../development/testing.md). This is
not validation of provider process control, native artifact extraction or Desktop.

## Planned transport and broader lifecycle design

The remaining sections retain the broader design from
[ADRs 015–024](../architecture/decisions.md#adr-015--managed-execution-and-external-observation).
Their command/event envelope, other sources, managed states, delegation, permissions
and qualified metrics remain planned. The local slice above is not an implementation
of those event families. Do not emit it on `/ws`; publish transport negotiation and
authorization before exposing any future operation. No path is reserved here.

## Identities and ownership

All new identifiers are opaque strings, allocated by their authoritative owner.
Do not change existing v1 IDs to adopt this design.

| Identity                       | Meaning                                                                        |
| ------------------------------ | ------------------------------------------------------------------------------ |
| `machineId`                    | Local machine identity; does not establish remote authorization                |
| `workspaceId`                  | Local operational scope; a path alone is not a cross-machine identity          |
| `agentInstanceId`              | Managed worker or observed agent identity, distinct from a provider session    |
| `processInstanceId`            | One process lifetime; OS PID is an attribute, never this identity              |
| `terminalId`                   | Core-owned PTY/terminal resource, distinct from a client attachment            |
| `sessionRef`                   | `{ machineId, adapterId, nativeSessionId }`; native ID comes from the provider |
| `turnId`                       | Provider turn identity when exposed; unavailable otherwise                     |
| `taskId`, `parentTaskId`       | ORQST task and explicit parent; never inferred from prose                      |
| `requestId`, `attemptId`       | One command request and one execution attempt                                  |
| `eventId`                      | One durable fact, stable across retransmission                                 |
| `correlationId`, `causationId` | Workflow grouping and the exact request/event that caused a fact               |

Each session has `mode: observed | managed`. Observation grants no control.
Adopting an external session requires explicit user authorization, a validated
provider mechanism and conflict handling for an existing owner. Discovery does
not silently change mode. For managed work the Core owns operational state and
permissions; the provider owns its native conversation history.

## Independent lifecycle states

States describe different resources; never derive one state machine solely from
another. Every update records evidence, `occurredAt` and `observedAt` timestamps.
Timestamps are UTC ISO 8601; durations require monotonic time when measured locally.

| Resource         | States                                                                                                                     | Transition rules                                                                                                                                                                |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agent instance   | `available`, `busy`, `waiting_for_user`, `unavailable`, `unknown`                                                          | Provider/runtime evidence updates availability; inactivity is not completion                                                                                                    |
| Process          | `starting`, `running`, `stopping`, `exited`, `failed_to_start`, `unknown`                                                  | Start confirmation proves running; exit evidence records code/signal; restart allocates a new process identity                                                                  |
| Terminal         | `opening`, `attached`, `detached`, `closed`, `unavailable`                                                                 | A terminal is attached while at least one authorized client is attached; losing the last client detaches without stopping the process; close is an explicit lifecycle operation |
| Provider session | `discoverable`, `attached`, `detached`, `archived`, `unavailable`                                                          | History presence can prove discoverable; attachment requires adapter confirmation; archive is provider/user evidence, not idle time                                             |
| Turn             | `pending`, `running`, `waiting_for_user`, `completed`, `failed`, `interrupted`, `unknown`                                  | A provider starts and completes a turn; explicit approval/input requests cause waiting; completed turns are immutable outcomes                                                  |
| Task             | `created`, `queued`, `dispatched`, `running`, `waiting_for_user`, `completed`, `failed`, `cancelled`, `expired`, `unknown` | Admission creates a task; delivery dispatches it; provider evidence starts it; a validated result completes it                                                                  |

Task progression normally follows `created → queued → dispatched → running`.
Running work may enter and leave `waiting_for_user`. Terminal outcomes are
`completed`, `failed`, `cancelled` or `expired`, and require supporting evidence.
A deadline on active work requests cancellation; if its effect is unconfirmed,
the task becomes `unknown`, not safely expired. A delivery timeout also produces
`unknown` when admission or execution may have occurred. Reconciliation may resolve
unknown state. Retrying creates a new attempt under the same task with recorded
authorization; a terminal attempt is never rewritten as a fresh running attempt.

Connection health and client attachment are separate from task/process states.
Mark stale evidence and its last observation time instead of asserting liveness.
A process exit can interrupt a turn without proving a task succeeded. A provider
turn completing does not prove that the process exited or all task criteria passed.

The current `AgentStatus` and `SessionView.status` keep their v1 semantics.
Future UI projections must label which resource they describe and retain mappings
to v1 only where the evidence supports them.

## Event envelope

Required fields: `contract`, `contractVersion`, `eventId`, `type`, `machineId`,
`occurredAt`, `observedAt`, `correlationId`, `subject`, `source` and `data`.
`causationId`, `workspaceId`, `taskId`, `attemptId` and `sessionRef` are optional
only when the corresponding relation is genuinely unavailable or inapplicable.
The future parser must validate a type-specific `subject` and `data` shape.

Planned event families are `agent.state.changed`, `process.state.changed`,
`terminal.state.changed`, `session.state.changed`, `turn.state.changed`,
`task.state.changed`, `delegation.requested`, `delegation.accepted`,
`delegation.rejected`, `delegation.result`, `capabilities.reported`,
`metric.reported` and `permission.requested`/`permission.resolved`.
These names are not members of the implemented v1 enum.

Source is a discriminated reference:

| `source.kind`  | Required provenance                                                                           |
| -------------- | --------------------------------------------------------------------------------------------- |
| `file`         | Authorized source-root ID, relative path, byte offset, record hash and record type            |
| `provider`     | Adapter/version, native session reference, provider event ID or reproducible record reference |
| `runtime`      | Process-instance ID, Core instance and local observation sequence                             |
| `orchestrator` | Task/attempt/request identity and durable local operation reference                           |

Do not fabricate file offsets for API events. Source references remain local;
they are not Cloud metadata. File references must pass containment, symlink,
permission and fingerprint checks before dereferencing. No credential-bearing
URL may serve as provenance.

The following is a **synthetic design example**, not an event the app emits:

```json
{
  "contract": "orqst.lifecycle",
  "contractVersion": 1,
  "eventId": "example-event-1",
  "type": "task.state.changed",
  "machineId": "example-machine",
  "workspaceId": "example-workspace",
  "taskId": "example-task",
  "attemptId": "example-attempt",
  "occurredAt": "2026-11-02T12:00:00Z",
  "observedAt": "2026-11-02T12:00:00Z",
  "correlationId": "example-workflow",
  "causationId": "example-request",
  "subject": { "kind": "task", "id": "example-task" },
  "source": {
    "kind": "orchestrator",
    "taskId": "example-task",
    "attemptId": "example-attempt",
    "requestId": "example-request",
    "operationRef": "example-local-operation"
  },
  "data": { "previousState": "queued", "state": "dispatched" }
}
```

## Ordering, correlation and idempotency

- Preserve provider IDs and native correlation when present. Synthetic examples
  are documentation only; do not fabricate relationships in observed data.
- Persist event IDs independently of transport retries. A local sequence orders
  admission on one machine; it is not a global timestamp or cross-machine cursor.
- Command idempotency is scoped to principal, operation, destination and key.
  Repeating the same key and canonical payload returns its recorded admission or
  outcome. A different payload under that key is a conflict, not another command.
- Delivery acknowledgements and execution outcomes are separate facts. Persist
  admission and planned delivery durably before dispatch; retain an outbox/inbox
  record through retries, bounded by a documented retention policy.
- Duplicate suppression does not make external side effects exactly once.
  Unknown effects require reconciliation, not blind replay after a timeout.
- Reject stale transitions using resource version/attempt identity and explicit
  reconciliation rules; provider wall-clock timestamps alone are insufficient.

## Delegation requests and results

A delegation request contains `requestId`, `taskId`, optional `parentTaskId`,
`attemptId`, `correlationId`, `origin`, `destination`, `workspaceId`,
`inputRef`, `idempotencyKey`, `deadline`, `limits` and `permissionScopeId`.
Origin/destination identify an authorized agent instance and its native session
when known. `inputRef` points to local task content; it is not a transcript upload.

`limits` defines depth, fan-out, concurrency, attempts and budget. These limits
are checked by the Core, cannot expand inherited authority, and require explicit
configured bounds before delegation can be enabled. The orchestrator rejects
unauthorized destinations, ancestor loops and exhausted limits before dispatch.
Financial limits must distinguish measured and estimated spend; missing usage
cannot be interpreted as free execution or a hard budget guarantee.

Admission returns accepted or rejected with a stable request identity and reason.
An accepted request has not necessarily started. A result identifies the same
task/request/attempt and contains `state`, `completedAt`, `resultRef` when present,
evidence references and a bounded structured error when appropriate. Results may
resolve completed, failed, cancelled, expired or unknown execution; transport
success alone cannot produce `completed`.

Cancellation is a separate authorized command. It requests stopping work and
awaits evidence; losing a client is not cancellation. Results return through the
orchestrator and adapter channel, never by typing into another terminal.

Errors distinguish invalid contract, unsupported capability, unauthorized,
idempotency conflict, destination unavailable, limit exceeded, provider failure
and unknown execution. Do not expose credentials, full commands or captured
content in public error text. Exact wire error codes await implementation design.

## Capability discovery

Future discovery reports contract versions, adapter/provider versions, supported
session modes, per-operation support and evidence date/source. Operations include
observe, start, resume, interrupt, tool approval, terminal attach, task submission,
task results and metric collection. Report support as `supported`, `unsupported`
or `unverified`; missing entries are unsupported. A supported operation still
requires authorization and may be temporarily unavailable.

The implemented `AdapterDescriptor` booleans remain unchanged. Documentation
approval does not turn any existing flag on. A future implementation must test
the chosen provider version, discovery, normal operation, absence, malformed data,
replay, interruptions and permissions before claiming support.

## Permission scopes

Planned operation scopes include `observation.read`, `content.read`, `process.start`,
`process.stop`, `session.resume`, `terminal.attach`, `terminal.write`,
`task.delegate`, `approval.respond`, `history.cache` and `remote.connect`.

An authorized scope resolves at the Core to a principal, permitted operations,
machine/workspace/resource bounds, allowed working-directory roots, expiry,
revocation state and delegated limits. `permissionScopeId` is an opaque reference
to this Core-owned record, not a client declaration of authority. Validate grants
when admitting and when executing work; revocation blocks undispatched work and
triggers the documented policy for active work. An approval response is bound to
the exact pending provider request and resource, not an arbitrary session prompt.

Default deny applies to control. The observation bootstrap cookie cannot grant
these scopes. Native provider sandbox/approval policies remain in force.
Captured messages, model output, terminal escape sequences and adapter event
payloads are untrusted data, never permission grants. Core authentication and the
enforcement mechanism must be reviewed before any control endpoint is enabled.

## Metrics with quality and coverage

A metric identifies `name`, `unit`, `scope`, `window`, `quality`, `provenance` and
`coverage`. Scope includes the relevant machine, workspace, agent instance,
session, turn or task. Window records its start/end or explains a point snapshot.
Provenance identifies provider/model, source, measurement or estimator version,
and the observation time where applicable. Coverage says which intervals or
resources are represented and identifies gaps without inventing a percentage.

| `quality`     | Required payload                                                                             | Forbidden implication                                      |
| ------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `observed`    | Finite value, unit, source and time basis                                                    | Observed token usage is not automatically an observed bill |
| `estimated`   | Finite estimate, method, assumptions and input provenance; uncertainty bounds when justified | An estimate is not provider-reported spend                 |
| `unavailable` | Reason and missing evidence; no numeric value                                                | Missing measurement is not zero                            |

Examples of unavailable reasons: provider omission, missing timing, unknown model
or rate, incomplete coverage and insufficient comparable history. Known zero is
valid only as an observed or explicitly estimated zero with matching evidence.

Token counts and monetary amounts must be nonnegative; token counts must be safe
integers. Rate/duration values require a valid nonzero time denominator where
applicable.

Token measurements identify cumulative/incremental basis, provider cache-read and
cache-write semantics, response/turn identity and deduplication provenance.
Preserve ADR-005 for existing Codex totals; do not sum cumulative snapshots.
Changing models or rates within a session requires per-interval accounting before
costing it; the latest session model cannot price its whole history reliably.

USD values distinguish provider-reported cost, rate-based estimate and reconciled
billing data. Estimates include rate source, effective date and billing mode;
CLI subscription usage is not assumed to be pay-as-you-go API spend. Budgets must
state uncertainty and whether they can only alert or can enforce admission limits.

Tokens per second identify the output token count and measured generation interval;
session lifespan and tool wait time are separate metrics. Cost-to-completion and
remaining-time forecasts require a defined remaining-work scope, sufficient
comparable history and explicit assumptions. Otherwise report unavailable.
Do not claim a confidence level or calibrated interval without validation.

These quality fields do not exist in current `Usage`; v1 responses remain unchanged.
No estimator, price feed or quota checker is implemented by these lifecycle contracts.
The separate implemented Analytics endpoint is documented in [REST](rest.md).

## Implementation acceptance gate

Before implementing the remaining transport/control contracts, publish exact schemas, limits, transport
negotiation and authorization design for that phase. Add synthetic compatibility
fixtures without changing existing v1 semantics. Verify state transition legality,
missing evidence, unknown versions, duplicate/reordered delivery, permission
revocation, timeouts, cancellation and uncertain results. Test provider contracts
against explicitly authorized real sessions separately from fixtures and CI.

Phase 1 has implemented observer Core extraction, the qualified metric foundation
and the bounded local observation/reference slice above; the broader phase remains incomplete. This does not activate the planned
control protocol. See the [integration gate](../../ROADMAP.md#phase-1-compatibility-and-integration-gate)
and [Analytics design](../architecture/model-usage-analytics.md). The six-phase
sequence and incremental-development authorization supersede the original phase
gating; individual control operations still require scopes and provider evidence.

## Future structured host evidence — 2026-11-03

Private version-1 lifecycle receipts bind instance, original epoch, signed manifest
and config digests; records are prepared/armed/started/exit or spawn_failed. Their
read-only inspection is not a public API and cannot restore ownership or mutate
observed events. Journal feature schema 2 retains nullable numeric exit code with
an explicit signal for signal-only exits. Observer protocol and statuses are
unchanged. See [receipt semantics and limits](../development/codex-lifecycle-receipts.md).

## Desktop pre-Core retry boundary — 2026-11-03

Native pair creation is preparation, not a process/session/task lifecycle transition.
A Desktop opening failure can unlock fresh selection only with a native
`TerminalPreCoreFailure` after complete partial-view cleanup and no entry into
admission/Core. Admission inspection itself can write a directory and therefore
counts as a possible effect. Core/journal initialization, lost transport, cleanup
failure and unknown side effects keep the latch. This adds no retry/reconnect
operation to provider or observer APIs. Per-slot proved pre-spawn `start_failed`
recovery is a subsequent design/validation slice; `ownership_lost` remains reserved.
See [recovery mapping](../development/cli-team-recovery.md).
