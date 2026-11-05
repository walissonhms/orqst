# Exact historical enrollment binding in offline recovery

This administrative path verifies a **historical registered preimage**, not the
current provider configuration. It grants no launch, claim, configuration reuse,
provider access or runtime authority. Normal enrollment, model pins/expiry,
preflight and claim/launch checks remain strict and unchanged.

An explicitly supplied candidate is accepted only when current enrollment binding
fails and substituting exactly one inode of one present manifest-declared model
source on the same device reconstructs the complete frozen enrollment SHA-256.
The exact parsed config, five other identities, original manifest bytes, ordered
model-source paths and every other source identity remain in the preimage. The
frozen digest must match the original intent and its corresponding ready receipt;
marker, operation, epoch, member and manifest context must also match. No inode
search, APFS monotonicity assumption, current-digest adoption or quarantine is used.

The candidate's schema is `historicalBindingEvidenceSchema` in
`packages/core/src/terminal/offline-historical-binding.ts`. It records marker and
enrollment hashes/context, member/manifest binding, one historical source identity,
and the complete ordered historical source identity list. It contains no keys,
provider content, discovered current digest or authority. Unknown fields deny.

## Native origin and durable copy

Use the existing native administrative entry with this optional exact vector:

```bash
"/ABS/PATH/ORQST Preview.app/Contents/MacOS/orqst-desktop" --offline-recovery --offline-recovery-binding-evidence /ABS/PATH/private-candidate.json
```

The flag is valid only with `--offline-recovery`; duplicate, missing, extra,
relative, NUL and malformed vectors deny before normal startup. The native parent
passes an argv vector directly to its existing helper. Neither renderer nor action
frames carry the hint. The path is visible to local process inspection; it is not
a secret or a grant. Default legacy offline argv remains supported.

Only a new explicit capture reads the external candidate: canonical regular file,
current uid, exact 0600, one link, no symlinks, stable bounded read of at most 4 KiB,
fatal UTF-8 decoding and strict schema. Its exact bytes are written exclusively as
`historical-binding-evidence.json` in the new private 0700 bundle, mode 0600,
fsynced and reread for the same hash/bytes. Complete evidence file metadata and
bytes enter the snapshot; signed capture binds its hash and semantics. Afterward,
continueCapture, abort, release, continueRelease and finalize use only that durable
copy. A changed/missing copy denies. A partial bundle without valid signed
capture.json cannot be adopted, retried automatically or deleted by this path.
There is no key import, anchor regeneration, release or reboot implicit in capture.

## Historical identity and current critical metadata

The stable logical projection contains the evidence SHA and historical semantics,
including the frozen binding. Each phase reconstructs the complete historical
preimage again without searching. The RAW projection contains current model-source
critical metadata: canonical path, device/inode, regular-file mode, uid and nlink.
One changed inode between phases can pass the same historical proof and requires a
fresh native review/signature with the new RAW digest. A critical metadata change
within a phase invalidates approval before effects; there is no automatic retry.
A new explicit operation/review is required. Closing agents is not a prerequisite.

Current model-source **content is not read or validated**. Its current size,
mtime and ctime are deliberately excluded from the administrative RAW projection,
including when a cache is rewritten in place. Expected hashes in the manifest
are historical registered values committed by the complete preimage; they are not
claims about current bytes or reconstructed original provider-file contents.
Current unsafe mode/uid/link/type/path and extra identity drift deny. This omission
is confined to model-source metadata: marker, manifests, intent/receipt, evidence,
DB/WAL and other recovery records retain their existing size/time/hash freshness.
The full native review declares these limits and the exact historical/current
identity difference. Existing 300-second session, post-click 30-second proof,
phase signatures, keyed revalidation and separate final commit remain intact.

After namespace commit, cleanup-only continuation keeps the existing historical
pre-commit snapshot scope; it does not inspect a future owner's marker or sessions.
No historical approval is promoted into new runtime authority.

## Cross-boot device namespace limitation

The current contract persists `st_dev:st_ino` in the enrollment digest and compares
it across kernel boots. The historical exception authorizes one inode substitution
on the **same device**; it does not authorize a device namespace substitution.
A reboot can leave paths, manifest bytes and inodes unchanged while the current
`st_dev` differs. Such a reservation is unsupported by this contract.

The first typed refusal can occur in
`offline-recovery-files.ts::snapshotOfflineReservation`: the historical member's
manifest identity is compared with its current device/inode before the model-source
preimage check. `offline-recovery.ts::captureRecord` also requires the persisted
evidence copy's complete physical record, and the snapshot's logical projection
contains physical identities in immutable file records and database identities.
Changing only the model-source check cannot make this transaction boot-stable.

A read-only diagnostic may reconstruct the exact frozen preimage with an explicitly
known historical device number, unchanged inode numbers, original manifest bytes
and the already registered historical model-source list. A matching digest explains
the failure; it does not establish that an old device number and a current device
number designate the same persistent volume. Neither schema-1 capsule nor snapshot
records a persistent filesystem/volume identity for that comparison. Never search
for matching inodes, rewrite signed records or accept another identity delta to
force continuation. A changed boot UUID alone does not prove filesystem identity.

This is a lifecycle/identity coupling defect, not a native focus or approval-clock
failure. An injected boot UUID in existing fixture success cases does not simulate
a filesystem device namespace change. The synthetic device-only regressions cover
the typed manifest refusal and same-device proof boundary without changing runtime
acceptance, mounting filesystems or operating on real reservations.

### Shorter normal-flow direction, separate from this reservation

`tauri-terminal-preparation.ts::prepareTauriTerminals` calls
`inspectDesktopAdmission` before non-catalog preparation. The latter intentionally
blocks an offline gate or another owner's global marker. Restarting the app or
creating another profile therefore cannot restore **CLI → model → Open** for a
preserved unknown reservation.

Reuse the current native catalog/selection, Core lifecycle, epoch fencing and
signed retirement. Existing `ManagedTerminalPair::prepareRetire`/`retire` requires
live ownership and confirmed exits for every dispatched attempt. Journal recovery
in `terminal-journal.ts` changes interrupted live records to `ownership_lost` and
retains their capacity; it is not a legacy reservation release path.

The recommended future correction is to keep persistent Workspace/Feature/Pane
metadata and passive CLI/model selection independent of prior runtime possession,
and scope runtime admission/physical freshness to the actual owned runtime and
boot. Mutable catalog/config-file inodes should not become persistent runtime
identity. Core start still needs explicit authority and truthful capacity checks.
This direction requires a reviewed contract change, not a new recovery phase,
another reboot, automatic PID takeover or a bypass of the current gate. It is not
implemented here and does not authorize opening this legacy reservation.

For the existing reservation, preserve all records. A separate reviewed resolution
must decide what historical filesystem identity evidence is actually available, or
explicitly define a different owner-approved archival contract. No such evidence
or authority may be inferred from the reconstructed digest. This delivery offers
no executable workaround or claim that real release is fixed.

## Reference decision

Keep ORQST's existing serializer, bounded no-follow readers, committed DB/WAL
inspection, native anchor and review transport. No upstream code or dependencies
are incorporated. Re-inspected pinned Anywh architecture/agent-host/runtime docs
and [`instanceLock.ts`, `acquireInstanceLock`/`takeLockFile`](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/agentHost/instanceLock.ts):
Node fs/net/crypto and PID liveness, root LICENSE Apache-2.0, no tracked NOTICE.
Its stale-PID takeover does not reconstruct frozen enrollment preimages and is
incompatible with retained unknown administrative ownership. Pinned
[Tucano `router.ts`](https://github.com/eduwxyz/tucano/blob/0501956d127699300209902e889f3e69a0948766/src/core/router.ts)
imports shared language/types and engine types, selects speakers without granting
tools, and supplies no compatible historical filesystem proof (root Apache-2.0;
license evidence remains in the preserved audit). Neither supplies this contract.
No pane/layout/navigation redesign or Overclock source reuse is involved.

For the cross-boot investigation, re-inspect those same pinned documents,
`instanceLock.ts` and Tucano `router.ts`: keep the existing ORQST lifecycle and
selection services. Anywh's non-Linux `takeLockFile` explicitly removes a stale PID
lock and notes a race; importing that behavior would change ORQST's retained-unknown
ownership contract. Its host's independent lifetime is a reference for separating
metadata and runtime, not evidence that ORQST can adopt or release old processes.
Pinned [`agentHost.ts::start`/`restore`](https://github.com/anywh-sh/anywh/blob/546f189c04415c3c5af5f40e3931a0a90b9aba31/relay/src/agentHost/agentHost.ts#L283-L348)
uses Node filesystem, registry/log/process-tree modules and the host socket: start
locks, sweeps prior marked processes and restores metadata as stopped. Keep ORQST;
copying that sweep or treating stopped metadata as an owned exit would violate
the preserved-unknown contract.
The exact pinned root LICENSE files remain Apache-2.0; prior tracked-tree NOTICE
evidence is recorded in the [reuse audit](../research/reuse-first-audit.md). No
upstream source or dependency is incorporated for these diagnostic regressions.

Tests are synthetic disposable files/journals and injected kernel boots. They do
not accept real provider content, native UI, a reboot, installed packaging or any
operation on real AppData. Native app/Cargo/build/real capture are intentionally
outside this source increment.
