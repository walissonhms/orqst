# Future Cloud architecture

## Status

**Design intent only. Nothing in this document is implemented.**

There is no Cloud service, account system, organization model, sync client,
billing integration, or multi-tenant database in this repository. The local
Community Edition works without any of it.

This document defines boundaries so the local core can evolve without a
rewrite and so commercial features do not leak into the observability engine.

## Goals

- Keep the Community Edition fully local, free, and independent.
- Require no account for local use.
- Make any future upload explicit and opt-in.
- Isolate authentication, authorization, entitlements, metering, and billing
  from the local observability core.
- Support multiple machines and shared workspaces in a future Cloud Edition.
- Preserve the normalized event protocol as the integration boundary.

## Non-goals for the MVP

- user accounts;
- organizations or teams;
- remote synchronization;
- centralized history;
- subscription management or payment processing;
- access control beyond the local session cookie;
- cross-machine workspaces;
- hosted WebSocket fan-out;
- usage-based billing;
- telemetry.

## Boundary

```
┌─────────────────────────────┐        ┌──────────────────────────────┐
│ Community Edition (local)   │        │ Cloud Edition (future)       │
│                             │        │                              │
│ Codex adapter               │ opt-in │ Auth / accounts              │
│ Protocol                    │───────►│ Organizations / membership   │
│ SQLite                      │ sync   │ Entitlements                 │
│ Local REST + WebSocket      │ client │ Usage metering               │
│ Dashboard                   │        │ Billing                      │
│                             │        │ Central history / reporting  │
│ No account required         │        │ Multi-machine sync           │
└─────────────────────────────┘        └──────────────────────────────┘
```

Rules:

- The local core must not import Cloud modules.
- Cloud must not be required to start, observe, or view local sessions.
- Sync is outbound from the local bridge through a separate client/module.
- The local database remains the source of truth for local observations.
- Commercial restrictions must not be added to local features.

## Future stack (from the master brief)

| Layer         | Intended technology                     |
| ------------- | --------------------------------------- |
| Cloud backend | Laravel                                 |
| Database      | PostgreSQL                              |
| Cache/queue   | Redis                                   |
| API           | REST                                    |
| Realtime      | WebSocket                               |
| Local core    | Node.js, TypeScript, SQLite (unchanged) |

This is a stated direction, not a validated architecture. No Laravel
application exists in this repository.

## Conceptual entities

| Entity         | Meaning                                                                                      |
| -------------- | -------------------------------------------------------------------------------------------- |
| `User`         | A person with an identity in the Cloud.                                                      |
| `Organization` | A tenant that owns members, machines, workspaces, and a plan.                                |
| `Membership`   | A user's role in an organization.                                                            |
| `Plan`         | A commercial package defining features and limits.                                           |
| `Subscription` | An organization's active commercial relationship and billing state.                          |
| `Entitlement`  | A resolved permission to use a feature, derived from plan/subscription.                      |
| `UsageLimit`   | A metered allowance (events, storage, seats, machines) with a period and enforcement policy. |

These are conceptual. No schema, migration, or API exists.

## Separation of concerns

Keep these independent, even if they share a deployment:

### Authentication

- Establishes identity (session, token, SSO).
- Does not decide feature access.
- Must not be required by the local Community Edition.

### Authorization

- Decides whether a user may act on an organization, machine, workspace, or
  record.
- Must enforce tenant isolation at the data layer, not only in controllers.
- Must not be inferred from authentication alone.

### Entitlements

- Resolve plan/subscription state into feature availability.
- Should be a read model, not scattered conditionals.
- Must fail closed for paid features and fail open for core local features
  (which do not consult entitlements at all).

### Usage metering

- Counts what a plan limits (for example events ingested, storage, seats).
- Must be idempotent and auditable.
- Must not reuse the local `synchronization_state` table; that table is a
  local file-read checkpoint, not a billing ledger.

### Billing

- Integrates a payment provider.
- Receives signed webhooks and verifies them before parsing.
- Is isolated from the observability path; a billing outage must not stop local
  observation or Cloud ingestion.

## Sync design constraints

If synchronization is implemented, it must satisfy:

1. **Opt-in.** No upload without an explicit user action and visible state.
2. **Outbound-initiated.** The local bridge connects out; Cloud does not reach
   into the local machine.
3. **Idempotent.** Events carry stable IDs; retries must not duplicate.
4. **Ordered per session.** Use the local `sequence` plus session identity; do
   not reorder within a session.
5. **Cursor-based.** The client tracks acknowledged cursors; Cloud can request
   a replay window.
6. **Bounded.** Batch size, payload size, and backoff are explicit.
7. **Redacted before upload.** The same redaction and text limits apply; do not
   upload raw logs, reasoning, credentials, or environment blocks.
8. **Machine-scoped.** A machine identity is enrolled and revocable.
9. **Workspace-aware.** A local workspace maps to a Cloud workspace; conflicts
   need an explicit policy, not silent merging.
10. **Retention-aware.** Local retention may delete events the Cloud has not
    received; sync must handle gaps honestly.
11. **Protocol-compatible.** Use the existing event envelope and `schemaVersion`;
    do not fork semantics.
12. **No credentials in payloads.** Device tokens live in a secure store, not in
    events.

## Multi-machine workspaces

Future support requires:

- a stable machine identity (the local `machineId` already exists);
- a workspace identity that can span machines;
- a conflict policy for the same workspace path on different machines;
- deduplication across machines;
- explicit ownership and access control.

The current local workspace ID is derived from the path, which is not globally
unique. Cloud must not assume it is.

## Security requirements for Cloud

- Tenant isolation enforced in the data layer (for example PostgreSQL row-level
  security) and tested.
- Least-privilege service credentials.
- TLS everywhere.
- Secrets managed outside the repository.
- Signed, verified billing webhooks with replay protection.
- Audit trail for membership, entitlement, and billing changes.
- Data residency and deletion policy.
- No capture of local content without opt-in.
- No telemetry disguised as analytics.
- Rate limiting and abuse controls on public endpoints.
- Clear separation between Community support and Cloud support.

## Migration path

1. Keep the local protocol stable and additive.
2. Add a Cloud client as a separate module, not inside adapters or the store.
3. Add device enrollment and an explicit sync toggle in the local UI.
4. Implement ingest with idempotency and cursors before read models.
5. Add organizations and authorization before sharing any data.
6. Add metering before entitlements that depend on usage.
7. Add billing last, isolated behind webhooks and a queue.
8. Never make local startup depend on Cloud availability.

## What must not happen

- A required Cloud login for local observation.
- Silent uploads or default-on telemetry.
- Commercial feature checks inside the local observability engine.
- Reusing local checkpoint state as a Cloud sync or billing ledger.
- Sharing a local database file across machines.
- Treating a local path-derived workspace ID as a global tenant key.
- Adding billing code to the MVP.
- Claiming Cloud capabilities in the Community Edition UI.
