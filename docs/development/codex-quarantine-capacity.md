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

## Options for the owner

| #   | Option                                                                                                     | Effect                                                             | Risk / limitation                                                                                                                         |
| --- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| A   | Declare this root quarantined and authorize one fresh empty root for the next reviewed attempt             | Unblocks the next attempt; quarantine evidence stays untouched     | Capacity is not "released"; it is bypassed for a new project. Requires an explicit, recorded owner decision and a new project id.         |
| B   | Keep the reservation and postpone all further real two-agent attempts                                      | Nothing is bypassed; strongest evidence posture                    | Criteria 9/10/12 stay blocked; no real provider verification of the pair workflow.                                                        |
| C   | Design and authorize a reviewed capacity-disposition feature (e.g. owner-signed disposition of a lost row) | Would let a future policy reclaim capacity with auditable evidence | New privileged write path and migration; cannot be retrofitted to this row without an authentic exit receipt, so it does not unblock now. |

Option A is the only path that unblocks the pair test without weakening evidence, and it
still requires the owner's explicit decision. Raising `perProject`/`activeInstances`,
deleting the row, rewriting it as `exited`, or using another root silently are **not**
acceptable substitutes: they either falsify lifecycle evidence or hide the reservation.

## Exact human decision required

> I authorize ORQST to treat private root
> `/private/tmp/orqst-two-agent-reuse-598-v4LTlD` as **quarantined and permanently
> retained**, including its `ownership_lost` reservation
> `589f4e6e-a896-42b2-b7a0-a87b676c7050`, which is not released, rewritten or deleted.
> For the next reviewed Codex↔OpenCode acceptance I authorize **one new empty private
> root** with a new project directory, and I accept that its capacity is separate rather
> than reclaimed. I also confirm the admission policy stays `activeInstances: 2`,
> `perProject: 1`, with `ownership_lost` counting as active until a separately reviewed
> disposition feature exists.

Without that statement (or an explicit alternative), only synthetic and
no-credential/no-inference work may continue.

## Prepared Codex↔OpenCode gates (not started)

The pair workflow itself is already documented in
[the reviewed pair guide](codex-opencode-pair.md); this is the gate list that must be
satisfied before any real inference, in this order:

1. Owner decision above, recorded.
2. A new empty root plus two unused private manifests (one Codex, one OpenCode) with
   exact installed native binaries, hashes, versions and separate state directories.
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
root, touched the quarantine or authorized the pair test.
