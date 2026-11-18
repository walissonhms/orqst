# Lane 3 · Studio pane contract

Lane 2 owns the breadcrumb composition. Pass `v6={{ featureName, layoutControlsRef, onRename, onEditAlias, onDuplicateConfig }}` to `TerminalStudio` and leave `toolbarStart` and `toolbarEnd` as the single row. `layoutControlsRef` is `useRef<StudioLayoutControls>(null)`. Grade calls `layoutControlsRef.current?.toggleGrid()` and Restore calls `layoutControlsRef.current?.restore()`. The toolbar remains the measured 45 px row. Extra arrangements are in each pane menu. Remove the interim Grade popover and its overlay flag. Keep the component keyed by the actual Workspace/Feature scope.

Use `nativeChrome(false, window.innerWidth, 'v6')` directly. It supplies the 155/46 px sidebar, 45 px header and 33 px footer. The rectangle passed to `onLayout` already has the 4 px stage offset. Remove the temporary Y translation. Keep the existing current scope checks and send the mode emitted by the Studio. Mixed tiled and floating panes use the existing native `free` overlap contract.

`StudioTerminal.alias` is optional, display-only metadata from the current scope. `onEditAlias(id)` opens a host-owned editor when the host has a real alias mutation. `onRename(id)` can use the current scoped native rename. `onDuplicateConfig(draft)` opens the Lane 4 reviewed creator with provider, selected model (including explicit CLI default), name and source terminal ID. It receives no session, process, credentials or alias. Leave an unsupported callback absent. `onCloseTerminal(id)` stays on the existing native confirmed close route. View-only actions and process actions remain distinct.

Before screenshots are on `origin/docs/v6-parity-audit` under `docs/development/v6-parity/{1440x900,1280x800}/{approved,tauri-chrome}`. Files in this folder are Chromium with synthetic identities and reserved PTY holes. Actual provider resize, AppKit stacking and the OS confirmation sheet still require native acceptance.

Lane 1 owns the shared locale files. Merge the provided `en-US.json` and
`pt-BR.json` fragments into their matching dictionaries. The standalone
renderer supplies equivalent i18next defaults until the shared dictionaries
arrive.

The existing separated native process/view dispatch comes from
`5f661b7` and its corrected allowlist `8ec55aa`. Lane 3 keeps that
dispatch and adapts the scoped minimized projection from `f31fd8c`.
When a floating pane's controls intersect a lower native PTY, the renderer
temporarily yields that PTY's rectangle. The same document remains retained
and returns at its original dimensions when the overlap clears. This keeps
the floating header and resize handle reachable with sibling WebViews.

The PTY host ships scoped names and stable IDs. Its current facade has no
editable mention-alias receipt and the creation flow is owned by Lane 4.
The contract leaves alias editing and duplication unavailable whenever the
host omits those callbacks. The Chromium fixture exercises the duplicate
draft boundary without launching another terminal.

## Chromium comparison

| Element                             | Approved HTML     | Audit baseline                  | Lane 3 facade                        |
| ----------------------------------- | ----------------- | ------------------------------- | ------------------------------------ |
| First card at 1440×900 and 1280×800 | (159, 49)         | (12, 59) with clean preferences | (159, 49)                            |
| Header, stage insets, drag dividers | 31 / 4 / 5 px     | 32 / 12 / 8 px                  | 31 / 4 / 5 px                        |
| Minimized dock                      | 33 px             | 38 px                           | 33 px                                |
| Layout entry                        | Grade and Restore | Six permanent modes             | Grade and Restore in the host row    |
| Pane menu                           | 215 px            | Wide details and layouts        | 215 px with separate view operations |

Each after folder contains the corresponding grid, columns, restore, resize,
swap, menu, details, float, move/resize, float menu, maximize, minimize, restore,
duplicate-configuration boundary and role captures.
[1440×900 grid](1440x900/01-grid.png) · [1280×800 grid](1280x800/01-grid.png) ·
[Floating and resized](1440x900/09-floating-resized.png) ·
[Minimized dock](1280x800/12-minimized.png).
