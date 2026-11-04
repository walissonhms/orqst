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

| Method                                        | Result / effects                                                                                                                                                                                                                                                                                                             |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `capture(preferencesDirectory, recoveryRoot)` | Explicit capture review, exclusive sticky admission gate and private durable snapshot including original DB/WAL bytes. Returns operation ID, bundle, owner/epoch, native pre-boot UUID and complete signed snapshot hash.                                                                                                    |
| `release(bundle)`                             | Requires a different native kernel boot, exact gate and signed capture, complete logical equivalence, fresh release approval and repeated raw revalidation. Writes archive/prepared receipt, renames the original marker into a preserved held marker, fsyncs and writes a new completion receipt. Leaves admission blocked. |
| `finalize(bundle)`                            | Separate explicit native completion; verifies administrative signatures, receipts, held marker, all other source bytes, namespace and current boot. Persists finalization evidence before removing lock/gate. Never launches or relaunches anything.                                                                         |

Production defaults read boot UUID from the fixed macOS native sysctl executable
with bounded output/timeout. Boot/clock/sync/boundary dependency overrides exist
for disposable fixtures and must never be wired to IPC fields. Challenge nonces
are one-use and monotonic-deadline bound within the reviewing process. The durable
capture signature remains historical after reboot; release uses a fresh challenge.
Exclusive gate/attempt/lock/archive files prevent replay across process restarts.

Every failure throws and preserves evidence. A possibly written release attempt
cannot be retried automatically. Before marker rename the original path remains;
after rename the original marker bytes remain at the held path and the gate/lock
continues blocking admission. Final cleanup after already durable completion has
an explicit uncertainty boundary: an error in the directory fsync after the last
gate unlink cannot guarantee whether that unlink will survive a crash. It cannot
undo the already durable archive/receipts, and the original marker remains held.
There is no automatic retry, rollback, recovery startup or start-after-success.

`non_dispatch` describes all preserved attempts in the validated snapshots, each
historically `prepared`, or zero attempts. It is not a claim that this AppData has
never executed anything. Journal retention can remove old `exited/start_failed`
records; no administrative signature reconstructs deleted history. Every observed
non-prepared state, lifecycle record, prior uncertain archive, incomplete/uncertain
enrollment, unknown schema or corruption denies this narrow operation. Kernel
reboot fences all old processes; it does not manufacture owned process exits.

Observer/API/cookie/static-serving behavior and OpenCode dispatch guard remain
unchanged. No UI is added, so no locale keys are introduced.
