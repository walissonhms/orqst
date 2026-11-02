# Future Cloud privacy and remote connectivity

## Status and superseded design

**Accepted architecture direction, not implemented.** Phase 0 authorizes this
contract/documentation update only. No Cloud service, remote client, account,
relay, billing integration, key exchange or encryption implementation exists here.
See [ADR-022](../architecture/decisions.md#adr-022--cloud-privacy-and-optional-remote-connectivity)
and [ROADMAP](../../ROADMAP.md).

This replaces the earlier proposal for event ingestion, central history and
content synchronization. Those are not the target architecture. Laravel,
PostgreSQL and Redis were earlier candidate technologies, not installed
components or a requirement to build that content-ingestion design. Select any
future control-plane stack separately, after the privacy and remote protocol
requirements are reviewed.

## Required boundary

Community remains Apache-2.0, self-hostable, local-first and usable without any
Cloud account, connection or subscription. Execution remains on the user's
machine. Desktop and browser access use the local Core; optional remote clients
must be explicitly paired and authorized. Observability remains the primary
experience, including authorized views across multiple workspaces/machines.

Cloud may provide identity, account/device enrollment, connectivity coordination
and a commercial service boundary. It must not store source code, conversations,
terminal output or agent session content. Content includes task prompts, results,
artifacts, tool arguments/output, transcript excerpts and workload-bearing errors.
Redaction or user opt-in does not create an exception to this storage prohibition.

```text
Authorized local/remote client <==== end-to-end content protection ====> Local Core
             |                         optional transient relay              |
             +------ identity / pairing / connectivity control plane --------+
                                                                            |
                                              SQLite + native provider history
                                                   on authorized user devices
```

A relay may handle transient ciphertext in bounded memory for active delivery.
It must not persist payloads to disk, queues, retry stores or offline mailboxes.
If the endpoint is unavailable, report unavailable or queue locally on an
explicitly authorized endpoint; do not add a Cloud history fallback.

## Data classification

| Data                                                                                   | Authoritative location                                   | Cloud policy                                                                     |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Source code, prompts, conversation, tools, results, terminal output and artifacts      | Native history/local workspace or authorized local cache | No content storage; transit only with end-to-end protection                      |
| Task/delegation state, provider session IDs, model usage and source references         | Local Core/SQLite                                        | Not default control-plane records; access through the protected endpoint channel |
| Workspace paths/names, command arguments and content fingerprints                      | Local Core                                               | Not enrollment or analytics metadata                                             |
| Account identity and account security state                                            | Future identity service                                  | Minimal explicit allowlist and retention policy                                  |
| Opaque enrolled-device IDs, public pairing material, revocation and connectivity state | Future control plane                                     | Minimal explicit allowlist; no session-bearing labels or payloads                |
| Provider credentials, device private keys and local command grants                     | Authorized endpoint secure storage                       | Never session/event/relay payloads or Cloud diagnostics                          |
| Commercial subscription records                                                        | Separate future billing system                           | No reuse of observed agent content or token activity as a content upload channel |

The exact account/device metadata allowlist, retention periods and access controls
remain decisions before implementation. An operational audit record must not
contain workload text, paths, terminal input or native history. Content must never
appear in database rows, logs, tracing spans, crash/error reports, analytics,
backups, dead-letter queues or customer-support attachments on the Cloud side.

Traffic timing, endpoint addresses and account/device relationships can remain
visible to connectivity services. Document that metadata exposure explicitly;
end-to-end encryption is not a promise of anonymous or metadata-free use.

## Authentication and local authority

- Local startup, observation and Community features never consult Cloud
  entitlements. A billing or identity outage cannot disable local operation.
- Account sign-in identifies a Cloud principal; it does not grant a local command.
- Pair devices explicitly. Bind remote principals to revocable local resource and
  operation scopes, with expiry and least privilege.
- Separate observation/content access from execution, terminal input, delegation,
  provider approval responses and enrollment.
- Recheck local authorization on admission and execution. A remote request cannot
  expand a local grant or bypass provider sandbox/approval policies.
- Revoke compromised devices and pending work; define active-work handling and
  test reconnection/replay without silently repeating uncertain effects.
- Do not expose the existing observation bootstrap or bind its API publicly as a
  shortcut to remote access. Its cookie is not a remote/control credential.

## Content transport requirements

The future transport must authenticate both endpoints, bind pairing to the user
and device, protect content end-to-end, reject replay and support revocation.
TLS to the Cloud terminator alone is insufficient for this content boundary.
Select an established, reviewed protocol; do not invent cryptography as part of
application glue. Algorithms, key lifecycle, pairing UX and transport topology
are not selected in Phase 0.

Core initiates or participates only in explicitly enabled connectivity. Preserve
local machine identity and qualify provider-session/workspace references by
machine. Path-derived local workspace IDs are not globally unique project IDs.
The remote UI must label disconnected/stale machines instead of claiming live
execution or measured zero usage.

## Implementation and acceptance gates

Before implementation, approve:

1. Threat model, topology, cryptographic protocol and endpoint trust.
2. Pairing, key storage, rotation, expiry, revocation and account-recovery policy.
3. Exact control-plane metadata allowlist, retention and diagnostic exclusions.
4. Local permission enforcement for reads and any separately approved controls.
5. Self-hosted remote topology and whether a relay is required for each mode.
6. Offline behavior, bounded buffering, cancellation and uncertain-result policy.
7. Distribution/update signing and tests appropriate to supported platforms.

Acceptance must demonstrate local operation with Cloud unreachable, successful
and denied pairing, expired/revoked permissions, replay rejection, disconnect and
reconnection, machine scoping, bounded relay memory, no offline Cloud payload queue
and absence of session content in persistence/logging/error paths. Test fixtures
must be synthetic; real captured content is never committed or uploaded to prove
privacy. A transport library being available is not evidence these guarantees hold.

## Module boundaries

Keep remote connectivity, identity and billing separate from local adapters,
persistence and observability logic. Core owns local content and permission
enforcement; an optional connectivity module transports authorized operations.
Cloud must not import or require the local transcript store. Add no modules,
dependencies, outbound connections or commercial checks during Phase 0 or the
planned Phase 1 observer extraction.
