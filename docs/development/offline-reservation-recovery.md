# Offline recovery implementation and review flow

Implemented source and synthetic fixtures are available; no operation on user
AppData, native human review, kernel reboot, Core/PTY/provider run or Electron
retirement is validated by this increment.

Run only the disposable fixture flow with Node 24/pnpm 10:

```sh
pnpm exec tsx --test tests/offline-reservation-recovery.test.ts
```

The first fixture performs capture → simulated different kernel boot → reviewed
archive/preparation with original marker retained → explicitly reviewed final
namespace commit → marker preservation and exact old-control cleanup.
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
The legacy pre-boot controller is fenced by the actual kernel transition. Before
final commit, the original marker continuously excludes the existing legacy
non-overwriting claim, even when that claimant ignores the advisory gate. No human
checkbox or assumed installation compatibility supplies this exclusion.

Only after that code review/integration should root present a concrete separate
human procedure: review/capture the exact real reservation before any reboot;
preserve unrelated work and explicitly authorize any full kernel reboot; inspect a different native boot and the entire post-boot
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

| Durable observation                                                                                                           | Explicit permitted action                                                                     | Preserved authority / boundary                                                                 |
| ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Partial capture, no gate                                                                                                      | New capture; keep partial evidence                                                            | Original marker remains; no release authority                                                  |
| Trusted complete capture, absent/exact gate                                                                                   | `continueCapture`, fresh review and renewed fsync                                             | Partial/conflicting gate is never adopted                                                      |
| Release control only, no archive                                                                                              | New release review after known Cancel/expiry, or pre-effect `abort`                           | Control is not consent; original marker remains                                                |
| Signed archive / preparatory receipts                                                                                         | `continueRelease`, then `finalize`                                                            | `release_prepared`, never released; original marker remains                                    |
| Signed commit plan, original source exact                                                                                     | Fresh explicit `finalize` review, re-fsync and source/control checks, then one rename         | Original marker excludes legacy wx claim until this FINAL point                                |
| Exact original held inode plus signed plan                                                                                    | Fresh explicit finalize continuation; confirm/fsync namespace and write committed observation | Do not inspect or mutate future active owner/journals/enrollments                              |
| Old control still matches full signed record                                                                                  | Remove only that exact gate/lock                                                              | New or changed control objects are preserved                                                   |
| Completion receipt valid                                                                                                      | Replay denied                                                                                 | Never touch future active marker or repeat rename                                              |
| Partial/absent signature, partial controls/intent/completion, neither exact original nor exact held, unknown same-boot helper | Preserve and report phase; no blind cleanup                                                   | Needs authenticated missing evidence or a proved helper fence; filenames/PIDs are insufficient |

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
2. Provision a separate durable administrative Ed25519 identity from a fixed,
   native-owned AppData keystore, independent of every bundle/runtime key. Under
   the declared native-same-user boundary, use canonical private owner/mode checks,
   reject symlinks/replacements and pin the public fingerprint before capture.
   Persist/revalidate the anchor across boots and again after native ACK, before
   signing. Missing or changed keys must deny, never silently regenerate or rotate.
   No private key material in argv/environment/logs or renderer messages. This is
   a native composition requirement, not a claim that bundle-local keys are trusted.
3. Display the complete bounded review as native plain text, including action,
   exact owner/epoch, all members/model choices, logical/raw hashes, original and
   current kernel boots, archive/marker phase and remaining limits. Existing native
   `detail` is capped at 16 KiB whereas this API allows 64 KiB: direct reuse would
   reject/truncate valid reviews. Root approved a minimal native NSScrollView for
   the complete <=64 KiB plain-text details, followed by a distinct keyed ACK.
   Preserve focus/generation/revocation and Cancel default, then revalidate anchor
   and pipe before signing the exact challenge bytes. Keep the Core's 30-second
   lifetime: expiration returns null, and only another explicit human gesture
   obtains a new review/challenge. No automatic renewal or recycled consent.
4. Before an owner-authorized later kernel transition: capture the exact reservation
   and verify its durable bundle/gate, with the original marker continuously present until final commit. Operator saves unrelated work and separately authorizes any
   full kernel restart. This document requests no restart now. Afterwards the native
   action reads a different kernel UUID, reloads the independently trusted key,
   reviews/revalidates the full state, releases, then separately reviews finalization.
   Old binaries ignore the advisory gate, but their existing wx claim is excluded
   by the continuously present original marker until the FINAL authorized rename.
   A claim after that point is future normal work, never a cleanup target.
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
bundle, refuse older phases and define crash-consistent updates. A durable key
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

## Final-point freeze after root ordering decision

`release`/`continueRelease` now return only `release_prepared` (receipt version 2).
`finalize` approves the final namespace commit. Native details must show its complete
version-2 `commit_prepared` plan, then the exact `administrativeRecoveryBytes` are
signed with the unchanged 30-second challenge lifetime. No proof may be inferred
from a transport ACK, timeout, process exit code or a preparatory receipt.

The atomic operation is only the original-marker rename. It follows durable
preparatory records and native final approval; no cross-file atomicity is claimed.
Afterward `commit-observed-*` records plus `completion.json` describe outcome and
cleanup; partial observation files remain private and may be superseded by a fresh
explicit observation. The original marker, archive and signatures remain evidence.
No post-commit path reads or removes a future active marker. A future claim or
source write after the point cannot retroactively invalidate pre-commit proof.

Fixtures cover every before/after commit stage, positive legacy wx exclusion,
actual late claims while the advisory gate still exists, future enrollment/journal
changes, changed/future controls, replay, owner change during final review,
partial intent/observations, and fsync failures. Unknown namespace/metadata after a
real crash still requires exact phase classification; these fixtures do not claim
actual kernel/APFS crash acceptance or stronger power-loss guarantees.

Final-point correction verification: 170 focused synthetic cases passed (117
offline transaction cases and 53 existing regressions), together with whole-tree
ESLint, root TypeScript no-emit, formatting and whitespace checks. This supersedes
the intermediate 154-case continuation freeze only for the final marker ordering;
no native/real kernel/provider acceptance is inferred. Node 24.22.2, no dependency
changes, builds, Cargo, real managed Core/PTY, reboot or user state operations.

## Final commit deadline and lease correction — 2026-11-04

Vertical review reproduced expired consent reaching rename when durable preparation
outlasted the 30-second proof deadline. It also reproduced an altered helper lease
being detected only after rename. The narrow correction checks that exact retained
lease and the existing monotonic deadline immediately before the namespace commit,
after the last source checks. No deadline is extended. A denied pre-commit phase
keeps the original marker; a later explicit finalize obtains a new nonce and review.
Expiry after commit preserves the committed outcome and truthful completion receipt.

Five synthetic regressions cover exact deadline at both commit boundaries, actual
fsync followed by elapsed fixture time, changed helper lease and post-commit expiry
with a future owner. Before correction, the three expiry cases and lease preservation
failed; the post-commit outcome case passed. No real state or kernel boot was used.

### Legacy CLI executable identity

A v1 enrollment preimage includes the CLI executable's device and inode. An
update that preserves that inode does not by itself prevent reconstruction. If
an update replaces the file and the historical identity is unavailable, the
original preimage cannot be verified from its digest alone. The reservation and
its evidence remain uncertain and preserved; no process, journal or manifest is
modified automatically. The native diagnostic reports that the historical
binding could not be verified. Existing offline evidence may be reviewed under
the separately authorized recovery process; it is not launch authorization.

### Versioned interactive bindings

New authorized interactive manifests carry a version 2 CLI binding. It binds the
canonical executable path, signature identity, contract revision, local policy
revision and authorization epoch, while excluding the CLI digest and inode from
the enrollment preimage. Recovery can therefore inspect v2 metadata after a CLI
replacement without reading or executing that CLI. It does not restore any grant;
starting an updated executable requires fresh local authorization. Legacy v1
bindings retain their original serializer, with the unverifiable case described
above. Mixed v1/v2 recovery has synthetic coverage only.
