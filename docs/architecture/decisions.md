# Architecture decisions

These records document the durable product and engineering decisions.

## Decision status and implementation

ADRs 015–024 record the architecture direction approved on 2026-11-02 during
Phase 0. **Accepted direction does not mean implemented or authorized for
implementation in this phase.** Phase 0 changes documentation and contract design
only. ADR-025 adds the authorized optimizer research/benchmark scope, without
production activation. The later incremental-development authorization and six-phase
sequence are recorded in ADR-026 and [ROADMAP](../../ROADMAP.md). Historical Phase 0
restrictions below describe that delivery's scope, not a current blanket approval gate.

ADRs 001–014 describe the existing 0.1.0 runtime unless an explicit status note
limits or supersedes their future applicability. Existing APIs, events, database
migration and capabilities remain unchanged. In particular, no execution,
terminal, delegation or Cloud endpoint is introduced by these decisions.

## ADR-001 — One bridge process, no separate server app

**Status:** Accepted for the current runtime; future ownership is extended by ADR-016.

**Context.** The repository needs ingestion, persistence, REST, WebSocket, and
static dashboard delivery. Splitting these into services would add deployment
and failure modes for a single-user local tool.

**Decision.** `apps/bridge` is the composition root. It owns configuration, the
store, the observer, HTTP, WebSocket, and static assets. There is no
`apps/server`. Adapters never listen on a socket.

**Consequences.** One process to start and stop, one port, one shutdown path.
The bridge must remain thin: provider logic belongs in adapters and data logic
in the database package. A future Cloud backend is a separate system and must
not be bolted into this process.

---

## ADR-002 — Node's built-in `node:sqlite`

**Status:** Accepted

**Context.** SQLite is required for local persistence. A native addon adds
build, ABI, and packaging risk.

**Decision.** Use `node:sqlite` `DatabaseSync` from Node 24. Pin Node
`>=24 <25` and `engine-strict=true`. Do not add `better-sqlite3` or another
driver.

**Consequences.** No native build step. The API is tied to the Node major;
changing Node requires revalidating the database layer. Synchronous database
calls are acceptable because the workload is a local single-user bridge.

---

## ADR-003 — No Turborepo

**Status:** Accepted

**Context.** The workspace has two build targets: a Vite dashboard and an
esbuild bridge bundle.

**Decision.** Use pnpm workspaces and two small scripts (`scripts/dev.mjs`,
`scripts/build.mjs`). Do not add Turborepo.

**Consequences.** Fewer moving parts and no remote cache. If the build graph
grows substantially, the decision can be revisited with measured need.

---

## ADR-004 — Observation only; no remote control

**Status:** Current runtime behavior retained. Superseded for future managed sessions by ADR-015; external observation remains read-only.

**Context.** The product vision mentions browser-based intervention, but the
MVP has no verified mechanism to write into an externally started agent session.

**Decision.** ORQST is read-only with respect to agents. It never launches,
wraps, resumes, or sends input to a session. Intervention events are displayed
as alerts that direct the user back to the original terminal. `remoteControl`
is `false` for every adapter.

**Consequences.** The dashboard cannot answer a prompt, approve a tool call, or
stop a run. This is a product boundary, not a missing feature flag. Any future
control feature requires a separate, explicitly validated capability and a new
security review.

---

## ADR-005 — Cumulative session snapshots are canonical

**Status:** Accepted for current Codex accounting; future metrics extend this in ADR-023 without changing v1 totals.

**Context.** Codex records expose thread-level cumulative usage, turn usage,
response-level usage, and a `token_count` mirror. Summing them double counts.

**Decision.** Only `session_cumulative` snapshots update `token_usage`. Prefer
thread-scoped `token_usage_record` (priority 2) over the `token_count` mirror
(priority 1). Accept a snapshot only when its total and timestamp are not older
than the stored one. Cached input is a subset of input and is never added again.
Incremental and turn usage stay in event payloads for display.

**Consequences.** Session totals are "largest observed cumulative snapshot",
not a sum of records. Replay and duplicate scans cannot inflate totals. Cost,
budget, quota, and context-window estimates are out of scope.

---

## ADR-006 — Deterministic IDs and source references

**Status:** Accepted for v1; future source types and contract negotiation are covered by ADR-024.

**Context.** Files can be re-read after restart, truncation, or rotation.
Events must be idempotent and traceable.

**Decision.** Event IDs are `stableId(...)` over adapter, machine, session,
record type, record subtype or provider ID, and normalized event type. Every
event carries file, byte offset, line, content hash, and record type. SQLite
deduplicates by event ID.

**Consequences.** Replay is safe. Two genuinely different records that produce
the same tuple would collide; the tuple includes provider record IDs and content
hash to make that unlikely. Source references make debugging possible without
copying raw logs.

---

## ADR-007 — Codex first; Claude and OpenCode are contracts

**Status:** Accepted

**Context.** Codex is the owner's primary environment. Claude Code and OpenCode
expose different mechanisms and were not validated.

**Decision.** Implement and validate Codex. Ship Claude and OpenCode as
descriptor packages with `implemented: false` and every capability `false`.
Only mark a capability true after it is validated against real source data.

**Consequences.** The dashboard shows the other integrations as planned. No
adapter contract implies parity with Codex. See
[../adapters/capability-model.md](../adapters/capability-model.md).

---

## ADR-008 — Loopback cookie plus Host/Origin checks

**Status:** Accepted for the current observation API. Insufficient to authorize future execution; see ADR-018.

**Context.** The local API exposes captured prompts and tool output. A browser
page on another origin must not read it, and DNS rebinding must not reach it.

**Decision.** Generate a random per-process secret, issue it as an `HttpOnly`,
`SameSite=Strict` cookie via `/api/bootstrap`, require it for `/api/*` and
`/ws`, and reject requests whose `Host` is not a trusted loopback host or whose
`Origin`/`Sec-Fetch-Site` is inconsistent. Bind only `127.0.0.1`.

**Consequences.** No account system and no TLS. Restarting the bridge
invalidates cookies, and the dashboard reconnects. Local processes, including processes of other OS users,
can obtain a cookie; this is accepted under the single-user model.

---

## ADR-009 — Retention deletes details, keeps summaries

**Status:** Current retention retained. Future history references and bounded caches are covered by ADR-020.

**Context.** Captured messages and tool output are the most sensitive and
fastest-growing data. Session and token summaries are small and useful.

**Decision.** Delete events older than `ORQST_RETENTION_DAYS`; cascade messages
and notifications. Keep sessions, summaries, and cumulative token totals. Keep
the event cursor monotonic.

**Consequences.** Old timelines disappear while totals remain. The dashboard
must not imply that a missing event means no activity. Backups must be taken
before the retention window if detail is needed.

---

## ADR-010 — License decision is deferred

**Status:** Superseded by ADR-014 on 2026-11-02. The text below records the initial decision.

**Context.** The Community Edition is intended to be open source, while a
future Cloud Edition may be commercial. MIT, Apache-2.0, and AGPL-3.0 have
different implications for hosted services and contributions.

**Decision.** Do not select a license without the owner. Keep every manifest
`UNLICENSED` and the root `LICENSE` as a no-grant placeholder. Document the
comparison in
[../commercial/licensing-decision.md](../commercial/licensing-decision.md).

**Consequences.** The project cannot honestly be called open source yet, and
external contributions cannot be merged until inbound terms exist.

---

## ADR-011 — English code and docs, localized UI

**Status:** Accepted

**Context.** The product must ship in English and Brazilian Portuguese, and the
codebase must remain accessible to contributors.

**Decision.** All identifiers, schema, API fields, events, comments, commits,
and technical documentation are English. All user-facing dashboard strings go
through i18next, with `en-US` as fallback and `pt-BR` as the second locale.
Captured agent content is never translated.

**Consequences.** New UI keys require both locale files. Locale-aware
formatting uses `Intl` in the dashboard.

---

## ADR-012 — Polling fallback alongside file watching

**Status:** Accepted

**Context.** Filesystem notifications are not reliable on every platform,
filesystem, or network mount.

**Decision.** Use chokidar for low-latency discovery and a periodic scan
(`ORQST_POLL_MS`, default 3 seconds) as a correctness fallback. Scans are
coalesced through a single in-flight promise.

**Consequences.** Discovery works even when watch events are dropped. The
fallback has a small idle cost and a bounded per-file read budget to avoid
starvation.

---

## ADR-013 — No code copied from Tucano

**Status:** Accepted

**Context.** The owner supplied Tucano as a reference. Its license is
Apache-2.0, but ORQST's final license is undecided.

**Decision.** Use Tucano only as an architectural reference. Do not copy code,
assets, or schemas. Keep the original reference review locally; it is not part of the public repository.

**Consequences.** ORQST's architecture remains independent and no upstream
notice obligation is created by copying. If reuse is ever proposed, the license
compatibility and attribution must be reviewed first.

---

## ADR-014 — Apache-2.0 Community Edition

**Status:** Accepted by the owner on 2026-11-02; supersedes ADR-010.

**Context.** Community must support self-hosting and broad integration while a
future independent Cloud service may be commercial.

**Decision.** License the original Community code and documentation under
Apache-2.0. Keep package manifests private to prevent accidental npm publication.
Contribution submissions follow Apache-2.0 section 5. No separate CLA or DCO is
required. See [licensing](../commercial/licensing-decision.md).

**Consequences.** Commercial use and modified closed hosted forks are permitted.
Redistribution must preserve applicable licenses and notices. Third-party
components retain their own terms. Cloud is not implemented or licensed here.

---

## ADR-015 — Managed execution and external observation

**Status:** Accepted direction on 2026-11-02; implementation planned, not authorized by Phase 0.

**Context.** Execution and orchestration are approved future capabilities, while users must continue observing agents launched outside ORQST.

**Decision.** Introduce explicit `observed` and `managed` session modes. Observed sessions remain read-only. Managed sessions may be created or controlled only through a validated adapter, an authorized operation and a separately approved implementation phase. Adoption of an external session requires explicit ownership transfer and capability evidence; discovery alone never grants control.

**Consequences.** Preserve Codex discovery and all current capability flags. Do not inject task text or approvals into arbitrary terminals. Structured provider channels carry managed operations; terminal input remains a distinct user-authorized surface.

---

## ADR-016 — Core lifecycle independence and Desktop clients

**Status:** Accepted direction on 2026-11-02; implementation planned, not authorized by Phase 0.

**Context.** Closing the interface must not end managed work. The existing macOS bridge service already runs independently of the browser.

**Decision.** Evolve the current bridge composition into a UI-independent Core, preserving Node 24, SQLite and one writer. Keep the bridge as a transport/composition entry point. Electron becomes the primary desktop client, React remains shared, and the browser remains a supported client. The initial desktop target is macOS. Add packages only when the approved extraction needs them.

**Consequences.** No Electron process, runtime package or service change is added in Phase 0. An Electron main/utility process is not the sole owner of persistent agents. Package paths and the exact Electron version remain implementation decisions. Core startup and local features never depend on Cloud.

---

## ADR-017 — Separate agent, process, terminal, session, turn and task states

**Status:** Accepted direction on 2026-11-02; implementation planned, not authorized by Phase 0.

**Context.** The current session status represents observed turn activity; it cannot prove process liveness, task success or terminal attachment.

**Decision.** Use separate identities and state machines for agent instances, OS process instances, terminal attachments, provider sessions, turns and application tasks. Keep existing v1 agent/session IDs and statuses unchanged. New contracts define explicit mappings rather than silently reinterpreting existing fields. Missing liveness evidence produces unknown state, not completion or failure.

**Consequences.** A process exit does not prove task success. A completed turn does not prove that a process exited. UI disconnection does not stop execution. Provider session IDs are qualified by machine and provider; a PID is never a durable process identity.

---

## ADR-018 — Permissions and authorization boundaries

**Status:** Accepted direction on 2026-11-02; implementation planned, not authorized by Phase 0.

**Context.** The loopback bootstrap cookie protects the current observer against cross-origin reads, but local processes can acquire it. Adding command execution changes the impact of that boundary.

**Decision.** Keep current read API authentication unchanged. Future control operations require a separately authenticated principal, explicit scope, resource bounds, expiry and adapter/provider permission enforcement at the Core. Deny execution by default. Observation access, terminal input, task delegation, approval responses and remote connectivity are separate grants. A payload naming a permission is not proof of authority.

**Consequences.** No control endpoint may rely on the observation cookie alone. Validate IPC sender and arguments; constrain executable, argument vector, working directory, environment and allowed resources. Provider sandboxing and OS permissions still apply. Never store credentials in events or delegate authority from captured text. Select and review the control authentication and headless secret-storage mechanisms before execution is implemented.

---

## ADR-019 — Recovery guarantees and interrupted work

**Status:** Accepted direction on 2026-11-02; implementation planned, not authorized by Phase 0.

**Context.** UI reconnection, Core failure and machine restart have different recovery properties. Native histories restore context, not an arbitrary live process image.

**Decision.** Closing a client must leave the independent Core and its managed work running. Persist references and operational checkpoints locally. After a Core failure or reboot, reconcile process identity, native session availability, task acknowledgements and unknown effects before offering recovery. Native session resume requires a supported adapter and an authorized policy. No automatic replay of uncertain side effects.

**Consequences.** An OS reboot ends previous processes and PTYs. Preserving the same PTY across a Core crash is not promised by this design; it would require a separate supervisor decision and tests. Launch-at-login is distinct from pre-login or logged-out execution. Restoring window layout does not prove resumed execution.

---

## ADR-020 — Native history references and bounded content caches

**Status:** Accepted direction on 2026-11-02; implementation planned, not authorized by Phase 0.

**Context.** The current database copies selected text into event envelopes, messages and summaries. Future functionality should reuse provider history and avoid unnecessary transcript duplication.

**Decision.** Treat native histories as the source of conversation content. Persist operational identifiers, verifiable source references, checkpoints and metric aggregates. Read conversation details from authorized native sources when available. New transcript caches are disabled by default; enabling a cache requires an explicit size, lifetime, purge and permission policy. Apply the same rules to terminal buffers and task/result excerpts.

**Consequences.** Phase 0 does not delete or migrate existing data and does not change current retention. Missing or changed sources must be shown honestly. References are sensitive local metadata. Any future migration requires backup, replay/integrity checks and a policy for existing text, summaries and backups. ORQST must never edit native history to implement its own retention.

---

## ADR-021 — Structured local task delegation

**Status:** Accepted direction on 2026-11-02; implementation planned, not authorized by Phase 0.

**Context.** Multi-agent work needs traceable requests, results and limits without writing directly into other terminal inputs.

**Decision.** Route delegation through a Core-owned orchestrator and documented adapter operations. Give every task, request, result and attempt an identity. Record origin, destination, workspace, correlation, scoped authorization, deadline and budget. Plan durable inbox/outbox delivery, acknowledgements, idempotency checks, cancellation and bounded retries. Use explicit parentage, depth/fan-out/concurrency limits and budget limits to stop runaway delegation.

**Consequences.** At-least-once delivery does not guarantee exactly-once external effects. An uncertain execution must be reconciled before retry. Submission or transport acknowledgement is not task completion. Replies return through the same validated task protocol; task or agent text cannot grant itself new permissions.

---

## ADR-022 — Cloud privacy and optional remote connectivity

**Status:** Accepted direction on 2026-11-02; implementation planned, not authorized by Phase 0.

**Context.** The previous Cloud design proposed event ingestion and central history. The approved product boundary prohibits Cloud storage of source code, conversations, terminal output and session content.

**Decision.** Replace content synchronization with an optional identity/device/connectivity control plane. Keep content and operational history on authorized user devices. Remote content transport must be end-to-end encrypted between paired endpoints; an optional relay handles transient ciphertext only. Do not persist content or relay payloads in databases, queues, logs, traces, crash reports, backups or analytics. Limit control-plane records to an explicit metadata allowlist.

**Consequences.** No Cloud implementation or cryptographic protocol is introduced in Phase 0. Pairing, revocation, protocol choice and metadata retention require a security design before implementation. Cloud authentication does not itself authorize a local command. Disconnection or subscription state cannot disable local Community features. The earlier central-history/ingest roadmap is superseded.

---

## ADR-023 — Observability-first product and qualified metrics

**Status:** Accepted direction on 2026-11-02; implementation planned, not authorized by Phase 0.

**Context.** The primary product differentiator is understanding agent activity, delivery, usage and uncertainty across workspaces and, eventually, machines.

**Decision.** Keep activity, results, intervention and usage as the primary experience; terminals and orchestration support that experience. Future metrics declare observed, estimated or unavailable quality, source, time window, scope and units. Never convert missing measurements to a measured zero in new contracts. Preserve current Codex cumulative accounting and qualify its coverage. Distinguish provider-reported monetary values, price-based estimates and actual billing reconciliation.

**Consequences.** Cost requires model/rate/billing provenance and provider-specific cache semantics. Tokens per second require a known interval and token basis; elapsed session span is not active generation time. Forecasts require sufficient comparable data, an explicit remaining-work assumption and uncertainty; otherwise return unavailable. No prediction, cost calculation or dashboard change is implemented in Phase 0.

---

## ADR-024 — Additive versioned contract design

**Status:** Accepted direction on 2026-11-02; implementation planned, not authorized by Phase 0.

**Context.** The current zod v1 envelope has a closed event enum, file-shaped sources and existing clients that cannot safely consume new lifecycle event families.

**Decision.** Preserve `schemaVersion: 1`, current enums, REST shapes, `/ws` behavior and database schema. Specify a separate future `orqst.lifecycle` contract with `contractVersion: 1`; it is not an extension silently sent through the v1 stream. Require explicit negotiation of supported contracts before a future client receives lifecycle events or sends commands. Capability discovery is versioned and defaults to unsupported until validated.

**Consequences.** The contract design in docs/api/lifecycle-contracts.md is normative for planned semantics but is not exported TypeScript, a runtime schema or a registered endpoint. Unsupported required versions must fail before side effects. Wire paths, implemented schemas and migrations belong to later approved changes. Never silently upgrade a v1 observation cookie or event into control authority.

---

## ADR-025 — Independent Token Optimizer and evidence-gated activation

**Status:** Accepted direction for Phase 0 research and isolated benchmarks; production implementation is not authorized.

**Context.** Token optimization is a foundational differentiator alongside intelligent observability. Reducing prompt size alone does not demonstrate lower total usage, equivalent correctness or lower monetary cost. Native agents own parts of their context that ORQST may not safely intercept.

**Decision.** Plan an independent optimizer domain component composed by the future Core, with Disabled, Economy and Intelligent modes and versioned request/plan/evidence interfaces. Preserve protected instructions, permission boundaries, source provenance, tool/result correlations and code required for the task. Optimize only context the adapter demonstrably exposes and ORQST is authorized to supply. External sessions remain unchanged unless explicitly authorized. Start with deterministic, traceable transformations; learned compression and summaries require separate quality, resource and licensing evidence.

**Consequences.** No production dependency, runtime capability, endpoint or default changes in Phase 0. The intended managed-session default is safe Economy only after correctness and measurable net benefit are validated; until then optimization remains inactive. Intelligent must fall back when evidence, authority or relevance is uncertain. Router/orchestrator/adapters consume a plan, and observability records observed versus estimated usage, failed attempts, retries and optimizer overhead. See [Token Optimizer design](token-optimizer.md) and [benchmark methodology/results](../benchmarks/token-optimization.md). No published compression ratio from another project is an ORQST savings claim.

---

## ADR-026 — Six-phase Desktop delivery and mandatory local Analytics

**Status:** Accepted product direction and incremental-development authorization on
2026-11-02. Core/Bridge separation and the Analytics foundation are in progress;
completion awaits integration. This record supersedes the earlier blanket Phase 1
approval gate and roadmap numbering, not historical evidence or runtime contracts.

**Context.** The functional desktop scope now includes Core/Bridge, Terminal,
Monitor/Notifications, Artifacts, Model Manager, Live Metrics, mandatory Model Usage
Analytics and an inactive Token Optimizer. The former eight-phase sequence placed
qualified metrics too late and did not make model Analytics an MVP requirement.

**Decision.** Use six phases: Core/contracts; Desktop MVP; robust provider integrations;
managed sessions; evidence-gated optimizer validation/integration; distribution and
polish. The [roadmap](../../ROADMAP.md) maps every former phase, dependencies, risks,
tests and acceptance. Incremental authorized non-destructive work may proceed after
checks. Stop for product decisions, destructive actions, credentials, external costs
or permissions not granted. Managed operations still require reviewed authentication,
scopes, provider evidence and ownership; external observation remains read-only.

Analytics is local usage analysis, not tracking or uploads. Rank primarily by reported
total tokens with source/model/provider/time provenance and coverage. Preserve
unidentified models, unavailable values, cumulative deduplication and provider cache
semantics. Compare efficiency only for equivalent tasks with explicit outcomes;
non-equivalent comparisons are descriptive. Most used is distinct from lowest usage
per successful task and best value, which requires verified prices and billing basis.
See [Analytics design](model-usage-analytics.md) and [coverage](product-requirements.md).

**Consequences.** Phase 2 terminal UI can progress independently, but its execution
acceptance depends on Phase 4 authorization and Phase 3 evidence for each enabled
provider operation. Other providers, costs, quotas and private context are never
assumed available. No optimizer activation, remote telemetry, Cloud, API shape change,
new runtime capability or release acceptance is created by this documentation.
Historical ADRs, the original observer plan/audit and benchmark results are preserved.

---

## ADR-027 — Observer Core lifecycle and retained-evidence Analytics

**Status:** Implemented and integration-tested on macOS on 2026-11-02. This is a
bounded Phase 1 increment, not complete Phase 1 or Desktop acceptance.

**Decision.** `ObserverCore` owns one SQLite store, the existing Codex observer and
retention. Bridge remains the executable composition root and owns local transport
and signals. Resource initialization precedes port binding; observation readiness
follows the initial scan/start attempt. Cleanup closes transport before draining
observation and closing the store. Operation promises share repeated starts/stops;
restart uses a fresh Core against the same storage. Core imports no UI or transport.

`Store.modelAnalytics()` adds a read-only projection over retained evidence, with
an independent local contract and no SQL migration or v1 transport extension.
Compatible cumulative deltas, source priority and explicit period boundaries govern
accounting. Unknown or conflicting models remain unidentified, missing metrics remain
unavailable, and coverage stays unverified. No vendor, task outcome, active duration
or cost is inferred. Source references remain local and need an allowlist before export.

**Consequences.** Node/service paths, one-process deployment, single-writer ownership,
REST/WS v1 and observed session files are preserved. Browser detachment does not stop
Core; service shutdown still stops it. No managed execution, optimizer, Electron,
new adapter capability, telemetry or Cloud behavior is introduced. Durable historical
metric storage and bounded interactive Analytics transport remain future work.

Integrated lint/types, 57 automated cases, build, 3 Chromium cases and bounded
real-source/built-Bridge/browser validation passed. The installed service was not
restarted. Real-model Analytics attribution, full-archive load, reboot and Desktop
acceptance remain unvalidated; see [testing](../development/testing.md#incremental-delivery-and-integration).

---

## ADR-028 — Durable, content-minimized Analytics evidence

**Status:** Implemented in code in the authorized durable-metrics increment; installed
migration and real-model acceptance require separate owner integration/review.

**Decision.** Add immutable migration 2 beside unchanged migration 1. The sole Store
writer inserts an allowlisted metric/model observation with the original event ID,
sequence, identities, time, source location/hash, turn/response IDs and usage kind in
the same ingestion transaction. Backfill only surviving event evidence in the schema
transaction; do not use latest model or totals as historical evidence. Retain this
compact evidence without automatic expiry alongside existing canonical totals and
session identities. Detail retention and existing summary content policy are unchanged.
This extends ADR-009's summary lifetime to the approved metric history, consistent
with ADR-020's identifiers/source references/metrics boundary; no transcript cache is
created. Finite metric TTL, selective erasure and storage compaction remain separate
policy changes requiring explicit approval, not implicit detail-retention settings.

**Consequences.** Metric duplicates remain suppressed after detail deletion. Native
sources, checkpoints, existing summaries and backups are not rewritten. Historical
gaps remain unknown; conservative deltas/model changes/cache/mirror semantics and
v1 APIs remain unchanged. Compact records grow with observations and source references
are sensitive plaintext local metadata. Read-only workers explicitly support schema
1 and 2, perform no migration and preserve budgets, deadlines, isolation and cleanup.
An older writer rejects schema 2; rollback means restoring a reviewed pre-upgrade
backup, never dropping the table or lowering `user_version` on an installed database.
See [data lifecycle and migration](data-model.md) and [testing](../development/testing.md).

---

## ADR-029 — Local observed evidence and artifact reference contracts

**Status:** Implemented local Phase 1 slice on 2026-11-02; broader ADR-024 transport/control remains planned.

**Context.** The design-only lifecycle document separates sessions, turns, tasks and
processes, while the runtime has only v1 status/events and Analytics contracts.
Retained Codex events already contain source-backed identities and provenance; they
do not persist ingestion time, process lifetime or validated task outcomes.

**Decision.** Add strict version-1 `orqst.lifecycle` schemas and synchronous Core
library queries for one exact retained event. Validate the requested version before
Store reads and validate returned metadata at runtime. Preserve native session IDs
and label v1 agent identity explicitly; independent worker identity is unavailable.
Session discovery is historical; turn state uses a closed source/event/status mapping.
Task/process evidence and missing timestamps remain unavailable. An explicitly
requested artifact reference identifies an existing assistant/agent message without
copying content or asserting document extraction. Return explicit absence on detail
expiry; do not reconstruct from summaries or durable Analytics evidence.

**Consequences.** No new dependency, persistence, migration, source access, API/WS
message, permission or provider capability. SQLite schemas 1/2 and all v1 behavior
remain unchanged. Source metadata is sensitive and has not been rechecked against
native history. No source-root ID or dereference grant is invented. Future transports
need negotiation/authorization; extraction/rendering/export/file writes still need
their existing product/security decisions. Local tests are not process-control or
Desktop acceptance. See [exact contracts](../api/lifecycle-contracts.md).

---

## ADR-030 — Minimal macOS Electron observer client

**Status:** Authorized first Desktop slice on 2026-11-02; implemented as a development
checkout client. Native and independent QA evidence is recorded in development testing;
this does not complete Phase 2 or authorize managed execution/distribution.

**Context.** Core/Bridge ownership and React dashboard already work independently.
Embedding Core/SQLite in Electron would create runtime/ABI and second-writer risks.
The owner authorized the smallest macOS window, connection/reconnection and independent
service lifetime, excluding execution, PTY, updater and paid signing.

**Decision.** Add `apps/desktop` as a transport-only Electron client. Its only runtime
library is the existing i18next localization stack; Electron is an exact dev dependency.
Use Electron 45.2.1, the verified latest stable on this date (Chromium 156.0.8078.75,
Node 24.22.1, MIT; macOS13+), and existing esbuild for its standalone CommonJS main.
Workspace and Bridge retain Node24/pnpm10 and `node:sqlite`; Electron imports neither
Core nor database and never launches the Bridge. No ABI equivalence is claimed.
Sources and registry reproduction are in [Desktop development](../development/desktop.md).

Load only the configured IPv4 loopback port, with the same browser cookie/CSP/Host/Origin
transport. Use an in-memory session, sandbox/context isolation, no Node renderer,
no preload/IPC, no webview, denied permission/download/new-window/external navigation,
and a request allowlist. A script-free custom-protocol unavailable page retries the
initial connection; the loaded dashboard keeps its existing reconnect logic. Window
close/quit has no service/observer side effect. macOS activation reopens the window.

**Consequences.** Browser observation, v1 transport, schema2/immutable migrations,
metrics, privacy and adapter flags remain unchanged. No new filesystem/control grant
or credential/cost is required. `pnpm build` also builds Desktop; the explicit local
Electron binary download uses upstream checksums without changing pnpm's esbuild-only
build-script policy. No Forge/builder dependency is necessary to run from a checkout.
Packager, `.app` identity, signing/notarization, installers, updates and wider OS coverage
remain deferred distribution decisions. A future release must recheck Electron support,
carry binary third-party notices and separately validate packaging/permissions/lifetime.

## ADR-031 — Source-gated Desktop tray and native alert consumer

**Status:** Implemented mechanism; native visual delivery/distribution acceptance pending.

**Context.** The Bridge already persists source-backed live notification history with
category/sound preferences. Giving the renderer a native `notify(text)` capability
would let untrusted captured content cross the privilege boundary. A new transport or
Core inside Electron would duplicate existing ownership and authentication.

**Decision.** Use a bounded sequential main-process consumer of the existing authenticated
bootstrap/snapshot HTTP contract. Baseline startup/reconnect/cursor reset/long pauses;
join only new notification rows to validated Codex event/source/status and session identity.
Keep native strings fixed and localized, opt-in temporary in the tray, and renderer
notifications/permissions denied. Revalidate identity on native click; a bounded dashboard
hash selects an existing session. Reuse protocol/zod validation and i18next; add no IPC,
preload, endpoint, persistence, source write, service lifecycle or agent operation.

**Consequences.** A two-second polling delay and bounded 150-event/200-notification
history may omit alerts; at most three attempts per cycle avoid bursts. Unread count
is the bounded history, not inferred agent attention. API support is not OS delivery;
signed app identity, permission/Focus and real native visual acceptance remain pending.
See [Desktop details](../development/desktop.md) for exact evidence gates and limits.

## ADR-032 — Opt-in embedded Terminal with a native trusted Core host

**Status:** Owner-authorized incremental implementation, 2026-11-03. Real provider
and genuine human-dialog acceptance are pending. This does not complete Agentic Mode.

**Context.** The owner requires an interactive Terminal inside ORQST and the future
Codex/Claude Code/OpenCode direction, rather than another laboratory or external
terminal. Existing signed grants, owned lifecycle and metadata recovery can be
composed without changing the read-only observer. The earlier immutable-binding and
hard-containment gate exceeded the selected trusted personal-machine threat model.
The subsequently supplied Agentic Mode specification makes two identified agents,
an explicit delegated task and an automatic result inside ORQST the first useful
Agentic Mode milestone; terminal mechanics alone cannot establish that result.

**Decision.** Add an explicit configured Desktop menu/window with xterm.js 6.0.0 and
fit addon 0.11.0 (MIT), a separate sandboxed document/session/preload and existing
strict native contract. Node 24 owns the supervisor, grants, private metadata Store
and pinned node-pty 1.1.0 hosts; Electron remains a database client. Use bounded JSON
over inherited IPC: Electron/Node V8 binary serialization is not ABI-compatible.
Ephemeral native signing keys never enter the renderer or metadata. No observer
API, WebSocket, cookie, sessions, source root or dashboard IPC acquires authority.

Choose native trusted/same-user execution explicitly. Canonical paths, private
ownership/modes, fixed profiles, pinned executable hashes and last-boundary
revalidation detect drift. They do not claim immutable kernel binding against
same-user attacks. Container/VM isolation remains a distinct future backend, not an
unnecessary blocker for this authorized native mode. Provision only new separate
homes/config/history; device login is a separate fixed provider operation with
native confirmation, file credentials and no inherited secrets/keyring access.
Read-only/on-request are startup defaults that the provider UI may change, not an
ORQST enforcement claim. OS user privileges, no hard CPU/RSS/descendant containment
and the start-authorized 30-minute owned-process deadline are explicit.

**Identity and next milestone.** Keep immutable random instance UUID, project
reference, Core epoch, client and attachment separate. Display the instance UUID
now; a persistent nonreused `T-NNN` registry, names, task/model/session correlations
and structured task/result routing are pending. The current one-live-instance per
project admission rule intentionally remains: merely increasing it while sharing
one managed home would not deliver independent agents. The next multi-agent slice
must add separate per-terminal state/ownership, workspace-scoped visible identity,
reviewed concurrency admission and individually authorized starts. Then test two
same-workspace agents and a versioned task/result channel independently of PTY
bytes. Never infer delegation or grant permissions from agent-generated prose.

**Consequences.** View close hides/detaches without terminating work. Quit/transport
loss revokes controls and journals uncertainty; no stored-PID signaling, adoption,
retry/resume or lost-slot reconciliation is added. The independent PTY host retains
the disclosed deadline. Output is bounded and parsed before the next read; gaps
stop reconstruction/input. OSC clipboard/title/link effects, automatic emulator
responses, remote resources and navigation are denied. Only this document permits
dynamic inline CSS for xterm. Synthetic real Electron/PTY acceptance proves the
composed path, not Codex authentication, readiness, model access, sandbox behavior,
human consent or provider approval semantics. Existing observer/Analytics/Artifacts
behavior and historical roadmap/ADR evidence remain intact. See
[operation and limits](../development/managed-codex-terminal.md).

## ADR-033 — Opt-in durable pane communication without terminal injection

**Status:** Implemented as a private Core library with synthetic tests; real-provider
integration and public transports are not enabled.

The Core owns stable workspace-scoped pane identity, strict task/message contracts,
private scoped authorization, durable local FIFO and separate delivery/task facts.
The existing SQLite writer opens an optional, separately versioned metadata journal;
normal observation is unchanged. Display IDs are never recycled. Native terminal
instance/project/epoch bindings remain distinct from workspace and observed sessions.
Trusted native enrollment must verify those bindings; text, names and PIDs cannot.

Use structured provider callbacks with explicit message/task/correlation/attempt and
instance/epoch evidence. A PTY is not the messaging protocol. Persist references and
audit metadata rather than prompts/results. Queue admission is not acceptance or
completion. Unknown side effects hold capacity and cannot automatically retry.
Restart fences old writers, invalidates authorizations and requires explicit
re-enrollment/reauthorization of undispatched work.

The library notifies the initiating Core client after a committed result and retains
an inbox, but this does not prove delivery into a real initiating agent. No runtime,
provider, MCP, planner, UI Inspector or two-agent acceptance is claimed. See the
[versioned contract and integration gates](../api/pane-communication.md).

## ADR-034 — Native Studio layout without additional execution authority

**Status:** Implemented incremental layout, 2026-11-03; real-provider acceptance pending.

Keep the two existing sandboxed terminal WebContentsViews as siblings of the loaded
observer view in one BrowserWindow. Main owns visibility, orientation, ratio and focus;
the terminal preload accepts only fixed layout actions and an exact integer ratio
between 25 and 75. Sender/frame/session/generation/native focus checks remain required.
Layout notifications carry layout metadata only; the observer receives no capability.

A/B navigation, split changes and maximize/restore retain the same live documents,
Core identities and PTYs. Revoke input before changing layout; view restoration never
restores a lease. Labels come from reviewed manifests, not process output. Keep only
in-memory layout preferences and the existing bounded two-slot/provider selection;
no provider startup, schema migration, durable restoration, model capability or
additional ownership is implied. A toolbar range control supplies mouse/keyboard
resizing; draggable native boundaries and full multi-tab Studio remain future work.

---

## ADR-035 — Audited source reuse with preserved observer and managed boundaries

**Status:** Accepted on 2026-11-03 for the audited component below.

**Context.** Existing CLI/process/recovery implementations must be evaluated before
adding replacements. Apache-2.0 permits compatible third-party incorporation with
license, attribution and modification notices; a project license alone does not
clear every dependency or establish runtime compatibility.

**Decision.** Permit narrow source reuse after exact-commit license/NOTICE,
dependency-closure, security and compatibility review. Preserve the historical
reference audit and ADR-013 as records of the earlier no-copy decision. This new
decision authorizes the audited Anywh `BufferLineSplitter` adaptation in the private
Codex channel; it does not import Tucano, Overclock, an upstream relay, schemas or
assets. See the [source ledger and decision matrix](../research/reuse-first-audit.md).

**Consequences.** Retain source provenance/modification headers, LICENSE and NOTICE.
The adaptation removes repeated prefix concatenation during fragmented structured
RPC, while preserving existing limits, strict decoding, correlation and failure
semantics. No public API, dependency, data migration, service, listener or authority
is added. The observer remains read-only; separately authorized native managed
operations remain valid. Static upstream declarations, synthetic validation and
real-provider acceptance remain distinct. Revert the isolated increment to restore
the previous parser without touching stored data or native sessions.

## ADR-036 — Bounded same-workspace interactive terminal teams

**Status:** Owner-authorized incremental implementation, 2026-11-03. Synthetic
validation and real-provider acceptance are separate.

**Context.** The team/recovery and reuse-first requirements authorize N members.
The A/B transport, selector and UI had independent fixed-two assumptions, while
robust signed per-slot ownership and all-exit retirement already existed.

**Decision.** Generalize those collections to 1–8 interactive slots, default maximum
two, configured by `ORQST_TERMINAL_LIMIT` and revalidated by Node Core. Require one
canonical project and provider per selection, with distinct state, journal,
supervisor, native sender and process ownership for every member. Keep the existing
A/B preset and exactly-two-member MCP. Keep the old sticky marker name so unknown
reservations cannot be bypassed. Preflight predictable journal/owner conflicts
before start-proof consumption; uncertain effects remain unretryable.

**Superseded scope.** This explicitly supersedes ADR-032's **one live instance per
project** statement for this interactive team composition. Its historical text is
preserved. The numeric supervisor/journal rule remains one per project **per
admission domain**, and each Desktop slot has its own domain. N independent slots
therefore may run in the same project. Neither that rule nor the selection limit
is a global machine/workspace quota; alternate profiles, independent library
instances and external CLIs are outside that enforcement. Structured Managed agents
keeps its existing contract and shares this profile's sticky reservation.

**Consequences.** Persist UUID metadata in newly created manifests and return its
P-UUID metadata alias from Core. Do not invent communication-registry display IDs
or grant control through aliases. Review all manifests without truncation; preserve
one-use grants and require owned exits from all dispatched slots before archiving,
fencing and releasing the team. One uncertain slot blocks release. Only two native
documents are split at once; all members are accessible by tabs in one window.
Mixed providers, models, team SQLite tables, live membership/recycling, reconnect,
real authentication and provider delegation remain gated and incomplete. No new
HTTP endpoint, dependency or third-party source reuse is needed. See
[workflow and verification](../development/terminal-teams.md).

## ADR-037: Exactly two Codex/OpenCode terminals

**Status:** Implemented selection contract, 2026-11-03; real acceptance pending.

Extend ADR-036 only for an ordered selection of exactly two independently prepared
manifests: one Codex, one OpenCode, in the same canonical project. Keep the single
shared Core inspection authoritative instead of duplicating the provider policy in
native review. Other mixed pairs and 3–8-member mixed teams remain refused.

No merged provider environment, new runner, credential store or approval mechanism
is introduced. Individual profiles, signed broker grants, sticky admission and
OpenCode's separately acknowledged startup/database/activity effects remain intact.
MCP stays exactly two opted-in members with a separate task grant. Owned TUI exits
do not validate OpenCode descendants, and therefore cannot release its reservation.
The creation wizard remains homogeneous; native selection composes existing files.
Synthetic process/transport evidence does not prove real login, human consent,
model availability or A-to-B processing. See [client workflow](../development/codex-opencode-pair.md).
