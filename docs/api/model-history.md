# Partial session model history

Implemented as an additive read-only contract, `orqst.session-model-history`, version 1.
This does not change v1 events, snapshots, WebSocket messages, session summaries,
normalization, accounting or persistence. It adds no migration, writer, cache reader,
provider request, native IPC or agent control. Existing observed identifiers remain
separate from any future cached candidates or executable selections.

## Local request and projection

`GET /api/sessions/:sessionId/model-history` accepts only one bounded opaque session
identity, using the existing session identity schema (1–1024 characters, no controls
or whitespace-only value). Query strings and request bodies are rejected. Existing
Host/Origin/fetch-metadata checks and the per-process HttpOnly SameSite cookie apply;
responses are JSON with `Cache-Control: no-store`. Invalid requests return sanitized
400 errors; unsupported methods have no route. This is not new execution authority.

The strict result is either `{availability: 'unavailable', reason}` or
`{availability: 'available', value}`. Here **available describes the evidence query**,
never model availability. The value allowlist is:

| Field                         | Meaning                                                                                   |
| ----------------------------- | ----------------------------------------------------------------------------------------- |
| `contract`, `contractVersion` | Fixed identity and version above                                                          |
| `sessionId`, `adapter`        | Exact requested native session ID and `codex`                                             |
| `coverage`                    | Always `partial`                                                                          |
| `basis`                       | Always `normalized_event_carried_identifier`                                              |
| `sourceVerification`          | Always `not_rechecked`                                                                    |
| `entries`                     | 1–32 compact records, descending ingestion sequence                                       |
| `entries[].sequence`          | Positive safe integer identifying the retained compact row                                |
| `entries[].normalizedEventAt` | Validated normalized-event timestamp, not model declaration time                          |
| `entries[].model`             | Original inert identifier (1–200 UTF-16 code units, at most 800 UTF-8 bytes), or null     |
| `entries[].source.hash`       | Validated SHA-256 source-record hash                                                      |
| `entries[].source.recordType` | `turn_context`, `event_msg:task_started`, `event_msg:token_count` or `token_usage_record` |

Nulls and repeated identifiers are preserved. Usage-only records can carry no model.
A successful all-null reading establishes no model and has an explicit UI notice.
The projection deliberately omits source filenames/paths, offsets/lines, workspace,
machine/agent identities, turn/response IDs, captured messages, usage and arbitrary
payload. Source hash plus compact sequence support local traceability without a
filesystem reference or permission to reopen source data. Original model identifiers
may themselves contain private metadata; no complete redaction guarantee is made.

`state.model` propagates through the Codex normalizer, including `turn_context`
records without a new declaration, task starts and token records. The timestamp is
only that of the resulting normalized event. Records are not deduplicated into model
changes, and sequence order is not necessarily chronological timestamp order.
Historical model observations establish neither effective use nor current state,
availability, entitlement, capability or selection. Session summary and Analytics
attribution semantics remain independent.

## Query admission and unavailable states

Database owns the read on its existing connection, in a consistent read transaction
(or the caller's existing transaction). It requires schema 2 and the compact table;
legacy/missing storage is not migrated or reconstructed from envelopes.
Future schema revisions also fail closed until their compatibility is reviewed. The indexed
session/sequence query admits only the latest 32 compact rows. SQL reads BLOB lengths
before metadata enters JavaScript: at most 16 KiB per row and 256 KiB for the window.
There is no full-history JSON filter, source read or returned partial prefix on error.
The final JSON projection is capped at 24 KiB UTF-8 without truncation.

Every admitted row must pass strict compact schema/JSON validation, safe numeric
source positions, timestamp/hash checks, column-to-metadata consistency and canonical
session/agent/machine/adapter identity. All rows are checked before returning anything;
a conflicting older row cannot hide behind valid newer entries. Manual workspace
reassociation is not compared to historical source workspace and does not rewrite it.
Only the minimal projection above leaves Database.

| Unavailable reason    | Meaning                                                                                |
| --------------------- | -------------------------------------------------------------------------------------- |
| `session_not_found`   | No canonical session/agent join                                                        |
| `unsupported_adapter` | Canonical adapter is not Codex                                                         |
| `unsupported_schema`  | Schema is not 2 or compact evidence table is absent                                    |
| `evidence_missing`    | No compact rows for the session; never a healthy empty history                         |
| `evidence_limit`      | Row/window/response budget exceeded                                                    |
| `invalid_evidence`    | Invalid JSON/schema/provenance/numbers/column consistency or sanitized storage failure |
| `identity_conflict`   | An admitted row disagrees with canonical session identity                              |

Coverage remains partial regardless of row count: pre-schema-2 gaps, observations
without compact model/usage evidence, source visibility and the window are not
reconstructed. Expired detailed envelopes do not remove surviving compact records;
this read changes no retention or token accounting.

## Client behavior and security review

The shared EN/PT browser/Desktop component fetches only while its disclosure is open
and the existing connection/snapshot is healthy. One request runs at a time, with a
three-second abort deadline and a fixed five-second reconciliation interval; snapshot
bursts never reset that clock or initiate requests. An unchanged cursor does not
refetch a successful reading. Close, disconnect and session change cancel that effect
generation; late responses cannot repopulate it. Pending/failure/offline readings hide
the old entries and explain unavailability instead of claiming current evidence.

The client counts actual streamed response bytes before decoding/JSON/schema parsing,
independently of Content-Length. It validates exact response session, contract and
descending unique sequences. Every identifier/type/hash is React text, with no HTML,
link, source-opening, export, model selection or default action. The original header
and its lack of a model observation time remain unchanged.

The route retains loopback, cookie, Host/Origin, CSP and no-store protections. Requests
supply no source path/URL, filesystem/configuration grant or arbitrary SQL/filter.
Errors never echo SQLite/JSON diagnostics or captured metadata. No credential/cache
contents are read or logged. Existing trusted-single-OS-user limitations apply; this
endpoint does not authorize execution or verify provider access.

Synthetic database/normalization tests cover nulls/repetitions, identity conflicts in
any row, corruption, bounds, legacy storage, retention independence and read-only
connections. API tests cover authentication/origin/query restrictions; Chromium
checks cover the real synthetic observer path, inert identifiers, EN/PT, small screens,
null-only windows, burst limits and cancellation/failure states. These are scoped
checks, not real-provider, installed-service or complete-history acceptance.
