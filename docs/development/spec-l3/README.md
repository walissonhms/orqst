# Terminal lifecycle integration

L2 can mount `useTerminalLifecycle(workspaceId, featureId, native)` once in
the Studio shell. The hook warms the scoped picker cache and returns
`TerminalOpenCard[]`. Render these cards synchronously while the native
request is pending. Use the request `id` as the React key until a
`terminalId` comes back. When the native slot arrives, use the matching
request key and place the native PTY in that card. Enrollment leaves the
card in `starting`.

Consume `useOwnedPaneEvidence()` by native terminal ID and pass the result
of `projectPaneLifecycle` as the `lifecycle: PaneLifecycle` prop to
`PaneCard`. `PaneLifecycleStatus` and `PaneLifecycleContent` can render
the state and applicable actions. A first-output receipt proves a live PTY.
A live pane remains interactive in `unknown` until the adapter supplies
prompt or current-turn evidence.

Use `requestTerminalRetry(card)` before reopening the normal picker. A
known refusal refreshes the catalog and retains the card key. The user
confirms a new native request. A possible-effect failure keeps the review
code and disables retry. The logs control shows the bounded attempt
outcome code.

Mount `EndedTerminalList` at the end of the L2 dock. Pass persisted entries
and matching owned-slot evidence through `reconcileEndedTerminals`. The
component takes separate Reopen and Remove from Feature callbacks. Uncertain
rows offer View details and show the original terminal UUID and the steps for
the [dedicated native recovery mode](../offline-native-recovery.md#operator-sequence-for-a-subsequently-reviewed-package).
An operator enters that mode explicitly. The row itself cannot authenticate
a process, switch applications, free capacity or signal a process. The
existing administrative helper releases only reservations for which it
proves non-dispatch. Other historical rows stay uncertain. An administrative
reservation receipt is separate from a per-member Feature release receipt.

The Feature database allocates a workspace-wide, monotonic `T-###`. A fenced
owned close or completed cohort retirement records the physical terminal manifest and Core epoch. Reopen
validates the previous CLI/model/project, creates a new physical manifest and
journal, and moves the Feature assignment and saved display name to it while
preserving the display ID and saved Team handle. The replacement gets no
previously authorized communication edges. The retired UUID remains in the ledger.
Remove from Feature uses an exact Feature revision and a verified release.
It removes the current assignment and preserves the display ledger, journals
and previous layout. Remove from view remains a local presentation action.
Reopening also needs an available native slot. A full append-only native
pool needs a fresh verified Core lifetime before it can admit a replacement.

A native batch posts independent signed start requests for the admitted slots
with an already allowed CLI policy. Launch approval binds the private native
gesture, current slot and one-shot Core start challenge. Output attachment and
input still use the focused document path. A blocked, changed or unavailable
CLI policy uses the existing foreground checks and review. The CLI hash pins
are unchanged. An Antigravity executable mismatch has its own localized
review-required copy.

## Render and timing evidence

The screenshots use the ORQST dashboard with a synthetic native bridge.
The fixture holds the native reply until the starting card is visible and
then issues a catalog-changed refusal. The approved V6 HTML files are
captured at the same viewports.

The final Chromium run measured 9 ms from submit to the starting card in
the DOM, with the native reply still held by the fixture.

| State              | 1440 × 900                                    | 1280 × 800                            |
| ------------------ | --------------------------------------------- | ------------------------------------- |
| Starting           | [Starting](starting-1440.png)                 | [Starting](starting-1280.png)         |
| Failed             | [Catalog changed](failed-1440.png)            | [Catalog changed](failed-1280.png)    |
| Ended              | [Ended and uncertain](ended-1440.png)         | [Ended and uncertain](ended-1280.png) |
| Recovery details   | [Kernel recovery guidance](recovery-1440.png) | —                                     |
| Approved reference | [V6 HTML](v6-1440.png)                        | [V6 HTML](v6-1280.png)                |

Native diagnostics emit one `first_pty_output` / `ready` entry per member
at the first validated, nonempty broker read for that member. Its
`elapsed_ms` starts at the batch submit's native request and includes the
time until the WebView requests the bytes. The timestamp excludes paint,
and panes never read are absent from the sample. The diagnostic ID
correlates with that member's initial `cli_opening`; only elapsed time
and bounded status labels are recorded.

For the next Preview on the owner's Mac, take a clean window of
`native.jsonl`, exercise the three CLIs and record the number of submitted
members and observed first frames. For a window with comparable runs and
proven sample coverage, calculate nearest-rank p95 with:

```sh
jq -s --argjson start "$START_MS" --argjson end "$END_MS" '
  map(select(.unix_ms >= $start and .unix_ms <= $end
    and .stage == "first_pty_output" and .outcome == "ready"))
  | unique_by(.attempt) | map(.elapsed_ms) | sort
  | {n: length, p95_ms: (if length == 0 then null else .[((length * 0.95) | ceil) - 1] end)}
' "$HOME/Library/Application Support/dev.orqst.desktop.preview/diagnostics/native.jsonl"
```

Diag25 emitted no `cli_opening`, `review`, `commit` or `opening: ready`
records in its session window. A live before/after p95 cannot be inferred
from those traces. The isolated preparation measurements are recorded
separately. [Diag25 measurements](../diag25-terminal-availability.md#reproducing-the-preparation-measurement)
