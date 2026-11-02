# Changelog

Changes are grouped by release using semantic versioning. `Unreleased` does not
announce a release; package versions remain `0.1.0` and no 1.0 tag is implied.

## Unreleased

### Added

- Foundational Token Optimizer architecture (ADR-025), Disabled/Economy/Intelligent
  design and integration contracts for future Core, routing, adapters and analytics.
- Standalone synthetic token-optimization benchmark with fixed-model provider
  usage, bounded quality checks, offline context comparison and reproducible report.
  No production dependency or optimizer is enabled.

- Phase 0 ADRs 015–024 for future managed execution, independent Core lifecycle,
  resource states, permissions, recovery, native history references, structured
  delegation, Cloud privacy, observability quality and contract compatibility.
- A documentation-only, versioned lifecycle contract design covering identities,
  events, task requests/results, capabilities, permissions and qualified metrics.
- Public roadmap with dependencies, risks, relative effort, acceptance tests,
  unresolved decisions and a bounded Phase 1 Core extraction scope.

### Changed

- Product direction emphasizes intelligent observability with a future Electron
  desktop client and React UI shared with browser access.
- Public architecture, security, data-model and contributor documentation now
  distinguishes the implemented observer from approved future capabilities.
- Future Cloud design replaces content synchronization/central history with
  optional identity/device/connectivity services and end-to-end content transport
  without Cloud persistence of code, conversations, terminal output or sessions.

### Compatibility

- Phase 0 includes architecture/documentation and isolated optimizer experiments.
  Bridge/dashboard behavior,
  Codex monitoring, exported TypeScript contracts, v1 APIs/events, database schema,
  dependencies, package versions and Apache-2.0 licensing are unchanged.
- No Electron, PTY, managed execution, delegation or Cloud implementation is
  included. Phase 1 requires separate approval.

## Existing development baseline

The initial `0.1.0` development baseline includes read-only Codex observation,
incremental recovery, local SQLite, loopback REST/WebSocket, a bilingual React
dashboard, notification preferences, a macOS service helper and automated checks.
This is a baseline description, not a previously published release entry.
