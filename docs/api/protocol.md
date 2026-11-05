# Event protocol

The ORQST protocol is the provider-independent contract between adapters, the
database, the bridge, and the dashboard. It is defined with zod in
`packages/protocol/src/index.ts` and validated at runtime.

## Phase 0 compatibility boundary

This page describes the implemented observation protocol. Phase 0 does not change
`packages/protocol`, `schemaVersion: 1`, existing event names/statuses, file source
fields or REST/WebSocket behavior. Approved future lifecycle and control semantics
are documented separately in [lifecycle contracts](lifecycle-contracts.md). The additive
Phase 1 local schemas/Core queries validate observed-session evidence and artifact
references under their own namespace. Neither these projections nor the future event
families are accepted by `eventSchema` or emitted by the bridge.

## Design rules

- One normalized event describes one observed fact.
- Every event keeps enough source metadata to trace it back to the provider
  record.
- Event IDs are deterministic for a given source record so ingestion is
  idempotent.
- Status and relationships are never inferred from prose, timing, or
  inactivity.
- The protocol is additive where possible. Breaking changes require a schema
  version bump.
- Payload text is untrusted and already redacted/truncated by the adapter. The
  schema does not enforce redaction; it is a producer obligation.

## Envelope

```ts
interface AgentEvent {
  schemaVersion: 1;
  id: string;
  type: EventType;
  timestamp: string; // ISO 8601 with timezone
  adapter: 'codex' | 'claude' | 'opencode' | 'manual';
  machineId: string;
  workspaceId: string;
  sessionId: string;
  agentId: string;
  correlation: {
    turnId?: string;
    rootTurnId?: string;
    callId?: string;
  };
  source: {
    file: string;
    offset: number; // non-negative integer
    line: number; // non-negative integer
    hash: string;
    recordType: string;
  };
  payload: EventPayload;
}
```

`StoredEvent` is an `AgentEvent` plus a `sequence: number` assigned by SQLite.

### Field notes

- `schemaVersion` is the literal `1`.
- `id` must be unique. The Codex adapter derives it with `stableId(...)` over
  adapter, machine, session, record type, a record discriminator, and event
  type.
- `timestamp` is normalized to ISO 8601. Records with an unparseable timestamp
  are dropped by the adapter.
- `adapter` includes `manual` for future non-provider input. No current adapter
  emits it.
- `machineId` is a random UUID persisted in `settings`.
- `workspaceId` is derived from the working directory for automatic
  workspaces, or chosen by the user for a manual association.
- `agentId` identifies the observed agent. The Codex adapter uses
  `stableId(machineId, sessionId)`.
- `correlation` carries turn and tool-call identifiers when the source exposes
  them. It does not imply a cross-session relationship.
- `source.file` is a relative source identifier. For Codex it is relative to
  the session root, using `/` separators.
- `source.offset` and `source.line` locate the record. `source.hash` is a
  content hash. `source.recordType` identifies the provider record shape, for
  example `response_item:message` or `event_msg:task_complete`.

## Event types

```ts
type EventType =
  | 'session.started'
  | 'session.updated'
  | 'session.completed'
  | 'agent.started'
  | 'agent.updated'
  | 'agent.completed'
  | 'agent.failed'
  | 'agent.message'
  | 'agent.tool.started'
  | 'agent.tool.completed'
  | 'agent.intervention.required'
  | 'agent.tokens.updated'
  | 'workspace.updated';
```

| Type                          | Meaning                                             |
| ----------------------------- | --------------------------------------------------- |
| `session.started`             | A session was discovered.                           |
| `session.updated`             | Session-level metadata changed, e.g. the model.     |
| `session.completed`           | A session-level completion was explicitly observed. |
| `agent.started`               | A turn or agent activity started.                   |
| `agent.updated`               | Agent state changed without a completion/failure.   |
| `agent.completed`             | The latest observed turn completed.                 |
| `agent.failed`                | An explicit failure was observed.                   |
| `agent.message`               | A user, assistant, or agent message was captured.   |
| `agent.tool.started`          | A tool call started.                                |
| `agent.tool.completed`        | A tool call returned.                               |
| `agent.intervention.required` | The source explicitly requested user input.         |
| `agent.tokens.updated`        | A token usage snapshot was observed.                |
| `workspace.updated`           | Workspace metadata changed.                         |

The Codex adapter currently emits every type except `session.completed` and
`workspace.updated`. It does not emit `session.completed` because a Codex
`task_complete` is a turn completion, not proof that the session or process
ended.

## Payload

```ts
interface EventPayload {
  status?: 'running' | 'waiting_for_user' | 'completed' | 'failed' | 'interrupted' | 'unknown';
  text?: string;
  role?: 'user' | 'assistant' | 'agent' | 'tool';
  phase?: string;
  name?: string;
  callId?: string;
  model?: string;
  cwd?: string;
  parentSessionId?: string;
  agentName?: string;
  recipient?: string;
  result?: string;
  usage?: Usage;
  usageKind?: 'session_cumulative' | 'response_incremental' | 'turn_cumulative';
  responseId?: string;
  turnUsage?: Usage;
  responseUsage?: Usage;
}
```

All fields are optional; an empty payload is valid. Unknown fields are stripped
by zod rather than persisted.

| Field             | Used for                                             |
| ----------------- | ---------------------------------------------------- |
| `status`          | Normalized lifecycle state carried by the event      |
| `text`            | Message, tool input, tool output, error text         |
| `role`            | Message author category                              |
| `phase`           | Provider phase, e.g. `final_answer`                  |
| `name`            | Tool name or agent name                              |
| `callId`          | Tool-call correlation                                |
| `model`           | Model identifier                                     |
| `cwd`             | Working directory                                    |
| `parentSessionId` | Explicit parent session, when evidenced              |
| `agentName`       | Display name for the agent                           |
| `recipient`       | Message recipient label, when the source exposes one |
| `result`          | Final or delivered result text                       |
| `usage`           | Token snapshot                                       |
| `usageKind`       | Semantics of `usage`                                 |
| `responseId`      | Provider response identifier                         |
| `turnUsage`       | Turn-scoped usage, when separately available         |

`responseUsage`, when present on a Codex token event, is incremental usage for the provider response. `turnUsage` is turn-cumulative; `usage` is session-cumulative. Neither supplemental field is added to session totals.

## Usage semantics

```ts
interface Usage {
  input: number; // non-negative integer
  output: number; // non-negative integer
  cached: number; // non-negative integer, subset of input
  total: number; // non-negative integer
}
```

The schema enforces non-negative integers. Producers must also enforce:

- `cached <= input`;
- `total === input + output`;
- no double counting across overlapping records.

`usageKind` tells the store what the numbers mean:

- `session_cumulative` — a cumulative session snapshot. Only this kind updates
  `token_usage`.
- `response_incremental` — incremental usage for one response. Preserved in the
  event, not added to totals.
- `turn_cumulative` — cumulative usage for one turn. Preserved in the event,
  not added to totals.

The Codex adapter emits `session_cumulative` snapshots and attaches
`turnUsage` separately when available. See
[../architecture/data-model.md](../architecture/data-model.md) for the
priority and replacement rules.

## Status semantics

- `running` — explicit activity evidence;
- `waiting_for_user` — explicit request for input;
- `completed` — explicit turn completion;
- `failed` — explicit failure;
- `interrupted` — explicit interruption;
- `unknown` — discovered but no lifecycle evidence.

Inactivity never changes a status. A late, older status event cannot overwrite
newer evidence; the store compares timestamps.

## Persistence and replay

- The full validated event is stored as JSON in `events.envelope`.
- `id`, `session_id`, `timestamp`, and `type` are duplicated into indexed
  columns.
- `sequence` is a monotonic SQLite autoincrement value and is the stream
  cursor.
- `events.id` is unique; duplicate ingestion returns no new event.
- Replay reads events in ascending sequence order.
- Retention can delete old events, but the cursor does not move backwards.

## Adapter descriptors

```ts
interface AdapterCapabilities {
  sessionDiscovery: boolean;
  realtimeEvents: boolean;
  messages: boolean;
  toolCalls: boolean;
  subagents: boolean;
  tokenUsage: boolean;
  taskResults: boolean;
  userIntervention: boolean;
  remoteControl: boolean;
}

interface AdapterDescriptor {
  id: string;
  implemented: boolean;
  capabilities: AdapterCapabilities;
  evidence: string;
}
```

A capability is `true` only after validation against real source data. See
[../adapters/capability-model.md](../adapters/capability-model.md).

## Read models

The API and dashboard use derived read models, not raw tables:

```ts
interface SessionView {
  id: string;
  workspaceId: string;
  cwd: string;
  agentName: string;
  adapter: string;
  status: AgentStatus;
  startedAt: string;
  lastActivity: string;
  task: string | null;
  result: string | null;
  model: string | null;
  parentSessionId: string | null;
  usage: Usage;
  manualWorkspace: boolean;
}

interface WorkspaceView {
  id: string;
  name: string;
  path: string;
  sessions: number;
  usage: Usage;
}

interface NotificationView {
  id: string;
  sessionId: string;
  type: string;
  timestamp: string;
  read: boolean;
}
```

`Snapshot` combines the cursor, workspaces, sessions, the latest 150 events, up
to 200 notifications, preferences, adapter descriptors, and diagnostics.

## Stream messages

```ts
type StreamMessage =
  | { type: 'event'; event: StoredEvent; live: boolean }
  | { type: 'ready'; cursor: number }
  | { type: 'resync'; cursor: number };
```

See [websocket.md](websocket.md).

## Versioning policy

- `schemaVersion` is currently `1`.
- Additive optional payload fields and new event types are non-breaking in
  storage but require updating the enum, the dashboard locale files, and this
  document.
- Removing a field, changing a field's meaning, or changing token semantics is
  breaking and requires a new schema version plus a migration or compatibility
  path.
- The database stores the envelope as JSON, so old events remain readable after
  additive changes.
- Adapters must validate before ingestion; invalid events are rejected, never
  stored partially.

## Synthetic example

The following is synthetic and illustrative only. It is not captured user
activity.

```json
{
  "schemaVersion": 1,
  "id": "synthetic-event-id",
  "type": "agent.completed",
  "timestamp": "2026-11-02T15:00:00.000Z",
  "adapter": "codex",
  "machineId": "synthetic-machine",
  "workspaceId": "synthetic-workspace",
  "sessionId": "synthetic-session",
  "agentId": "synthetic-agent",
  "correlation": { "turnId": "synthetic-turn" },
  "source": {
    "file": "synthetic.jsonl",
    "offset": 0,
    "line": 1,
    "hash": "synthetic-hash",
    "recordType": "event_msg:task_complete"
  },
  "payload": {
    "status": "completed",
    "result": "Synthetic result"
  }
}
```

## Confirmed Live Metrics read contract

Confirmed session Live Metrics uses a separate version-1 `orqst.live-metrics` read
contract. It validates canonical normalized usage against compact source evidence;
it does not add event fields, stream messages or provider field-presence claims.
See [metric provenance, occurrence time and unavailable values](live-metrics.md).

## Local model Analytics contract

`modelAnalyticsQuerySchema` and `ModelAnalyticsReport` are additive exports from
`@orqst/protocol`, used by the local `Store.modelAnalytics()` library method. The report
identifies itself as `orqst.model-analytics`, `contractVersion: 1`; the full report
stays local. `ModelAnalyticsSummary` is its aggregate transport projection for
[`GET /api/analytics/models`](rest.md#get-apianalyticsmodels), omitting individual
contributions and replacing evidence-bearing gaps with reason/count pairs. It does
not change existing REST payloads or WebSocket messages.
See the [implemented foundation](../architecture/model-usage-analytics.md#implemented-local-foundation)
for filters, interval semantics, provenance and coverage limitations. Source references
can contain private paths and require an export allowlist before external reporting.

Current `Usage` numeric defaults and nullable `SessionView.model` do not establish metric
coverage, a measured zero, task success or historical model allocation. Qualified
projections must retain source/time/basis, unavailable reasons and
unidentified models without changing existing cumulative/cache semantics. No metric
or lifecycle family may be silently inserted into the closed v1 stream.
The new route has authentication, bounds, privacy and compatibility tests. No existing
v1 event or message is extended by this projection.

## Partial session model history contract

`orqst.session-model-history` version 1 is a separate strict local read projection.
It carries nullable original identifiers, normalized-event times, compact sequence and
source hash/type only; coverage is always partial. It adds no v1 event fields or stream
messages and makes no model declaration/use/current-state claim. See the
[contract](model-history.md).

## Private owned-terminal journal metadata — 2026-11-03

`terminalAttemptSchema` and `terminalStateSchema` define strict experimental library
metadata, separate from `eventSchema` and observed agent statuses. Instance/epoch
are random UUIDs; client/project references are bounded; the manifest is represented
only by its SHA-256 digest. States are prepared, starting, running, exited,
start_failed and ownership_lost. Exit metadata is allowed and required only for
exited records; timestamps describe journal facts, never inferred provider events.
`TerminalJournal` is a private synchronous writer interface, not a network/IPC API.
No existing wire field or observation capability changes. See
[durable recovery](../development/terminal-recovery.md).

## Feature agent permission metadata — v1

`feature-permissions.ts` exports strict configuration/rule, operation, state, save
and audit schemas. Operations are `delegate | execute | view`, scoped to an exact
directed source/target stable terminal UUID pair within an existing Feature.
No roles, wildcards or runtime authority are stored. Missing row is revision 0/null
and neutral to current authorization; saved empty rules deny all operations.
A non-null configuration requires positive revision. Unknown/corrupt/future scope
never receives the missing-row default. Save is expectedRevision CAS with atomic
versioned `feature.permissions.updated` metadata audit, not an observed event.
See [fields, bounds and enforcement](../development/v6-feature-permissions.md).
This adds no HTTP/RPC/MCP/native transport command or observer event type.
