# Structured Codex lifecycle receipts — 2026-11-03

The explicit structured native backend now creates a private, exclusive
`lifecycle-<instanceId>.jsonl` in its existing state directory before forking its
host. This is implemented for **future structured starts only**. The observer,
Bridge, dashboard and legacy PTY host do not create or consume these receipts.
No real provider has validated this increment. The earlier ownership-lost attempt
has no such receipt and remains unresolved; this change cannot reconstruct it.

## Persistence and identity

The parent writes a version-1 `prepared` header containing the instance ID, original
authority epoch, signed manifest digest, config-file digest and metadata timestamp.
It uses `O_EXCL`, `O_NOFOLLOW`, mode `0600`, file `fsync` and directory `fsync` in
the existing canonical private directory. Any failure stops dispatch and preserves
the partial file. Only the open descriptor is inherited at fd 4; the host never
chooses or reopens a receipt path. The provider does not inherit this descriptor.

The host checks the header/config digest and synchronously syncs `armed` before spawning its
pinned executable. It then serializes asynchronous writes and syncs of `started` and `exit` before sending the
corresponding lifecycle IPC. A spawn error may instead append `spawn_failed`;
that record is not an exit. An exit contains the direct child's actual nullable
numeric code and nullable signal name. A signal-only exit never becomes code zero.
Lifecycle IPC carries required `lifecycleVersion: 1`; stale hosts without it fail
closed rather than silently claiming this new persistence contract. Rebuild the
standalone host together with Core. IPC disconnection revokes controls but does not suppress durable lifecycle writes
or change the original 30-minute lifetime and five-second escalation policy.

Post-spawn receipt I/O uses callbacks/promises so slow disk I/O does not block
the event loop that runs the original TERM/KILL timers. A persistence failure
after spawn reports lost transport when possible and keeps
the owned deadline. It does not manufacture a successful exit, retry a record or
terminate the host prematurely. Missing/partial receipts, host death, power loss
or storage failure remain uncertain. `fsync` is not a guarantee against defective
hardware, blocked filesystem calls or hostile same-user modifications. This is
native same-user evidence, not a cryptographically authenticated attestation.

Each file has at most four newline-terminated records and a 4 KiB budget. It stores
no PID, provider content, paths, argv, environment, credentials, prompts or grants.
Files are not automatically pruned: runtime/journal attempt limits still apply,
but this is not a disk quota or a machine-wide reservation service.

## Read-only recovery inspection

Use only a specifically selected **future** receipt with its independently retained
start identity. Do not discover identity by trusting the file you intend to check.
The manifest digest and epoch are in the start challenge; `manifest.configDigest`
is the signed SHA-256 of that attempt's explicit managed config file. Retain the
prepared manifest/challenge through the authorized caller before launch. Never hash
credentials or reconstruct expected identity from a suspect receipt.

```bash
pnpm exec tsx scripts/inspect-codex-lifecycle.ts \
  --state /absolute/private/future-slot \
  --instance <instance-uuid> --epoch <original-epoch-uuid> \
  --manifest-sha256 <signed-start-digest> --config-sha256 <config-file-digest>
```

The command only reads the selected receipt. It never opens SQLite, reads provider
state, starts a provider, adopts a PID, sends signals or acquires an owner epoch.
It rejects symlinks, hard links, nonprivate/nonregular files, excess bytes,
malformed/truncated records, identity mismatch and invalid ordering/timestamps.
It returns `recorded_exit`, `incomplete`, `missing` or `invalid`; only the first has
exit status zero. Missing/invalid evidence conveys no process state. Recorded exit
proves neither task success nor descendant cleanup.

**No receipt changes a journal or releases capacity.** Existing `ownership_lost`
rows remain terminal and reserved, including when a valid future receipt contains
an exit. Restart still fails closed on an occupied journal; no automatic resume,
readoption, retry or reconciliation is implemented. Review receipt provenance and
unresolved capacity separately before authorizing any future execution. A fresh
root is not permission to bypass an existing reservation. If a host dies before
recording exit, preserve quarantine and postpone further execution unless the owner
explicitly approves a reviewed capacity disposition; do not infer exit from time
or OS process absence.

The private terminal journal's feature schema is now version 2. Under the existing
owner/fencing transaction it upgrades version 1 by changing only the feature-version
marker; old attempt metadata stays unchanged. Failed admission rolls that upgrade
back. Observer schema/version is unchanged. Older journal writers reject version 2.
For a still-owned future handle, numeric or signal-only IPC exit can transition to
`exited`; callbacks after ownership loss remain ignored.

## Validation scope

`tests/codex-lifecycle-receipt.test.ts` uses private disposable files/databases and,
on macOS arm64, builds the actual host plus an owned native C fixture that exits by
its own signal after IPC disconnect. No provider, login, credentials, inference,
existing acceptance state or concurrent service is involved. Corruption, identity,
write failure, exclusivity and retained lost capacity are covered. Journal tests
cover the version upgrade, rollback/fencing and signal-only restart persistence.
Legacy PTY durability, real-provider acceptance and arbitrary descendant containment
remain separate unvalidated work.
