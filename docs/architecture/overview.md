# Architecture overview

## Current runtime and approved direction

This page separates implemented 0.1.0 behavior from the Phase 0 target. The current
bridge/dashboard remain operational and observation-only. The approved target is
an observability-first open-source platform with an independent Core, Electron as
primary desktop client, shared React UI, browser access and future managed agents.
No target module, process control or Cloud connection is implemented by Phase 0.
The observer Core/Bridge lifecycle extraction and local Analytics aggregation
foundation are implemented and integration-tested. Broader Phase 1 contracts,
durable metric history and Desktop delivery remain incomplete. See the
[six-phase roadmap](../../ROADMAP.md), [requirement coverage](product-requirements.md),
[Analytics design](model-usage-analytics.md) and [ADR-026](decisions.md#adr-026--six-phase-desktop-delivery-and-mandatory-local-analytics).
The current-runtime sections describe the integrated observer; target sections remain planned.

## Current purpose

ORQST gives a developer one place to observe AI coding agents that are running
in other tools, terminals or IDEs. The current runtime supports a single
machine and a single provider: OpenAI Codex CLI.

The product boundary is deliberate:

- ORQST **observes** sessions. It does not start, wrap, resume, or control them.
- ORQST **normalizes** provider records into one event protocol.
- ORQST **persists** normalized events and session summaries locally.
- ORQST **streams** changes to a browser dashboard.
- ORQST does **not** send prompts, approvals, keystrokes, or tool decisions back
  to an agent.

## Process model

There is one long-running Node.js process: the bridge. Responsibilities are:

1. configuration loading,
2. Core owns the single SQLite store and retention,
3. Core owns the Codex observer (file discovery, watching, parsing, normalization),
4. the loopback HTTP server,
5. the WebSocket server,
6. static delivery of the built dashboard.

```
┌─────────────────────────────────────────────────────────────────────┐
│ bridge process (Node 24)                                            │
│                                                                     │
│  loadConfig() ──► ObserverCore ──► Store (node:sqlite, WAL)          │
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
- `main.ts` — entry point, signal handling and process failure reporting;
- `app.ts` — composes Core with local transports and coordinates startup/cleanup;
- `server.ts` — HTTP routing, authentication, static files, WebSocket upgrade,
  replay, broadcast, heartbeat.

See [../api/rest.md](../api/rest.md) and
[../api/websocket.md](../api/websocket.md).

### Observer Core lifecycle

`packages/core` exports `ObserverCore`; its only local dependencies are database,
Codex adapter and protocol. It has no HTTP, Electron or React dependency. One Core
opens one store shared by ingestion and transport queries. `initialize()` acquires
store/observer resources without scanning. Bridge reserves the existing loopback
port, subscribes to events and awaits `start()`, including retention and the initial
bounded observer scan/start attempt, before announcing readiness. Source availability
remains separate: a missing session root does not mean the Core failed to initialize.

Repeated start/stop calls share their operation promises. A stopped or failed instance
cannot restart; create a new instance against the same data directory. Bridge stops
accepting transport work before stopping observation, draining it and closing the
store. Bind/partial-start failures release owned resources without stopping unrelated
listeners. Periodic retention or subscriber failures notify the composition root and
stop transports/Core; cleanup errors remain observable. These states are local
lifecycle states, not new v1 provider statuses or managed-process claims.

Detaching a browser or subscription leaves Core running. `SIGINT`/`SIGTERM` stop the
composed service. There is no new daemon, process ownership, Electron window handler,
PTY or execution feature. The bundle remains `dist/bridge.mjs`, with the same config,
asset resolution and service paths. Deployment still requires an explicit service
restart; integration tests do not install or restart the owner's service.

Core/Bridge lifecycle tests cover initialization/readiness, partial failures, repeated
shutdown, retained identity/settings/checkpoints/totals, replay and v1 transport behavior.
Integration on macOS passed 57 automated cases, 3 Chromium cases and bounded built
Bridge/browser validation with disposable real-source copies. This is not full-archive,
reboot or continuous-soak acceptance. The read-only Analytics library is described
in [its implementation boundary](model-usage-analytics.md#implemented-local-foundation).

### `apps/dashboard`

A React single-page application built with Vite, styled with Tailwind CSS v4,
and translated with i18next/react-i18next.

- `use-observatory.ts` — bootstrap, initial snapshot, WebSocket connection,
  cursor deduplication, reconnect with backoff, five-second snapshot fallback.
- `App.tsx` — workspace navigation, agent table, execution timeline, attention
  center, token summary, session detail, notifications, workspace creation.
- `ModelAnalytics.tsx` — bounded aggregate ranking view at `/#models`, filters,
  share bars and explicit coverage/capacity/unavailable states. It consumes the
  aggregate route, never the evidence-bearing local library report.
- `locales/en-US.json` and `locales/pt-BR.json` — all user-facing strings.

The dashboard is read-only. It can change local preferences and workspace
associations, but it cannot act on an agent session.

## Runtime data flow

1. The bridge loads configuration and initializes Core, opening the single store.
2. The HTTP server binds `127.0.0.1` on the configured port.
3. Core starts observation, running `Store.retain()` before the initial scan;
   hourly retention begins after the observer starts.
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

## Current runtime boundaries and unimplemented capabilities

The following are not implemented in the current runtime:

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

## Target module responsibilities — planned

The target preserves existing packages and introduces extracted modules only when
an approved phase has concrete responsibilities for them. Do not scaffold empty
packages or migrate to a different monorepo/build system.

| Module                | Responsibility and allowed direction                                                                                  |
| --------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Protocol              | Pure versioned schemas/types; no Electron, filesystem, transport or Cloud imports                                     |
| Shared                | Small provider-independent helpers                                                                                    |
| Database              | SQLite migrations, transactions, checkpoints and operational read models                                              |
| Adapters              | Provider discovery, normalization and separately authorized managed operations; declare version-specific capabilities |
| Core                  | Compose lifecycle, local policy, store and adapters independently of UI/Cloud                                         |
| Runtime               | Core-owned process/PTY lifetimes and authorized terminal attachments, introduced only with execution scope            |
| Orchestrator          | Durable local task/delegation admission, delivery, limits, reconciliation and results                                 |
| Observability         | Provenance, quality, aggregation, costs and forecasts when evidence permits                                           |
| Bridge                | Local API/WS transport and compatibility projection; keep current entry point operational                             |
| Desktop               | Electron client/main/preload, windows, menus and native integration                                                   |
| Dashboard             | Shared React views for activity, delivery, attention and metrics; terminals are supporting views                      |
| Optional connectivity | Paired remote transport, isolated from core feature availability and native history                                   |

Domain modules depend on protocol/shared and explicit persistence/adapter
interfaces. UI and transports consume Core operations; Core never imports Desktop,
React or Cloud. Electron main/preload do not own the sole persistent execution
runtime. The existing adapter dependency on database can remain during incremental
extraction; interface changes require demonstrated need and compatibility tests.

```text
Electron client ----+                       +---- Native provider histories
                    |                       |
Browser client -----+--> Local bridge --> Core --> Adapters
                                          |   --> Operational SQLite (one writer)
                                          |   --> Runtime / Orchestrator (future)
                                          +----> Qualified observability (future)
```

The observer Core extraction above is implemented with the same Node runtime/service
and API behavior; it requires no extra daemon. The remaining target modules are not
implemented by that extraction. Electron, PTY and managed native provider protocol
versions remain undecided.

## State, recovery and history — planned

Agent availability, process lifetime, terminal attachment, provider session, turn
and ORQST task have separate identities/states. Current v1 statuses are not
silently redefined. Activity timestamps do not establish process liveness, task
success, active generation time or remaining work. See the
[lifecycle design](../api/lifecycle-contracts.md).

Closing a client must not stop independent work. A Core crash requires
reconciliation; a reboot ends existing processes and restores references/context
only where the provider supports it. No guarantee of a live PTY surviving Core
failure is implied. Resume or replay of uncertain effects requires an authorized
policy. Window restoration, user login and pre-login/background execution have
distinct guarantees; the existing macOS LaunchAgent is a user-login service.

Native histories remain authoritative. Future storage favors verified references,
operational events and aggregates, with new transcript caching disabled unless a
bounded policy is approved. Current copied text and retention remain unchanged;
any migration needs backup and explicit acceptance. Never delete native history
as a cache-management operation.

## Observability-first and privacy — planned

Use observed/estimated/unavailable metric quality with scope, time basis, coverage
and source. Preserve cumulative Codex accounting. Do not imply a subscription bill
from API token rates, tokens-per-second from session lifespan, or a precise
cost-to-completion from insufficient history. Correlate deliveries and delegations
without inventing parentage or task completion from prose.

Keep local Community use independent of Cloud. Optional remote observability
uses authorized endpoint connectivity, not central history or event ingestion.
See [Cloud privacy](../commercial/cloud-architecture.md). All contracts/docs/code
remain English; user-facing keys remain en-US and pt-BR. Incremental authorized
non-destructive work proceeds after checks; product decisions, destructive actions,
credentials, external costs and ungranted permissions remain explicit gates.

## Foundational Token Optimizer — research and planned integration

Token optimization supports the observability-first product from the start. The
future Core composes an independent, provider-aware optimizer domain boundary;
it does not require Electron, Cloud or a particular model-compression library.
See [ADR-025](decisions.md#adr-025--independent-token-optimizer-and-evidence-gated-activation),
[contracts and safety gates](token-optimizer.md), and
[research/benchmark evidence](../benchmarks/token-optimization.md).

Disabled preserves supplied context. Economy permits conservative, traceable
reductions. Intelligent adapts only with validated task/capability/performance
evidence and falls back when uncertain. External observation sessions remain
untouched without explicit authorization. Optimization cannot bypass permissions,
rewrite native history or silently remove required instructions/code.

The intended managed-session default is safe optimization after correctness and
net-benefit validation; no production optimizer or enabled mode exists today.
Standalone synthetic benchmarks are explicitly authorized research outside the
application runtime and automatic CI. Their evidence does not start Phase 1 or
implement managed execution, routing, orchestration or adapters.

## Desktop modules and mandatory Analytics

The Phase 2 target adds Terminal, Monitor/Notifications, Artifacts, Model Manager,
Live Metrics and Model Usage Analytics to the shared client experience. These are
product responsibilities, not instructions to scaffold a package for every module.
Core owns measurement/lifecycle policy independently of React/Electron; adapters
own provider semantics; Database owns durable accounting; Bridge exposes reviewed
local contracts. Client animation never manufactures usage. Terminal execution
requires the Phase 4 control boundary and per-operation provider evidence.

Analytics must retain model/provider/session/project/time/source/quality and show
unidentified/unavailable data. The latest session model is not sufficient to assign
all historical tokens. Time-filtered aggregation requires compatible baselines,
deduplication and retention coverage. Comparisons require explicit task equivalence,
outcomes and repair coverage; costs require verified rates/billing basis. See the
[Analytics design](model-usage-analytics.md). The optimizer remains inactive.
