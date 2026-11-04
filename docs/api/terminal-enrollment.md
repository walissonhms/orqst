# Private incremental terminal enrollment v1

Implemented in the existing Node `ManagedTerminalPair`, private inherited IPC host
and Desktop Core client. Native Studio/service/layout integration and real-provider
acceptance remain separate. Enrollment **admits** an independent slot; `ready`
never means CLI started, output attached, keyboard enabled or a task accepted.

## Trusted client contract

Exports in `@orqst/protocol`:
`terminalEnrollmentInputSchema`, `terminalEnrollmentMemberSchema`,
`terminalEnrollmentReceiptSchema`, `terminalEnrollmentInspectionSchema`, and their
`TerminalEnrollmentInput/Member/Receipt/Inspection` types.

The existing `connectManagedTerminalCore()` result exposes:

```ts
core.epoch; // Original Core-owned ready handshake UUID, never renderer authority.
core.enrollmentInspect(opId?);
core.enroll(input, manifestFile);
```

`input` contains `version: 1`, `epoch`, `opId` (UUID), `expectedRevision` (safe
nonnegative integer), `workspaceId` and nullable `featureId`. The absolute
`manifestFile` comes only from native trusted preparation; the renderer supplies
no path, executable, argv, proof, slot or arbitrary Core operation. The private RPC
actions are `enrollmentInspect` (`id`, optional `opId`) and `enroll` (`id`, `input`,
`manifestFile`). They do not add HTTP, WebSocket, observer or agent MCP endpoints.

An inspection contains `version`, `epoch`, `revision`, `capacity`, `reservedSlots`,
ordered `members` and a nullable historical `receipt` for the requested `opId`.
It performs no mutation, retry, slot materialization, process adoption or authority
restoration. The revision starts at zero for the original immutable selection.

A receipt contains the original input, current `revision`, `status`, `reason` and
nullable `member`. A member contains `slot`, immutable `terminalId`, optional
`alias`, `provider`, optional nullable `requestedModel`, `workspaceId`, `featureId`,
`admissionRevision`, `bindingDigest` and `status: ready | uncertain`. Requested
model metadata is not provider-reported actual model or entitlement evidence.

| Result                         | Revision/capacity                        | Meaning                                                           |
| ------------------------------ | ---------------------------------------- | ----------------------------------------------------------------- |
| `ready / admitted`             | Increment once; append one reserved slot | Durable admission and supervisor creation acknowledged; no launch |
| `rejected / revision_conflict` | Unchanged                                | CAS refusal before effects                                        |
| `rejected / capacity`          | Unchanged                                | Original configured capacity reached                              |
| `rejected / invalid_profile`   | Unchanged                                | Scope/profile/preflight validation refused before effects         |
| `uncertain / effect_uncertain` | Increment once; retain UUID/slot         | Reservation, journal or receipt effects may be partial            |
| `rejected / effect_uncertain`  | Unchanged                                | An earlier uncertain enrollment blocks further new admissions     |

The original configured capacity stays fixed, within 1–8; enrollment cannot raise
it. A slot remains reserved even after its process exits. Existing per-journal
start quotas, quarantine and evidence-bound whole-Pair retirement still apply.
No independently uncertain reservation is automatically released or removed.
The aggregate retirement archive has an explicit 1 MiB write/read budget to hold
the added records. Oversized evidence is refused before writing, and changed or
oversized archives cannot finalize marker removal. Individual marker, manifest
and enrollment-record read budgets remain unchanged.

## Atomic boundary, idempotency and budgets

The synchronous Core path validates epoch, CAS, capacity, prepared context and
profiles before entering the durable effect boundary. It then increments revision
and reserves the append-only slot, claims the existing owner marker, writes/fsyncs
an exclusive enrollment record, opens the new journal and supervisor, and writes/
fsyncs an exclusive ready receipt. Only then is the new supervisor dispatchable.
No original supervisor, attempt, attachment, input lease, output buffer or PTY is
rebuilt or renewed. A partial failure retains all files, UUID and capacity and
blocks new enrollment/retirement. Existing slots continue under their existing
ownership fences; loss of that ownership still denies control.

There are at most 128 operation IDs per Core epoch, without eviction or reuse,
and 16 pending IPC requests. The same `opId` and normalized request/path return
the same cached receipt without inspecting or repeating effects. Rebinding an
operation to another path, workspace, Feature or expected revision is denied.
Confirmed and uncertain admission records survive as private evidence. Rejected
pre-effect receipts are scoped to the live epoch. Restart does not resume or replay
enrollment: an existing owner marker refuses a replacement Core until separately
authorized evidence-backed reconciliation.

The client attempts each operation once, caches confirmed receipts and refuses to
resend a pending or unconfirmed operation. Its enrollment/inspection deadline is
12 seconds. A timeout rejects only that request, keeps the existing Core connected
and reserves a bounded late-response tombstone. A late ACK is discarded; it cannot
append a supervisor, replace a selection, change layout/focus or roll back a slot
that may have been admitted. `enrollmentInspect(opId)` can observe a historical
receipt, but never adopts it into the client after a timeout. Transport death
continues to use existing ownership-loss fencing. An unknown outcome is not retry
permission.

## Profile and Start binding

Each new manifest requires the trusted preparation chain's explicit UUID, model
selection (including CLI default), read-only workspace/Feature preparation binding
and interactive acknowledgment. Its preferences directory must match the original
Core admission directory. New MCP profiles are refused; the older two-member MCP
contract is not extended. Independently prepared Codex, Claude and OpenCode slots
may otherwise be appended in the same workspace without resetting the selection.

The Core checks duplicate manifest/state inode, overlapping state paths, terminal
UUID and Claude session UUID against frozen originals and earlier reservations.
It does not re-inspect old live state as an empty candidate. The binding hashes
the full validated config, manifest bytes, manifest/state/project/executable/Node
inodes and model-source inodes. Existing validation checks executable and model
source hashes, expiry and selected context. These checks repeat before journal
effects, preparation and final backend dispatch. Same-user replacement between
the last synchronous check and the OS effect remains a disclosed threat-model
limit, not a claim of race-free filesystem execution.

For enrolled slots only, Core copies/freezes
`{version:1,bindingDigest,admissionRevision}` after durable reservation. Digest must
be lowercase 64-hex and revision a positive safe integer; invalid binding never
falls back to legacy behavior. The Start digest is canonical JSON of
`['orqst.terminal-start',1,profile,terminalPolicy,binding]`. The exact same digest
travels through signed challenge, journal and backend identity/lifecycle receipt.
Without binding, legacy bytes remain exactly `JSON.stringify([profile,terminalPolicy])`.
Binding supplements launch-time validation and grants no authority itself.

## Native composition and remaining acceptance

The caller must retain existing documents/brokers and append only the confirmed
member. Feature assignment, native generation/focus checks, context-CAS handling,
layout membership-key persistence and a separately reviewed native open remain the
native integration's responsibility. A stale presentation reply must not change
the active Feature, selection or focus. Enrollment is not authorization for the
native broker's independent Start, attach or input challenges.

Pure tests cover Pair continuity, original instance/output/input-lease preservation,
CAS/idempotency/rebinding, partial reservation/journal/receipt failure, capacity,
operation budgets, read-only workspace lookup, source inode/context validation,
legacy/enrolled digest propagation and a mocked IPC client with timeout/late ACK.
On 2026-11-04, the serial focused set passed 85 tests. Three additional archive
budget/tampering guards then passed together with the eight enrollment tests
(11/11). Repository typecheck and targeted ESLint passed. These checks used the
existing Node 24/pnpm 10 toolchain and shared dependencies without installing them.
No new Core, PTY, provider process, login, native UI or packaging acceptance is
claimed by those tests. Full build/Cargo/resources and real acceptance are paused
under the owner's disk/process preservation constraints.

Security review: the new actions exist only on inherited trusted parent/Core IPC.
No renderer proof/path authority, public listener, observer migration, credential
read, implicit process cleanup or grant renewal is added. See the
[pinned reuse review](../research/terminal-live-enrollment.md).
