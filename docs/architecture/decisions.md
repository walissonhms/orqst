# Architecture decisions

These records document the durable product and engineering decisions.

## Decision status and implementation

ADRs 015–024 record the architecture direction approved on 2026-11-02 during
Phase 0. **Accepted direction does not mean implemented or authorized for
implementation in this phase.** Phase 0 changes documentation and contract design
only. ADR-025 adds the authorized optimizer research/benchmark scope, without
production activation. Phase 1 requires separate approval; see [ROADMAP](../../ROADMAP.md).

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
