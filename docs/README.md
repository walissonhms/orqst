# ORQST documentation

This directory contains public technical and operational documentation. Current
runtime descriptions are distinct from approved future designs. Consult
[Validation status](../README.md#validation-status) and [Testing](development/testing.md)
for validation scope; an accepted ADR is not evidence of an implemented feature.

- [Public six-phase roadmap and integration gate](../ROADMAP.md)
- [Existing local CLI integration](development/local-cli-integration.md) — passive
  executable discovery, native authentication direction and unresolved isolation.
- [Changelog](../CHANGELOG.md)
- [macOS Desktop checkout client](development/desktop.md) — setup, verified Electron
  runtime, trust/lifetime, offline behavior and distribution limits.

## Design

- [Official design system](design/design-system.md) — shared dark/light palettes, typography,
  spacing, components, evidence-backed motion and planned mascot states.

- [Interface guide and screen matrix](design/ui-ux-specification.md) — navigation,
  local preferences, confirmed session context, implemented screens and dependencies.

## Architecture

- [Overview](architecture/overview.md) — components, process model, data flow,
  boundaries, and non-goals.
- [Data model](architecture/data-model.md) — SQLite schema, invariants, token
  accounting, retention, and migrations.
- [Security model](architecture/security-model.md) — trust boundaries, controls,
  residual risks.
- [Architecture decisions](architecture/decisions.md) — product and engineering
  decisions.
- [Managed terminal design](architecture/managed-terminal-design.md) — design and
  historical gates; the opt-in embedded implementation and limits are linked below.

- [Token Optimizer](architecture/token-optimizer.md) — planned Core boundary,
  modes, permissions, integration interfaces and evidence-gated activation.

- [Product requirement coverage](architecture/product-requirements.md) — audited
  existing/partial/absent behavior with source references and remaining gaps.
- [Model Usage Analytics](architecture/model-usage-analytics.md) — mandatory Desktop
  scope, provenance, unknown models, qualified comparison and content-free export.

## Research and benchmarks

- [Token optimization](benchmarks/token-optimization.md) — licensed references,
  isolated synthetic tasks, provider measurements, quality checks, limitations and
  reproduction. This does not enable production optimization or start Phase 1.

## Adapters

- [Capability model](adapters/capability-model.md) — capability definitions,
  evidence rules, and the current matrix.
- [Codex](adapters/codex.md) — the only implemented adapter.
- [Claude Code](adapters/claude.md) — contract only.
- [OpenCode](adapters/opencode.md) — contract only.

- [Model Manager evidence and limits](architecture/model-manager.md) — observed identifiers,
  discovery inventory and dependencies before selection or execution.

## API and protocol

- [Pane communication](api/pane-communication.md) — opt-in Core identity, scoped
  authorization, durable queue and result evidence; no public agent transport or
  validated two-agent delegation.

- [REST API](api/rest.md) — bootstrap, snapshot, history, preferences,
  notifications, workspaces.
- [WebSocket API](api/websocket.md) — handshake, replay, resync, live delivery.
- [Event protocol](api/protocol.md) — implemented observation envelope, payload,
  usage, provenance and versioning.
- [Lifecycle contracts](api/lifecycle-contracts.md) — implemented local schemas/Core
  queries for observed-session evidence and artifact references; broader lifecycle
  transport, tasks/delegation, permissions and managed states remain planned.

## Development

- [Two-agent native acceptance](development/codex-two-agent-acceptance.md) — scoped
  dynamic-tool library and synthetic A-to-B-to-A evidence; an explicit real-provider
  command is prepared but unexecuted and requires separate authorization.

- [Dashboard visual checks](development/dashboard-visual-checks.md) — synthetic
  responsive/locale/theme/contrast/brand matrix and native acceptance limits.

- [Structured Codex runtime](development/codex-structured-runtime.md) — opt-in signed
  native ownership, separate slots and app-server/queue integration; synthetic
  transports only, without normal-runtime or real agent-to-agent acceptance.

- [Embedded managed Codex Terminal](development/managed-codex-terminal.md) — explicit
  checkout setup, separate state/login, native trust, owned lifecycle and synthetic
  acceptance; real Codex acceptance remains pending.

- [Setup](development/setup.md) — prerequisites, install, run, build.
- [Testing](development/testing.md) — suites, coverage, synthetic data policy,
  real-data validation.
- [Terminal boundary](development/terminal-boundary.md) — retained tool evidence
  and the remaining interactive terminal gates.
- [Synthetic PTY acceptance](development/terminal-pty-acceptance.md) — explicit
  macOS/arm64 developer experiment, reproduction and validation limits.
- [Native Terminal integration acceptance](development/terminal-native-acceptance.md) —
  explicit isolated Electron/preload/IPC/Node-host synthetic path; no provider activation.
- [Owned terminal engineering library](development/terminal-owned-lab.md) — tested
  operation grants, owned lifecycle and I/O; historical library stage before the embedded opt-in.
- [Repository layout](development/repository-layout.md) — packages and
  responsibilities.

## Deployment and operations

- [Local deployment](deployment/local.md) — build, run, service, backup,
  upgrade, unsupported topologies.
- [Operations](deployment/operations.md) — data locations, retention,
  diagnostics, troubleshooting, recovery.

## Commercial

- [Licensing decision](commercial/licensing-decision.md) — Apache-2.0 scope, contributions and
  third-party notice obligations.
- [Future Cloud privacy and connectivity](commercial/cloud-architecture.md) —
  optional control plane, endpoint content transport and no Cloud content storage.

## Reading order

For a new contributor:

1. `README.md`
2. `CONTRIBUTING.md`
3. `docs/architecture/overview.md`
4. `docs/api/protocol.md`
5. `docs/adapters/codex.md`
6. `docs/development/setup.md`
7. `docs/development/testing.md`

- [Partial session model history](api/model-history.md) — normalized-event identifiers,
  bounded compact evidence, unavailable states and source-trust limits.
