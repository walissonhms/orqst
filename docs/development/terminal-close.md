# Close an owned terminal in the V6 Studio

The pane header follows the V6 HTML. Use **−** to hide a pane and its dock chip to
restore the same terminal. Use **× Close terminal** to request native
confirmation for the exact terminal ID. Closing can interrupt work. While the
confirmation is open and after dispatch, the application keeps the selected
terminal bound to its current native document and terminal Core.

Hide only changes layout and revokes input. Detach disconnects a document from
the owned session. Stopping a task remains a separate provider operation. The
close command uses the existing signed owned-process SIGTERM and waits up to
five seconds for exit or nondispatch evidence. A fresh signed SIGKILL is
allowed once after a two-second graceful interval when the same owned attempt
is still running and the graceful stop was acknowledged. If the receipt is
uncertain, the pane and reservation remain available for inspection. A
subsequent review can observe late evidence for the same attempt.

Both terminal Cores fence confirmed closed slots, retain their receipts and
journals, and remove them from the Studio, dock and live message discovery.
Remaining terminals keep their IDs, processes and order. Closing the last
pane retires the cohort's shared admission marker when safe. OpenCode has a
separate leader-exit evidence path that moves the current marker into the
pending namespace when descendant retirement is unavailable.

The current admission format indexes slots by their original positions within
one native owner epoch. Closed indexes are not recycled in that epoch. At the
slot ceiling, the shared reservation requires closing the remaining panes
before a fresh selection can use that capacity. The existing selection latch
clears itself after the correlated whole-cohort close and the native views
are torn down. Reopen reads the current catalog and targets the exact released
member. The new attempt keeps the display number. Historical Feature
membership and journal data retain their UUIDs.

## Findings from source and the retained diagnostic logs

- The production Studio wired the header close callback to minimize. The dock
  and layout showed the same UUID afterward. The two buttons now call separate
  paths, and confirmed close removes the owned view from current presentation.
- The private document-close message called supervisor teardown, which could
  change a running attempt to ownership-lost and release its journal lease.
  Document close now invalidates the broker and applicable communication grant
  while the Core retains supervision and can record exit.
- Hiding another pane reset the active pane and maximization in the native
  layout adapter. The active and maximized pane now survives that transition.
- Slower geometry or polling replies could overwrite a newer Feature snapshot
  and restore stale membership. Studio now adopts metadata generations
  monotonically and bounds rejection retries.
- The retained diag21 stderr showed arrange requests refused on focus or
  answered busy, interleaved with accepted frames. The native JSONL also
  records opening uncertainty and admission capacity refusals. Those events
  do not establish an orphan, a specific resize fault, or stale CLI
  discovery. Sizing, focus, quit and provider selection still need the native
  checks below.

## Owner acceptance on a separate package and profile

Run with the default Node Core, then with the Rust terminal Core enabled.
Keep two disposable owned CLI panes with distinguishable UUIDs.

1. Open a terminal through the installed-provider and model picker. Reopen the
   picker, confirm provider availability matches the scoped catalog, and
   verify the live terminal list shows the same UUID and provider.
2. Hide and restore the pane. Verify the UUID and scrollback survive. Verify
   the same process receives input and real PTY geometry follows split drag,
   maximized and restored sizes.
3. With one pane maximized, hide the other from the tab controls. Verify the
   maximized pane keeps focus and sizing. Switch Features and return.
4. Click **Close terminal**, cancel the sheet, and verify the process still
   runs. Repeat and switch to another app during the sheet. Confirm that the
   stale sheet authorizes no signal.
5. Approve the close while an owned terminal is running. Verify the journal
   records its exit, the closed UUID is no longer in live UI or routing,
   and the other terminal remains interactive with the same UUID. Compare
   process identity using the owned receipt, not a process-name search.
6. With a disposable process that delays SIGTERM, verify uncertain feedback
   leaves the pane and reservation, and that the late receipt can be confirmed
   from a fresh review without a second signal.
7. Close the last Codex or Claude terminal. Verify the retirement archive,
   original journal and active-marker release. Quit and reopen to verify
   fresh admission. Repeat for OpenCode and verify the pending marker, with
   descendant status reported as unknown.
8. Quit with a live peer or a reloaded terminal document. Verify the own
   process references and exit receipts remain available to the Quit flow.
   Observed and externally started processes must remain separate.

See the [private contract](../api/terminal-native.md#confirmed-close-terminal)
and the [pinned reference review](../research/terminal-close.md).
