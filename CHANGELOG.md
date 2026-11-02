# Changelog

Changes are grouped by release using semantic versioning. `Unreleased` does not
announce a release; package versions remain `0.1.0` and no 1.0 tag is implied.

## Unreleased

### Added

- macOS menu-bar tray with open/restore, Bridge availability, bounded unread history
  and quit-Desktop-only actions. A main-process authenticated snapshot consumer gates
  native alerts on new persisted Codex notification/source/status evidence and existing
  category/sound preferences. Startup, reconnect, replay and long-pause history are
  baselined without alerts. Fixed translated native text excludes captured content;
  clicks revalidate session identity before opening it. Native opt-in is per Desktop
  run; renderer notifications remain denied, without preload/IPC. Mechanism tests are
  separate from pending visual delivery acceptance under a signed macOS app identity.

- Minimal macOS Electron observer client loading the existing Bridge-served React
  dashboard, with sandbox/context isolation, no preload/IPC or Node renderer access,
  bounded loopback URL policy, denied permissions/downloads/external windows and
  a localized initial-offline page with automatic retry. Closing/reopening/quitting
  the client preserves the independently running Bridge and observer. Electron45.2.1
  is pinned; existing Node24/pnpm10, schema2, transport and adapter flags are preserved.
  Desktop dev/build/smoke commands are available; packaging, signing, updates, native
  notifications, tray and managed execution remain outside this increment.

- Strict version-1 local `orqst.lifecycle` schemas and Core queries for exact retained
  observed-session evidence and artifact message references. Explicit unavailable
  values distinguish turn, task, process, worker identity and missing observation
  time; only closed source-backed Codex turn mappings qualify. References preserve
  original identity/provenance without bodies, Markdown parsing, source access or
  file writes. No transport/UI, migration, dependency or adapter capability is added;
  v1 REST/WS, statuses, IDs, accounting and schema 2 remain unchanged.
- Cross-cutting roadmap criteria for code quality, independent review, security,
  privacy, compatibility, bounded work, licensing and honest verification evidence,
  linked to existing public policies without new approval gates.

- Additive SQLite schema 2 with compact durable metric/model evidence, transactional
  ingestion and backfill only from retained events. Original IDs/sequences, source
  provenance, model declarations, identity checks and cumulative/cache semantics
  survive detail expiry; expired pre-upgrade history stays unavailable. No prompts,
  messages, tool arguments/results or cwd are copied into this evidence. Its explicit
  lifetime matches retained totals without automatic expiry. Worker readers support
  schemas 1/2 without writes or migrations; v1 APIs, query budgets and cleanup remain.
  Installed upgrade requires separate owner review/backup/integration.

- Configurable isolated browser fixture port through `ORQST_BROWSER_PORT`, shared
  by Playwright and the fixture server. Invalid values and production port 4317
  are rejected; server reuse stays disabled and temporary storage stays unique.

- Bounded worker-backed Analytics for larger retained histories: read-only SQLite
  WAL snapshots, compact metric metadata and per-session folding keep query work
  off the observer thread. Limits are 5000 sessions/250000 envelopes/256 MiB of
  evidence/8 MiB per record/64 MiB projected metadata/2 MiB response; one query runs at a time with
  no queue and a 10-second watchdog through confirmed cleanup. Timeout responds
  independently of termination; the slot remains busy until cleanup is confirmed.
  Late success is rejected; shutdown awaits cleanup even after timeout. Includes
  deterministic delayed-termination regression tests.
  Capacity, busy, timeout, cancellation and unavailable errors return no partial
  results or private diagnostics, with localized dashboard states. The production
  build includes a separate worker; tests require no prebuild or new dependency.
  Summary v1, schema 1, the single writer and conservative accounting are preserved.

- Browser **Most used models** view with reported-token/session ranking, share bars,
  summary cards, calendar/custom periods, workspace/agent/adapter/model filters,
  unidentified models and explicit unavailable/coverage/capacity states. Refresh is
  debounced on source events; stale requests cannot replace current filters. Includes
  bilingual/mobile checks and unmocked synthetic observer-to-screen reconciliation.
  Time series, exports, task-qualified comparisons and real multi-model acceptance
  remain pending; no optimizer or Desktop runtime is activated.

- Authenticated `GET /api/analytics/models` with aggregate-only model usage,
  explicit unavailable metrics and counted coverage gaps. Strict query validation
  rejects duplicates/unknowns; the initial synchronous admission capped 100 sessions,
  1000 retained envelopes and 2 MiB (superseded by the worker increment above). Source references
  and captured content are excluded; existing v1 routes/stream and schema 1 remain.

- UI-independent `@orqst/core` observation lifecycle, composed by `createBridge()`
  with one store, explicit readiness, failure cleanup and shared idempotent shutdown.
  No second process or managed agent execution is introduced. Core/Analytics
  integration passed lint, types, 57 automated tests, build, 3 Chromium tests and
  bounded real-session/browser validation; the installed service was not restarted.

- Evidence-backed local model Analytics projection through `Store.modelAnalytics()`
  and additive TypeScript/query contracts. It reconciles retained canonical snapshot
  deltas, keeps ambiguous model usage unidentified and reports unavailable metrics
  and coverage gaps. No HTTP endpoint, dashboard screen or schema migration is added.

- Foundational Token Optimizer architecture (ADR-025), Disabled/Economy/Intelligent
  design and integration contracts for future Core, routing, adapters and analytics.
- Standalone synthetic token-optimization benchmark with fixed-model provider
  usage, bounded quality checks, offline context comparison and reproducible report.
  No production dependency or optimizer is enabled.

- Phase 0 ADRs 015–024 for future managed execution, independent Core lifecycle,
  resource states, permissions, recovery, native history references, structured
  delegation, Cloud privacy, observability quality and contract compatibility.
- A documentation-only, versioned lifecycle contract design covering identities,
  events, task requests/results, capabilities, permissions and qualified metrics.
- Public roadmap with dependencies, risks, relative effort, acceptance tests,
  unresolved decisions and a bounded Phase 1 Core extraction scope.

### Changed

- Superseded the earlier roadmap numbering with six Desktop delivery phases and an
  explicit old-to-new mapping, dependencies, risks, tests and acceptance criteria.
- Recorded authorized incremental development: Core/Bridge separation and the
  Analytics foundation are in progress pending integration; removed the obsolete
  blanket Phase 1 approval gate. Historical Phase 0 evidence below is preserved.
- Made Model Usage Analytics mandatory for the functional Desktop MVP, with public
  requirement coverage, provenance/unknown-model rules, qualified task comparisons
  and private-content-free exports. No complete Analytics delivery is claimed.

- Product direction emphasizes intelligent observability with a future Electron
  desktop client and React UI shared with browser access.
- Public architecture, security, data-model and contributor documentation now
  distinguishes the implemented observer from approved future capabilities.
- Future Cloud design replaces content synchronization/central history with
  optional identity/device/connectivity services and end-to-end content transport
  without Cloud persistence of code, conversations, terminal output or sessions.

### Compatibility

- Phase 0 includes architecture/documentation and isolated optimizer experiments.
  Bridge/dashboard behavior,
  Codex monitoring, exported TypeScript contracts, v1 APIs/events, database schema,
  dependencies, package versions and Apache-2.0 licensing are unchanged.
- No Electron, PTY, managed execution, delegation or Cloud implementation is
  included in that historical Phase 0 change. The later authorization/status update
  above and ADR-026 supersede its approval gate; this documentation-only update
  does not certify concurrent runtime work or change API/schema behavior.

## Existing development baseline

The initial `0.1.0` development baseline includes read-only Codex observation,
incremental recovery, local SQLite, loopback REST/WebSocket, a bilingual React
dashboard, notification preferences, a macOS service helper and automated checks.
This is a baseline description, not a previously published release entry.
