# Architecture decisions

These records document the durable product and engineering decisions.

## ADR-001 — One bridge process, no separate server app

**Status:** Accepted

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

**Status:** Accepted

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

**Status:** Accepted

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

**Status:** Accepted

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

**Status:** Accepted

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

**Status:** Accepted

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
