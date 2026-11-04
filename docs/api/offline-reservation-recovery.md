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

| Method                                        | Result / effects                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `capture(preferencesDirectory, recoveryRoot)` | Explicit review; durably saves the signed bundle before publishing its gate. The original reservation remains present.                                                                                                                                                                                                                                                                                                                                                |
| `continueCapture(bundle)`                     | Fresh review and complete source/control checks of an authenticated capture, renewed fsync and gate completion; no marker release.                                                                                                                                                                                                                                                                                                                                    |
| `release(bundle)`                             | Different native boot, complete equivalent source and a new release signature. Saves only archive/preparatory receipts; returns `version:2`, `status:'release_prepared'`, `sourceMarkerHash`, `sourceMarkerIdentity`, `admissionBlocked:true`. **Never renames the original marker.**                                                                                                                                                                                 |
| `continueRelease(bundle)`                     | Explicit fresh review and renewed durability for exact archive/preparation records; still leaves the original marker present. Held-marker phases require `finalize`, not a release retry.                                                                                                                                                                                                                                                                             |
| `abort(bundle)`                               | Separate native approval only before archive effects. Removes verified administrative controls, preserving the original global reservation and journals. Aborted bundles cannot release.                                                                                                                                                                                                                                                                              |
| `finalize(bundle)`                            | Async explicit **final commit** approval. Persists and fsyncs the signed commit plan and all preparatory records, revalidates exact source/controls, then performs the only original-marker rename. After commit, verifies held evidence and cleans only the old exact gate/lock. Returns `status:'finalized'`, `releaseCommitted:true`, `cleanup:'old_controls_removed'` or `'changed_controls_preserved'`; never promises global capacity if a future owner exists. |

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

`finalized.json` is a **version-2 `commit_prepared` plan**, not a release outcome.
Its administrative signature binds the full original marker record, exact held path,
archive/preparation hashes and complete private gate/lock records (bytes/hash and
all seven identity fields). Native review shows the actual phase and full plan.
The only commit point is `rename(active-pair.json, held)` **inside finalize**, after
all approvals and preparatory records are durable. There is no rename→review gap.

Before that point the original marker continuously excludes legacy `claim(wx)`,
even if a post-boot old binary ignores the advisory gate. The old pre-boot owner is
fenced by the native kernel transition. This is protocol exclusion based on the
existing non-overwriting claim and dead original owner, not an atomic multi-file
transaction or an invented compare-and-rename syscall.

After commit, a late legacy claim is an ordinary future operation. Cleanup never
reads, renames or unlinks `active-pair.json`, or revalidates future journals and
enrollments. It compares only the old gate/lock's complete signed records before
unlink; different objects are preserved. Signed intent plus the exact original
held inode/hash proves the observed commit for explicit continuation after a crash.
Unique `commit-observed-<uuid>.json` records say `release_committed` only after the
namespace transition is observed and the directory is fsynced. `completion.json`
binds an observation and cleanup result; replay cannot repeat the marker transition
or delete a future owner's files.

A post-rename fsync/write failure reports namespace/durability/cleanup uncertainty,
never an invented successful exit or automatic retry. Explicit finalize can confirm
the held phase and complete old controls even when a new active owner already exists.
Neither exact original source nor exact held evidence means denial, not rollback.
A full valid intent is necessary: partial/legacy intent or partial completion stays
preserved with a phase reason. Partial observational receipts do not supply approval;
a fresh explicit continuation can create a separate verified observation.

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
