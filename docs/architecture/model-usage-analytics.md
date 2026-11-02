# Model Usage Analytics — product and data contract design

## Status and purpose

**Mandatory for the functional Desktop MVP.** A read-only local aggregation foundation
and bounded summary API are implemented, along with a first browser ranking view.
Native Desktop export, time series and comparator remain incomplete. Browser CSV/Markdown
export is implemented within the separate [export contract](../api/analytics-export.md). Real
multi-model acceptance is still pending. The implementation boundaries below describe
current behavior; subsequent sections specify the broader product requirements.
[Coverage](product-requirements.md) and the [roadmap](../../ROADMAP.md) distinguish
the existing observer from required delivery.

Analytics means local analysis of source-backed usage. It does not introduce tracking,
remote telemetry, accounts, billing, automatic uploads or Cloud content storage.
No prompt, secret, conversation, terminal output, source code or private path belongs
in an exported usage report. Redaction remains best-effort, not a privacy guarantee.

## Implemented local foundation

`Store.modelAnalytics(query)` returns the separate `orqst.model-analytics` version 1
projection. Schema 2 adds compact durable metric/model evidence without changing
its contract or the v1 event/WebSocket stream. The separate
aggregate summary is exposed through authenticated
[`GET /api/analytics/models`](../api/rest.md#get-apianalyticsmodels), with aggregate
gap counts and no individual evidence or captured content. The complete local
report described below remains a library-only inspection surface.
Query filters support explicit offset-aware `from`/`to` instants, current workspace
assignment, agent, adapter and model; `model: null` selects unidentified attribution.
Calendar presets and provider filtering are not implemented. Adapter is the CLI,
while the underlying provider remains unavailable.

The projection replays the existing cumulative admission rule and reconciles its
latest evidenced snapshot with the canonical session total. Duplicate events, mirrors,
response increments and turn snapshots do not add consumption. Only intervals whose
end is within the half-open window and whose start is at or after `from` contribute.
Crossing intervals are omitted with a coverage gap; no interpolation occurs. Without
a lower bound, the first snapshot contributes its lifetime usage to the unidentified
bucket because its time distribution and earlier models are unknown.

Model attribution requires consistent nonempty model evidence at both snapshot
boundaries with no conflicting intervening declaration. Missing or changed models
retain an unidentified contribution. Evidence includes event/source references,
intervals and observed session origin. It is intended for local inspection and may
include source file paths; it is **not** a privacy-safe export payload.

Rows rank covered reported totals and retain `usage: null` when no measurement can
be attributed. Session counts describe observed sessions and are not additive across
model rows. Coverage is always qualified as unverified, with explicit gaps for missing
canonical evidence, invalid/non-monotonic usage, identity conflicts and period boundaries.
Pre-upgrade retention can have removed evidence needed for allocation even when v1
totals survive; migration never reconstructs it. Schema-2 observations survive
subsequent detail expiry under the explicit [metric lifecycle](data-model.md#retention).
Executions, active duration, outcomes, equivalence, reasoning, prices and costs remain
unavailable. The unrestricted library query reads retained evidence synchronously.
HTTP uses a disposable worker with a read-only SQLite WAL snapshot and compact
metric/identity/provenance projection, folding one session at a time. The observer
remains the only writer; no message, tool argument or result content is loaded into
JavaScript for the query. The aggregate response and conservative replay semantics
are unchanged. Admission allows 5000 sessions, 250000 envelopes, 256 MiB of evidence,
8 MiB per record, 64 MiB of projected metadata and 2 MiB of aggregate response. All selected history counts,
including retained message-only records, compact records without surviving details
and out-of-window baselines. An event with a compact copy counts once; its full
envelope consumes the byte budget until details expire. One query runs at a time without a
queue; a 10-second watchdog covers setup through confirmed cleanup. Success after
the deadline is rejected; timeout responds independently while the slot remains
occupied until termination is confirmed. Disconnect cancels the query and shutdown
awaits cleanup even after timeout. Native SQL and OS/event-loop scheduling may
delay termination or the watchdog callback. Explicit capacity/busy/timeout/
cancel/unavailable errors contain no partial result or diagnostics. See the
[route contract](../api/rest.md#get-apianalyticsmodels) for exact limits and failures.
The old synchronous `Store.modelAnalyticsSummary()` remains a library surface with
its original 100-session/1000-record/2-MiB bounds. Compact evidence has no automatic
expiry, matching canonical totals; arbitrary archive performance remains unvalidated.

Fourteen synthetic Analytics tests cover contracts, cumulative accounting, model
changes, windows, scopes, unavailable versus zero, retention, replay, schema preservation
and source identity. They do not establish real-provider ranking or full Desktop acceptance.

## Implemented browser increment

Open **Most used models** in the existing dashboard sidebar, or `/#models`. The view
uses the bounded summary API, with token ranking by default and a separate observed
session order. It shows leader, reported total and distinct-session cards, share bars,
input/output/cache columns, unidentified models, unavailable values and coverage gaps.
Shares use the selected query's covered total, including unidentified contributions;
model filters narrow that denominator. Session rows are not additive across models.

Periods are local calendar days: today, today plus the preceding 6 or 29 days,
inclusive custom dates, or all history. Local midnight boundaries become half-open
UTC instants, including DST transitions. Invalid custom intervals send no request.
Workspace selection is shared with the overview; agent/model fields accept exact
observed IDs and the adapter selector lists implemented observers. There is no
underlying provider selector because provider identity is not established.

Requests refresh on opening, filter changes, explicit refresh and debounced cursor
changes; snapshot polling without new events does not recompute Analytics. Aborted
or late requests cannot replace current results. Capacity failures clear results and
show an explicit warning, without fabricated zeros or partial totals. Model labels
render as plain text. Both locales and mobile table navigation are supported.

Integration passed lint/types, 64 Node tests, build and 11 Chromium tests, including
one unmocked two-model synthetic observer-to-API-to-screen test. Real provider
multi-model allocation, large-archive performance, temporal charts, native Desktop export,
equivalent-task comparison and the full Desktop workflow remain unvalidated or
unimplemented. No complete Analytics MVP acceptance is claimed.

## Measurement identity and provenance

A qualified measurement must retain the observed model identifier, provider, agent,
session, project, timestamp/window, source reference, measurement basis and reliability.
Preserve provider IDs and distinguish agent CLI from underlying model/provider: a CLI
name does not identify the model. Keep explicit observed/imported versus managed
origin, measurement time versus import time, missing intervals and data coverage.
An adapter identity alone must not fabricate an underlying provider identity.

Quality is observed, estimated or unavailable, with reason and source. A missing
model is **unidentified model**, never a guessed default or inferred from agent name,
subscription or later metadata. Preserve raw observed identifiers; any aliases/display
names need explicit versioned mapping and must not silently merge distinct models.
If provider identity is absent, retain an explicit unidentified provider as well.

A model change does not allocate a session's entire cumulative total to the latest
model. Attribute usage only to intervals/records whose model is evidenced. Preserve
an unattributed bucket for ambiguous usage and disclose it in totals/share. A name
such as DeepSeek or Sol is a comparison label only when supported by observed data;
it does not guarantee a provider, available model or executable configuration.

## Accounting and period boundaries

Preserve [Codex cumulative semantics](data-model.md#token-accounting): canonical
thread-scoped snapshots take priority over compatibility mirrors; response/turn
values are not added to cumulative totals. Cache is a subset of input for Codex;
never add it again. Reasoning and cache read/write are separate only where exposed
with known subset semantics. Missing optional fields are unavailable, not measured
zero. Keep original metric/source semantics even if another provider reports them
differently.

For a period, cumulative deltas require compatible snapshots and a known baseline.
Do not sum snapshots, count an entire imported lifetime in its import day, or divide
a mixed-model lifetime by its latest model. A first snapshot after the window starts
may include earlier usage; resets, model switches, inherited history and retention
can make a delta unattributable. Preserve uncertainty rather than fabricate a delta.

Define the time-zone/window policy before implementation: local calendar today,
7-day and 30-day windows, custom bounds and half-open UTC query bounds must agree
across charts, cards and exports. Document whether presets are calendar or rolling
windows. Detail retention removes events but keeps session totals and schema-2 compact
evidence. Migration backfills only surviving events, so complete historical
model/time attribution is not guaranteed. No baseline or model is fabricated for
previously removed data. Migration 1 and native session files remain unchanged.

Existing `Usage` contains numeric defaults; a zero in a legacy session summary alone
is not evidence of a reported zero. New qualified aggregates must distinguish unknown
from known zero and show coverage without inventing a completeness percentage.
Preserve old clients through additive/versioned contracts and compatibility tests.

## Most Used Models screen

Default ordering is **reported total tokens in the selected period**, with model and
provider visible. Offer alternative ordering by session count, execution count and
active time only when their denominator and source are known. A discovered session,
completed provider turn, managed execution and successful task are distinct units.
Do not turn inactivity or session lifespan into active time.

Required filters are today, 7 days, 30 days and custom interval; all projects or one
project; agent, provider and model. Every card/chart/export must use the same filter
and accounting policy. Show model bars, a time series, percentage share and leader,
total-token and session-count cards. Empty data produces an honest empty state.
Shares disclose the denominator, unidentified/unattributed usage and incomplete
coverage; a leader is only the leader among covered observations.

Keep input/output/cache breakdowns visible; expose reasoning separately when
available. Token consumption is not money. Live values advance only after real
measurements and show the last confirmed update time when stale/unavailable.

## Qualified model comparison

Compare two or more observed models side by side, including different agents.
Show total tokens, tokens per execution, mean/median tokens per completed successful
task, measured time, success rate and verifiable cost only with the required data.
Each metric must show its denominator, sample size, source/window, availability and
coverage. Record explicit task result, failures, repairs/retries and their usage;
provider turn completion alone is not proof of task success or correctness.

Efficiency comparisons require equivalent tasks identified by project, category,
difficulty and period, with explicit equivalence/outcome evidence. Where equivalence
is missing or mismatched, label results **descriptive, non-equivalent** and do not
declare a superior model. Token-only rankings cannot infer quality. Missing outcomes,
repair usage, timing or prices remain unavailable and cannot count as success/free
execution. Preserve failed attempts in denominators and net task usage.

Keep these questions distinct:

- **Most used:** sessions or reported tokens within stated coverage.
- **Lowest consumption per successful task:** outcome-qualified comparable tasks,
  including failed/repair attempts and overhead according to a documented policy.
- **Best value:** comparable quality plus verified prices and billing regime; never
  assume CLI subscription usage equals pay-as-you-go API spend.

Cost distinguishes provider-reported amounts, rate-based estimates and reconciled
billing. Estimates retain rate source, effective date, currency, model and cache
semantics, billing mode and uncertainty. A verified rate still does not prove an
actual bill. Unknown rates or mixed models without interval attribution prevent a
qualified monetary comparison. Generation speed requires a measured generation
interval, not total elapsed session time.

## Export and local security

Browser CSV/Markdown export is implemented as a strict projection of the current
aggregate response. It preserves nulls, unidentified buckets, basis/unavailable and
coverage/gaps; it excludes individual evidence and private filter values. Arbitrary
model IDs remain potentially sensitive metadata: escaping is not redaction. The UI
warns before export. Streaming input and output are each bounded to 2 MiB; export
admission caps 5,000 buckets and model labels at 256 UTF-16 code units, without
truncation. Export-only limits do not remove legitimate screen data.

CSV uses literal-prefixed text, visible control/punctuation encoding, rectangular
quoted records and typed text for integers exceeding 15 digits. Markdown wraps the
same reversible representation in code spans within fixed table structure. No new
model attribution or metrics are computed. Refresh/filter/cursor/error/offline and
reconnection block export until a fresh associated response arrives.

Browser settings control destination and overwrite behavior; browser export does not
claim disk-save success. Electron continues denying downloads. Its separate native
Analytics capability validates and refetches the exact confirmed aggregate before
and after destination/overwrite dialogs. Context changes revoke pending operations;
no page content/path or external-open action is accepted. Artifacts keeps its own
Markdown contract. Final source checking and in-place file writes are not atomic. See
[precise fields, formats, limits and security review](../api/analytics-export.md).

## Integration acceptance

Use clearly synthetic fixtures for accounting and browser tests, then separately
validate authorized real observations. At least two distinct observed models must
reconcile ranking/chart totals to canonical source usage. Test all filters, unknown
model/provider, mixed-model snapshots, mirrors/replay, missing period baseline,
retention, incomplete coverage, no data, unavailable versus zero, model switching,
non-equivalent tasks, failed/repair attempts and absent prices/outcomes/timing.

Export tests must reject private content and handle hostile labels, CSV formulas,
cancel and overwrite. UI tests require en-US/pt-BR keys and accessible chart/table
alternatives. Run lint, types, tests, build and relevant browser checks; ingestion
changes also require bounded local validation. Never rerun live token-consuming
benchmarks merely to populate Analytics. Report unobserved real-provider cases as
unvalidated; foundation tests alone do not complete Desktop Analytics acceptance.
