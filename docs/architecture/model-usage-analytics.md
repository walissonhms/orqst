# Model Usage Analytics — product and data contract design

## Status and purpose

**Mandatory for the functional Desktop MVP.** The measurement/aggregation foundation
is in progress alongside Core/Bridge separation. Ranking, filters, charts, comparator
and export are not accepted as complete until integrated and validated against real
available data. This document specifies planned semantics, not a wire API or SQL
schema. [Coverage](product-requirements.md) and the [roadmap](../../ROADMAP.md)
distinguish the existing observer from required delivery.

Analytics means local analysis of source-backed usage. It does not introduce tracking,
remote telemetry, accounts, billing, automatic uploads or Cloud content storage.
No prompt, secret, conversation, terminal output, source code or private path belongs
in an exported usage report. Redaction remains best-effort, not a privacy guarantee.

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
windows. Retention currently removes events but keeps session totals; this does not
preserve complete historical model/time attribution. Design additive local metric
storage/baselines and migration/replay policy before promising historical coverage.
Do not rewrite the existing migration or native session files.

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

CSV and Markdown reports contain an explicit allowlist of aggregate fields,
non-sensitive display identifiers, filters, source/quality summaries, denominators
and coverage warnings. Exclude captured content, credentials, raw source references,
private project paths and command arguments. Prefer local project aliases or explicit
user-selected names over automatic path disclosure. Treat model/project labels as
untrusted: escape Markdown and guard spreadsheet formula injection in CSV.

Export uses a destination picker and explicit overwrite confirmation; cancellation
must not change a file. No remote upload or automatic report delivery. Maintain
loopback cookie/Host/Origin/CSP controls for any future Analytics endpoint; observation
access never grants managed-session control. Review API/security docs alongside the
actual implementation before publishing endpoint shapes.

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
