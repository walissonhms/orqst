# ORQST roadmap

## Product direction and delivery status

Intelligent agent observability is the primary product experience: activity,
delivery, intervention, communication, usage, costs and uncertainty. Terminals
and orchestration support that experience. Community remains Apache-2.0,
local-first, self-hostable and independent of optional commercial connectivity.

Current release metadata is `0.1.0`, a development version; this document does
not create a release or a 1.0 acceptance claim. The current runtime is the local
Codex observer described in [README](README.md). Claude Code/OpenCode descriptors
remain contracts, and no execution or Cloud feature is enabled.

Phase 0 records architecture and contract design only. **Phase 1 is awaiting
approval. No runtime implementation phase is active.** Later rows are planned,
not delivery commitments or authorization to start. Preserve working components
and data throughout; do not use a phase to rewrite the application.

Priorities: P0 establishes boundaries before control; P1 delivers local Desktop
and managed capabilities; P2 adds capabilities that depend on reliable evidence.
Effort is relative: S small, M medium, L large, XL very large. These are planning
comparisons, not calendar estimates. Provider work is measured per adapter.

## Phases, dependencies and acceptance

| Phase                                  | Status / priority / effort      | Scope and affected areas                                                                                                                    | Dependency                                                                                                        | Acceptance and tests                                                                                                                                                                 | Main risk                                                                |
| -------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| 0 — Architecture contracts             | Documentation baseline / P0 / M | ADRs, architecture/security/API design, README, roadmap, changelog and contribution policy                                                  | Architecture approval                                                                                             | Docs distinguish current and planned; v1 and runtime files unchanged; references, formatting and existing checks verified                                                            | Mistaking approved design for shipped functionality                      |
| 1 — Independent observer Core          | Awaiting approval / P0 / M–L    | Extract existing composition responsibilities from `apps/bridge`; add `packages/core` only when needed; preserve adapters/database/protocol | Phase 0 review and explicit Phase 1 approval                                                                      | Same REST/WS behavior and data; one database writer; clean start/stop, replay and checkpoint recovery; existing unit/browser checks and focused lifecycle tests                      | Regressing observer shutdown, data integrity or service paths            |
| 2 — Desktop observer                   | Planned / P1 / L                | Electron client, shared React UI, narrow preload and native notifications; macOS first                                                      | Stable Core boundary and separate approval                                                                        | Desktop and browser show the same observations; closing/reopening Desktop leaves Core running; IPC sender/argument validation; packaging smoke checks                                | Renderer privilege or accidentally coupling service lifetime to a window |
| 3 — Managed Codex and terminals        | Planned / P1 / L                | Authorized runtime/process/PTY operations, native provider channel and persistent layout; dashboard keeps observability prominent           | Reviewed control authentication, grants, runtime/ABI and adapter protocol                                         | Start/observe/interrupt/approve within scopes; terminal resize and reconnect; window closure preserves work; unauthorized operations denied                                          | Arbitrary execution, stale approval or duplicate process creation        |
| 4 — Recovery and additional adapters   | Planned / P1 / L per provider   | Codex recovery plus incremental Claude Code/OpenCode observation and managed operations                                                     | Version-specific evidence and recovery policy                                                                     | Distinguish Core crash from reboot; resume native context only when supported; malformed/reordered/missing events, missing sources and permissions tested                            | Claiming unsupported resume or replaying uncertain side effects          |
| 5 — Structured local delegation        | Planned / P1 / L                | Orchestrator, durable task/request/result state and validated adapter delivery                                                              | Managed sessions and reviewed authority model                                                                     | Cross-agent result round trip; explicit parentage; duplicate/reordered delivery, cancellation, deadline, revocation, loop/depth/fan-out/concurrency/budget tests                     | Repeated external effects or runaway delegation                          |
| 6 — Qualified metrics and budgets      | Planned / P1 / M–L              | Observed/estimated/unavailable metrics, time basis, rate provenance and per-agent/project aggregation                                       | Reliable provider usage and identity; may proceed independently of Phase 5 after approval                         | Missing is not zero; cumulative/cache accounting preserved; mixed-model/rate estimates reproducible; subscription mode qualified; unknown usage cannot imply a hard budget guarantee | Misstating spend, generation speed or coverage                           |
| 7 — Forecasts and remote observability | Planned / P2 / XL               | Remaining-work estimates with uncertainty; optional paired remote clients and content-private connectivity                                  | Sufficient comparable data for forecasts; reviewed encryption, pairing, revocation and metadata policy for remote | Forecasts validated against outcomes or marked unavailable; local use works with Cloud offline; no session content persisted in Cloud; revocation/disconnect/replay tests            | False precision or content leaking through relay/logging paths           |

Phases 6 and the forecast part of 7 are not blocked on implementing every provider.
Remote access and forecasts are separate implementation gates; one must not ship
merely because the other is ready. Every phase requires its own scoped approval.

## Phase 1 — Core extraction (awaiting approval)

### Purpose

Make the existing observation service reusable by future Desktop and browser
clients while preserving observable behavior. This phase does not require Electron
or a second daemon. The current macOS service remains the operational entry point.

### Planned implementation scope

1. Extract observer composition/start/stop into a UI-independent lifecycle boundary.
   Keep `apps/bridge` as the transport/composition entry point; introduce a Core
   package only for the extracted responsibilities, not empty future modules.
2. Define explicit initialization, readiness and shutdown ownership for the store,
   observer and API. Preserve the existing SQLite single-writer model and cleanup
   behavior; do not acquire ownership of native provider processes.
3. Preserve current settings, machine/session/event IDs, checkpoints, notifications,
   cumulative usage and all REST/WS v1 shapes. No schema migration is expected.
4. Keep Node `>=24 <25`, pnpm workspaces, React, SQLite and existing dependencies.
   Resolve source/build asset paths explicitly only if extraction requires it,
   documenting any service-path impact before deployment.
5. Add focused lifecycle and compatibility tests; run existing required checks and
   browser regression tests. Test restart/replay with synthetic disposable data;
   real-session acceptance remains separate and explicitly authorized.

### Exclusions

No Electron shell, PTY, agent execution, native-session resume, approval delivery,
delegation queue, metric estimator, Cloud connection, paid-feature check or public
bind. Do not transmit the planned lifecycle contract, change adapter capability
flags, add speculative packages, change the database schema, modify native session
files, or install/restart the owner's service as an incidental test.

### Review evidence

The Phase 1 delivery must include its file/dependency map, compatibility results,
start/stop ownership, data-preservation checks, deployment implications and exact
commands executed. A successful extraction is not authorization for Phase 2.

## Remaining technical decisions

| Decision                                                                                                   | Gate                                                                    |
| ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Exact Core API/package boundary and asset resolution                                                       | Phase 1 implementation review                                           |
| Electron version, packager, signing and update strategy                                                    | Before Phase 2 implementation                                           |
| Control principal authentication, grant storage and headless OS secret backend                             | Before any control operation                                            |
| PTY library/runtime compatibility and lifecycle under Core failure                                         | Before Phase 3; preserving a live PTY across Core crash is not promised |
| Provider versions and supported native start/resume/approval channels                                      | Per-adapter implementation review                                       |
| New cache size/lifetime/purge policy and treatment of existing copies/backups                              | Before any history/cache migration                                      |
| Task limits, cancellation and uncertain-result reconciliation policies                                     | Before Phase 5                                                          |
| Price sources, billing modes, measurement coverage and estimator validation                                | Before Phase 6 and forecasts                                            |
| End-to-end protocol, pairing, revocation, self-hosted remote topology and control-plane metadata retention | Before remote implementation                                            |

No decision here permits background execution or data deletion by default.
Closing a UI, stopping Core, logging out and rebooting are distinct operations;
their guarantees are in [ADR-019](docs/architecture/decisions.md#adr-019--recovery-guarantees-and-interrupted-work).

## Contributor references

- [Architecture decisions](docs/architecture/decisions.md)
- [Current and target architecture](docs/architecture/overview.md)
- [Planned lifecycle contracts](docs/api/lifecycle-contracts.md)
- [Security boundaries](docs/architecture/security-model.md)
- [Cloud privacy design](docs/commercial/cloud-architecture.md)
- [Contributing](CONTRIBUTING.md) and [testing](docs/development/testing.md)

Keep public product documentation in the repository. Local agent instructions,
working plans, captured session content and internal acceptance reports remain
excluded from version control.
