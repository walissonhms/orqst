# ORQST documentation

This directory contains the technical and operational documentation for the
ORQST MVP. The documentation describes the code as it exists in this
repository. It does not claim that builds, tests, browser checks, or real-data
validation have been run; see [Validation status](../README.md#validation-status)
and [Testing](development/testing.md).

## Architecture

- [Overview](architecture/overview.md) — components, process model, data flow,
  boundaries, and non-goals.
- [Data model](architecture/data-model.md) — SQLite schema, invariants, token
  accounting, retention, and migrations.
- [Security model](architecture/security-model.md) — trust boundaries, controls,
  residual risks.
- [Architecture decisions](architecture/decisions.md) — product and engineering
  decisions.

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
- [Event protocol](api/protocol.md) — envelope, event types, payload, usage
  semantics, source references, versioning.

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
- [Future Cloud architecture](commercial/cloud-architecture.md) — boundaries,
  entities, and what is deliberately not implemented.

## Reading order

For a new contributor:

1. `README.md`
2. `CONTRIBUTING.md`
3. `docs/architecture/overview.md`
4. `docs/api/protocol.md`
5. `docs/adapters/codex.md`
6. `docs/development/setup.md`
7. `docs/development/testing.md`
