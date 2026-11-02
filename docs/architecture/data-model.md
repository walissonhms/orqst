# Data model

ORQST persists normalized observations in a single local SQLite database,
`orqst.db`, inside `ORQST_DATA_DIR` (default `~/.orqst`).

The implementation uses Node's built-in `node:sqlite` (`DatabaseSync`). There is
no native addon and no external database server.

## Schema version

The schema is versioned with `PRAGMA user_version`. The repository currently
contains exactly one migration (version 1). On startup:

- a database newer than the application refuses to open;
- older databases are upgraded inside a transaction, one version at a time;
- there is no downgrade path.

Any future schema change must add a new migration; existing migrations are
immutable.

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
2. Deduplicate by `events.id`. A duplicate returns `undefined` and changes
   nothing.
3. Upsert machine, workspace, agent, and session rows as needed.
4. Insert the event and obtain its monotonic `sequence`.
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
- Turn-level usage is available only when the source record carries it and the
  event remains inside the retention window.
- There is no cost, budget, quota, or context-window calculation.

## Retention

`Store.retain()` deletes events whose timestamp is older than
`now - ORQST_RETENTION_DAYS` days.

Because `messages.event_id` and `notifications.id` reference `events(id)` with
`ON DELETE CASCADE`, expired details and their notifications are removed
together.

Retained after detail expiry:

- sessions and their summaries (`task`, `result`, status, timestamps),
- token totals,
- workspaces, agents, machines,
- read checkpoints.

The event cursor is derived from `sqlite_sequence` and is not reset by deletion,
so clients never see a cursor move backwards after retention runs.

Retention runs once at startup and then hourly.

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
