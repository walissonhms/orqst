# Administrative offline non-dispatch recovery

Baseline: `03e5bcb3348e1faac7be03ee8065208253eb6d61`. This increment implements
an offline transaction and synthetic fixtures. Native menu integration and any
operation on user state require a separate review. It does not remove the OpenCode
dispatch/retirement guard, create a Core, or adopt a runtime identity.

## Authority and threat model

Administrative recovery is a new authority, not an inherited runtime epoch/key.
A trusted native composition supplies an Ed25519 **administrative** public key
and a native review callback. The key must have an independently trusted durable
binding across boots; a key discovered inside the capture is not a trust anchor.
The native parent signs an exact, one-use, expiring recovery challenge only after
showing its complete owner, epoch, snapshot digest, kernel boots and action.
Cancellation is the default. There is no renderer boolean or renderer-supplied
path/owner/boot/key. Capture, release, abort and finalization have separate phase approvals and signature
domains from `orqst.terminal`. A generic approval cannot authorize release.

The kernel source is `/usr/sbin/sysctl -n kern.bootsessionuuid` on macOS, with a
fixed executable/argument, bounded output and timeout. The production source has
no boot override. Tests inject a synthetic source explicitly. Sleep, app restart,
userspace restart, wall clock, PID and descriptor absence are not fences.

As with existing native-same-user files, malicious same-UID replacement, a
compromised native parent/kernel, rollback of the complete data volume and old
unpatched binaries bypassing newly added gates are outside the trust boundary.
Do not advertise protection against them. Legacy controllers are fenced only by
the changed kernel boot, never by a newly introduced advisory file.

## Transaction

1. Inspect read-only, enumerate the exact marker and **all** enrollment records,
   parse original manifest schemas, reconstruct committed DB+WAL, check integrity
   and canonical terminal attempt schemas. Only `prepared` (no exit) or zero
   attempts are eligible. All journal owner epochs must agree with enrollments
   and marker where present. Unknown versions, effects, records and states deny.
2. Review capture natively. Save and fsync the complete signed private bundle
   before exclusively publishing and fsyncing its sticky administrative gate. New admission/preflight/claim/assertOwner and
   enrollment must deny that gate, including objects constructed before it.
   Capture raw private files, file identities, directory membership and logical
   facts to an exclusive private bundle; fsync files and directories. Revalidate
   the whole source and kernel boot before and after gate publication.
   Failure/cancel never deletes the marker or automatically retries.
3. Only after a **different** native kernel boot: acquire an exclusive boot-scoped
   helper lease and retain the operation-specific admission lock; verify trusted administrative capture signature and gate;
   re-read every original source. Exact immutable marker/manifests/enrollments,
   owner epochs and complete logical journal facts must agree. Checkpointed WAL
   bytes may differ only when the validated logical projection is identical.
4. Review a fresh release challenge bound to both complete snapshots and boots.
   Re-read after review, before archive and before marker finalization. Any new
   enrollment/owner/attempt/uncertainty retains admission. Write an exclusive
   durable archive and a new receipt explicitly saying `non_dispatch`,
   `external_kernel_boot_fence`, `administrative_recovery`; never claim old exit.
5. Preserve the original marker by atomic rename to an operation-specific held
   marker, then fsync. A failure after a namespace mutation is uncertain; the
   sticky administrative gate continues denying admission. No rollback guesses.
   Release completion is a separate durable receipt, not an old runtime signature.
   Gate removal requires a separate fresh signed finalization review against the
   exact gate, completed receipt and held marker. Explicit continuations re-fsync
   complete records whose previous durability was uncertain. No automatic reopen/start/retry is part of recovery.

Ordinary legacy binaries cannot claim while the original marker exists, and
cannot inherit its UUID through the current constructor. Compliant patched
admissions additionally honor the sticky gate throughout. No path deletes a
journal owner, changes an attempt or runs `recover:true`.

## Reuse decisions

- Keep ORQST `desktop-admission.ts` archive-before-release ordering, private
  `terminalDirectory`/`terminalFile` readers, `terminalAttemptSchema`, enrollment
  schemas, original manifest schemas and `terminalDigest`. Offline projection
  belongs in database; trusted filesystem/review composition belongs in Core.
- [Anywh instanceLock](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/agentHost/instanceLock.ts)
  uses Node fs/net/crypto and process-tree PID checks. Architecture, agent-host and
  runtime READMEs and actual source inspected. macOS stale-PID takeover cannot
  fence the old ORQST controller; do not use. AgentHost restore/stop and
  terminalSession tmux attach/kill import incompatible lifecycle authority.
- [Tucano router](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/src/core/router.ts)
  and `runs.ts` Runner controllers depend on engine/gateway/DB; neither speaker
  routing nor AbortController provides external legacy fencing. Keep ORQST.
  Both pinned roots are Apache-2.0, only root LICENSE and no tracked NOTICE;
  no source or dependency is copied.
- [XNU shutdown](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/bsd/kern/kern_shutdown.c)
  `reboot_kernel`/`proc_shutdown` and `IOPMrootDomain.cpp` boot UUID initialization
  support the external kernel fence inference. APSL headers: zero code copied.
- [SQLite WAL format](https://sqlite.org/fileformat2.html#wal_file_format): implement
  bounded format validation, salts and cumulative checksums independently; reject
  partial/uncommitted tails. Derived private immutable DB only; source SHM is never
  opened, mapped or altered. Overclock visual/layout reference is irrelevant to
  this non-UI increment; no source/assets incorporated.

The native trust-anchor persistence and complete native review are explicit
integration prerequisites, not supplied by reading a legacy marker. This module
must not be connected to a production renderer/RPC until that review is complete.

The complete native review receives validated admission/enrollment/manifest records,
all journal projections and source identities/hashes, bounded to 64 KiB without
truncation. The capture signature binds the hash of the complete serialized raw
snapshot, not merely a caller-supplied digest field. Post-fence signatures bind
all raw sources and complete logical facts. Finalization checks the preserved
marker inode and all other original files again before removing admission gates.

`non_dispatch` is scoped to the preserved attempts. Journal v2 may retain only a
subset of old `exited/start_failed` history after retention; there is no legacy
append-only genesis certificate. Do not claim that no process ever ran in this
AppData, or infer provenance of an old binary merely from schema version 2.
The exact final-unlink/fsync uncertainty boundary is documented in the private
API; durable archive/receipts and original marker bytes survive final cleanup.

## Source correction after independent review — 2026-11-04

The original 743 flow irreversibly consumed a bundle on Cancel/expiry and could
publish a gate before saving the only authenticated capture. The correction keeps
control persistence separate from consent, saves signed capture first, and adds
explicit phase-specific continuation/abort. All effects still require exact source
revalidation; fresh native approval is mandatory, including finalization.

The helper lease is narrow administrative exclusion, not a new process manager.
A returned invocation retains its exact lease identity in RAM; another process
cannot inherit that fact. A different kernel boot fences earlier helpers. Same-
boot crash without a retained authenticated child-exit relationship stays denied.
Partial legacy capture/control cannot establish that missing relationship.
Do not add PID scans, inferred exit, automatic stale-lock deletion or `recover:true`.
The private API and development phase table define the remaining boundaries.

The original pinned Anywh/Tucano lock/restore/stop/router sources were re-inspected:
they supply no compatible legacy fencing or administrative trust anchor. Keep the
existing ORQST readers, canonical validators, admission ordering and native helper
transport; no upstream code, dependencies or runtime authority is incorporated.
