# Tracker fragment — native window evidence, quarantine capacity, publishing — 2026-11-04

Integration fragment for `docs/architecture/master-spec-tracker.md`. Paste the sections
below; do not edit the preserved rows above them. Prepared from `57f711e`; rebase/merge
as needed, and keep any newer integration rows another agent added.

## Cross-cutting blockers — replace the real-provider bullet

Replace the first paragraph's "The owner must decide an explicit quarantine/capacity
policy." with:

> The owner must decide an explicit quarantine/capacity policy. The reservation is
> confirmed present and read-only in
> `/private/tmp/orqst-two-agent-reuse-598-v4LTlD/slot-a/terminal.sqlite`
> (`ownership_lost`, no exit evidence, no lifecycle receipt, 1/1 per-project capacity
> consumed). `pnpm inspect:terminal-capacity --journal <absolute path>` reports it
> without releasing anything. Options, risks and the exact owner statement needed are in
> [quarantine and capacity](../development/codex-quarantine-capacity.md).

## New dated section after "Terminal retirement and MCP integration — 2026-11-04"

```markdown
## Native window evidence and capacity inspection — 2026-11-04

The native coexistence runner now records read-only WindowServer metadata for the
process it owns (`scripts/tauri/native-window-probe.swift`,
`scripts/tauri/native-window.ts`). `window.json` distinguishes `window-observed`,
`window-exists-offscreen`, `no-window`, `process-exited`, `probe-invalid` and
`probe-unavailable`; a missing window ends only the owned child and fails the run
instead of leaving `cgWindowNotFound` unexplained. The probe captures no pixels,
titles, paths or environment, needs no TCC grant and is not an automation capability.
`tests/tauri-native-window.test.ts` covers parsing, retry, deadline and refusal paths
with injected samples.

The quarantined real attempt was inspected read-only with
`pnpm inspect:terminal-capacity`: one `ownership_lost` reservation, no exit evidence,
no lifecycle receipt, owner epoch released, 1/1 per-project and 1/2 global capacity
consumed. Inspection uses an immutable SQLite read and leaves journal/WAL/shm unchanged;
a journal with pending WAL frames is refused. No reservation, root, journal or receipt
was released, rewritten or deleted.

Native acceptance remains unaccepted: this checkout has no Rust toolchain and the
volume had ~5.9 GiB free, so no Tauri build or native dialog/input/lifecycle run was
possible here. `cgWindowNotFound` stays unproved until `window.json` is produced by a
real run. See [the workflow](../development/tauri-native-coexistence.md#windowserver-evidence-probe-2026-11-04),
[quarantine](../development/codex-quarantine-capacity.md) and
[publishing](../development/repository-publishing.md).
```

## Verification log row

```markdown
| 2026-11-04 | `tsx --test tests/tauri-native-window.test.ts tests/tauri-coexistence-preflight.test.ts`: 9 passed; `tsx --test tests/terminal-capacity-inspection.test.ts`: 7 passed; `tsc --noEmit`, ESLint and Prettier on the changed files passed. Probe compiled with `swiftc` and validated against a disposable AppKit fixture (on-screen and ordered-out). | Synthetic WindowServer samples and a disposable fixture only; no Tauri build, native dialog/input/lifecycle acceptance or real provider ran. |
```

## Required scenario checklist

No scenario is newly accepted. Two evidence rows apply to the existing items:

```markdown
- [ ] `window.json` = `window-observed` for the owned native PID before any native
      interaction; record bounds/layer/on-screen.
- [ ] Quarantine decision recorded before the next real pair attempt; capacity reported
      by `pnpm inspect:terminal-capacity`, never inferred or silently reclaimed.
```

## Acceptance criteria table

- Row 16 (documentation and tests): mention that the native window probe and the
  read-only capacity inspection now exist, but keep **Partial**; no human/native test ran.
- Rows 3, 5, 6, 8, 14, 16 stay **Partial**; row 9 stays **Blocked** pending the owner's
  quarantine/capacity decision quoted above.
- Add the unproven focus race to the native blockers: the post-dialog confirmation in
  `terminal.rs` samples `focused()` once right after sheet dismissal, which may deny a
  real consent. The decisive focus timeline and a bounded re-check proposal are in
  [native coexistence](../development/tauri-native-coexistence.md#focus-after-a-native-dialog-leading-hypothesis-unproven);
  nothing was applied or compiled without a Rust toolchain.

## Security model (suggested one-line addition)

> Journal capacity/quarantine inspection is developer-only, opens the selected
> `terminal.sqlite` immutably (no locks, no WAL/shm writes, no checkpoint), reads only
> allowlisted attempt metadata, refuses symlinks, world/group-writable paths and
> pending WAL frames, and never acquires the journal owner epoch or changes capacity.
