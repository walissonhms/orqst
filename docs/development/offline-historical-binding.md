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

Tests are synthetic disposable files/journals and injected kernel boots. They do
not accept real provider content, native UI, a reboot, installed packaging or any
operation on real AppData. Native app/Cargo/build/real capture are intentionally
outside this source increment.
