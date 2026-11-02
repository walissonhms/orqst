# REST API

> **Current observation API baseline.** This roadmap update changes no routes,
> payloads, authentication or behavior on this page. The
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
