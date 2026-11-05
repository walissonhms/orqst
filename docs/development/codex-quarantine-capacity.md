# Quarantined ownership reservation and capacity decision — 2026-11-04

This record preserves the blocked real Codex attempt. It changes no reservation, root,
journal, receipt or provider state, and it authorizes no new inference. It exists so the
owner can make the pending capacity decision with facts instead of inference.

## Evidence observed (read-only)

The private acceptance root `/private/tmp/orqst-two-agent-reuse-598-v4LTlD/slot-a`
still contains the failed attempt's journal in terminal feature schema **1**:

| Field          | Observed value                                                       |
| -------------- | -------------------------------------------------------------------- |
| attempt state  | `ownership_lost` (1 row, the only row)                               |
| instance       | `589f4e6e-a896-42b2-b7a0-a87b676c7050`                               |
| updated at     | 2026-11-03T02:35:45-0300                                             |
| exit evidence  | none (`exitRecorded: false`; schema 1 has no exit column value here) |
| lifecycle file | none for this attempt (receipts were introduced after it)            |
| owner epoch    | released (`ownerClaimed: false`)                                     |
| capacity       | 1 of 1 per-project slot consumed; 1 of 2 global slots consumed       |

Confirmed with the new read-only inspector:

```bash
pnpm inspect:terminal-capacity --journal \
  /private/tmp/orqst-two-agent-reuse-598-v4LTlD/slot-a/terminal.sqlite
```

It prints the report as JSON and exits `1` while any reservation remains. Opening the
journal with `immutable=1` leaves the database and its `-wal`/`-shm` sidecars byte- and
mtime-unchanged; a journal with pending WAL frames is refused instead of being read
stale. One earlier attempt used a plain read-only SQLite open and updated the empty
`-shm` file's mtime. No journal content, WAL, receipt, provider state or reservation was
written, deleted or reset; the inspector was then corrected and re-verified.

## Why this is still unresolved

The source states the rule and the gap:
[`terminal-journal.ts:39`](../../packages/database/src/terminal-journal.ts) makes
`ownership_lost` terminal (no outgoing transitions), and
[`terminal-journal.ts:131`](../../packages/database/src/terminal-journal.ts) counts it as
active during admission against
[`terminal-capacity.ts:12`](../../packages/protocol/src/terminal-capacity.ts)
(`activeInstances: 2`, `perProject: 1`). Retention deletes only `exited`/`start_failed`
rows, so an `ownership_lost` row is never reclaimed automatically.

No authentic original lifecycle evidence survives for this attempt: it predates the
private lifecycle receipt, has no exit record and no host `exited` journal state. The
following are **not** proof that the process or its descendants exited, and must not be
used as such: absence in `ps`, elapsed time, an empty project directory, a closed
window, startup SQLite files, or a later unrelated process sample. Adopting or signaling
a PID to manufacture a receipt is also forbidden.

Automatic reconciliation is therefore **unavailable for this row**. The existing
receipt-based inspection (`pnpm exec tsx scripts/inspect-codex-lifecycle.ts`) can read a
_future_ attempt's receipt, and even a valid recorded exit there releases no capacity by
design; it cannot retroactively repair this reservation.

## Re-verification and durable storage — 2026-11-04 21:47 -03

The recorded root `/private/tmp/orqst-two-agent-reuse-598-v4LTlD` no longer existed
at this re-verification. `ls`, a bounded `find` over the temporary and home trees,
and Spotlight returned no copy, and no `terminal.sqlite` for that instance was found
under the application support directory. `/private/tmp` is the system temporary
location; an environment restart between the original inspection and this one
cleared it. No journal, WAL, receipt or reservation could therefore be re-read.

The table above remains the last recorded evidence. This note does not reconstruct,
reconcile, release, delete or replace anything, and it does not assert that the
original process exited. Consequences:

- Automatic reconciliation remains unavailable, now for two independent reasons:
  the original host version wrote no independent exit receipt, and the original
  bytes are no longer present on this machine.
- The source-level kernel-fenced offline recovery cannot capture a source that no
  longer exists. It does not unblock this row and is not a substitute for evidence.
- Only the capacity decision below remains. The exact reserved capacity numbers are
  those previously recorded, not a fresh measurement.

To prevent recurrence, `scripts/accept-codex-two-agent.ts` now refuses an
acceptance root inside `os.tmpdir()`, `/tmp` or `/private/tmp`; see
`assertDurableAcceptanceRoot`. Synthetic fixtures may remain disposable, but a real
reservation, journal, manifest and lifecycle receipt require an owner-approved
durable path. This is a storage-safety guard, not a capacity release or a new
admission policy.

## Options for the owner

| #   | Option                                                                                                     | Effect                                                             | Risk / limitation                                                                                                                                                                                                  |
| --- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A   | Declare this root quarantined and authorize one fresh empty root for the next reviewed attempt             | Unblocks the next attempt; quarantine evidence stays untouched     | Capacity is not "released"; it is bypassed for a new project. Requires an explicit, recorded owner decision and a new project id.                                                                                  |
| B   | Keep the reservation and postpone all further real two-agent attempts                                      | Nothing is bypassed; strongest evidence posture                    | Criteria 9/10/12 stay blocked; no real provider verification of the pair workflow.                                                                                                                                 |
| C   | Design and authorize a reviewed capacity-disposition feature (e.g. owner-signed disposition of a lost row) | Would let a future policy reclaim capacity with auditable evidence | Not available for this row: its original bytes are now absent, and the source-level offline recovery cannot capture absent evidence. A future feature still needs an authentic receipt and reviewer authorization. |

Option A is the only path that unblocks the pair test without weakening evidence, and it
still requires the owner's explicit decision. Raising `perProject`/`activeInstances`,
deleting the row, rewriting it as `exited`, or using another root silently are **not**
acceptable substitutes: they either falsify lifecycle evidence or hide the reservation.

## Exact human decision required

The originally proposed statement named a root that no longer exists. The surviving
decision is:

> I acknowledge that the failed attempt's reservation
> `589f4e6e-a896-42b2-b7a0-a87b676c7050` is **not released** and that its original
> journal can no longer be re-inspected because it was stored under the system
> temporary directory. I choose **(A)** to treat that attempt as permanently
> quarantined without physical re-inspection and authorize **one new empty durable
> root** at an owner-approved path with a new project directory for the next reviewed
> Codex↔OpenCode acceptance, accepting that its capacity is separate rather than
> reclaimed; or **(B)** to postpone all further real two-agent attempts.
> In either case the admission policy stays `activeInstances: 2`, `perProject: 1`,
> with `ownership_lost` counting as active until a separately reviewed disposition
> feature exists.

Short question: **A or B — and if A, which durable absolute path may hold the new
root?** Without that answer, only synthetic and no-credential/no-inference work may
continue.

## Prepared Codex↔OpenCode gates (not started)

The pair workflow itself is already documented in
[the reviewed pair guide](codex-opencode-pair.md); this is the gate list that must be
satisfied before any real inference, in this order:

1. Owner decision above, recorded.
2. A new empty **durable** root (never `os.tmpdir()`, `/tmp` or `/private/tmp`) plus
   two unused private manifests (one Codex, one OpenCode) with exact installed native
   binaries, hashes, versions and separate state directories.
3. OpenCode's separate startup, database-migration and native-activity acknowledgments
   reviewed and explicitly accepted; a blocked manifest blocks the whole runtime.
4. Native per-provider Start consent observed in the native UI for each slot, then
   separate output attach and optional keyboard input; no intercepted dialog.
5. Shared-config/session acknowledgment for Codex and the OpenCode native effects review
   retained; no credential is read, copied or migrated.
6. MCP opt-ins prepared in both manifests and the separate one-use task grant reviewed;
   startup permission is never treated as a task grant.
7. Advisory cost acceptance and the exact model recorded; a failure stops the run with
   no fallback, retry, provider substitution or new login.
8. After the run: native Stop for each slot, then capacity and receipt inspection with
   the read-only tools. An owned TUI exit does not prove descendant exit; retirement and
   capacity stay reserved unless authentic evidence says otherwise.

Synthetic gates that can run here today, without credentials or inference:
`pnpm exec tsx --test tests/tauri-native-window.test.ts
tests/terminal-capacity-inspection.test.ts tests/two-agent-acceptance.test.ts
tests/codex-lifecycle-receipt.test.ts` and
`pnpm accept:terminal-team --authorize-synthetic-pty --mixed-codex-opencode`
(the latter uses synthetic CLIs only).

Nothing in this increment started a provider, opened a login, sent a message, created a
root or authorized the pair test. Re-verification only checked whether the recorded
path existed; it opened no journal (the path was absent) and wrote no reservation.
