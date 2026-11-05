# macOS kernel reservation review

Owner decision, 2026-11-05: a Tauri user may release an owned reservation across
launches after scoped kernel evidence and one fresh native confirmation. This is
not process adoption, task completion, a fabricated exit, or an observer API.
The menu action and its private native/Core pipes do not expose process control
or recovery authority to the renderer, HTTP or WebSocket.

The PTY lifecycle receipt is armed before dispatch. The host waits for a private
spawn order until its boot UUID, PID, kernel start, SID, PGID and UID are persisted
and fsynced. The Core identity is also persisted. After `node-pty` returns, the
leader is queried and recorded before ready, attach or input. Its PPID must be the
recorded host, its start later, and its PID its SID and PGID. If it exits or this
query or write fails, the missing identity is not inferred: this reservation is
ineligible and stays in the existing offline flow. In particular, a crash between
spawn and the leader fsync leaves an armed/started receipt without leader identity.
Receipt, marker, journal and kernel spawn are not a physical multi-file transaction.

The recorded Core, host and leader must each be absent or have a different kernel
start on the same boot. Two full `KERN_PROC_ALL` scans, 100 ms apart, must have
consistent counts and no process in any recorded original SID. Kernel errors,
disappearing or changing entries, inaccessible sessions, truncation and contradictions
deny the review. A recycled SID with a live member also denies. The review's default
is Cancel and warns that descendants which left those sessions are not checked. A
second scoped verification and the original unexpired review are required before
rename. Two scans are not an atomic snapshot: an escaping descendant or a process
created and gone between scans remains a residual limit. Every decision records
`absence_proven` for `original_sessions` and `descendants_not_validated`; it never
sets an exit code, signal, task status or exited receipt.

`active-pair.json` remains in place during proof and review; the existing atomic
exclusive `wx` claim therefore prevents a new owner dispatching. A durable exclusive
admission mutation lock also fences every current ORQST marker remover, including
normal owned retirement and offline finalization. The lock records the kernel
identity of the process that performs the mutation. A successor with a deterministic
predecessor-derived name may be created only after native kernel queries establish
that the preceding holder is dead; unreadable, ambiguous or live holders deny.
Locks are retained. The native Tauri process holds the kernel-review mutation lock,
so a cancelled or failed review can require quitting that process before a fresh
attempt; it does not require reboot. An actor outside ORQST manually changing the
marker is outside this protocol. Electron `userData` and Tauri `app_data_dir` are
separate admission namespaces.

Mutation and per-marker predecessor chains have a 128-entry budget; the existing
directory-enumeration budget can refuse sooner. Exhaustion denies further recovery
rather than recycling or deleting old evidence.

The exact reviewed marker is opened without following links and bound by device,
inode and SHA-256. A per-marker exclusive recovery lock records a unique destination.
The marker is rechecked and `renameatx_np(RENAME_EXCL)` moves it within the same
directory without overwrite; the destination inode and bytes are rechecked and the
directory is fsynced. A private decision binds the review, scope and limitation.
Original evidence is not deleted. A crash or lost acknowledgement never causes a
silent retry or rollback.

| Crash boundary                                   | Preserved result                                                                                                                                                                      |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Before mutation or per-marker lock               | Original marker remains; incomplete identity is ineligible.                                                                                                                           |
| After a lock and before rename                   | Original marker remains. A live holder blocks; after a dead holder, a successor repeats all checks and displays the previous recovery lock in a fresh review.                         |
| After rename, before directory fsync or decision | A new `wx` claim is legitimate. Startup audit verifies the exact archived inode/hash, fsyncs the directory and records `released_durability_uncertain`; partial evidence is retained. |
| After directory fsync, before decision/ACK       | The same audit records the scoped uncertain-durability observation without touching a future marker.                                                                                  |
| After a complete decision                        | Audit validates its binding and archived marker. Neither future claims nor their markers are touched.                                                                                 |

If neither original nor exact archive is present, audit records `uncertain` and
preserves all material. An invalid lock or failed kernel query never authorizes
recovery. Existing markers without kernel receipts, including the owner's current
legacy reservation, are not eligible; the prior offline flow may itself refuse
them if its strict non-dispatch requirements are not met.

No cross-launch process is signalled. The pre-existing current PTY host has a
separate 30-minute lifetime policy: it sends SIGTERM and, five seconds later if
the child has not exited, SIGKILL via its owned `node-pty` handle. This is not a
new cross-launch recovery capability or proof about escaped descendants.

Code and disposable tests do not establish native UI acceptance, packaged binary
signing, actual provider behavior or a successful recovery of real user data.
