# Legacy terminal reservation: fencing prerequisite — 2026-11-04

Baseline: `03e5bcb3348e1faac7be03ee8065208253eb6d61`. This is a recovery
decision, not an implemented recovery command or permission to change user state.
The current reservation cannot safely be released by a newly started Core using
the existing APIs. No runtime, API, journal schema or OpenCode guard is changed.

The missing fact is **positive fencing of the original controller**. A complete
committed snapshot containing only prepared attempts establishes non-dispatch at
that snapshot, within the intact corresponding supervisor implementation. It does
not prevent that controller from dispatching immediately afterwards. Absence of a
PID, open descriptor or lifecycle receipt does not supply the missing fence.

## Existing authority and exact limits

| Source                                                                                                        | Reusable contract                                                                                                                                 | Legacy limit                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core/src/managed-codex/desktop-admission.ts:41-53`                                                  | Exact owner and enrollment bytes; sticky global reservation per preferences directory                                                             | The marker contains version, owner, initial manifests and optional epoch. It contains no controller handle, boot identity, key or authenticated recovery address. The enrollment map is in RAM. |
| `packages/core/src/terminal/authority.ts:45-48,91-100,103-131`                                                | Signed, expiring, one-use operation challenges                                                                                                    | Epoch, enrolled public keys and pending challenges belong to this live authority. Recreating UUIDs or generating another key cannot recover it.                                                 |
| `apps/desktop/src/tauri-terminal-host.ts:52-62`; `apps/desktop/src/managed-terminal-core.ts:45-90,386-399`    | Parent generates the signer, retains the forked child handle and receives its exact ready owner/epoch; `closeAndWait` waits for that child's exit | Private fork IPC has no reconnect/adopt operation. A process scan cannot reconstruct the handle-to-owner relationship.                                                                          |
| `packages/core/src/terminal/supervisor.ts:224-280`; `packages/database/src/terminal-journal.ts:39-46,128-151` | Starting commits before backend dispatch; dispatch runs inside `withOwner`                                                                        | A retrospective prepared snapshot is not a permanent revocation. A new external lock is not a lock already held and obeyed by the legacy controller.                                            |
| `packages/core/src/terminal/managed-pair.ts:268-330`                                                          | Owned evidence, proof consumption, archive preparation, local dispatch fencing, release                                                           | `reserved`, tracked attempts, dispatched instances and the fence are in RAM. `close()` fences that object only. No existing API reconstructs the old pair.                                      |
| `packages/core/src/managed-codex/desktop-admission.ts:95-128`                                                 | Exclusive private archive, flush and directory fsync, exact revalidation, then marker-only finalization                                           | `prepareRelease` closes over the original claimed owner and known enrollment bytes; it is not an offline recovery API.                                                                          |
| `packages/core/src/terminal/host.ts:323-331`                                                                  | OpenCode descendant uncertainty retains capacity                                                                                                  | Both retirement operations reject any version-3 member. Removing this guard cannot recover an absent original authority.                                                                        |

`Store.transaction` uses `BEGIN IMMEDIATE` (`packages/database/src/index.ts:159-171`).
`TerminalJournal.release` checks its owner and reconciles before deleting its own
owner row (`terminal-journal.ts:201-207`). These are useful existing primitives,
not authorization for a new writer to revoke an old owner's journals. They do not
alone serialize discovery of all concurrent enrollments with global admission.
`recover:true` changes epochs and attempt states; it is not a recovery release.

There is no safe patch limited to passing a prepared-only condition through the
OpenCode guard. There is also no justified legacy takeover using a changed marker,
new epoch, fabricated exit, or a lock introduced after the original controller
started. Such an implementation would leave its essential fencing assumption
unproved. The minimal source change is therefore deferred, rather than presenting
a future-only path as a repair for the existing reservation.

## Concrete external fencing alternatives

**If the original authenticated parent still retains its exact child handle:**
bind its received ready owner/epoch to the reviewed marker, prevent further native
operations, request its existing shutdown and observe exit on that same retained
child handle. The existing `closeAndWait` is the applicable primitive. A timeout,
EOF alone, a PID found by name, or quitting an unrelated Preview is insufficient.
This relationship has not been established for the investigated legacy owner.
Shutdown can change journals; it does not itself archive or release admission.

**Otherwise, the concrete available system-wide fence is a full macOS restart:**

1. Save unrelated work and finish active builds. Preserve a bounded, private,
   complete read-only snapshot of the exact marker, every owner enrollment intent
   and receipt, all referenced manifests, and committed journals including WAL.
   Record file identities, hashes, schema/epoch and directory membership together
   with the kernel boot session UUID. Reject unresolved or corrupt inputs.
2. The human selects Apple menu → Restart and deselects reopening windows. This is
   disruptive and must be explicitly authorized; this research executes no restart,
   quit, signal or login-item change. Do not use sleep, app restart or userspace
   reboot as a substitute for a changed kernel boot session.
3. Before opening ORQST, read the kernel boot UUID again and verify that it differs
   from the recorded pre-restart value. The read-only commands are:

   ```sh
   /usr/sbin/sysctl -n kern.bootsessionuuid
   /usr/sbin/sysctl -n kern.boottime
   ```

4. Re-enumerate and revalidate the entire logical committed snapshot after the
   fence, including enrollments and WAL contents. Shutdown/checkpointing may change
   bytes; do not blindly require the old WAL hash or ignore a changed attempt.
   Any dispatch, ownership loss, incomplete enrollment, unknown schema, corruption
   or unexplained change retains capacity. A reboot proves the old process cannot
   dispatch later; it does not prove historical non-dispatch or an owned exit.

A full kernel restart destroys the old user processes, so it fences even an old
controller whose PID cannot be identified. That inference follows from Apple's
[`reboot_kernel` / `proc_shutdown`](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/bsd/kern/kern_shutdown.c)
and boot initialization of
[`initializeBootSessionUUID`](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/iokit/Kernel/IOPMrootDomain.cpp).
Apple documents the human
[restart and window-reopening controls](https://support.apple.com/en-au/guide/mac-help/mchlp2522/mac).
The inspected XNU source has APSL-2.0 headers; no XNU code is incorporated.

**Restart alone does not unlock Open.** The current admission marker deliberately
survives it. No existing safe offline archive-and-release command was identified.
After positive fencing, a separately reviewed explicit offline retirement is still
needed; it must consume the complete revalidated evidence, preserve journals and
manifests, durably archive an honest non-dispatch reason, and only then finalize
release using the existing admission ordering. It must not create another Core,
claim the old execution identity, manufacture an exit or silently retry uncertain
effects. This document is not a command to delete the marker after reboot.

## Reuse review at exact upstream pins

The Anywh architecture, Agent Host and runtime README were read in the separate
Git checkout before inspecting these implementations. No third-party source,
asset or dependency is incorporated.

Exact license objects: [Anywh LICENSE](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/LICENSE) and [Tucano LICENSE](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/LICENSE). Both have SHA-256 `cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30`.

| Candidate and permanent source                                                                                                                                                                                                                                                                                         | Dependencies / license evidence                                                                                                                                                                                                                       | Decision                                                                                                                                                                                                                                                                                                     |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Anywh [`instanceLock.ts`](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/agentHost/instanceLock.ts), `acquireInstanceLock`, `takeLockFile`                                                                                                                                  | Node net/fs/crypto and `processTree.isAlive`. Exact root LICENSE is Apache-2.0; tracked tree has no NOTICE or additional license file; selected files have no additional copyright header.                                                            | **Do not use for legacy fencing.** Kernel abstract-socket exclusivity applies to Linux participants already using it. On macOS the fallback probes PIDs and unlinks stale lockfiles; source explicitly acknowledges competing stale-file takers can both win. Neither retroactively fences this ORQST owner. |
| Anywh [`agentHost.ts`](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/agentHost/agentHost.ts), `restore`, `stop`, `remove`, `close`; [`processTree.ts`](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/agentHost/processTree.ts) | Host registry, process wrappers, logs, socket server, runtime definitions; Node fs/process. Same root license.                                                                                                                                        | **Keep ORQST.** Restoring stopped state and signalling/sweeping marked descendants supplies neither this owner's original handle nor its retirement proof. Environment sweeps are Linux-only and are not a macOS descendant contract.                                                                        |
| Anywh [`terminalSession.ts`](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/host/terminalSession.ts), `spawnTerminal`, `killTerminal`                                                                                                                                       | node-pty, child_process, external tmux; same root license.                                                                                                                                                                                            | **Do not use.** Create-or-attach and kill-session semantics cannot recover ORQST authority or certify non-dispatch.                                                                                                                                                                                          |
| Tucano [`runs.ts`](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/src/core/runs.ts), `Runner.stop`; [`router.ts`](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/src/core/router.ts), `route`, `parseRoute`                                          | Runner controllers, engine/gateway/DB/shared contracts; router language/shared/engine contracts. Exact root LICENSE and package SPDX are Apache-2.0; tracked tree has no NOTICE/additional license file; selected files have no extra license header. | **Keep ORQST.** AbortController and model-selected speakers do not fence another historical process or authenticate retirement. No routing change is needed.                                                                                                                                                 |

## Required acceptance before any future release operation

- [ ] Establish the original-handle fence or verified full kernel boot transition.
- [ ] Bind explicit native approval to exact owner/epoch, complete snapshot digest,
      fencing evidence and archive action; cancel remains the default.
- [ ] Cover the synthetic OpenCode-prepared plus zero-attempt enrolled member case.
- [ ] Deny every dispatched/starting/running/ownership-lost/unknown case, corrupt or
      incomplete WAL, rejected/uncertain enrollment, and unaccounted member.
- [ ] Demonstrate late-controller fencing, concurrent enrollment/owner change,
      archive failure/order, replay rejection and privacy without a real runtime.
- [ ] Preserve original attempts; label non-dispatch retirement without exit claims.
- [ ] Revalidate after waits and fail closed after any possibly consumed operation.
- [ ] Apply to real state only under separate explicit authorization, then perform
      real Codex Open → started → owned exit → retirement acceptance.

No checklist item above is claimed implemented or accepted by this research.
Future owners can persist and enforce a suitable fencing relationship at admission;
that does not backfill missing legacy evidence. Workspace/Feature reservation scope,
OpenCode dispatched descendants and Electron retirement remain separate increments.
