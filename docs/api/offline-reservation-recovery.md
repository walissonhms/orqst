# Offline administrative reservation recovery

This is a private Core module, not an HTTP/WebSocket, renderer command, runtime
RPC, recovery CLI or production menu. Source entry:
`packages/core/src/terminal/offline-recovery.ts`. Native integration must first
review the [authority contract](../research/offline-reservation-recovery-contract.md).

`OfflineReservationRecovery` accepts `NativeAdministrativeRecovery`: an explicitly
administrative Ed25519 public trust anchor and `review(challenge, fullReview)`.
The trusted native parent must display the **complete** supplied review, Cancel
by default, and sign `administrativeRecoveryBytes(challenge)` only after approval.
It must refuse incomplete/truncated review. Reviews larger than 64 KiB fail closed.
Keys from runtime epochs, renderer fields, capture files or generic consent are
not acceptable trust anchors. Trusted native persistence of this independent key
across boots is an integration prerequisite; this increment does not provision it.

| Method                                        | Result / effects                                                                                                                                                                                                                                           |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `capture(preferencesDirectory, recoveryRoot)` | Reviews and durably saves signed capture material **before** publishing the sticky gate. Partial pre-gate material leaves the original reservation intact.                                                                                                 |
| `continueCapture(bundle)`                     | Explicit fresh capture review of a complete authenticated bundle, exact source/control checks and renewed file fsync before publishing/completing the same gate. Never reconstructs missing signatures.                                                    |
| `release(bundle)`                             | Requires a different kernel boot and a new release signature. Control-only cancellation/expiry permits a later explicit call with a fresh nonce. Archive/rename effects require `continueRelease`.                                                         |
| `continueRelease(bundle)`                     | Explicit fresh review of the exact signed archive and observed original/held marker phase. Re-fsyncs complete records, never overwrites an existing archive/receipt, never repeats a completed rename.                                                     |
| `abort(bundle)`                               | Explicit separate administrative approval, only before any archive effect. Verifies operation/control/source identity, preserves the original reservation and journals, and removes only this operation's gate/lock. Aborted bundles cannot later release. |
| `finalize(bundle)`                            | **Async**, with its own fresh native signature. Validates and re-fsyncs archive, receipts, held marker and signed finalization intent before gate removal. A later authenticated boot is accepted only with new finalization approval. No launch.          |

Production defaults read boot UUID from the fixed macOS native sysctl executable
with bounded output/timeout. Boot/clock/sync/boundary dependency overrides exist
for disposable fixtures and must never be wired to IPC fields. Challenge nonces
are one-use and monotonic-deadline bound within the reviewing process. The durable
capture signature remains historical after reboot; release uses a fresh challenge.
The immutable `release-attempt.json` v2 records control only, never consent.
The admission lock identifies the operation. A separate exclusive bundle lease,
`operation-<kernel-boot>.lock`, binds operation/boot/nonce and full file identity.
Concurrent helpers cannot share it. Only the same helper after its invocation has
returned may explicitly continue a retained lease; a helper from a different boot
has a positive external fence. An unknown same-boot helper is never presumed dead.
Known control-only cancellation/expiry removes only its exact owned lease; the
sticky admission gate remains. No automatic retry or stale-PID takeover exists.

Failures preserve original state and evidence. Complete durable phases have the
explicit continuations above. An incomplete/unknown signed capture, conflicting or
partial gate/lock, partial archive/receipt, changed inode/owner/snapshot, or unknown
same-boot helper remains denied. `OfflineRecoveryBlocked.reason` distinguishes
`missing_or_partial_capture_preserve_original`, `same_boot_helper_fence_required`,
`operation_lease_changed`, explicit continuation, and aborted/completed operations.
Parsing/private-file/byte mismatches also deny without overwriting evidence.
Legacy release-attempt v1/unsigned finalization controls are not silently migrated.
A legacy gate published before its authenticated capture was saved cannot be
attributed from its pathname; this patch deliberately provides no blind cleanup.

A complete signed finalization intent permits explicit continuation after the
admission lock was removed but the gate remained. After the final gate unlink,
a failing directory fsync still cannot prove crash durability of that cleanup.
The archive, receipts, signed finalization intent and held original marker remain;
a repeated call reports `already_finalized_or_final_sync_uncertain` instead of
manufacturing another release. No automatic reopen/start/retry is provided.

`non_dispatch` describes all preserved attempts in the validated snapshots, each
historically `prepared`, or zero attempts. It is not a claim that this AppData has
never executed anything. Journal retention can remove old `exited/start_failed`
records; no administrative signature reconstructs deleted history. Every observed
non-prepared state, lifecycle record, prior uncertain archive, incomplete/uncertain
enrollment, unknown schema or corruption denies this narrow operation. A valid SQLite WAL reset with an older physical tail is conservatively unsupported
by the current parser; refusal is not a corruption or dispatch finding. Kernel
reboot fences all old processes; it does not manufacture owned process exits.

Observer/API/cookie/static-serving behavior and OpenCode dispatch guard remain
unchanged. No UI is added, so no locale keys are introduced.
