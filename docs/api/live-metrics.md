# Confirmed session Live Metrics

The session header and manual Artifacts panel show normalized cumulative **session**
tokens, in browser and Desktop. These are never tokens attributed to an artifact,
model, task outcome or price. A temporary visual session threshold is described below.
Terminal metrics, persistent/project limits, verified prices, Fast indicators and
number/mascot animations remain planned, without placeholder controls.

## Query and contract

`GET /api/sessions/:sessionId/metrics` accepts one URI-encoded opaque session ID
(1–1024 characters, nonblank, no control characters) and **no query parameters**.
It inherits loopback Host/Origin/fetch-metadata checks, process cookie and `no-store`.
Malformed requests return a fixed 400 error. Existing snapshot/event/WebSocket v1
shapes are unchanged. Unavailable evidence returns 200, never fabricated counts.

`SessionMetricsResult` is a strict discriminated union:

- `availability: "available"`, with `value.contract: "orqst.live-metrics"`,
  `contractVersion: 1`, identity, usage, normalization and evidence below.
- `availability: "unavailable"`, with `reason`: `session_not_found`,
  `usage_not_recorded`, `unsupported_adapter`, `evidence_missing`, `evidence_limit`,
  `invalid_evidence` or `identity_conflict`. No counts or timestamps are supplied.

An available value includes:

- `identity.sessionRef`: machine ID, Codex adapter ID and native session ID;
  `agentId` and `sourceWorkspaceId` from historical evidence. Manual workspace
  association does not rewrite or invalidate this historical origin.
- `usage`: safe nonnegative integer input/output/cached/total, with `cached <= input`
  and `total = input + output`. Cache is never added again.
- `usageKind: "session_cumulative"`, `normalization: "codex_session_snapshot"`,
  `fieldPresence: "not_preserved"`. Normalization requires input/output, defaults
  missing cache to zero and missing total to input + output. Compact metadata cannot
  prove individual provider field presence. A proven normalized zero snapshot is
  valid; absent evidence is unavailable.
- `evidence.kind: "compact_evidence"`, event ID, positive safe sequence,
  `occurredAt` (ISO date-time with UTC or explicit offset), recorded source
  file/byte offset/line/hash/record type, nullable turn/response IDs.
  `observedAt` is unavailable with `not_recorded`; source verification is
  `not_rechecked`. Compact metadata does not preserve `event.type`, so no full-event
  type/schema claim is made. No source file is opened or verified.

## Selection, retention and limits

The Store reads canonical `token_usage` and compact evidence in one deferred SQLite
read snapshot on the existing connection, synchronously without awaiting or reserving
a write lock. No writer, migration, source scan or accounting change is introduced.

The query admits at most **256 newest compact rows** via the session/sequence index,
**16 KiB per metadata record**, **256 KiB of metadata** and **16 KiB of response**.
SQLite reports UTF-8 BLOB lengths before any metadata is transferred or parsed. The
entire bounded window must pass byte admission. There is no full-history scan, JSON
filter, historical replay or message-body transfer. Failure returns unavailable,
without partial sums or canonical-only fallback. This small query runs on the observer
thread; it has no arbitrary-archive or external-SQLite-contention latency guarantee.
Larger budgets require a separate performance decision.

Descending sequence selects the newest exact cumulative usage/timestamp/source-priority
match **before** validating machine/adapter/session/agent against the observed session.
Later conflicting ties cannot be hidden by choosing an older convenient source.
Compact row ID/session/timestamp and admitted sequence are checked; sequence belongs
to the row, not metadata. Supported source types are `token_usage_record` and
`event_msg:token_count`. Malformed metadata, conflicts, unsupported source, absent proof
and exceeded budgets fail closed. Current workspace/model/activity never supply proof.

Schema-2 compact evidence and canonical totals survive detail retention. Pre-upgrade
deleted evidence is not reconstructed. Existing event/evidence ID deduplication and
canonical replacement handle replay and mirrors; cumulative snapshots are never summed.
Evidence outside the bounded window remains unavailable even when totals survive.

## UI and availability

One selected-session query is shared by header and Artifacts, including the usage tab.
Existing snapshot reconciliation refreshes it after WS events/resync/reconnection and
fallback polling; no new timer or artifact query is added. Aborted/late requests cannot
replace newer state, and confirmed sequence/time regressions fail closed.

Counts are always the **last confirmed reading**, with the metric's occurrence
date/time/timezone. Session activity, fetch time and artifact time never substitute for
token time. Connected transport cannot establish usage after that instant. Refresh,
failure, unavailable results and disconnection keep previous confirmed counts/time
explicitly out of date. Without previous proof, the view is unavailable without numeric
defaults. Opening another session does not carry metrics across sessions. Text labels,
description-list label/value pairs, keyboard-accessible details, locale formatting and
wrapping mobile layout support accessibility. One polite live region in the session
header announces meaningful availability/failure/count changes; polling refresh remains
visual only and the Artifacts panel does not duplicate announcements.

After a baseline reading, a greater confirmed evidence sequence with changed counts
briefly outlines only the changed fields and labels them "Confirmed value updated".
The 1.6-second cue uses exact final values, never interpolated counts, rates, elapsed
time or an inferred measurement timestamp. Its background fades once; reduced-motion
preferences disable that animation while preserving the static outline and text.
Identical polling, first load (including a newly opened Artifacts panel), equal-sequence
replays and recovery of the same reading do not trigger the cue. Pending/stale, failed,
offline and unavailable states suppress and clear it without replacing confirmed values
or time. The bounded UI timeout is cleaned up on replacement/unmount; it does not poll
or fetch data. No extra live region or focus movement is introduced.

## Temporary session token alert

The session header offers an optional visual threshold, applied explicitly as a
positive safe integer (1 through 9007199254740991, digits only). Editing its draft
does not change an applied threshold; invalid input preserves the previous setting.
Clear removes it. One memory-only value belongs to the open session details and is
shared with its manual Artifacts header. Closing details, changing the selected
session or reloading clears it. Opening/closing Artifacts does not reset it.

Comparison uses only the confirmed normalized cumulative `usage.total`: input plus
output, with cached input included once. Equality counts as reached. This threshold
includes historical session usage, not usage since applying it, project totals,
artifact usage or money. The source metric time and normalization disclosures stay
visible. Usage after that time is unknown even below the threshold. Reached/below
states require an available, non-stale reading; pending, failed, unavailable and
offline readings show comparison unavailable while retaining the threshold and last
confirmed counts. Recovery reevaluates the confirmed reading without predicting use.

The comparison also shows the exact absolute difference between the confirmed total
and the threshold, formatted in the selected locale. Equality has explicit text.
This is arithmetic on one safe-integer cumulative reading, not a token rate, forecast,
remaining provider allowance or allocation to an artifact. Cached input is not added
again. When comparison is unavailable, both the difference and the reached indicator
are removed; previous confirmed counts/time remain labeled as out of date.

The warning uses static text, a border/color cue and a small static flame icon at or
above the threshold. The decorative icon is hidden from accessibility APIs; the text
conveys the full result. It stays still with or without reduced motion and never
relies on color alone or adds motion, sound, OS notifications or a new live region.
The existing session announcer includes the last settled comparison and difference
and stays stable through polling's transient pending state; Artifacts remains silent.
This advisory neither enforces
a provider quota/spending limit nor stops or changes execution. Nothing is persisted,
sent to the Bridge, added to an export or written to observed sessions. Persistent/
project limits, native alert policy and enforceable budgets require separate work.

## Security review note

This authenticated GET grants no source-root, file-opening, clipboard, execution or
IPC authority. Runtime allowlists validate requests/output; SQL uses bound parameters,
indexed reads and byte admission. Errors omit raw SQLite/JSON diagnostics. Recorded
paths/IDs/hashes remain sensitive local metadata, rendered as inert React text.
Cookie/Host/Origin/CSP/loopback and single-writer protections remain unchanged.
Bootstrap still assumes a trusted local OS user; this is not provider-source authentication.
