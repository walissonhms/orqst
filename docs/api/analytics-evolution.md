# Observed usage evolution

## Contract and accounting

`GET /api/analytics/models/evolution` is an additive authenticated read endpoint.
It accepts exactly the same filters, half-open period, duplicate/length validation
and errors as [`/api/analytics/models`](rest.md#get-apianalyticsmodels).
The original aggregate API, event/WebSocket stream, CSV/Markdown and native Desktop
export contracts are unchanged. No schema migration, source access or writes occur.

The strict `orqst.model-analytics-evolution` version 1 response contains:

- `summary`: the existing complete aggregate summary for this SQLite read snapshot,
  including current filters, incomplete coverage, gap counts and unavailable metrics.
- `bucketDays`: a positive power of two. Windows start at UTC midnight, aligned to
  multiples of this many days from the Unix epoch (1970-01-01T00:00:00Z).
- `buckets`: at most 64 chronological contiguous `{from,to,usage}` windows, with
  inclusive UTC start and exclusive UTC end. Only the span between the earliest and
  latest admitted interval ends is emitted. Calendar filter bounds are not expanded.
- `undistributedUsage`: admitted first lifetime snapshots with no known interval
  start, summed separately, or `null` when none were reported under these filters.

The reader reuses canonical cumulative admission, model attribution and period
containment. Each selected contribution with a known start is assigned whole to
its final measurement's window. An interval can cross several windows: **these are
interval-end observations, not measured daily consumption**. No proportional split,
interpolation, extrapolation or latest-model assignment occurs. Unidentified models
remain unidentified; model/agent/workspace/adapter filters retain existing semantics.
Coverage counts apply before the model filter, as in the ranking.

Start with one-day windows and double their width until the span fits 64 windows.
Coarsening folds only admitted usage and retains integer precision. Empty windows
have `usage:null`; measured zero remains numeric zero. Missing windows do not prove
inactivity or no consumption. All four components of measured windows plus any
reported undistributed usage reconcile to `summary.usage`; null stays unavailable.
Cached input remains a subset of input. An initial lifetime total never receives
an invented date distribution, including a numeric-zero initial snapshot.

## Dashboard behavior

**Usage evolution** is integrated into **Most used models** below the descriptive
comparison. **Show evolution** explicitly requests a reading with the current
ranking filters. Choose an exact model or unidentified attribution to inspect its
series. The chronological bars share a maximum scale; the table supplies UTC window
boundaries and input/output/cache/total as text, including missing values.

The returned summary must match the currently displayed ranking exactly after
runtime parsing. A changed reading or query is rejected with refresh guidance.
Changing filters/reading, losing connection or leaving the screen unmounts the
series and aborts pending work. Late replies cannot populate a different reading.
There is no automatic repeated query or retained series cache. The reading has its
own obtained time; it does not claim source completeness or daily consumption.
The aggregate export does not include the series.

## Bounds and security review

Both endpoints share the same one-worker/no-queue slot, 10-second watchdog,
read-only WAL connection, history admission budgets and 2 MiB response ceiling.
The series holds at most 64 windows while folding one session at a time; it does
not accumulate archive-wide individual contributions. Runtime schemas validate
window alignment, continuity and component reconciliation before transport, then
again in the dashboard. The browser bounds the response before JSON parsing.

The route inherits loopback binding, cookie/Host/Origin/fetch-metadata checks,
no-store/security headers and sanitized errors. It accepts no paths, executable
content or write operations. Individual event, source, session, machine, turn and
response IDs, captured bodies and source paths remain worker-local. The nested
summary retains the same query/model metadata and privacy limitations as the
existing aggregate API; it is not automatically uploaded. No security control is
relaxed and no new Desktop IPC grant is added.

Synthetic acceptance covers reconciliation, model changes, unknown attribution,
zero/null, period containment, filters, replay, retention, bounded long-history
coarsening, strict/authenticated API and observer-to-browser rendering. These checks
do not establish real-provider temporal coverage, arbitrary archive latency, native
visual acceptance or Desktop MVP completion. Ingestion is unchanged.
