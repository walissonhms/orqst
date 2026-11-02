# REST API

> **Current observation API.** The aggregate Analytics route below is additive;
> existing observation routes and WebSocket messages retain their shapes. The
> [planned lifecycle contracts](lifecycle-contracts.md) define future semantics,
> not implemented control endpoints or new messages on the current stream.

The bridge exposes a small JSON API on the loopback interface. It is intended
for the bundled dashboard; it is not a public API and has no versioned path.

- Base URL: `http://127.0.0.1:<ORQST_PORT>` (default `4317`)
- Content type: `application/json; charset=utf-8`
- Authentication: per-process session cookie, except `/api/bootstrap`
- Transport: plain HTTP on loopback only; no TLS

## Bootstrap and authentication

### `GET /api/bootstrap`

Issues the local session cookie.

- Requires a trusted `Host` and consistent `Origin`/`Sec-Fetch-Site`.
- Does not require an existing cookie.
- Sets `orqst_session=<random>` with `HttpOnly`, `SameSite=Strict`, `Path=/`.
- The secret is random per bridge process. Restarting the bridge invalidates
  old cookies.
- Returns `200 {"version":"0.1.0","local":true}`.

```bash
curl -i -c cookies.txt http://127.0.0.1:4317/api/bootstrap
```

Every other `/api/*` route requires the cookie. Missing or invalid cookies
return `401 {"error":"unauthorized"}`.

A request with an untrusted `Host`, a mismatched `Origin`, or a cross-site
`Sec-Fetch-Site` returns `403 {"error":"forbidden_origin"}` before routing.

## Read endpoints

### `GET /api/analytics/models`

Returns `ModelAnalyticsSummary`, an aggregate projection identified by
`contract: "orqst.model-analytics"`, `contractVersion: 1`. It requires the same
trusted Host/Origin/fetch metadata and process cookie as other read endpoints.
It grants no agent control and does not extend the v1 WebSocket stream.

| Parameter      | Meaning / validation                                                   |
| -------------- | ---------------------------------------------------------------------- |
| `from`, `to`   | Optional ISO instants with offset; `from < to`; half-open window       |
| `workspaceId`  | Current workspace assignment; exact nonempty ID, at most 200 chars     |
| `agentId`      | Exact nonempty observed agent ID, at most 200 chars                    |
| `adapter`      | `codex`, `claude`, `opencode` or `manual`; CLI identity, not vendor    |
| `model`        | Nonempty observed model ID, at most 200 chars                          |
| `unidentified` | Only `true`; selects unidentified attribution; incompatible with model |

Omitting model filters includes all models. Unknown/duplicate keys, invalid values,
conflicting filters and query strings longer than 2048 characters return
`400 {"error":"invalid_query"}`. No calendar preset or inferred vendor filter is
accepted; clients resolve calendar dates to explicit instants.

The response includes query/basis, nullable aggregate usage, observed session count,
model rows (`adapter`, nullable `provider`/`model`, sessions and nullable usage),
coverage with gap counts, and explicit unavailable reasons. Session counts are
non-additive across model rows. Coverage is unverified; a first lifetime snapshot
does not establish historical model attribution, and retained intervals crossing
the lower boundary are omitted with a gap. See [accounting semantics](../architecture/model-usage-analytics.md#implemented-local-foundation).

The HTTP projection omits contribution details, event/session identifiers, source
paths, hashes, messages and task/result content. Workspace/agent filter IDs and
observed model labels remain metadata. This local response is not yet a user-facing
CSV/Markdown export format.

Queries run in a disposable Node worker with a separate **read-only SQLite WAL
snapshot**. The observer remains the only writer. SQLite projects metric, identity
and provenance metadata; messages, tool arguments, task/results and cwd are never
materialized in JavaScript for this query. Only the aggregate allowlist crosses
back to the bridge. Evidence is folded one session at a time.

The reader explicitly supports database schemas 1 and 2 without migrating or
writing. Schema 2 preserves compact metric/model evidence after detail expiry;
schema-1 evidence already deleted before upgrade remains unavailable. The response
shape, coverage qualification and conservative interval/model attribution are unchanged.

Fixed admission limits are **5000 candidate sessions, 250000 evidence records,
256 MiB of UTF-8 evidence bytes, 8 MiB per record and 64 MiB of projected metric
metadata and 2 MiB of aggregate response**. Envelope admission happens before JSON inspection; projected bytes
are checked before parsing each metadata record. The worker checks aggregate response
bytes before transferring a result to the observer. All selected history counts,
including retained message-only records, durable records whose details expired and
out-of-window baselines. A record counts once: its retained envelope consumes bytes
until detail expiry, then compact metadata does. No new unbounded query path is added. A narrower
workspace/agent/adapter scope may help; a narrower period still needs retained
baselines and a model filter does not reduce admission scope.

One query runs at a time per bridge, with **no queue**. A **10-second watchdog**
covers setup, worker startup, reading/aggregation and confirmed cleanup. The
watchdog returns a timeout when its callback runs, even if termination is still
pending; a result is successful only if cleanup is confirmed before the deadline.
Client disconnect and bridge shutdown also cancel the worker. The concurrency slot
stays occupied until termination is confirmed; shutdown awaits that separate cleanup
promise even after a timeout response. Native SQLite operations, observer event-loop
scheduling and OS scheduling can delay termination or the watchdog callback; this
is not a hard real-time latency guarantee. The worker's V8 heap is capped at 256 MiB old
and 16 MiB young generation; this is not a total process RSS cap.

Errors contain only an explicit code, with no partial report:

| HTTP | Error                         | Meaning                                                                                     |
| ---- | ----------------------------- | ------------------------------------------------------------------------------------------- |
| 503  | `analytics_capacity_exceeded` | Evidence/metadata budget exceeded; narrow scope.                                            |
| 503  | `analytics_busy`              | Another query or its cleanup is active; retry later.                                        |
| 504  | `analytics_timeout`           | Watchdog expired; narrow scope or retry.                                                    |
| 503  | `analytics_cancelled`         | Bridge is closing or the request was cancelled. A disconnected client receives no response. |
| 503  | `analytics_unavailable`       | Read-only worker/database failure, unsupported schema/WAL mode, or in-memory store.         |

No SQLite diagnostic, private path or individual source reference is returned in
errors. The unrestricted synchronous library `modelAnalytics()` and legacy bounded
`modelAnalyticsSummary()` remain available for local inspection; HTTP uses neither.
Schema 2 adds durable compact evidence through the sole Store writer; the route
and worker do not migrate or write. See [data lifecycle](../architecture/data-model.md).

### `GET /api/snapshot`

Returns the current read model used to render the dashboard.

```json
{
  "cursor": 42,
  "workspaces": [],
  "sessions": [],
  "events": [],
  "notifications": [],
  "preferences": {
    "sound": false,
    "completed": true,
    "failed": true,
    "intervention": true
  },
  "adapters": [],
  "diagnostics": {
    "files": 0,
    "malformed": 0,
    "skipped": 0,
    "oversized": 0,
    "errors": 0,
    "lastScan": null,
    "scanning": false
  }
}
```

- `cursor` — latest event sequence.
- `workspaces` — workspace ID, name, path, session count, token usage.
- `sessions` — session read models, newest activity first.
- `events` — the latest 150 stored events, ascending by sequence.
- `notifications` — up to 200 notifications, newest first.
- `preferences` — validated notification preferences.
- `adapters` — Codex, Claude, and OpenCode descriptors with capability flags.
- `diagnostics` — Codex observer counters for the current process.

`SessionView` includes: `id`, `workspaceId`, `cwd`, `agentName`, `adapter`,
`status`, `startedAt`, `lastActivity`, `task`, `result`, `model`,
`parentSessionId`, `usage`, and `manualWorkspace`.

`WorkspaceView` includes: `id`, `name`, `path`, `sessions`, `usage`.

`Usage` is `{ input, output, cached, total }`, all non-negative integers.
`cached` is a subset of `input`.

### `GET /api/events`

Returns stored events in ascending sequence order, for initial history or
backward pagination.

Query parameters:

| Name        | Type    | Default | Rules                                        |
| ----------- | ------- | ------- | -------------------------------------------- |
| `after`     | integer | `0`     | ≥ 0; returns events with `sequence > after`  |
| `before`    | integer | unset   | ≥ 1; returns events with `sequence < before` |
| `limit`     | integer | `200`   | 1–500                                        |
| `sessionId` | string  | unset   | ≤ 200 characters; filters to one session     |

When `before` is present it takes precedence over `after` and results are still
returned in ascending order. This is what the dashboard uses for "load more
activity".

```json
{
  "events": [
    {
      "schemaVersion": 1,
      "id": "…",
      "type": "agent.message",
      "timestamp": "2026-11-02T15:00:00.000Z",
      "adapter": "codex",
      "machineId": "…",
      "workspaceId": "…",
      "sessionId": "…",
      "agentId": "…",
      "correlation": {},
      "source": {
        "file": "2026/11/02/rollout-….jsonl",
        "offset": 1024,
        "line": 7,
        "hash": "…",
        "recordType": "response_item:message"
      },
      "payload": { "role": "assistant", "text": "…" },
      "sequence": 12
    }
  ],
  "cursor": 42
}
```

Invalid query values return `400 {"error":"invalid_query"}`.

## Write endpoints

These endpoints change local state only. None of them sends anything to an
agent session.

### `PUT /api/preferences`

Replaces notification preferences.

Request body:

```json
{
  "sound": false,
  "completed": true,
  "failed": true,
  "intervention": true
}
```

Category flags control creation of new notification history entries and audible/browser alerts. They do not hide observed status or remove old notifications. All four fields are required booleans. Invalid bodies return
`400 {"error":"invalid_request"}`. Success returns the stored preferences with
`200`.

### `POST /api/notifications/read`

Marks all notifications as read.

- Request body: none.
- Success: `200 {"ok":true}`.

### `POST /api/workspaces`

Creates or reuses a manual workspace label.

```json
{
  "name": "OfficeFlow",
  "path": "/Users/me/projects/officeflow"
}
```

- `name`: 1–100 characters after trim.
- `path`: 1–4096 characters after trim; **label only**, never used for
  filesystem access.
- The ID is `stableId('workspace', path)`, so posting the same path again
  returns the same ID and keeps the first stored name.
- Success: `201 {"id":"…"}`.

### `PUT /api/sessions/:sessionId/workspace`

Overrides the automatic workspace association for one session.

```json
{ "workspaceId": "…" }
```

- `workspaceId`: 1–200 characters, or `null` to return to the automatic
  association derived from the session's `cwd`.
- The session ID is URI-encoded in the path.
- Success: `200 {"ok":true}`.
- Unknown session or unknown workspace: `404`.
- The override sets `manual_workspace = 1`; resetting to `null` recomputes the
  automatic workspace and clears the flag.

## Static dashboard

For any non-`/api/*` path:

- `GET` and `HEAD` are supported; other methods return
  `405 {"error":"method_not_allowed"}`.
- Paths are resolved under `apps/dashboard/dist`.
- Dotfile segments, NUL bytes, and paths outside the root are rejected with
  `403 {"error":"invalid_path"}`.
- Extensionless paths fall back to `index.html`.
- If the bundle is missing, the response is
  `404 {"error":"dashboard_not_built"}`.

Static assets are served without the session cookie so the browser can load the
shell before bootstrap. They contain no user data and are loopback-only.

## Common errors

| Status | Body `error`          | Cause                                                                      |
| ------ | --------------------- | -------------------------------------------------------------------------- |
| 400    | `invalid_query`       | Invalid `/api/events` query                                                |
| 400    | `invalid_path`        | Malformed URL path                                                         |
| 400    | `invalid_request`     | Invalid JSON, wrong content type, body too large, failed schema validation |
| 401    | `unauthorized`        | Missing or invalid session cookie                                          |
| 403    | `forbidden_origin`    | Untrusted Host, Origin, or fetch metadata                                  |
| 403    | `invalid_path`        | Static path outside the dashboard root or containing a dotfile segment     |
| 404    | `not_found`           | Unknown `/api/*` route                                                     |
| 404    | `dashboard_not_built` | Static bundle missing                                                      |
| 405    | `method_not_allowed`  | Non-GET/HEAD on a static path                                              |

There is no `Access-Control-Allow-Origin` header. The API is same-origin only.

## Request limits

- JSON body: 8 KiB maximum.
- `Content-Type` must be `application/json` (parameters such as `charset` are
  accepted).
- Server request and header timeout: 10 seconds.
- No rate limiting beyond timeouts and body limits. ORQST assumes a single
  local user.

## Versioning

The API has no `/v1` prefix. The dashboard and bridge ship together, and the
event protocol carries `schemaVersion` for persisted data. A future external
API would need its own versioning and authentication design.
