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
component takes separate Reopen, Remove from Feature and View details
callbacks. Reopen and removal callbacks require the Core's stable display
identity and a verified disposition. The current compatibility view shows
saved IDs and the explicit uncertainty state. Its Remove from view control
is presentation-only. Durable historical metadata, same-ID reopen and
Feature removal require Core support. Existing native recovery remains
the authority for uncertain ownership.

## Render and timing evidence

The screenshots use the ORQST dashboard with a synthetic native bridge.
The fixture holds the native reply until the starting card is visible and
then issues a catalog-changed refusal. The approved V6 HTML files are
captured at the same viewports.

| State              | 1440 × 900                            | 1280 × 800                            |
| ------------------ | ------------------------------------- | ------------------------------------- |
| Starting           | [Starting](starting-1440.png)         | [Starting](starting-1280.png)         |
| Failed             | [Catalog changed](failed-1440.png)    | [Catalog changed](failed-1280.png)    |
| Ended              | [Ended and uncertain](ended-1440.png) | [Ended and uncertain](ended-1280.png) |
| Approved reference | [V6 HTML](v6-1440.png)                | [V6 HTML](v6-1280.png)                |

Live native traces now mark `first_pty_output: ready` on the same
bounded attempt as the dispatched `cli_opening`. This measures the
first output received over the broker. WebView paint and live provider
latency require a fresh tracked Preview session. Diag25 emitted no
`cli_opening`, `review`, `commit`, or `opening: ready` records in
its session window. See the
[preparation measurements](../diag25-terminal-availability.md#reproducing-the-preparation-measurement).
