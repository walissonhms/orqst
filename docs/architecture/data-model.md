# Data model

ORQST persists normalized observations in a single local SQLite database,
`orqst.db`, inside `ORQST_DATA_DIR` (default `~/.orqst`).

The implementation uses Node's built-in `node:sqlite` (`DatabaseSync`). There is
no native addon and no external database server.

## Current implementation and future design

This document's tables describe the implemented SQLite schema. Phase 0 adds no
migration, table, column or runtime retention change. Planned lifecycle records
below are logical responsibilities only, not SQL entities that already exist.

## Schema version

The schema is versioned with `PRAGMA user_version`. The repository currently
contains two migrations (current version 2). Migration 1 is unchanged. On startup:

- a database newer than the application refuses to open;
- older databases are upgraded inside a transaction, one version at a time;
- there is no downgrade path.

Any future schema change must add a new migration; existing migrations are
immutable. Migration 2 creates `analytics_evidence` and backfills only model/usage
records still present in `events`, in the same transaction as `user_version=2`.
It does not read native files or reconstruct deleted events from session summaries.
Failure rolls back the entire version-2 transaction and closes the failed connection;
reopening retries the migration. Existing tables, IDs, event sequence, settings,
checkpoints and canonical totals are not rewritten. There is no downgrade: an old
Store rejects schema 2. The read-only Analytics worker explicitly supports 1 and 2,
rejects other versions and never migrates.

Upgrade is a writer startup operation. Development checks use disposable databases
only. Applying it to an installed database requires owner integration after review,
a SQLite-aware backup and upgrade/replay tests. Backfill is synchronous and can take
time and disk/WAL space proportional to retained metric evidence; it is atomic, not
an online background migration.

## Tables

### `machines`

| Column       | Type          | Notes                                                      |
| ------------ | ------------- | ---------------------------------------------------------- |
| `id`         | TEXT PK       | Random UUID generated on first start, stored in `settings` |
| `created_at` | TEXT NOT NULL | ISO timestamp                                              |

### `workspaces`

| Column | Type          | Notes                                                  |
| ------ | ------------- | ------------------------------------------------------ |
| `id`   | TEXT PK       | `stableId('workspace', path)` for automatic workspaces |
| `name` | TEXT NOT NULL | Last path segment, or a manual label                   |
| `path` | TEXT NOT NULL | Working directory or a manual label                    |

`path` is not required to exist on disk. Manually created workspaces are labels
only; the API never performs filesystem operations on them.

### `agents`

| Column       | Type          | Notes                                               |
| ------------ | ------------- | --------------------------------------------------- |
| `id`         | TEXT PK       | Codex adapter uses `stableId(machineId, sessionId)` |
| `machine_id` | TEXT NOT NULL | References `machines(id)`                           |
| `name`       | TEXT NOT NULL | Observed nickname, agent path, or session prefix    |
| `adapter`    | TEXT NOT NULL | Provider ID, e.g. `codex`                           |

In the current Codex adapter there is one agent identity per session. The
`sessions` table stores a single `agent_id`, so a future adapter that needs
multiple agents per session would require a schema change.

### `sessions`

| Column              | Type                            | Notes                                                  |
| ------------------- | ------------------------------- | ------------------------------------------------------ |
| `id`                | TEXT PK                         | Provider session ID                                    |
| `agent_id`          | TEXT NOT NULL                   | References `agents(id)`                                |
| `workspace_id`      | TEXT NOT NULL                   | References `workspaces(id)`                            |
| `cwd`               | TEXT NOT NULL                   | Last observed working directory                        |
| `status`            | TEXT NOT NULL DEFAULT `unknown` | Normalized status                                      |
| `started_at`        | TEXT NOT NULL                   | Earliest observed event timestamp                      |
| `last_activity`     | TEXT NOT NULL                   | Latest observed event timestamp                        |
| `state_at`          | TEXT NOT NULL                   | Timestamp of the last accepted status change           |
| `task`              | TEXT                            | Latest observed user message, truncated to 2,000 chars |
| `result`            | TEXT                            | Latest captured final result                           |
| `model`             | TEXT                            | Last observed model identifier                         |
| `parent_session_id` | TEXT                            | Only when explicitly evidenced by the source           |
| `manual_workspace`  | INTEGER NOT NULL DEFAULT 0      | 1 when a user overrode the workspace                   |

Status values are limited to `running`, `waiting_for_user`, `completed`,
`failed`, `interrupted`, and `unknown`.

`state_at` prevents an older, out-of-order status event from overwriting newer
lifecycle evidence. `started_at` uses the minimum observed timestamp and
`last_activity` the maximum, so late-arriving older records do not move the
session window forward incorrectly.

### `events`

| Column       | Type                     | Notes                     |
| ------------ | ------------------------ | ------------------------- |
| `sequence`   | INTEGER PK AUTOINCREMENT | Monotonic stream cursor   |
| `id`         | TEXT NOT NULL UNIQUE     | Deterministic event ID    |
| `session_id` | TEXT NOT NULL            | References `sessions(id)` |
| `timestamp`  | TEXT NOT NULL            | Event time, ISO 8601      |
| `type`       | TEXT NOT NULL            | Normalized event type     |
| `envelope`   | TEXT NOT NULL            | Full validated JSON event |

Indexes:

- `events_session_sequence (session_id, sequence)`
- `events_timestamp (timestamp)`

The full event is stored as JSON so the protocol can evolve additively while
the indexed columns support ordering, filtering, and retention.

### `analytics_evidence` (schema 2)

| Column       | Type                 | Notes                                                                 |
| ------------ | -------------------- | --------------------------------------------------------------------- |
| `sequence`   | INTEGER PK           | Original event sequence; not an independent cursor                    |
| `id`         | TEXT UNIQUE NOT NULL | Original deterministic event ID; replay tombstone after detail expiry |
| `session_id` | TEXT NOT NULL        | References `sessions(id)`; deliberately no FK to `events`             |
| `timestamp`  | TEXT NOT NULL        | Original source event time                                            |
| `metadata`   | TEXT NOT NULL        | Explicit metric/identity/provenance JSON allowlist                    |

Indexes cover `(session_id, sequence)` and `timestamp`. Only events declaring a
model or usage produce rows. Metadata keeps original event, machine, agent, adapter,
session and workspace IDs; timestamp; source file/offset/line/hash/record type;
turn ID; model; usage, usage kind and response ID. No prompt, message, tool arguments,
tool results, cwd, task/result summary, credential block or arbitrary payload is
copied. Source paths and observed labels/IDs remain sensitive, untrusted local
metadata; a source reference does not grant permission to open that path. No new
provider identity, session mode, quality or baseline is inferred or persisted.
Current workspace assignment still governs Analytics filtering.

The table retains observations, not calculated deltas or a model assigned to an
entire session. It preserves rejected mirrors and conflicting declarations so replay
can apply the same conservative accounting and identity checks. Source disappearance
does not delete the observation or establish source availability. The original hash
and location remain evidence of what was observed, not proof the file still exists.

### `messages`

| Column       | Type          | Notes                                            |
| ------------ | ------------- | ------------------------------------------------ |
| `event_id`   | TEXT PK       | References `events(id)` with `ON DELETE CASCADE` |
| `session_id` | TEXT NOT NULL | References `sessions(id)`                        |
| `role`       | TEXT NOT NULL | `user`, `assistant`, `agent`, or `tool`          |
| `text`       | TEXT NOT NULL | Redacted, capped captured text                   |

Only `agent.message` events produce rows. Tool results remain events, not
messages.

### `token_usage`

| Column            | Type                       | Notes                                                        |
| ----------------- | -------------------------- | ------------------------------------------------------------ |
| `session_id`      | TEXT PK                    | References `sessions(id)`                                    |
| `input`           | INTEGER NOT NULL DEFAULT 0 | Cumulative input tokens                                      |
| `output`          | INTEGER NOT NULL DEFAULT 0 | Cumulative output tokens                                     |
| `cached`          | INTEGER NOT NULL DEFAULT 0 | Cumulative cached input tokens                               |
| `total`           | INTEGER NOT NULL DEFAULT 0 | Cumulative total                                             |
| `source_priority` | INTEGER NOT NULL DEFAULT 0 | `2` for thread-scoped records, `1` for compatibility mirrors |
| `timestamp`       | TEXT NOT NULL              | Timestamp of the accepted snapshot                           |

One row per session holds the latest accepted cumulative snapshot. Individual
snapshots remain available as `agent.tokens.updated` events.

### `notifications`

| Column       | Type                       | Notes                                            |
| ------------ | -------------------------- | ------------------------------------------------ |
| `id`         | TEXT PK                    | References `events(id)` with `ON DELETE CASCADE` |
| `session_id` | TEXT NOT NULL              | References `sessions(id)`                        |
| `type`       | TEXT NOT NULL              | Event type that triggered the alert              |
| `timestamp`  | TEXT NOT NULL              | Event time                                       |
| `is_read`    | INTEGER NOT NULL DEFAULT 0 | Read flag                                        |

Notifications are created only for **live** `agent.completed`,
`agent.failed`, and `agent.intervention.required` events. Imported history does
not raise alerts.

### `settings`

| Column  | Type          | Notes              |
| ------- | ------------- | ------------------ |
| `key`   | TEXT PK       | Setting name       |
| `value` | TEXT NOT NULL | JSON-encoded value |

Known keys:

- `machineId` — random UUID created on first start;
- `notifications` — validated notification preferences
  (`sound`, `completed`, `failed`, `intervention`).

Defaults: sound `false`, the three event categories `true`.

### `synchronization_state`

| Column     | Type             | Notes                                                      |
| ---------- | ---------------- | ---------------------------------------------------------- |
| `source`   | TEXT PK          | Adapter source key, e.g. `root + ':' + relativeFile`       |
| `offset`   | INTEGER NOT NULL | Committed byte offset                                      |
| `line`     | INTEGER NOT NULL | Committed line number                                      |
| `identity` | TEXT NOT NULL    | File identity (`dev:ino`)                                  |
| `anchor`   | TEXT NOT NULL    | SHA-256 of up to 64 bytes ending at `offset`               |
| `state`    | TEXT NOT NULL    | JSON adapter state (session identity, cwd, turn IDs, etc.) |

Despite the name, this table is **local read-checkpoint state**, not Cloud
synchronization. A future sync feature must not reuse it without a new design.

## Ingestion invariants

`Store.ingest(event, live)` runs in a transaction:

1. Validate the event with `eventSchema`; reject anything invalid.
2. Deduplicate by `events.id` and `analytics_evidence.id`. A duplicate returns
   `undefined` and changes nothing, including after metric detail expiry.
3. Upsert machine, workspace, agent, and session rows as needed.
4. Insert the event and obtain its monotonic `sequence`; insert its compact
   evidence, when applicable, in this same transaction.
5. Update session window (`started_at`, `last_activity`), cwd, parent, model,
   status, task, and result only under their timestamp guards.
6. Insert a message row for `agent.message` with a role and text.
7. Upsert cumulative token usage when `usageKind` is `session_cumulative`.
8. Create a notification only when `live` is true and the event is a completion,
   failure, or intervention request with its notification category enabled.
9. Return the stored event with its sequence.

Any failure rolls back the entire transaction, including the event row.

## Token accounting

The rules exist to prevent the double counting that is common when a provider
exposes several overlapping usage records.

- Only `usageKind: "session_cumulative"` updates `token_usage`. Incremental
  response usage and turn usage are preserved in the event payload but are not
  added to session totals.
- A thread-scoped `token_usage_record` has priority `2`. The
  `event_msg/token_count` compatibility mirror has priority `1`.
- A snapshot replaces the stored row only when its total is greater than or
  equal to the stored total **and** its timestamp is not older. This keeps
  late-arriving stale snapshots from reducing totals. At equal totals a lower-priority mirror cannot replace a higher-priority snapshot. A later larger mirror can advance the total.
- `cached` is a subset of `input`. It is displayed separately and never added
  to the total.
- The normalizer rejects impossible usage: negative values, non-integers,
  `cached > input`, or `total != input + output`.
- `Store.totals()` sums the one-row-per-session table. It never sums event
  payloads, so replayed events cannot inflate totals.

Consequences:

- A session total means "the largest cumulative snapshot observed", not "the
  sum of every record".
- Turn-level usage contributes no canonical totals. Compact evidence retains only
  the primary `usage` and its `usageKind`, not auxiliary turn/response usage fields.
- There is no cost, budget, quota, or context-window calculation.

## Retention

`Store.retain()` deletes events whose timestamp is older than
`now - ORQST_RETENTION_DAYS` days.

Because `messages.event_id` and `notifications.id` reference `events(id)` with
`ON DELETE CASCADE`, expired details and their notifications are removed
together.

Retained after detail expiry:

- sessions and their summaries (`task`, `result`, status, timestamps),
- token totals and compact metric/model evidence,
- workspaces, agents, machines,
- read checkpoints.

The event cursor is derived from `sqlite_sequence` and is not reset by deletion,
so clients never see a cursor move backwards after retention runs.

Retention runs once at startup and then hourly. Store migration/backfill finishes
before Core performs startup retention, so existing rows are captured before their
details expire. Compact metric/model evidence has
**no automatic time expiry**, matching retained session identities and cumulative
totals (ADR-009, extended by ADR-028). `ORQST_RETENTION_DAYS` continues to govern
only details. This is local metric history, not a transcript cache. It grows with
model/usage observations; query budgets limit reads, not database size. There is no
new selective purge API or implicit eviction. Removing local storage is an explicit
owner operation; backups retain their own copies and are never rewritten by retention.
A separate finite metric TTL or selective erasure/compaction policy needs product
approval and missing-baseline handling; it is not silently enabled here.

## Filesystem hardening

For a file-backed database:

- the parent directory is created with mode `0700` if missing;
- the parent directory must not be a symlink;
- the database file must not be a symlink;
- the directory is forced to `0700` and the database file to `0600`;
- the process sets `umask(0o077)` before opening the store.

`:memory:` databases used by tests skip these filesystem checks.

## Backup and recovery

See [../deployment/operations.md](../deployment/operations.md). In short: stop
the bridge before copying the database, or use a SQLite-aware backup that
includes the WAL. Deleting the database loses local history; Codex sessions are
re-read on the next scan because the source files are untouched.

## Planned operational records and history references

Future implementation phases may add logical records for resource identities,
process observations, terminal/layout attachments, tasks/attempts, durable
inbox/outbox delivery, local grants, source references and qualified metrics.
Exact table names, columns, indexes and migrations must be designed and reviewed
with compatibility/recovery review. Core extraction alone does not require them;
the Phase 1 Analytics foundation may need additive metric storage and migrations,
which remain in progress until integration. Do not interpret that work as a completed
schema change on this page.

Preserve one SQLite writer. Do not reinterpret existing v1 agent IDs (currently
session-derived) as stable worker identities, or local path-derived workspace IDs
as global project IDs. Qualify native session references by provider and machine.
Local sequence numbers are not cross-machine clocks. Provider record IDs and
operation/event IDs are different deduplication domains.

Native history remains the source of conversation content. A future reference
records an authorized source identity and verifiable record location/ID; missing
or changed sources become unavailable. Read content only within granted roots and
validated adapter boundaries. Avoid duplicating complete transcripts in event
payloads, message tables, results and terminal buffers. Source paths, hashes and
excerpts are sensitive local data, not Cloud metadata.

New transcript caches default to disabled. Before enabling them, define byte and
lifetime bounds, purge/eviction, source disappearance, permission revocation and
backup handling. Summary/result text is also content and needs an explicit
policy. Current retention keeps summaries after detail expiry; this design does
not alter that behavior or erase existing copies.

Any future migration must preserve original data, machine identity, IDs,
checkpoints and aggregate accounting; back up and validate replay/integrity before
changing content storage. Do not rewrite historical migration 1 or native agent
history. A lost source is not silently reconstructed from Cloud.

Qualified metrics must distinguish unavailable data from measured zero and retain
scope, timing, source, provider/model and estimator/rate provenance. Changing a
session's model does not justify pricing its entire history at the latest rate.
See [planned contracts](../api/lifecycle-contracts.md) and ADRs 017, 020 and 023 in
[architecture decisions](decisions.md).

## Durable Analytics accounting boundary

`Store.modelAnalytics()` and the worker replay compact metric/model observations,
using retained events as a compatibility fallback. Each record is read once.
Retained event envelopes still consume the original admission budget; after detail
expiry their compact metadata consumes it instead. The read-only worker uses a
separate WAL snapshot, bounds evidence before JSON parsing, and projects only
allowlisted metadata. Only aggregate counts/totals cross its boundary. No derived
attribution is written. See the [API contract](../api/rest.md#get-apianalyticsmodels).

Schema-1 details removed before upgrade are unavailable forever unless separately
observed from an existing authorized source by normal ingestion. Migration does not
reset checkpoints or trigger a source rescan. A surviving `token_usage` row or latest
`sessions.model` cannot seed a compact measurement or baseline. Missing canonical
evidence remains a gap; a first retained positive snapshot stays an unidentified
unbounded snapshot, and windows without a contained baseline omit its usage.
Subsequent detail retention preserves the evidence already captured in schema 2,
including model changes and identity conflicts. Cache subsets, mirror priority,
unknown models, unavailable metrics and all v1 transport/accounting shapes remain.
Coverage remains unverified, never upgraded to complete by migration.

## Local lifecycle/reference projections

The Phase 1 Core queries project one retained `events.envelope` by exact sequence;
there is no lifecycle/artifact table, migration or secondary writer. Migrations 1/2,
v1 IDs and cumulative metric accounting are unchanged. Missing/expired events produce
`event_not_retained`; session summaries and durable `analytics_evidence` are never
used to recreate message references. References do not extend retention or guarantee
that a native source file still exists. No captured body enters the new projections.
See [local lifecycle contracts](../api/lifecycle-contracts.md).

## Manual Artifacts memory-only slice

Manual extraction adds no table, migration, writer or retained content cache. It reads
one existing exact event and preserves its reference/body together. An expired event
stays unavailable even when session summaries or durable metric evidence survive.
The dashboard's separate draft exists only in memory, with no draft history or saved
document revision. “Original” denotes retained redacted text of unverified completeness;
the source hash identifies the original record, not a saved Markdown file. See
[Artifacts](../api/artifacts.md).

## Confirmed session metric projection

Live Metrics reads existing canonical totals and durable compact evidence in one bounded
read snapshot. It adds no schema, writer, persisted cache or source access. It preserves
detail retention and replay deduplication. Historical source workspace differs from a
manual current association; occurrence differs from observation time. Normalized cache/
total defaults cannot be distinguished from explicit provider fields in schema 2.
See [selection, provenance and unavailable semantics](../api/live-metrics.md).

## Observed usage evolution projection

The additive [evolution read](../api/analytics-evolution.md) folds the same canonical
contributions into up to 64 adaptive UTC windows by interval end. Unbounded first
snapshots remain separately undistributed; null windows never imply zero. The four
usage components reconcile to the accompanying aggregate from the same WAL snapshot.
This projection changes no table, migration, checkpoint, retention or token admission
rule. Window timing is not a measured daily consumption distribution.

## Opt-in owned-terminal metadata journal — 2026-11-03

Explicit trusted `Store.terminalJournal` composition initializes `terminal_schema`
(feature version 1), `terminal_owner` (one epoch) and `terminal_attempts` in the
existing SQLite writer. Observer schema version 2, events, checkpoints, canonical
usage and Analytics remain unchanged. Normal startup does not create these tables.
Strict runtime metadata and SQL consistency checks retain instance/epoch/client/project
references, manifest digest, lifecycle/timestamps and confirmed exit metadata only.
No source session, process PID, transcript, input, argv, credential or grant is stored.

Preparation and atomic admission commit before the backend start. Recovery fences
the old epoch, fails unstarted preparations and retains started/live work as
`ownership_lost`; it never adopts, signals or restarts. Lost rows reserve the two-global,
one-per-project admission budget. Only exited/start-failed rows older than 30 days
can be pruned on preparation; at 10,000 attempts preparation fails. Existing
supervisor memory bounds remain. See [contract, tests and limitations](../development/terminal-recovery.md).
