# WebSocket API

The bridge streams stored and live events to the dashboard over a single
loopback WebSocket endpoint.

- URL: `ws://127.0.0.1:<ORQST_PORT>/ws?after=<cursor>`
- Default port: `4317`
- Direction: server → client only; clients are not expected to send
  application messages
- Authentication: the same per-process session cookie as the REST API

## Handshake requirements

The HTTP upgrade is rejected unless all of the following are true:

1. The path is `/ws`.
2. The `Host` header is a trusted loopback host.
3. An `Origin` header is present and exactly matches `http://<trusted host>`.
4. The `orqst_session` cookie matches the process secret.
5. `after` is a safe integer ≥ 0.

Failure closes the socket with an HTTP 403 response. The dashboard obtains the
cookie from `GET /api/bootstrap` before connecting.

In development, `ORQST_DEV=1` adds `127.0.0.1:5173` and `localhost:5173` to the
trusted hosts so the Vite proxy can connect.

## Connection sequence

On an accepted upgrade, the server compares the requested cursor with the
current event cursor and the available replay window:

- It fetches up to 1,001 events after the requested cursor.
- It sends `{"type":"resync","cursor":<current>}` when:
  - more than 1,000 events would be replayed, or
  - the requested cursor is ahead of the server, or
  - there is a gap between the requested cursor and the first available event.
- Otherwise it sends each stored event as
  `{"type":"event","event":<storedEvent>,"live":false}` in ascending sequence
  order, followed by `{"type":"ready","cursor":<current>}`.

A client at the current cursor receives `ready` immediately.

## Message types

```ts
type StreamMessage =
  | { type: 'event'; event: StoredEvent; live: boolean }
  | { type: 'ready'; cursor: number }
  | { type: 'resync'; cursor: number };
```

### `event`

A stored event. `live` is `true` only for activity observed after the initial
scan and within the live time window; replayed history is always `false`.

```json
{
  "type": "event",
  "event": {
    "schemaVersion": 1,
    "id": "…",
    "type": "agent.completed",
    "timestamp": "2026-11-02T15:00:00.000Z",
    "adapter": "codex",
    "machineId": "…",
    "workspaceId": "…",
    "sessionId": "…",
    "agentId": "…",
    "correlation": {},
    "source": {
      "file": "…",
      "offset": 0,
      "line": 1,
      "hash": "…",
      "recordType": "event_msg:task_complete"
    },
    "payload": { "status": "completed" },
    "sequence": 12
  },
  "live": true
}
```

### `ready`

Sent after a successful replay (or immediately when no replay is needed).
`cursor` is the server's current sequence at that moment.

### `resync`

Sent when the server cannot replay the requested range. The client should
refresh its snapshot from `GET /api/snapshot` and treat `cursor` as the new
position. This can happen after long disconnections, retention deletion, or a
cursor from a previous database.

## Ordering and duplicates

- `sequence` is monotonic and assigned by SQLite on insert.
- Replay is ascending by sequence.
- Live events are broadcast in ingestion order.
- The same event can appear in both the initial snapshot and the replay. The
  dashboard deduplicates by `sequence`, ignoring any event at or below its
  current cursor.
- There is no per-session subscription. All events are broadcast; the dashboard
  filters by workspace or session.

## Server behavior

- `maxPayload` is 1 KiB; client application messages are not part of the
  protocol.
- Compression is disabled (`perMessageDeflate: false`).
- A heartbeat pings every 15 seconds.
- A client with more than 1 MiB buffered is terminated.
- All clients are terminated on shutdown.
- The server does not persist per-client cursors; recovery is driven by the
  client's `after` value.

## Client behavior (bundled dashboard)

`apps/dashboard/src/use-observatory.ts`:

1. Calls `GET /api/bootstrap`.
2. Fetches `GET /api/snapshot`.
3. Opens `/ws?after=<snapshot.cursor>`.
4. Ignores events with `sequence <= cursor`, updates the cursor, and forwards
   only `live: true` events to notification handling.
5. Schedules a snapshot refresh shortly after events arrive.
6. On `resync`, adopts the server cursor and refreshes the snapshot.
7. On close, reconnects with exponential backoff (500 ms × 2^attempt, capped at
   10 s). Bootstrap failures use a 1 s base.
8. Polls the snapshot every 5 seconds as a fallback even while connected.

The dashboard does not need a manual page refresh.

## What the stream does not provide

- No client-to-server commands.
- No prompt, approval, or control messages.
- No subscription management.
- No authentication refresh; a bridge restart invalidates the cookie, and the
  client re-bootstraps on reconnect.
- No delivery guarantee beyond the stored replay window and retention policy.

## Security notes

- The endpoint is loopback-only.
- The cookie is `HttpOnly` and `SameSite=Strict`.
- The `Origin` check is mandatory for the upgrade.
- Event content is untrusted and is rendered as plain text by the dashboard.
