# Studio terminal tabs and minimized state

## Native workspace controls — 2026-11-05

The retained Tauri workspace has a permanent terminal tab strip below its compact
header. A tab selects a single-pane view; Restore or Grid returns to the existing
split layout. It does not replace a document, restart a CLI or restore keyboard
authority. Add opens the existing scoped native preparation drawer. The current
bounded selection/enrollment ceiling remains eight terminals.

The selected tab exposes Rename, Move earlier/later, Minimize and Maximize/Restore.
Double-click or F2 opens the name editor in the sidebar. Dragging a tab reorders
the existing panes; Alt+Left/Right is the keyboard alternative. These shortcuts
are attached to tabs, never intercepted from the CLI. Names are plain display
text, not mention handles or process identity. Commands bind the slot to the exact
current Core terminal UUID and current Feature membership.

The bottom dock occupies the reserved 34px footer. Only explicitly minimized
members of the selected Feature appear there. A pane behind a maximized sibling
or on a different compact page is not minimized. Rename, reorder, resize and Grid
preserve the minimized set. Restore all is the explicit action that re-shows all
current members. An all-minimized workspace stays empty until an explicit restore.
The native Feature permissions panel is a sidebar disclosure, not an additional
implicit grid row that steals terminal/footer space.

Chrome reserves 45px for the header and 36px for tabs; Node and Rust agree on the
81px top inset. Desktop paging keeps a 320px minimum pane height, allowing four
panes in a 1440×900 two-column workspace. Content widths at or below 720px use
one visible pane. Bounds continue to be validated natively before presentation.

## Communication remains a separate runtime capability

Ordinary individually prepared terminals still have ORQST MCP disabled. Display
names, tabs, roles and Feature permissions cannot grant delegation. The existing
experimental Codex/OpenCode pair and structured managed-agent composition retain
their separate native reviews and provider acceptance requirements. This change
does not enable N-member interactive MCP, `@handle` routing, a natural-language
planner, task/result delivery or a graph of real delegations. Floating geometry
and cross-document header dragging also remain pending; tab drag is implemented.

## Executable verification

```sh
pnpm exec tsx scripts/accept-terminal-workspace-ui.ts --authorize-synthetic-workspace-ui
```

This explicit renderer-only check uses the actual layout controller with synthetic
metadata and intercepted browser resources. It exercises four tabs, focus,
minimize/Grid/rename/drag/keyboard reorder, dock restoration, exact native
preparation scope navigation and footer bounds at 1440×900, 720×700, 390×600 and
320×600 in English and Portuguese. Captures under `dist/accept-terminal-workspace-ui`
contain no live terminals. Separate Node tests use a disposable Core metadata
database to reject wrong UUIDs, foreign Feature members and process operations.
Rust tests cover strict request parsing, geometry and the closed display projection.

These checks do not establish AppKit focus, WebKit sibling stacking, real PTY
retention, provider authentication/usage or native owner acceptance. Test the matching
packaged native executable and resources together. Preserve an open older package
and leave user terminal shutdown to the normal Quit workflow.

See the [source and reuse decision](../research/studio-terminal-workspace.md) and
[native contract](../api/terminal-native.md#workspace-view-commands--2026-11-05).
