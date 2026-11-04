# Offline recovery implementation and review flow

Implemented source and synthetic fixtures are available; no operation on user
AppData, native human review, kernel reboot, Core/PTY/provider run or Electron
retirement is validated by this increment.

Run only the disposable fixture flow with Node 24/pnpm 10:

```sh
pnpm exec tsx --test tests/offline-reservation-recovery.test.ts
```

The first fixture performs capture → simulated different kernel boot → fresh
administrative transaction → archive → marker preservation → explicit finalize.
It uses actual SQLite journals and WAL generated in a private temporary directory,
an OpenCode v3 manifest with one prepared attempt, and an enrolled Codex v1 member
with zero attempts. Synthetic administrative keys and boot UUIDs are explicit.
No executable is launched or provider configuration opened. Existing canonical
manifest, enrollment and attempt validators are exercised directly.

Other fixtures cover same boot/relaunch, late-controller starting, changed owner
and epoch, enrollment race/uncertainty, logical WAL checkpoint equivalence,
corrupt/truncated/uncommitted WAL, unknown versions/states, failure boundaries,
actual injected fsync errors, signature/hash corruption, cancellation, expiry,
replay/concurrency, sticky locks, admission objects constructed before capture,
symlink/private mode/inode/budget checks and changes before finalization.

Review artifacts and source responsibilities:

- `offline-terminal-journal.ts`: pure WAL overlay plus database-layer validation
  of a private immutable derived copy. Canonical schema SQL and attempt validators
  are reused. It never opens the original SQLite connection or SHM.
- `offline-recovery-files.ts`: bounded canonical/private source capture, complete
  membership, manifest/enrollment validation, logical/raw digests and held-source
  revalidation. Captured bytes stay private and are never emitted to logs.
- `offline-recovery.ts`: independent administrative challenges, native boot
  source, capture/release/finalize ordering, durable new receipts and replay latches.
- `offline-recovery-gate.ts`: deny-only hook used by passive inspection and every
  authoritative admission boundary, including old in-memory admission objects.

Before any native integration or real application, root must review the
[authority/fencing contract](../research/offline-reservation-recovery-contract.md),
the [private API](../api/offline-reservation-recovery.md), trusted administrative
key persistence and complete native review implementation. Pin the corresponding
runtime/source semantics; schema versions alone do not attest an old executable.
Ensure every installed controller participating in the procedure uses the new
gate hooks. An unpatched binary is not constrained by a new advisory file.
The legacy pre-boot controller is fenced by the actual kernel transition only.

Only after that code review/integration should root present a concrete separate
human procedure: review/capture the exact real reservation before any reboot;
preserve unrelated work and explicitly authorize a full kernel reboot; keep
reopening disabled; inspect a different native boot and the entire post-boot
snapshot; review release and finalization. No step is requested or executed here.
OpenCode dispatched-descendant acceptance, actual Codex Open→started→owned exit,
native UI acceptance, packaging and Electron removal are later gates.

Original 743 validation on its isolated worktree: Node 24.22.2; 121 focused synthetic tests
passed (68 new offline cases and 53 existing admission/enrollment/retirement/file
regressions). Root `tsc --noEmit`, whole-tree ESLint, whole-tree Prettier check and
`git diff --check` passed. Shared existing dependencies were linked, not installed
or copied. The pnpm wrapper was unavailable under the selected Node PATH, so these
checks used the existing local binaries directly. Full test suite, builds, Cargo,
resource staging, native UI, actual kernel transitions and provider acceptance
were not run. Final disk observation was about 22 GiB available; no heavy work was
started and no application/runtime data or existing evidence was removed.

## Explicit continuation phases — source correction after independent review

| Durable observation                                                                          | Explicit permitted action                                                                        | Denial / preserved evidence                                                                                 |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Partial bundle, no gate                                                                      | A new capture; preserve the partial bundle                                                       | No release; original marker still blocks Open                                                               |
| Complete trusted capture, absent/exact gate                                                  | `continueCapture` with fresh review and renewed fsync                                            | Partial/conflicting gate is never adopted                                                                   |
| Release control/lock only, no archive                                                        | New `release` review after known Cancel/expiry; or pre-effect `abort`                            | Persisted control is not consent                                                                            |
| Complete signed archive, original marker                                                     | `continueRelease`, fresh review, re-fsync archive/prepared receipt, then rename once             | Corruption, source change or ambiguous helper retains gate                                                  |
| Complete signed archive, held original marker                                                | `continueRelease`, verify original inode/hash and all raw sources, re-fsync and complete receipt | Both/neither markers, partial receipt or different owner deny                                               |
| Released receipt, gate/lock retained                                                         | Async `finalize` with fresh phase signature                                                      | Cancel/expiry permits another explicit review                                                               |
| Signed finalization intent, lock removed, gate retained                                      | Explicit `finalize`; verify intent/receipt/held marker and re-fsync                              | An unsigned old intent is insufficient                                                                      |
| Gate already unlinked after durable authority                                                | Report completed/final-sync uncertainty; no second release                                       | Cleanup crash durability is not inferred                                                                    |
| Partial/absent signed capture behind an old gate; partial controls; unknown same-boot helper | Preserve and report the exact phase; no blind cleanup                                            | Needs independently authenticated missing material or a proven helper fence; a filename/PID is insufficient |

A native wrapper must retain the same helper/object after a returned post-effect
error if it wants same-boot explicit continuation. The current one-shot preparation
helper exits in `finally`; copying that lifecycle would strand its retained lease.
Alternatively, a future separately reviewed native fence must bind the published
operation/boot/nonce/full lease identity to the exact retained child handle and its
confirmed exit before another helper can proceed. This source accepts no such
exit override yet. A same-boot unknown-helper denial must not offer blind cleanup
or imply that restarting the app supplies that missing fence.

Each method is an explicit native action, never startup repair or an automatic
error retry. A same helper may continue only after its previous invocation returned
and its exact lease still matches. Another boot permits a new exclusive helper
lease; another process in the same boot cannot assume the earlier helper exited.
Abort is restricted to no archive effect and keeps the original global reservation;
it does **not** solve terminal opening by deleting the original marker.

## Smallest next native integration slice

1. Add an administrative native-menu action available while preparation is blocked,
   without constructing a managed Core/Pair/PTy. Reuse the fixed bundled Node
   sidecar and bounded correlated native stdin/stdout review transport from
   `terminal_creation.rs` / `tauri-terminal-preparation-host.ts`. Do not call the
   existing preparation admission predicate: it intentionally refuses the very
   reservation this action must inspect. Keep Open/retire/MCP/metadata/Quit reviews
   mutually exclusive. Never add a generic renderer/RPC/path/boot/key command.
2. Implement a fixed app-bound macOS Keychain item for the separate administrative
   Ed25519 private key and pinned public fingerprint, before capture. Bind its
   fixed service/account to the signing identity and canonical AppData; no key
   material in argv/environment/logs or renderer messages. Pin/load its public key
   independently of the bundle; bind it to the canonical installation/AppData and
   preserve it across boots. Refuse missing/replaced keys; no automatic rotation
   or trusting a bundle-supplied key. Runtime keys remain ephemeral and unrelated.
   This repository currently has no durable key-store implementation; choose and
   review that native boundary explicitly rather than claiming a file is trusted.
3. Display the complete bounded review as native plain text, including action,
   exact owner/epoch, all members/model choices, logical/raw hashes, original and
   current kernel boots, archive/marker phase and remaining limits. Existing native
   `detail` is capped at 16 KiB whereas this API allows 64 KiB: direct reuse would
   reject/truncate valid reviews. Supply reviewed bounded paging with every page
   required, no hidden approve/omitted fields; preserve focus/generation/revocation
   and Cancel default. Core challenge lifetime is 30 seconds; design the review
   lifetime explicitly, and renew via a fresh revalidated challenge rather than
   accepting an expired signature or stretching a renderer timeout.
4. Before an owner-authorized later kernel transition: capture the exact reservation
   and verify its durable bundle/gate, with old installations/autoreopen excluded
   from the procedure. Operator saves unrelated work and separately authorizes any
   full kernel restart. This document requests no restart now. Afterwards the native
   action reads a different kernel UUID, reloads the independently trusted key,
   reviews/revalidates the full state, releases, then separately reviews finalization.
   Old binaries ignore the new gate, including the window after marker rename;
   key persistence alone cannot enforce the compatibility precondition.
5. Completion returns only to the ordinary CLI → model → Open flow. That flow creates
   new owned state; recovery never adopts journals, restores keys, claims provider
   exit or launches automatically. Real Codex started → owned exit and OpenCode
   descendant acceptance remain separate. Package/native/provider use requires a
   separate explicit decision after source review and fixture checks.

The independently stored key authenticates signatures, not historical file freshness.
Current nonces/phase signatures and exclusive control/lease files deny ordinary
replay; full AppData/volume rollback is explicitly outside this source contract.
If AppData-restore detection is required, the next native boundary must also retain
an operation ID, capture hash and consumed phase checkpoint independently of the
bundle, refuse older phases and define crash-consistent updates. A Keychain key
alone is not a monotonic ledger or protection against rollback of that store too.
Do not advertise stronger anti-rollback guarantees or add a generic runtime ledger.

Correction verification on `fix/offline-recovery-review-744`, based on `1b3dd9a`:
Node 24.22.2 ran 154 focused synthetic cases successfully (101 offline recovery,
53 admission/enrollment/Pair/retirement/file regressions). Whole-tree ESLint,
Prettier check, root TypeScript no-emit and diff whitespace validation passed.
Existing dependencies were linked locally; no install or package/lockfile change.
Five isolated reproductions on original 743 confirmed Cancel, expiration, post-gate,
post-rename and later-boot finalization dead ends before the correction. The new
fixtures also demonstrate why retention is not a historical genesis certificate.
Full test suite, product/Cargo builds, managed Core/PTY/provider, native review,
real kernel transitions and real reservation operations were not run. Disk space
was about 23 GiB free; no heavy build/resources or user state were changed.

A separate real-SQLite fixture exposes a conservative format limit: a valid WAL
reset can leave an older physical tail with different salts. SQLite reads its new
committed prefix, but the current offline parser rejects the stale tail with
`Offline WAL frame binding`. This is unsupported input, not evidence of dispatch
or database corruption. The parser was not broadened in the continuation fix;
native preflight must report the refusal and preserve state, never truncate or
checkpoint the original source to make recovery eligible.
