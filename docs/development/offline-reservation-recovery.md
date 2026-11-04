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

Validation on this isolated worktree: Node 24.22.2; 121 focused synthetic tests
passed (68 new offline cases and 53 existing admission/enrollment/retirement/file
regressions). Root `tsc --noEmit`, whole-tree ESLint, whole-tree Prettier check and
`git diff --check` passed. Shared existing dependencies were linked, not installed
or copied. The pnpm wrapper was unavailable under the selected Node PATH, so these
checks used the existing local binaries directly. Full test suite, builds, Cargo,
resource staging, native UI, actual kernel transitions and provider acceptance
were not run. Final disk observation was about 22 GiB available; no heavy work was
started and no application/runtime data or existing evidence was removed.
