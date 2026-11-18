# V6 Studio Workspace and Feature tree

The Lane 2 branch is based on `263c88183faf711fba1d7861f6c5097aab720599`.
The approved mockup and the before captures are in audit commit
`9c4719b96d71a5469c910c140f47e8fd8c4f40c2` under
`docs/development/v6-parity/{1440x900,1280x800}/{approved,tauri-chrome}/`.
After captures use production React chrome, a Chromium test fixture, and
synthetic Core snapshots with seven stable terminal IDs. Native PTY holes are
empty. Fixture requests simulate Core replies without launching a provider.

## Comparison

| Case                           | Approved and before                    | After at both sizes                                                                                                                                                                                                                           |
| ------------------------------ | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Initial view                   | `approved/01`, `tauri-chrome/11`       | `01-four-panes.png`. The tree measures 155 px. The sole header measures 45 px, and the first pane starts at (159, 49).                                                                                                                        |
| Two, one, zero and return      | `approved/24–28`, `tauri-chrome/12–15` | `02-two-panes.png` through `05-return-four.png`. The fixture changes the four-pane Feature to columns before switching and compares the returned pane IDs and rectangles. Lane 3 owns partial-grid placeholders and pane spacing.             |
| Terminal creation              | `approved/29–30`                       | The one header action sends the selected Workspace, Feature and view revision through the existing preparation facade. The fixture covers a refusal. Lane 4 owns the guided dialog and creation evidence.                                     |
| Feature and Workspace creation | `approved/31–32`, `tauri-chrome/16–17` | `06-feature-create.png` through `09-archive-refused.png`. A uniquely identified Feature in the accepted create reply is selected through a revisioned request. Workspace creation and the observer-only Workspace explain their availability. |
| Canvas                         | `tauri-chrome/18`                      | `10-canvas.png` and `11-workspace-landing.png`. Canvas is under Feature options. The same tree remains available and returning to Studio uses a geometry frame.                                                                               |

## Authority and integration

- **Lane 1** can keep passing the observer Workspace catalog and renderer navigation
  through `StudioWorkspace`. This native contract publishes one managed Workspace.
  The other entries show an unknown Feature count and explain the scope limit.
  The new strings are grouped under `feature` in both locales.
- **Lane 3** owns the final native geometry contract, pane/dock visuals and native
  keyboard focus. The current allowlist accepts a 47 px top inset and a 38 px
  footer. Lane 2 renders the approved 45 px header and converts each measured
  PTY hole to the allowed native origin. A revisioned Core selection preserves
  retained pane documents and their saved active slot. Renderer focus restores
  the last focused terminal control by ID. In native chrome, keyboard focus
  returns to the selected tree item. Native keyboard input requires the existing
  native focus and authority path.
- **Lane 4** keeps the `onPrepare` composition point and signed drawer request.
  The scoped `onMention` integration still reports the existing Core receipt.
  Delegation opens the existing structured review panel when the scoped facility
  is present. Otherwise the header action explains why it is unavailable.
  The unassigned view keeps the structured entry under Feature options, with
  the existing Core-reviewed selection of the default Feature.
- **Lane 5** can use the existing Account Limits composition in the shared
  action row. Its changes to account data and overlay behavior stay with that lane.

The renderer keeps each scope's existing Studio arrangement key, discards
out-of-scope frame retries, and waits for authoritative selection replies.
Switches do not issue pane lifecycle or layout commands. The options disclosure
retains Canvas, available/unassigned member metadata and the signed permission
panel.

## Reference research

The prior [V6 foundation audit](../../../research/v6-feature-foundation.md)
records the same domain boundary and its licenses. This lane checked
[Anywh `4f8aef7` session grouping](https://github.com/anywh-sh/anywh/blob/4f8aef7b5f0dc9cf0832e457c224dc09a9792a21/client/src/lib/format/sessionGrouping.ts)
and its runtime documentation. Folder grouping is a client projection and cannot
supply a managed Feature catalog or revisioned layout selection.
[Tucano `4522704` routing](https://github.com/eduwxyz/tucano/blob/4522704ecdcb2d51d7ad4ea002375dcfe8d447be/src/core/router.ts)
selects conversation speakers within its own agent model. It does not supply a
native gesture, Core scope or view revision. Both inspected trees have Apache-2.0
root licenses and no NOTICE file observed in the inspected trees. This lane
retains the ORQST metadata and presentation contracts. The approved HTML governs
visuals. No external source, dependency or visual asset was incorporated.

## Checks

The five `studio-workspace.spec.ts` Chromium cases passed with `--workers=1`,
including both capture sizes, renderer focus return, compact widths and
preparation refusal in English and Portuguese. The separate Studio suite still
has one failing legacy browser-availability copy assertion in
`studio.spec.ts`. The dashboard build passed with Vite's existing
chunk-size advisory.

The full `pnpm test` run reported 1,342 tests, with 1,316 passed, 25 failed and
one cancelled. Its Studio tests in `tests/studio-native.test.ts` and
`tests/always-in-feature.test.ts` still expect the pre-V6 zero-width sidebar
and horizontal Feature tabs respectively. The remaining failures included
Analytics 504 replies and synthetic authority, writer, and Tauri-file fixtures.
The Tauri-file fixture retained seven test listeners and the offline reservation
fixture was still running after the suite reached 30 minutes. Both disposable
test workers were terminated. Tauri build and launch, live PTY input, native
keyboard focus and owner acceptance are outside this evidence.
