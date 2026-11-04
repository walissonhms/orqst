# Retained terminal workspace layout

The existing Electron Terminal workspace now displays its 1–8 reviewed, independently
owned terminals in a grid. This increment retains `TerminalPanels`, the dedicated
sandboxed documents, xterm 6, FitAddon, native broker and Core/PTY lifecycle. No
second session manager, new provider, execution API or dependency is introduced.
The Tauri preview still has no managed-terminal capability; Electron remains the
operational terminal shell until that parity is implemented and accepted.

## Use

Open reviewed terminals through the existing Studio/native menu. Opening a pane
starts no CLI. Choose **Show all panes** to include every prepared document. Choose
one, two, three or adaptive columns in **Layout**. **Side by side** and **Stack
vertically** retain the split orientation; a two-pane split retains its 25–75%
proportion slider, operable by pointer or arrow keys. It is not a draggable native
view boundary. Larger grids use equal cells, filling incomplete final rows.

A pane heading can be dragged onto another pane button in that same document to
reorder the current pane. **Move pane earlier/later** provides the same operation
without dragging. Each pane button remains associated with its original immutable
slot/identity. **Pane display name** changes only a plain-text local label, up to
48 characters; it changes no manifest, provider identity, handle or routing target.
Provider and stable identity remain available in the existing trusted chrome.

**Maximize pane** and pane-button selection show one retained document. **Restore
layout** returns to the prior open group, order, orientation and proportion.
**Hide pane** removes only that pane from the visible group. It neither stops nor
retires its process. **Show all panes** restores hidden documents. **Show dashboard**
suspends the group without clearing it; reopening a pane returns to that group.
**Stop**, force stop, retirement and quit retain their separate existing native
confirmation and evidence rules. No destructive close control is added.

Windows page through the group when there is insufficient room for cells of at
least 440 × 400 CSS pixels. Pane buttons and **Focus other pane** reach off-page
terminals; resizing back restores the grid. An explicitly chosen two-pane split
can be narrower at its 25–75% extremes. Selected cells and pane buttons have visible
focus/selection; native buttons, inputs, select and slider work with the keyboard.
Maximize/restore transfers focus to its corresponding replacement control. No
terminal keystroke shortcuts are intercepted. Existing reduced-motion rules and
xterm screen-reader mode remain enabled.

Layout changes revoke keyboard authorization. Enable input again before typing.
Resizing retains the real FitAddon → bounded Core `resize` → PTY path. Hiding,
paging, reordering and maximizing never recreate WebContents or clear scrollback.
The container ResizeObserver also fits changes caused by expanded chrome or a wrapping
heading without recreating the emulator. Explicit **Attach output** scrolls the outer pane to its terminal when compact
chrome would otherwise leave it below the viewport. This does not move the emulator's
scrollback position; xterm can then paint and update its accessibility tree.
These controls show view selection, not invented task completion or unread status.

## Persistence and recovery boundary

The original JSON preferences described below are now imported non-destructively into
[private SQLite](terminal-layout-sqlite.md) by both shells. Original JSON files remain
unchanged; their guarded reader is retained for compatibility.

The original main-owned `userData/terminal-layouts/<selection-hash>.json` contract:
0700 directory, 0600 files, bounded reads, strict schema, canonical directory and
O_NOFOLLOW reads/creation. Existing symlink/non-private targets are rejected.
The selection hash uses sorted reviewed terminal UUIDs, not renderer-supplied paths.
Order, open group, selected/maximized pane, display names, columns and split settings
are mapped by those stable UUIDs even if manifest selection order changes. A different
selection has different preferences. The first opening through slot A restores the
saved selection; an explicit first opening through another slot takes precedence.

A failed write leaves the usable layout in memory and reports that saving failed
inside **Layout**. Invalid/corrupt stored preferences fall back to defaults; a valid
layout can replace a private corrupt preference. These are layout hints only: no
process ID, executable, credentials, terminal input, session ID or authority is
stored. Reopening the app restores metadata when that same reviewed selection is
opened. It does not reconnect, restart, adopt or duplicate a process. Existing
journal/admission blockers remain authoritative after a quit/crash.

## Reproduction and remaining acceptance

Run the normal lint, typecheck, Node tests and build. The extended existing
`pnpm accept:terminal-team --authorize-synthetic-pty` uses disposable native C CLIs,
real Electron documents, Core and PTYs; it checks stable documents/instance IDs,
rename, keyboard/pointer reorder, focus transfer, compact paging, PTY resize,
private persisted preferences, cross-slot denial and independent stop/retirement.
Its native focus/dialogs are deliberately doubled. `--slots=2` exercises the same
controls with a pair. These commands never start a provider or use real credentials.

The current hard ceiling remains eight, with homogeneous teams except the existing
reviewed Codex/OpenCode pair. Arbitrary nested splits, multiple workspace groups,
drag-out windows, native boundary handles, configuration duplication, rename of
mention handles, orchestration roles and configurable shortcuts are not delivered
by this increment. Process recovery and Tauri terminal composition require separate
implementation. Human screen-reader/IME/OS clipboard, real-provider operation and
packaged cross-platform acceptance remain pending.
