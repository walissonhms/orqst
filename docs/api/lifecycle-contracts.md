# Planned lifecycle contracts

## Status and compatibility

**Phase 0 design only. No runtime schemas, exported TypeScript types, endpoints,
database tables or capabilities are added by this document.** See
[ADRs 015–024](../architecture/decisions.md#adr-015--managed-execution-and-external-observation)
and [ROADMAP](../../ROADMAP.md).

The implemented [event protocol](protocol.md) remains `schemaVersion: 1`.
Its event names, adapter enum, source fields, statuses, REST responses and `/ws`
messages remain unchanged. Existing clients continue observing Codex normally.

Future lifecycle messages use a separate `contract: "orqst.lifecycle"` namespace
and `contractVersion: 1`. This is not `schemaVersion: 2` of the observation stream.
Do not emit these messages on the existing `/ws` channel. A later implementation
must negotiate contract versions and capabilities explicitly, select a transport,
and publish its wire specification before exposing commands. No path is reserved
or implemented here. Unknown required contracts are rejected before side effects;
optional unknown fields may only be ignored where that contract permits them.

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
No estimator, price feed, quota checker or metric endpoint is implemented here.

## Implementation acceptance gate

Before implementing these contracts, publish the exact schemas, limits, transport
negotiation and authorization design for that phase. Add synthetic compatibility
fixtures without changing existing v1 semantics. Verify state transition legality,
missing evidence, unknown versions, duplicate/reordered delivery, permission
revocation, timeouts, cancellation and uncertain results. Test provider contracts
against explicitly authorized real sessions separately from fixtures and CI.

The updated Phase 1 covers observer Core extraction and the qualified metric
foundation, both in progress pending integration. This does not activate the planned
control protocol. See the [integration gate](../../ROADMAP.md#phase-1-compatibility-and-integration-gate)
and [Analytics design](../architecture/model-usage-analytics.md). The six-phase
sequence and incremental-development authorization supersede the original phase
gating; individual control operations still require scopes and provider evidence.
