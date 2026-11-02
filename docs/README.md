# ORQST documentation

This directory contains public technical and operational documentation. Current
runtime descriptions are distinct from approved future designs. Consult
[Validation status](../README.md#validation-status) and [Testing](development/testing.md)
for validation scope; an accepted ADR is not evidence of an implemented feature.

- [Public six-phase roadmap and integration gate](../ROADMAP.md)
- [Changelog](../CHANGELOG.md)

## Architecture

- [Overview](architecture/overview.md) — components, process model, data flow,
  boundaries, and non-goals.
- [Data model](architecture/data-model.md) — SQLite schema, invariants, token
  accounting, retention, and migrations.
- [Security model](architecture/security-model.md) — trust boundaries, controls,
  residual risks.
- [Architecture decisions](architecture/decisions.md) — product and engineering
  decisions.

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

## API and protocol

- [REST API](api/rest.md) — bootstrap, snapshot, history, preferences,
  notifications, workspaces.
- [WebSocket API](api/websocket.md) — handshake, replay, resync, live delivery.
- [Event protocol](api/protocol.md) — implemented observation envelope, payload,
  usage, provenance and versioning.
- [Planned lifecycle contracts](api/lifecycle-contracts.md) — Phase 0 design for
  resource states, tasks/delegation, capabilities, permissions and qualified metrics;
  no runtime endpoints or schemas are added.

## Development

- [Setup](development/setup.md) — prerequisites, install, run, build.
- [Testing](development/testing.md) — suites, coverage, synthetic data policy,
  real-data validation.
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
