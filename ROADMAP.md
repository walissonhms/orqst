# ORQST roadmap

## Embedded Terminal increment — 2026-11-03

The opt-in [managed Codex Terminal](docs/development/managed-codex-terminal.md)
now composes a real xterm.js window inside ORQST Desktop, native confirmations,
an independent Node Core supervisor/journal and owned PTYs. Separate device login
uses newly provisioned private state; observed sessions/credentials are never adopted.
Native trusted/same-user execution is the selected incremental contract: hash/path
drift checks apply, but immutable kernel binding and container/VM isolation are not
claimed or required by this mode. This supersedes the blanket production gate in
the historical terminal engineering notes below, without changing their evidence.

The path is implemented for one configured project/selected instance, with explicit
30-minute lifetime and conservative lost-ownership recovery. Real Codex acceptance
and genuine native human-dialog/accessibility checks remain pending authorization.
Claude Code/OpenCode, structured delegation, automatic results and concurrent
multi-agent UI are not implemented. The intended next functional milestone is two
identified owned agents, an explicit delegated task and an automatic result inside
ORQST; transcript prose cannot establish that protocol. This increment is a terminal
foundation, not completion of that milestone, Phase 2/4 or the Desktop MVP.

## Product direction and delivery status

ORQST is a local-first, observability-first desktop platform in development.
Community remains Apache-2.0 and independent of Cloud. Release metadata remains
`0.1.0`; this roadmap does not announce a release or claim MVP acceptance.
The integrated baseline is the read-only Codex observer in [README](README.md).
The first macOS Electron slice adds a checkout-only observer window over the existing
Bridge, with independent lifetime and offline/retry states (ADR-030). Phase 2 remains
incomplete: the opt-in Terminal lacks real-provider acceptance and distribution is
not delivered. A menu-bar tray and source-gated native alert mechanism are implemented
(ADR-031); signed-identity and
real macOS visual notification acceptance remain pending.

Incremental, non-destructive development is authorized. **The observer Core extraction and local Analytics library are
implemented and integration-tested; Phase 1 remains incomplete.** Compact durable metric/model evidence is implemented with additive schema 2;
pre-upgrade gaps remain qualified. Local versioned observed-session evidence and
artifact message references are implemented with runtime validation; broader
lifecycle transport and managed contracts remain planned. A first manual Artifacts
slice now provides bounded retained-message extraction and an integrated source/preview/
memory-draft/copy panel. A subsequent narrow Desktop action saves UTF-8 Markdown via
a native destination dialog, confirms replacement and optionally opens only the newly
saved verified file in the system default application. Browser Artifacts file export remains unavailable. There is no blanket “Phase 1 awaiting approval” gate.
Passing checks permits incremental progress within scope; product decisions,
destructive actions, credentials, external costs and ungranted permissions still
require a decision. Development authorization is not production activation.

The [requirement matrix](docs/architecture/product-requirements.md) audits existing,
partial and absent behavior. The [Analytics design](docs/architecture/model-usage-analytics.md)
defines mandatory Desktop metrics without inventing provider data.

The confirmed Live Metrics increment adds normalized session tokens and their own
metric occurrence time to session and manual Artifacts headers. Bounded compact proof,
unavailable values and stale/offline readings are explicit. A brief accessible cue now
highlights fields changed by newer confirmed evidence, with static reduced-motion support;
it never interpolates counts or times. A temporary session token threshold now adds
a visual advisory in both headers, using only confirmed cumulative totals. Closing
session details clears it; stale readings cannot claim to be below or above it. This
is not a provider quota, spending cap or execution limit. An exact confirmed-total
difference and static reached-threshold flame now supplement the advisory; stale
readings suppress both. Terminal display, project/
persistent limits, verified pricing, Fast and mascot reactions remain planned. See
[contract](docs/api/live-metrics.md).

The browser Analytics export increment adds gesture-only CSV/Markdown of the current
validated aggregate with explicit coverage/nulls and bounded privacy/syntax controls.
Observed model IDs may contain private metadata; the warning is part of the flow.
Desktop Analytics now adds a separate narrow native save grant with exact-reading
revalidation and native destination/overwrite dialogs. Download denial and the
Artifacts contract are preserved; native visual acceptance remains pending. See
[export contract](docs/api/analytics-export.md).

The observed usage evolution increment adds a filtered interval-end bar/table view,
with at most 64 adaptive UTC windows and separate undistributed lifetime totals.
It reuses cumulative admission and preserves aggregate/export contracts. This is
qualified observation timing rather than measured daily consumption; real-provider
multi-model temporal acceptance remains pending. See [contract](docs/api/analytics-evolution.md).

The Settings/accessibility increment now includes optional light and system themes,
with the original dark default, shared semantic/focus tokens, higher contrast,
offline operation, local persistence and confirmed scoped reset. This is shared
renderer presentation; it does not theme native menus/dialogs or menu-bar artwork.
Automated Chromium contrast/responsiveness checks are scoped evidence, not native
Desktop or manual assistive-technology acceptance. See the
[interface guide](docs/design/ui-ux-specification.md#grouped-settings-and-reading-comfort).

## Mandatory quality and security criteria for each increment

The engineering entries below preserve earlier acceptance stages. The embedded
Terminal increment above supersedes claims that all terminal mechanisms are
uncomposed. Its native trusted/same-user mode does not require or claim hard
containment. Passing synthetic library or PTY tests still cannot establish real
provider support, human consent acceptance or completion of the two-agent milestone.

The [native integration lab](docs/development/terminal-native-acceptance.md) now
connects the experimental broker to a restricted Electron document/preload, native
IPC and a separate Node-host synthetic PTY. It is a working disposable engineering
path, outside normal Desktop/Bridge startup and automatic tests. Real Electron
transport is exercised with intercepted native dialogs; provider, genuine human
consent, immutable admission, isolation and durable recovery remain gates. This
does not complete a functional managed Terminal or Phase 2/4 acceptance. Codex is
the first provider candidate; Claude Code/OpenCode capabilities do not change.

The terminal engineering increment provides an explicit developer-only synthetic PTY
acceptance command and a [managed execution design](docs/architecture/managed-terminal-design.md).
macOS/arm64 Node-host mechanics are validated; native grants, provider integration,
isolation/recovery, emulator and distribution remain unimplemented or unvalidated.
The observer remains read-only; this does not complete Phase 2 or Phase 4.

The next [owned terminal library](docs/development/terminal-owned-lab.md) implements
signed one-use operation grants, separate instance/attachment/input-lease identities,
owned lifecycle and bounded inert I/O, exercised by the same opt-in synthetic PTY
command. It remains outside the application graph: native gesture/enrollment,
transport, durable audit/recovery, isolation and provider acceptance are still gates.

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
| 2 / P1 / Partial; observer shell implemented | Electron observer shell/shared React UI implemented; project/session terminals and live output remain planned.               | Phase 1; Electron/PTY versions, authentication and ownership decisions.                                             | Renderer privileges, terminal escape sequences, accidental process lifetime coupling.         | IPC sender/argument validation, reconnect/resize/output tests; macOS packaging smoke; closing UI does not stop independent work. Terminal input/interrupt requires Phase 4 control gate.                                          |
| 2 / P1 / Partial; native delivery pending    | Monitor, native macOS notifications, tray, history, pending count, silence/preferences and click-to-session.                 | Source-confirmed events; active monitor; native permission policy.                                                  | Import alerts, false completion, notification content leakage.                                | Foreground/minimized tests; duplicate suppression; completion/error/attention/approval/interruption only with evidence; denied permissions honest; native delivery verified on device.                                            |
| 2 / P1 / Partial; manual panel implemented   | Artifacts extraction and independent source/preview/edit panel; copy raw/rendered text, save Markdown, external editor.      | Safe rendering, source/version provenance and file grant policy.                                                    | Untrusted HTML/links, ambiguous extraction, silent overwrite.                                 | Manual extraction fallback; hostile Markdown; preserve originals/history and project/session/agent/date; save dialog/cancel/overwrite tests; no file replaced without confirmation.                                               |
| 2 / P1 / Planned                             | Model Manager in session header; project/agent defaults, session overrides and supported reasoning/speed controls.           | Version-specific capability discovery; Phase 4 for execution changes.                                               | Invented models, invalid combinations, hidden restart on model change.                        | Missing CLI/models and unsupported options rejected; model switch support and restart impact visible; terminal does not imply access to private context.                                                                          |
| 2 / P1 / Partial; tokens implemented         | Live Metrics always visible in session/terminal/artifact headers, confirmed update time, alert limits and restrained motion. | Qualified Phase 1 measurements; metric/configuration policy.                                                        | Stale data shown as live, double cache accounting, inaccessible animations.                   | Input/output/cache/total reconciliation; last confirmed timestamp; session/project limits; verified-price-only cost; supported Fast indicator, threshold flame, state/mascot eye reactions and reduced-motion/performance checks. |
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
- Electron observer runtime/build/lifetime selected in ADR-030: Electron45.2.1, existing
  esbuild and independent Bridge. Packager/signing/update strategy, PTY versions and
  managed-process crash lifetime remain pending; no PTY survival guarantee is made.
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

## Official visual identity — Desktop MVP requirement

**Minimal Dark + Developer Studio** is mandatory for the functional Desktop MVP.
The [official design system](docs/design/design-system.md) defines the approved
palette, shared CSS tokens, typography, spacing, borders, component coverage and
reduced-motion behavior. The current shared browser/Electron dashboard applies
these tokens to implemented views without changing observation or API behavior.

All future Studio/terminal, agent/model selector, workspace/tab, observability,
Analytics, notification/attention, Artifacts, collaboration/orchestration, Kanban,
settings and onboarding views must follow the same system when supported. Their
visual specification does not implement execution or relax capability gates.
The logo/mascot remain the references; mascot eye/state reactions and Fast lightning
are planned and require explicit evidence, while exact token updates and the
configured static threshold flame retain their current evidence rules.

Acceptance requires consistent semantic colors, readable contrast, keyboard focus,
responsive desktop/mobile layouts and reduced motion with no lost information.
Record real-machine visual acceptance separately; palette adoption alone does not
complete Phase 2 or authorize a release.

## UI/UX screen delivery

The [public interface specification](docs/design/ui-ux-specification.md) tracks each
screen as Implemented / Partial / Planned / Blocked, with component/test pointers.
The navigation foundation now includes a collapsible sidebar, Cmd/Ctrl+K search,
workspace grid/list and scoped Analytics navigation, descriptor-based agent
capabilities, a sticky confirmed-token session strip and filtered source-linked
notifications. UI preferences persist locally; neither processes nor session tabs
are restored. Existing observation, Analytics and manual Artifacts stay intact.

Grouped Settings now adds General, Appearance & accessibility, Notifications and
Privacy & storage. Contrast, comfortable spacing and reduced motion are local
preferences with storage-denial feedback and a scoped confirmed reset. Language
and reading comfort work offline; delivery preferences reuse the existing Bridge
contract. This does not implement provider configuration or storage management.

The configurable Overview increment now supports visibility and keyboard reordering
of the four existing secondary panels, a locally persisted/synchronized profile-wide
layout and scoped default restoration. Summary, sessions, inspector/drafts and
notification delivery retain their contracts. No new metrics or runtime controls
are introduced; resizing and a separate Observability screen remain planned.

Workspace pinning now prioritizes recorded projects in the directory/sidebar, with
keyboard toggles, a composable pinned-only filter, empty recovery and local profile
persistence/synchronization. It preserves routes, active scope and drafts. Missing
snapshot identities remain hidden without erasing their preference; storage denial
reports visit-only scope. This does not add archive/rename, filesystem or process
restoration. See the [interface guide](docs/design/ui-ux-specification.md#pin-workspaces).

Remaining frontend work includes project tabs/splits,
full-archive Artifact search and saved-file indexing, terminal fonts, broader Settings and
onboarding beyond the read-only orientation guide. Studio/PTY controls, CLI/model discovery, task Kanban and orchestration
require real Core/provider and
authorization contracts; no visual placeholder counts as delivered functionality.
The screen matrix is the integration checklist, while the six phases above retain
their existing backend and release gates.

## Global Desktop MVP acceptance

A user opens a project, selects a supported agent/model, starts an authorized session
in a terminal, sees confirmed tokens throughout the session/terminal/artifact views,
receives a native completion/attention notification, extracts and saves Markdown,
and opens **Most Used Models** with source-reconciled data and working filters.
Unavailable data stays explicit, observed external sessions stay read-only, and the
Bridge has no regression. Record real-machine evidence and owner release acceptance
before announcing 1.0. Follow the [delivery workflow](docs/development/testing.md#incremental-delivery-and-integration).

### Reading accessibility increment

Settings now adds relative interface text scaling, additional captured-text scaling
and local original/monospace/sans-serif reading choices with a labeled example.
Expanded messages, session tasks, tool payloads and Artifact source/preview/edit
share the reading choice; provenance and metrics keep distinct typography. Preview
code stays monospace. Old appearance preferences remain compatible, offline changes
remain usable and reset includes the new settings. This addresses an available UX
backlog without new transport or provider capabilities. Terminal fonts,
manual screen-reader/native visual acceptance and the broader Phase 2/6 gates remain
pending. See the [interface specification](docs/design/ui-ux-specification.md).

### Artifact navigation protection increment

The existing memory-only Artifact workflow now guards changed text through session,
workspace and view navigation, including Search & commands, notification source
links and same-document session/history links. Cancel retains exact edits/context;
confirmation performs the requested transition. Pending saves block navigation with
feedback. Browser reload/exit warnings are best-effort and browser-controlled.
This closes an available data-loss UX gap without adding persistence or provider
capabilities. Desktop close/quit, native document loads and durable draft/crash recovery
remain pending; a bounded searchable source library is now implemented. See the
[interface specification](docs/design/ui-ux-specification.md).

### Terminal native-boundary increment — 2026-11-03

The experimental native broker now validates strict requests, binds exact native
confirmations, retains private signatures/leases outside IPC and revokes pending
consent/input on native lifecycle changes. The explicit synthetic PTY lab exercises
this path; Electron helpers are implemented with double-based tests, without runtime
registration. Core teardown now preserves uncertain process ownership without
implicit signals. See the [contract](docs/api/terminal-native.md).

This does not complete Terminal or the Codex/Claude/OpenCode integrations. The
[primary-source inventory](docs/adapters/managed-terminal-research.md) distinguishes
public release/documentation evidence from validated ORQST capabilities. Next gates
are native gesture/restricted-document acceptance, independently authenticated
transport/enrollment, immutable executable/cwd admission, containment/lifetime and
durable ownership recovery, followed by disposable per-provider acceptance. No
external-session adoption or production activation is authorized by library tests.

### Terminal durable recovery increment — 2026-11-03

The optional [metadata journal](docs/development/terminal-recovery.md) now records
attempts through the existing Store, commits admission before backend start and
fences prior epochs on explicit recovery. Lost ownership retains capacity; no PID,
input/output, credential, automatic signal or retry is persisted or inferred.
Synthetic abrupt-writer-exit and negative authorization/recovery tests validate
these library semantics. Normal observer startup and the native lab do not open it.
Codex remains the first managed target, not an enabled provider. Immutable OS
binding, isolated authentication, native enrollment, containment and individual
provider acceptance are still required; Claude Code/OpenCode remain contracts.

### Searchable Artifact sources increment — 2026-11-03

`/artifacts` now discovers retained Codex assistant/agent messages through the existing
bounded event API. Search covers loaded text and recorded context, with current-workspace
and exact-session filtering, source references, explicit pagination and qualified coverage.
Opening a source navigates to the existing session/manual Artifact panel; it does not
create or save a document. Each reading stops at 2,000 observations or 200 sources;
a specific session starts its own reading. Newer observations require refresh. Failure,
offline, empty, retention and capacity states stay explicit. This closes the standalone
source-discovery gap without a new API, database index, transport or file grant.
Full-archive search, saved-file/draft indexing, automatic extraction and durable draft
recovery remain pending. Terminal/provider work and phase/release gates are unchanged.

### First observation guide increment — 2026-11-03

The shared dashboard now offers optional three-step orientation from Settings,
Search & commands and the empty-session welcome. It uses existing transport and
snapshot evidence for connection, source diagnostics and global retained-session
counts, distinguishing unavailable and stale data. Links reuse the existing Agents
and Workspaces routes and Artifact navigation guard. No scan, CLI discovery,
permission prompt, installation check, saved progress or runtime control is added.
Broader onboarding and manual assistive-technology/native visual acceptance remain
pending; Terminal and provider development retain their separate gates. See the
[interface guide](docs/design/ui-ux-specification.md#first-observation-guide).

### Agentic Mode communication foundation — 2026-11-03

[ADR-033](docs/architecture/decisions.md#adr-033--opt-in-durable-pane-communication-without-terminal-injection)
adds a private Core pane registry and bounded durable structured queue, explicit
workspace/actor grants, independent delivery/task evidence, idempotency, result
inbox/subscriptions and conservative epoch recovery. These are library capabilities
validated with synthetic transports, not enabled provider communication. Source/target
capabilities are enforced independently of grants; a resolved submission without
acceptance becomes uncertain. Four unresolved outcomes exhaust global capacity
even after pane closure/restart. No reclamation/reset bypass exists; reviewed
evidence-backed reconciliation is required before normal-runtime provider dispatch.

The first useful Agentic Mode milestone remains two real managed CLIs in separate
stable identified panes: A delegates a bounded task to B, acceptance remains separate
from completion and a verified correlated result returns automatically into A.
Dependencies: persistent identity joined to native ownership admission, independent
per-terminal managed state/concurrency, trusted authorization, one verified structured
provider interface, narrow authenticated MCP/response transport and explicit task
budgets. Subsequent work includes Inspector/notifications, native queue/result UX,
CLI/model discovery, typed intent planning, safe worktree allocation and opt-in cleanup.
No observed external session is controllable and no PTY input channel is exposed.
See [implemented vs missing capabilities](docs/api/pane-communication.md).
