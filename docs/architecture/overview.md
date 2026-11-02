# Architecture overview

## Purpose

ORQST gives a developer one place to observe AI coding agents that are running
in other tools, terminals, IDEs, or machines. The MVP focuses on a single
machine and a single provider: OpenAI Codex CLI.

The product boundary is deliberate:

- ORQST **observes** sessions. It does not start, wrap, resume, or control them.
- ORQST **normalizes** provider records into one event protocol.
- ORQST **persists** normalized events and session summaries locally.
- ORQST **streams** changes to a browser dashboard.
- ORQST does **not** send prompts, approvals, keystrokes, or tool decisions back
  to an agent.

## Process model

There is one long-running Node.js process: the bridge. It owns:

1. configuration loading,
2. the SQLite store,
3. the Codex observer (file discovery, watching, parsing, normalization),
4. the loopback HTTP server,
5. the WebSocket server,
6. static delivery of the built dashboard.

```
┌─────────────────────────────────────────────────────────────────────┐
│ bridge process (Node 24)                                            │
│                                                                     │
│  loadConfig() ──► Store (node:sqlite, WAL)                          │
│       │                 ▲                                           │
│       │                 │ ingest(event)                             │
│       ▼                 │                                           │
│  CodexObserver ──► adapter-codex ──► protocol schemas (zod)         │
│  (chokidar + poll)                                                  │
│       │                                                             │
│       └── onEvent(stored, live) ──► broadcast ──► WebSocket clients │
│                                                                     │
│  HTTP server: /api/*, /ws, static dashboard                         │
└─────────────────────────────────────────────────────────────────────┘
              ▲                                   ▲
              │ REST + WS on 127.0.0.1            │ static assets
              │                                   │
       React dashboard (browser) ─────────────────┘
```

In development, Vite serves the dashboard on `127.0.0.1:5173` and proxies
`/api` and `/ws` to the bridge on `127.0.0.1:4317`. In production, the bridge
serves `apps/dashboard/dist` itself, so the dashboard and API are same-origin.

There is no separate `apps/server` package. A second process would add
deployment and failure modes without adding a capability in the MVP.

## Components

### `packages/protocol`

The contract shared by every other package. It contains:

- zod schemas for event envelopes, payloads, statuses, usage, and preferences;
- the closed list of normalized event types;
- adapter capability and descriptor interfaces;
- read-model types used by the API and dashboard (`SessionView`,
  `WorkspaceView`, `NotificationView`, `Snapshot`);
- WebSocket stream message types.

It has no filesystem, database, HTTP, or React dependency. Runtime validation
happens at ingestion and at API boundaries, not only at compile time.

### `packages/shared`

Small pure helpers:

- `stableId(...)` — SHA-256 over a JSON tuple, used for deterministic event,
  workspace, and agent IDs.
- `redact(text)` — best-effort removal of common credential shapes.
- `safeText(value, limit)` — extracts and redacts text from strings or content
  arrays, capped at 32,000 characters.
- `object(value)` and `str(value)` — defensive shape checks for untrusted JSON.

### `packages/database`

Owns SQLite through Node's built-in `node:sqlite` `DatabaseSync`.

- Single versioned migration applied through `PRAGMA user_version`.
- WAL journal mode, foreign keys, `busy_timeout`, `secure_delete`.
- Prepared-statement cache, explicit transactions, idempotent event ingestion.
- Read models for sessions, workspaces, notifications, and totals.
- Retention deletion and per-source checkpoints.
- Filesystem hardening for the data directory and database file.

See [data-model.md](data-model.md).

### `packages/adapters/codex`

The only implemented adapter. It discovers `*.jsonl` files under the configured
Codex session root, reads them incrementally without modifying them, normalizes
recognized records, and reports diagnostics. It is split into:

- `index.ts` — discovery, file watching, checkpointing, reading, recovery;
- `normalize.ts` — record-to-event mapping and state tracking.

See [../adapters/codex.md](../adapters/codex.md).

### `packages/adapters/claude` and `packages/adapters/opencode`

Contract-only packages. Each exports a descriptor with `implemented: false` and
every capability set to `false`. They do not read files, open sockets, or emit
events. See [../adapters/claude.md](../adapters/claude.md) and
[../adapters/opencode.md](../adapters/opencode.md).

### `apps/bridge`

Composition root and runtime:

- `config.ts` — environment parsing with strict numeric validation;
- `main.ts` — startup, retention timer, signal handling;
- `server.ts` — HTTP routing, authentication, static files, WebSocket upgrade,
  replay, broadcast, heartbeat.

See [../api/rest.md](../api/rest.md) and
[../api/websocket.md](../api/websocket.md).

### `apps/dashboard`

A React single-page application built with Vite, styled with Tailwind CSS v4,
and translated with i18next/react-i18next.

- `use-observatory.ts` — bootstrap, initial snapshot, WebSocket connection,
  cursor deduplication, reconnect with backoff, five-second snapshot fallback.
- `App.tsx` — workspace navigation, agent table, execution timeline, attention
  center, token summary, session detail, notifications, workspace creation.
- `locales/en-US.json` and `locales/pt-BR.json` — all user-facing strings.

The dashboard is read-only. It can change local preferences and workspace
associations, but it cannot act on an agent session.

## Runtime data flow

1. The bridge starts, opens the store, and loads configuration.
2. `Store.retain()` runs once, then hourly.
3. The HTTP server binds `127.0.0.1` on the configured port.
4. `CodexObserver.start()` performs an initial scan, then starts a chokidar
   watcher and a polling timer.
5. For each changed file, the observer reads from the last committed checkpoint,
   parses complete JSONL lines, normalizes recognized records, and calls
   `Store.ingest()`.
6. Ingestion validates the event, deduplicates by deterministic ID, updates
   session/agent/workspace/token state, and returns the stored event with a
   monotonic sequence.
7. The observer forwards stored events to `onEvent(event, live)`.
8. The server broadcasts live events to connected WebSocket clients.
9. The dashboard merges events by sequence, refreshes its snapshot, and renders
   the updated view.

`live` is only true when the observer has finished its first scan and the event
timestamp is recent (within 60 seconds in the past and no more than 5 seconds in
the future). Imported history is stored and replayed, but does not raise a
notification.

## State and persistence

| State                             | Location                      | Notes                                                   |
| --------------------------------- | ----------------------------- | ------------------------------------------------------- |
| Normalized events and read models | `ORQST_DATA_DIR/orqst.db`     | SQLite, WAL                                             |
| Per-source read checkpoints       | `synchronization_state` table | Offset, line, file identity, anchor hash, adapter state |
| Preferences                       | `settings` table              | Notification flags                                      |
| Machine identity                  | `settings` table              | Random UUID on first start                              |
| Codex session files               | `ORQST_CODEX_SESSIONS`        | Read-only, never modified                               |

The checkpoint is what makes restarts and duplicate scans safe. If a file is
replaced, truncated, or its identity changes, the observer resets and re-reads;
event IDs remain deterministic, so already-ingested records are ignored.

## Boundaries and non-goals

Deliberately out of scope for the MVP:

- remote control, approval, or intervention delivery;
- launching agents or building conversation context;
- multi-provider normalization beyond Codex;
- accounts, organizations, billing, entitlements, or Cloud sync;
- cross-machine workspaces;
- cost estimation, budgets, quota tracking, or context-window prediction;
- encryption at rest or multi-user authorization;
- public network exposure;
- long-running load testing, other-browser/platform validation, and hosted CI execution evidence.

These are documented as gaps rather than hidden behind placeholder features.
