# Explicit administrative admission of a cross-boot device difference

Source baseline: `dbf92ca284b4192d86511f1443253c57265f282d`. This correction is
executable in the existing offline service, not another capture, phase, host,
anchor or process-recovery system. Use on owner state remains subject to separate
owner approval of this changed administrative meaning and native acceptance.
No such operation is part of this increment.

## Authority and exact boundary

An old signed capture authenticates historical evidence. It cannot certify that a
current filesystem/volume is the same one: old captures contain no persistent
volume identifier. Neither matching inodes nor reconstruction of an enrollment
SHA establishes that missing fact. The service therefore declares a physical
_difference_ for explicit current administrative review, never equivalence.

Only release/continueRelease and finalize can propose this new admission. Capture,
continueCapture and abort retain their previous physical binding rules.

After verifying the existing administrative Ed25519 capture signature, snapshot
hash and different native kernel boot, the service may propose exactly one uniform
`historicalDevice`/`currentDevice` pair. Every captured file must still exist at its
exact canonical path, with identical bytes/base64, SHA-256, inode, size, mode, uid,
mtime and ctime. Duplicate paths, changed content, other metadata and mixed device
mappings deny before review. The current readers still enforce bounded private
regular single-link files, stable no-follow reads and ancestor security. This
strict device-difference path deliberately does not support simultaneous DB/WAL
checkpoint rewrites. With no device difference, existing checkpoint behavior stays.

Each complete enrollment preimage is reconstructed with the declared device pair:
parsed manifest, exact manifest bytes, all five ordered identities and all ordered
model-source identities. Its SHA must equal that slot's **signed historical**
snapshot binding and its frozen intent/ready receipt where present. The optional
historical candidate must independently satisfy its original context and exact
one-model-inode preimage proof. The selected current model-source inode may change between phases on the declared
projected device; its complete current metadata enters each fresh RAW review.
All other model-source identities remain exact. No search, guessed historical
inode or current binding adoption is allowed. Additional model-source drift denies.

`physicalDifference` in the current snapshot contains:

- `kind: 'administrative_device_difference'`;
- `historicalDevice` and `currentDevice`;
- `bindings[]`: slot and ordered canonical paths/current `[dev, ino, mode, uid,
nlink]` metadata for manifest/state/project/executable/Node and model sources.

These current facts enter RAW, including every original file's actual physical
identity and journal/SHM metadata. Only the logical comparison uses the declared
historical device, reproducing the complete old signed logical digest exactly.
The saved snapshot, capsule and original source files are never rewritten.

The existing complete native review includes this map plus
`physicalDifferenceAuthority`. It states that CURRENT consent authorizes archiving
ONLY the exact reviewed reservation after the kernel boot fence, and expressly
rejects volume continuity, adoption, owned exit, restored grants, launch, claim or
provider authority. Both release preparation and final commit require their
existing separate fresh administrative approval/signature, using the existing
anchor. No historical signature or physical map supplies that consent. The
version-2 intent digest binds the **complete review text**, and the phase challenge
binds the current RAW; final commit additionally binds its plan and current RAW.

Before that final approval, and before the only namespace mutation, the current
reservation records must still equal the released archive: every
`snapshot.files` physical identity, the declared device pair and the first five
runtime identities in each `physicalDifference.bindings` entry are
compared with `archive.current`, and any change is refused as
`pre_commit_physical_source_changed` with no new consent and no rename. A later
kernel reboot is therefore a new physical generation, not a renewed consent for
the already released archive. Model-source current metadata stays outside that
pin, so the drift the existing contract permits is not narrowed.

Every phase reruns the full current comparison after review/signing/revalidation
and before its effects. Changed RAW, kernel boot, current critical metadata,
controls or sources invalidate approval. Cancel/expiry preserves the reservation;
no retry is implicit. The original marker remains continuously present until the
existing separately approved final rename. Cleanup/replay retains the existing
future-owner boundary and never re-inspects future active markers or journals.
Launch, claim, enrollment, model checks and runtime keys are unchanged.

## Reuse research and decision

Re-read the local pinned source copies and existing ORQST enrollment serializer,
private readers, offline WAL inspection, native review wire and final-commit flow.
No upstream code, assets or dependencies are incorporated.

| Candidate | Exact source and contract                                                                                                                                                                                                                                                   | Decision                                                                                                                                                                                            |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Anywh     | [`instanceLock.ts` `takeLockFile`/`acquireInstanceLock`](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/agentHost/instanceLock.ts), Node fs/net/crypto and processTree                                                           | Keep ORQST. PID stale unlink/takeover (with documented race) cannot authenticate historical evidence or grant current administrative consent.                                                       |
| Anywh     | [`agentHost.ts` `AgentHost.start`/`restore`](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/agentHost/agentHost.ts), host lock/processTree/registry/log/socket dependencies; architecture, agent-host and runtime README re-read | Keep ORQST. Start sweeps marked processes; restore turns old alive/starting into stopped. Neither is compatible with preserving unknown ownership or with this non-dispatch administrative archive. |
| Tucano    | [`router.ts` `routerPrompt`/`parseRoute`](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/src/core/router.ts), shared language/types and engine types                                                                                       | Keep ORQST. Chooses speakers, grants no tools and has no cross-boot filesystem/administrative contract.                                                                                             |

Both pinned root LICENSE copies are Apache-2.0 (SHA-256
`cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30`). The preserved
tracked-tree audits record no NOTICE; partial local research copies do not prove
absence anew. With no incorporation there are no additional license notices or
dependency obligations. Overclock pane/layout source is irrelevant here; no
source repository, assets or unverified licensing is used.

## Executable evidence and limits

Synthetic fixtures mock builtin stat device values only after capture and inject a
different boot. They run production no-follow readers, frozen serializer, signed
capture verification, native-review contract and the full release/finalize
transaction. Positive cases cover with/without the historical capsule, immutable
historical bytes, retained old marker/claim exclusion, future-owner preservation
and replay refusal. Negatives cover changed capture signature/snapshot/capsule,
manifest/model drift, mixed mapping, inode/mode/byte changes, duplicate files,
same-boot attempt, cancellation and changes during release/finalize review.

This is not an actual reboot, native UI/anchor acceptance, filesystem/volume
continuity certificate or a working CLI/provider acceptance. No AppData, keys,
provider configuration content, native resources or preserved evidence are read
or modified by these fixtures. Builds/Cargo and all real recovery effects are
outside this delivery. See the delivery's actual check results before integration.

An independent adversarial review of this increment found that a second kernel
boot between release preparation and final commit was re-approved and then
committed the namespace before failing the held-marker identity check. The final
commit now pins the released physical records and refuses before approval and
rename; regressions cover a second device generation with and without the
historical capsule (no new approval, marker, gate and lock intact, no rename and
no completion), the same-boot release-plus-commit flow, and permitted
model-source drift outside `snapshot.files`.

Known limits. A second kernel reboot between release preparation and final commit
is refused without any effect, but the bundle then needs explicit owner handling;
it is never silently committed. The device-difference path requires the enrollment
executable and Node paths to be canonical, single-link and root- or user-owned, so
a legitimately symlinked or hardlinked runtime path is refused (fail-closed). When
the first captured record (the active marker) stays on an unchanged device while
other records move, the comparison reports no difference and the refusal surfaces
as a generic enrollment-binding error rather than `mixed physical device mapping`;
this is a diagnostic limitation, not an admission path.

Current source checks: 295 focused synthetic cases passed (offline recovery,
terminal journal, enrollment, Tauri preparation, native helper wire and arguments), plus `pnpm lint`,
`pnpm typecheck` and `git diff --check`. Full `pnpm test`, `pnpm build`, Cargo,
real ingestion and native/real-state acceptance were not run. Initial local checks
exposed a TypeScript mock optional return and an abort-continuation regression;
both were corrected before the passing focused run. The 291-case run belongs to
the reviewed base commit; this increment adds four regressions.

## Selected current inode correction — 2026-11-04

Baseline `50c1aebe1ac738525fbbe2dd61e59677dad1f603` accidentally compared all
projected current model metadata to the capture and pinned all model sources
inside the release/finalize physical comparison. Remove only that redundant
capture equality and limit the physical binding pin to the existing five ordered
manifest/state/project/executable/Node identities. Keep model metadata in full RAW,
review and repeated intra-phase checks. The unchanged `verifyHistoricalBinding`
still reconstructs the entire evidence-v1 preimage and frozen SHA, permits exactly
one selected inode on the projected device and rejects all other source drift.

Re-inspected the existing pinned local Anywh architecture, agent-host/runtime
READMEs, `instanceLock.ts` and `AgentHost.start`/`restore`, and Tucano `router.ts`
listed above. The same takeover/sweep/restore contracts remain incompatible;
keep ORQST's existing serializer/readers/transaction. Root LICENSE hashes still
match the recorded Apache-2.0 evidence. No source, dependency, asset or authority
is imported; no new NOTICE inference is made from partial reference copies.

Three new positive combination fixtures failed at the extra equality on the
unchanged baseline. They cover capsule + device difference + selected inode
replacement before release, before finalize and both. Negative combinations
replace it during review, signing, revalidation, durability and final commit;
additional model drift remains denied. Existing held/future-owner, mixed mapping,
metadata, SHA and second-device-generation negatives remain required.

Before projection, model sources must use the declared current device for any
historical source on the mapped device; sources originally on another device
must retain that device. An unmoved historical device cannot masquerade as the
current side of the pair. Invalid full historical proofs on this device-difference
path use the existing allowlisted `inspection/enrollment_binding_changed` refusal;
no raw exception, path, metadata or secret is added to the outcome protocol.

Final follow-up verification on Node 24.22.2/pnpm 10.34.9: all 318 focused cases
passed (offline recovery, terminal journal/enrollment/enrollment files, Tauri
preparation, native helper wire and arguments), plus full `pnpm lint`,
`pnpm typecheck` and `git diff --check`. Full `pnpm test`, build/resources/Cargo,
real ingestion and native/provider/real recovery acceptance were not run. No push,
tag, package mutation or real recovery action was performed. Remaining disk space
was 46 GiB; the isolated review worktree remains pending integration.
