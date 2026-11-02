# ORQST roadmap

## Product direction and delivery status

ORQST is a local-first, observability-first desktop platform in development.
Community remains Apache-2.0 and independent of Cloud. Release metadata remains
`0.1.0`; this roadmap does not announce a release or claim MVP acceptance.
The integrated baseline is the read-only Codex observer in [README](README.md).

Incremental, non-destructive development is authorized. **The observer Core extraction and local Analytics library are
implemented and integration-tested; Phase 1 remains incomplete.** Compact durable metric/model evidence is implemented with additive schema 2;
pre-upgrade gaps remain qualified. Local versioned observed-session evidence and
artifact message references are implemented with runtime validation; broader
lifecycle transport, extraction and managed contracts remain planned. There is no blanket “Phase 1 awaiting approval” gate.
Passing checks permits incremental progress within scope; product decisions,
destructive actions, credentials, external costs and ungranted permissions still
require a decision. Development authorization is not production activation.

The [requirement matrix](docs/architecture/product-requirements.md) audits existing,
partial and absent behavior. The [Analytics design](docs/architecture/model-usage-analytics.md)
defines mandatory Desktop metrics without inventing provider data.

## Mandatory quality and security criteria for each increment

Apply the public [contribution policy](CONTRIBUTING.md), [security policy](SECURITY.md),
[security model](docs/architecture/security-model.md) and
[verification guidance](docs/development/testing.md) to every delivery:

- Follow verified project versions, architecture and existing patterns; keep scope
  minimal and code readable and maintainable. Review the resulting diff independently.
- Preserve data integrity, provenance, migrations and API compatibility; validate
  untrusted inputs, permissions and resource boundaries. Protect privacy and secrets.
- Bound work, memory and I/O; explain performance limits and failure behavior. Review
  dependency necessity, provenance and license compatibility before adding one.
- Run appropriate lint, types, tests, build and integration checks. Report actual
  outcomes, skipped checks and remaining limitations without certification or implied
  release acceptance. Preserve earlier evidence rather than rewriting it.

These are cross-cutting delivery criteria, not additional approval gates.

## Phase numbering migration

The six phases below supersede the earlier roadmap sequence. Previous ADRs and
benchmark reports retain their historical Phase 0 wording and evidence.

| Previous phase                              | New location and reason                                                                                                         |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 0 — Architecture contracts and research     | Historical baseline; contracts inform Phase 1, optimizer evidence informs Phase 5.                                              |
| 1 — Independent observer Core               | Phase 1 — Core and contracts; retains bounded observer extraction.                                                              |
| 2 — Desktop observer                        | Phase 2 — Desktop MVP; now includes Terminal, Artifacts, Model Manager, Live Metrics and mandatory Analytics.                   |
| 3 — Managed Codex and terminals             | Terminal UI belongs to Phase 2; authorized process/session control belongs to Phase 4.                                          |
| 4 — Recovery and additional adapters        | Phase 3 — Robust integrations; managed recovery also belongs to Phase 4.                                                        |
| 5 — Structured local delegation             | Deferred extension after Phase 4, not a Desktop MVP requirement or an optimizer prerequisite.                                   |
| 6 — Qualified metrics and budgets           | Metric contracts in Phase 1; Live Metrics, model Analytics and alert limits in Phase 2; enforceable controls depend on Phase 4. |
| 7 — Forecasts and remote observability      | Deferred independent gates; neither is required for the six-phase local Desktop delivery.                                       |
| Foundational optimizer research/integration | Historical research remains intact; production integration moves to Phase 5.                                                    |

## Backlog by phase

Each row is a reviewable outcome, not a claim of delivery. Tests listed here are
acceptance requirements, not checks already run. P0 protects compatibility/data;
P1 delivers the functional desktop; P2 completes evidence and distribution.

| Phase / priority / status                    | Deliverable                                                                                                                  | Dependencies                                                                                                        | Risks                                                                                         | Tests and acceptance                                                                                                                                                                                                              |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 / P0 / Implemented; integration-tested     | Extract UI-independent observer Core; Bridge retains transport/composition entry point.                                      | Existing adapters, store, v1 protocol; explicit lifecycle ownership.                                                | Two writers, shutdown races, service/asset path regressions.                                  | Lifecycle tests for readiness, bind failure, repeated stop and partial startup; preserve REST/WS, IDs, settings, checkpoints, retention and replay; one SQLite writer.                                                            |
| 1 / P0 / Partial; library integration-tested | Analytics foundation: source-backed metric/model/session contracts and durable time basis.                                   | Codex cumulative accounting and model event evidence; schema/compatibility review.                                  | Assigning history to latest model, duplicate cumulative totals, missing values becoming zero. | Mixed/unknown models, mirrors, replay, missing baselines, retention and safe migration tests; old data and v1 clients preserved; unsupported fields explicitly unavailable.                                                       |
| 1 / P0 / Partial; local library tested       | Normalize lifecycle and artifact references without reinterpreting v1 statuses.                                              | Version negotiation and documented provider evidence.                                                               | Turn completion confused with task success or process exit.                                   | Unknown versions rejected, source references retained; started/running/completed/error/interrupted/waiting evidence tested; approval/quota only when exposed.                                                                     |
| 2 / P1 / Planned                             | Electron shell, shared React UI, multiple project/session terminal tabs and live output.                                     | Phase 1; Electron/PTY versions, authentication and ownership decisions.                                             | Renderer privileges, terminal escape sequences, accidental process lifetime coupling.         | IPC sender/argument validation, reconnect/resize/output tests; macOS packaging smoke; closing UI does not stop independent work. Terminal input/interrupt requires Phase 4 control gate.                                          |
| 2 / P1 / Planned                             | Monitor, native macOS notifications, tray, history, pending count, silence/preferences and click-to-session.                 | Source-confirmed events; active monitor; native permission policy.                                                  | Import alerts, false completion, notification content leakage.                                | Foreground/minimized tests; duplicate suppression; completion/error/attention/approval/interruption only with evidence; denied permissions honest; native delivery verified on device.                                            |
| 2 / P1 / Planned                             | Artifacts extraction and independent source/preview/edit panel; copy raw/rendered text, save Markdown, external editor.      | Safe rendering, source/version provenance and file grant policy.                                                    | Untrusted HTML/links, ambiguous extraction, silent overwrite.                                 | Manual extraction fallback; hostile Markdown; preserve originals/history and project/session/agent/date; save dialog/cancel/overwrite tests; no file replaced without confirmation.                                               |
| 2 / P1 / Planned                             | Model Manager in session header; project/agent defaults, session overrides and supported reasoning/speed controls.           | Version-specific capability discovery; Phase 4 for execution changes.                                               | Invented models, invalid combinations, hidden restart on model change.                        | Missing CLI/models and unsupported options rejected; model switch support and restart impact visible; terminal does not imply access to private context.                                                                          |
| 2 / P1 / Planned                             | Live Metrics always visible in session/terminal/artifact headers, confirmed update time, alert limits and restrained motion. | Qualified Phase 1 measurements; metric/configuration policy.                                                        | Stale data shown as live, double cache accounting, inaccessible animations.                   | Input/output/cache/total reconciliation; last confirmed timestamp; session/project limits; verified-price-only cost; supported Fast indicator, threshold flame, state/mascot eye reactions and reduced-motion/performance checks. |
| 2 / P1 / Partial; first web screen tested    | **Mandatory Model Usage Analytics:** ranking, filters, charts, comparisons and content-free CSV/Markdown export.             | Phase 1 measurement provenance and coverage; [design](docs/architecture/model-usage-analytics.md).                  | Misleading superiority, absent data as zero, export leaks.                                    | Two or more model datasets reconcile to source totals; today/7d/30d/custom, project/agent/provider/model filters; unknown-model bucket; bars/trend/share/cards; equivalent-task guards, missing metrics and safe exports tested.  |
| 3 / P1 / Planned                             | Validate Codex, Claude Code and OpenCode individually; fallbacks, compatibility and later Windows/Linux.                     | Version-pinned native evidence and authorized test access per provider.                                             | Assuming parity, unsupported resume/approval/quota, provider drift.                           | Discovery, malformed/missing/reordered records, permissions, recovery and usage semantics per adapter; real evidence separately from fixtures; capabilities remain false/unverified until proven.                                 |
| 4 / P1 / Planned                             | Authorized managed start/stop/input/interrupt/resume with ownership, audit and recovery.                                     | Phase 1 contracts, Phase 3 capability for each enabled operation, reviewed principal/scopes and PTY lifecycle.      | Arbitrary execution, stale approval, external-session adoption, uncertain side effects.       | Deny unauthorized actions; constrain executable/args/cwd/environment; preserve external sessions; confirm destructive effects; reconcile crash/reboot before retry; window close differs from process stop.                       |
| 5 / P2 / Research only; runtime inactive     | Gradual optimizer validation/integration; Disabled, Economy and Intelligent with opt-out, fallback and audit.                | Authorized real repositories, complete tasks, correctness/cost/cache baseline and Phase 4 supplied-context support. | Lost required context, repair overhead, cache regression or unverifiable savings.             | Reproducible complete-task quality tests including failures/repairs/overhead, measured net benefit and verified billing basis; no private prompt interception; activation requires evidence and explicit decision.                |
| 6 / P2 / Planned                             | Packaging/installers/updates, performance, accessibility, local diagnostics and user docs.                                   | Integrated Desktop acceptance; packager/signing/update and platform decisions.                                      | Broken update/permissions, resource leaks, sensitive diagnostics.                             | Install/update/rollback smoke, long-running load, keyboard/screen reader/reduced motion, offline local use; diagnostics local and content-minimized, no automatic uploads.                                                        |

Phase 2 terminal execution is integrated with Phase 4 authorization and per-provider
Phase 3 evidence; numbering is not permission to bypass those dependencies. Desktop
observation/Analytics can be developed before managed execution, but the global MVP
is incomplete until the authorized start/input/interrupt path works. No placeholder
controls, providers or fabricated metrics count toward acceptance.

## Phase 1 compatibility and integration gate

Core extraction is bounded: preserve Node `>=24 <25`, pnpm 10.x, SQLite, existing
adapters and one writer. It does not activate Electron, PTY, execution, optimizer,
Cloud, delegation or public binding. Extraction alone needs no schema migration;
The durable Analytics increment adds migration 2 beside unchanged migration 1.
It retains compact evidence alongside totals, backfills only surviving details and
requires upgrade/recovery tests and owner review/backup before installed migration.
Do not install/restart the owner's service as a side effect of a check.

Integration must review the file/dependency map, ownership, start/stop behavior,
asset/service paths, data preservation, actual commands and outcomes. The
Core extraction initially passed 57 automated cases, 3 Chromium cases and bounded
real-source/browser compatibility checks. The later bounded Analytics API and first
web ranking view passed lint/types, 64 Node cases, build and 11 Chromium cases,
including unmocked two-model synthetic observer-to-screen reconciliation.
See [testing](docs/development/testing.md#incremental-delivery-and-integration) for
limits. Phase 1 now also includes strict local schemas and Core queries for retained observed-session
evidence and artifact message references (ADR-029). They preserve separate turn/task/process
semantics and explicit unavailable values, and add no stream, schema migration or UI.
Phase 1 still needs broader contracts and qualified historical coverage.

## Optimizer evidence and activation

[Phase 0 research](docs/benchmarks/token-optimization.md) reports 42 selected,
quality-qualified synthetic executions: Economy used 5.975% fewer reported tokens
and the guarded Intelligent prototype 8.768% fewer. These are fixture-specific
results, not production, monetary or cross-provider benefit. The report also retains
invalid attempts and limitations; this roadmap does not replace it or rerun live calls.

[ADR-025](docs/architecture/decisions.md#adr-025--independent-token-optimizer-and-evidence-gated-activation)
and the [optimizer design](docs/architecture/token-optimizer.md) preserve protected
context, native history and permission boundaries. Production optimization remains
inactive throughout current Core/Analytics development.

## Open decisions and explicit gates

- Core API/ownership and service/asset path compatibility at Phase 1 integration.
- Installed schema-2 migration after review/backup; historical coverage remains
  qualified. Compact evidence has no automatic expiry alongside totals (ADR-028);
  finite metric TTL, selective erasure or compaction require a separate policy decision.
- Electron/PTY versions, packager, signing/update strategy and crash lifetime before
  Desktop integration; no same-PTY survival guarantee across Core crash/reboot.
- Control principal, grant storage, OS secret backend, executable/environment policy
  and external-session adoption before any managed operation.
- Provider/version capabilities, model discovery and model-switch support per adapter.
- Task equivalence/outcome capture, active-time basis, verified price/billing sources
  and coverage before comparative efficiency or value claims.
- Artifact rendering/export/cache permissions and overwrite behavior before file writes.
- Optimizer activation thresholds and real-task quality/net-benefit evidence before
  production use; no token-consuming live benchmark without authorization.
- Remote pairing/encryption/metadata retention, forecasts and bounded delegation remain
  separate future decisions, outside the functional local Desktop MVP.

## Global Desktop MVP acceptance

A user opens a project, selects a supported agent/model, starts an authorized session
in a terminal, sees confirmed tokens throughout the session/terminal/artifact views,
receives a native completion/attention notification, extracts and saves Markdown,
and opens **Most Used Models** with source-reconciled data and working filters.
Unavailable data stays explicit, observed external sessions stay read-only, and the
Bridge has no regression. Record real-machine evidence and owner release acceptance
before announcing 1.0. Follow the [delivery workflow](docs/development/testing.md#incremental-delivery-and-integration).
